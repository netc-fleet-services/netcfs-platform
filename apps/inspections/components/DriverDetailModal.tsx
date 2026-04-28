'use client'

import { useState, useEffect } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { Snapshot, Period } from './SafetyDashboard'

// ── Types ──────────────────────────────────────────────────────────────────────

type SafetyEvent = {
  id: string
  unit_number: string | null
  occurred_at: string
  event_type: string
  final_status: 'coached' | 'dismissed' | 'pending'
  severity_points: number
  max_speed: number | null
  speed_limit: number | null
}

type DvirLog = {
  id: string
  log_date: string
  completed: boolean
  manually_overridden: boolean
  source: string
  notes: string | null
}

type ComplianceEvent = {
  id: string
  event_date: string
  event_type: string
  points: number
  notes: string | null
  entered_by: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso + (iso.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmtEventType(type: string): string {
  return type
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

function statusColor(status: string): string {
  if (status === 'coached')   return '#f59e0b'
  if (status === 'dismissed') return 'rgb(var(--on-surface-muted))'
  return 'rgb(var(--primary))'
}

function complianceTypeLabel(type: string): string {
  const map: Record<string, string> = {
    dot_citation: 'DOT Citation',
    oos: 'Out of Service',
    accident: 'Accident',
    other: 'Other',
  }
  return map[type] ?? type
}

// ── Component ──────────────────────────────────────────────────────────────────

type Props = {
  snapshot: Snapshot
  period: Period
  onClose: () => void
}

export function DriverDetailModal({ snapshot: s, period, onClose }: Props) {
  const supabase = getSupabaseBrowserClient()
  const [events, setEvents]           = useState<SafetyEvent[]>([])
  const [dvirLogs, setDvirLogs]       = useState<DvirLog[]>([])
  const [compliance, setCompliance]   = useState<ComplianceEvent[]>([])
  const [loading, setLoading]         = useState(true)
  const [overriding, setOverriding]   = useState<string | null>(null) // log id being saved

  useEffect(() => {
    Promise.all([
      supabase
        .from('safety_events')
        .select('id, unit_number, occurred_at, event_type, final_status, severity_points, max_speed, speed_limit')
        .eq('driver_id', s.driver_id)
        .gte('occurred_at', `${period.start}T00:00:00Z`)
        .lte('occurred_at', `${period.end}T23:59:59Z`)
        .order('occurred_at', { ascending: false }),
      supabase
        .from('dvir_logs')
        .select('id, log_date, completed, manually_overridden, source, notes')
        .eq('driver_id', s.driver_id)
        .gte('log_date', period.start)
        .lte('log_date', period.end)
        .order('log_date', { ascending: false }),
      supabase
        .from('compliance_events')
        .select('id, event_date, event_type, points, notes, entered_by')
        .eq('driver_id', s.driver_id)
        .gte('event_date', period.start)
        .lte('event_date', period.end)
        .order('event_date', { ascending: false }),
    ]).then(([evResp, dvirResp, compResp]) => {
      setEvents(evResp.data || [])
      setDvirLogs(dvirResp.data || [])
      setCompliance(compResp.data || [])
      setLoading(false)
    })
  }, [s.driver_id, period]) // eslint-disable-line react-hooks/exhaustive-deps

  async function markDvirCompleted(log: DvirLog) {
    setOverriding(log.id)
    await supabase
      .from('dvir_logs')
      .update({ completed: true, manually_overridden: true })
      .eq('id', log.id)
    setDvirLogs(prev => prev.map(d =>
      d.id === log.id ? { ...d, completed: true, manually_overridden: true } : d
    ))
    setOverriding(null)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(720px, calc(100vw - 2rem))',
        maxHeight: 'calc(100vh - 4rem)',
        background: 'rgb(var(--surface))',
        border: '1px solid rgb(var(--outline-variant))',
        borderRadius: '0.875rem',
        display: 'flex', flexDirection: 'column',
        zIndex: 101,
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid rgb(var(--outline-variant))',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgb(var(--primary))', marginBottom: '0.25rem' }}>
              {period.label} · {(s.driver_yard ?? '').replace(/\b\w/g, c => c.toUpperCase())}
            </div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'rgb(var(--on-surface))' }}>
              {s.driver_name}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'rgb(var(--on-surface-muted))', padding: '0.25rem', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', padding: '1.5rem', flex: 1 }}>

          {/* Score breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1.75rem' }}>
            {[
              { label: 'Safety Score', value: s.eligible ? s.safety_score.toFixed(1) : '—', highlight: true },
              { label: 'Miles Driven', value: s.miles_driven.toLocaleString('en-US', { maximumFractionDigits: 0 }) },
              { label: 'Event Points', value: String(s.total_event_points) },
              { label: 'Severity Rate', value: s.eligible ? s.severity_rate.toFixed(2) : '—' },
              { label: 'DVIR Missed', value: String(s.dvir_days_missed), warn: s.dvir_days_missed > 0 },
              { label: 'Compliance Pen.', value: String(s.compliance_penalty), warn: s.compliance_penalty > 0 },
            ].map(card => (
              <div key={card.label} style={{
                background: card.highlight ? 'rgb(var(--primary-container))' : 'rgb(var(--surface-container))',
                border: '1px solid rgb(var(--outline-variant))',
                borderRadius: '0.625rem',
                padding: '0.875rem',
              }}>
                <div style={{ fontSize: '0.63rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgb(var(--on-surface-muted))', marginBottom: '0.375rem' }}>
                  {card.label}
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: card.warn ? '#f59e0b' : card.highlight ? 'rgb(var(--on-primary-container))' : 'rgb(var(--on-surface))' }}>
                  {card.value}
                </div>
              </div>
            ))}
          </div>

          {/* Flags */}
          {(s.disqualified || !s.eligible) && (
            <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {s.disqualified && <Flag label="Disqualified — OOS or accident in period" color="rgb(var(--error))" />}
              {!s.eligible && !s.disqualified && <Flag label={`Ineligible — ${s.miles_driven.toFixed(0)} miles driven (minimum 2,000)`} color="rgb(var(--on-surface-muted))" />}
            </div>
          )}

          {loading && <div style={{ color: 'rgb(var(--on-surface-muted))', fontSize: '0.875rem' }}>Loading details…</div>}

          {/* Compliance events */}
          {!loading && compliance.length > 0 && (
            <Section title="Compliance Events">
              {compliance.map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0.625rem 0', borderBottom: '1px solid rgb(var(--outline-variant))' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: 'rgb(var(--error))', fontSize: '0.875rem' }}>
                      {complianceTypeLabel(c.event_type)}
                    </div>
                    {c.notes && <div style={{ fontSize: '0.78rem', color: 'rgb(var(--on-surface-muted))', marginTop: '0.2rem' }}>{c.notes}</div>}
                    {c.entered_by && <div style={{ fontSize: '0.72rem', color: 'rgb(var(--on-surface-muted))', marginTop: '0.15rem' }}>Entered by {c.entered_by}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '1rem' }}>
                    <div style={{ fontWeight: 700, color: 'rgb(var(--error))' }}>−{c.points} pts</div>
                    <div style={{ fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))' }}>{fmtDate(c.event_date)}</div>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* Safety events */}
          {!loading && (
            <Section title={`Safety Events (${events.length})`}>
              {events.length === 0 && (
                <div style={{ color: 'rgb(var(--on-surface-muted))', fontSize: '0.85rem', padding: '0.5rem 0' }}>No events in this period.</div>
              )}
              {events.map(ev => (
                <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0.625rem 0', borderBottom: '1px solid rgb(var(--outline-variant))' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'rgb(var(--on-surface))' }}>
                      {fmtEventType(ev.event_type)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))', marginTop: '0.15rem', display: 'flex', gap: '0.75rem' }}>
                      <span>{fmtDate(ev.occurred_at)}</span>
                      {ev.unit_number && <span>Unit {ev.unit_number}</span>}
                      {ev.max_speed !== null && ev.speed_limit !== null && (
                        <span>{ev.max_speed.toFixed(0)} mph / {ev.speed_limit.toFixed(0)} limit</span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '1rem' }}>
                    <div style={{ fontWeight: 700, color: 'rgb(var(--on-surface))', fontSize: '0.875rem' }}>
                      {ev.severity_points} pt{ev.severity_points !== 1 ? 's' : ''}
                    </div>
                    <span style={{
                      display: 'inline-block', padding: '0.1rem 0.4rem', borderRadius: '0.3rem',
                      fontSize: '0.65rem', fontWeight: 700, marginTop: '0.2rem',
                      background: statusColor(ev.final_status) + '22',
                      color: statusColor(ev.final_status),
                    }}>
                      {ev.final_status}
                    </span>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* DVIR logs */}
          {!loading && dvirLogs.length > 0 && (
            <Section title={`DVIR Log (${dvirLogs.filter(d => !d.completed).length} missed)`}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.375rem' }}>
                {dvirLogs.map(d => {
                  const isSaving = overriding === d.id
                  return (
                    <div
                      key={d.id}
                      onClick={!d.completed && !isSaving ? () => markDvirCompleted(d) : undefined}
                      title={!d.completed ? 'Click to mark as verified completed' : d.manually_overridden ? 'Manually verified by safety manager' : undefined}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                        padding: '0.35rem 0.5rem', borderRadius: '0.4rem',
                        background: d.completed ? '#4ade8022' : '#f59e0b22',
                        fontSize: '0.78rem',
                        cursor: !d.completed ? 'pointer' : 'default',
                        opacity: isSaving ? 0.5 : 1,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <span style={{ fontSize: '0.75rem' }}>
                        {isSaving ? '…' : d.completed ? '✓' : '✗'}
                      </span>
                      <span style={{ color: d.completed ? '#4ade80' : '#f59e0b', fontWeight: 600, flex: 1 }}>
                        {fmtDate(d.log_date)}
                      </span>
                      {d.manually_overridden && (
                        <span title="Manually verified" style={{ fontSize: '0.65rem', color: '#4ade80', opacity: 0.7 }}>M</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgb(var(--on-surface-muted))', marginBottom: '0.625rem', paddingBottom: '0.375rem', borderBottom: '1px solid rgb(var(--outline-variant))' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Flag({ label, color }: { label: string; color: string }) {
  return (
    <div style={{
      padding: '0.5rem 0.75rem', borderRadius: '0.5rem',
      background: color + '18', border: `1px solid ${color}44`,
      fontSize: '0.8rem', fontWeight: 600, color,
    }}>
      {label}
    </div>
  )
}
