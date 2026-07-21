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
import { jobTotal, schedMs } from './utils'

export type BoardState = 'ON_CALL' | 'CLAIMED' | 'AVAILABLE' | 'OUT_OF_SHIFT' | 'OFF' | 'NOT_SCHEDULED'

export interface DriverBoardStatus {
  driver: Driver
  state: BoardState
  job: Job | null              // primary job for ON_CALL / CLAIMED (null for job-less manual claims)
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
  claimedAt: Date | null       // manual claim timestamp (dispatcher grabbed the driver)
  claimNote: string | null     // optional "claimed for …" note
}

// Manual (job-less) claims: dispatcher grabbed a driver before the call exists
// in TowBook. Stored in settings key 'manual_claims' keyed by ISO day → driver
// id, so drivers can be claimed for FUTURE days too. When a claimed day
// arrives, its bucket simply becomes the live board's claims.
export type ManualClaims = Record<string, { at: string; note?: string }>
export type ManualClaimsByDay = Record<string, ManualClaims>

export interface BoardInputs {
  drivers: Driver[]            // display set (already bucket+team filtered)
  allDrivers: Driver[]         // FULL roster — occupancy/name resolution must see everyone
  schedule: ScheduleEntry[]    // rows for yesterday + today (overnight carry-over)
  jobs: Job[]                  // today's jobs + all status='active' (any day)
  aliases: Record<string, number>  // normalized tb name → driver id (settings)
  manualClaims: ManualClaims
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

export interface NameResolver {
  // Best single driver id for a TowBook name, or null if unknown/ambiguous.
  resolve: (tbName: string | null | undefined) => number | null
  // Every roster id that carries this name (active preferred) — lets a caller
  // disambiguate an ambiguous name using other evidence (e.g. a board driver_id).
  candidates: (tbName: string | null | undefined) => number[]
}

// TowBook name → driver id. Duplicate names are handled two ways so a doubled
// roster entry can't silently hide a driver:
//   • Active wins — an inactive duplicate (a merged-away record) never makes a
//     live name ambiguous.
//   • Still-ambiguous names resolve to null, but `candidates` exposes the ids so
//     the board can confirm via a job's driver_id.
export function makeResolver(
  allDrivers: Driver[],
  aliases: Record<string, number>,
): NameResolver {
  const active = new Map<string, number[]>()
  const all = new Map<string, number[]>()
  const push = (m: Map<string, number[]>, n: string, id: number) => {
    const l = m.get(n); if (l) l.push(id); else m.set(n, [id])
  }
  for (const d of allDrivers) {
    const n = normName(d.name)
    if (!n) continue
    push(all, n, d.id)
    if (d.active) push(active, n, d.id)
  }
  const candsFor = (tbName: string | null | undefined): number[] => {
    const n = normName(tbName)
    if (!n) return []
    const a = active.get(n)
    return (a && a.length ? a : all.get(n)) ?? []
  }
  return {
    candidates: candsFor,
    resolve: (tbName) => {
      const n = normName(tbName)
      if (!n) return null
      const cands = candsFor(n)
      if (cands.length === 1) return cands[0]
      if (cands.length > 1) return null            // genuinely ambiguous
      return aliases[n] ?? null
    },
  }
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
  const { drivers, allDrivers, schedule, jobs, aliases, manualClaims, now, todayISO, yesterdayISO } = inp

  // Roster name → id. Duplicate normalized names disable name-resolution for
  // that name (misattribution is worse than an unmatched call).
  const { resolve, candidates } = makeResolver(allDrivers, aliases)

  // Per-job occupancy
  interface Occ { tbIds: Set<number>; boardIds: Set<number>; unmatchedNames: string[] }
  const occ = new Map<string, Occ>()
  for (const j of jobs) {
    const tbIds = new Set<number>()
    const unmatchedNames: string[] = []
    for (const nm of [j.tbDriver, j.tbDriver2]) {
      if (!normName(nm)) continue
      let id = resolve(nm)
      if (id == null) {
        // Name is ambiguous (two roster rows share it). If dispatch already put
        // one of those exact candidates on this call via driver_id, trust that
        // to confirm the TowBook match instead of dropping it to UNMATCHED.
        const cands = candidates(nm)
        if (cands.length > 1) {
          if (j.driverId && cands.includes(j.driverId)) id = j.driverId
          else if (j.driverId2 && cands.includes(j.driverId2)) id = j.driverId2
        }
      }
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
      claimedAt: null, claimNote: null,
    }

    // 1 — ON_CALL: TowBook itself has this driver on an active call
    const onCall = jobs.filter(j => j.status === 'active' && occ.get(j.id)!.tbIds.has(d.id))
    if (onCall.length) {
      const enriched = onCall
        .map(j => ({ j, ...timing(j) }))
        .sort((a, b) =>
          (b.freeAt?.getTime() ?? b.activeSince?.getTime() ?? 0) -
          (a.freeAt?.getTime() ?? a.activeSince?.getTime() ?? 0))
      // Primary = the call they'll be free from LAST, so the countdown is honest.
      // The other calls become chips, ordered by their scheduled time.
      const p = enriched[0]
      const extras = enriched.slice(1).map(x => x.j).sort((a, b) => schedMs(a) - schedMs(b))
      statuses.push({
        ...base, state: 'ON_CALL', job: p.j, extraJobs: extras,
        activeSince: p.activeSince, estHours: p.estHours, freeAt: p.freeAt,
        overdue: !!(p.freeAt && now > p.freeAt), actionStatus: p.j.actionStatus,
      })
      continue
    }

    // 2 — CLAIMED: assigned on the board (to a job) and/or manually claimed by
    // a dispatcher before the call exists in TowBook. Not confirmed by TowBook.
    const claimed = jobs.filter(j => {
      const o = occ.get(j.id)!
      if (!o.boardIds.has(d.id) || o.tbIds.has(d.id)) return false
      return j.status === 'active' || (j.status === 'scheduled' && j.day === todayISO)
    })
    const mc = manualClaims[String(d.id)]
    if (claimed.length || mc) {
      const ordered = claimed.slice().sort((a, b) => schedMs(a) - schedMs(b) || (a.tbCallNum ?? '').localeCompare(b.tbCallNum ?? ''))
      const p = ordered[0] ?? null   // earliest call headlines
      const t = p ? timing(p) : { activeSince: null, estHours: null, freeAt: null }
      statuses.push({
        ...base, state: 'CLAIMED', job: p, extraJobs: ordered.slice(1),
        activeSince: t.activeSince, estHours: t.estHours, freeAt: t.freeAt,
        actionStatus: p?.actionStatus ?? null,
        claimedAt: mc ? new Date(mc.at) : null,
        claimNote: mc?.note ?? null,
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

// ── Planning view for a non-today date ──────────────────────────────
// No live call data for other days — who's scheduled / claimed / off / absent.

export type PlanState = 'SCHEDULED' | 'CLAIMED' | 'OFF' | 'NOT_SCHEDULED'

export interface DriverDayPlan {
  driver: Driver
  state: PlanState
  job: Job | null            // the call they're already assigned to (TowBook or board), if any
  extraJobs: Job[]           // additional calls that day ("+N more")
  shiftStart: string | null
  shiftEnd: string | null
  offReason: string | null
  claimedAt: string | null   // ISO — when the dispatcher manually reserved them (job-less claim)
  claimNote: string | null
  sortKey: number   // minutes-from-midnight of shift start (for ordering)
}

export function computeDayPlan(
  drivers: Driver[],
  allDrivers: Driver[],
  schedule: ScheduleEntry[],
  jobs: Job[],
  dayISO: string,
  claims: ManualClaims = {},
  aliases: Record<string, number> = {},
): DriverDayPlan[] {
  const byDriver = new Map<number, ScheduleEntry[]>()
  for (const e of schedule) {
    if (e.scheduleDate !== dayISO) continue
    const list = byDriver.get(e.driverId)
    if (list) list.push(e)
    else byDriver.set(e.driverId, [e])
  }

  // Which drivers are already on a call this day — the dispatcher has already
  // assigned them, whether in TowBook (tb_driver resolves to them) or on the
  // board (driver_id). Those must read as CLAIMED, not free.
  const { resolve } = makeResolver(allDrivers, aliases)
  const jobsByDriver = new Map<number, Job[]>()
  const addJob = (id: number | null, j: Job) => {
    if (id == null) return
    const l = jobsByDriver.get(id)
    if (l) { if (!l.includes(j)) l.push(j) }
    else jobsByDriver.set(id, [j])
  }
  for (const j of jobs) {
    if (j.day !== dayISO) continue                 // guard; loader already scopes by day
    if (j.status === 'complete') continue          // finished/cancelled calls don't reserve anyone
    addJob(j.driverId, j)
    addJob(j.driverId2, j)
    addJob(resolve(j.tbDriver), j)
    addJob(resolve(j.tbDriver2), j)
  }

  return drivers.map(d => {
    const rows = byDriver.get(d.id) ?? []
    const off = rows.find(e => e.entryType === 'off')

    // Shift window (if any) — shown for scheduled AND claimed drivers.
    const shifts = rows.filter(e => e.entryType === 'shift' && e.startTime && e.endTime)
    let shiftStart: string | null = null
    let shiftEnd: string | null = null
    let sortKey = 9998
    if (shifts.length) {
      const first = shifts.reduce((a, b) => ((a.startTime ?? '') <= (b.startTime ?? '') ? a : b))
      const w = windowFor(first)
      shiftStart = w ? fmtHM(w.start) : null
      shiftEnd = w ? fmtHM(w.end) : null
      const [hh, mm] = (first.startTime ?? '0:0').split(':').map(Number)
      sortKey = hh * 60 + mm
    }

    const base = { driver: d, job: null as Job | null, extraJobs: [] as Job[], shiftStart, shiftEnd, offReason: null as string | null, claimedAt: null as string | null, claimNote: null as string | null, sortKey }

    if (off) {
      // Off wins — an off driver can't be sent out, claim or not. If they're also
      // on a call that day it's a scheduling conflict; the call still shows covered
      // in the rail, so the clash is visible without overriding the OFF status.
      return { ...base, state: 'OFF' as const, shiftStart: null, shiftEnd: null, offReason: off.offReason, sortKey: 9999 }
    }

    // Already assigned to a call this day → CLAIMED, carrying the call itself.
    const assigned = (jobsByDriver.get(d.id) ?? []).slice()
      .sort((a, b) => schedMs(a) - schedMs(b) || (a.tbCallNum ?? '').localeCompare(b.tbCallNum ?? ''))
    if (assigned.length) {
      return { ...base, state: 'CLAIMED' as const, job: assigned[0], extraJobs: assigned.slice(1) }
    }

    // Manual reservation (no call in TowBook yet).
    const mc = claims[String(d.id)]
    if (mc) {
      return { ...base, state: 'CLAIMED' as const, claimedAt: mc.at, claimNote: mc.note ?? null }
    }
    if (shifts.length) {
      return { ...base, state: 'SCHEDULED' as const }
    }
    return { ...base, state: 'NOT_SCHEDULED' as const, shiftStart: null, shiftEnd: null }
  })
}
