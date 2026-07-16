// ── Live-board availability engine ──────────────────────────────────
// Pure functions: given the roster, today's schedule, and the TowBook job
// feed, compute each driver's board state. No I/O — testable in isolation.
//
// State precedence (first match wins; TowBook reality beats the schedule):
//   1. ON_CALL   — active job where TowBook itself names the driver
//   2. CLAIMED   — dispatcher assigned the driver on the board, but TowBook
//                  doesn't show it yet ("spoken for"; converges automatically)
//   3. OFF       — scheduler says off today (PTO / sick / …)
//   4. AVAILABLE — inside a scheduled shift window right now
//   5. OUT_OF_SHIFT — scheduled today but before/after their shift
//   6. NOT_SCHEDULED

import type { Driver, Job, ScheduleEntry } from './types'
import { jobTotal } from './utils'

export type BoardState = 'ON_CALL' | 'CLAIMED' | 'AVAILABLE' | 'OUT_OF_SHIFT' | 'OFF' | 'NOT_SCHEDULED'

export interface DriverBoardStatus {
  driver: Driver
  state: BoardState
  job: Job | null              // primary job for ON_CALL / CLAIMED
  extraJobs: Job[]             // other simultaneous commitments ("+N more")
  activeSince: Date | null
  estHours: number | null      // null when jobTotal is NaN (missing/TBD address)
  freeAt: Date | null          // activeSince + estHours
  overdue: boolean             // now > freeAt
  actionStatus: string | null  // raw TowBook action text
  offReason: string | null
  shiftStart: string | null    // display "H:MM AM"
  shiftEnd: string | null
  shiftPhase: 'before' | 'after' | null
}

export interface BoardInputs {
  drivers: Driver[]            // display set (already bucket+team filtered)
  allDrivers: Driver[]         // FULL roster — occupancy/name resolution must see everyone
  schedule: ScheduleEntry[]    // rows for yesterday + today (overnight carry-over)
  jobs: Job[]                  // today's jobs + all status='active' (any day)
  aliases: Record<string, number>  // normalized tb name → driver id (settings)
  now: Date
  todayISO: string
  yesterdayISO: string
}

export interface BoardResult {
  statuses: DriverBoardStatus[]
  openCalls: Job[]                                // nobody on them at all
  unmatchedCalls: { job: Job; tbName: string }[]  // active, tb name resolves to nobody
}

