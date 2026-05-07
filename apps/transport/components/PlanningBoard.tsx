'use client'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { C, bSt, bP, sS, iS, cB, YARDS } from '../lib/config'
import { fH, todayISO, jobTotal } from '../lib/utils'
import { db } from '../lib/db'
import { cityFrom, lz } from '../lib/geo'
import type { Job, Driver } from '../lib/types'

// ── Timeline constants ────────────────────────────────────────────────────────

const START_H   = 6            // 6 AM
const END_H     = 22           // 10 PM
const TOTAL_H   = END_H - START_H   // 16 hours
const TOTAL_MIN = TOTAL_H * 60
const NAME_W    = 164          // driver name column px
const ROW_H     = 64           // driver row height px

// ── Driver function normalisation ─────────────────────────────────────────────

const FUNC_ALIASES: Record<string, string> = {
  'HDT': 'Heavy Duty Tow',
  'LDT': 'Light Duty Tow',
}
const EXCLUDED_FUNCS = new Set(['Dispatch', 'Office Manager'])
function normalizeFunc(f: string) { return FUNC_ALIASES[f] ?? f }

const CANONICAL_JOB_TYPES = ['Equipment Transport', 'Heavy Duty Tow', 'Light Duty Tow', 'Road Service', 'Crane Service']

function toggleFilter(prev: Set<string>, val: string): Set<string> {
  if (val === 'ALL') return new Set(['ALL'])
  const next = new Set(prev)
  next.delete('ALL')
  if (next.has(val)) next.delete(val); else next.add(val)
  return next.size === 0 ? new Set(['ALL']) : next
}

function filterBtn(active: boolean) {
  return {
    padding: '3px 8px',
    fontSize: 10,
    fontWeight: 600 as const,
    background: active ? '#1d3461' : C.sf,
    border: '1px solid ' + (active ? C.ac : C.bd),
    color: active ? C.ac : C.dm,
    borderRadius: 4,
    cursor: 'pointer' as const,
    whiteSpace: 'nowrap' as const,
  }
}

// ── Job-type colours ──────────────────────────────────────────────────────────

