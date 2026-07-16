'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { db, jobToApp } from '../lib/db'
import { sb } from '../lib/supabase'
import {
  BOARD, C, DEFAULT_YARDS, YARDS,
  matchesCompanyBucket, type CompanyBucket, type TeamId,
} from '../lib/config'
import type { Driver, DriverMatchItem, Job, ScheduleEntry, Yard } from '../lib/types'
import { computeBoard, normName } from '../lib/availability'
import { fT, isoD, todayISO } from '../lib/utils'
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
    const [ds, js, sched, al, ys, ls, repo, token, gc, rc] = await Promise.all([
      db.loadDrivers(),
      db.loadBoardJobs(t),
      db.loadScheduleRange(yesterISO(t), t),
      db.loadSetting<Record<string, number>>('driver_name_aliases', {}),
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
        if (prev !== t) void reload()
        return t
      })
    }, 30_000)
    return () => clearInterval(iv)
  }, [reload])

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
    now,
    todayISO: today,
    yesterdayISO: yesterISO(today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [filteredDrivers, drivers, schedule, jobs, aliases, now, today, ghVersion])

  const avail   = board.statuses.filter(s => s.state === 'AVAILABLE')
  const onCall  = board.statuses.filter(s => s.state === 'ON_CALL')
    .sort((a, b) => (a.freeAt?.getTime() ?? Infinity) - (b.freeAt?.getTime() ?? Infinity))
  const claimed = board.statuses.filter(s => s.state === 'CLAIMED')
  const offish  = board.statuses.filter(s => s.state === 'OFF' || s.state === 'OUT_OF_SHIFT' || s.state === 'NOT_SCHEDULED')

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

      {/* ── Stale-sync alert ── */}
      {staleMin != null && staleMin >= BOARD.staleAlertMin && (
        <div style={{ background: C.rd, color: C.wh, fontWeight: 800, fontSize: 14, borderRadius: 8, padding: '8px 14px', marginBottom: 10 }}>
          ⚠ TowBook sync is {staleMin} minutes old — driver call status may be outdated.
        </div>
      )}

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
          <span style={{ color: C.gn }}>{avail.length} AVAILABLE</span>
          <span style={{ color: C.rd }}>{onCall.length} ON CALL</span>
          {claimed.length > 0 && <span style={{ color: C.cy }}>{claimed.length} CLAIMED</span>}
        </div>
      </div>

      {/* ── Main: driver sections + open-calls rail ── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>

          <SectionHeader label="AVAILABLE" count={avail.length} color={C.gn} />
          {avail.length === 0 && <EmptyNote text="No drivers available right now." />}
          <div className="board-grid">
            {avail.map(s => <DriverCard key={s.driver.id} status={s} now={now} />)}
          </div>

          <SectionHeader label="ON CALL" count={onCall.length} color={C.rd} />
          {onCall.length === 0 && <EmptyNote text="Nobody is on a call." />}
          <div className="board-grid board-grid--wide">
            {onCall.map(s => <DriverCard key={s.driver.id} status={s} now={now} />)}
          </div>

          {claimed.length > 0 && (
            <>
              <SectionHeader label="CLAIMED — PENDING IN TOWBOOK" count={claimed.length} color={C.cy} />
              <div className="board-grid board-grid--wide">
                {claimed.map(s => (
                  <DriverCard key={s.driver.id} status={s} now={now}
                    onRelease={s.job ? () => releaseDriver(s.job as Job, s.driver.id) : undefined} />
                ))}
              </div>
            </>
          )}

          <OffStrip statuses={offish} />
        </div>

        <OpenCallsRail
          openCalls={board.openCalls}
          unmatchedCalls={board.unmatchedCalls}
          availableDrivers={avail.map(s => s.driver)}
          bucket={bucket}
          team={team}
          onAssign={assignDriver}
        />
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
