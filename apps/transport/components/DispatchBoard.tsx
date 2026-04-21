'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { C, cB, bP, bSt, iS, sS, YARDS, DEFAULT_YARDS, DRIVER_FUNCTIONS, defaultDrivers, uid } from '../lib/config'
import { geoCache, routeCache, crd, dMi, lz, closestYard, cityFrom } from '../lib/geo'
import { LS, fH, fD, fMi, fT, dLb, isoD, todayISO, tmrwISO, dayNm, dayFull, daySh, genDays, jCalc, jobTotal, jobMiles } from '../lib/utils'
import { db, jobToApp } from '../lib/db'
import { sb } from '../lib/supabase'
import { JobCard } from './JobCard'
import { DriversTab } from './DriversTab'
import { HistoryTab } from './HistoryTab'
import { MetricsTab } from './MetricsTab'
import { SettingsTab } from './SettingsTab'
import { DriverMatchModal } from './DriverMatchModal'
import { OptimizerModal } from './OptimizerModal'
import { PossibleStackingModal } from './PossibleStackingModal'
import { NewStackModal } from './NewStackModal'
import type { Job, Driver, Yard, DriverMatchItem, OptimizerState, StackPair } from '../lib/types'

// ── Stacking helper ──────────────────────────────────────────────────────────

function findPossibleStacks(dayJobs: Job[], drivers: Driver[], maxMi: number) {
  const drvById: Record<number, Driver> = Object.fromEntries(drivers.map(d => [d.id, d]))
  const active  = dayJobs.filter(j => j.status !== 'cancelled' && j.status !== 'complete')
  let skipped   = 0
  const results: StackPair[] = []

  for (const a of active) {
    const aDrop = (() => { if (a.dropLat != null && a.dropLon != null) return { lat: a.dropLat, lon: a.dropLon }; return crd(a.dropAddr, a.dropZip) })()
    if (!aDrop) { skipped++; continue }

    for (const b of active) {
      if (a.id === b.id) continue
      if (a.driverId && b.driverId && a.driverId === b.driverId) continue
      const bPick = (() => { if (b.pickupLat != null && b.pickupLon != null) return { lat: b.pickupLat, lon: b.pickupLon }; return crd(b.pickupAddr, b.pickupZip) })()
      if (!bPick) continue

      const dist = dMi(aDrop, bPick)
      if (dist <= maxMi) {
        results.push({
          a, b, dist,
          aDriver: a.driverId ? drvById[a.driverId] : null,
          bDriver: b.driverId ? drvById[b.driverId] : null,
          city:    cityFrom(b.pickupAddr) || lz(b.pickupZip)?.label || b.pickupZip || '?',
        })
      }
    }
  }

  results.sort((x, y) => x.dist - y.dist)
  return { results: results.slice(0, 30), skipped }
}

// ── Driver name similarity ────────────────────────────────────────────────────

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

// ── DispatchBoard ─────────────────────────────────────────────────────────────