const JT_COLOR: Record<string, string> = {
  'Equipment Transport': '#3b82f6',
  'Heavy Duty Tow':      '#f59e0b',
  'Light Duty Tow':      '#22c55e',
  'Road Service':        '#a78bfa',
  'Crane Service':       '#ef4444',
}
function jobColor(j: Job) { return JT_COLOR[j.jobType ?? ''] ?? '#64748b' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function minToPct(min: number): number {
  return Math.max(0, Math.min(100, (min - START_H * 60) / TOTAL_MIN * 100))
}

function parseSchedMin(sched: string | null | undefined): number | null {
  if (!sched) return null
  const m = sched.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!m) return null
  let h = parseInt(m[1])
  const mn = parseInt(m[2])
  const ap = m[3].toUpperCase()
  if (ap === 'PM' && h < 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + mn
}

function cityLabel(addr?: string | null, zip?: string | null): string {
  if (addr) { const c = cityFrom(addr); if (c) return c }
  const z = lz(zip)
  return z ? z.label.split(',')[0].trim() : '?'
}

function fmtHour(h: number) {
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

function fmtMin(min: number): string {
  const h   = Math.floor(min / 60)
  const m   = min % 60
  const ap  = h < 12 ? 'AM' : 'PM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${ap}`
}

// ── Layout computation ────────────────────────────────────────────────────────

interface Layout { job: Job; startMin: number; durationMin: number }

function buildLayout(
  jobs: Job[],
  orderMap: Record<string, number>,
  startOverrides: Record<string, number>,
): Layout[] {
  if (!jobs.length) return []
  const sorted = [...jobs].sort((a, b) => (orderMap[a.id] ?? 999) - (orderMap[b.id] ?? 999))
  const out: Layout[] = []
  let cursor = START_H * 60
  for (let i = 0; i < sorted.length; i++) {
    const j   = sorted[i]
    const raw = jobTotal(j)
    const dur = Math.max(0.25, isFinite(raw) ? raw : 1)
    const override = startOverrides[j.id]
    if (override != null) {
      out.push({ job: j, startMin: override, durationMin: dur * 60 })
      cursor = override + dur * 60
    } else {
      if (i === 0) {
        const s = parseSchedMin(j.tbScheduled)
        if (s != null && s >= START_H * 60 && s <= END_H * 60) cursor = s
      }
      out.push({ job: j, startMin: cursor, durationMin: dur * 60 })
      cursor += dur * 60
    }
  }
  return out
}

// ── Persisted state shape ─────────────────────────────────────────────────────

interface DayState {
  order:          Record<string, number>
  hidden:         number[]
  startOverrides: Record<string, number>
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  jobs:           Job[]
  drivers:        Driver[]
  onJobUpdate:    (id: string, upd: Partial<Job>) => void
  onSyncTowBook:  () => void
  syncStatus:     null | 'triggering' | 'ok' | 'error'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PlanningBoard({ jobs, drivers, onJobUpdate, onSyncTowBook, syncStatus }: Props) {
  const [viewDay,        setViewDay]        = useState(todayISO)
  const [order,          setOrder]          = useState<Record<string, number>>({})
  const [hidden,         setHidden]         = useState<number[]>([])
  const [startOverrides, setStartOverrides] = useState<Record<string, number>>({})
  const [timeDrag,       setTimeDrag]       = useState<{
    jobId: string; origStartMin: number; pointerOrigX: number; previewMin: number
  } | null>(null)
  const [yardFilt,    setYardFilt]    = useState<Set<string>>(() => new Set(['ALL']))
  const [funcFilt,    setFuncFilt]    = useState<Set<string>>(() => new Set(['ALL']))
  const [jobTypeFilt, setJobTypeFilt] = useState<Set<string>>(() => new Set(['ALL']))
  const [dragJobId,   setDragJobId]   = useState<string | null>(null)
  const [dragFrom,    setDragFrom]    = useState<number | 'pool' | null>(null)
  const [showAdd,     setShowAdd]     = useState(false)
  const ganttRef = useRef<HTMLDivElement>(null)

  // ── Load / save day state ──────────────────────────────────────────────────

  useEffect(() => {
    db.loadSetting<DayState>(`planning_${viewDay}`, { order: {}, hidden: [], startOverrides: {} }).then(s => {
      setOrder(s?.order          ?? {})
      setHidden(s?.hidden        ?? [])
      setStartOverrides(s?.startOverrides ?? {})
    })
  }, [viewDay])

  const persist = useCallback((
    o: Record<string, number>,
    h: number[],
    s: Record<string, number>,
  ) => {
    db.saveSetting(`planning_${viewDay}`, { order: o, hidden: h, startOverrides: s })
  }, [viewDay])

  // ── Derived data ───────────────────────────────────────────────────────────

  const dayJobs = useMemo(() =>
    jobs.filter(j => j.day === viewDay && j.status !== 'cancelled'),
    [jobs, viewDay])

  const unassigned = useMemo(() =>
    dayJobs.filter(j => !j.driverId),
    [dayJobs])

  const assignedByDriver = useMemo(() => {
    const m: Record<number, Job[]> = {}
    dayJobs.filter(j => j.driverId).forEach(j => {
      const d = j.driverId!;
      (m[d] ??= []).push(j)
    })
    return m
  }, [dayJobs])

  const allYards = useMemo(() =>
    [...new Set(drivers.map(d => d.yard).filter(Boolean))].sort(),
    [drivers])

  const allFuncs = useMemo(() =>
    [...new Set(
      drivers.map(d => normalizeFunc(d.func)).filter(f => f && !EXCLUDED_FUNCS.has(f))
    )].sort(),
    [drivers])

  const visibleDrivers = useMemo(() =>
    drivers.filter(d =>
      !hidden.includes(d.id) &&
      !EXCLUDED_FUNCS.has(d.func) &&
      (yardFilt.has('ALL') || yardFilt.has(d.yard)) &&
      (funcFilt.has('ALL') || funcFilt.has(normalizeFunc(d.func)))
    ),
    [drivers, hidden, yardFilt, funcFilt])

  const hiddenDriversList = useMemo(() =>
    drivers.filter(d => hidden.includes(d.id)),
    [drivers, hidden])

  const filteredUnassigned = useMemo(() =>
    unassigned.filter(j => jobTypeFilt.has('ALL') || jobTypeFilt.has(j.jobType ?? '')),
    [unassigned, jobTypeFilt])

  const driverTotalHours = useMemo(() => {
    const m: Record<number, number> = {}
    Object.entries(assignedByDriver).forEach(([dId, djobs]) => {
      m[Number(dId)] = djobs.reduce((s, j) => { const t = jobTotal(j); return s + (isFinite(t) ? t : 0) }, 0)
    })
    return m
  }, [assignedByDriver])

  // ── Day navigation ─────────────────────────────────────────────────────────

  const shiftDay = (n: number) => {
    const d = new Date(viewDay + 'T00:00:00')
    d.setDate(d.getDate() + n)
    setViewDay(d.toISOString().slice(0, 10))
  }

  const fmtViewDay = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    })

  // ── Assignment operations ──────────────────────────────────────────────────

  const assign = useCallback((jobId: string, driverId: number) => {
    const existing = assignedByDriver[driverId] ?? []
    const newOrder = { ...order, [jobId]: existing.length }
    setOrder(newOrder)
    onJobUpdate(jobId, { driverId })
    persist(newOrder, hidden, startOverrides)
  }, [assignedByDriver, order, hidden, startOverrides, onJobUpdate, persist])

  const unassign = useCallback((jobId: string) => {
    const newOrder    = { ...order }; delete newOrder[jobId]
    const newOverrides = { ...startOverrides }; delete newOverrides[jobId]
    setOrder(newOrder)
    setStartOverrides(newOverrides)
    onJobUpdate(jobId, { driverId: null })
    persist(newOrder, hidden, newOverrides)
  }, [order, hidden, startOverrides, onJobUpdate, persist])

  const reassign = useCallback((jobId: string, toDriver: number) => {
    const existing  = assignedByDriver[toDriver] ?? []
    const newOrder  = { ...order, [jobId]: existing.length }
    const newOverrides = { ...startOverrides }; delete newOverrides[jobId]
    setOrder(newOrder)
    setStartOverrides(newOverrides)
    onJobUpdate(jobId, { driverId: toDriver })
    persist(newOrder, hidden, newOverrides)
  }, [assignedByDriver, order, hidden, startOverrides, onJobUpdate, persist])

  const moveInRow = (jobId: string, driverId: number, dir: -1 | 1) => {
    const row     = [...(assignedByDriver[driverId] ?? [])].sort((a, b) => (order[a.id] ?? 0) - (order[b.id] ?? 0))
    const idx     = row.findIndex(j => j.id === jobId)
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= row.length) return
    const swap     = row[swapIdx]
    const newOrder = { ...order, [jobId]: order[swap.id] ?? swapIdx, [swap.id]: order[jobId] ?? idx }
    setOrder(newOrder)
    persist(newOrder, hidden, startOverrides)
  }

  // ── Driver hide / show ────────────────────────────────────────────────────

  const hideDriver = (driverId: number) => {
    const next = [...hidden, driverId]; setHidden(next); persist(order, next, startOverrides)
  }
  const showDriver = (driverId: number) => {
    const next = hidden.filter(id => id !== driverId); setHidden(next); persist(order, next, startOverrides)
  }

  // ── Cross-row drag (HTML5 DnD) ────────────────────────────────────────────

  const handleDragStart = (jobId: string, from: number | 'pool') =>
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      setDragJobId(jobId); setDragFrom(from)
    }
  const handleDragEnd  = () => { setDragJobId(null); setDragFrom(null) }
  const handleDragOver = (e: React.DragEvent) => e.preventDefault()

  const handleDropOnDriver = (driverId: number) => (e: React.DragEvent) => {
    e.preventDefault()
    if (!dragJobId) return
    if (dragFrom === 'pool') assign(dragJobId, driverId)
    else if (typeof dragFrom === 'number' && dragFrom !== driverId) reassign(dragJobId, driverId)
    setDragJobId(null); setDragFrom(null)
  }
  const handleDropOnPool = (e: React.DragEvent) => {
    e.preventDefault()
    if (!dragJobId || dragFrom === 'pool') return
    unassign(dragJobId); setDragJobId(null); setDragFrom(null)
  }

  // ── Track width helper (for pointer-drag time maths) ─────────────────────

  const getTrackWidth = () => {
    const w = ganttRef.current?.getBoundingClientRect().width
    return w ? Math.max(1, w - NAME_W) : TOTAL_H * 70
  }

  // ── Hours array for header ─────────────────────────────────────────────────

  const hours = Array.from({ length: TOTAL_H }, (_, i) => fmtHour(START_H + i))

  // ── Render ─────────────────────────────────────────────────────────────────

  const dragging = dragJobId !== null

  return (
    <div>

      {/* ── Controls ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 10 }}>

        {/* Row 1: Day nav + stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button style={bSt} onClick={() => shiftDay(-1)}>←</button>
            <input
              type="date"
              style={{ ...iS, fontSize: 11, padding: '3px 8px', width: 130 }}
              value={viewDay}
              onChange={e => setViewDay(e.target.value)}
            />
            <button style={bSt} onClick={() => shiftDay(1)}>→</button>
            <span style={{ fontSize: 11, color: C.dm, marginLeft: 2 }}>{fmtViewDay(viewDay)}</span>
          </div>
          {hiddenDriversList.length > 0 && (
            <button style={{ ...bSt, fontSize: 9, color: C.ac, borderColor: C.ac }} onClick={() => setShowAdd(v => !v)}>
              + Add Driver ({hiddenDriversList.length} hidden)
            </button>
          )}
          <span style={{ fontSize: 9, color: C.dm, marginLeft: 'auto' }}>
            {dayJobs.length} jobs · {unassigned.length} unassigned
          </span>
        </div>

        {/* Row 2: Driver yard filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, color: C.dm, fontWeight: 600, alignSelf: 'center', minWidth: 80 }}>DRIVER YARD:</span>
          {['ALL', ...allYards].map(y => (
            <button key={y} style={filterBtn(yardFilt.has(y))} onClick={() => setYardFilt(prev => toggleFilter(prev, y))}>
              {y === 'ALL' ? 'All Yards' : (YARDS.find(yd => yd.id === y)?.short ?? y)}
            </button>
          ))}
        </div>

        {/* Row 3: Driver function filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, color: C.dm, fontWeight: 600, alignSelf: 'center', minWidth: 80 }}>DRIVER FUNCTION:</span>
          {['ALL', ...allFuncs].map(f => (
            <button key={f} style={filterBtn(funcFilt.has(f))} onClick={() => setFuncFilt(prev => toggleFilter(prev, f))}>
              {f === 'ALL' ? 'All Functions' : f}
            </button>
          ))}
        </div>

        {/* Row 4: Job type filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, color: C.dm, fontWeight: 600, alignSelf: 'center', minWidth: 62 }}>JOB TYPE:</span>
          {(['ALL', ...CANONICAL_JOB_TYPES] as string[]).map(t => {
            const count = t === 'ALL' ? unassigned.length : unassigned.filter(j => j.jobType === t).length
            return (
              <button key={t} style={filterBtn(jobTypeFilt.has(t))} onClick={() => setJobTypeFilt(prev => toggleFilter(prev, t))}>
                {t === 'ALL' ? 'All Types' : t} ({count})
              </button>
            )
          })}
        </div>

      </div>

      {/* ── Hidden driver restore panel ──────────────────────────────── */}
      {showAdd && hiddenDriversList.length > 0 && (
        <div style={{ marginBottom: 10, padding: 8, background: C.sf, borderRadius: 6, border: '1px solid ' + C.bd }}>
          <div style={{ fontSize: 9, color: C.dm, fontWeight: 600, marginBottom: 6 }}>HIDDEN DRIVERS — click to restore for this day</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {hiddenDriversList.map(d => (
              <button key={d.id} style={{ ...bSt, fontSize: 10, color: C.tx }} onClick={() => showDriver(d.id)}>
                {d.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Sync button ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        {syncStatus === 'ok'         && <div style={{ ...cB, background: C.gb, borderColor: C.gn, marginBottom: 6, fontSize: 11, color: C.gn, padding: '8px 12px' }}>✓ Sync triggered — new jobs will appear within 2 minutes.</div>}
        {syncStatus === 'triggering' && <div style={{ ...cB, background: C.ab, borderColor: C.am, marginBottom: 6, fontSize: 11, color: C.am, padding: '8px 12px' }}>Triggering sync…</div>}
        <button
          style={{ ...bSt, color: C.pu, borderColor: C.pu, opacity: syncStatus === 'triggering' ? 0.5 : 1 }}
          onClick={onSyncTowBook}
          disabled={syncStatus === 'triggering'}
        >
          🔄 Sync TowBook
        </button>
      </div>

      {/* ── Unassigned pool ──────────────────────────────────────────── */}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDropOnPool}
        style={{
          marginBottom: 12, padding: '8px 8px 6px',
          background: C.sf, borderRadius: 6,
          border: '1px solid ' + (dragging && dragFrom !== 'pool' ? C.ac : C.bd),
          transition: 'border-color 0.15s', minHeight: 72,
        }}
      >
        <div style={{ fontSize: 9, color: C.dm, fontWeight: 600, marginBottom: 6 }}>
          UNASSIGNED — {filteredUnassigned.length}{filteredUnassigned.length !== unassigned.length ? ` of ${unassigned.length}` : ''} JOB{unassigned.length !== 1 ? 'S' : ''}
          {dragging && dragFrom !== 'pool' && <span style={{ color: C.ac, marginLeft: 8, fontWeight: 400 }}>drop here to unassign</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {filteredUnassigned.map(j => {
            const dur = jobTotal(j)
            const col = jobColor(j)
            return (
              <div
                key={j.id}
                draggable
                onDragStart={handleDragStart(j.id, 'pool')}
                onDragEnd={handleDragEnd}
                style={{
                  ...cB, flexShrink: 0, width: 148, padding: '7px 9px', marginBottom: 0,
                  borderLeft: '3px solid ' + col, cursor: 'grab',
                  opacity: dragJobId === j.id ? 0.4 : 1, userSelect: 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: j.tbScheduled ? 2 : 3 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.pu }}>{j.tbCallNum || '—'}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: col }}>{isFinite(dur) ? fH(dur) : '--'}</span>
                </div>
                {j.tbScheduled && (
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.ac, marginBottom: 2 }}>
                    🕐 {j.tbScheduled}
                  </div>
                )}
                {j.tbAccount && (
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.tx, marginBottom: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {j.tbAccount}
                  </div>
                )}
                <div style={{ fontSize: 9, color: C.dm }}>
                  {cityLabel(j.pickupAddr, j.pickupZip)} → {cityLabel(j.dropAddr, j.dropZip)}
                </div>
                {j.jobType && <div style={{ fontSize: 8, color: col, marginTop: 2, fontWeight: 600 }}>{j.jobType}</div>}
              </div>
            )
          })}
          {filteredUnassigned.length === 0 && (
            <span style={{ fontSize: 10, color: C.dm, alignSelf: 'center', padding: '0 4px' }}>
              {unassigned.length === 0 ? 'All jobs assigned for this day' : 'No unassigned jobs match the current filter'}
            </span>
          )}
        </div>
      </div>

      {/* ── Gantt grid ───────────────────────────────────────────────── */}
      <div ref={ganttRef} style={{ borderRadius: 6, border: '1px solid ' + C.bd }}>

        {/* Timeline header */}
        <div style={{ display: 'flex', background: C.sf, borderBottom: '2px solid ' + C.bd }}>
          <div style={{
            width: NAME_W, flexShrink: 0, padding: '4px 8px',
            fontSize: 8, fontWeight: 700, color: C.dm, letterSpacing: 1,
            borderRight: '1px solid ' + C.bd, display: 'flex', alignItems: 'center',
          }}>
            DRIVER
          </div>
          {hours.map((h, i) => (
            <div key={i} style={{
              flex: 1, textAlign: 'center',
              fontSize: 12, fontWeight: 600, color: C.tx,
              padding: '5px 0', borderLeft: '1px solid ' + C.bd,
            }}>
              {h}
            </div>
          ))}
        </div>

        {/* No drivers message */}
        {visibleDrivers.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: C.dm }}>
            No drivers match the current filters.
          </div>
        )}

        {/* Driver rows */}
        {visibleDrivers.map(driver => {
          const driverJobs = assignedByDriver[driver.id] ?? []
          const layout     = buildLayout(driverJobs, order, startOverrides)
          const isTarget   = dragging && dragFrom !== driver.id
          const totalH     = driverTotalHours[driver.id] ?? 0
          const overCap    = totalH > 8

          return (
            <div key={driver.id} style={{ display: 'flex', borderBottom: '1px solid ' + C.bd }}>

              {/* Driver name cell */}
              <div style={{
                width: NAME_W, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 8px', background: C.cd, borderRight: '1px solid ' + C.bd, height: ROW_H,
              }}>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.tx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {driver.name}
                  </div>
                  <div style={{ fontSize: 8, color: C.dm }}>
                    {[driver.func, driver.yard].filter(Boolean).join(' · ')}
                  </div>
                  {totalH > 0 && (
                    <div style={{ fontSize: 9, fontWeight: 700, color: overCap ? C.rd : C.gn, marginTop: 1 }}>
                      {fH(totalH)}{overCap ? ' ⚠ over' : ''}
                    </div>
                  )}
                </div>
                <button
                  style={{ ...bSt, padding: '1px 5px', fontSize: 9, flexShrink: 0, marginLeft: 4 }}
                  title="Hide this driver for today"
                  onClick={() => hideDriver(driver.id)}
                >✕</button>
              </div>

              {/* Timeline track */}
              <div
                onDragOver={handleDragOver}
                onDrop={handleDropOnDriver(driver.id)}
                style={{
                  position: 'relative', flex: 1, height: ROW_H,
                  background: isTarget ? 'rgba(59,130,246,0.05)' : 'transparent',
                  transition: 'background 0.1s',
                }}
              >
                {/* Hour grid lines */}
                {hours.map((_, i) => (
                  <div key={i} style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: `${i / TOTAL_H * 100}%`,
                    width: 1, background: C.bd, opacity: 0.4,
                  }} />
                ))}

                {/* Job bars */}
                {layout.map(({ job: j, startMin, durationMin }, idx) => {
                  const activeStart = timeDrag?.jobId === j.id ? timeDrag.previewMin : startMin
                  const leftPct     = minToPct(activeStart)
                  const widthPct    = Math.max(0.4, durationMin / TOTAL_MIN * 100)
                  const col         = jobColor(j)
                  const dur         = jobTotal(j)
                  const pu          = cityLabel(j.pickupAddr, j.pickupZip)
                  const dr          = cityLabel(j.dropAddr,   j.dropZip)
                  const canL        = idx > 0
                  const canR        = idx < layout.length - 1
                  const isDragging  = timeDrag?.jobId === j.id
                  const estPx       = widthPct / 100 * Math.max(300, (ganttRef.current?.getBoundingClientRect().width ?? 900) - NAME_W)
                  const wide        = estPx > 120
                  const mid         = estPx > 55 && !wide

                  return (
                    <div
                      key={j.id}
                      draggable
                      onDragStart={e => {
                        if ((e.target as HTMLElement).closest('[data-time-handle]')) { e.preventDefault(); return }
                        handleDragStart(j.id, driver.id)(e)
                      }}
                      onDragEnd={handleDragEnd}
                      title={`${j.tbAccount || j.tbCallNum} · ${pu} → ${dr} · ${isFinite(dur) ? fH(dur) : '--'}`}
                      style={{
                        position: 'absolute',
                        top: 6, height: ROW_H - 12,
                        left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 8,
                        background: col + '28',
                        border: '1px solid ' + col,
                        borderLeft: 'none',
                        borderRadius: 4,
                        overflow: 'visible',
                        cursor: 'grab',
                        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                        padding: '3px 4px 2px 16px',
                        boxSizing: 'border-box',
                        opacity: dragJobId === j.id ? 0.35 : 1,
                        userSelect: 'none',
                        zIndex: isDragging ? 10 : 1,
                      }}
                    >
                      {/* Time drag handle — left edge strip */}
                      <div
                        data-time-handle="true"
                        title="Drag to reposition time"
                        style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0, width: 13,
                          cursor: 'ew-resize', zIndex: 3,
                          background: isDragging ? col + '90' : col + '50',
                          borderRadius: '3px 0 0 3px',
                          borderLeft: '3px solid ' + col,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                        onPointerDown={e => {
                          e.stopPropagation()
                          e.currentTarget.setPointerCapture(e.pointerId)
                          const cur = timeDrag?.jobId === j.id ? timeDrag.previewMin : startMin
                          setTimeDrag({ jobId: j.id, origStartMin: cur, pointerOrigX: e.clientX, previewMin: cur })
                        }}
                        onPointerMove={e => {
                          if (!timeDrag || timeDrag.jobId !== j.id) return
                          const tw       = getTrackWidth()
                          const deltaMin = Math.round(((e.clientX - timeDrag.pointerOrigX) / tw) * TOTAL_MIN / 15) * 15
                          const newMin   = Math.max(START_H * 60, Math.min(END_H * 60 - 15, timeDrag.origStartMin + deltaMin))
                          setTimeDrag(prev => prev ? { ...prev, previewMin: newMin } : null)
                        }}
                        onPointerUp={e => {
                          if (!timeDrag || timeDrag.jobId !== j.id) return
                          e.currentTarget.releasePointerCapture(e.pointerId)
                          const newOverrides = { ...startOverrides, [j.id]: timeDrag.previewMin }
                          setStartOverrides(newOverrides)
                          persist(order, hidden, newOverrides)
                          setTimeDrag(null)
                        }}
                      />

                      {/* Time tooltip shown during drag */}
                      {isDragging && (
                        <div style={{
                          position: 'absolute', top: -22, left: 0,
                          background: C.ac, color: '#fff',
                          fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
                          whiteSpace: 'nowrap', zIndex: 20, pointerEvents: 'none',
                        }}>
                          {fmtMin(timeDrag!.previewMin)}
                        </div>
                      )}

                      {/* Top label */}
                      <div style={{ overflow: 'hidden', lineHeight: 1.2 }}>
                        {(mid || wide) && (
                          <div style={{ fontSize: 9, fontWeight: 700, color: C.tx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {j.tbAccount || j.tbCallNum || ''}
                          </div>
                        )}
                        {wide && (
                          <div style={{ fontSize: 8, color: C.dm, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {pu} → {dr}
                          </div>
                        )}
                      </div>

                      {/* Duration + controls */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 8, fontWeight: 700, color: col, flexShrink: 0 }}>
                          {isFinite(dur) ? fH(dur) : '--'}
                        </span>
                        <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                          {canL && (
                            <button
                              style={{ ...bSt, padding: '0 3px', height: 14, fontSize: 8, lineHeight: '14px', borderColor: C.bd }}
                              onClick={e => { e.stopPropagation(); moveInRow(j.id, driver.id, -1) }}
                              title="Move earlier in sequence"
                            >‹</button>
                          )}
                          <button
                            style={{ ...bSt, padding: '0 3px', height: 14, fontSize: 8, lineHeight: '14px', color: C.rd, borderColor: C.bd }}
                            onClick={e => { e.stopPropagation(); unassign(j.id) }}
                            title="Return to unassigned pool"
                          >×</button>
                          {canR && (
                            <button
                              style={{ ...bSt, padding: '0 3px', height: 14, fontSize: 8, lineHeight: '14px', borderColor: C.bd }}
                              onClick={e => { e.stopPropagation(); moveInRow(j.id, driver.id, 1) }}
                              title="Move later in sequence"
                            >›</button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

      </div>

      {/* ── Legend ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.entries(JT_COLOR).map(([type, col]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: col, flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: C.dm }}>{type}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: '#64748b', flexShrink: 0 }} />
          <span style={{ fontSize: 9, color: C.dm }}>Unclassified</span>
        </div>
        <span style={{ fontSize: 9, color: C.dm, marginLeft: 'auto', fontStyle: 'italic' }}>
          Drag the left edge of a bar to reposition it in time
        </span>
      </div>

    </div>
  )
}
