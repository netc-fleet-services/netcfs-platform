'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { Impound, ImpoundProfile } from '@/lib/types'
import { IMPOUND_STATUSES, IMPOUND_LOCATIONS, SCRAP_VALUE } from '@/lib/constants'
import { VehicleDetailDrawer } from './vehicle-detail-drawer'
import { SalesHistoryModal } from './sales-history-modal'

const IMPOUND_QUERY = `*, impound_photos(*)`

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function currency(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function timeOnLot(dateOfImpound: string | null): { label: string; color: string } {
  if (!dateOfImpound) return { label: '—', color: 'rgb(var(--on-surface-muted))' }
  const days = Math.floor((Date.now() - new Date(dateOfImpound).getTime()) / (1000 * 60 * 60 * 24))
  if (days < 30)  return { label: `${days}d`,    color: '#16a34a' }
  if (days < 90)  return { label: '1–3 mo',      color: '#ca8a04' }
  if (days < 180) return { label: '3–6 mo',      color: '#ea580c' }
  if (days < 365) return { label: '6–12 mo',     color: '#dc2626' }
  return              { label: '1+ yr',           color: '#7c3aed' }
}

function TriState({ value }: { value: boolean | null }) {
  if (value === true)  return <span style={{ color: '#22c55e' }}>Yes</span>
  if (value === false) return <span style={{ color: '#ef4444' }}>No</span>
  return <span style={{ color: 'rgb(var(--on-surface-muted))' }}>—</span>
}

function MetricCard({ label, value, sub, highlight }: { label: string; value: string | number; sub?: string; highlight?: boolean }) {
  return (
    <div style={{
      background: 'rgb(var(--surface-container))',
      border: `1px solid ${highlight ? 'rgb(var(--primary))' : 'rgb(var(--outline))'}`,
      borderRadius: '0.75rem',
      padding: '1rem 1.25rem',
    }}>
      <div style={{ fontSize: '0.72rem', color: 'rgb(var(--on-surface-muted))', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.375rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.75rem', fontWeight: 800, color: highlight ? 'rgb(var(--primary))' : 'rgb(var(--on-surface))', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))', marginTop: '0.25rem' }}>{sub}</div>}
    </div>
  )
}

function FilterTabs<T extends string>({
  label, options, value, onChange,
}: { label: string; options: readonly T[]; value: T | 'all'; onChange: (v: T | 'all') => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgb(var(--on-surface-muted))', marginRight: '0.25rem' }}>
        {label}
      </span>
      <button className={`filter-tab${value === 'all' ? ' active' : ''}`} onClick={() => onChange('all')}>All</button>
      {options.map(opt => (
        <button key={opt} className={`filter-tab${value === opt ? ' active' : ''}`} onClick={() => onChange(opt)}>
          {opt}
        </button>
      ))}
    </div>
  )
}

function vehicleValue(imp: Impound): number {
  if (imp.sell) return imp.estimated_value ?? 0
  return SCRAP_VALUE
}

