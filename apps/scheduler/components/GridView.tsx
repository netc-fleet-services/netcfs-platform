'use client'

import { useMemo } from 'react'
import type { Driver, ScheduleEntry } from '../lib/types'
import {
  categoryClass,
  formatHours,
  formatName,
  formatTime12,
  formatYards,
  shiftDurationHours,
  sortDrivers,
  toIsoDate,
  type SortKey,
} from '../lib/utils'
import { useOptimizerConfig } from '../lib/settings'
import { isInExcludedYard } from '../lib/optimizer'

interface Props {
  drivers: Driver[]
  entries: ScheduleEntry[]
  week: Date[]
  sortKey: SortKey
  onSortChange: (next: SortKey) => void
  onCellClick: (driver: Driver, isoDate: string, entry: ScheduleEntry | null) => void
  onHeaderClick: (isoDate: string) => void
  onDriverClick?: (driver: Driver) => void
}

export function GridView({ drivers, entries, week, sortKey, onSortChange, onCellClick, onHeaderClick, onDriverClick }: Props) {
  const opt = useOptimizerConfig()

  const byKey = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>()
    for (const e of entries) {
      const key = `${e.driver_id}|${e.schedule_date}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return map
  }, [entries])

  const sorted = useMemo(
    () => sortDrivers(drivers, sortKey, { entries, week }),
    [drivers, entries, week, sortKey],
  )

  const todayIso = toIsoDate(new Date())

  return (
    <section className="schedule">
      <div
        className="schedule__grid"
        role="grid"
        aria-label="Driver schedule"
        style={{ gridTemplateColumns: `220px repeat(${week.length}, minmax(120px, 1fr))` }}
      >
        <div className="schedule__header">
          <div className="cell cell--header cell--driver">
            <label className="driver-sort">
              <span className="driver-sort__label">Drivers</span>
              <select
                className="driver-sort__select"
                value={sortKey}
                onChange={e => onSortChange(e.target.value as SortKey)}
                title="Sort drivers by…"
              >
                <option value="function">Type</option>
                <option value="name">Name</option>
                <option value="driverNumber">Driver #</option>
                <option value="startTime">Start time</option>
              </select>
            </label>
          </div>
          {week.map((d, i) => {
            const iso = toIsoDate(d)
            const isToday = iso === todayIso
            return (
              <div
                key={iso}
                className={`cell cell--header cell--clickable ${isToday ? 'cell--today' : ''}`}
                data-col={i}
                data-date={iso}
                title="Click for day detail"
                onClick={() => onHeaderClick(iso)}
              >
                <div className="dow">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                <div className="dom">{d.getMonth() + 1}/{d.getDate()}</div>
              </div>
            )
          })}
        </div>

        <div className="schedule__body">
          {sorted.map(driver => (
            <DriverRow
              key={driver.id}
              driver={driver}
              week={week}
              byKey={byKey}
              excluded={isInExcludedYard(driver, opt)}
              onCellClick={onCellClick}
              onDriverClick={onDriverClick}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function DriverRow({
  driver, week, byKey, excluded, onCellClick, onDriverClick,
}: {
  driver: Driver
  week: Date[]
  byKey: Map<string, ScheduleEntry[]>
  excluded: boolean
  onCellClick: (driver: Driver, isoDate: string, entry: ScheduleEntry | null) => void
  onDriverClick?: (driver: Driver) => void
}) {
  const isInactive = driver.active === false
  const weeklyHours = computeDriverWeekHours(driver.id, week, byKey)
  const clickable = !!onDriverClick

  return (
    <div className="row">
      <div
        className={`cell cell--driver ${clickable ? 'cell--driver-clickable' : ''} ${isInactive ? 'is-inactive' : ''} ${excluded ? 'is-excluded-yard' : ''}`}
        data-driver-id={driver.id}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => onDriverClick!(driver) : undefined}
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
          {weeklyHours > 0 && (
            <span className="driver-hours" title="Scheduled this week">{formatHours(weeklyHours)}</span>
          )}
        </div>
        <div className="driver-meta">
          <span className={`badge badge--${categoryClass(driver.function)}`}>{driver.function || '—'}</span>
          <span className="muted">
            #{driver.irh_driver_number || driver.id} · yard {formatYards(driver.irh_yard_number) || driver.yard || '—'}
          </span>
          {isInactive && <span className="badge badge--off">inactive</span>}
        </div>
      </div>
      {week.map(d => {
        const iso = toIsoDate(d)
        const dayEntries = byKey.get(`${driver.id}|${iso}`) || []
        return <DayCell key={iso} driver={driver} iso={iso} entries={dayEntries} onCellClick={onCellClick} />
      })}
    </div>
  )
}

function DayCell({
  driver, iso, entries, onCellClick,
}: {
  driver: Driver
  iso: string
  entries: ScheduleEntry[]
  onCellClick: (driver: Driver, isoDate: string, entry: ScheduleEntry | null) => void
}) {
  if (!entries.length) {
    return (
      <div
        className="cell cell--day cell--empty"
        data-driver-id={driver.id}
        data-date={iso}
        title="Click to add"
        onClick={() => onCellClick(driver, iso, null)}
      >
        <span className="cell--empty__plus">+</span>
      </div>
    )
  }

  const off = entries.find(e => e.entry_type === 'off')
  if (off) {
    return (
      <div
        className="cell cell--day cell--off"
        data-driver-id={driver.id}
        data-date={iso}
        data-entry-id={off.id}
        title={`Off: ${off.off_reason || ''}`}
        onClick={() => onCellClick(driver, iso, off)}
      >
        <div className="off__label">{off.off_reason || 'off'}</div>
      </div>
    )
  }

  const shifts = entries
    .filter(e => e.entry_type === 'shift')
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))

  if (shifts.length === 1) {
    const e = shifts[0]
    const start = formatTime12(e.start_time)
    const end = formatTime12(e.end_time)
    const crossesMidnight = (e.end_time && e.start_time && e.end_time < e.start_time) || false
    return (
      <div
        className={`cell cell--day cell--shift ${crossesMidnight ? 'cell--shift-overnight' : ''}`}
        data-driver-id={driver.id}
        data-date={iso}
        data-entry-id={e.id}
        title={`${start} - ${end}${crossesMidnight ? ' (next day)' : ''}`}
        onClick={() => onCellClick(driver, iso, e)}
      >
        <div className="shift__times">
          {start}
          <br />
          {end}
          {crossesMidnight && <span className="shift__nextday" title="Ends next day"> +1d</span>}
        </div>
        {e.notes && <div className="shift__notes">{e.notes}</div>}
      </div>
    )
  }

  return (
    <div
      className="cell cell--day cell--shifts"
      data-driver-id={driver.id}
      data-date={iso}
    >
      {shifts.map(e => {
        const start = formatTime12(e.start_time)
        const end = formatTime12(e.end_time)
        const overnight = (e.end_time && e.start_time && e.end_time < e.start_time) || false
        return (
          <div
            key={e.id}
            className={`shift-pill ${overnight ? 'shift-pill--overnight' : ''}`}
            data-entry-id={e.id}
            title={`${start} - ${end}${overnight ? ' (next day)' : ''}`}
            onClick={ev => { ev.stopPropagation(); onCellClick(driver, iso, e) }}
          >
            <span className="shift-pill__times">{start} – {end}{overnight && <small>+1d</small>}</span>
            {e.notes && <span className="shift-pill__notes">{e.notes}</span>}
          </div>
        )
      })}
      <button
        type="button"
        className="shift-add"
        title="Add another shift"
        onClick={ev => { ev.stopPropagation(); onCellClick(driver, iso, null) }}
      >
        +
      </button>
    </div>
  )
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
