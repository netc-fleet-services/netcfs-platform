import { sb } from './supabase'
import type { Job, Driver, Yard, Coords, RouteResult, GeoCache, RouteCache, ScheduleEntry } from './types'

// ── Column mappers ────────────────────────────────────────────────
// NOTE: there is deliberately no full-row job writer anymore. The TowBook sync
// owns most job columns (including action_status / active_since); the board
// only performs targeted column updates via db.updateJobFields.

export function jobToApp(row: Record<string, unknown>): Job {
  return {
    id:           String(row.id),
    yardId:       (row.yard_id as string | null)     || null,
    driverId:     (row.driver_id as number | null)   || null,
    driverId2:    (row.driver_id_2 as number | null) || null,
    pickupZip:    (row.pickup_zip as string | null)  || null,
    dropZip:      (row.drop_zip as string | null)    || null,
    pickupAddr:   (row.pickup_addr  as string) || '',
    dropAddr:     (row.drop_addr    as string) || '',
    pickupLat:    (row.pickup_lat   as number | null) ?? null,
    pickupLon:    (row.pickup_lon   as number | null) ?? null,
    dropLat:      (row.drop_lat     as number | null) ?? null,
    dropLon:      (row.drop_lon     as number | null) ?? null,
    tbCallNum:    (row.tb_call_num  as string | null) || null,
    tbDesc:       (row.tb_desc      as string) || '',
    tbAccount:    (row.tb_account   as string) || '',
    tbScheduled:  (row.tb_scheduled as string | null) || null,
    tbReason:        (row.tb_reason         as string)          || '',
    jobType:         (row.job_type          as string | null)   ?? null,
    jobTypeOverride: row.job_type_override  === true,
    tbDriver:        (row.tb_driver         as string)          || '',
    tbDriver2:    (row.tb_driver_2  as string) || '',
    tbTruck:      (row.truck_and_equipment as string) || '',
    priority:     ((row.priority as string) || 'normal') as Job['priority'],
    status:       ((row.status   as string) || 'scheduled') as Job['status'],
    day:          (row.day as string) || '',
    notes:        (row.notes as string) || '',
    stops:        (row.stops as Job['stops']) || [],
    startedAt:    (row.started_at   as string | null) || null,
    completedAt:  (row.completed_at as string | null) || null,
    hasTolls:     row.has_tolls === true,
    addedAt:      (row.added_at as string | null) || null,
    actionStatus: (row.action_status as string | null) || null,
    activeSince:  (row.active_since  as string | null) || null,
  }
}

function driverToDB(d: Driver) {
  // active is written via setDriverActive only (it also stamps inactive_since).
  return {
    id: d.id,
    name: d.name.trim(),
    truck: d.truck?.trim() || null,
    yard: d.yard.trim().toLowerCase(),
    function: d.func?.trim() || null,
    Company: d.company?.trim() || null,
  }
}

function driverToApp(row: Record<string, unknown>): Driver {
  return {
    id:      row.id as number,
    name:    ((row.name as string) || '').trim(),
    truck:   ((row.truck as string) || '').trim(),
    yard:    ((row.yard as string) || '').trim().toLowerCase(),
    func:    ((row.function as string) || '').trim(),
    company: (row.Company as string | null) ?? null,
    active:  row.active !== false,
  }
}

function scheduleToApp(row: Record<string, unknown>): ScheduleEntry {
  return {
    driverId:     row.driver_id as number,
    scheduleDate: row.schedule_date as string,
    entryType:    row.entry_type as ScheduleEntry['entryType'],
    startTime:    (row.start_time as string | null) ?? null,
    endTime:      (row.end_time as string | null) ?? null,
    offReason:    (row.off_reason as ScheduleEntry['offReason']) ?? null,
  }
}

// Page through a query past PostgREST's 1000-row default cap.
// `build` must return a FRESH builder with all filters + a stable order applied.
interface Pageable {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>
}
async function fetchAll(build: () => Pageable): Promise<Record<string, unknown>[]> {
  const PAGE = 1000
  const all: Record<string, unknown>[] = []
  let offset = 0
  while (true) {
    const { data, error } = await build().range(offset, offset + PAGE - 1)
    if (error) { console.error('db.fetchAll:', error); break }
    const batch = (data ?? []) as Record<string, unknown>[]
    all.push(...batch)
    if (batch.length < PAGE) break
    offset += PAGE
  }
  return all
}

// ── Database operations ────────────────────────────────────────────

