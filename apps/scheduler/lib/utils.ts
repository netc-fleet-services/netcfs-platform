// Date / time / formatting helpers. Pure functions; no DOM, no Supabase.

export function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Monday of the ISO week containing `d`.
export function startOfWeek(d: Date): Date {
  const out = new Date(d)
  const dow = out.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  out.setDate(out.getDate() + diff)
  out.setHours(0, 0, 0, 0)
  return out
}

// [Mon, Tue, ..., Sun] for the week containing `d`.
export function weekDates(d: Date): Date[] {
  const start = startOfWeek(d)
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    return day
  })
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export function dateRange(start: Date, n: number): Date[] {
  const out: Date[] = []
  const base = new Date(start)
  base.setHours(0, 0, 0, 0)
  for (let i = 0; i < n; i++) {
    const day = new Date(base)
    day.setDate(base.getDate() + i)
    out.push(day)
  }
  return out
}

export function shortDateLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function formatTime12(t: string | null | undefined): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// Compact 12-hour clock for tight spaces: "08:00" -> "8a", "08:30" -> "8:30a"
export function formatTime12Compact(t: string | null | undefined): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'p' : 'a'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`
}

export function shiftDurationHours(startTime: string | null, endTime: string | null): number {
  if (!startTime || !endTime) return 0
  const t = (s: string) => {
    const [h, m] = s.split(':').map(Number)
    return h + (m || 0) / 60
  }
  const s = t(startTime)
  let e = t(endTime)
  if (e <= s) e += 24
  return e - s
}

export function formatHours(h: number): string {
  if (!h || h <= 0) return '0h'
  const whole = Math.floor(h)
  const mins = Math.round((h - whole) * 60)
  if (mins === 0) return `${whole}h`
  if (whole === 0) return `${mins}m`
  return `${whole}h ${mins}m`
}

// "08:30" -> 8.5. Accepts "HH:MM" or "HH:MM:SS"; null/empty -> 0.
export function timeToHours(t: string | null | undefined): number {
  if (!t) return 0
  const [h, m] = String(t).split(':').map(Number)
  return h + (m || 0) / 60
}

// Kept as a separate export for callers that read the original name.
export const parseTimeToHours = timeToHours

export function hoursToTimeStr(h: number): string {
  const totalMin = Math.round(h * 60)
  const hh = ((Math.floor(totalMin / 60) % 24) + 24) % 24
  const mm = ((totalMin % 60) + 60) % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function categoryClass(fn: string | null): string {
  switch ((fn || '').toLowerCase()) {
    case 'ldt':          return 'ldt'
    case 'hdt':          return 'hdt'
    case 'transport':    return 'transport'
    case 'road service': return 'road'
    default:             return 'default'
  }
}

// "1,6" -> "1 / 6"
export function formatYards(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).split(',').map(s => s.trim()).filter(Boolean).join(' / ')
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatHour12(h: number): string {
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

// Compact "1a" / "12p" axis labels.
export function formatHourCompact(h: number): string {
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

export type SortKey = 'function' | 'name' | 'driverNumber' | 'startTime'

interface DriverLike {
  id: number
  name: string | null
  function: string | null
  irh_driver_number: string | null
}

interface SchedLike {
  driver_id: number
  schedule_date: string
  entry_type: string
  start_time: string | null
}

// Sort a driver list by the chosen key, with `name` as the always-applied
// secondary tiebreaker so equal-group rows order predictably. `startTime`
// needs `entries` + `week` to compute each driver's earliest shift start
// across the visible window.
export function sortDrivers<T extends DriverLike>(
  drivers: T[],
  sortKey: SortKey,
  ctx: { entries?: SchedLike[]; week?: Date[] } = {},
): T[] {
  const byName = (a: T, b: T) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })

  const numericIfPossible = (v: string | null) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const byDriverNumber = (a: T, b: T) => {
    const an = numericIfPossible(a.irh_driver_number)
    const bn = numericIfPossible(b.irh_driver_number)
    if (an !== null && bn !== null) return an - bn
    if (an === null && bn !== null) return 1
    if (an !== null && bn === null) return -1
    return String(a.irh_driver_number || a.id).localeCompare(
      String(b.irh_driver_number || b.id), undefined, { numeric: true },
    )
  }

  // Per-driver earliest shift start (in hours since week start) across the
  // visible window. Drivers with no in-window shift go to the bottom.
  let earliestStartByDriver: Map<number, number> | null = null
  if (sortKey === 'startTime' && ctx.week && ctx.week.length && ctx.entries) {
    const weekStartMs = ctx.week[0].getTime()
    const totalHoursVisible = ctx.week.length * 24
    const map = new Map<number, number>()
    for (const e of ctx.entries) {
      if (e.entry_type !== 'shift') continue
      const date = fromIsoDate(e.schedule_date)
      const dayOffsetH = Math.round((date.getTime() - weekStartMs) / 3600000)
      if (dayOffsetH < 0 || dayOffsetH >= totalHoursVisible) continue
      const total = dayOffsetH + timeToHours(e.start_time)
      const prev = map.get(e.driver_id)
      if (prev === undefined || total < prev) map.set(e.driver_id, total)
    }
    earliestStartByDriver = map
  }

  return drivers.slice().sort((a, b) => {
    switch (sortKey) {
      case 'name': return byName(a, b)
      case 'driverNumber': {
        const cmp = byDriverNumber(a, b)
        return cmp !== 0 ? cmp : byName(a, b)
      }
      case 'startTime': {
        const sa = earliestStartByDriver?.get(a.id) ?? Infinity
        const sb = earliestStartByDriver?.get(b.id) ?? Infinity
        if (sa !== sb) return sa - sb
        return byName(a, b)
      }
      case 'function':
      default: {
        const cmp = String(a.function || '').localeCompare(String(b.function || ''))
        return cmp !== 0 ? cmp : byName(a, b)
      }
    }
  })
}

// Compute OFF-block visual start times: an off entry should start at the
// previous day's latest shift end (instead of midnight) if the driver had
// a shift on day-1 that bled into day-N. Returns Map<entryId, hoursSinceWeekStart>.
export function computeOffStartOverrides<T extends SchedLike & { id: string; end_time: string | null }>(
  entries: T[],
  byKey: Map<string, T[]>,
  weekStartMs: number,
): Map<string, number> {
  const overrides = new Map<string, number>()
  for (const e of entries) {
    if (e.entry_type !== 'off') continue

    const offDate = fromIsoDate(e.schedule_date)
    const offDayOffsetH = Math.round((offDate.getTime() - weekStartMs) / 3600000)
    let earliestStartH = offDayOffsetH

    const prevIso = toIsoDate(addDays(offDate, -1))
    const prevEntries = byKey.get(`${e.driver_id}|${prevIso}`) || []
    const prevShifts = prevEntries.filter(x => x.entry_type === 'shift')
    if (!prevShifts.length) continue

    const prevDate = fromIsoDate(prevIso)
    const prevDayOffsetH = Math.round((prevDate.getTime() - weekStartMs) / 3600000)

    let latestEndAbs = -Infinity
    for (const ps of prevShifts) {
      const sH = timeToHours(ps.start_time)
      let eH = timeToHours(ps.end_time)
      if (eH <= sH) eH += 24
      const endAbs = prevDayOffsetH + eH
      if (endAbs > latestEndAbs) latestEndAbs = endAbs
    }
    if (latestEndAbs > earliestStartH) earliestStartH = latestEndAbs

    if (earliestStartH < offDayOffsetH && prevDayOffsetH < 0) continue
    if (earliestStartH !== offDayOffsetH) overrides.set(e.id, earliestStartH)
  }
  return overrides
}
