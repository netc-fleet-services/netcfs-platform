'use client'

import { useState, useEffect } from 'react'
import { NOTE_TYPE, NOTE_TYPE_LABELS, STATUS_LABELS, ROLE } from '@/lib/constants'
import { MaintenanceBadge } from './maintenance-badge'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { Truck, FleetProfile, TruckNote, StatusHistoryEntry } from '@/lib/types'

interface InspectionRecord {
  id: string
  inspector: string
  inspected_date: string
  has_fails: boolean
  items: { key: string; label: string; rating: string; comment: string; section?: string }[]
}

const RATING_COLOR: Record<string, string> = {
  ok:  'var(--status-ready)',
  na:  'var(--on-surface-muted)',
  bad: 'var(--error)',
}
const RATING_LABEL: Record<string, string> = { ok: 'OK', na: 'N/A', bad: 'Bad' }

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' })
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function computeOOSPeriods(statusHistory: StatusHistoryEntry[]) {
  const sorted = [...statusHistory].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const periods: { startDate: string; endDate: string | null; days: number; ongoing: boolean }[] = []
  let oosStart: StatusHistoryEntry | null = null

  for (const entry of sorted) {
    if (entry.new_status === 'oos') {
      oosStart = entry
    } else if (entry.old_status === 'oos' && oosStart) {
      const days = Math.floor((new Date(entry.created_at).getTime() - new Date(oosStart.created_at).getTime()) / 864e5)
      periods.push({ startDate: oosStart.created_at, endDate: entry.created_at, days, ongoing: false })
      oosStart = null
    }
  }

  if (oosStart) {
    const days = Math.floor((Date.now() - new Date(oosStart.created_at).getTime()) / 864e5)
    periods.push({ startDate: oosStart.created_at, endDate: null, days, ongoing: true })
  }

  return periods.reverse()
}

const NOTE_TYPE_COLORS: Record<string, { color: string; label: string }> = {
  [NOTE_TYPE.DRIVER]:   { color: '#60a5fa', label: 'Driver' },
  [NOTE_TYPE.MECHANIC]: { color: 'var(--primary)', label: 'Mechanic' },
  [NOTE_TYPE.WORK]:     { color: 'var(--status-ready)', label: 'Work Done' },
}

const STATUS_COLORS: Record<string, string> = {
  ready: 'var(--status-ready)', issues: 'var(--status-issues)', oos: 'var(--status-oos)',
}

interface Props {
  truck: Truck
  profile: FleetProfile | null
  onAddNote: (truck: Truck, noteType: string, body: string) => Promise<void>
  onClose: () => void
}

type TimelineEntry = (TruckNote & { _type: 'note' }) | (StatusHistoryEntry & { _type: 'history' })

