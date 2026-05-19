'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Driver, ScheduleEntry } from '../lib/types'
import { listScheduleBetween } from '../lib/db'
import { useSettings } from '../lib/settings'
import {
  addDays, formatHours, formatName, formatTime12, fromIsoDate, shiftDurationHours,
  toIsoDate, weekDates,
} from '../lib/utils'

interface Props {
  supabase: SupabaseClient
  driver: Driver
  onClose: () => void
  // When provided, an "Edit driver/dispatcher" button opens the editor.
  onEdit?: (driver: Driver) => void
  // Called after a hide so the caller can refresh its driver list.
  onChanged?: () => void
}

export function DriverDetailModal({ supabase, driver, onClose, onEdit, onChanged }: Props) {
  const { hideDriver } = useSettings()
  const [thisWeek, setThisWeek] = useState<ScheduleEntry[]>([])
  const [nextWeek, setNextWeek] = useState<ScheduleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hiding, setHiding] = useState(false)

  // Calendar weeks (Mon–Sun), matching the rest of the scheduler.
  const { thisWk, nextWk, isoStart, isoEnd } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const t = weekDates(today)
    const n = weekDates(addDays(today, 7))
    return {
      thisWk: t,
      nextWk: n,
      isoStart: toIsoDate(t[0]),
      isoEnd: toIsoDate(n[n.length - 1]),
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    const thisSet = new Set(thisWk.map(toIsoDate))
    const nextSet = new Set(nextWk.map(toIsoDate))

    listScheduleBetween(supabase, isoStart, isoEnd)
      .then(entries => {
        if (!alive) return
        const mine = entries.filter(e => e.driver_id === driver.id)
        setThisWeek(mine.filter(e => thisSet.has(e.schedule_date)))
        setNextWeek(mine.filter(e => nextSet.has(e.schedule_date)))
      })
      .catch(err => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Failed to load.')
      })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false }
  }, [supabase, driver.id, isoStart, isoEnd, thisWk, nextWk])

  async function handleHide() {
    const ok = window.confirm(
      `Hide ${formatName(driver.name) || 'this driver'}?\n\n` +
      `They’ll be removed from every schedule, stat and export view. ` +
      `You can unhide them under Settings → Hidden drivers.`,
    )
    if (!ok) return
    setHiding(true)
    try {
      await hideDriver(driver.id)
      onChanged?.()
      onClose()
    } catch (err) {
      console.error('Hide driver failed:', err)
      setError(err instanceof Error ? err.message : 'Couldn’t hide.')
      setHiding(false)
    }
  }

  return (
    <div className="modal modal--wide" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel modal__panel--wide">
        <header className="modal__header">
          <div>
            <h2>{formatName(driver.name) || '(unnamed)'}</h2>
            <div className="muted">
              #{driver.irh_driver_number || driver.id} · {driver.function || '—'}
              {driver.irh_yard_number ? ` · yard ${driver.irh_yard_number}` : ''}
              {driver.active === false ? ' · inactive' : ''}
            </div>
          </div>
          <div className="modal__header-actions">
            {onEdit && (
              <button
                type="button"
                className="sched-btn sched-btn--primary"
                onClick={() => onEdit(driver)}
              >
                Edit driver/dispatcher
              </button>
            )}
            <button
              type="button"
              className="sched-btn sched-btn--danger"
              onClick={handleHide}
              disabled={hiding}
              title="Remove from all views (unhide later from Settings)"
            >
              {hiding ? 'Hiding…' : 'Hide'}
            </button>
            <button type="button" className="sched-btn sched-btn--ghost modal__close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </header>
        <div className="modal__body">
          {error ? (
            <div className="form-error">{error}</div>
          ) : (
            <div className="driver-detail__grid">
              <div className="driver-detail__col">
                <h3>This week</h3>
                <DriverStats entries={loading ? null : thisWeek} />
                <DriverList entries={loading ? null : thisWeek} />
              </div>
              <div className="driver-detail__col">
                <h3>Next week</h3>
                <DriverStats entries={loading ? null : nextWeek} />
                <DriverList entries={loading ? null : nextWeek} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DriverStats({ entries }: { entries: ScheduleEntry[] | null }) {
  if (entries === null) return <div className="driver-detail__stats muted">Loading…</div>
  const shifts = entries.filter(e => e.entry_type === 'shift')
  const hours = shifts.reduce((sum, e) => sum + shiftDurationHours(e.start_time, e.end_time), 0)
  const offs = entries.filter(e => e.entry_type === 'off').length
  return (
    <div className="driver-detail__stats">
      <div className="stat-pill">{formatHours(hours)} <small>scheduled</small></div>
      <div className="stat-pill">{shifts.length} <small>shifts</small></div>
      <div className="stat-pill">{offs} <small>off days</small></div>
    </div>
  )
}

function DriverList({ entries }: { entries: ScheduleEntry[] | null }) {
  if (entries === null) return <ul className="driver-detail__list"><li className="muted" style={{ padding: '10px' }}>Loading…</li></ul>
  if (!entries.length) return <ul className="driver-detail__list"><li className="muted" style={{ padding: '10px' }}>No entries.</li></ul>
  const sorted = entries.slice().sort((a, b) => a.schedule_date.localeCompare(b.schedule_date))
  return (
    <ul className="driver-detail__list">
      {sorted.map(e => {
        const d = fromIsoDate(e.schedule_date)
        const dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
        if (e.entry_type === 'off') {
          return (
            <li key={e.id} className="driver-detail__item driver-detail__item--off">
              <span className="driver-detail__date">{dateLabel}</span>
              <span>OFF · {e.off_reason || '—'}</span>
            </li>
          )
        }
        const overnight = e.end_time && e.start_time && e.end_time < e.start_time
        const hrs = shiftDurationHours(e.start_time, e.end_time)
        return (
          <li key={e.id} className="driver-detail__item">
            <span className="driver-detail__date">{dateLabel}</span>
            <span>
              {formatTime12(e.start_time)} – {formatTime12(e.end_time)}
              {overnight && <small> +1d</small>} · {formatHours(hrs)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
