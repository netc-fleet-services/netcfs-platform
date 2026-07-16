'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { db, jobToApp } from '../lib/db'
import { sb } from '../lib/supabase'
import {
  BOARD, C, DEFAULT_YARDS, YARDS,
  matchesCompanyBucket, type CompanyBucket, type TeamId,
} from '../lib/config'
import type { Driver, DriverMatchItem, Job, ScheduleEntry, Yard } from '../lib/types'
import { computeBoard, computeDayPlan, normName, type ManualClaims } from '../lib/availability'
import { dayFull, dayNm, daySh, fT, genDays, isoD, todayISO } from '../lib/utils'
import { crd, geoCache, ghRoute, jobCrd, routeCache, routeLookup, yCrd } from '../lib/geo'
import { DriverCard } from './DriverCard'
import { OpenCallsRail } from './OpenCallsRail'
import { OffStrip } from './OffStrip'
import { SettingsPanel } from './SettingsPanel'
import { DriverMatchModal } from './DriverMatchModal'

function yesterISO(today: string): string {
  const d = new Date(today + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return isoD(d)
}

function plusDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoD(d)
}

// ── Driver name similarity (for the match-modal suggestion) ────────
function nameSimilarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\s+/))
  const tb = new Set(b.toLowerCase().split(/\s+/))
  const shared = [...ta].filter(t => tb.has(t)).length
  return shared / Math.max(ta.size + tb.size - shared, 1)
}
function closestDriver(tbName: string, pool: Driver[]): Driver | null {
  return pool.reduce<{ dr: Driver | null; score: number }>((best, dr) => {
    const score = nameSimilarity(dr.name, tbName)
    return score > best.score ? { dr, score } : best
  }, { dr: null, score: 0 }).dr
}

function lsGet(key: string): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(key)
}

