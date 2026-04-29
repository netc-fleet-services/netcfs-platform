'use client'

import { useState } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { Truck } from '@/lib/types'

interface InspectionItem {
  key: string
  label: string
  rating: 'ok' | 'na' | 'bad' | ''
  comment: string
}

interface Section {
  title: string
  items: { key: string; label: string }[]
}

const SECTIONS: Section[] = [
  {
    title: 'Driver & Cab',
    items: [
      { key: 'drivers_license', label: "Driver's license and medical card are current (spot check)" },
      { key: 'cab_clean',       label: 'Cab is clean and free of clutter; waste is managed' },
      { key: 'seatbelts',       label: 'Seatbelts are in good working condition' },
      { key: 'dvir_book',       label: 'DVIR book is present and being completed daily' },
    ],
  },
  {
    title: 'Emergency Equipment',
    items: [
      { key: 'fire_extinguisher',   label: 'Fire extinguisher is charged, inspected, and properly mounted' },
      { key: 'emergency_triangles', label: 'Emergency triangles or flares are present and accessible' },
      { key: 'first_aid_kit',       label: 'First aid kit is stocked and accessible' },
      { key: 'spill_kit',           label: 'Spill kit is stocked and accessible (as required by vehicle type)' },
    ],
  },
  {
    title: 'Vehicle Condition & Safety Systems',
    items: [
      { key: 'warning_lights', label: 'All required warning lights (strobes, beacons, arrow boards) are functional' },
      { key: 'tires_brakes',   label: 'Tires, wheels, and brakes appear to be in safe condition' },
      { key: 'hoses_cords',    label: 'Hoses and electrical cords on the vehicle are in good condition' },
    ],
  },
  {
    title: 'Towing / Road Service Equipment',
    items: [
      { key: 'rigging',     label: 'All rigging (chains, straps, hooks) is inspected and in good condition' },
      { key: 'winch',       label: 'Winch, cable, and hook are in good condition' },
      { key: 'jack_stands', label: 'Jack and jack stands are in good condition with no defects' },
      { key: 'hand_tools',  label: 'Hand tools are in good condition' },
    ],
  },
  {
    title: 'Cargo Securement (Transportation)',
    items: [
      { key: 'tiedowns', label: 'All tiedowns, chains, and binders are in good condition and properly stored' },
      { key: 'fmcsa',    label: 'All securement equipment meets FMCSA requirements' },
    ],
  },
]

const ALL_ITEMS: { key: string; label: string; section: string }[] = SECTIONS.flatMap(s =>
  s.items.map(item => ({ ...item, section: s.title }))
)

function buildInitialItems(): InspectionItem[] {
  return ALL_ITEMS.map(({ key, label }) => ({ key, label, rating: '', comment: '' }))
}

interface Props {
  truck: Truck
  onClose: () => void
  onSaved: () => void
}

// Explicit hex colors — safe in inline styles for both light and dark themes
const RATING_COLOR: Record<string, string> = {
  ok:  '#16a34a',
  na:  '#6b7280',
  bad: '#dc2626',
}

