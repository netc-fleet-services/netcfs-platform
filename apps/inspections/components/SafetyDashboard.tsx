'use client'

import { useState, useEffect, useMemo } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import { DriverDetailModal } from './DriverDetailModal'
import { ComplianceEntryModal } from './ComplianceEntryModal'
import { ManualDvirModal } from './ManualDvirModal'

// ── Types ──────────────────────────────────────────────────────────────────────

export type Period = { start: string; end: string; label: string }

export type Snapshot = {
  id: string
  driver_id: number
  driver_name: string
  driver_yard: string | null
  driver_function: string | null
  period_start: string
  period_end: string
  total_event_points: number
  miles_driven: number
  severity_rate: number
  driving_score: number
  dvir_days_missed: number
  dvir_penalty: number
  compliance_penalty: number
  safety_score: number
  eligible: boolean
  disqualified: boolean
  rank: number | null
  rank_group: string
  locked: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatPeriod(start: string, end: string): string {
  const d = new Date(start + 'T00:00:00')
  const q = Math.ceil((d.getMonth() + 1) / 3)
  return `Q${q} ${d.getFullYear()}`
}

function scoreColor(score: number): string {
  if (score >= 90) return '#4ade80'
  if (score >= 80) return 'rgb(var(--primary))'
  if (score >= 70) return '#f59e0b'
  return 'rgb(var(--error))'
}

function fmtNum(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}

function groupLabel(group: string): string {
  return group.replace(/\b\w/g, c => c.toUpperCase())
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SafetyDashboard() {
  const supabase = getSupabaseBrowserClient()

  const [periods, setPeriods]             = useState<Period[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null)
  const [snapshots, setSnapshots]         = useState<Snapshot[]>([])
  const [loading, setLoading]             = useState(true)
  const [selectedDriver, setSelectedDriver] = useState<Snapshot | null>(null)
  const [showCompliance, setShowCompliance] = useState(false)
  const [showDvir, setShowDvir]           = useState(false)
  const [refreshKey, setRefreshKey]       = useState(0)

  // Load available periods
  useEffect(() => {
    supabase
      .from('score_snapshots')
      .select('period_start, period_end')
      .order('period_start', { ascending: false })
      .then(({ data }) => {
        if (!data?.length) { setLoading(false); return }
        const seen = new Set<string>()
        const unique: Period[] = []
        for (const r of data) {
          const key = `${r.period_start}|${r.period_end}`
          if (!seen.has(key)) {
            seen.add(key)
            unique.push({ start: r.period_start, end: r.period_end, label: formatPeriod(r.period_start, r.period_end) })
          }
        }
        setPeriods(unique)
        setSelectedPeriod(unique[0])
      })
  }, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load snapshots when period or refresh changes
  useEffect(() => {
    if (!selectedPeriod) return
    setLoading(true)
    supabase
      .from('score_snapshots')
      .select('*')
      .eq('period_start', selectedPeriod.start)
      .eq('period_end', selectedPeriod.end)
      .then(({ data }) => {
        setSnapshots(data || [])
        setLoading(false)
      })
  }, [selectedPeriod, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Metric cards
  const metrics = useMemo(() => {
    const eligible = snapshots.filter(s => s.eligible && !s.disqualified)
    const avgScore = eligible.length > 0
      ? eligible.reduce((sum, s) => sum + s.safety_score, 0) / eligible.length
      : null
    const totalPts = snapshots.reduce((sum, s) => sum + s.total_event_points, 0)
    const dvirMissed = snapshots.reduce((sum, s) => sum + s.dvir_days_missed, 0)
    const disqCount = snapshots.filter(s => s.disqualified).length
    return { avgScore, totalPts, dvirMissed, eligibleCount: eligible.length, totalCount: snapshots.length, disqCount }
  }, [snapshots])

  // Leaderboard: group → sorted snapshots
  const groups = useMemo(() => {
    const byGroup: Record<string, Snapshot[]> = {}
    for (const s of snapshots) {
      const g = s.rank_group || 'other'
      if (!byGroup[g]) byGroup[g] = []
      byGroup[g].push(s)
    }
    for (const g in byGroup) {
      byGroup[g].sort((a, b) => {
        if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
        if (b.safety_score !== a.safety_score) return b.safety_score - a.safety_score
        if (a.total_event_points !== b.total_event_points) return a.total_event_points - b.total_event_points
        return b.miles_driven - a.miles_driven
      })
    }
    return Object.entries(byGroup).sort(([a], [b]) => {
      if (a === 'interstate') return -1
      if (b === 'interstate') return 1
      return a.localeCompare(b)
    })
  }, [snapshots])

  const onSaved = () => { setShowCompliance(false); setShowDvir(false); setRefreshKey(k => k + 1) }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2.5rem 1.5rem 5rem' }}>

      {/* Page header */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgb(var(--primary))', marginBottom: '0.35rem' }}>
          NETCFS · Safety Program
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h1 style={{ fontSize: 'clamp(1.4rem, 4vw, 1.875rem)', fontWeight: 800, color: 'rgb(var(--on-surface))', margin: 0, letterSpacing: '-0.02em' }}>
            Safety Dashboard
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
            {/* Period selector */}
            {periods.length > 0 && (
              <select
                value={selectedPeriod ? `${selectedPeriod.start}|${selectedPeriod.end}` : ''}
                onChange={e => {
                  const [start, end] = e.target.value.split('|')
                  setSelectedPeriod({ start, end, label: formatPeriod(start, end) })
                }}
                style={{
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  background: 'rgb(var(--surface-container))',
                  border: '1px solid rgb(var(--outline))',
                  borderRadius: '0.5rem',
                  color: 'rgb(var(--on-surface))',
                  cursor: 'pointer',
                }}
              >
                {periods.map(p => (
                  <option key={p.start} value={`${p.start}|${p.end}`}>{p.label}</option>
                ))}
              </select>
            )}
            <ActionBtn label="+ Compliance Event" onClick={() => setShowCompliance(true)} />
            <ActionBtn label="+ Manual DVIR" onClick={() => setShowDvir(true)} variant="secondary" />
          </div>
        </div>
      </div>

      {/* No data state */}
      {!loading && snapshots.length === 0 && (
        <div style={{
          background: 'rgb(var(--surface-container))',
          border: '1px solid rgb(var(--outline-variant))',
          borderRadius: '0.875rem',
          padding: '3rem 2rem',
          textAlign: 'center',
          color: 'rgb(var(--on-surface-muted))',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📊</div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: 'rgb(var(--on-surface))', marginBottom: '0.5rem' }}>
            No scored periods yet
          </div>
          <p style={{ fontSize: '0.875rem', margin: '0 auto', maxWidth: 420, lineHeight: 1.6 }}>
            Scores are computed at the end of each quarter. Once the scoring engine runs,
            results will appear here. Use the <strong>Compute Safety Scores</strong> workflow
            in GitHub Actions to score a period manually.
          </p>
        </div>
      )}

      {/* Metric cards */}
      {(loading || snapshots.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <MetricCard label="Avg Safety Score" loading={loading}
            value={metrics.avgScore !== null ? fmtNum(metrics.avgScore, 1) : '—'}
            color={metrics.avgScore !== null ? scoreColor(metrics.avgScore) : undefined} />
          <MetricCard label="Total Event Points" loading={loading}
            value={fmtNum(metrics.totalPts)} />
          <MetricCard label="DVIR Days Missed" loading={loading}
            value={fmtNum(metrics.dvirMissed)}
            color={metrics.dvirMissed > 0 ? '#f59e0b' : '#4ade80'} />
          <MetricCard label="Eligible Drivers" loading={loading}
            value={loading ? '—' : `${metrics.eligibleCount} / ${metrics.totalCount}`}
            sub={metrics.disqCount > 0 ? `${metrics.disqCount} DQ` : undefined} />
        </div>
      )}

      {/* Leaderboard */}
      {!loading && groups.map(([group, snaps]) => (
        <div key={group} style={{ marginBottom: '2rem' }}>
          {/* Group header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.625rem' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgb(var(--on-surface-muted))' }}>
              {groupLabel(group)}
            </span>
            <span style={{ fontSize: '0.68rem', color: 'rgb(var(--on-surface-muted))', opacity: 0.6 }}>
              — {snaps.length} driver{snaps.length !== 1 ? 's' : ''}
            </span>
            <div style={{ flex: 1, height: 1, background: 'rgb(var(--outline-variant))' }} />
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: 'rgb(var(--surface-container))' }}>
                  {['#', 'Driver', 'Yard', 'Score', 'Miles', 'Pts', 'DVIR Missed', ''].map((col, i) => (
                    <th key={i} style={{
                      padding: '0.5rem 0.75rem',
                      textAlign: i === 0 ? 'center' : i <= 2 ? 'left' : 'right',
                      fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
                      color: 'rgb(var(--on-surface-muted))',
                      borderBottom: '1px solid rgb(var(--outline-variant))',
                      whiteSpace: 'nowrap',
                    }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snaps.map((s, i) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedDriver(s)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: '1px solid rgb(var(--outline-variant))',
                      background: i % 2 === 1 ? 'rgb(var(--surface-container))' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgb(var(--surface-high))')}
                    onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 1 ? 'rgb(var(--surface-container))' : 'transparent')}
                  >
                    {/* Rank */}
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 700, color: 'rgb(var(--on-surface-muted))', width: 40 }}>
                      {s.disqualified
                        ? <StatusBadge label="DQ" color="rgb(var(--error))" />
                        : !s.eligible
                          ? <StatusBadge label="—" color="rgb(var(--on-surface-muted))" />
                          : s.rank ?? '—'}
                    </td>
                    {/* Driver */}
                    <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600, color: 'rgb(var(--on-surface))' }}>
                      {s.driver_name}
                    </td>
                    {/* Yard */}
                    <td style={{ padding: '0.6rem 0.75rem', color: 'rgb(var(--on-surface-muted))', textTransform: 'capitalize' }}>
                      {s.driver_yard ?? '—'}
                    </td>
                    {/* Score */}
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                      <span style={{ fontWeight: 700, color: s.eligible && !s.disqualified ? scoreColor(s.safety_score) : 'rgb(var(--on-surface-muted))' }}>
                        {s.eligible ? fmtNum(s.safety_score, 1) : '—'}
                      </span>
                    </td>
                    {/* Miles */}
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', color: 'rgb(var(--on-surface-muted))' }}>
                      {fmtNum(s.miles_driven)}
                    </td>
                    {/* Event points */}
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', color: 'rgb(var(--on-surface-muted))' }}>
                      {s.total_event_points}
                    </td>
                    {/* DVIR missed */}
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                      {s.dvir_days_missed > 0
                        ? <span style={{ color: '#f59e0b', fontWeight: 600 }}>{s.dvir_days_missed}</span>
                        : <span style={{ color: 'rgb(var(--on-surface-muted))' }}>0</span>}
                    </td>
                    {/* Flags */}
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                      {!s.eligible && !s.disqualified && (
                        <StatusBadge label="Ineligible" color="rgb(var(--on-surface-muted))" small />
                      )}
                      {s.disqualified && (
                        <StatusBadge label="Disqualified" color="rgb(var(--error))" small />
                      )}
                      {s.locked && (
                        <StatusBadge label="Locked" color="rgb(var(--primary))" small />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Modals */}
      {selectedDriver && selectedPeriod && (
        <DriverDetailModal
          snapshot={selectedDriver}
          period={selectedPeriod}
          onClose={() => setSelectedDriver(null)}
        />
      )}
      {showCompliance && (
        <ComplianceEntryModal onClose={() => setShowCompliance(false)} onSaved={onSaved} />
      )}
      {showDvir && (
        <ManualDvirModal onClose={() => setShowDvir(false)} onSaved={onSaved} />
      )}
    </div>
  )
}

// ── Small reusable pieces ──────────────────────────────────────────────────────

function MetricCard({ label, value, loading, color, sub }: {
  label: string
  value: string
  loading: boolean
  color?: string
  sub?: string
}) {
  return (
    <div style={{
      background: 'rgb(var(--surface-container))',
      border: '1px solid rgb(var(--outline-variant))',
      borderRadius: '0.75rem',
      padding: '1.25rem',
    }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgb(var(--on-surface-muted))', marginBottom: '0.5rem' }}>
        {label}
      </div>
      {loading
        ? <div style={{ height: '2rem', background: 'rgb(var(--outline-variant))', borderRadius: '0.375rem', opacity: 0.4 }} />
        : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 800, color: color ?? 'rgb(var(--on-surface))', letterSpacing: '-0.02em' }}>
              {value}
            </span>
            {sub && <span style={{ fontSize: '0.75rem', color: 'rgb(var(--error))' }}>{sub}</span>}
          </div>
        )}
    </div>
  )
}

function StatusBadge({ label, color, small }: { label: string; color: string; small?: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: small ? '0.1rem 0.4rem' : '0.15rem 0.5rem',
      borderRadius: '0.375rem',
      fontSize: small ? '0.65rem' : '0.72rem',
      fontWeight: 700,
      background: color + '22',
      color,
      letterSpacing: '0.04em',
    }}>
      {label}
    </span>
  )
}

function ActionBtn({ label, onClick, variant = 'primary' }: {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary'
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.45rem 0.875rem',
        fontSize: '0.82rem',
        fontWeight: 600,
        borderRadius: '0.5rem',
        border: variant === 'primary' ? 'none' : '1px solid rgb(var(--outline))',
        background: variant === 'primary' ? 'rgb(var(--primary-container))' : 'transparent',
        color: variant === 'primary' ? 'rgb(var(--on-primary-container))' : 'rgb(var(--on-surface))',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}
