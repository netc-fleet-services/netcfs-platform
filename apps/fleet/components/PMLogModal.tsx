'use client'

import { useState } from 'react'
import type { Truck, TruckPMAssignment, FleetProfile } from '@/lib/types'

function pmStatus(a: TruckPMAssignment): {
  remaining: number | null
  unit: string
  status: 'overdue' | 'soon' | 'ok' | 'unknown'
} {
  const { interval_type, interval_value } = a.pm_schedules
  if (interval_type === 'days' && a.last_pm_date) {
    const remaining = interval_value - Math.floor((Date.now() - new Date(a.last_pm_date).getTime()) / 864e5)
    return { remaining, unit: 'days', status: remaining < 0 ? 'overdue' : remaining < 30 ? 'soon' : 'ok' }
  }
  if (interval_type === 'miles' && a.last_pm_mileage != null && a.current_odometer != null) {
    const remaining = interval_value - (a.current_odometer - a.last_pm_mileage)
    return { remaining, unit: 'mi', status: remaining < 0 ? 'overdue' : remaining < 1500 ? 'soon' : 'ok' }
  }
  if (interval_type === 'hours' && a.last_pm_hours != null && a.current_hours != null) {
    const remaining = Math.round(interval_value - (a.current_hours - a.last_pm_hours))
    return { remaining, unit: 'hrs', status: remaining < 0 ? 'overdue' : remaining < 25 ? 'soon' : 'ok' }
  }
  return { remaining: null, unit: '', status: 'unknown' }
}

const STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  overdue: { color: 'var(--error)',          bg: 'var(--error-container)',    label: 'Overdue'   },
  soon:    { color: '#b45309',               bg: '#fef3c7',                   label: 'Due Soon'  },
  ok:      { color: 'var(--status-ready)',   bg: 'var(--status-ready-bg)',    label: 'OK'        },
  unknown: { color: 'var(--on-surface-muted)', bg: 'var(--surface-high)',     label: 'No data'   },
}

interface Props {
  truck: Truck
  profile: FleetProfile
  onClose: () => void
  onSaved: () => void
}