export function DispatchBoard() {
  const [loaded,          setLoaded]          = useState(false)
  const [tab,             setTab]             = useState('schedule')
  const [yards,           setYards]           = useState<Yard[]>([])
  const [drivers,         setDrivers]         = useState<Driver[]>([])
  const [hpd,             setHpd]             = useState(8)
  const [staffing,        setStaffing]        = useState<Record<string, number>>({})
  const [jobs,            setJobs]            = useState<Job[]>([])
  const [viewDay,         setViewDay]         = useState(todayISO())
  const [showForm,        setShowForm]        = useState(false)
  const [now,             setNow]             = useState(new Date())
  const [fp,              setFp]              = useState('')
  const [fd,              setFd]              = useState('')
  const [newDr,           setNewDr]           = useState({ name: '', truck: '', yard: 'exeter', func: 'Transport' })
  const [newYard,         setNewYard]         = useState({ short: '', addr: '', zip: '' })
  const [reasonFilter,    setReasonFilter]    = useState<Set<string>>(() => {
    const saved = LS.get<string | string[]>('filter', 'ALL')
    if (typeof saved === 'string') return new Set([saved])
    return new Set(saved)
  })
  const [locationFilter,  setLocationFilter]  = useState<Set<string>>(() => new Set(['ALL']))
  const [lastSynced,      setLastSynced]      = useState<string | null>(null)
  const [ghRepo,          setGhRepo]          = useState('')
  const [ghToken,         setGhToken]         = useState('')
  const [syncStatus,      setSyncStatus]      = useState<null | 'triggering' | 'ok' | 'error'>(null)
  const [showOptimizer,   setShowOptimizer]   = useState(false)
  const [optState,        setOptState]        = useState<OptimizerState | null>(null)
  const [driverMatchQueue, setDriverMatchQueue] = useState<DriverMatchItem[]>([])
  const [newStackQueue,   setNewStackQueue]   = useState<StackPair[]>([])
  const [showStacking,    setShowStacking]    = useState(false)
  const [stackRadius,     setStackRadius]     = useState(15)
  const [ignoredStacks,   setIgnoredStacks]   = useState<Set<string>>(() => new Set())
  const [calExpanded,     setCalExpanded]     = useState(false)

  const jobsRef          = useRef<Job[]>([])
  const driversRef       = useRef<Driver[]>([])
  const viewDayRef       = useRef(viewDay)
  const stackRadiusRef   = useRef(stackRadius)
  const ignoredStacksRef = useRef(ignoredStacks)
  useEffect(() => { jobsRef.current          = jobs         }, [jobs])
  useEffect(() => { driversRef.current       = drivers      }, [drivers])
  useEffect(() => { viewDayRef.current       = viewDay      }, [viewDay])
  useEffect(() => { stackRadiusRef.current   = stackRadius  }, [stackRadius])
  useEffect(() => { ignoredStacksRef.current = ignoredStacks }, [ignoredStacks])

  // ── Initial load ─────────────────────────────────────────────────────────────

  useEffect(() => {
    ;(async () => {
      let [fetchedJobs, fetchedYards, fetchedDrivers, fetchedHpd, fetchedStaffing,
           fetchedGeocache, fetchedRouteCache, fetchedLastSynced, fetchedGHRepo, fetchedGHToken] =
        await Promise.all([
          db.loadAllJobs(),
          db.loadYards(),
          db.loadDrivers(),
          db.loadSetting<number>('hpd', 8),
          db.loadSetting<Record<string, number>>('staffing', {}),
          db.loadGeocache(),
          db.loadRouteCache(),
          db.loadSetting<string | null>('last_synced', null),
          db.loadSetting<string>('github_repo', ''),
          db.loadSetting<string>('github_token', ''),
        ])

      Object.assign(geoCache, fetchedGeocache)
      Object.assign(routeCache, fetchedRouteCache)
      if (fetchedLastSynced) setLastSynced(fetchedLastSynced)
      if (fetchedGHRepo)     setGhRepo(fetchedGHRepo)
      if (fetchedGHToken)    setGhToken(fetchedGHToken)

      const yardsToUse = fetchedYards.length > 0 ? fetchedYards : DEFAULT_YARDS
      YARDS.splice(0, YARDS.length, ...yardsToUse)
      setYards(yardsToUse)
      if (!fetchedYards.length) await Promise.all(DEFAULT_YARDS.map(y => db.upsertYard(y)))

      const unassigned = fetchedJobs.filter(j => !j.yardId && j.status === 'scheduled')
      if (unassigned.length > 0) {
        const assigned = unassigned.map(j => ({ ...j, yardId: closestYard(j.pickupAddr, j.pickupZip).id }))
        await db.batchUpsertJobs(assigned)
        const byId = Object.fromEntries(assigned.map(j => [j.id, j]))
        fetchedJobs = fetchedJobs.map(j => byId[j.id] || j)
      }

      {
        const currentDrivers = [...fetchedDrivers]
        const allPending = [
          ...fetchedJobs.filter(j => j.tbDriver  && !j.driverId  && j.status === 'scheduled').map(j => ({ j, tbName: j.tbDriver!,  slot: 'driverId'  as const })),
          ...fetchedJobs.filter(j => j.tbDriver2 && !j.driverId2 && j.status === 'scheduled').map(j => ({ j, tbName: j.tbDriver2!, slot: 'driverId2' as const })),
        ]
        if (allPending.length > 0) {
          const matchedJobs: Job[] = []
          allPending.forEach(({ j, tbName, slot }) => {
            const match = currentDrivers.find(dr => dr.name.toLowerCase() === tbName.toLowerCase())
            if (match) matchedJobs.push({ ...j, [slot]: match.id })
          })
          if (matchedJobs.length > 0) {
            await db.batchUpsertJobs(matchedJobs)
            const byId = Object.fromEntries(matchedJobs.map(j => [j.id, j]))
            fetchedJobs = fetchedJobs.map(j => byId[j.id] || j)
          }
          const seen = new Set<string>()
          const queue: DriverMatchItem[] = []
          allPending.forEach(({ j, tbName, slot }) => {
            const key   = tbName + '|' + slot
            const match = currentDrivers.find(dr => dr.name.toLowerCase() === tbName.toLowerCase())
            if (!match && !seen.has(key)) {
              seen.add(key)
              queue.push({
                tbName, slot,
                callNums:  allPending.filter(p => p.tbName === tbName && p.slot === slot).map(p => p.j.tbCallNum || p.j.id),
                suggested: closestDriver(tbName, currentDrivers),
              })
            }
          })
          if (queue.length > 0) setDriverMatchQueue(queue)
        }
      }

      setJobs(fetchedJobs)
      setHpd(fetchedHpd)
      setStaffing(fetchedStaffing)

      if (fetchedDrivers.length > 0) {
        setDrivers(fetchedDrivers)
      } else {
        setDrivers(defaultDrivers)
        await Promise.all(defaultDrivers.map(d => db.upsertDriver(d)))
      }
      setLoaded(true)
    })()
  }, [])

  // ── Realtime ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const channel = sb.channel('jobs-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs' }, ({ new: row }: { new: Record<string, unknown> }) => {
        let job = jobToApp(row)
        if (!job.yardId) {
          job = { ...job, yardId: closestYard(job.pickupAddr, job.pickupZip).id }
          db.upsertJob(job)
        }
        setJobs(prev => prev.some(j => j.id === job.id) ? prev : [...prev, job])

        const pool = driversRef.current
        const jobUpdates: Partial<Job> = {}
        const toQueue: { tbName: string; slot: 'driverId' | 'driverId2' }[] = []
        for (const [tbName, slot] of [[job.tbDriver, 'driverId'], [job.tbDriver2, 'driverId2']] as [string | undefined, 'driverId' | 'driverId2'][]) {
          if (!tbName || job[slot]) continue
          const exact = pool.find(d => d.name.toLowerCase() === tbName.toLowerCase())
          if (exact) { jobUpdates[slot] = exact.id } else { toQueue.push({ tbName, slot }) }
        }
        if (Object.keys(jobUpdates).length > 0) {
          const updated = { ...job, ...jobUpdates }
          db.upsertJob(updated)
          setJobs(prev => prev.map(j => j.id === updated.id ? updated : j))
          job = updated
        }
        if (toQueue.length > 0) {
          setDriverMatchQueue(prev => {
            let next = [...prev]
            toQueue.forEach(({ tbName, slot }) => {
              if (!next.some(item => item.tbName === tbName && item.slot === slot)) {
                next.push({ tbName, slot, callNums: [job.tbCallNum || job.id], suggested: closestDriver(tbName, pool) })
              }
            })
            return next
          })
        }

        if (job.day === viewDayRef.current) {
          const dayJobs = [...jobsRef.current, job].filter(j => j.day === job.day && j.status !== 'cancelled')
          const { results } = findPossibleStacks(dayJobs, driversRef.current, stackRadiusRef.current)
          const newPairs = results.filter(m =>
            (m.a.id === job.id || m.b.id === job.id) &&
            !ignoredStacksRef.current.has(m.a.id + '|' + m.b.id)
          )
          if (newPairs.length > 0) {
            setNewStackQueue(prev => {
              const existingKeys = new Set(prev.map(m => m.a.id + '|' + m.b.id))
              return [...prev, ...newPairs.filter(m => !existingKeys.has(m.a.id + '|' + m.b.id))]
            })
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs' }, ({ new: row }: { new: Record<string, unknown> }) => {
        setJobs(prev => prev.map(j => j.id === row.id ? jobToApp(row) : j))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'jobs' }, (payload: { old?: Record<string, unknown> }) => {
        const id = payload.old?.id as string | undefined
        if (id) setJobs(prev => prev.filter(j => j.id !== id))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: 'key=eq.last_synced' }, ({ new: row }: { new?: Record<string, unknown> }) => {
        if (row?.value) setLastSynced(row.value as string)
      })
      .subscribe()
    return () => { sb.removeChannel(channel) }
  }, [])

  useEffect(() => LS.set('filter', [...reasonFilter]), [reasonFilter])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t) }, [])

  // ── Job operations ────────────────────────────────────────────────────────────

  const addJob = (did: number) => {
    if (!formYard || !formCalc) return
    const newJob: Job = {
      id: uid(), yardId: formYard.id, driverId: did || null,
      driverId2: null, pickupZip: fp, dropZip: fd, pickupAddr: '', dropAddr: '',
      pickupLat: null, pickupLon: null, dropLat: null, dropLon: null,
      tbCallNum: null, tbDesc: '', tbAccount: '', tbScheduled: null,
      tbReason: 'MANUAL', tbDriver: '', tbDriver2: '', tbTruck: '',
      priority: 'normal', status: 'scheduled',
      addedAt: new Date().toISOString(), day: viewDay, stops: [],
      notes: '', startedAt: null, completedAt: null, hasTolls: false,
    }
    setJobs(prev => [...prev, newJob])
    db.upsertJob(newJob)
    setFp(''); setFd(''); setShowForm(false)
  }

  const updJob = (id: string, upd: Partial<Job>) => {
    setJobs(prev => {
      const next    = prev.map(j => j.id === id ? { ...j, ...upd } : j)
      const updated = next.find(j => j.id === id)
      if (updated) db.upsertJob(updated)
      return next
    })
  }

  const rmJob = (id: string) => updJob(id, { status: 'cancelled' })

  // ── Driver operations ─────────────────────────────────────────────────────────

  const addDriver = (d: Driver) => { setDrivers(prev => { db.upsertDriver(d); return [...prev, d] }) }
  const updateDriver = (id: number, fields: Partial<Driver>) => {
    setDrivers(prev => {
      const next    = prev.map(x => x.id === id ? { ...x, ...fields } : x)
      const updated = next.find(x => x.id === id)
      if (updated) db.upsertDriver(updated)
      return next
    })
  }
  const removeDriver = (id: number) => { setDrivers(prev => { db.deleteDriver(id); return prev.filter(x => x.id !== id) }) }

  // ── Yard operations ───────────────────────────────────────────────────────────

  const addYard = (y: Yard) => {
    setYards(prev => { const next = [...prev, y]; YARDS.splice(0, YARDS.length, ...next); db.upsertYard(y); return next })
  }
  const updateYard = (id: string, fields: Partial<Yard>) => {
    setYards(prev => {
      const next    = prev.map(y => y.id === id ? { ...y, ...fields } : y)
      const updated = next.find(y => y.id === id)
      if (updated) db.upsertYard(updated)
      YARDS.splice(0, YARDS.length, ...next)
      return next
    })
  }
  const removeYard = (id: string) => {
    setYards(prev => { const next = prev.filter(y => y.id !== id); YARDS.splice(0, YARDS.length, ...next); db.deleteYard(id); return next })
  }

  // ── Sync trigger ──────────────────────────────────────────────────────────────

  const triggerSync = async () => {
    if (!ghRepo || !ghToken) { alert('Set your GitHub repo and token in Settings → TowBook Sync before triggering a manual sync.'); return }
    setSyncStatus('triggering')
    try {
      const [owner, repo] = ghRepo.trim().split('/')
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/workflows/sync-calls.yml/dispatches`,
        { method: 'POST', headers: { Authorization: `Bearer ${ghToken.trim()}`, Accept: 'application/vnd.github+json' }, body: JSON.stringify({ ref: 'main' }) }
      )
      if (res.status === 204) {
        setSyncStatus('ok'); setTimeout(() => setSyncStatus(null), 5000)
      } else {
        const body = await res.json().catch(() => ({}))
        setSyncStatus('error'); alert(`GitHub returned ${res.status}: ${(body as { message?: string }).message || 'unknown error'}`); setTimeout(() => setSyncStatus(null), 5000)
      }
    } catch (e) {
      setSyncStatus('error'); alert('Network error: ' + (e as Error).message); setTimeout(() => setSyncStatus(null), 5000)
    }
  }

  // ── CSV export ────────────────────────────────────────────────────────────────

  const exportCSV = (jobList: Job[], filename: string) => {
    const driverName = (id: number | null | undefined) => drivers.find(d => d.id === id)?.name || 'Unassigned'
    const rows = [['Date', 'Call#', 'Account', 'Description', 'Driver', 'Yard', 'Reason', 'Pickup', 'Drop', 'Est Hours', 'Status']]
    for (const j of jobList) {
      const est  = jobTotal(j)
      const yard = YARDS.find(y => y.id === j.yardId)?.short || ''
      rows.push([j.day, j.tbCallNum || '', j.tbAccount || '', j.tbDesc || '', driverName(j.driverId), yard, j.tbReason || '', j.pickupAddr || '', j.dropAddr || '', isFinite(est) ? est.toFixed(2) : '', j.status])
    }
    const csv  = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Settings ──────────────────────────────────────────────────────────────────

  const updateHpd = (n: number) => { setHpd(n); db.saveSetting('hpd', n) }
  const updateStaff = (day: string, n: number) => {
    setStaffing(prev => { const next = { ...prev, [day]: Math.max(0, Math.min(n, 50)) }; db.saveSetting('staffing', next); return next })
  }

  // ── Optimizer ─────────────────────────────────────────────────────────────────

  const runOptimizer = () => {
    const dayJobs = jobs.filter(j => j.day === viewDay && j.status !== 'cancelled')
    const driverStates = drivers.map(d => {
      const yard = YARDS.find(y => y.id === d.yard) || YARDS[0]
      if (!yard) return null
      return { driver: d, yard, jobs: [] as Job[], usedH: 0, curPos: crd(yard.addr, yard.zip) }
    }).filter(Boolean) as OptimizerState['driverStates']

    const jobHrs: Record<string, number> = {}
    for (const job of dayJobs) { const t = jobTotal(job); jobHrs[job.id] = (isFinite(t) && t > 0) ? t : 1 }

    let remaining = [...dayJobs]
    while (remaining.length > 0) {
      let bestDh = Infinity, bestDs: OptimizerState['driverStates'][0] | null = null, bestJob: Job | null = null
      for (const ds of driverStates) {
        if (ds.usedH >= 8) continue
        for (const job of remaining) {
          const jh = jobHrs[job.id]
          if (jh > 8 && ds.jobs.length > 0) continue
          const pc = crd(job.pickupAddr, job.pickupZip)
          if (!pc || !ds.curPos) continue
          const dh = dMi(ds.curPos, pc)
          if (dh < bestDh) { bestDh = dh; bestDs = ds; bestJob = job }
        }
      }
      if (!bestDs || !bestJob) break
      bestDs.jobs.push(bestJob)
      bestDs.usedH += jobHrs[bestJob.id]
      const dc = crd(bestJob.dropAddr, bestJob.dropZip)
      if (dc) bestDs.curPos = dc
      remaining = remaining.filter(j => j.id !== bestJob!.id)
    }

    setOptState({ driverStates, unassigned: remaining })
    setShowOptimizer(true)
  }

  const applyOptimizer = () => {
    if (!optState) return
    for (const ds of optState.driverStates) {
      for (const job of ds.jobs) {
        if (job.driverId !== ds.driver.id) updJob(job.id, { driverId: ds.driver.id })
      }
    }
    for (const job of optState.unassigned) {
      if (job.driverId) updJob(job.id, { driverId: null })
    }
    setShowOptimizer(false); setOptState(null)
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  const LOC_MAP: Record<string, string> = { '1': 'NETC', '2': "Matt Brown's", '3': "Ray's", '4': 'Interstate' }
  const locLabel = (cn: string | null | undefined) => { const s = (cn || '').replace(/^#/, ''); return LOC_MAP[s[0]] || null }

  const allReasons = useMemo(() => { const s = new Set<string>(); jobs.forEach(j => { if (j.tbReason) s.add(j.tbReason) }); return ['ALL', ...[...s].sort()] }, [jobs])

  const calDays = useMemo(() => {
    const base = new Set(genDays(21))
    jobs.forEach(j => { if (j.day) base.add(j.day) })
    return [...base].sort()
  }, [jobs])

  const calWeekEnd = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 6); return isoD(d) }, [])
  const visCalDays = useMemo(() => {
    if (calExpanded) return calDays
    return calDays.filter(iso => (iso >= todayISO() && iso <= calWeekEnd) || iso === viewDay)
  }, [calDays, calExpanded, calWeekEnd, viewDay])

  const filt = (arr: Job[]) => {
    let out = reasonFilter.has('ALL') ? arr : arr.filter(j => reasonFilter.has(j.tbReason || ''))
    if (!locationFilter.has('ALL')) out = out.filter(j => locationFilter.has(locLabel(j.tbCallNum) || ''))
    return out
  }

  const getStaff = (d: string) => staffing[d] != null ? staffing[d] : 8

  const formYard = useMemo(() => lz(fp) ? closestYard('', fp) : null, [fp])
  const formCalc = useMemo(() => { if (!formYard || !lz(fp) || !lz(fd)) return null; return jCalc(formYard.addr, formYard.zip, '', fp, '', fd, []) }, [formYard, fp, fd])

  const dayJobMap = useMemo(() => {
    const m: Record<string, Job[]> = {}
    jobs.forEach(j => { if (j.status !== 'cancelled') { const k = j.day || todayISO(); if (!m[k]) m[k] = []; m[k].push(j) } })
    return m
  }, [jobs])

  function daySt(iso: string) {
    const djAll    = dayJobMap[iso] || []
    const dj       = filt(djAll)
    const remaining = dj.filter(j => j.status !== 'complete')
    const totalH   = remaining.reduce((s, j) => s + jobTotal(j), 0)
    const staff    = getStaff(iso)
    const cap      = staff * hpd
    return { n: dj.length, totalH, staff, cap, pct: cap > 0 ? totalH / cap * 100 : 0,
      need: Math.ceil(totalH / hpd), assigned: remaining.filter(j => j.driverId).length,
      active: dj.filter(j => j.status === 'active').length,
      sched:  dj.filter(j => j.status === 'scheduled').length,
      done:   dj.filter(j => j.status === 'complete').length }
  }

  const vs    = daySt(viewDay)
  const vJobs = filt(dayJobMap[viewDay] || [])
  const vAct  = vJobs.filter(j => j.status === 'active')
  const vSch  = vJobs.filter(j => j.status === 'scheduled')
  const vDon  = vJobs.filter(j => j.status === 'complete')
  const vCan  = jobs.filter(j => j.day === viewDay && j.status === 'cancelled')
  const stCol = vs.pct >= 90 ? C.rd : vs.pct >= 75 ? C.am : C.gn

  const stacks = useMemo(() => {
    const raw = findPossibleStacks(vJobs, drivers, stackRadius)
    return { results: raw.results.filter(m => !ignoredStacks.has(m.a.id + '|' + m.b.id)), skipped: raw.skipped }
  }, [vJobs, drivers, ignoredStacks, stackRadius])

  const ignoreStack = (m: StackPair) => setIgnoredStacks(prev => { const next = new Set(prev); next.add(m.a.id + '|' + m.b.id); return next })

  const toggleReason = (r: string) => setReasonFilter(prev => {
    const next = new Set(prev)
    if (r === 'ALL') return new Set(['ALL'])
    next.delete('ALL')
    if (next.has(r)) next.delete(r); else next.add(r)
    return next.size === 0 ? new Set(['ALL']) : next
  })

  const toggleLocation = (loc: string) => setLocationFilter(prev => {
    const next = new Set(prev)
    if (loc === 'ALL') return new Set(['ALL'])
    next.delete('ALL')
    if (next.has(loc)) next.delete(loc); else next.add(loc)
    return next.size === 0 ? new Set(['ALL']) : next
  })

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (!loaded) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: C.dm, fontSize: 13 }}>Loading schedule…</div>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '12px 16px', maxWidth: 980, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, color: C.dm }}>NETC Transport</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Capacity Planner</div>
          {lastSynced && (() => {
            const diff  = Math.floor((now.getTime() - new Date(lastSynced).getTime()) / 60000)
            const label = diff < 1 ? 'just now' : diff === 1 ? '1 min ago' : diff + ' min ago'
            return <div style={{ fontSize: 9, color: C.dm }}>TowBook synced {label}</div>
          })()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{fT(now)}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {[['schedule', '📋 Schedule'], ['drivers', '👥 Drivers'], ['metrics', '📊 Metrics'], ['history', '🕓 History'], ['settings', '⚙ Settings']].map(([k, l]) => (
          <div key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</div>
        ))}
      </div>

      {/* Reason filter */}
      {tab === 'schedule' && allReasons.length > 1 && (
        <div className="fb">
          <span style={{ fontSize: 9, color: C.dm, fontWeight: 600, alignSelf: 'center', marginRight: 2 }}>JOB TYPE:</span>
          {allReasons.map(r => (
            <button key={r} className={'fbtn' + (reasonFilter.has(r) ? ' on' : '')} onClick={() => toggleReason(r)}>
              {r === 'ALL' ? 'All' : r} ({r === 'ALL' ? jobs.filter(j => j.status !== 'cancelled').length : jobs.filter(j => j.tbReason === r && j.status !== 'cancelled').length})
            </button>
          ))}
        </div>
      )}

      {/* Location filter */}
      {tab === 'schedule' && (
        <div className="fb">
          <span style={{ fontSize: 9, color: C.dm, fontWeight: 600, alignSelf: 'center', marginRight: 2 }}>LOCATION:</span>
          {['ALL', 'NETC', "Matt Brown's", "Ray's", 'Interstate'].map(loc => (
            <button key={loc} className={'fbtn' + (locationFilter.has(loc) ? ' on' : '')} onClick={() => toggleLocation(loc)}>
              {loc === 'ALL' ? 'All' : loc} ({loc === 'ALL' ? jobs.filter(j => j.status !== 'cancelled').length : jobs.filter(j => j.status !== 'cancelled' && locLabel(j.tbCallNum) === loc).length})
            </button>
          ))}
        </div>
      )}

      {/* Calendar strip */}
      {(tab === 'schedule' || tab === 'drivers') && (
        <div className="cal">
          {visCalDays.map(iso => {
            const st  = daySt(iso)
            const sel = iso === viewDay
            const col = st.n === 0 ? C.dm : st.pct >= 90 ? C.rd : st.pct >= 75 ? C.am : C.gn
            return (
              <div key={iso} className={'dc' + (sel ? ' sel' : '')} style={{ background: sel ? C.ad : C.cd }} onClick={() => setViewDay(iso)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: iso === todayISO() ? C.ac : C.tx }}>{dayNm(iso)}</div>
                    <div style={{ fontSize: 9, color: C.dm }}>{daySh(iso)}</div>
                  </div>
                  {st.n > 0 && <div style={{ fontSize: 15, fontWeight: 800, color: col }}>{st.n}</div>}
                </div>
                <div style={{ height: 3, background: C.sf, borderRadius: 2, overflow: 'hidden', marginBottom: 3 }}>
                  <div style={{ height: '100%', width: Math.min(st.pct, 100) + '%', background: col, borderRadius: 2 }} />
                </div>
                {st.n > 0
                  ? <div style={{ fontSize: 8, color: C.dm }}>{fD(st.totalH)} need {st.need}{st.need > st.staff && <span style={{ color: C.rd, fontWeight: 700 }}> -{st.need - st.staff}</span>}</div>
                  : <div style={{ fontSize: 8, color: C.dm }}>Empty</div>
                }
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 3 }} onClick={e => e.stopPropagation()}>
                  <button style={{ background: C.sf, border: '1px solid ' + C.bd, borderRadius: 3, color: C.tx, width: 14, height: 14, fontSize: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={e => { e.stopPropagation(); updateStaff(iso, getStaff(iso) - 1) }}>−</button>
                  <span style={{ fontSize: 10, fontWeight: 700, minWidth: 12, textAlign: 'center' }}>{st.staff}</span>
                  <button style={{ background: C.sf, border: '1px solid ' + C.bd, borderRadius: 3, color: C.tx, width: 14, height: 14, fontSize: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={e => { e.stopPropagation(); updateStaff(iso, getStaff(iso) + 1) }}>+</button>
                </div>
              </div>
            )
          })}
          <div
            onClick={() => setCalExpanded(v => !v)}
            style={{ minWidth: 36, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 8, border: '2px dashed ' + C.bd, color: C.dm, fontSize: 16, gap: 2, padding: '9px 6px' }}
            title={calExpanded ? 'Show less' : 'Show all dates'}
          >
            <span>{calExpanded ? '‹' : '›'}</span>
            <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{calExpanded ? 'Less' : 'More'}</span>
          </div>
        </div>
      )}

      {/* ══ SCHEDULE TAB ══ */}
      {tab === 'schedule' && <>
        <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2, marginBottom: 8 }}>{dayFull(viewDay)}</div>
        <div className="dash">
          <div className="dash-card" style={{ background: vs.n > 0 ? C.ad : C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase', marginBottom: 2 }}>Calls</div><div style={{ fontSize: 30, fontWeight: 800, color: C.ac }}>{vs.n}</div><div style={{ fontSize: 9, color: C.dm, marginTop: 2 }}>{vs.active}a · {vs.sched}s · {vs.done}d</div></div>
          <div className="dash-card" style={{ background: vs.totalH > 0 ? '#1a1a0d' : C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase', marginBottom: 2 }}>Hours</div><div style={{ fontSize: 30, fontWeight: 800, color: C.am }}>{fD(vs.totalH)}</div><div style={{ fontSize: 9, color: C.dm, marginTop: 2 }}>of {fD(vs.cap)}</div></div>
          <div className="dash-card" style={{ background: vs.need > vs.staff ? '#1a0d0d' : vs.n > 0 ? '#0d1a0d' : C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase', marginBottom: 2 }}>Need</div><div style={{ fontSize: 30, fontWeight: 800, color: vs.need > vs.staff ? C.rd : C.gn }}>{vs.need}</div><div style={{ fontSize: 9, color: vs.need > vs.staff ? C.rd : C.dm, fontWeight: vs.need > vs.staff ? 700 : 400, marginTop: 2 }}>{vs.need > vs.staff ? 'SHORT ' + (vs.need - vs.staff) : vs.staff + ' staffed'}</div></div>
          <div className="dash-card" style={{ background: C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase', marginBottom: 2 }}>Assigned</div><div style={{ fontSize: 30, fontWeight: 800, color: vs.assigned ? C.pu : C.dm }}>{vs.assigned}</div><div style={{ fontSize: 9, color: C.dm, marginTop: 2 }}>of {vs.n}</div></div>
        </div>

        {vs.n > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ height: 6, background: C.sf, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: Math.min(vs.pct, 100) + '%', background: stCol, borderRadius: 3 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.dm, marginTop: 2 }}>
              <span>{fD(vs.totalH)} committed</span>
              <span style={{ color: stCol }}>{fD(Math.max(vs.cap - vs.totalH, 0))} available</span>
            </div>
          </div>
        )}

        {syncStatus === 'ok'         && <div style={{ ...cB, background: C.gb, borderColor: C.gn, marginBottom: 6, fontSize: 11, color: C.gn, padding: '8px 12px' }}>✓ Sync triggered — new jobs will appear within 2 minutes.</div>}
        {syncStatus === 'triggering' && <div style={{ ...cB, background: C.ab, borderColor: C.am, marginBottom: 6, fontSize: 11, color: C.am, padding: '8px 12px' }}>Triggering sync…</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <button style={{ ...bSt, color: C.pu, borderColor: C.pu, opacity: syncStatus === 'triggering' ? 0.5 : 1 }} onClick={triggerSync} disabled={syncStatus === 'triggering'}>🔄 Sync TowBook</button>
          <div style={{ display: 'flex', gap: 6 }}>
            {vJobs.length > 0 && <button style={{ ...bSt, color: C.gn, borderColor: C.gn }} onClick={() => exportCSV(vJobs, 'schedule-' + viewDay + '.csv')}>⬇ CSV</button>}
            {vJobs.length > 0 && <button style={{ ...bSt, color: C.am, borderColor: C.am }} onClick={() => setShowStacking(true)}>🔗 Possible Stacking ({stacks.results.length})</button>}
            <button style={bP} onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ Add Job'}</button>
          </div>
        </div>

        {showForm && (
          <div style={{ ...cB, background: C.ca, borderColor: C.ac }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.ac, marginBottom: 4 }}>NEW JOB - {dayFull(viewDay)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 5 }}>
              <div>
                <div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>PICKUP ZIP</div>
                <input style={iS} placeholder="04101" maxLength={5} value={fp} onChange={e => setFp(e.target.value.replace(/\D/g, ''))} />
                {fp.length >= 3 && lz(fp) && <div style={{ fontSize: 8, color: C.dm }}>{lz(fp)!.label}</div>}
              </div>
              <div>
                <div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>DROP ZIP</div>
                <input style={iS} placeholder="03101" maxLength={5} value={fd} onChange={e => setFd(e.target.value.replace(/\D/g, ''))} />
                {fd.length >= 3 && lz(fd) && <div style={{ fontSize: 8, color: C.dm }}>{lz(fd)!.label}</div>}
              </div>
            </div>
            {formCalc && <div style={{ background: C.sf, borderRadius: 5, padding: 7, marginBottom: 5, fontSize: 12, fontWeight: 700, color: C.wh }}>Total: {fH(formCalc.total)} · {fMi(formCalc.m1 + formCalc.m2 + formCalc.m3)}</div>}
            <div style={{ display: 'flex', gap: 4 }}>
              <select style={{ ...sS, flex: 1 }} value="" onChange={e => { if (e.target.value) addJob(parseInt(e.target.value)) }}>
                <option value="">With driver…</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{dLb(d)}</option>)}
              </select>
              <button style={{ ...bP, opacity: formCalc ? 1 : 0.4 }} onClick={() => addJob(0)}>Unassigned</button>
            </div>
          </div>
        )}

        {vAct.length > 0 && <div style={{ fontSize: 9, fontWeight: 700, color: C.am, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3, animation: 'pulse 2s infinite' }}>Active ({vAct.length})</div>}
        {vAct.map(j => <JobCard key={j.id} job={j} drivers={drivers} onUpdate={u => updJob(j.id, u)} onRemove={() => rmJob(j.id)} onDayChange={setViewDay} />)}
        {vSch.length > 0 && <div style={{ fontSize: 9, fontWeight: 700, color: C.ac, textTransform: 'uppercase', letterSpacing: 1, marginTop: vAct.length ? 5 : 0, marginBottom: 3 }}>Scheduled ({vSch.length})</div>}
        {vSch.map(j => <JobCard key={j.id} job={j} drivers={drivers} onUpdate={u => updJob(j.id, u)} onRemove={() => rmJob(j.id)} onDayChange={setViewDay} />)}
        {vDon.length > 0 && <div style={{ fontSize: 9, fontWeight: 700, color: C.gn, textTransform: 'uppercase', letterSpacing: 1, marginTop: 5, marginBottom: 3 }}>Done ({vDon.length})</div>}
        {vDon.map(j => <JobCard key={j.id} job={j} drivers={drivers} onUpdate={u => updJob(j.id, u)} onRemove={() => rmJob(j.id)} onDayChange={setViewDay} />)}
        {vJobs.length === 0 && !showForm && (
          <div style={{ ...cB, textAlign: 'center', padding: 20, color: C.dm, fontSize: 11 }}>
            {!reasonFilter.has('ALL') ? 'No ' + [...reasonFilter].join(', ') + ' jobs' : 'No jobs'} for {dayFull(viewDay).toLowerCase()}
          </div>
        )}
        {vCan.length > 0 && <div style={{ fontSize: 9, fontWeight: 700, color: '#7f1d1d', textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 3 }}>Cancelled ({vCan.length})</div>}
        {vCan.map(j => <JobCard key={j.id} job={j} drivers={drivers} onUpdate={u => updJob(j.id, u)} onRemove={() => {}} onDayChange={setViewDay} />)}
      </>}

      {tab === 'drivers'  && <DriversTab jobs={jobs.filter(j => j.status !== 'cancelled')} drivers={drivers} viewDay={viewDay} hpd={hpd} onExportCSV={exportCSV} />}
      {tab === 'metrics'  && <MetricsTab jobs={jobs} drivers={drivers} viewDay={viewDay} hpd={hpd} staffing={staffing} locLabel={locLabel} />}
      {tab === 'history'  && <HistoryTab jobs={jobs} drivers={drivers} />}
      {tab === 'settings' && <SettingsTab
        yards={yards} onAddYard={addYard} onUpdateYard={updateYard} onDeleteYard={removeYard}
        newYard={newYard} setNewYard={setNewYard}
        drivers={drivers} onAddDriver={addDriver} onUpdateDriver={updateDriver} onDeleteDriver={removeDriver}
        hpd={hpd} onSetHpd={updateHpd} newDr={newDr} setNewDr={setNewDr}
        driverFunctions={DRIVER_FUNCTIONS}
        ghRepo={ghRepo} ghToken={ghToken}
        onSaveGH={(key, val) => {
          if (key === 'github_repo') setGhRepo(val)
          if (key === 'github_token') setGhToken(val)
          db.saveSetting(key, val)
        }}
      />}

      <div style={{ marginTop: 12, padding: '5px 0', borderTop: '1px solid ' + C.bd, fontSize: 8, color: C.dm, display: 'flex', justifyContent: 'space-between' }}>
        <span>Truck calibrated 1.25× road · 45 mph · +1h load · Shared via Supabase</span>
        <span>v4.0</span>
      </div>

      {driverMatchQueue.length > 0 && (
        <DriverMatchModal
          item={driverMatchQueue[0]}
          drivers={drivers}
          onAssign={async (driver, callNums) => {
            const slot     = driverMatchQueue[0]?.slot || 'driverId'
            const affected = jobs.filter(j => callNums.includes(j.tbCallNum || j.id) && !j[slot])
            const updated  = affected.map(j => ({ ...j, [slot]: driver.id }))
            await db.batchUpsertJobs(updated)
            const byId = Object.fromEntries(updated.map(j => [j.id, j]))
            setJobs(prev => prev.map(j => byId[j.id] || j))
            setDriverMatchQueue(prev => prev.slice(1))
          }}
          onCreateNew={async (tbName, callNums) => {
            const slot   = driverMatchQueue[0]?.slot || 'driverId'
            const newId  = Math.max(0, ...drivers.map(d => d.id)) + 1
            const newDrv: Driver = { id: newId, name: tbName, truck: '', yard: YARDS[0]?.id || '', func: '' }
            await db.upsertDriver(newDrv)
            setDrivers(prev => [...prev, newDrv])
            const affected = jobs.filter(j => callNums.includes(j.tbCallNum || j.id) && !j[slot])
            const updated  = affected.map(j => ({ ...j, [slot]: newId }))
            await db.batchUpsertJobs(updated)
            const byId = Object.fromEntries(updated.map(j => [j.id, j]))
            setJobs(prev => prev.map(j => byId[j.id] || j))
            setDriverMatchQueue(prev => prev.slice(1))
          }}
        />
      )}

      {showOptimizer && optState && (
        <OptimizerModal
          state={optState} drivers={drivers}
          onUpdate={setOptState as (u: (prev: OptimizerState) => OptimizerState) => void}
          onApply={applyOptimizer}
          onClose={() => { setShowOptimizer(false); setOptState(null) }}
        />
      )}

      {showStacking && <PossibleStackingModal data={stacks} radius={stackRadius} onRadiusChange={setStackRadius} onClose={() => setShowStacking(false)} onIgnore={ignoreStack} />}

      {newStackQueue.length > 0 && !driverMatchQueue.length && (
        <NewStackModal
          queue={newStackQueue}
          onDismiss={() => setNewStackQueue(prev => prev.slice(1))}
          onIgnore={() => {
            const m = newStackQueue[0]
            setIgnoredStacks(prev => { const n = new Set(prev); n.add(m.a.id + '|' + m.b.id); return n })
            setNewStackQueue(prev => prev.slice(1))
          }}
        />
      )}
    </div>
  )
}
