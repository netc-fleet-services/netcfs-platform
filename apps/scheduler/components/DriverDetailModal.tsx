'use client'

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Driver, ScheduleEntry } from '../lib/types'
import { listScheduleBetween } from '../lib/db'
import { addDays, formatHours, formatTime12, fromIsoDate, shiftDurationHours, toIsoDate } from '../lib/utils'

interface Props {
  supabase: SupabaseClient
  driver: Driver
  onClose: () => void
}

export function DriverDetailModal({ supabase, driver, onClose }: Props) {
  const [past7, setPast7] = useState<ScheduleEntry[]>([])
  const [future7, setFuture7] = useState<ScheduleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    const today = new Date()
    const past = toIsoDate(addDays(today, -7))
    const future = toIsoDate(addDays(today, 7))
    const todayIso = toIsoDate(today)

    listScheduleBetween(supabase, past, future)
      .then(entries => {
        if (!alive) return
        const filtered = entries.filter(e => e.driver_id === driver.id)
        setPast7(filtered.filter(e => e.schedule_date < todayIso))
        setFuture7(filtered.filter(e => e.schedule_date >= todayIso))
      })
      .catch(err => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Failed to load.')
      })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false }
  }, [supabase, driver.id])

  return (
    <div className="modal modal--wide" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel modal__panel--wide">
        <header className="modal__header">
          <div>
            <h2>{driver.name || '(unnamed)'}</h2>
            <div className="muted">
              #{driver.irh_driver_number || driver.id} · {driver.function || '—'}
              {driver.irh_yard_number ? ` · yard ${driver.irh_yard_number}` : ''}
            </div>
          </div>
          <button type="button" className="sched-btn sched-btn--ghost modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal__body">
          {error ? (
            <div className="form-error">{error}</div>
          ) : (
            <div className="driver-detail__grid">
              <div className="driver-detail__col">
                <h3>Past 7 days</h3>
                <DriverStats entries={loading ? null : past7} />
                <DriverList entries={loading ? null : past7} />
              </div>
              <div className="driver-detail__col">
                <h3>Upcoming 7 days</h3>
                <DriverStats entries={loading ? null : future7} />
                <DriverList entries={loading ? null : future7} />
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