export function NotesDrawer({ truck, profile, onAddNote, onClose }: Props) {
  const supabase = getSupabaseBrowserClient()
  const [noteType, setNoteType] = useState<typeof NOTE_TYPE[keyof typeof NOTE_TYPE]>(profile?.role === ROLE.DRIVER ? NOTE_TYPE.DRIVER : NOTE_TYPE.MECHANIC)
  const [noteBody, setNoteBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState('history')

  const [inspections,     setInspections]     = useState<InspectionRecord[]>([])
  const [inspLoading,     setInspLoading]     = useState(false)
  const [expandedInspId,  setExpandedInspId]  = useState<string | null>(null)

  useEffect(() => {
    if (activeTab !== 'inspections') return
    setInspLoading(true)
    supabase
      .from('vehicle_inspections')
      .select('id, inspector, inspected_date, has_fails, items')
      .eq('truck_id', truck.id)
      .order('inspected_date', { ascending: false })
      .limit(24)
      .then(({ data }) => { setInspections(data || []); setInspLoading(false) })
  }, [activeTab, truck.id, supabase])

  const isDriver = profile?.role === ROLE.DRIVER
  const availableNoteTypes = isDriver
    ? [NOTE_TYPE.DRIVER]
    : [NOTE_TYPE.DRIVER, NOTE_TYPE.MECHANIC, NOTE_TYPE.WORK]

  const notes: TimelineEntry[] = (truck.truck_notes || []).map(n => ({ ...n, _type: 'note' as const }))
  const history: TimelineEntry[] = (truck.status_history || []).map(h => ({ ...h, _type: 'history' as const }))
  const timeline = [...notes, ...history].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  async function handleAddNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!noteBody.trim()) return
    setSubmitting(true)
    await onAddNote(truck, noteType, noteBody.trim())
    setNoteBody('')
    setSubmitting(false)
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel">
        <div className="drawer-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: '1.125rem', color: 'var(--on-surface)' }}>
                {truck.unit_number}
              </h2>
              <span className={`status-badge status-badge-${truck.current_status}`}>
                {STATUS_LABELS[truck.current_status]}
              </span>
            </div>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--on-surface-muted)' }}>
              {truck.vin} · {truck.locations?.name || 'No location'}
            </p>
          </div>
          <button className="btn-ghost" onClick={onClose} style={{ padding: '0.25rem', fontSize: '1rem' }}>✕</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--outline)', padding: '0 1.5rem', flexShrink: 0 }}>
          {[['history', 'History'], ['inspections', 'Inspections'], ['maintenance', 'Maintenance']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                padding: '0.75rem 0', marginRight: '1.5rem',
                background: 'none', border: 'none',
                borderBottom: `2px solid ${activeTab === id ? 'var(--primary)' : 'transparent'}`,
                color: activeTab === id ? 'var(--primary)' : 'var(--on-surface-muted)',
                fontWeight: activeTab === id ? 700 : 500,
                fontSize: '0.8125rem', cursor: 'pointer', fontFamily: 'inherit', transition: 'color 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="drawer-body">
          {activeTab === 'history' && (
            <>
              {(() => {
                const periods = computeOOSPeriods(truck.status_history || [])
                if (periods.length === 0) return null
                const totalDays = periods.reduce((s, p) => s + p.days, 0)
                return (
                  <div style={{ marginBottom: '1.75rem' }}>
                    <p style={{ fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-muted)', marginBottom: '0.75rem', marginTop: 0 }}>
                      OOS History — {periods.length} period{periods.length !== 1 ? 's' : ''} · {totalDays} total day{totalDays !== 1 ? 's' : ''}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {periods.map((period, i) => (
                        <div key={i} style={{ padding: '0.625rem 0.875rem', background: 'var(--status-oos-bg)', border: '1px solid var(--status-oos-border)', borderRadius: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{ fontSize: '0.8rem', color: 'var(--on-surface)', lineHeight: 1.4 }}>
                            <span>{fmtDate(period.startDate)}</span>
                            <span style={{ color: 'var(--on-surface-muted)', margin: '0 0.3rem' }}>→</span>
                            <span>{period.ongoing
                              ? <span style={{ color: 'var(--status-oos)', fontWeight: 600 }}>Ongoing</span>
                              : fmtDate(period.endDate)
                            }</span>
                          </div>
                          <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--status-oos)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {period.days === 0 ? '< 1 day' : `${period.days} day${period.days !== 1 ? 's' : ''}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              <form onSubmit={handleAddNote} style={{ marginBottom: '1.75rem' }}>
                <p style={{ fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-muted)', marginBottom: '0.75rem' }}>
                  Add Note
                </p>
                {!isDriver && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                    {availableNoteTypes.map(t => (
                      <button
                        key={t} type="button"
                        className={noteType === t ? 'btn-primary' : 'btn-secondary'}
                        style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
                        onClick={() => setNoteType(t)}
                      >
                        {NOTE_TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  className="form-textarea"
                  placeholder={
                    noteType === NOTE_TYPE.DRIVER   ? 'Describe what the driver observed…' :
                    noteType === NOTE_TYPE.MECHANIC ? 'Describe diagnosis, issue, or status…' :
                    'Describe work that was completed…'
                  }
                  value={noteBody}
                  onChange={e => setNoteBody(e.target.value)}
                  style={{ minHeight: '5rem', marginBottom: '0.75rem' }}
                />
                <button type="submit" className="btn-primary" disabled={submitting || !noteBody.trim()} style={{ width: '100%' }}>
                  {submitting ? 'Saving…' : `Add ${NOTE_TYPE_LABELS[noteType]}`}
                </button>
              </form>

              <p style={{ fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-muted)', marginBottom: '1rem' }}>
                Full History ({timeline.length} entries)
              </p>

              {timeline.length === 0 && (
                <p style={{ color: 'var(--on-surface-muted)', fontSize: '0.875rem' }}>No history yet.</p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {timeline.map((entry, idx) => (
                  <div key={idx} style={{ padding: '0.875rem 1rem', background: 'var(--surface-high)', border: '1px solid var(--outline-variant)', borderRadius: '0.5rem' }}>
                    {entry._type === 'note' ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: NOTE_TYPE_COLORS[entry.note_type]?.color || 'var(--primary)' }}>
                            {NOTE_TYPE_COLORS[entry.note_type]?.label || entry.note_type}
                          </span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--on-surface-muted)' }}>{fmtDateTime(entry.created_at)}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--on-surface)', lineHeight: 1.5 }}>{entry.body}</p>
                        {entry.created_by && (
                          <p style={{ margin: '0.35rem 0 0', fontSize: '0.72rem', color: 'var(--on-surface-muted)' }}>— {entry.created_by}</p>
                        )}
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-muted)' }}>Status Change</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--on-surface-muted)' }}>{fmtDateTime(entry.created_at)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.8rem', color: STATUS_COLORS[entry.old_status ?? ''] || 'var(--on-surface-muted)' }}>
                            {STATUS_LABELS[entry.old_status ?? ''] || entry.old_status || '—'}
                          </span>
                          <span style={{ color: 'var(--on-surface-muted)', fontSize: '0.75rem' }}>→</span>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: STATUS_COLORS[entry.new_status] || 'var(--on-surface)' }}>
                            {STATUS_LABELS[entry.new_status] || entry.new_status}
                          </span>
                        </div>
                        {entry.comment && <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: 'var(--on-surface)' }}>{entry.comment}</p>}
                        {entry.changed_by && <p style={{ margin: '0.35rem 0 0', fontSize: '0.72rem', color: 'var(--on-surface-muted)' }}>— {entry.changed_by}</p>}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === 'inspections' && (
            <div>
              {inspLoading && (
                <p style={{ color: 'var(--on-surface-muted)', fontSize: '0.875rem' }}>Loading…</p>
              )}
              {!inspLoading && inspections.length === 0 && (
                <p style={{ color: 'var(--on-surface-muted)', fontSize: '0.875rem' }}>No inspections recorded for this truck yet.</p>
              )}
              {inspections.map(rec => {
                const isOpen   = expandedInspId === rec.id
                const badItems = rec.items.filter(i => i.rating === 'bad')
                const passCount = rec.items.filter(i => i.rating === 'ok').length
                const naCount   = rec.items.filter(i => i.rating === 'na').length

                const sections: Record<string, typeof rec.items> = {}
                for (const item of rec.items) {
                  const sec = item.section || 'Other'
                  if (!sections[sec]) sections[sec] = []
                  sections[sec].push(item)
                }

                return (
                  <div key={rec.id} style={{ border: `1px solid ${rec.has_fails ? 'var(--error)' : 'var(--outline-variant)'}`, borderRadius: '0.5rem', marginBottom: '0.625rem', overflow: 'hidden' }}>
                    <button
                      type="button"
                      onClick={() => setExpandedInspId(isOpen ? null : rec.id)}
                      style={{ width: '100%', background: 'var(--surface-high)', border: 'none', cursor: 'pointer', padding: '0.625rem 0.875rem', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.625rem' }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.8125rem', color: 'var(--on-surface)' }}>
                            {new Date(rec.inspected_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                          {rec.has_fails
                            ? <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'var(--error-container)', color: 'var(--error)' }}>{badItems.length} FAIL{badItems.length !== 1 ? 'S' : ''}</span>
                            : <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'var(--status-ready-bg)', color: 'var(--status-ready)' }}>PASS</span>
                          }
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--on-surface-muted)', marginTop: 2 }}>
                          {rec.inspector} · {passCount} OK · {naCount} N/A{rec.has_fails ? <> · <span style={{ color: 'var(--error)' }}>{badItems.length} Bad</span></> : null}
                        </div>
                      </div>
                      <span style={{ color: 'var(--on-surface-muted)', fontSize: '0.7rem', transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
                    </button>

                    {isOpen && (
                      <div style={{ padding: '0.625rem 0.875rem', borderTop: '1px solid var(--outline-variant)' }}>
                        {Object.entries(sections).map(([sectionTitle, sectionItems]) => (
                          <div key={sectionTitle} style={{ marginBottom: '0.625rem' }}>
                            <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                              {sectionTitle}
                            </div>
                            {sectionItems.map(item => (
                              <div key={item.key} style={{ marginBottom: '0.35rem' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
                                  <span style={{ flexShrink: 0, fontWeight: 700, fontSize: '0.67rem', padding: '1px 5px', borderRadius: 3, minWidth: 28, textAlign: 'center', color: RATING_COLOR[item.rating] || 'var(--on-surface-muted)', background: (RATING_COLOR[item.rating] || 'var(--on-surface-muted)') + '22' }}>
                                    {RATING_LABEL[item.rating] || item.rating}
                                  </span>
                                  <span style={{ fontSize: '0.775rem', color: 'var(--on-surface)', lineHeight: 1.4 }}>{item.label}</span>
                                </div>
                                {item.rating === 'bad' && item.comment && (
                                  <div style={{ marginLeft: '2.25rem', marginTop: '0.15rem', padding: '0.2rem 0.5rem', background: 'var(--error-container)', borderRadius: '0.25rem', fontSize: '0.72rem', color: 'var(--error)' }}>
                                    {item.comment}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {activeTab === 'maintenance' && (
            <div style={{ padding: '1.25rem', background: 'var(--surface-high)', border: '1px solid var(--outline)', borderRadius: '0.625rem' }}>
              <p style={{ fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-muted)', marginBottom: '1rem' }}>
                PM Schedule
              </p>
              {truck.maintenance ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  {([
                    ['Last PM Date',    truck.maintenance.last_pm_date ? new Date(truck.maintenance.last_pm_date).toLocaleDateString() : '—'],
                    ['Last PM Mileage', truck.maintenance.last_pm_mileage?.toLocaleString() || '—'],
                    ['Next PM Due',     truck.maintenance.next_pm_date ? new Date(truck.maintenance.next_pm_date).toLocaleDateString() : '—'],
                    ['Next PM Mileage', truck.maintenance.next_pm_mileage?.toLocaleString() || '—'],
                  ] as [string, string][]).map(([label, val]) => (
                    <div key={label}>
                      <p style={{ margin: 0, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-muted)' }}>{label}</p>
                      <p style={{ margin: '0.25rem 0 0', fontWeight: 700, fontSize: '0.9375rem', color: 'var(--on-surface)' }}>{val}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--on-surface-muted)', fontSize: '0.875rem', margin: 0 }}>No maintenance record on file.</p>
              )}
              <div style={{ marginTop: '1rem' }}>
                <MaintenanceBadge nextPmDate={truck.maintenance?.next_pm_date} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
