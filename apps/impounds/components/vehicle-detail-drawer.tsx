'use client'

import React, { useState, useRef } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { Impound, ImpoundPhoto, ImpoundProfile } from '@/lib/types'

interface Props {
  impound: Impound
  profile: ImpoundProfile
  onClose: () => void
  onSaved: () => void
}

type TriStateValue = boolean | null

function TriStateToggle({ label, value, onChange }: { label: string; value: TriStateValue; onChange: (v: TriStateValue) => void }) {
  const cycle = () => {
    if (value === null) onChange(true)
    else if (value === true) onChange(false)
    else onChange(null)
  }
  const bg  = value === true ? '#16a34a' : value === false ? '#dc2626' : 'rgb(var(--surface-high))'
  const txt = value === true ? 'Yes' : value === false ? 'No' : '?'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
      <span style={{ fontSize: '0.8rem', color: 'rgb(var(--on-surface-muted))', minWidth: 90 }}>{label}</span>
      <button type="button" onClick={cycle} style={{
        minWidth: 52, padding: '0.25rem 0.75rem', borderRadius: 9999,
        background: bg, color: value !== null ? '#fff' : 'rgb(var(--on-surface-muted))',
        border: '1px solid rgb(var(--outline))', cursor: 'pointer',
        fontWeight: 600, fontSize: '0.8rem', fontFamily: 'inherit',
      }}>{txt}</button>
    </div>
  )
}

function BoolToggle({ label, value, onChange, danger }: { label: string; value: boolean; onChange: (v: boolean) => void; danger?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: danger ? '#dc2626' : 'rgb(var(--primary))' }} />
      <span style={{ fontSize: '0.8rem', color: danger && value ? '#dc2626' : 'rgb(var(--on-surface))', fontWeight: danger && value ? 600 : 400 }}>
        {label}
      </span>
    </label>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <label style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgb(var(--on-surface-muted))' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

