import type { SupabaseClient } from '@supabase/supabase-js'
import type { Driver, ScheduleEntry, ScheduleEntryDraft } from './types'
import { APP_CONFIG } from './config'
import { addDays, fromIsoDate, toIsoDate } from './utils'

interface ListDriversOptions {
  includeInactive?: boolean
  company?: string | null
  yard?: string | string[] | null  // matches irh_yard_number; pass array to OR-match
  functions?: string[] | null
  applyExcludedNames?: boolean
  // Driver ids the user has hidden in the Settings tab. Scheduler-scoped
  // (stored in app_settings, not on the shared drivers table). Filtered out
  // of every list except the Settings → Hidden drivers unhide screen.
  hiddenIds?: number[] | null
}

const DRIVER_SELECT =
  'id, name, "function", yard, truck, "Company", active, inactive_reason, inactive_since, irh_driver_number, irh_yard_number'

export async function listDrivers(
  supabase: SupabaseClient,
  opts: ListDriversOptions = {},
): Promise<Driver[]> {
  const {
    includeInactive = false,
    company = null,
    yard = null,
    functions = null,
    applyExcludedNames = true,
    hiddenIds = null,
  } = opts

  let q = supabase
    .from('drivers')
    .select(DRIVER_SELECT)
    .order('name', { ascending: true })

  if (!includeInactive) q = q.eq('active', true)
  if (company) q = q.eq('"Company"', company)
  if (yard) {
    const list = Array.isArray(yard) ? yard : [yard]
    const escaped = list.map(y => String(y).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = `(^|,)(${escaped.join('|')})($|,)`
    q = q.filter('irh_yard_number', 'match', pattern)
  }
  if (functions && functions.length) q = q.in('"function"', functions)

  const { data, error } = await q
  if (error) throw error
  let drivers = (data ?? []) as Driver[]

  if (applyExcludedNames) {
    const excluded = new Set(
      APP_CONFIG.excludedDriverNames
        .map(n => n.trim().toLowerCase())
        .filter(Boolean),
    )
    if (excluded.size) {
      drivers = drivers.filter(
        d => !excluded.has(String(d.name || '').trim().toLowerCase()),
      )
    }
  }

  if (hiddenIds && hiddenIds.length) {
    const hide = new Set(hiddenIds)
    drivers = drivers.filter(d => !hide.has(d.id))
  }

  return drivers
}

// Fetch specific drivers by id, ignoring active/hidden/excluded filters.
// Backs the Settings → Hidden drivers list (the one place hidden drivers
// must still be visible).
export async function listDriversByIds(
  supabase: SupabaseClient,
  ids: number[],
): Promise<Driver[]> {
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('drivers')
    .select(DRIVER_SELECT)
    .in('id', ids)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Driver[]
}

// Update an existing row in the shared `drivers` table. Identity fields
// (name, irh numbers, company, yard, truck) live on a roster-synced table —
// a future IRH sync may overwrite them. Returns the refreshed row.
export async function updateDriver(
  supabase: SupabaseClient,
  id: number,
  patch: Partial<Omit<Driver, 'id'>>,
): Promise<Driver> {
  const { data, error } = await supabase
    .from('drivers')
    .update(patch)
    .eq('id', id)
    .select(DRIVER_SELECT)
    .single()
  if (error) throw error
  return data as Driver
}

// Backed by the scheduler_distinct_companies view (migration 7).
export async function listDistinctCompanies(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from('scheduler_distinct_companies')
    .select('company')
  if (error) throw error
  const set = new Set<string>()
  for (const r of (data ?? []) as Array<{ company: string | null }>) {
    if (r.company) set.add(r.company)
  }
  return [...set].sort()
}

// Backed by scheduler_distinct_yards, which already splits comma-separated
// multi-yard values into one row per yard.
export async function listDistinctYards(
  supabase: SupabaseClient,
  opts: { company?: string | null; functions?: string[] | null } = {},
): Promise<string[]> {
  const { company = null, functions = null } = opts
  let q = supabase.from('scheduler_distinct_yards').select('yard')
  if (company) q = q.eq('Company', company)
  if (functions && functions.length) q = q.in('function', functions)
  const { data, error } = await q
  if (error) throw error
  const set = new Set<string>()
  for (const r of (data ?? []) as Array<{ yard: string | null }>) {
    if (r.yard) set.add(r.yard)
  }
  return [...set].sort()
}

// Distinct display-yard names from the `yard` column (used by the
// Add-driver form's yard dropdown).
export async function listDistinctYardNames(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from('drivers')
    .select('yard')
    .not('yard', 'is', null)
  if (error) throw error
  const set = new Set<string>()
  for (const r of (data ?? []) as Array<{ yard: string | null }>) {
    if (r.yard) set.add(r.yard)
  }
  return [...set].sort()
}

// Insert one row into `drivers`. `id` has no DB-side default on this shared
// table, so we assign max(id)+1 client-side. Race-prone but the loser just
// retries.
export async function insertDriver(
  supabase: SupabaseClient,
  driver: Omit<Driver, 'id' | 'inactive_reason' | 'inactive_since'> & {
    inactive_reason?: string | null
    inactive_since?: string | null
  },
): Promise<Driver> {
  const { data: maxRow, error: maxErr } = await supabase
    .from('drivers')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (maxErr) throw maxErr
  const nextId = maxRow && Number.isFinite(Number(maxRow.id)) ? Number(maxRow.id) + 1 : 1

  const payload = { id: nextId, ...driver }
  const { data, error } = await supabase
    .from('drivers')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data as Driver
}

// ---------- Schedule entries ----------

export async function listScheduleBetween(
  supabase: SupabaseClient,
  isoStart: string,
  isoEnd: string,
): Promise<ScheduleEntry[]> {
  const { data, error } = await supabase
    .from('scheduler_driver_schedule')
    .select('*')
    .gte('schedule_date', isoStart)
    .lte('schedule_date', isoEnd)
  if (error) throw error
  return (data ?? []) as ScheduleEntry[]
}

export async function upsertEntry(
  supabase: SupabaseClient,
  entry: ScheduleEntryDraft,
): Promise<ScheduleEntry> {
  if (entry.id) {
    const { id, ...rest } = entry
    const { data, error } = await supabase
      .from('scheduler_driver_schedule')
      .update(rest)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as ScheduleEntry
  }
  const { data, error } = await supabase
    .from('scheduler_driver_schedule')
    .insert(entry)
    .select()
    .single()
  if (error) throw error
  return data as ScheduleEntry
}

export async function deleteEntry(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from('scheduler_driver_schedule')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function deleteEntriesForDriversInRange(
  supabase: SupabaseClient,
  driverIds: number[],
  isoStart: string,
  isoEnd: string,
): Promise<boolean> {
  if (!driverIds.length) return false
  const { error } = await supabase
    .from('scheduler_driver_schedule')
    .delete()
    .in('driver_id', driverIds)
    .gte('schedule_date', isoStart)
    .lte('schedule_date', isoEnd)
  if (error) throw error
  return true
}

export async function copyEntriesShifted(
  supabase: SupabaseClient,
  driverIds: number[],
  fromIsoStart: string,
  fromIsoEnd: string,
  daysShift: number,
): Promise<number> {
  if (!driverIds.length) return 0
  const { data, error } = await supabase
    .from('scheduler_driver_schedule')
    .select('driver_id, schedule_date, entry_type, start_time, end_time, off_reason, notes')
    .in('driver_id', driverIds)
    .gte('schedule_date', fromIsoStart)
    .lte('schedule_date', fromIsoEnd)
  if (error) throw error
  const src = (data ?? []) as Array<Pick<ScheduleEntry, 'driver_id' | 'schedule_date' | 'entry_type' | 'start_time' | 'end_time' | 'off_reason' | 'notes'>>
  if (!src.length) return 0

  const targetStart = toIsoDate(addDays(fromIsoDate(fromIsoStart), daysShift))
  const targetEnd = toIsoDate(addDays(fromIsoDate(fromIsoEnd), daysShift))

  const { error: delErr } = await supabase
    .from('scheduler_driver_schedule')
    .delete()
    .in('driver_id', driverIds)
    .gte('schedule_date', targetStart)
    .lte('schedule_date', targetEnd)
  if (delErr) throw delErr

  const shifted = src.map(e => ({
    ...e,
    schedule_date: toIsoDate(addDays(fromIsoDate(e.schedule_date), daysShift)),
  }))

  const { error: insErr } = await supabase
    .from('scheduler_driver_schedule')
    .insert(shifted)
  if (insErr) throw insErr
  return shifted.length
}

export async function fetchEntriesForRange(
  supabase: SupabaseClient,
  driverIds: number[],
  isoStart: string,
  isoEnd: string,
): Promise<Array<Pick<ScheduleEntry, 'driver_id' | 'schedule_date' | 'entry_type' | 'start_time' | 'end_time' | 'off_reason' | 'notes'>>> {
  if (!driverIds.length) return []
  const { data, error } = await supabase
    .from('scheduler_driver_schedule')
    .select('driver_id, schedule_date, entry_type, start_time, end_time, off_reason, notes')
    .in('driver_id', driverIds)
    .gte('schedule_date', isoStart)
    .lte('schedule_date', isoEnd)
  if (error) throw error
  return data ?? []
}

export async function insertEntries(
  supabase: SupabaseClient,
  rows: Array<Partial<ScheduleEntry>>,
): Promise<void> {
  if (!rows.length) return
  const { error } = await supabase
    .from('scheduler_driver_schedule')
    .insert(rows)
  if (error) throw error
}

// ---------- App settings (key/value JSONB) ----------

export interface AppSettingsRow {
  key: string
  value: Record<string, unknown>
}

export async function loadAppSettings(supabase: SupabaseClient): Promise<AppSettingsRow[]> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
  if (error) throw error
  return (data ?? []) as AppSettingsRow[]
}

export async function upsertAppSetting(
  supabase: SupabaseClient,
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value }, { onConflict: 'key' })
  if (error) throw error
}

// ---------- Call-volume baseline (read-only) ----------

export interface BaselineRow {
  day_of_week: number
  hour: number
  month: number | null
  avg_calls: number
}

export async function loadBaseline(supabase: SupabaseClient): Promise<BaselineRow[]> {
  // PostgREST caps page size (default 1000 on Supabase). 168 × 13 (aggregate
  // + 12 months) = 2184 rows total, so paginate until a short page comes back.
  const PAGE = 1000
  const out: BaselineRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('call_volume_baseline')
      .select('day_of_week, hour, month, avg_calls')
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...(data as BaselineRow[]))
    if (data.length < PAGE) break
  }
  return out
}