export function ImpoundDashboard({ profile }: { profile: ImpoundProfile }) {
  const supabase = getSupabaseBrowserClient()
  const [impounds, setImpounds]   = useState<Impound[]>([])
  const [loading, setLoading]     = useState(true)
  const [syncing, setSyncing]     = useState(false)
  const [selected, setSelected]   = useState<Impound | null>(null)

  const [locationFilter, setLocationFilter] = useState<typeof IMPOUND_LOCATIONS[number] | 'all'>('all')
  const [statusFilter, setStatusFilter]     = useState<typeof IMPOUND_STATUSES[number] | 'all'>('all')
  const [search, setSearch]                 = useState('')
  const [showHistory, setShowHistory]       = useState(false)

  const fetchImpounds = useCallback(async () => {
    const { data, error } = await supabase
      .from('impounds')
      .select(IMPOUND_QUERY)
      .eq('released', false)
      .eq('scrapped', false)
      .eq('sold', false)
      .order('date_of_impound', { ascending: false })
    if (!error) setImpounds(data ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchImpounds()
    const channel = supabase
      .channel('impounds-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'impounds' }, fetchImpounds)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'impound_photos' }, fetchImpounds)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchImpounds, supabase])

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync-towbook', { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      await new Promise(r => setTimeout(r, 5000))
      await fetchImpounds()
    } catch (err: unknown) {
      alert('Sync failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSyncing(false)
    }
  }

  // Apply location + status + search filters
  const filtered = impounds.filter(imp => {
    if (locationFilter !== 'all' && imp.location !== locationFilter) return false
    if (statusFilter   !== 'all' && imp.status   !== statusFilter)   return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !imp.call_number?.toLowerCase().includes(q) &&
        !imp.make_model?.toLowerCase().includes(q) &&
        !imp.vin?.toLowerCase().includes(q) &&
        !imp.location?.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  // Metrics computed over filtered set
  const owned          = filtered.filter(i => i.status === 'Owned')
  const currentImpound = filtered.filter(i => i.status === 'Current Impound')
  const policeHold     = filtered.filter(i => i.status === 'Police Hold')
  const scrap          = filtered.filter(i => !i.sell)
  const resale         = filtered.filter(i => i.sell)
  const totalValue     = filtered.reduce((sum, i) => sum + vehicleValue(i), 0)

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgb(var(--surface))' }}>
        <div style={{ width: 36, height: 36, border: '3px solid rgb(var(--outline))', borderTopColor: 'rgb(var(--primary))', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'rgb(var(--surface))' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid rgb(var(--outline))',
        background: 'rgb(var(--surface-container))',
        padding: '0 1.5rem',
        height: '3.5rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative',
      }}>
        {/* Left: back + app name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
          <a
            href={process.env.NEXT_PUBLIC_PORTAL_URL ?? 'https://netcfs-platform-portal.vercel.app'}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'rgb(var(--on-surface-muted))', textDecoration: 'none', fontSize: '0.8rem', padding: '0.25rem 0.5rem', borderRadius: '0.375rem', transition: 'color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgb(var(--on-surface))')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgb(var(--on-surface-muted))')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            NETCFS
          </a>
          <span style={{ color: 'rgb(var(--outline))', fontSize: '1rem', flexShrink: 0 }}>|</span>
          <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: 'rgb(var(--on-surface))', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
            Impound Tracker
          </span>
        </div>

        {/* Center: company logo — hidden on narrow screens */}
        <div className="header-center-logo" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}>
          <img src="/logo-main.png" alt="NETC Fleet Services" className="logo-light" style={{ height: 28, width: 'auto', display: 'block' }} />
          <img src="/logo-email.png" alt="NETC Fleet Services" className="logo-dark"  style={{ height: 28, width: 'auto', display: 'block' }} />
        </div>

        {/* Right: user + sync */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))' }}>
            {profile.full_name ?? profile.email}
          </span>
          <button
            className="btn-secondary"
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.875rem', opacity: syncing ? 0.6 : 1 }}
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? 'Syncing…' : '↻ Sync Towbook'}
          </button>
        </div>
      </div>

      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '1.5rem 1.25rem 4rem' }}>

        {/* Metric cards — update with filters */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <MetricCard label="Total"            value={filtered.length} />
          <MetricCard label="Owned"            value={owned.length} />
          <MetricCard label="Current Impounds" value={currentImpound.length} />
          <MetricCard label="Police Holds"     value={policeHold.length} />
          <MetricCard label="Scrap"            value={scrap.length} />
          <MetricCard label="Resale"           value={resale.length} />
          <MetricCard label="Total Value"      value={currency(totalValue)} highlight />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginBottom: '1rem' }}>
          <FilterTabs label="Location" options={IMPOUND_LOCATIONS} value={locationFilter} onChange={setLocationFilter} />
          <FilterTabs label="Status"   options={IMPOUND_STATUSES}  value={statusFilter}   onChange={setStatusFilter} />
        </div>

        {/* Search + History button */}
        <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <input
            type="search"
            className="form-input"
            placeholder="Search call #, vehicle, VIN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 320, fontSize: '0.85rem', padding: '0.375rem 0.75rem' }}
          />
          <button
            className="btn-secondary"
            onClick={() => setShowHistory(true)}
            style={{ fontSize: '0.8rem', padding: '0.375rem 0.875rem', whiteSpace: 'nowrap' }}
          >
            History
          </button>
        </div>

        {/* Table */}
        <div style={{
          background: 'rgb(var(--surface-container))',
          border: '1px solid rgb(var(--outline))',
          borderRadius: '0.875rem',
          overflow: 'hidden',
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgb(var(--outline))', background: 'rgb(var(--surface-high))' }}>
                  {['Call #', 'Date', 'Time on Lot', 'Vehicle', 'VIN', 'Location', 'Status', 'Reason', 'Notes', 'Keys', 'Drives', 'Type', 'Value'].map(h => (
                    <th key={h} style={{
                      padding: '0.625rem 0.875rem', textAlign: 'left',
                      fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.06em', color: 'rgb(var(--on-surface-muted))',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={13} style={{ padding: '2rem', textAlign: 'center', color: 'rgb(var(--on-surface-muted))', fontStyle: 'italic' }}>
                      No vehicles found
                    </td>
                  </tr>
                )}
                {filtered.map(imp => (
                  <tr
                    key={imp.id}
                    className="vehicle-row"
                    onClick={() => setSelected(imp)}
                    style={{ borderBottom: '1px solid rgb(var(--outline))' }}
                  >
                    <td style={{ padding: '0.625rem 0.875rem', fontWeight: 600, color: 'rgb(var(--primary))' }}>
                      {imp.call_number}
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem', whiteSpace: 'nowrap' }}>
                      {formatDate(imp.date_of_impound)}
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem' }}>
                      {(() => {
                        const { label, color } = timeOnLot(imp.date_of_impound)
                        return (
                          <span style={{
                            display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: 9999,
                            fontSize: '0.7rem', fontWeight: 700,
                            background: `${color}22`, color,
                          }}>{label}</span>
                        )
                      })()}
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem' }}>
                      {[imp.year, imp.make_model].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem', fontFamily: 'monospace', fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))', whiteSpace: 'nowrap' }}>
                      {imp.vin || '—'}
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem' }}>{imp.location || '—'}</td>
                    <td style={{ padding: '0.625rem 0.875rem' }}>
                      <span style={{
                        display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: 9999,
                        fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap',
                        background: imp.status === 'Owned' ? '#1d4ed8'
                          : imp.status === 'Police Hold' ? '#b45309'
                          : imp.status === 'Current Impound' ? '#dc2626'
                          : '#64748b',
                        color: '#fff',
                      }}>
                        {imp.status ?? '—'}
                      </span>
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem', maxWidth: 180 }}>
                      <span style={{
                        display: 'block', overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', color: 'rgb(var(--on-surface-muted))',
                        fontSize: '0.8rem',
                      }}>
                        {imp.reason_for_impound || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem', maxWidth: 220 }}>
                      <span style={{
                        display: 'block', overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', color: 'rgb(var(--on-surface-muted))',
                        fontSize: '0.8rem',
                      }}>
                        {imp.notes || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem' }}><TriState value={imp.keys} /></td>
                    <td style={{ padding: '0.625rem 0.875rem' }}><TriState value={imp.drives} /></td>
                    <td style={{ padding: '0.625rem 0.875rem' }}>
                      <span style={{
                        display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: 9999,
                        fontSize: '0.7rem', fontWeight: 600,
                        background: imp.sell ? '#16a34a22' : '#64748b22',
                        color: imp.sell ? '#16a34a' : 'rgb(var(--on-surface-muted))',
                      }}>
                        {imp.sell ? 'Resale' : 'Scrap'}
                      </span>
                    </td>
                    <td style={{ padding: '0.625rem 0.875rem', fontWeight: 600 }}>
                      {currency(vehicleValue(imp))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '0.625rem 0.875rem', borderTop: '1px solid rgb(var(--outline))', fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))' }}>
            {filtered.length} of {impounds.length} vehicles
          </div>
        </div>
      </main>

      {selected && (
        <VehicleDetailDrawer
          impound={selected}
          profile={profile}
          onClose={() => setSelected(null)}
          onSaved={fetchImpounds}
        />
      )}

      {showHistory && <SalesHistoryModal onClose={() => setShowHistory(false)} />}
    </div>
  )
}