export function Board() {
  const [loaded, setLoaded]       = useState(false)
  const [drivers, setDrivers]     = useState<Driver[]>([])
  const [jobs, setJobs]           = useState<Job[]>([])
  const [schedule, setSchedule]   = useState<ScheduleEntry[]>([])
  const [aliases, setAliases]     = useState<Record<string, number>>({})
  const [yards, setYards]         = useState<Yard[]>([])
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [ghRepo, setGhRepo]       = useState('')
  const [ghToken, setGhToken]     = useState('')
  const [syncStatus, setSyncStatus] = useState<'triggering' | 'ok' | 'error' | null>(null)
  const [now, setNow]             = useState<Date>(new Date())
  const [today, setToday]         = useState<string>(todayISO())
  const [matchQueue, setMatchQueue] = useState<DriverMatchItem[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ghVersion, setGhVersion] = useState(0)   // bumped when a GraphHopper route resolves
  // Manual (job-less) claims — dispatcher grabbed a driver before the call
  // exists in TowBook. Shared across every open board via settings realtime.
  const [manualClaims, setManualClaims] = useState<ManualClaims>({})
  const [claimTarget, setClaimTarget]   = useState<Driver | null>(null)
  const [dragOver, setDragOver]         = useState(false)
  // Day picker — today is the live board; any other day is a planning view.
  const [selectedDay, setSelectedDay]   = useState<string>(todayISO())
  const [planJobs, setPlanJobs]         = useState<Job[]>([])

  // Company/team scope — persisted per device so each TV keeps its setting.
  const [bucket, setBucketState] = useState<CompanyBucket>(() => {
    const v = lsGet('transport.companyBucket')
    return v === 'interstate' || v === 'netc' ? v : BOARD.defaultCompanyBucket
  })
  const [team, setTeamState] = useState<TeamId | 'all'>(() => {
    const v = lsGet('transport.team')
    return v === 'all' || BOARD.teams.some(t => t.id === v) ? (v as TeamId | 'all') : BOARD.defaultTeam
  })
  const setBucket = (b: CompanyBucket) => { setBucketState(b); window.localStorage.setItem('transport.companyBucket', b) }
  const setTeam   = (t: TeamId | 'all') => { setTeamState(t); window.localStorage.setItem('transport.team', t) }

  // ── Initial load / reload ─────────────────────────────────────────
  const reload = useCallback(async () => {
    const t = todayISO()
    const [ds, js, sched, al, mc, ys, ls, repo, token, gc, rc] = await Promise.all([
      db.loadDrivers(),
      db.loadBoardJobs(t),
      // Yesterday (overnight carry-over) through +31 days (day-picker planning)
      db.loadScheduleRange(yesterISO(t), plusDaysISO(t, 31)),
      db.loadSetting<Record<string, number>>('driver_name_aliases', {}),
      db.loadSetting<ManualClaims>('manual_claims', {}),
      db.loadYards(),
      db.loadSetting<string | null>('last_synced', null),
      db.loadSetting<string>('github_repo', ''),
      db.loadSetting<string>('github_token', ''),
      db.loadGeocache(),
      db.loadRouteCache(),
    ])
    Object.assign(geoCache, gc)
    Object.assign(routeCache, rc)
    const yardList = ys.length ? ys : DEFAULT_YARDS
    YARDS.splice(0, YARDS.length, ...yardList)
    setDrivers(ds)
    setJobs(js)
    setSchedule(sched)
    setAliases(al)
    setManualClaims(mc)
    setYards(yardList)
    setLastSynced(ls)
    setGhRepo(repo)
    setGhToken(token)
    setToday(t)
    setLoaded(true)
  }, [])

  useEffect(() => { void reload() }, [reload])

  // ── Realtime: jobs + last_synced + schedule ───────────────────────
  useEffect(() => {
    const keep = (j: Job) => j.day === todayISO() || j.status === 'active'
    const upsertLocal = (j: Job) => {
      setJobs(prev => {
        const rest = prev.filter(x => x.id !== j.id)
        return keep(j) ? [...rest, j] : rest
      })
    }
    const ch = sb.channel('board-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs' },
        p => upsertLocal(jobToApp(p.new as Record<string, unknown>)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs' },
        p => upsertLocal(jobToApp(p.new as Record<string, unknown>)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'jobs' },
        p => setJobs(prev => prev.filter(x => x.id !== String((p.old as { id?: string }).id))))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: 'key=eq.last_synced' },
        p => setLastSynced(((p.new as { value?: string })?.value) ?? null))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: 'key=eq.manual_claims' },
        p => setManualClaims(((p.new as { value?: ManualClaims })?.value) ?? {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduler_driver_schedule' },
        () => { const t = todayISO(); void db.loadScheduleRange(yesterISO(t), t).then(setSchedule) })
      .subscribe()
    return () => { void sb.removeChannel(ch) }
  }, [])

  // ── 30s tick (countdowns) + midnight rollover for 24/7 TVs ───────
  useEffect(() => {
    const iv = setInterval(() => {
      setNow(new Date())
      const t = todayISO()
      setToday(prev => {
        if (prev !== t) {
          void reload()
          setSelectedDay(cur => (cur === prev ? t : cur))   // a TV left on "today" follows the date
        }
        return t
      })
    }, 30_000)
    return () => clearInterval(iv)
  }, [reload])

  // ── Planning-day jobs (any day other than today) ─────────────────
  const isPlanning = selectedDay !== today
  useEffect(() => {
    if (!isPlanning) { setPlanJobs([]); return }
    void db.loadJobsForDay(selectedDay).then(setPlanJobs)
  }, [isPlanning, selectedDay])

  // ── Auto-match TowBook names → roster ids; queue the unmatchable ──
  useEffect(() => {
    if (!loaded) return
    const byName = new Map(drivers.map(d => [normName(d.name), d]))
    const queue = new Map<string, DriverMatchItem>()
    const updates: { id: string; fields: Record<string, unknown> }[] = []

    for (const j of jobs) {
      if (j.status !== 'scheduled' && j.status !== 'active') continue
      const check = (tbName: string, slot: DriverMatchItem['slot'], current: number | null) => {
        const n = normName(tbName)
        if (!n || current) return
        const hit = byName.get(n) ?? drivers.find(d => d.id === aliases[n])
        if (hit) {
          updates.push({ id: j.id, fields: slot === 'driverId' ? { driver_id: hit.id } : { driver_id_2: hit.id } })
        } else {
          const key = `${n}|${slot}`
          const existing = queue.get(key)
          if (existing) existing.callNums.push(j.tbCallNum ?? '')
          else queue.set(key, { tbName, slot, callNums: [j.tbCallNum ?? ''], suggested: closestDriver(tbName, drivers) })
        }
      }
      check(j.tbDriver, 'driverId', j.driverId)
      check(j.tbDriver2, 'driverId2', j.driverId2)
    }

    if (updates.length) {
      setJobs(prev => prev.map(j => {
        const u = updates.find(x => x.id === j.id)
        if (!u) return j
        return {
          ...j,
          driverId:  'driver_id'   in u.fields ? (u.fields.driver_id as number)   : j.driverId,
          driverId2: 'driver_id_2' in u.fields ? (u.fields.driver_id_2 as number) : j.driverId2,
        }
      }))
      for (const u of updates) void db.updateJobFields(u.id, u.fields)
    }
    setMatchQueue([...queue.values()])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.length, drivers, aliases, loaded])

  // ── Warm GraphHopper routes for displayed jobs (better ETAs) ──────
  useEffect(() => {
    if (!loaded) return
    const relevant = jobs.filter(j => j.status === 'active' || (j.status === 'scheduled' && j.day === today))
    for (const j of relevant) {
      const yard = YARDS.find(y => y.id === j.yardId) ?? YARDS[0]
      const yc = yard ? yCrd(yard) : null
      const pts = [yc, jobCrd(j, 'pickup'), ...(j.stops || []).map(s => crd(s.addr, s.zip)), jobCrd(j, 'drop'), yc]
      if (pts.some(p => !p)) continue
      if (routeLookup(pts)) continue   // already cached
      void ghRoute(pts).then(r => { if (r) setGhVersion(v => v + 1) })
    }
  }, [jobs, loaded, today])

  // ── Board computation ─────────────────────────────────────────────
  const filteredDrivers = useMemo(() => {
    const teamFns = team === 'all'
      ? BOARD.teams.flatMap(t => t.functions)
      : BOARD.teams.find(t => t.id === team)?.functions ?? []
    const fnSet = new Set(teamFns.map(f => f.toLowerCase()))
    return drivers.filter(d => {
      if (!matchesCompanyBucket(d.company, bucket)) return false
      const fn = d.func.trim().toLowerCase()
      if (team === 'all') return !fn || fnSet.has(fn)   // blank func visible under All Teams
      return fnSet.has(fn)
    })
  }, [drivers, bucket, team])

  const board = useMemo(() => computeBoard({
    drivers: filteredDrivers,
    allDrivers: drivers,
    schedule,
    jobs,
    aliases,
    manualClaims,
    now,
    todayISO: today,
    yesterdayISO: yesterISO(today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [filteredDrivers, drivers, schedule, jobs, aliases, manualClaims, now, today, ghVersion])

  // ── Manual-claim lifecycle ────────────────────────────────────────
  const saveClaims = useCallback((next: ManualClaims) => {
    setManualClaims(next)
    void db.saveSetting('manual_claims', next)
  }, [])
  const claimDriver = (driverId: number, note: string) => {
    saveClaims({ ...manualClaims, [String(driverId)]: { at: new Date().toISOString(), ...(note.trim() ? { note: note.trim() } : {}) } })
  }
  const releaseClaim = useCallback((driverId: number) => {
    if (!manualClaims[String(driverId)]) return
    const next = { ...manualClaims }
    delete next[String(driverId)]
    saveClaims(next)
  }, [manualClaims, saveClaims])

  // Auto-resolve: once TowBook shows a claimed driver actually ON CALL,
  // the manual claim has served its purpose — clear it.
  useEffect(() => {
    if (!loaded) return
    const confirmed = board.statuses.filter(s => s.state === 'ON_CALL' && manualClaims[String(s.driver.id)])
    if (!confirmed.length) return
    const next = { ...manualClaims }
    for (const s of confirmed) delete next[String(s.driver.id)]
    saveClaims(next)
  }, [board, manualClaims, loaded, saveClaims])

  const avail   = board.statuses.filter(s => s.state === 'AVAILABLE')
  const onCall  = board.statuses.filter(s => s.state === 'ON_CALL')
    .sort((a, b) => (a.freeAt?.getTime() ?? Infinity) - (b.freeAt?.getTime() ?? Infinity))
  const claimed = board.statuses.filter(s => s.state === 'CLAIMED')
  const offish  = board.statuses.filter(s => s.state === 'OFF' || s.state === 'OUT_OF_SHIFT' || s.state === 'NOT_SCHEDULED')

  // ── Planning-view derivations (selected day ≠ today) ─────────────
  const dayPlan = useMemo(() => computeDayPlan(filteredDrivers, schedule, selectedDay), [filteredDrivers, schedule, selectedDay])
  const planScheduled = dayPlan.filter(p => p.state === 'SCHEDULED')
    .sort((a, b) => a.sortKey - b.sortKey || a.driver.name.localeCompare(b.driver.name))
  const planOff = dayPlan.filter(p => p.state === 'OFF')
  const planNot = dayPlan.filter(p => p.state === 'NOT_SCHEDULED')

  const driversById = useMemo(() => new Map(drivers.map(d => [d.id, d])), [drivers])
  const hasOccupant = (j: Job) => !!(j.driverId || j.driverId2 || j.tbDriver.trim() || j.tbDriver2.trim())
  const planRelevant = planJobs.filter(j => j.status === 'scheduled' || j.status === 'active')
  const planOpen = planRelevant.filter(j => !hasOccupant(j))
  const planAssigned = planRelevant.filter(hasOccupant).map(j => {
    const raw = [
      ...[j.driverId, j.driverId2].filter((x): x is number => !!x).map(id => driversById.get(id)?.name ?? `driver #${id}`),
      ...[j.tbDriver, j.tbDriver2],
    ]
    const seen = new Set<string>()
    const names: string[] = []
    for (const n of raw) {
      const k = n.trim().toLowerCase()
      if (!k || seen.has(k)) continue
      seen.add(k)
      names.push(n.trim())
    }
    return { job: j, names }
  })

  const assignPlanned = (job: Job, driverId: number) => {
    const slot = job.driverId ? 'driver_id_2' : 'driver_id'
    setPlanJobs(prev => prev.map(j => j.id === job.id
      ? { ...j, driverId: slot === 'driver_id' ? driverId : j.driverId, driverId2: slot === 'driver_id_2' ? driverId : j.driverId2 }
      : j))
    void db.updateJobFields(job.id, { [slot]: driverId })
  }

  const staleMin = lastSynced ? Math.floor((now.getTime() - new Date(lastSynced).getTime()) / 60_000) : null

  // ── Board actions ─────────────────────────────────────────────────
  const assignDriver = (job: Job, driverId: number) => {
    const slot = job.driverId ? 'driver_id_2' : 'driver_id'
    setJobs(prev => prev.map(j => j.id === job.id
      ? { ...j, driverId: slot === 'driver_id' ? driverId : j.driverId, driverId2: slot === 'driver_id_2' ? driverId : j.driverId2 }
      : j))
    void db.updateJobFields(job.id, { [slot]: driverId })
  }

  const releaseDriver = (job: Job, driverId: number) => {
    const fields: Record<string, unknown> = {}
    if (job.driverId === driverId) fields.driver_id = null
    if (job.driverId2 === driverId) fields.driver_id_2 = null
    if (!Object.keys(fields).length) return
    setJobs(prev => prev.map(j => j.id === job.id
      ? { ...j, driverId: 'driver_id' in fields ? null : j.driverId, driverId2: 'driver_id_2' in fields ? null : j.driverId2 }
      : j))
    void db.updateJobFields(job.id, fields)
  }

  const saveAlias = (tbName: string, driverId: number) => {
    const next = { ...aliases, [normName(tbName)]: driverId }
    setAliases(next)
    void db.saveSetting('driver_name_aliases', next)
  }

  const onMatchAssign = (driver: Driver, callNums: string[]) => {
    const item = matchQueue[0]
    if (!item) return
    saveAlias(item.tbName, driver.id)
    for (const j of jobs) {
      if (!callNums.includes(j.tbCallNum ?? '')) continue
      const fields = item.slot === 'driverId' ? { driver_id: driver.id } : { driver_id_2: driver.id }
      void db.updateJobFields(j.id, fields)
    }
    setJobs(prev => prev.map(j => callNums.includes(j.tbCallNum ?? '')
      ? { ...j, driverId: item.slot === 'driverId' ? driver.id : j.driverId, driverId2: item.slot === 'driverId2' ? driver.id : j.driverId2 }
      : j))
    setMatchQueue(q => q.slice(1))
  }

  const onMatchCreateNew = (tbName: string, callNums: string[]) => {
    const id = Math.max(0, ...drivers.map(d => d.id)) + 1
    const nd: Driver = { id, name: tbName.trim(), truck: '', yard: '', func: '', company: null, active: true }
    setDrivers(prev => [...prev, nd])
    void db.upsertDriver(nd)
    onMatchAssign(nd, callNums)
  }

  const saveYard = (y: Yard) => {
    setYards(prev => {
      const next = prev.some(x => x.id === y.id) ? prev.map(x => (x.id === y.id ? y : x)) : [...prev, y]
      YARDS.splice(0, YARDS.length, ...next)
      return next
    })
    void db.upsertYard(y)
  }
  const removeYard = (id: string) => {
    setYards(prev => {
      const next = prev.filter(x => x.id !== id)
      YARDS.splice(0, YARDS.length, ...next)
      return next
    })
    void db.deleteYard(id)
  }

  const triggerSync = async () => {
    if (!ghRepo || !ghToken) { alert('Set the GitHub repo and token in Settings before triggering a manual sync.'); return }
    setSyncStatus('triggering')
    try {
      const [owner, repo] = ghRepo.trim().split('/')
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/workflows/sync-calls.yml/dispatches`,
        { method: 'POST', headers: { Authorization: `Bearer ${ghToken.trim()}`, Accept: 'application/vnd.github+json' }, body: JSON.stringify({ ref: 'main' }) },
      )
      if (res.status === 204) { setSyncStatus('ok'); setTimeout(() => setSyncStatus(null), 5000) }
      else {
        const body = await res.json().catch(() => ({}))
        setSyncStatus('error')
        alert(`GitHub returned ${res.status}: ${(body as { message?: string }).message || 'unknown error'}`)
        setTimeout(() => setSyncStatus(null), 5000)
      }
    } catch (e) {
      setSyncStatus('error')
      alert('Network error: ' + (e as Error).message)
      setTimeout(() => setSyncStatus(null), 5000)
    }
  }

  if (!loaded) {
    return <div style={{ minHeight: '100vh', background: C.bg, color: C.dm, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>Loading dispatch board…</div>
  }

  const staleColor = staleMin == null ? C.rd : staleMin >= BOARD.staleWarnMin ? C.am : C.gn

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.tx, padding: '14px 18px 28px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5 }}>
          Dispatch Board
          <span style={{ color: C.dm, fontWeight: 600, fontSize: 15, marginLeft: 10 }}>
            {BOARD.companyBuckets.find(b => b.id === bucket)?.label}
            {team !== 'all' ? ` · ${BOARD.teams.find(t => t.id === team)?.label}` : ' · All Teams'}
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: staleColor, fontWeight: 700 }}>
            {staleMin == null ? 'TowBook: never synced' : `TowBook synced ${staleMin} min ago`}
            {syncStatus === 'triggering' ? ' · triggering…' : syncStatus === 'ok' ? ' · sync requested ✓' : ''}
          </span>
          <span style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fT(now)}</span>
          <button className="board-gear" onClick={() => setSettingsOpen(true)} title="Settings"
            style={{ background: 'transparent', border: '1px solid ' + C.bd, borderRadius: 8, color: C.dm, fontSize: 16, padding: '4px 10px', cursor: 'pointer' }}>
            ⚙
          </button>
        </div>
      </div>

      {/* ── Stale-sync alert (live view only) ── */}
      {!isPlanning && staleMin != null && staleMin >= BOARD.staleAlertMin && (
        <div style={{ background: C.rd, color: C.wh, fontWeight: 800, fontSize: 14, borderRadius: 8, padding: '8px 14px', marginBottom: 10 }}>
          ⚠ TowBook sync is {staleMin} minutes old — driver call status may be outdated.
        </div>
      )}

      {/* ── Day picker: Today + next 7 days + calendar jump ── */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        {genDays(8).map(iso => (
          <button key={iso} onClick={() => setSelectedDay(iso)}
            style={{
              padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid ' + (selectedDay === iso ? C.ac : C.bd),
              background: selectedDay === iso ? C.ad : C.sf,
              color: selectedDay === iso ? C.wh : C.dm,
              fontWeight: 700, fontSize: 12,
            }}>
            {dayNm(iso)} <span style={{ opacity: 0.65 }}>{daySh(iso)}</span>
          </button>
        ))}
        <input
          type="date"
          value={selectedDay}
          onChange={e => { if (e.target.value) setSelectedDay(e.target.value) }}
          style={{ background: C.inp, border: '1px solid ' + C.bd, borderRadius: 6, color: C.tx, fontSize: 12, padding: '5px 8px', fontFamily: 'inherit' }}
        />
        {isPlanning && (
          <>
            <span style={{ fontSize: 13, fontWeight: 900, color: C.am, letterSpacing: 0.5 }}>
              PLANNING — {dayFull(selectedDay).toUpperCase()}
            </span>
            <button onClick={() => setSelectedDay(today)}
              style={{ background: 'transparent', border: '1px solid ' + C.bd, borderRadius: 6, color: C.dm, fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
              ← back to live
            </button>
          </>
        )}
      </div>

      {/* ── Scope pills ── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'inline-flex', background: C.sf, border: '1px solid ' + C.bd, borderRadius: 8, padding: 3, gap: 3 }}>
          {BOARD.companyBuckets.map(b => (
            <button key={b.id} onClick={() => setBucket(b.id)}
              style={{ padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', background: bucket === b.id ? C.ac : 'transparent', color: bucket === b.id ? C.wh : C.dm }}>
              {b.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'inline-flex', background: C.sf, border: '1px solid ' + C.bd, borderRadius: 8, padding: 3, gap: 3 }}>
          <button onClick={() => setTeam('all')}
            style={{ padding: '7px 14px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', background: team === 'all' ? C.ac : 'transparent', color: team === 'all' ? C.wh : C.dm }}>
            All Teams
          </button>
          {BOARD.teams.map(t => (
            <button key={t.id} onClick={() => setTeam(t.id)}
              style={{ padding: '7px 14px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', background: team === t.id ? C.ac : 'transparent', color: team === t.id ? C.wh : C.dm }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, fontSize: 14, fontWeight: 800 }}>
          {isPlanning ? (
            <>
              <span style={{ color: C.gn }}>{planScheduled.length} SCHEDULED</span>
              <span style={{ color: C.am }}>{planOff.length} OFF</span>
            </>
          ) : (
            <>
              <span style={{ color: C.gn }}>{avail.length} AVAILABLE</span>
              <span style={{ color: C.rd }}>{onCall.length} ON CALL</span>
              {claimed.length > 0 && <span style={{ color: C.cy }}>{claimed.length} CLAIMED</span>}
            </>
          )}
        </div>
      </div>

      {/* ── Main: driver sections + calls rail ── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>

          {isPlanning ? (
            <>
              {/* Planning view: roster preview for the selected day */}
              <SectionHeader label="SCHEDULED" count={planScheduled.length} color={C.gn} />
              {planScheduled.length === 0 && <EmptyNote text="Nobody scheduled for this day (yet) — shifts come from the Scheduler app." />}
              <div className="board-grid">
                {planScheduled.map(p => (
                  <div key={p.driver.id} style={{ background: C.cd, border: '1px solid ' + C.bd, borderLeft: '6px solid ' + C.gn, borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 21, fontWeight: 900, lineHeight: 1.12 }}>{p.driver.name}</div>
                    <div style={{ marginTop: 6, fontSize: 14, color: C.gn, fontWeight: 700 }}>{p.shiftStart} – {p.shiftEnd}</div>
                    {p.driver.truck && <div style={{ marginTop: 2, fontSize: 12, color: C.dm }}>#{p.driver.truck}</div>}
                  </div>
                ))}
              </div>

              <SectionHeader label="OFF" count={planOff.length} color={C.am} />
              {planOff.length === 0 && <EmptyNote text="Nobody marked off." />}
              <div className="board-grid">
                {planOff.map(p => (
                  <div key={p.driver.id} style={{ background: C.cd, border: '1px solid ' + C.bd, borderLeft: '6px solid ' + C.am, borderRadius: 10, padding: '12px 14px', opacity: 0.85 }}>
                    <div style={{ fontSize: 21, fontWeight: 900, lineHeight: 1.12 }}>{p.driver.name}</div>
                    <div style={{ marginTop: 6, fontSize: 13, color: C.am, fontWeight: 800, textTransform: 'uppercase' }}>{p.offReason ?? 'off'}</div>
                  </div>
                ))}
              </div>

              {planNot.length > 0 && (
                <div style={{ marginTop: 22, borderTop: '1px solid ' + C.bd, paddingTop: 10, opacity: 0.75 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: C.dm, marginBottom: 8 }}>NOT SCHEDULED</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {planNot.map(p => (
                      <span key={p.driver.id} style={{ background: C.sf, border: '1px solid ' + C.bd, borderRadius: 6, padding: '4px 10px', fontSize: 12, color: C.tx, fontWeight: 700 }}>
                        {p.driver.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <SectionHeader label="AVAILABLE" count={avail.length} color={C.gn} />
              {avail.length === 0 && <EmptyNote text="No drivers available right now." />}
              <div className="board-grid">
                {avail.map(s => (
                  <DriverCard key={s.driver.id} status={s} now={now}
                    draggable
                    onDragStart={e => e.dataTransfer.setData('text/driver-id', String(s.driver.id))}
                    onClaim={() => setClaimTarget(s.driver)} />
                ))}
              </div>

              <SectionHeader label="ON CALL" count={onCall.length} color={C.rd} />
              {onCall.length === 0 && <EmptyNote text="Nobody is on a call." />}
              <div className="board-grid board-grid--wide">
                {onCall.map(s => <DriverCard key={s.driver.id} status={s} now={now} />)}
              </div>

              {/* Always rendered live — it's also the drop target for claiming */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault()
                  setDragOver(false)
                  const id = Number(e.dataTransfer.getData('text/driver-id'))
                  const d = drivers.find(x => x.id === id)
                  if (d) setClaimTarget(d)
                }}
                style={{ outline: dragOver ? `2px dashed ${C.cy}` : 'none', outlineOffset: 4, borderRadius: 10 }}
              >
                <SectionHeader label="CLAIMED — PENDING IN TOWBOOK" count={claimed.length} color={C.cy} />
                {claimed.length === 0 && (
                  <EmptyNote text="Phone call before it's in TowBook? Drag an available driver here (or hit claim →) to mark them spoken for." />
                )}
                <div className="board-grid board-grid--wide">
                  {claimed.map(s => (
                    <DriverCard key={s.driver.id} status={s} now={now}
                      onRelease={() => {
                        if (s.job) releaseDriver(s.job, s.driver.id)
                        releaseClaim(s.driver.id)
                      }} />
                  ))}
                </div>
              </div>

              <OffStrip statuses={offish} />
            </>
          )}
        </div>

        {isPlanning ? (
          <OpenCallsRail
            openCalls={planOpen}
            unmatchedCalls={[]}
            availableDrivers={planScheduled.map(p => p.driver)}
            bucket={bucket}
            team={team}
            onAssign={assignPlanned}
            title={`CALLS ${daySh(selectedDay)}`}
            assignedCalls={planAssigned}
          />
        ) : (
          <OpenCallsRail
            openCalls={board.openCalls}
            unmatchedCalls={board.unmatchedCalls}
            availableDrivers={avail.map(s => s.driver)}
            bucket={bucket}
            team={team}
            onAssign={assignDriver}
          />
        )}
      </div>

      {/* ── Overlays ── */}
      {settingsOpen && (
        <SettingsPanel
          drivers={drivers}
          aliases={aliases}
          yards={yards}
          ghRepo={ghRepo}
          ghToken={ghToken}
          syncStatus={syncStatus}
          onClose={() => setSettingsOpen(false)}
          onTriggerSync={triggerSync}
          onSaveGh={(repo, token) => { setGhRepo(repo); setGhToken(token); void db.saveSetting('github_repo', repo); void db.saveSetting('github_token', token) }}
          onSaveDriver={(d) => { setDrivers(prev => prev.map(x => x.id === d.id ? d : x)); void db.upsertDriver(d) }}
          onDeleteAlias={(name) => { const next = { ...aliases }; delete next[name]; setAliases(next); void db.saveSetting('driver_name_aliases', next) }}
          onSaveYard={saveYard}
          onDeleteYard={removeYard}
        />
      )}
      {matchQueue.length > 0 && (
        <DriverMatchModal
          item={matchQueue[0]}
          drivers={drivers}
          onAssign={onMatchAssign}
          onCreateNew={onMatchCreateNew}
        />
      )}
      {claimTarget && (
        <ClaimModal
          driver={claimTarget}
          onCancel={() => setClaimTarget(null)}
          onClaim={note => { claimDriver(claimTarget.id, note); setClaimTarget(null) }}
        />
      )}
    </div>
  )
}

function ClaimModal({ driver, onClaim, onCancel }: {
  driver: Driver
  onClaim: (note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState('')
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 950, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div style={{ background: C.bg, border: '1px solid ' + C.cy, borderRadius: 12, padding: 20, width: 400 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.cy, marginBottom: 4, letterSpacing: 1 }}>CLAIM DRIVER</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>{driver.name}</div>
        <div style={{ fontSize: 12, color: C.dm, marginBottom: 10, lineHeight: 1.5 }}>
          Marks them as spoken for. The card will remind you to enter the call in TowBook
          and assign them there — once TowBook confirms, this converges to ON CALL automatically.
        </div>
        <input
          autoFocus
          placeholder="what for? (optional — shows on the card)"
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onClaim(note)
            if (e.key === 'Escape') onCancel()
          }}
          style={{ background: C.inp, border: '1px solid ' + C.bd, borderRadius: 6, padding: '9px 10px', color: C.tx, fontSize: 13, width: '100%', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={onCancel}
            style={{ background: 'transparent', color: C.dm, border: '1px solid ' + C.bd, borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button onClick={() => onClaim(note)}
            style={{ background: C.cy, color: '#04222b', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 12, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }}>
            Claim
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '18px 0 10px' }}>
      <span style={{ fontSize: 15, fontWeight: 900, letterSpacing: 1.5, color }}>{label}</span>
      <span style={{ fontSize: 30, fontWeight: 900, color, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      <div style={{ flex: 1, height: 1, background: C.bd }} />
    </div>
  )
}

function EmptyNote({ text }: { text: string }) {
  return <div style={{ color: C.dm, fontSize: 13, padding: '6px 2px 2px' }}>{text}</div>
}