export function normName(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

interface Window { start: Date; end: Date }

// Shift row → concrete Date window. end <= start ⇒ overnight (rolls to next day).
function windowFor(e: ScheduleEntry): Window | null {
  if (e.entryType !== 'shift' || !e.startTime || !e.endTime) return null
  const start = new Date(`${e.scheduleDate}T${e.startTime}`)
  let end = new Date(`${e.scheduleDate}T${e.endTime}`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  if (end <= start) end = new Date(end.getTime() + 24 * 3600e3)
  return { start, end }
}

function fmtHM(d: Date): string {
  let h = d.getHours()
  const m = d.getMinutes()
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
}

export function computeBoard(inp: BoardInputs): BoardResult {
  const { drivers, allDrivers, schedule, jobs, aliases, now, todayISO, yesterdayISO } = inp

  // Roster name → id. Duplicate normalized names disable name-resolution for
  // that name (misattribution is worse than an unmatched call).
  const byName = new Map<string, number | null>()
  for (const d of allDrivers) {
    const n = normName(d.name)
    if (!n) continue
    byName.set(n, byName.has(n) ? null : d.id)
  }
  const resolve = (tbName: string | null | undefined): number | null => {
    const n = normName(tbName)
    if (!n) return null
    if (byName.has(n)) return byName.get(n) ?? null   // null = ambiguous
    return aliases[n] ?? null
  }

  // Per-job occupancy
  interface Occ { tbIds: Set<number>; boardIds: Set<number>; unmatchedNames: string[] }
  const occ = new Map<string, Occ>()
  for (const j of jobs) {
    const tbIds = new Set<number>()
    const unmatchedNames: string[] = []
    for (const nm of [j.tbDriver, j.tbDriver2]) {
      if (!normName(nm)) continue
      const id = resolve(nm)
      if (id != null) tbIds.add(id)
      else unmatchedNames.push(nm)
    }
    const boardIds = new Set<number>()
    if (j.driverId) boardIds.add(j.driverId)
    if (j.driverId2) boardIds.add(j.driverId2)
    occ.set(j.id, { tbIds, boardIds, unmatchedNames })
  }

  // Busy-until math: freeAt = activeSince + calculated duration.
  const timing = (j: Job) => {
    const sinceIso = j.activeSince ?? j.startedAt
    const activeSince = sinceIso ? new Date(sinceIso) : null
    const t = jobTotal(j)
    const estHours = Number.isFinite(t) ? t : null
    const freeAt = activeSince && estHours != null
      ? new Date(activeSince.getTime() + estHours * 3600e3)
      : null
    return { activeSince, estHours, freeAt }
  }

  // Schedule rows by driver/day
  const schedToday = new Map<number, ScheduleEntry[]>()
  const schedYest  = new Map<number, ScheduleEntry[]>()
  for (const e of schedule) {
    const m = e.scheduleDate === todayISO ? schedToday
            : e.scheduleDate === yesterdayISO ? schedYest
            : null
    if (!m) continue
    const list = m.get(e.driverId)
    if (list) list.push(e)
    else m.set(e.driverId, [e])
  }

  const statuses: DriverBoardStatus[] = []
  for (const d of drivers) {
    const base: DriverBoardStatus = {
      driver: d, state: 'NOT_SCHEDULED', job: null, extraJobs: [],
      activeSince: null, estHours: null, freeAt: null, overdue: false,
      actionStatus: null, offReason: null, shiftStart: null, shiftEnd: null, shiftPhase: null,
    }

    // 1 — ON_CALL: TowBook itself has this driver on an active call
    const onCall = jobs.filter(j => j.status === 'active' && occ.get(j.id)!.tbIds.has(d.id))
    if (onCall.length) {
      const enriched = onCall
        .map(j => ({ j, ...timing(j) }))
        .sort((a, b) =>
          (b.freeAt?.getTime() ?? b.activeSince?.getTime() ?? 0) -
          (a.freeAt?.getTime() ?? a.activeSince?.getTime() ?? 0))
      const p = enriched[0]
      statuses.push({
        ...base, state: 'ON_CALL', job: p.j, extraJobs: enriched.slice(1).map(x => x.j),
        activeSince: p.activeSince, estHours: p.estHours, freeAt: p.freeAt,
        overdue: !!(p.freeAt && now > p.freeAt), actionStatus: p.j.actionStatus,
      })
      continue
    }

    // 2 — CLAIMED: assigned on the board, not confirmed by TowBook yet
    const claimed = jobs.filter(j => {
      const o = occ.get(j.id)!
      if (!o.boardIds.has(d.id) || o.tbIds.has(d.id)) return false
      return j.status === 'active' || (j.status === 'scheduled' && j.day === todayISO)
    })
    if (claimed.length) {
      const p = claimed[0]
      const t = timing(p)
      statuses.push({
        ...base, state: 'CLAIMED', job: p, extraJobs: claimed.slice(1),
        activeSince: t.activeSince, estHours: t.estHours, freeAt: t.freeAt,
        actionStatus: p.actionStatus,
      })
      continue
    }

    // 3 — OFF (scheduler off-entry is whole-day)
    const off = (schedToday.get(d.id) ?? []).find(e => e.entryType === 'off')
    if (off) {
      statuses.push({ ...base, state: 'OFF', offReason: off.offReason })
      continue
    }

    // 4 — AVAILABLE: inside any shift window (incl. yesterday's overnight)
    const windows: Window[] = []
    for (const e of schedToday.get(d.id) ?? []) {
      const w = windowFor(e)
      if (w) windows.push(w)
    }
    const carryOver: Window[] = []
    for (const e of schedYest.get(d.id) ?? []) {
      const w = windowFor(e)
      if (w && w.start <= now && now < w.end) carryOver.push(w)
    }
    const active = windows.find(w => w.start <= now && now < w.end) ?? carryOver[0] ?? null
    if (active) {
      statuses.push({ ...base, state: 'AVAILABLE', shiftStart: fmtHM(active.start), shiftEnd: fmtHM(active.end) })
      continue
    }

    // 5 — OUT_OF_SHIFT: scheduled today, but before/after the shift
    if (windows.length) {
      const earliest = windows.reduce((a, b) => (a.start <= b.start ? a : b))
      const latest   = windows.reduce((a, b) => (a.end >= b.end ? a : b))
      const before = now < earliest.start
      const w = before ? earliest : latest
      statuses.push({
        ...base, state: 'OUT_OF_SHIFT', shiftPhase: before ? 'before' : 'after',
        shiftStart: fmtHM(w.start), shiftEnd: fmtHM(w.end),
      })
      continue
    }

    // 6 — NOT_SCHEDULED
    statuses.push(base)
  }

  // Open + unmatched calls
  const openCalls: Job[] = []
  const unmatchedCalls: { job: Job; tbName: string }[] = []
  for (const j of jobs) {
    if (j.status !== 'scheduled' && j.status !== 'active') continue
    const o = occ.get(j.id)!
    if (j.status === 'active') {
      for (const tbName of o.unmatchedNames) unmatchedCalls.push({ job: j, tbName })
    }
    const relevant = j.status === 'active' || j.day === todayISO
    if (relevant && o.tbIds.size === 0 && o.boardIds.size === 0 && o.unmatchedNames.length === 0) {
      openCalls.push(j)
    }
  }

  return { statuses, openCalls, unmatchedCalls }
}
