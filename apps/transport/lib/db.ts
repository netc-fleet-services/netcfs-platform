import { sb } from './supabase'
import type { Job, Driver, Yard, Coords, RouteResult, GeoCache, RouteCache } from './types'

// ── Column mappers ────────────────────────────────────────────────

function jobToDB(j: Job) {
  return {
    id:           String(j.id),
    yard_id:      j.yardId       || null,
    driver_id:    j.driverId     || null,
    driver_id_2:  j.driverId2    || null,
    pickup_zip:   j.pickupZip    || null,
    drop_zip:     j.dropZip      || null,
    pickup_addr:  j.pickupAddr   || null,
    drop_addr:    j.dropAddr     || null,
    pickup_lat:   j.pickupLat    != null ? j.pickupLat : null,
    pickup_lon:   j.pickupLon    != null ? j.pickupLon : null,
    drop_lat:     j.dropLat      != null ? j.dropLat   : null,
    drop_lon:     j.dropLon      != null ? j.dropLon   : null,
    tb_call_num:  j.tbCallNum    || null,
    tb_desc:      j.tbDesc       || null,
    tb_account:   j.tbAccount    || null,
    tb_scheduled: j.tbScheduled  || null,
    tb_reason:    j.tbReason     || null,
    tb_driver:    j.tbDriver     || null,
    tb_driver_2:  j.tbDriver2    || null,
    truck_and_equipment: j.tbTruck || null,
    priority:     j.priority     || 'normal',
    status:       j.status       || 'scheduled',
    day:          j.day,
    notes:        j.notes        || null,
    stops:        j.stops        || [],
    started_at:   j.startedAt    || null,
    completed_at: j.completedAt  || null,
    has_tolls:    j.hasTolls     === true,
    added_at:     j.addedAt      || new Date().toISOString(),
    updated_at:   new Date().toISOString(),
  }
}

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
    tbReason:     (row.tb_reason    as string) || '',
    tbDriver:     (row.tb_driver    as string) || '',
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
  }
}

function driverToDB(d: Driver) {
  return { id: d.id, name: d.name, truck: d.truck || null, yard: d.yard, function: d.func || null }
}

function driverToApp(row: Record<string, unknown>): Driver {
  return {
    id:    row.id as number,
    name:  row.name as string,
    truck: (row.truck as string) || '',
    yard:  row.yard as string,
    func:  (row.function as string) || '',
  }
}

// ── Database operations ────────────────────────────────────────────

export const db = {
  async loadAllJobs(): Promise<Job[]> {
    const { data, error } = await sb.from('jobs').select('*').order('added_at')
    if (error) { console.error('db.loadAllJobs:', error); return [] }
    return (data || []).map(jobToApp)
  },

  async upsertJob(job: Job): Promise<void> {
    const { error } = await sb.from('jobs').upsert(jobToDB(job), { onConflict: 'id' })
    if (error) console.error('db.upsertJob:', error)
  },

  async batchUpsertJobs(jobs: Job[]): Promise<void> {
    if (!jobs.length) return
    const unique = [...new Map(jobs.map(j => [j.id, j])).values()]
    const { error } = await sb.from('jobs').upsert(unique.map(jobToDB), { onConflict: 'id' })
    if (error) console.error('db.batchUpsertJobs:', error.code, error.message, error.details)
  },

  async cancelJobs(ids: string[]): Promise<void> {
    if (!ids.length) return
    const { error } = await sb.from('jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .in('id', ids.map(String))
    if (error) console.error('db.cancelJobs:', error)
  },

  async deleteJob(id: string): Promise<void> {
    const { error } = await sb.from('jobs').delete().eq('id', String(id))
    if (error) console.error('db.deleteJob:', error)
  },

  async clearAllJobs(): Promise<void> {
    const { error } = await sb.from('jobs').delete().not('id', 'is', null)
    if (error) console.error('db.clearAllJobs:', error)
  },

  async loadDrivers(): Promise<Driver[]> {
    const { data, error } = await sb.from('drivers').select('*').order('id')
    if (error) { console.error('db.loadDrivers:', error); return [] }
    return (data || []).map(driverToApp)
  },

  async upsertDriver(driver: Driver): Promise<void> {
    const { error } = await sb.from('drivers').upsert(driverToDB(driver), { onConflict: 'id' })
    if (error) console.error('db.upsertDriver:', error)
  },

  async deleteDriver(id: number): Promise<void> {
    const { error } = await sb.from('drivers').delete().eq('id', id)
    if (error) console.error('db.deleteDriver:', error)
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
    const { data, error } = await sb.from('geocache').select('*')
    if (error) { console.error('db.loadGeocache:', error); return {} }
    const cache: GeoCache = {}
    ;(data || []).forEach((row: Record<string, unknown>) => {
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
    const { data, error } = await sb.from('route_cache').select('*')
    if (error) { console.error('db.loadRouteCache:', error); return {} }
    const cache: RouteCache = {}
    ;(data || []).forEach((row: Record<string, unknown>) => {
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