export function InspectionModal({ truck, onClose, onSaved }: Props) {
  const supabase = getSupabaseBrowserClient()
  const [inspector, setInspector]   = useState('')
  const [date,      setDate]        = useState(new Date().toISOString().slice(0, 10))
  const [items,     setItems]       = useState<InspectionItem[]>(buildInitialItems)
  const [saving,    setSaving]      = useState(false)
  const [error,     setError]       = useState('')

  function setRating(key: string, rating: InspectionItem['rating']) {
    setItems(prev => prev.map(i => i.key === key ? { ...i, rating } : i))
  }

  function setComment(key: string, comment: string) {
    setItems(prev => prev.map(i => i.key === key ? { ...i, comment } : i))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const unanswered = items.filter(i => i.rating === '')
    if (unanswered.length > 0) {
      setError(`Please rate all items. Missing: ${unanswered.length} item(s).`)
      return
    }
    if (!inspector.trim()) { setError('Inspector name is required.'); return }

    setSaving(true)
    const has_fails = items.some(i => i.rating === 'bad')

    const { error: dbErr } = await supabase.from('vehicle_inspections').insert({
      truck_id:       truck.id,
      unit_number:    truck.unit_number,
      inspector:      inspector.trim(),
      inspected_date: date,
      items:          items,
      has_fails,
    })

    if (dbErr) { setError(dbErr.message); setSaving(false); return }

    const failItems = items.filter(i => i.rating === 'bad')
    const allItems  = items.map(i => ({
      key:     i.key,
      label:   i.label,
      section: ALL_ITEMS.find(a => a.key === i.key)?.section ?? '',
      rating:  i.rating,
      comment: i.comment,
    }))
    fetch('/api/notify-inspection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        truckId:    truck.id,
        unitNumber: truck.unit_number,
        inspector:  inspector.trim(),
        date,
        hasFails:   has_fails,
        failItems:  failItems.map(i => ({ label: i.label, comment: i.comment })),
        allItems,
      }),
    }).catch(() => {})

    setSaving(false)
    onSaved()
    onClose()
  }

  const ratingBtn = (key: string, val: InspectionItem['rating'], current: string, label: string) => {
    const selected = current === val
    const color    = RATING_COLOR[val] ?? '#6b7280'
    return (
      <button
        type="button"
        onClick={() => setRating(key, val)}
        style={{
          padding: '3px 10px', fontSize: 11, fontWeight: 700, borderRadius: 4, cursor: 'pointer',
          border:      `1px solid ${selected ? color : 'rgb(var(--outline))'}`,
          background:  selected ? color : 'transparent',
          color:       selected ? '#fff' : 'rgb(var(--on-surface-muted))',
          transition:  'background 0.1s, border-color 0.1s, color 0.1s',
        }}
      >
        {label}
      </button>
    )
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 40 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(700px, 97vw)', maxHeight: '92vh', overflowY: 'auto',
        background: 'rgb(var(--surface-container))',
        border: '1px solid rgb(var(--outline))',
        borderRadius: '0.875rem', padding: '1.5rem', zIndex: 50,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 800, fontSize: '1rem', color: 'rgb(var(--on-surface))' }}>
              Monthly Vehicle Inspection
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'rgb(var(--on-surface-muted))' }}>
              Towing / Road Service / Transportation Checklist
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: 'rgb(var(--on-surface-muted))', lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Header fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div>
              <label className="form-label">Vehicle / Unit #</label>
              <input className="form-input" value={truck.unit_number} readOnly style={{ opacity: 0.7 }} />
            </div>
            <div>
              <label className="form-label">Date *</label>
              <input className="form-input" type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
            <div>
              <label className="form-label">Inspector *</label>
              <input className="form-input" value={inspector} onChange={e => setInspector(e.target.value)} placeholder="Your name" required />
            </div>
          </div>

          {/* Instruction note */}
          <p style={{ fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))', marginBottom: '1rem', fontStyle: 'italic' }}>
            Mark each item OK, N/A, or Bad. Add comments for any Bad items.
          </p>

          {/* Sections */}
          {SECTIONS.map(section => (
            <div key={section.title} style={{ marginBottom: '1rem' }}>
              <div style={{
                fontSize: '0.75rem', fontWeight: 800, color: 'rgb(var(--primary))', textTransform: 'uppercase',
                letterSpacing: '0.05em', paddingBottom: '0.375rem', marginBottom: '0.5rem',
                borderBottom: '1px solid rgb(var(--outline-variant))',
              }}>
                {section.title}
              </div>
              {section.items.map(({ key, label }) => {
                const item = items.find(i => i.key === key)!
                return (
                  <div key={key} style={{ marginBottom: '0.625rem', padding: '0.5rem 0.625rem', background: 'rgb(var(--surface))', borderRadius: '0.375rem' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.8125rem', color: 'rgb(var(--on-surface))', flex: 1, minWidth: 200, paddingTop: 2 }}>{label}</span>
                      <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                        {ratingBtn(key, 'ok',  item.rating, 'OK')}
                        {ratingBtn(key, 'na',  item.rating, 'N/A')}
                        {ratingBtn(key, 'bad', item.rating, 'Bad')}
                      </div>
                    </div>
                    {item.rating === 'bad' && (
                      <input
                        className="form-input"
                        placeholder="Comments / Corrective Action"
                        value={item.comment}
                        onChange={e => setComment(key, e.target.value)}
                        style={{ marginTop: '0.4rem', fontSize: '0.8rem' }}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ))}

          {error && (
            <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgb(var(--error-container))', border: '1px solid rgb(var(--error))', borderRadius: '0.375rem', color: 'rgb(var(--error))', fontSize: '0.8rem' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Submitting…' : 'Submit Inspection'}</button>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </>
  )
}
