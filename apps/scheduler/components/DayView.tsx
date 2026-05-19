'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Driver, ScheduleEntry } from '../lib/types'
import {
  addDays, escapeHtml, formatName, formatTime12, fromIsoDate, hoursToTimeStr, parseTimeToHours, toIsoDate,
} from '../lib/utils'
import { listScheduleBetween, upsertEntry } from '../lib/db'
import { useOptimizerConfig } from '../lib/settings'
import {
  computeGaps,
  filterSupplyDrivers,
  getBaseline,
  isInExcludedYard,
  type Baseline,
  type Gap,
} from '../lib/optimizer'

const TIMELINE_START_H = -6
const TIMELINE_END_H = 30
const TIMELINE_HOURS = TIMELINE_END_H - TIMELINE_START_H
// One labeled tick per hour so the exact hour is readable from the top.
const TICK_INTERVAL_H = 1

interface Props {
  supabase: SupabaseClient
  isoDate: string
  drivers: Driver[]
  entries: ScheduleEntry[]
  activeTab: 'drivers' | 'dispatchers'
  onChanged: () => void
  onClose: () => void
  onEditEntry: (driver: Driver, entry: ScheduleEntry) => void
}

function pctFromHours(h: number) { return ((h - TIMELINE_START_H) / TIMELINE_HOURS) * 100 }
function hoursFromPct(p: number) { return TIMELINE_START_H + (p / 100) * TIMELINE_HOURS }
function snapPctTo30Min(p: number) {
  const hours = hoursFromPct(p)
  const snapped = Math.round(hours * 2) / 2
  return pctFromHours(snapped)
}

interface DragState {
  bar: HTMLElement
  mode: 'resize' | 'move'
  side: 'left' | 'right' | null
  track: HTMLElement
  trackWidth: number
  driver: Driver
  entry: ScheduleEntry
  startX: number
  startLeftPct: number
  startWidthPct: number
  moved: boolean
}

