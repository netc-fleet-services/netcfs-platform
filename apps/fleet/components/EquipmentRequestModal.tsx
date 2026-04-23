'use client'

import { useState } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { FleetProfile } from '@/lib/types'

interface Props {
  profile: FleetProfile
  onClose: () => void
}

export function EquipmentRequestModal({ profile, onClose }: Props) {
  const supabase = getSupabaseBrowserClient()

  const [urgent,          setUrgent]         = useState(false)
  const [requestType,     setRequestType]     = useState<'replacement' | 'new' | ''>('')
  const [description,     setDescription]     = useState('')
  const [purpose,         setPurpose]         = useState('')
  const [ifNotPurchased,  setIfNotPurchased]  = useState('')
  const [requesterName,   setRequesterName]   = useState(
    profile.email?.includes('@') ? profile.email.split('@')[0].replace(/[._]/g, ' ') : (profile.email ?? '')
  )
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!requestType) { setError('Please select a request type.'); return }

    setSaving(true)
    const { error: dbErr } = await supabase.from('equipment_requests').insert({
      submitted_by:    requesterName.trim(),
      urgent,
      request_type:    requestType,
      description:     description.trim(),
      purpose:         purpose.trim(),
      if_not_purchased: ifNotPurchased.trim(),
    })

    if (dbErr) { setError(dbErr.message); setSaving(false); return }

    fetch('/api/notify-equipment-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submittedBy:     requesterName.trim(),
        urgent,
        requestType,
        description:     description.trim(),
        purpose:         purpose.trim(),
        ifNotPurchased:  ifNotPurchased.trim(),
      }),
    }).catch(() => {})

    setSaving(false)
    onClose()
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem 0.75rem', background: 'var(--surface-high)',
    border: '1px solid var(--outline)', borderRadius: '0.375rem',
    color: 'var(--on-surface)', fontSize: '0.875rem', fontFamily: 'inherit',
    resize: 'vertical' as const, boxSizing: 'border-box' as const,
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 40 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(600px, 97vw)', maxHeight: '92vh', overflowY: 'auto',
        background: 'var(--surface-container)', border: '1px solid var(--outline)',
        borderRadius: '0.875rem', padding: '1.5rem', zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 800, fontSize: '1rem', color: 'var(--on-surface)' }}>
              Request for Tools or Equipment
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--on-surface-muted)' }}>
              Complete form and submit — your manager will be notified
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: 'var(--on-surface-muted)', lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Urgent checkbox */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer',
            padding: '0.625rem 0.875rem', marginBottom: '1rem',
            background: urgent ? 'rgba(239,68,68,0.1)' : 'var(--surface)',
            border: `1px solid ${urgent ? 'var(--error)' : 'var(--outline)'}`,
            borderRadius: '0.5rem',
          }}>
            <input
              type="checkbox"
              checked={urgent}
              onChange={e => setUrgent(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--error)', cursor: 'pointer' }}
            />
            <span style={{ fontWeight: 700, fontSize: '0.875rem', color: urgent ? 'var(--error)' : 'var(--on-surface)' }}>
              This is an urgent need — bring to manager immediately
            </span>
          </label>

          {/* Date + requester */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <label className="form-label">Date</label>
              <input className="form-input" value={new Date().toLocaleDateString('en-US')} readOnly style={{ opacity: 0.7 }} />
            </div>
            <div>
              <label className="form-label">Requester Name *</label>
              <input className="form-input" value={requesterName} onChange={e => setRequesterName(e.target.value)} required placeholder="Your name" />
            </div>
          </div>

          {/* Request type */}
          <div style={{ marginBottom: '1rem' }}>
            <label className="form-label">Request Type *</label>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              {(['replacement', 'new'] as const).map(val => (
                <label key={val} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer',
                  padding: '0.5rem 0.875rem', flex: 1,
                  background: requestType === val ? 'var(--primary-container)' : 'var(--surface)',
                  border: `1px solid ${requestType === val ? 'var(--primary)' : 'var(--outline)'}`,
                  borderRadius: '0.5rem',
                }}>
                  <input type="radio" name="request_type" value={val} checked={requestType === val} onChange={() => setRequestType(val)} style={{ accentColor: 'var(--primary)' }} />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--on-surface)' }}>
                    {val === 'replacement' ? 'Broken / Damage Replacement' : 'New Equipment / Tool Request'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: '1rem' }}>
            <label className="form-label">Description of tool / equipment requested *</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              required
              rows={3}
              placeholder="What specifically are you requesting?"
              style={fieldStyle}
            />
          </div>

          {/* Purpose */}
          <div style={{ marginBottom: '1rem' }}>
            <label className="form-label">Purpose of the tool / equipment *</label>
            <textarea
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              required
              rows={3}
              placeholder="What will this be used for?"
              style={fieldStyle}
            />
          </div>

          {/* If not purchased */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label className="form-label">What is done now / what needs to be done if NOT purchased? *</label>
            <textarea
              value={ifNotPurchased}
              onChange={e => setIfNotPurchased(e.target.value)}
              required
              rows={3}
              placeholder="Describe the current workaround or impact if this is not approved"
              style={fieldStyle}
            />
          </div>

          {error && (
            <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--error-container)', border: '1px solid var(--error)', borderRadius: '0.375rem', color: 'var(--error)', fontSize: '0.8rem' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Submitting…' : 'Submit Request'}</button>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </>
  )
}
