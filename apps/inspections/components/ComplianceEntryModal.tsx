'use client'

import { useState, useEffect } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'

type Driver = { id: number; name: string; yard: string | null }

type Props = {
  onClose: () => void
  onSaved: () => void
}

const EVENT_TYPES = [
  { value: 'dot_citation', label: 'DOT Citation' },
  { value: 'oos',          label: 'Out of Service Order' },
  { value: 'accident',     label: 'Accident' },
  { value: 'other',        label: 'Other' },
]

const DEFAULT_POINTS: Record<string, number> = {
  dot_citation: 5,
  oos:          15,
  accident:     20,
  other:        0,
}

export function ComplianceEntryModal({ onClose, onSaved }: Props) {
  const supabase = getSupabaseBrowserClient()

  const [drivers, setDrivers] = useState<Driver[]>([])
  const [driverId, setDriverId]   = useState('')
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10))
  const [eventType, setEventType] = useState('dot_citation')
  const [points, setPoints]       = useState(5)
  const [notes, setNotes]         = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    supabase.from('drivers').select('id, name, yard').order('name').then(({ data }) => {
      setDrivers(data || [])
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill default points when event type changes
  function handleTypeChange(type: string) {
    setEventType(type)
    setPoints(DEFAULT_POINTS[type] ?? 0)
  }

  async function handleSave() {
    if (!driverId) { setError('Select a driver.'); return }
    setError('')
    setSaving(true)

    const driver = drivers.find(d => String(d.id) === driverId)
    const { data: { user } } = await supabase.auth.getUser()

    const { error: dbErr } = await supabase.from('compliance_events').insert({
      driver_id:   parseInt(driverId),
      driver_name: driver?.name ?? null,
      event_date:  eventDate,
      event_type:  eventType,
      points,
      notes:       notes.trim() || null,
      entered_by:  user?.email ?? null,
    })

    setSaving(false)
    if (dbErr) { setError(dbErr.message); return }
    onSaved()
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(480px, calc(100vw - 2rem))',
        background: 'rgb(var(--surface))',
        border: '1px solid rgb(var(--outline-variant))',
        borderRadius: '0.875rem',
        zIndex: 101,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '1.125rem 1.5rem', borderBottom: '1px solid rgb(var(--outline-variant))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgb(var(--primary))' }}>Safety Program</div>
            <h2 style={{ margin: '0.1rem 0 0', fontSize: '1.1rem', fontWeight: 800, color: 'rgb(var(--on-surface))' }}>Add Compliance Event</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'rgb(var(--on-surface-muted))' }}>✕</button>
        </div>

        {/* Form */}
        <div style={{ padding: '1.5rem' }}>
          <FormRow label="Driver">
            <select value={driverId} onChange={e => setDriverId(e.target.value)} style={selectStyle}>
              <option value="">— Select driver —</option>
              {drivers.map(d => (
                <option key={d.id} value={d.id}>{d.name}{d.yard ? ` (${d.yard})` : ''}</option>
              ))}
            </select>
          </FormRow>

          <FormRow label="Event Date">
            <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} style={inputStyle} />
          </FormRow>

          <FormRow label="Event Type">
            <select value={eventType} onChange={e => handleTypeChange(e.target.value)} style={selectStyle}>
              {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </FormRow>

          <FormRow label="Points">
            <input
              type="number" min={0} max={100}
              value={points}
              onChange={e => setPoints(parseInt(e.target.value) || 0)}
              style={{ ...inputStyle, width: 80 }}
            />
            <span style={{ fontSize: '0.8rem', color: 'rgb(var(--on-surface-muted))', marginLeft: '0.5rem' }}>deducted from safety score</span>
          </FormRow>

          <FormRow label="Notes">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Citation number, details, etc."
              rows={3}
              style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </FormRow>

          {error && <div style={{ color: 'rgb(var(--error))', fontSize: '0.82rem', marginBottom: '0.75rem' }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.625rem', marginTop: '0.5rem' }}>
            <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
              {saving ? 'Saving…' : 'Save Event'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'rgb(var(--on-surface-muted))', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </label>
      <div style={{ display: 'flex', alignItems: 'center' }}>{children}</div>
    </div>
  )
}

const baseInput = {
  padding: '0.45rem 0.625rem',
  fontSize: '0.875rem',
  background: 'rgb(var(--surface-container))',
  border: '1px solid rgb(var(--outline))',
  borderRadius: '0.5rem',
  color: 'rgb(var(--on-surface))',
  outline: 'none',
} as const

const inputStyle  = { ...baseInput }
const selectStyle = { ...baseInput, cursor: 'pointer', width: '100%' }

const cancelBtnStyle: React.CSSProperties = {
  padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600,
  background: 'transparent', border: '1px solid rgb(var(--outline))',
  borderRadius: '0.5rem', color: 'rgb(var(--on-surface))', cursor: 'pointer',
}

const saveBtnStyle: React.CSSProperties = {
  padding: '0.5rem 1.25rem', fontSize: '0.85rem', fontWeight: 700,
  background: 'rgb(var(--primary-container))', border: 'none',
  borderRadius: '0.5rem', color: 'rgb(var(--on-primary-container))', cursor: 'pointer',
}
