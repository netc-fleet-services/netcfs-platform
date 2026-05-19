'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Driver, ScheduleEntry } from '../lib/types'
import {
  categoryClass,
  computeOffStartOverrides,
  formatHours,
  formatName,
  formatTime12,
  formatTime12Compact,
  formatYards,
  hoursToTimeStr,
  parseTimeToHours,
  shiftDurationHours,
  sortDrivers,
  toIsoDate,
  type SortKey,
} from '../lib/utils'
import { upsertEntry } from '../lib/db'
import { useOptimizerConfig } from '../lib/settings'
import { isInExcludedYard } from '../lib/optimizer'

const GANTT_OVERFLOW_HOURS = 6

interface Props {
  supabase: SupabaseClient
  drivers: Driver[]
  entries: ScheduleEntry[]
  week: Date[]
  viewDays: number
  sortKey: SortKey
  onSortChange: (next: SortKey) => void
  onChanged: () => void
  onBarClick: (driver: Driver, entry: ScheduleEntry) => void
  onAxisClick: (isoDate: string) => void
  onDriverClick?: (driver: Driver) => void
}

interface DragState {
  bar: HTMLElement
  side: 'left' | 'right'
  track: HTMLElement
  trackWidth: number
  entry: ScheduleEntry
  driver: Driver
  dayOffsetH: number
  startX: number
  startLeftPct: number
  startWidthPct: number
  moved: boolean
}

