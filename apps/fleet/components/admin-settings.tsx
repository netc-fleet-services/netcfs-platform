'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import { STATUS, STATUS_LABELS, CATEGORY_LABELS } from '@/lib/constants'
import type { FleetProfile, Location } from '@/lib/types'

interface TruckRow {
  id: string
  unit_number: string
  vin: string | null
  category: string | null
  location_id: string | null
  current_status: string
  active: boolean
  locations?: { name: string } | null
}

interface NotifSetting {
  id: string          // client-side key; equals db id for persisted rules
  category: string | null
  location_id: string | null
  emails: string[]
  rawEmailText: string  // what the user sees while typing — only parsed on blur/save
}

interface TruckForm {
  unit_number: string; vin: string; category: string
  location_id: string; current_status: string; active: boolean
}
const EMPTY_FORM: TruckForm = { unit_number: '', vin: '', category: '', location_id: '', current_status: STATUS.READY, active: true }

export function AdminSettings({ profile }: { profile: FleetProfile }) {
  const router = useRouter()
  const supabase = getSupabaseBrowserClient()

  const [tab, setTab] = useState('trucks')
  const [trucks, setTrucks] = useState<TruckRow[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [notifSettings, setNotifSettings] = useState<NotifSetting[]>([])
  const [tempCounter, setTempCounter] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const [editTruck, setEditTruck] = useState<TruckRow | null>(null)
  const [truckForm, setTruckForm] = useState(EMPTY_FORM)
  const [showTruckForm, setShowTruckForm] = useState(false)
  const [truckSearch, setTruckSearch] = useState('')

  useEffect(() => {
    fetchAll().then(() => setLoading(false))
  }, [])

  async function fetchAll() {
    const [{ data: t }, { data: l }, { data: n }] = await Promise.all([
      supabase.from('trucks').select('*, locations(name)').order('unit_number'),
      supabase.from('locations').select('*').order('name'),
      supabase.from('notification_settings').select('*'),
    ])
    setTrucks(t || [])
    setLocations(l || [])
    setNotifSettings(
      (n || []).map((r: { id: string; category: string | null; location_id: string | null; emails: string[] }) => ({
        id:           r.id,
        category:     r.category,
        location_id:  r.location_id,
        emails:       r.emails ?? [],
        rawEmailText: (r.emails ?? []).join(', '),
      }))
    )
  }

  function openNewTruck() {
    setEditTruck(null)
    setTruckForm(EMPTY_FORM)
    setShowTruckForm(true)
  }

  function openEditTruck(truck: TruckRow) {
    setEditTruck(truck)
    setTruckForm({
      unit_number: truck.unit_number, vin: truck.vin || '',
      category: truck.category || '', location_id: truck.location_id || '',
      current_status: truck.current_status, active: truck.active,
    })
    setShowTruckForm(true)
  }

  async function saveTruck(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setMsg('')
    const payload = {
      unit_number: truckForm.unit_number.trim(),
      vin: truckForm.vin.trim() || null,
      category: truckForm.category || null,
      location_id: truckForm.location_id || null,
      current_status: truckForm.current_status,
      active: truckForm.active,
    }
    const { error } = editTruck
      ? await supabase.from('trucks').update(payload).eq('id', editTruck.id)
      : await supabase.from('trucks').insert(payload)

    if (error) {
      setMsg('Error: ' + error.message)
    } else {
      setMsg(editTruck ? 'Truck updated.' : 'Truck added.')
      setShowTruckForm(false)
      fetchAll()
    }
    setSaving(false)
  }

  async function deactivateTruck(truck: TruckRow) {
    if (!confirm(`Deactivate ${truck.unit_number}? It will be hidden from the dashboard.`)) return
    await supabase.from('trucks').update({ active: false }).eq('id', truck.id)
    fetchAll()
  }

  async function reactivateTruck(truck: TruckRow) {
    await supabase.from('trucks').update({ active: true }).eq('id', truck.id)
    fetchAll()
  }

  function addNotifRule() {
    setTempCounter(n => {
      setNotifSettings(prev => [...prev, { id: `__new_${n}`, category: null, location_id: null, emails: [], rawEmailText: '' }])
      return n + 1
    })
  }

  function removeNotifRule(id: string) {
    setNotifSettings(prev => prev.filter(s => s.id !== id))
  }

  function updateNotifRule(id: string, patch: Partial<Omit<NotifSetting, 'id'>>) {
    setNotifSettings(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  async function saveAllNotifSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setMsg('')
    // Delete all rows then re-insert current state
    const { error: delErr } = await supabase.from('notification_settings').delete().not('id', 'is', null)
    if (delErr) { setMsg('Error: ' + delErr.message); setSaving(false); return }
    const rows = notifSettings
      .map(s => {
        // Re-parse rawEmailText in case the user never blurred the field before saving
        const emails = s.rawEmailText
          ? s.rawEmailText.split(',').map(x => x.trim()).filter(Boolean)
          : s.emails
        return { category: s.category || null, location_id: s.location_id || null, emails }
      })
      .filter(s => s.emails.length > 0)
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('notification_settings').insert(rows)
      if (insErr) { setMsg('Error: ' + insErr.message); setSaving(false); return }
    }
    setMsg('Notification settings saved.')
    fetchAll()
    setSaving(false)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--outline)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
      <header style={{ borderBottom: '1px solid var(--outline)', padding: '0 1.25rem' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', height: 56, display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <img src="/logo-main.png" alt="NETC Fleet Services" style={{ height: 32 }} />
        </div>
      </header>

      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '1.5rem 1.25rem 4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <button className="btn-ghost" onClick={() => router.push('/')}>← Dashboard</button>
          <h1 style={{ margin: 0, fontWeight: 800, fontSize: '1.375rem', color: 'var(--on-surface)' }}>Admin Settings</h1>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--outline)', paddingBottom: '0.75rem', marginBottom: '1.5rem' }}>
          {([['trucks', 'Manage Trucks'], ...(profile.role === 'admin' ? [['notifications', 'Notifications']] : [])] as [string, string][]).map(([id, label]) => (
            <button key={id} className={tab === id ? 'btn-primary' : 'btn-secondary'} style={{ fontSize: '0.8125rem' }} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {msg && (
          <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'var(--primary-container)', border: '1px solid var(--primary)', borderRadius: '0.5rem', color: 'var(--on-primary-container)', fontSize: '0.875rem' }}>
            {msg}
          </div>
        )}

        {tab === 'trucks' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
              <input
                type="search"
                className="form-input"
                placeholder="Search by unit #, VIN, category, location…"
                value={truckSearch}
                onChange={e => setTruckSearch(e.target.value)}
                style={{ maxWidth: 320, fontSize: '0.85rem', padding: '0.375rem 0.75rem' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <p style={{ color: 'var(--on-surface-muted)', fontSize: '0.875rem', margin: 0, whiteSpace: 'nowrap' }}>
                  {trucks.filter(t => t.active).length} active trucks
                </p>
                <button className="btn-primary" style={{ fontSize: '0.8125rem' }} onClick={openNewTruck}>+ Add Truck</button>
              </div>
            </div>

            {showTruckForm && (
              <>
                <div onClick={() => setShowTruckForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 40 }} />
                <div style={{
                  position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                  width: 'min(560px, 95vw)', maxHeight: '90vh', overflowY: 'auto',
                  background: 'var(--surface-container)', border: '1px solid var(--outline)',
                  borderRadius: '0.875rem', padding: '1.5rem', zIndex: 50,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                    <h3 style={{ margin: 0, fontWeight: 700, fontSize: '1rem', color: 'var(--on-surface)' }}>
                      {editTruck ? `Edit ${editTruck.unit_number}` : 'Add New Truck'}
                    </h3>
                    <button type="button" onClick={() => setShowTruckForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: 'var(--on-surface-muted)', lineHeight: 1, padding: '0.25rem' }}>×</button>
                  </div>
                  <form onSubmit={saveTruck}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label className="form-label">Unit Number *</label>
                        <input className="form-input" value={truckForm.unit_number} onChange={e => setTruckForm(f => ({ ...f, unit_number: e.target.value }))} required placeholder="e.g. T-101" />
                      </div>
                      <div>
                        <label className="form-label">VIN <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--on-surface-muted)' }}>(optional)</span></label>
                        <input className="form-input" value={truckForm.vin} onChange={e => setTruckForm(f => ({ ...f, vin: e.target.value }))} placeholder="17-character VIN" maxLength={17} />
                      </div>
                      <div>
                        <label className="form-label">Category</label>
                        <select className="form-select" value={truckForm.category} onChange={e => setTruckForm(f => ({ ...f, category: e.target.value }))}>
                          <option value="">-- No Category --</option>
                          {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="form-label">Location</label>
                        <select className="form-select" value={truckForm.location_id} onChange={e => setTruckForm(f => ({ ...f, location_id: e.target.value }))}>
                          <option value="">-- No Location --</option>
                          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="form-label">Initial Status</label>
                        <select className="form-select" value={truckForm.current_status} onChange={e => setTruckForm(f => ({ ...f, current_status: e.target.value }))}>
                          {Object.entries(STATUS_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                      <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : editTruck ? 'Save Changes' : 'Add Truck'}</button>
                      <button type="button" className="btn-secondary" onClick={() => setShowTruckForm(false)}>Cancel</button>
                    </div>
                  </form>
                </div>
              </>
            )}

            <div style={{ background: 'var(--surface-container)', border: '1px solid var(--outline-variant)', borderRadius: '0.75rem', overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="fleet-table">
                  <thead>
                    <tr><th>Unit</th><th>VIN</th><th>Category</th><th>Location</th><th>Status</th><th>Active</th><th></th></tr>
                  </thead>
                  <tbody>
                    {trucks.filter(t => {
                      if (!truckSearch) return true
                      const q = truckSearch.toLowerCase()
                      return t.unit_number.toLowerCase().includes(q) ||
                        (t.vin || '').toLowerCase().includes(q) ||
                        (CATEGORY_LABELS[t.category || ''] || '').toLowerCase().includes(q) ||
                        (t.locations?.name || '').toLowerCase().includes(q)
                    }).map(truck => (
                      <tr key={truck.id} style={{ opacity: truck.active ? 1 : 0.55 }}>
                        <td style={{ fontWeight: 600 }}>{truck.unit_number}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--on-surface-muted)' }}>{truck.vin || '—'}</td>
                        <td>{CATEGORY_LABELS[truck.category ?? ''] || '—'}</td>
                        <td>{truck.locations?.name || '—'}</td>
                        <td><span className={`status-badge status-badge-${truck.current_status}`}>{STATUS_LABELS[truck.current_status]}</span></td>
                        <td><span style={{ color: truck.active ? 'var(--status-ready)' : 'var(--on-surface-muted)', fontSize: '0.75rem' }}>{truck.active ? 'Active' : 'Inactive'}</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn-ghost" onClick={() => openEditTruck(truck)}>Edit</button>
                            {truck.active
                              ? <button className="btn-ghost" style={{ color: 'var(--error)' }} onClick={() => deactivateTruck(truck)}>Deactivate</button>
                              : <button className="btn-ghost" style={{ color: 'var(--status-ready)' }} onClick={() => reactivateTruck(truck)}>Reactivate</button>
                            }
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'notifications' && (
          <div>
            <p style={{ color: 'var(--on-surface-muted)', fontSize: '0.875rem', marginBottom: '1.5rem', marginTop: 0 }}>
              Emails are sent instantly when a truck status changes. Each rule targets a specific
              category and/or location — use &ldquo;All&rdquo; to match any. A truck must match
              every filter on a rule for those recipients to be notified.
            </p>

            <form onSubmit={saveAllNotifSettings}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                {notifSettings.length === 0 && (
                  <p style={{ color: 'var(--on-surface-muted)', fontSize: '0.8125rem', fontStyle: 'italic', margin: 0 }}>
                    No rules yet — add one below.
                  </p>
                )}

                {notifSettings.map(rule => (
                  <div key={rule.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: '0.625rem', alignItems: 'center', background: 'var(--surface-container)', border: '1px solid var(--outline)', borderRadius: '0.625rem', padding: '0.75rem 1rem' }}>
                    <div>
                      <label className="form-label" style={{ marginBottom: '0.25rem' }}>Category</label>
                      <select
                        className="form-select"
                        value={rule.category ?? ''}
                        onChange={e => updateNotifRule(rule.id, { category: e.target.value || null })}
                      >
                        <option value="">All Categories</option>
                        {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                          <option key={val} value={val}>{label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="form-label" style={{ marginBottom: '0.25rem' }}>Location</label>
                      <select
                        className="form-select"
                        value={rule.location_id ?? ''}
                        onChange={e => updateNotifRule(rule.id, { location_id: e.target.value || null })}
                      >
                        <option value="">All Locations</option>
                        {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="form-label" style={{ marginBottom: '0.25rem' }}>Recipients (comma-separated)</label>
                      <input
                        className="form-input"
                        type="text"
                        placeholder="user@example.com, manager@example.com"
                        value={rule.rawEmailText}
                        onChange={e => updateNotifRule(rule.id, { rawEmailText: e.target.value })}
                        onBlur={e => updateNotifRule(rule.id, {
                          emails: e.target.value.split(',').map(x => x.trim()).filter(Boolean),
                        })}
                      />
                    </div>

                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ color: 'var(--error)', alignSelf: 'flex-end', padding: '0.5rem 0.625rem' }}
                      onClick={() => removeNotifRule(rule.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button type="button" className="btn-secondary" style={{ fontSize: '0.8125rem' }} onClick={addNotifRule}>
                  + Add Rule
                </button>
                <button type="submit" className="btn-primary" style={{ fontSize: '0.8125rem' }} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Notification Settings'}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}
