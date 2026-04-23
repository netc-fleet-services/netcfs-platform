'use client'

import { useState, useEffect } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { Truck } from '@/lib/types'

interface InspectionRecord {
  id: string
  unit_number: string
  inspector: string
  inspected_date: string
  has_fails: boolean
  items: { key: string; label: string; rating: string; comment: string; section?: string }[]
  created_at: string
}

interface Props {
  truck: Truck
  onClose: () => void
}

export function InspectionHistoryModal({ truck, onClose }: Props) {
  const supabase = getSupabaseBrowserClient()
  const [records,   setRecords]   = useState<InspectionRecord[]>([])
  const [expanded,  setExpanded]  = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    supabase
      .from('vehicle_inspections')
      .select('*')
      .eq('truck_id', truck.id)
      .order('inspected_date', { ascending: false })
      .limit(24)
      .then(({ data }) => { setRecords(data || []); setLoading(false) })
  }, [supabase, truck.id])

  const RATING_COLORS: Record<string, string> = {
    ok:  'var(--status-ready)',
    na:  'var(--on-surface-muted)',
    bad: 'var(--error)',
  }
  const RATING_LABELS: Record<string, string> = { ok: 'OK', na: 'N/A', bad: 'Bad' }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 40 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(660px, 97vw)', maxHeight: '90vh', overflowY: 'auto',
        background: 'var(--surface-container)', border: '1px solid var(--outline)',
        borderRadius: '0.875rem', padding: '1.5rem', zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 800, fontSize: '1rem', color: 'var(--on-surface)' }}>
              Inspection History — {truck.unit_number}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--on-surface-muted)' }}>
              Most recent {records.length} inspection{records.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: 'var(--on-surface-muted)', lineHeight: 1 }}>×</button>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--on-surface-muted)', fontSize: '0.875rem' }}>Loading…</div>
        )}

        {!loading && records.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--on-surface-muted)', fontSize: '0.875rem' }}>
            No inspections recorded for this truck yet.
          </div>
        )}

        {records.map(rec => {
          const isOpen    = expanded === rec.id
          const badItems  = rec.items.filter(i => i.rating === 'bad')
          const passCount = rec.items.filter(i => i.rating === 'ok').length
          const naCount   = rec.items.filter(i => i.rating === 'na').length

          // Group items by section for expanded view
          const sections: Record<string, typeof rec.items> = {}
          for (const item of rec.items) {
            const sec = item.section || 'Other'
            if (!sections[sec]) sections[sec] = []
            sections[sec].push(item)
          }

          return (
            <div key={rec.id} style={{ border: `1px solid ${rec.has_fails ? 'var(--error)' : 'var(--outline-variant)'}`, borderRadius: '0.625rem', marginBottom: '0.625rem', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : rec.id)}
                style={{ width: '100%', background: 'var(--surface)', border: 'none', cursor: 'pointer', padding: '0.75rem 1rem', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.75rem' }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--on-surface)' }}>
                      {new Date(rec.inspected_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    {rec.has_fails
                      ? <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'var(--error-container)', color: 'var(--error)' }}>{badItems.length} FAIL{badItems.length !== 1 ? 'S' : ''}</span>
                      : <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'var(--status-ready-bg)', color: 'var(--status-ready)' }}>PASS</span>
                    }
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--on-surface-muted)', marginTop: 2 }}>
                    Inspector: {rec.inspector} &nbsp;·&nbsp; {passCount} OK &nbsp;·&nbsp; {naCount} N/A
                    {rec.has_fails && <> &nbsp;·&nbsp; <span style={{ color: 'var(--error)' }}>{badItems.length} Bad</span></>}
                  </div>
                </div>
                <span style={{ color: 'var(--on-surface-muted)', fontSize: '0.75rem', transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
              </button>

              {isOpen && (
                <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--outline-variant)' }}>
                  {Object.entries(sections).map(([sectionTitle, sectionItems]) => (
                    <div key={sectionTitle} style={{ marginBottom: '0.75rem' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.375rem' }}>
                        {sectionTitle}
                      </div>
                      {sectionItems.map(item => (
                        <div key={item.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.25rem', fontSize: '0.8rem' }}>
                          <span style={{
                            flexShrink: 0, fontWeight: 700, fontSize: '0.7rem', padding: '1px 6px', borderRadius: 3,
                            color: RATING_COLORS[item.rating] || 'var(--on-surface-muted)',
                            background: (RATING_COLORS[item.rating] || 'var(--on-surface-muted)') + '22',
                            minWidth: 30, textAlign: 'center',
                          }}>
                            {RATING_LABELS[item.rating] || item.rating}
                          </span>
                          <span style={{ color: 'var(--on-surface)', flex: 1 }}>{item.label}</span>
                        </div>
                      ))}
                      {sectionItems.filter(i => i.rating === 'bad' && i.comment).map(item => (
                        <div key={item.key + '_c'} style={{ marginLeft: '2.5rem', marginBottom: '0.25rem', padding: '0.25rem 0.5rem', background: 'var(--error-container)', borderRadius: '0.25rem', fontSize: '0.75rem', color: 'var(--error)' }}>
                          <strong>{item.label.split(' ').slice(0, 4).join(' ')}…</strong> — {item.comment}
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
    </>
  )
}