export function GanttView({
  supabase, drivers, entries, week, viewDays, sortKey, onSortChange, onChanged, onBarClick, onAxisClick, onDriverClick,
}: Props) {
  const opt = useOptimizerConfig()
  const totalHours = viewDays * 24 + GANTT_OVERFLOW_HOURS
  const weekStartMs = week[0]?.getTime() ?? 0

  const driversById = useMemo(() => new Map(drivers.map(d => [d.id, d])), [drivers])

  const byDriver = useMemo(() => {
    const map = new Map<number, ScheduleEntry[]>()
    for (const e of entries) {
      if (!map.has(e.driver_id)) map.set(e.driver_id, [])
      map.get(e.driver_id)!.push(e)
    }
    return map
  }, [entries])

  const byKey = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>()
    for (const e of entries) {
      const k = `${e.driver_id}|${e.schedule_date}`
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(e)
    }
    return map
  }, [entries])

  const offStartByEntryId = useMemo(
    () => computeOffStartOverrides(entries, byKey, weekStartMs),
    [entries, byKey, weekStartMs],
  )

  const sortedDrivers = useMemo(
    () => sortDrivers(drivers, sortKey, { entries, week }),
    [drivers, entries, week, sortKey],
  )

  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)

  // Live "now" indicator: re-position once per minute.
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const nowOffsetH = (nowMs - weekStartMs) / 3_600_000
  const visibleH = viewDays * 24
  const nowVisible = nowOffsetH >= 0 && nowOffsetH <= visibleH
  const nowLeftPct = nowVisible ? (nowOffsetH / totalHours) * 100 : 0
  const nowTitle = nowVisible ? `Now · ${new Date(nowMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''

  function onPointerDown(e: React.PointerEvent) {
    const target = e.target as HTMLElement
    const handle = target.closest('.gantt-bar__handle') as HTMLElement | null
    if (!handle) return
    const bar = handle.closest('.gantt-bar') as HTMLElement | null
    if (!bar || bar.classList.contains('gantt-bar--off')) return

    const entryId = bar.dataset.entryId
    const entry = entries.find(x => String(x.id) === entryId)
    if (!entry || entry.entry_type !== 'shift') return
    const driver = driversById.get(entry.driver_id)
    if (!driver) return

    const track = bar.parentElement as HTMLElement
    const dayOffsetH = Number(bar.dataset.dayOffset) || 0
    dragRef.current = {
      bar,
      side: (handle.dataset.side as 'left' | 'right') ?? 'right',
      track,
      trackWidth: track.getBoundingClientRect().width,
      entry,
      driver,
      dayOffsetH,
      startX: e.clientX,
      startLeftPct: parseFloat(bar.style.left) || 0,
      startWidthPct: parseFloat(bar.style.width) || 0,
      moved: false,
    }
    bar.classList.add('gantt-bar--dragging')
    handle.setPointerCapture(e.pointerId)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp, { once: true })
    document.addEventListener('pointercancel', onPointerUp, { once: true })
    e.stopPropagation()
    e.preventDefault()
  }

  function onPointerMove(e: PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    if (Math.abs(dx) > 3) drag.moved = true
    if (!drag.moved) return

    const dPct = (dx / drag.trackWidth) * 100
    const minWidthPct = (0.5 / totalHours) * 100
    const dayStartPct = (drag.dayOffsetH / totalHours) * 100
    const dayEndPct = ((drag.dayOffsetH + 30) / totalHours) * 100

    if (drag.side === 'right') {
      let newRight = snapPct(drag.startLeftPct + drag.startWidthPct + dPct, totalHours)
      newRight = Math.max(drag.startLeftPct + minWidthPct, Math.min(dayEndPct, newRight))
      drag.bar.style.width = (newRight - drag.startLeftPct) + '%'
    } else {
      let newLeft = snapPct(drag.startLeftPct + dPct, totalHours)
      const right = drag.startLeftPct + drag.startWidthPct
      newLeft = Math.max(dayStartPct, Math.min(right - minWidthPct, newLeft))
      drag.bar.style.left = newLeft + '%'
      drag.bar.style.width = (right - newLeft) + '%'
    }
  }

  async function onPointerUp() {
    const drag = dragRef.current
    if (!drag) return
    document.removeEventListener('pointermove', onPointerMove)
    drag.bar.classList.remove('gantt-bar--dragging')

    if (drag.moved) {
      suppressClickRef.current = true
      setTimeout(() => { suppressClickRef.current = false }, 250)
    }
    if (!drag.moved) { dragRef.current = null; return }

    const leftPct = parseFloat(drag.bar.style.left) || 0
    const widthPct = parseFloat(drag.bar.style.width) || 0
    const startTotalH = (leftPct / 100) * totalHours
    const endTotalH = ((leftPct + widthPct) / 100) * totalHours
    const startInDay = startTotalH - drag.dayOffsetH
    const endInDay = endTotalH - drag.dayOffsetH

    const newStart = hoursToTimeStr(startInDay % 24)
    const newEnd = hoursToTimeStr(endInDay % 24)

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
        schedule_date: saved.entry.schedule_date,
        entry_type: 'shift',
        start_time: newStart,
        end_time: newEnd,
        off_reason: null,
        notes: saved.entry.notes,
      })
      onChanged()
    } catch (err) {
      console.error('Gantt drag-save failed:', err)
      saved.bar.style.left = saved.startLeftPct + '%'
      saved.bar.style.width = saved.startWidthPct + '%'
      alert("Couldn't save the new times: " + (err instanceof Error ? err.message : err))
    }
  }

  function handleBarClick(e: React.MouseEvent) {
    if (suppressClickRef.current) return
    const target = e.target as HTMLElement
    if (target.closest('.gantt-bar__handle')) return
    const bar = target.closest('.gantt-bar') as HTMLElement | null
    if (!bar) return
    const entryId = bar.dataset.entryId
    const entry = entries.find(x => String(x.id) === entryId)
    if (!entry) return
    const driver = driversById.get(entry.driver_id)
    if (!driver) return
    onBarClick(driver, entry)
  }

  function handleAxisClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    const day = target.closest('.gantt__day') as HTMLElement | null
    if (!day) return
    const iso = day.dataset.date
    if (iso) onAxisClick(iso)
  }

  return (
    <section className="schedule schedule--gantt">
      <div className="gantt__head">
        <div className="gantt__driver-col">
          <label className="driver-sort">
            <span className="driver-sort__label">Drivers</span>
            <select
              className="driver-sort__select"
              value={sortKey}
              onChange={e => onSortChange(e.target.value as SortKey)}
              title="Sort drivers by…"
            >
              <option value="startTime">Start time</option>
              <option value="function">Type</option>
              <option value="name">Name</option>
              <option value="driverNumber">Driver #</option>
            </select>
          </label>
        </div>
        <div className="gantt__axis" onClick={handleAxisClick}>
          {week.map((d, i) => {
            const leftPct = ((i * 24) / totalHours) * 100
            const widthPct = (24 / totalHours) * 100
            const dow = d.toLocaleDateString(undefined, { weekday: 'short' })
            const dom = `${d.getMonth() + 1}/${d.getDate()}`
            const iso = toIsoDate(d)
            return (
              <div
                key={iso}
                className="gantt__day"
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                data-date={iso}
                title="Click for day detail"
              >
                <span className="gantt__day-dow">{dow}</span>
                <span className="gantt__day-dom">{dom}</span>
              </div>
            )
          })}
          {nowVisible && (
            <div className="gantt__now-line" style={{ left: `${nowLeftPct}%` }} title={nowTitle} />
          )}
        </div>
      </div>

      <div className="gantt__body" onClick={handleBarClick} onPointerDown={onPointerDown}>
        {sortedDrivers.map(d => {
          const driverEntries = byDriver.get(d.id) || []
          const hours = computeDriverWeekHours(d.id, week, byKey)
          const excluded = isInExcludedYard(d, opt)
          return (
            <GanttRow
              key={d.id}
              driver={d}
              weekStartMs={weekStartMs}
              entries={driverEntries}
              hours={hours}
              viewDays={viewDays}
              totalHours={totalHours}
              excluded={excluded}
              offStartByEntryId={offStartByEntryId}
              nowLeftPct={nowLeftPct}
              nowVisible={nowVisible}
              nowTitle={nowTitle}
              onDriverClick={onDriverClick}
            />
          )
        })}
      </div>
    </section>
  )
}

function GanttRow({
  driver, weekStartMs, entries, hours, viewDays, totalHours, excluded, offStartByEntryId, nowLeftPct, nowVisible, nowTitle, onDriverClick,
}: {
  driver: Driver
  weekStartMs: number
  entries: ScheduleEntry[]
  hours: number
  viewDays: number
  totalHours: number
  excluded: boolean
  offStartByEntryId: Map<string, number>
  nowLeftPct: number
  nowVisible: boolean
  nowTitle: string
  onDriverClick?: (driver: Driver) => void
}) {
  const isInactive = driver.active === false
  const clickable = !!onDriverClick
  return (
    <div className="gantt-row">
      <div
        className={`gantt-row__driver ${clickable ? 'gantt-row__driver--clickable' : ''} ${isInactive ? 'is-inactive' : ''} ${excluded ? 'is-excluded-yard' : ''}`}
        data-driver-id={driver.id}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? e => { e.stopPropagation(); onDriverClick!(driver) } : undefined}
        onKeyDown={clickable ? e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDriverClick!(driver) }
        } : undefined}
        title={
          excluded
            ? 'Yard is excluded from towing-supply count (Settings → Excluded yards)'
            : clickable ? 'View stats · edit · hide' : undefined
        }
      >
        <div className="driver-name">
          {formatName(driver.name) || '(unnamed)'}
          {hours > 0 && <span className="driver-hours" title="Scheduled this week">{formatHours(hours)}</span>}
        </div>
        <div className="driver-meta">
          <span className={`badge badge--${categoryClass(driver.function)}`}>
            {driver.function || '—'}
          </span>
          <span className="muted">
            #{driver.irh_driver_number || driver.id} · yard {formatYards(driver.irh_yard_number) || driver.yard || '—'}
          </span>
          {isInactive && <span className="badge badge--off">inactive</span>}
        </div>
      </div>
      <div className="gantt-row__track">
        {Array.from({ length: viewDays }).map((_, i) => {
          const leftPct = (((i + 1) * 24) / totalHours) * 100
          return <div key={i} className="gantt__divider" style={{ left: `${leftPct}%` }} />
        })}
        {entries.map(e => (
          <Bar
            key={e.id}
            entry={e}
            weekStartMs={weekStartMs}
            viewDays={viewDays}
            totalHours={totalHours}
            offStartByEntryId={offStartByEntryId}
          />
        ))}
        {nowVisible && (
          <div className="gantt__now-line gantt__now-line--track" style={{ left: `${nowLeftPct}%` }} title={nowTitle} />
        )}
      </div>
    </div>
  )
}

function Bar({
  entry, weekStartMs, viewDays, totalHours, offStartByEntryId,
}: {
  entry: ScheduleEntry
  weekStartMs: number
  viewDays: number
  totalHours: number
  offStartByEntryId: Map<string, number>
}) {
  const lastVisibleHour = viewDays * 24
  const date = new Date(entry.schedule_date + 'T00:00:00')
  const dayOffsetH = Math.round((date.getTime() - weekStartMs) / 3600000)
  if (dayOffsetH < 0 || dayOffsetH >= lastVisibleHour) return null

  if (entry.entry_type === 'off') {
    const dayEndH = dayOffsetH + 24
    const override = offStartByEntryId.get(entry.id)
    const startH = override != null ? override : dayOffsetH
    const leftPct = (Math.max(0, startH) / totalHours) * 100
    const widthPct = ((dayEndH - Math.max(0, startH)) / totalHours) * 100
    return (
      <div
        className="gantt-bar gantt-bar--off"
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        data-entry-id={entry.id}
        title={`Off${entry.off_reason ? ' · ' + entry.off_reason : ''}`}
      >
        <span>off</span>
      </div>
    )
  }

  if (entry.entry_type !== 'shift') return null

  const startH = parseTimeToHours(entry.start_time)
  let endH = parseTimeToHours(entry.end_time)
  if (endH <= startH) endH += 24
  const startTotal = dayOffsetH + startH
  const endTotal = dayOffsetH + endH
  const leftPct = (startTotal / totalHours) * 100
  const widthPct = ((endTotal - startTotal) / totalHours) * 100

  const start = formatTime12(entry.start_time)
  const end = formatTime12(entry.end_time)
  const startShort = formatTime12Compact(entry.start_time)
  const endShort = formatTime12Compact(entry.end_time)
  const overnight = endH > 24

  return (
    <div
      className={`gantt-bar gantt-bar--shift ${overnight ? 'gantt-bar--overnight' : ''}`}
      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      data-entry-id={entry.id}
      data-day-offset={dayOffsetH}
      title={`${start} - ${end}${overnight ? ' (next day)' : ''}`}
    >
      <div className="gantt-bar__handle gantt-bar__handle--left" data-side="left" title="Drag to change start" />
      <span className="gantt-bar__label gantt-bar__label--start">{startShort}</span>
      <span className="gantt-bar__label gantt-bar__label--end">{endShort}{overnight ? '+' : ''}</span>
      <div className="gantt-bar__handle gantt-bar__handle--right" data-side="right" title="Drag to change end" />
    </div>
  )
}

function snapPct(pct: number, totalHours: number): number {
  const hours = (pct / 100) * totalHours
  const snapped = Math.round(hours * 2) / 2
  return (snapped / totalHours) * 100
}

function computeDriverWeekHours(driverId: number, week: Date[], byKey: Map<string, ScheduleEntry[]>): number {
  let total = 0
  for (const d of week) {
    const iso = toIsoDate(d)
    const dayEntries = byKey.get(`${driverId}|${iso}`) || []
    for (const entry of dayEntries) {
      if (entry.entry_type !== 'shift') continue
      total += shiftDurationHours(entry.start_time, entry.end_time)
    }
  }
  return total
}