export function DayView({ supabase, isoDate, drivers, entries, activeTab, onChanged, onClose, onEditEntry }: Props) {
  const opt = useOptimizerConfig()

  const [hideUfp, setHideUfp] = useState<boolean>(() => {
    try { return localStorage.getItem('dayview.hideUfp') === '1' } catch { return false }
  })
  const [yesterdayOvernight, setYesterdayOvernight] = useState<ScheduleEntry[] | null>(null)
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [nowMs, setNowMs] = useState<number>(() => Date.now())

  const rowsRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)

  const yesterdayIso = useMemo(() => toIsoDate(addDays(fromIsoDate(isoDate), -1)), [isoDate])

  const driversById = useMemo(() => {
    const map = new Map<number, Driver>()
    for (const d of drivers) map.set(d.id, d)
    return map
  }, [drivers])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    try { localStorage.setItem('dayview.hideUfp', hideUfp ? '1' : '0') } catch { /* ignore */ }
  }, [hideUfp])

  // Live "now" indicator — only when the open day is today. Re-tick each minute.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const now = new Date(nowMs)
  const nowH = now.getHours() + now.getMinutes() / 60
  const nowVisible =
    toIsoDate(now) === isoDate && nowH >= TIMELINE_START_H && nowH <= TIMELINE_END_H
  const nowLeftPct = nowVisible ? pctFromHours(nowH) : 0
  const nowTitle = nowVisible
    ? `Now · ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : ''

  // Yesterday's entries may already be in the parent's window. If so, reuse.
  useEffect(() => {
    let alive = true
    const inWindow = entries.filter(e => e.schedule_date === yesterdayIso)
    if (inWindow.length) {
      const overnight = inWindow.filter(e =>
        driversById.has(e.driver_id) && e.entry_type === 'shift' &&
        e.end_time != null && e.start_time != null && e.end_time < e.start_time,
      )
      setYesterdayOvernight(overnight)
      return
    }
    listScheduleBetween(supabase, yesterdayIso, yesterdayIso)
      .then(data => {
        if (!alive) return
        const overnight = data.filter(e =>
          driversById.has(e.driver_id) && e.entry_type === 'shift' &&
          e.end_time != null && e.start_time != null && e.end_time < e.start_time,
        )
        setYesterdayOvernight(overnight)
      })
      .catch(err => {
        console.warn("Couldn't fetch previous day's shifts:", err)
        if (alive) setYesterdayOvernight([])
      })
    return () => { alive = false }
  }, [supabase, yesterdayIso, entries, driversById])

  // Load baseline for the coverage strip (Drivers tab only).
  useEffect(() => {
    if (activeTab !== 'drivers') return
    let alive = true
    getBaseline(supabase)
      .then(b => { if (alive) setBaseline(b) })
      .catch(err => console.warn('Optimizer baseline load failed:', err))
    return () => { alive = false }
  }, [supabase, activeTab])

  const excludedDriverIds = useMemo(() => {
    if (!hideUfp) return new Set<number>()
    const set = new Set<number>()
    for (const d of drivers) if (isInExcludedYard(d, opt)) set.add(d.id)
    return set
  }, [drivers, opt, hideUfp])

  const inScope = (e: ScheduleEntry) => driversById.has(e.driver_id) && !excludedDriverIds.has(e.driver_id)

  const todayEntries = entries.filter(e => e.schedule_date === isoDate && inScope(e))
  const todayShifts = todayEntries
    .filter(e => e.entry_type === 'shift')
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
  const todayOffs = todayEntries.filter(e => e.entry_type === 'off')
  const prevOvernight = (yesterdayOvernight || []).filter(e => !excludedDriverIds.has(e.driver_id))

  const combined = useMemo(() => [...todayEntries, ...prevOvernight], [todayEntries, prevOvernight])

  // Each shift as a [start,end) interval in timeline-hours (today = 0..24,
  // negative = carried over from the previous day). Drives the per-hour
  // headcount shown on the axis.
  const shiftIntervals = useMemo(() => {
    const out: Array<{ driverId: number; start: number; end: number }> = []
    for (const e of todayShifts) {
      const s = parseTimeToHours(e.start_time)
      let en = parseTimeToHours(e.end_time)
      if (en <= s) en += 24
      out.push({ driverId: e.driver_id, start: s, end: en })
    }
    for (const e of prevOvernight) {
      out.push({
        driverId: e.driver_id,
        start: parseTimeToHours(e.start_time) - 24,
        end: parseTimeToHours(e.end_time),
      })
    }
    return out
  }, [todayShifts, prevOvernight])

  // Distinct drivers on shift at each labeled axis hour.
  const headcountByTick = useMemo(() => {
    const m = new Map<number, number>()
    const firstTick = Math.ceil(TIMELINE_START_H / TICK_INTERVAL_H) * TICK_INTERVAL_H
    for (let h = firstTick; h <= TIMELINE_END_H; h += TICK_INTERVAL_H) {
      const ids = new Set<number>()
      for (const iv of shiftIntervals) {
        if (iv.start <= h && h < iv.end) ids.add(iv.driverId)
      }
      m.set(h, ids.size)
    }
    return m
  }, [shiftIntervals])

  // Coverage strip cells
  const coverageData = useMemo(() => {
    if (activeTab !== 'drivers' || !baseline) {
      return { cells: [] as Gap[], summary: '' }
    }
    const supplyDrivers = filterSupplyDrivers(drivers, opt)
    if (!supplyDrivers.length) return { cells: [], summary: '' }
    const gaps = computeGaps(combined, supplyDrivers, baseline, isoDate, isoDate, opt)
    if (!gaps.length) return { cells: [], summary: '' }

    let totalUnder = 0, totalOver = 0
    let worstUnder: Gap | null = null, worstOver: Gap | null = null
    for (const g of gaps) {
      if (g.status === 'under') { totalUnder++; if (!worstUnder || g.gap < worstUnder.gap) worstUnder = g }
      else if (g.status === 'over') { totalOver++; if (!worstOver || g.gap > worstOver.gap) worstOver = g }
    }

    let summary: string
    if (totalUnder === 0 && totalOver === 0) {
      summary = 'Coverage on target all day.'
    } else {
      const parts: string[] = []
      if (totalUnder && worstUnder) {
        parts.push(`${totalUnder}h under (worst ${worstUnder.gap.toFixed(1)} @ ${hourLabel(worstUnder.hour)})`)
      }
      if (totalOver && worstOver) {
        parts.push(`${totalOver}h over (+${worstOver.gap.toFixed(1)} @ ${hourLabel(worstOver.hour)})`)
      }
      summary = parts.join(' · ')
    }
    return { cells: gaps, summary }
  }, [activeTab, baseline, drivers, opt, combined, isoDate])

  const date = fromIsoDate(isoDate)
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
  const carryNote = prevOvernight.length ? ` · ${prevOvernight.length} carrying over from prev day` : ''
  const hiddenNote = excludedDriverIds.size ? ` · ${excludedDriverIds.size} UFP hidden` : ''
  const summary = `${todayShifts.length} shift${todayShifts.length === 1 ? '' : 's'} · ${todayOffs.length} off${carryNote}${hiddenNote}`

  const rows = useMemo(() => {
    const byDriver = new Map<number, { todays: ScheduleEntry[]; prev: ScheduleEntry | null }>()
    for (const e of todayShifts) {
      if (!byDriver.has(e.driver_id)) byDriver.set(e.driver_id, { todays: [], prev: null })
      byDriver.get(e.driver_id)!.todays.push(e)
    }
    for (const e of prevOvernight) {
      if (!byDriver.has(e.driver_id)) byDriver.set(e.driver_id, { todays: [], prev: null })
      byDriver.get(e.driver_id)!.prev = e
    }
    return [...byDriver.entries()].sort(([, a], [, b]) => earliestStartH(a) - earliestStartH(b))
  }, [todayShifts, prevOvernight])

  function onBarPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const handle = target.closest('.tl-bar__handle') as HTMLElement | null
    const bar = target.closest('.tl-bar') as HTMLElement | null
    if (!bar) return
    if (bar.classList.contains('tl-bar--prev')) return

    const driverId = Number(bar.dataset.driverId)
    const entryId = bar.dataset.entryId
    const entry = combined.find(x => String(x.id) === entryId)
    const driver = driversById.get(driverId)
    if (!entry || !driver || entry.entry_type !== 'shift') return

    const track = bar.parentElement as HTMLElement
    dragRef.current = {
      bar,
      mode: handle ? 'resize' : 'move',
      side: handle ? ((handle.dataset.side as 'left' | 'right') ?? null) : null,
      track,
      trackWidth: track.getBoundingClientRect().width,
      driver,
      entry,
      startX: e.clientX,
      startLeftPct: parseFloat(bar.style.left) || 0,
      startWidthPct: parseFloat(bar.style.width) || 0,
      moved: false,
    }

    const captureTarget = handle ?? bar
    captureTarget.setPointerCapture(e.pointerId)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp, { once: true })
    document.addEventListener('pointercancel', onPointerUp, { once: true })
    e.stopPropagation()
  }

  function onPointerMove(e: PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    if (!drag.moved && Math.abs(dx) > 3) {
      drag.moved = true
      drag.bar.classList.add('tl-bar--dragging')
    }
    if (!drag.moved) return

    const dPct = (dx / drag.trackWidth) * 100
    const minDuration = 0.5
    const minWidthPct = (minDuration / TIMELINE_HOURS) * 100
    const todayStartPct = pctFromHours(0)
    const timelineEndPct = pctFromHours(TIMELINE_END_H)

    if (drag.mode === 'resize' && drag.side === 'right') {
      let snapped = snapPctTo30Min(drag.startLeftPct + drag.startWidthPct + dPct)
      snapped = Math.max(drag.startLeftPct + minWidthPct, Math.min(timelineEndPct, snapped))
      drag.bar.style.width = (snapped - drag.startLeftPct) + '%'
    } else if (drag.mode === 'resize' && drag.side === 'left') {
      let l = snapPctTo30Min(drag.startLeftPct + dPct)
      const right = drag.startLeftPct + drag.startWidthPct
      const maxL = right - minWidthPct
      l = Math.max(todayStartPct, Math.min(maxL, l))
      drag.bar.style.left = l + '%'
      drag.bar.style.width = (right - l) + '%'
    } else if (drag.mode === 'move') {
      let l = snapPctTo30Min(drag.startLeftPct + dPct)
      const maxL = timelineEndPct - drag.startWidthPct
      l = Math.max(todayStartPct, Math.min(maxL, l))
      drag.bar.style.left = l + '%'
    }
    updateBarLabel(drag.bar)
  }

  async function onPointerUp() {
    const drag = dragRef.current
    if (!drag) return
    document.removeEventListener('pointermove', onPointerMove)
    drag.bar.classList.remove('tl-bar--dragging')

    if (drag.moved) {
      suppressClickRef.current = true
      setTimeout(() => { suppressClickRef.current = false }, 250)
    }
    if (!drag.moved) { dragRef.current = null; return }

    const leftPct = parseFloat(drag.bar.style.left) || 0
    const widthPct = parseFloat(drag.bar.style.width) || 0
    const startH = hoursFromPct(leftPct)
    const endH = hoursFromPct(leftPct + widthPct)
    const newStart = hoursToTimeStr(((startH % 24) + 24) % 24)
    const newEnd = hoursToTimeStr(((endH % 24) + 24) % 24)

    const oldStart = (drag.entry.start_time || '').slice(0, 5)
    const oldEnd = (drag.entry.end_time || '').slice(0, 5)
    if (newStart === oldStart && newEnd === oldEnd) {
      dragRef.current = null
      return
    }

    const saved = drag
    dragRef.current = null

    try {
      await upsertEntry(supabase, {
        id: saved.entry.id,
        driver_id: saved.driver.id,
        schedule_date: isoDate,
        entry_type: 'shift',
        start_time: newStart,
        end_time: newEnd,
        off_reason: null,
        notes: saved.entry.notes,
      })
      onChanged()
    } catch (err) {
      console.error('Drag-save failed:', err)
      saved.bar.style.left = saved.startLeftPct + '%'
      saved.bar.style.width = saved.startWidthPct + '%'
      updateBarLabel(saved.bar)
      alert("Couldn't save the new times: " + (err instanceof Error ? err.message : err))
    }
  }

  function handleBarClick(e: React.MouseEvent) {
    if (suppressClickRef.current) return
    const target = e.target as HTMLElement
    if (target.closest('.tl-bar__handle')) return
    const bar = target.closest('.tl-bar') as HTMLElement | null
    if (!bar) return
    const driverId = Number(bar.dataset.driverId)
    const entryId = bar.dataset.entryId
    const driver = driversById.get(driverId)
    const entry = combined.find(x => String(x.id) === entryId)
    if (!driver || !entry) return
    onClose()
    onEditEntry(driver, entry)
  }

  return (
    <div className="modal modal--wide" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel modal__panel--wide">
        <header className="modal__header">
          <div>
            <h2>{dateLabel}</h2>
            <div className="muted">{summary}</div>
          </div>
          <button type="button" className="sched-btn sched-btn--ghost modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="day-view__toolbar">
          <label className="toggle" title="Hide drivers whose yard is in the excluded-yards list (Settings → Excluded yards). Coverage math is unaffected.">
            <input type="checkbox" checked={hideUfp} onChange={e => setHideUfp(e.target.checked)} />
            <span>Hide UFP</span>
          </label>
          {activeTab === 'drivers' && (
            <>
              <div className="day-view__legend" aria-hidden>
                <span className="day-view__legend-item"><i className="day-view__swatch day-view__swatch--under" />under</span>
                <span className="day-view__legend-item"><i className="day-view__swatch day-view__swatch--ok" />on target</span>
                <span className="day-view__legend-item"><i className="day-view__swatch day-view__swatch--over" />over</span>
              </div>
              <span className="day-view__coverage-summary muted">{coverageData.summary}</span>
            </>
          )}
        </div>
        <div className="modal__body modal__body--no-pad">
          <div className="timeline">
            <Axis counts={headcountByTick} nowVisible={nowVisible} nowLeftPct={nowLeftPct} nowTitle={nowTitle} />
            {coverageData.cells.length > 0 && (
              <div className="timeline__coverage">
                {coverageData.cells.map(g => {
                  const leftPct = pctFromHours(g.hour)
                  const widthPct = pctFromHours(g.hour + 1) - leftPct
                  const sign = g.gap > 0 ? '+' : ''
                  const mag = Math.min(1, Math.abs(g.gap) / 4)
                  const opacity = g.status === 'ok' ? 0.08 : (0.22 + mag * 0.50)
                  const cls =
                    g.status === 'under' ? 'tl-cov--under' :
                    g.status === 'over' ? 'tl-cov--over' : 'tl-cov--ok'
                  const tip = `${hourLabel(g.hour)}: ${g.demandCalls.toFixed(1)} avg calls/hr · ${g.supply} on shift · gap ${sign}${g.gap.toFixed(1)}`
                  return (
                    <div
                      key={g.hour}
                      className={`tl-cov ${cls}`}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%`, ['--cov-opacity' as string]: opacity.toFixed(2) } as React.CSSProperties}
                      title={tip}
                    >
                      {sign}{g.gap.toFixed(1)}
                    </div>
                  )
                })}
              </div>
            )}
            <div
              className="timeline__rows"
              ref={rowsRef}
              onClick={handleBarClick}
              onPointerDown={onBarPointerDown}
            >
              {rows.length === 0 && (
                <div className="timeline__empty">
                  <p className="muted">No shifts scheduled for this day.</p>
                </div>
              )}
              {rows.map(([driverId, group]) => {
                const driver = driversById.get(driverId)
                if (!driver) return null
                return (
                  <Row
                    key={driverId}
                    driver={driver}
                    group={group}
                    nowLeftPct={nowVisible ? nowLeftPct : null}
                    nowTitle={nowTitle}
                  />
                )
              })}
            </div>
          </div>
          {todayOffs.length > 0 && (
            <div className="timeline__off">
              <div className="tl-off-label">Also off today ({todayOffs.length}):</div>
              {todayOffs.map(e => {
                const drv = driversById.get(e.driver_id)
                const name = drv ? formatName(drv.name) : `Driver #${e.driver_id}`
                const reason = e.off_reason ? ` (${e.off_reason})` : ''
                return <span key={e.id} className="tl-off-pill">{name}{reason}</span>
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function hourLabel(h: number): string {
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

function earliestStartH(group: { todays: ScheduleEntry[]; prev: ScheduleEntry | null }) {
  if (group.prev) return parseTimeToHours(group.prev.start_time) - 24
  if (group.todays && group.todays.length) {
    return Math.min(...group.todays.map(e => parseTimeToHours(e.start_time)))
  }
  return 999
}

function Axis({
  counts, nowVisible, nowLeftPct, nowTitle,
}: {
  counts: Map<number, number>
  nowVisible: boolean
  nowLeftPct: number
  nowTitle: string
}) {
  const ticks: React.ReactNode[] = []
  const firstTick = Math.ceil(TIMELINE_START_H / TICK_INTERVAL_H) * TICK_INTERVAL_H
  for (let h = firstTick; h <= TIMELINE_END_H; h += TICK_INTERVAL_H) {
    const leftPct = pctFromHours(h)
    const dayHour = ((h % 24) + 24) % 24
    const classes = ['tl-tick']
    if (h === 0 || h === 24) classes.push('tl-tick--midnight')
    else if (dayHour === 12) classes.push('tl-tick--noon')
    else if (dayHour % 6 === 0) classes.push('tl-tick--major')
    if (h < 0) classes.push('tl-tick--prevday')
    else if (h > 24) classes.push('tl-tick--nextday')
    const count = counts.get(h) ?? 0
    ticks.push(
      <div key={h} className={classes.join(' ')} style={{ left: `${leftPct}%` }}>
        <span className="tl-tick__label">{formatTick(h)}</span>
        {count > 0 && (
          <span
            className="tl-tick__count"
            title={`${count} driver${count === 1 ? '' : 's'} on shift at ${hourLabel(dayHour)}`}
          >
            {count}
          </span>
        )}
      </div>,
    )
  }
  return (
    <div className="timeline__axis">
      {ticks}
      {nowVisible && (
        <div className="tl-now tl-now--axis" style={{ left: `${nowLeftPct}%` }} title={nowTitle} />
      )}
    </div>
  )
}

function formatTick(h: number): string {
  const dayHour = ((h % 24) + 24) % 24
  const period = dayHour >= 12 ? 'p' : 'a'
  const h12 = dayHour % 12 === 0 ? 12 : dayHour % 12
  // Prev/next-day hours are conveyed by tick styling, not an arrow.
  return `${h12}${period}`
}

function Row({
  driver, group, nowLeftPct, nowTitle,
}: {
  driver: Driver
  group: { todays: ScheduleEntry[]; prev: ScheduleEntry | null }
  nowLeftPct: number | null
  nowTitle: string
}) {
  return (
    <div className="tl-row">
      <div className="tl-row__driver">
        <span className="tl-row__name">{formatName(driver.name)}</span>
        <span className="muted tl-row__meta">
          #{driver.irh_driver_number || driver.id} · {driver.function || '—'}
          {driver.irh_yard_number ? ` · yard ${driver.irh_yard_number}` : ' · yard —'}
        </span>
      </div>
      <div className="tl-row__track">
        <MidnightLines />
        {nowLeftPct !== null && (
          <div className="tl-now" style={{ left: `${nowLeftPct}%` }} title={nowTitle} />
        )}
        {group.prev && <PrevDayBar driver={driver} entry={group.prev} />}
        {group.todays.map(e => <TodayBar key={e.id} driver={driver} entry={e} />)}
      </div>
    </div>
  )
}

function MidnightLines() {
  return (
    <>
      {[0, 24].map(h => {
        if (h < TIMELINE_START_H || h > TIMELINE_END_H) return null
        return <div key={h} className="tl-midnight" style={{ left: `${pctFromHours(h)}%` }} title="midnight" />
      })}
    </>
  )
}

function TodayBar({ driver, entry }: { driver: Driver; entry: ScheduleEntry }) {
  const startH = parseTimeToHours(entry.start_time)
  let endH = parseTimeToHours(entry.end_time)
  const overnight = endH <= startH
  if (overnight) endH += 24

  const leftPct = pctFromHours(startH)
  const widthPct = pctFromHours(endH) - pctFromHours(startH)

  const startLabel = formatTime12(entry.start_time)
  const endLabel = formatTime12(entry.end_time)
  const tip = `${startLabel} – ${endLabel}${overnight ? ' (next day)' : ''}`

  return (
    <div
      className={`tl-bar tl-bar--shift ${overnight ? 'tl-bar--overnight' : ''}`}
      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      data-driver-id={driver.id}
      data-schedule-date={entry.schedule_date}
      data-entry-id={entry.id}
      title={tip}
    >
      <div className="tl-bar__handle tl-bar__handle--left" data-side="left" title="Drag to change start" />
      <span className="tl-bar__label">
        {startLabel} – {endLabel}{overnight && <small> +1d</small>}
      </span>
      {entry.notes && <span className="tl-bar__notes">{entry.notes}</span>}
      <div className="tl-bar__handle tl-bar__handle--right" data-side="right" title="Drag to change end" />
    </div>
  )
}

function PrevDayBar({ driver, entry }: { driver: Driver; entry: ScheduleEntry }) {
  const startH = parseTimeToHours(entry.start_time) - 24
  const endH = parseTimeToHours(entry.end_time)
  const leftPct = pctFromHours(startH)
  const widthPct = pctFromHours(endH) - pctFromHours(startH)
  const startLabel = formatTime12(entry.start_time)
  const endLabel = formatTime12(entry.end_time)
  return (
    <div
      className="tl-bar tl-bar--shift tl-bar--prev"
      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      data-driver-id={driver.id}
      data-schedule-date={entry.schedule_date}
      data-entry-id={entry.id}
      title={`From previous day: ${startLabel} – ${endLabel}`}
    >
      <span className="tl-bar__label">
        <small>← prev</small> {startLabel} – {endLabel}
      </span>
    </div>
  )
}

function updateBarLabel(bar: HTMLElement) {
  const leftPct = parseFloat(bar.style.left) || 0
  const widthPct = parseFloat(bar.style.width) || 0
  const startH = hoursFromPct(leftPct)
  const endH = hoursFromPct(leftPct + widthPct)
  const overnight = endH > 24 + 1e-6
  const startStr = formatTime12(hoursToTimeStr(((startH % 24) + 24) % 24))
  const endStr = formatTime12(hoursToTimeStr(((endH % 24) + 24) % 24))
  const labelEl = bar.querySelector('.tl-bar__label')
  if (labelEl) {
    labelEl.innerHTML = `${escapeHtml(startStr)} – ${escapeHtml(endStr)}${overnight ? ' <small>+1d</small>' : ''}`
  }
  bar.classList.toggle('tl-bar--overnight', overnight)
  bar.title = `${startStr} – ${endStr}${overnight ? ' (next day)' : ''}`
}