export function PMLogModal({ truck, profile, onClose, onSaved }: Props) {
  const today = new Date().toISOString().split('T')[0]
  const [loggingId, setLoggingId] = useState<string | null>(null)
  const [date, setDate]         = useState(today)
  const [mileage, setMileage]   = useState('')
  const [hours, setHours]       = useState('')
  const [saving, setSaving]     = useState(false)

  const canLog = profile.role !== 'driver'
  const assignments = truck.truck_pm_assignments ?? []

  function openLog(a: TruckPMAssignment) {
    setLoggingId(a.id)
    setDate(today)
    setMileage(a.current_odometer != null ? String(a.current_odometer) : '')
    setHours(a.current_hours != null ? String(a.current_hours) : '')
  }

  async function handleLog(a: TruckPMAssignment) {
    if (!date) return
    setSaving(true)
    const body: Record<string, unknown> = { assignmentId: a.id, date, loggedBy: profile.email }
    if (a.pm_schedules.interval_type === 'miles' && mileage) body.mileage = Number(mileage)
    if (a.pm_schedules.interval_type === 'hours' && hours)   body.hours   = Number(hours)

    const res = await fetch('/api/log-pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (!res.ok) { alert('Error saving: ' + (await res.text())); return }
    setLoggingId(null)
    onSaved()
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(500px, 95vw)', maxHeight: '85vh', overflowY: 'auto',
        background: 'var(--surface-container)', border: '1px solid var(--outline)',
        borderRadius: '0.875rem', padding: '1.25rem', zIndex: 201,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--on-surface)' }}>
              PM Log — Unit {truck.unit_number}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--on-surface-muted)', marginTop: 2 }}>
              {assignments.length} schedule{assignments.length !== 1 ? 's' : ''} assigned
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: 'var(--on-surface-muted)', lineHeight: 1, padding: '0.25rem', flexShrink: 0 }}
          >×</button>
        </div>

        {assignments.length === 0 && (
          <p style={{ color: 'var(--on-surface-muted)', fontSize: '0.875rem', fontStyle: 'italic', margin: 0 }}>
            No PM schedules are assigned to this truck yet.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {assignments.map(a => {
            const { remaining, unit, status } = pmStatus(a)
            const st = STATUS_STYLE[status]
            const isLogging = loggingId === a.id

            return (
              <div key={a.id} style={{
                background: 'var(--surface)', border: '1px solid var(--outline-variant)',
                borderRadius: '0.625rem', padding: '0.875rem 1rem',
              }}>
                {/* Schedule name + badge */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.3rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--on-surface)' }}>
                    {a.pm_schedules.name}
                  </div>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: st.bg, color: st.color, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {st.label}
                  </span>
                </div>

                {/* Interval + remaining */}
                <div style={{ fontSize: '0.75rem', color: 'var(--on-surface-muted)', marginBottom: '0.375rem' }}>
                  Every {a.pm_schedules.interval_value.toLocaleString()} {unit || a.pm_schedules.interval_type}
                  {remaining !== null && (
                    <span style={{ color: st.color, fontWeight: 600, marginLeft: 8 }}>
                      · {remaining < 0
                          ? `${Math.abs(remaining).toLocaleString()} ${unit} over`
                          : `${remaining.toLocaleString()} ${unit} remaining`}
                    </span>
                  )}
                </div>

                {/* Last PM info */}
                {a.last_pm_date && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--on-surface-muted)', marginBottom: '0.5rem' }}>
                    Last PM: {new Date(a.last_pm_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {a.last_pm_mileage != null && ` · ${a.last_pm_mileage.toLocaleString()} mi`}
                    {a.last_pm_hours   != null && ` · ${a.last_pm_hours} hrs`}
                  </div>
                )}

                {/* Log PM button */}
                {canLog && !isLogging && (
                  <button
                    className="btn-secondary"
                    style={{ fontSize: '0.78rem', padding: '0.25rem 0.75rem' }}
                    onClick={() => openLog(a)}
                  >
                    Log PM
                  </button>
                )}

                {/* Inline log form */}
                {isLogging && (
                  <div style={{ borderTop: '1px solid var(--outline-variant)', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--on-surface-muted)', marginBottom: 3 }}>
                          Date *
                        </label>
                        <input
                          className="form-input"
                          type="date"
                          value={date}
                          onChange={e => setDate(e.target.value)}
                          style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem' }}
                        />
                      </div>

                      {a.pm_schedules.interval_type === 'miles' && (
                        <div>
                          <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--on-surface-muted)', marginBottom: 3 }}>
                            Mileage at PM
                          </label>
                          <input
                            className="form-input"
                            type="number"
                            value={mileage}
                            onChange={e => setMileage(e.target.value)}
                            placeholder={a.current_odometer != null ? String(a.current_odometer) : 'e.g. 145000'}
                            style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem', width: 130 }}
                          />
                        </div>
                      )}

                      {a.pm_schedules.interval_type === 'hours' && (
                        <div>
                          <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--on-surface-muted)', marginBottom: 3 }}>
                            Hours at PM
                          </label>
                          <input
                            className="form-input"
                            type="number"
                            value={hours}
                            onChange={e => setHours(e.target.value)}
                            placeholder={a.current_hours != null ? String(a.current_hours) : 'e.g. 1200'}
                            style={{ fontSize: '0.82rem', padding: '0.3rem 0.5rem', width: 110 }}
                          />
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.625rem' }}>
                      <button
                        className="btn-primary"
                        style={{ fontSize: '0.78rem', padding: '0.3rem 0.875rem' }}
                        disabled={!date || saving}
                        onClick={() => handleLog(a)}
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button className="btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => setLoggingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