export const db = {
  // Today's jobs plus ALL active jobs (an active call may have started yesterday).
  async loadBoardJobs(todayISO: string): Promise<Job[]> {
    const { data, error } = await sb.from('jobs').select('*')
      .or(`day.eq.${todayISO},status.eq.active`)
      .order('added_at')
    if (error) { console.error('db.loadBoardJobs:', error); return [] }
    return (data || []).map(jobToApp)
  },

  // All jobs booked for one specific day (planning view for tomorrow etc.).
  async loadJobsForDay(dayISO: string): Promise<Job[]> {
    const { data, error } = await sb.from('jobs').select('*').eq('day', dayISO).order('added_at')
    if (error) { console.error('db.loadJobsForDay:', error); return [] }
    return (data || []).map(jobToApp)
  },

  // Targeted column update — used by board actions (assign / release / notes).
  // Never full-row upserts: the TowBook sync owns most job columns.
  async updateJobFields(id: string, fields: Record<string, unknown>): Promise<void> {
    const { error } = await sb.from('jobs')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', String(id))
    if (error) console.error('db.updateJobFields:', error)
  },

  // Shift/off rows from the scheduler app (read-only here). PAGINATED —
  // a month of fleet-wide schedule easily exceeds the 1000-row cap.
  async loadScheduleRange(isoStart: string, isoEnd: string): Promise<ScheduleEntry[]> {
    const rows = await fetchAll(() => sb.from('scheduler_driver_schedule')
      .select('driver_id, schedule_date, entry_type, start_time, end_time, off_reason')
      .gte('schedule_date', isoStart)
      .lte('schedule_date', isoEnd)
      .order('schedule_date')
      .order('id'))
    return rows.map(scheduleToApp)
  },

  // Full roster including hidden (inactive) drivers — the board filters
  // display by `active`; Settings needs everyone for hide/restore.
  async loadDrivers(): Promise<Driver[]> {
    const { data, error } = await sb.from('drivers').select('*').order('id')
    if (error) { console.error('db.loadDrivers:', error); return [] }
    return (data || []).map(driverToApp)
  },

  async upsertDriver(driver: Driver): Promise<void> {
    const { error } = await sb.from('drivers').upsert(driverToDB(driver), { onConflict: 'id' })
    if (error) console.error('db.upsertDriver:', error)
  },

  // Hide (quit) / restore a driver. Never deletes — schedules, calls and
  // safety history all reference driver ids. Shares the scheduler's flag.
  async setDriverActive(id: number, active: boolean): Promise<void> {
    const fields = active
      ? { active: true, inactive_reason: null, inactive_since: null }
      : { active: false, inactive_since: new Date().toISOString() }
    const { error } = await sb.from('drivers').update(fields).eq('id', id)
    if (error) console.error('db.setDriverActive:', error)
  },

  async loadYards(): Promise<Yard[]> {
    const { data, error } = await sb.from('yards').select('*').order('short')
    if (error) { console.error('db.loadYards:', error); return [] }
    return (data || []) as Yard[]
  },

  async upsertYard(yard: Yard): Promise<void> {
    const { error } = await sb.from('yards').upsert(yard, { onConflict: 'id' })
    if (error) console.error('db.upsertYard:', error)
  },

  async deleteYard(id: string): Promise<void> {
    const { error } = await sb.from('yards').delete().eq('id', id)
    if (error) console.error('db.deleteYard:', error)
  },

  async loadGeocache(): Promise<GeoCache> {
    const rows = await fetchAll(() => sb.from('geocache').select('*').order('addr'))
    const cache: GeoCache = {}
    rows.forEach(row => {
      cache[row.addr as string] = { lat: row.lat as number, lon: row.lon as number, name: (row.name as string) || undefined }
    })
    return cache
  },

  async saveGeocode(addr: string, result: Coords): Promise<void> {
    const { error } = await sb.from('geocache')
      .upsert({ addr, lat: result.lat, lon: result.lon, name: result.name || null }, { onConflict: 'addr' })
    if (error) console.error('db.saveGeocode:', error)
  },

  async loadRouteCache(): Promise<RouteCache> {
    const rows = await fetchAll(() => sb.from('route_cache').select('*').order('key'))
    const cache: RouteCache = {}
    rows.forEach(row => {
      cache[row.key as string] = {
        miles:        row.miles as number,
        hours:        row.hours as number,
        hasTolls:     row.has_tolls === true,
        tollSegments: (row.toll_segments as unknown[]) || [],
      }
    })
    return cache
  },

  async saveRoute(key: string, result: RouteResult): Promise<void> {
    const { error } = await sb.from('route_cache')
      .upsert({
        key,
        miles:         result.miles,
        hours:         result.hours,
        has_tolls:     result.hasTolls === true,
        toll_segments: result.tollSegments || [],
      }, { onConflict: 'key' })
    if (error) console.error('db.saveRoute:', error)
  },

  async loadSetting<T>(key: string, defaultValue: T): Promise<T> {
    const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle()
    if (error) { console.error('db.loadSetting:', error); return defaultValue }
    return data ? (data.value as T) : defaultValue
  },

  async saveSetting(key: string, value: unknown): Promise<void> {
    const { error } = await sb.from('settings').upsert({ key, value }, { onConflict: 'key' })
    if (error) console.error('db.saveSetting:', error)
  },
}