export function VehicleDetailDrawer({ impound, profile, onClose, onSaved }: Props) {
  const supabase = getSupabaseBrowserClient()
  const fileRef  = useRef<HTMLInputElement>(null)
  const [saving, setSaving]           = useState(false)
  const [uploading, setUploading]     = useState(false)
  const [deleting, setDeleting]       = useState<string | null>(null)
  const [estimating, setEstimating]   = useState(false)
  const [estimateNote, setEstimateNote] = useState<string | null>(null)

  const [form, setForm] = useState({
    call_number:           impound.call_number,
    date_of_impound:       impound.date_of_impound ?? '',
    make_model:            impound.make_model ?? '',
    year:                  impound.year ?? '',
    vin:                   impound.vin ?? '',
    reason_for_impound:    impound.reason_for_impound ?? '',
    notes:                 impound.notes ?? '',
    location:              impound.location ?? '',
    status:                impound.status ?? '',
    released:              impound.released,
    scrapped:              impound.scrapped,
    sold:                  impound.sold,
    amount_paid:           impound.amount_paid?.toString() ?? '',
    internal_cost:         impound.internal_cost?.toString() ?? '',
    sell:                  impound.sell,
    keys:                  impound.keys as TriStateValue,
    drives:                impound.drives as TriStateValue,
    sales_description:     impound.sales_description ?? '',
    estimated_value:       impound.estimated_value?.toString() ?? '',
    needs_detail:          impound.needs_detail,
    needs_mechanic:        impound.needs_mechanic,
    estimated_repair_cost: impound.estimated_repair_cost?.toString() ?? '',
  })

  const set = (k: keyof typeof form, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  async function handleSellToggle(v: boolean) {
    set('sell', v)
    if (!v) return
    // Only auto-fetch if estimated_value is not already set
    if (form.estimated_value) return
    if (!form.make_model && !impound.make_model) return

    setEstimating(true)
    setEstimateNote(null)
    try {
      const res = await fetch('/api/estimate-value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          make_model: form.make_model || impound.make_model,
          year:       form.year       || impound.year,
        }),
      })
      const data = await res.json()
      if (data.estimated_value) {
        set('estimated_value', String(data.estimated_value))
        setEstimateNote(
          data.comparable_count
            ? `Median of ${data.comparable_count} listings within 50mi · Range $${data.low?.toLocaleString()}–$${data.high?.toLocaleString()}`
            : 'No comparable listings found nearby'
        )
      } else {
        setEstimateNote('No comparable listings found nearby — enter a value manually')
      }
    } catch {
      setEstimateNote('Could not fetch estimate — enter a value manually')
    } finally {
      setEstimating(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    const wasDisposed = impound.sold || impound.scrapped || impound.released
    const nowDisposed = form.sold || form.scrapped || form.released
    const dispositionDate = nowDisposed && !wasDisposed
      ? new Date().toISOString()
      : (impound.disposition_date ?? null)

    const { error } = await supabase.from('impounds').update({
      call_number:           form.call_number,
      date_of_impound:       form.date_of_impound || null,
      make_model:            form.make_model || null,
      year:                  form.year || null,
      vin:                   form.vin || null,
      reason_for_impound:    form.reason_for_impound || null,
      notes:                 form.notes || null,
      location:              form.location || null,
      status:                form.status || null,
      released:              form.released,
      scrapped:              form.scrapped,
      sold:                  form.sold,
      disposition_date:      dispositionDate,
      amount_paid:           form.amount_paid    ? parseFloat(form.amount_paid)    : null,
      internal_cost:         form.internal_cost  ? parseFloat(form.internal_cost)  : null,
      sell:                  form.sell,
      keys:                  form.keys,
      drives:                form.drives,
      sales_description:     form.sales_description || null,
      estimated_value:       form.estimated_value ? parseFloat(form.estimated_value) : null,
      needs_detail:          form.needs_detail,
      needs_mechanic:        form.needs_mechanic,
      estimated_repair_cost: form.estimated_repair_cost ? parseFloat(form.estimated_repair_cost) : null,
    }).eq('id', impound.id)
    setSaving(false)
    if (error) { alert(error.message); return }
    onSaved()
    onClose()
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    for (const file of files) {
      const ext  = file.name.split('.').pop()
      const path = `${impound.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage.from('impound-photos').upload(path, file)
      if (upErr) { alert('Upload error: ' + upErr.message); continue }
      await supabase.from('impound_photos').insert({
        impound_id: impound.id, storage_path: path,
        file_name: file.name, uploaded_by: profile.email,
      })
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    onSaved()
  }

  async function handleDeletePhoto(photo: ImpoundPhoto) {
    setDeleting(photo.id)
    await supabase.storage.from('impound-photos').remove([photo.storage_path])
    await supabase.from('impound_photos').delete().eq('id', photo.id)
    setDeleting(null)
    onSaved()
  }

  function getPhotoUrl(path: string) {
    const { data } = supabase.storage.from('impound-photos').getPublicUrl(path)
    return data.publicUrl
  }

  const photos   = impound.impound_photos ?? []
  const canEdit  = ['admin', 'dispatcher', 'impound_manager'].includes(profile.role)

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem 0.75rem',
    background: 'rgb(var(--surface-high))',
    border: '1px solid rgb(var(--outline))',
    borderRadius: '0.5rem',
    color: 'rgb(var(--on-surface))',
    fontSize: '0.85rem',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  }

  const sectionHead: React.CSSProperties = {
    margin: '0 0 0.75rem', fontSize: '0.75rem', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.07em',
    color: 'rgb(var(--on-surface-muted))',
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 40 }} />

      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(560px, 100vw)',
        background: 'rgb(var(--surface-container))',
        borderLeft: '1px solid rgb(var(--outline))',
        zIndex: 50, display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.25rem', borderBottom: '1px solid rgb(var(--outline))',
          position: 'sticky', top: 0, background: 'rgb(var(--surface-container))', zIndex: 1,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'rgb(var(--on-surface))' }}>
              {impound.call_number}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'rgb(var(--on-surface-muted))' }}>
              {[impound.year, impound.make_model].filter(Boolean).join(' ') || 'Vehicle details'}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '1.5rem', color: 'rgb(var(--on-surface-muted))',
            lineHeight: 1, padding: '0.25rem',
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Vehicle Info */}
          <section>
            <h3 style={sectionHead}>Vehicle Info</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <Field label="Call Number">
                <input style={inputStyle} value={form.call_number} onChange={e => set('call_number', e.target.value)} readOnly={!canEdit} />
              </Field>
              <Field label="Date of Impound">
                <input type="date" style={inputStyle} value={form.date_of_impound} onChange={e => set('date_of_impound', e.target.value)} readOnly={!canEdit} />
              </Field>
              <Field label="Year">
                <input style={inputStyle} value={form.year} onChange={e => set('year', e.target.value)} readOnly={!canEdit} />
              </Field>
              <Field label="Make / Model">
                <input style={inputStyle} value={form.make_model} onChange={e => set('make_model', e.target.value)} readOnly={!canEdit} />
              </Field>
              <Field label="VIN">
                <input style={{ ...inputStyle, fontFamily: 'monospace' }} value={form.vin} onChange={e => set('vin', e.target.value)} readOnly={!canEdit} />
              </Field>
              <Field label="Reason for Impound">
                <input style={inputStyle} value={form.reason_for_impound} onChange={e => set('reason_for_impound', e.target.value)} readOnly={!canEdit} />
              </Field>
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <Field label="Notes">
                <textarea rows={3} style={{ ...inputStyle, resize: 'vertical' }}
                  value={form.notes} onChange={e => set('notes', e.target.value)} readOnly={!canEdit} />
              </Field>
            </div>
          </section>

          {/* Location & Status */}
          <section>
            <h3 style={sectionHead}>Location &amp; Status</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <Field label="Location">
                <input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} readOnly={!canEdit} />
              </Field>
              <Field label="Status">
                <input style={inputStyle} value={form.status} onChange={e => set('status', e.target.value)} readOnly={!canEdit} />
              </Field>
            </div>
          </section>

          {/* Vehicle Condition */}
          <section>
            <h3 style={sectionHead}>Vehicle Condition</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginBottom: '0.75rem' }}>
              <TriStateToggle label="Keys"   value={form.keys}   onChange={v => set('keys', v)} />
              <TriStateToggle label="Drives" value={form.drives} onChange={v => set('drives', v)} />
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <BoolToggle label="For Sale"       value={form.sell}         onChange={handleSellToggle} />
                <BoolToggle label="Needs Detail"   value={form.needs_detail}   onChange={v => set('needs_detail', v)} />
                <BoolToggle label="Needs Mechanic" value={form.needs_mechanic} onChange={v => set('needs_mechanic', v)} />
              </div>
            )}
          </section>

          {/* Financials */}
          <section>
            <h3 style={sectionHead}>Financials</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <Field label="Amount Paid">
                <input type="number" min="0" step="0.01" style={inputStyle}
                  value={form.amount_paid} onChange={e => set('amount_paid', e.target.value)} readOnly={!canEdit} />
              </Field>
              <Field label="Internal Cost">
                <input type="number" min="0" step="0.01" style={inputStyle}
                  value={form.internal_cost} onChange={e => set('internal_cost', e.target.value)} readOnly={!canEdit} />
              </Field>
              <Field label="Estimated Repair Cost">
                <input type="number" min="0" step="0.01" style={inputStyle}
                  value={form.estimated_repair_cost} onChange={e => set('estimated_repair_cost', e.target.value)} readOnly={!canEdit} />
              </Field>
              <Field label="Estimated Value">
                <div style={{ position: 'relative' }}>
                  <input type="number" min="0" step="0.01"
                    style={{ ...inputStyle, opacity: estimating ? 0.5 : 1 }}
                    value={form.estimated_value}
                    onChange={e => { set('estimated_value', e.target.value); setEstimateNote(null) }}
                    readOnly={!canEdit || estimating}
                    placeholder={estimating ? 'Fetching estimate…' : '0.00'}
                  />
                  {estimating && (
                    <div style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      width: 14, height: 14, border: '2px solid rgb(var(--outline))',
                      borderTopColor: 'rgb(var(--primary))', borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }} />
                  )}
                </div>
                {estimateNote && (
                  <span style={{ fontSize: '0.7rem', color: 'rgb(var(--on-surface-muted))', marginTop: '0.2rem' }}>
                    {estimateNote}
                  </span>
                )}
              </Field>
            </div>
          </section>

          {/* Sales */}
          <section>
            <h3 style={sectionHead}>Sales</h3>
            <Field label="Sales Description">
              <textarea rows={3} style={{ ...inputStyle, resize: 'vertical' }}
                value={form.sales_description} onChange={e => set('sales_description', e.target.value)} readOnly={!canEdit} />
            </Field>
          </section>

          {/* Photos */}
          <section>
            <h3 style={sectionHead}>Photos {photos.length > 0 && `(${photos.length})`}</h3>
            {photos.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {photos.map(photo => (
                  <div key={photo.id} style={{ position: 'relative', borderRadius: '0.5rem', overflow: 'hidden', aspectRatio: '1', background: 'rgb(var(--surface-high))' }}>
                    <img src={getPhotoUrl(photo.storage_path)} alt={photo.file_name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    {canEdit && (
                      <button onClick={() => handleDeletePhoto(photo)} disabled={deleting === photo.id} style={{
                        position: 'absolute', top: 4, right: 4,
                        background: 'rgba(0,0,0,0.65)', border: 'none', borderRadius: '50%',
                        width: 22, height: 22, cursor: 'pointer', color: '#fff', fontSize: '0.75rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>×</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canEdit && (
              <>
                <input ref={fileRef} type="file" accept="image/*" multiple
                  style={{ display: 'none' }} onChange={handlePhotoUpload} />
                <button type="button" className="btn-secondary"
                  onClick={() => fileRef.current?.click()} disabled={uploading} style={{ fontSize: '0.8rem' }}>
                  {uploading ? 'Uploading…' : '+ Add Photos'}
                </button>
              </>
            )}
          </section>
        </div>

        {/* Disposition — hidden from dashboard when any are checked */}
        {canEdit && (
          <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid rgb(var(--outline))' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgb(var(--on-surface-muted))', marginBottom: '0.625rem' }}>
              Disposition
            </div>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              <BoolToggle label="Released" value={form.released} onChange={v => set('released', v)} />
              <BoolToggle label="Scrapped" value={form.scrapped} onChange={v => set('scrapped', v)} danger />
              <BoolToggle label="Sold"     value={form.sold}     onChange={v => set('sold', v)}     danger />
            </div>
          </div>
        )}

        {/* Footer */}
        {canEdit && (
          <div style={{
            padding: '1rem 1.25rem', borderTop: '1px solid rgb(var(--outline))',
            display: 'flex', gap: '0.5rem', justifyContent: 'flex-end',
            position: 'sticky', bottom: 0, background: 'rgb(var(--surface-container))',
          }}>
            <button className="btn-secondary" onClick={onClose} style={{ fontSize: '0.875rem' }}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: '0.875rem', minWidth: 80 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
