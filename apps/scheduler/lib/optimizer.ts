// Demand-vs-supply optimizer.
// Pure logic plus one network read for the call_volume_baseline.
//
// Compares scheduled drivers per hour against historical call volume and
// flags hours that look under- or over-staffed. The output is consumed by
// the Coverage panel (week summary), the day-view coverage strip (per-hour
// colored cells), and the print export's "Coverage notes" section.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { OptimizerConfig } from './config'
import type { Driver, ScheduleEntry } from './types'
import { loadBaseline, type BaselineRow } from './db'
import { addDays, formatHour12, fromIsoDate, shortDateLabel, timeToHours, toIsoDate } from './utils'

export interface Baseline {
  aggregate: number[][]                    // [7][24] avg calls
  byMonth: Map<number, number[][]>         // month (1..12) -> [7][24]
}

export interface Gap {
  isoDate: string
  date: Date
  hour: number
  supply: number
  demandCalls: number
  demandDrivers: number
  gap: number                              // supply - demandDrivers
  status: 'under' | 'over' | 'ok'
}

// Cached baseline + an inflight promise so concurrent callers don't
// re-paginate.
let cached: Baseline | null = null
let inflight: Promise<Baseline> | null = null

export async function getBaseline(supabase: SupabaseClient): Promise<Baseline> {
  if (cached) return cached
  if (inflight) return inflight
  inflight = (async () => {
    const rows = await loadBaseline(supabase)
    const agg: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
    const byMonth = new Map<number, number[][]>()
    for (const r of rows as BaselineRow[]) {
      const dow = r.day_of_week
      const hr = r.hour
      const m = r.month
      const v = Number(r.avg_calls) || 0
      if (m == null) {
        agg[dow][hr] = v
      } else {
        let grid = byMonth.get(m)
        if (!grid) {
          grid = Array.from({ length: 7 }, () => new Array(24).fill(0))
          byMonth.set(m, grid)
        }
        grid[dow][hr] = v
      }
    }
    cached = { aggregate: agg, byMonth }
    return cached
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

export function clearBaselineCache() { cached = null }

export function getCachedBaseline(): Baseline | null { return cached }

// True if a driver lives in any excluded yard (UFP by default). Independent
// of function — used by the UI to tint these driver cards so dispatchers
// can see "this person doesn't count toward towing supply".
export function isInExcludedYard(driver: Driver, opt: OptimizerConfig): boolean {
  const excludes = new Set(opt.excludeYards.map(s => s.trim().toUpperCase()).filter(Boolean))
  if (!excludes.size) return false
  const yards = String(driver.irh_yard_number || '')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  return yards.some(y => excludes.has(y))
}

// Drivers eligible to count toward towing supply: function in supplyFunctions
// AND not in any excluded yard. Case-insensitive, whitespace-tolerant.
export function filterSupplyDrivers(drivers: Driver[], opt: OptimizerConfig): Driver[] {
  const fns = new Set(opt.supplyFunctions.map(s => String(s).trim().toUpperCase()))
  const excludes = new Set(opt.excludeYards.map(s => String(s).trim().toUpperCase()).filter(Boolean))
  return drivers.filter(d => {
    const fn = String(d.function || '').trim().toUpperCase()
    if (!fns.has(fn)) return false
    if (!excludes.size) return true
    const yards = String(d.irh_yard_number || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    return !yards.some(y => excludes.has(y))
  })
}

// avg_calls for a given date + hour. Prefers per-month, falls back to aggregate.
export function demandFor(baseline: Baseline | null, date: Date, hour: number): number {
  if (!baseline) return 0
  const dow = (date.getDay() + 6) % 7    // Mon=0..Sun=6
  const month = date.getMonth() + 1
  const monthGrid = baseline.byMonth.get(month)
  if (monthGrid && monthGrid[dow][hour] > 0) return monthGrid[dow][hour]
  return baseline.aggregate[dow][hour] || 0
}

// Count in-scope drivers scheduled at (isoDate, hour). Handles yesterday's
// overnight shifts that bleed into today.
export function supplyFor(
  entries: ScheduleEntry[],
  drivers: Driver[],
  isoDate: string,
  hour: number,
): number {
  const supplyIds = new Set(drivers.map(d => d.id))
  let count = 0
  const yesterdayIso = toIsoDate(addDays(fromIsoDate(isoDate), -1))

  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    if (!supplyIds.has(e.driver_id)) continue
    const s = timeToHours(e.start_time)
    let f = timeToHours(e.end_time)
    const overnight = f <= s
    if (overnight) f += 24

    if (e.schedule_date === isoDate) {
      // Today's shift covers hour h if [floor(s), ceil(f)) overlaps [h, h+1).
      if (hour + 1 > s && hour < f) count += 1
    } else if (overnight && e.schedule_date === yesterdayIso) {
      const tailEnd = f - 24
      if (hour + 1 > 0 && hour < tailEnd) count += 1
    }
  }
  return count
}

// For each (date, hour) in [isoStart..isoEnd], return a Gap row.
export function computeGaps(
  entries: ScheduleEntry[],
  drivers: Driver[],
  baseline: Baseline | null,
  isoStart: string,
  isoEnd: string,
  opt: OptimizerConfig,
): Gap[] {
  const callsPerDriver = Number(opt.callsPerDriverPerHour) || 1.0
  const under = Number(opt.understaffedThreshold)
  const over = Number(opt.overstaffedThreshold)

  const start = fromIsoDate(isoStart)
  const end = fromIsoDate(isoEnd)
  const out: Gap[] = []

  for (let d = new Date(start); d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    const isoDate = toIsoDate(d)
    for (let h = 0; h < 24; h++) {
      const supply = supplyFor(entries, drivers, isoDate, h)
      const demandCalls = demandFor(baseline, d, h)
      const demandDrivers = demandCalls / callsPerDriver
      const gap = supply - demandDrivers

      let status: Gap['status'] = 'ok'
      if (gap <= under) status = 'under'
      else if (gap >= over) status = 'over'

      out.push({
        isoDate,
        date: new Date(d),
        hour: h,
        supply,
        demandCalls,
        demandDrivers,
        gap,
        status,
      })
    }
  }
  return out
}

// Top suggestions (most severe first), per the configured counts.
export function topSuggestions(gaps: Gap[], opt: OptimizerConfig): { under: Gap[]; over: Gap[] } {
  const nUnder = Math.max(0, Math.round(opt.topUnderstaffedCount))
  const nOver = Math.max(0, Math.round(opt.topOverstaffedCount))

  const under = gaps.filter(g => g.status === 'under')
    .sort((a, b) => a.gap - b.gap)
    .slice(0, nUnder)
  const over = gaps.filter(g => g.status === 'over')
    .sort((a, b) => b.gap - a.gap)
    .slice(0, nOver)

  return { under, over }
}

export function suggestionText(g: Gap): string {
  const dayLabel = shortDateLabel(g.date)
  const hourLabel = formatHour12(g.hour)
  const calls = g.demandCalls.toFixed(1)
  if (g.status === 'under') {
    const need = Math.ceil(-g.gap)
    return `${dayLabel} ${hourLabel} — historically ${calls} calls/hr, only ${g.supply} on shift. Consider +${need} driver${need === 1 ? '' : 's'}.`
  }
  if (g.status === 'over') {
    const cut = Math.floor(g.gap)
    return `${dayLabel} ${hourLabel} — ${g.supply} on shift but historical avg is ${calls} calls/hr. Could trim by ${cut}.`
  }
  return `${dayLabel} ${hourLabel} — ${g.supply} drivers, ${calls} calls/hr (gap ${g.gap.toFixed(1)}).`
}
