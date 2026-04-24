'use client'

import { useState, useEffect } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'

type Driver = { id: number; name: string; yard: string | null }

type Props = {
  onClose: () => void
  onSaved: () => void
}

export function ManualDvirModal({ onClose, onSaved }: Props) {
  const supabase = getSupabaseBrowserClient()

  const [drivers, setDrivers] = useState<Driver[]>([])
  const [driverId, setDriverId]   = useState('')
  const [logDate, setLogDate]     = useState(new Date().toISOString().slice(0, 10))
  const [completed, setCompleted] = useState(true)
  const [notes, setNotes]         = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    supabase.from('drivers').select('id, name, yard').order('name').then(({ data }) => {
      setDrivers(data || [])
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!driverId) { setError('Select a driver.'); return }
    setError('')
    setSaving(true)

    const driver = drivers.find(d => String(d.id) === driverId)

    const { error: dbErr } = await supabase.from('dvir_logs').upsert({
      driver_id:   parseInt(driverId),
      driver_name: driver?.name ?? null,
      log_date:    logDate,
      completed,
      source:      'manual',
      notes:       notes.trim() || null,
    }, { onConflict: 'driver_id,log_date' })

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
        width: 'min(440px, calc(100vw - 2rem))',
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
            <h2 style={{ margin: '0.1rem 0 0', fontSize: '1.1rem', fontWeight: 800, color: 'rgb(var(--on-surface))' }}>Log Manual DVIR</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'rgb(var(--on-surface-muted))' }}>✕</button>
        </div>

        {/* Form */}
        <div style={{ padding: '1.5rem' }}>
          <div style={{ fontSize: '0.8rem', color: 'rgb(var(--on-surface-muted))', marginBottom: '1.25rem', lineHeight: 1.5 }}>
            For non-Interstate drivers who submit paper DVIRs. Interstate drivers are synced automatically from Samsara.
          </div>

          <FormRow label="Driver">
            <select value={driverId} onChange={e => setDriverId(e.target.value)} style={selectStyle}>
              <option value="">— Select driver —</option>
              {drivers.map(d => (
                <option key={d.id} value={d.id}>{d.name}{d.yard ? ` (${d.yard})` : ''}</option>
              ))}
            </select>
          </FormRow>

          <FormRow label="Date">
            <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)} style={inputStyle} />
          </FormRow>

          <FormRow label="Status">
            <div style={{ display: 'flex', gap: '0.625rem' }}>
              {[
                { value: true,  label: 'Completed', color: '#4ade80' },
                { value: false, label: 'Missed',    color: '#f59e0b' },
              ].map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => setCompleted(opt.value)}
                  style={{
                    padding: '0.45rem 1rem',
                    fontSize: '0.85rem', fontWeight: 600,
                    borderRadius: '0.5rem',
                    border: `2px solid ${completed === opt.value ? opt.color : 'rgb(var(--outline))'}`,
                    background: completed === opt.value ? opt.color + '22' : 'transparent',
                    color: completed === opt.value ? opt.color : 'rgb(var(--on-surface-muted))',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </FormRow>

          <FormRow label="Notes">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional notes"
              rows={2}
              style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </FormRow>

          {error && <div style={{ color: 'rgb(var(--error))', fontSize: '0.82rem', marginBottom: '0.75rem' }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.625rem', marginTop: '0.5rem' }}>
            <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
              {saving ? 'Saving…' : 'Save DVIR'}
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
      {children}
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
