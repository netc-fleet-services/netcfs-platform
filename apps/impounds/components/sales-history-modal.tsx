'use client'

import { useState } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { Impound } from '@/lib/types'
import { SCRAP_VALUE } from '@/lib/constants'

function currency(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function saleValue(r: Impound): number {
  return r.sold ? (r.estimated_value ?? 0) : SCRAP_VALUE
}

export function SalesHistoryModal({ onClose }: { onClose: () => void }) {
  const supabase = getSupabaseBrowserClient()

  const today        = new Date().toISOString().split('T')[0]
  const firstOfYear  = `${new Date().getFullYear()}-01-01`

  const [fromDate, setFromDate] = useState(firstOfYear)
  const [toDate,   setToDate]   = useState(today)
  const [records,  setRecords]  = useState<Impound[] | null>(null)
  const [loading,  setLoading]  = useState(false)

  async function handleFetch() {
    setLoading(true)
    const { data } = await supabase
      .from('impounds')
      .select('*')
      .or('sold.eq.true,scrapped.eq.true')
      .gte('disposition_date', fromDate + 'T00:00:00Z')
      .lte('disposition_date', toDate   + 'T23:59:59Z')
      .order('disposition_date', { ascending: false })
    setRecords(data ?? [])
    setLoading(false)
  }

  function handleDownload() {
    if (!records?.length) return
    const headers = ['Call #', 'Make/Model', 'Year', 'Disposition', 'Value', 'Date Disposed']
    const rows = records.map(r => [
      r.call_number,
      r.make_model ?? '',
      r.year ?? '',
      r.sold ? 'Sold' : 'Scrapped',
      saleValue(r),
      r.disposition_date ? formatDate(r.disposition_date) : '',
    ])
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `impound-sales-${fromDate}-to-${toDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalValue    = records?.reduce((sum, r) => sum + saleValue(r), 0) ?? 0
  const soldCount     = records?.filter(r => r.sold).length ?? 0
  const scrappedCount = records?.filter(r => r.scrapped && !r.sold).length ?? 0

  const inputStyle: React.CSSProperties = {
    padding: '0.4rem 0.75rem',
    background: 'rgb(var(--surface-high))',
    border: '1px solid rgb(var(--outline))',
    borderRadius: '0.5rem',
    color: 'rgb(var(--on-surface))',
    fontSize: '0.85rem',
    fontFamily: 'inherit',
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 40 }}
      />

      <div style={{
        position: 'fixed', top: '5vh', left: '50%', transform: 'translateX(-50%)',
        width: 'min(960px, 95vw)', maxHeight: '90vh',
        background: 'rgb(var(--surface-container))',
        border: '1px solid rgb(var(--outline))',
        borderRadius: '1rem',
        zIndex: 50, display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.25rem', borderBottom: '1px solid rgb(var(--outline))',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'rgb(var(--on-surface))' }}>
              Sales History
            </div>
            <div style={{ fontSize: '0.8rem', color: 'rgb(var(--on-surface-muted))' }}>
              Vehicles marked as sold or scrapped
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '1.5rem', color: 'rgb(var(--on-surface-muted))',
            lineHeight: 1, padding: '0.25rem',
          }}>×</button>
        </div>

        {/* Date range + fetch */}
        <div style={{
          padding: '1rem 1.25rem', borderBottom: '1px solid rgb(var(--outline))',
          display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'rgb(var(--on-surface))' }}>
            From
            <input type="date" style={inputStyle} value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'rgb(var(--on-surface))' }}>
            To
            <input type="date" style={inputStyle} value={toDate} onChange={e => setToDate(e.target.value)} />
          </label>
          <button
            className="btn-primary"
            onClick={handleFetch}
            disabled={loading || !fromDate || !toDate}
            style={{ fontSize: '0.85rem', padding: '0.4rem 1rem' }}
          >
            {loading ? 'Loading…' : 'View'}
          </button>
          {records !== null && records.length > 0 && (
            <button
              className="btn-secondary"
              onClick={handleDownload}
              style={{ fontSize: '0.85rem', padding: '0.4rem 1rem', marginLeft: 'auto' }}
            >
              ↓ Download CSV
            </button>
          )}
        </div>

        {/* Metrics */}
        {records !== null && (
          <div style={{
            display: 'flex', gap: '1rem', padding: '0.875rem 1.25rem',
            borderBottom: '1px solid rgb(var(--outline))',
            flexWrap: 'wrap',
          }}>
            {[
              { label: 'Total Records', value: records.length },
              { label: 'Sold',          value: soldCount },
              { label: 'Scrapped',      value: scrappedCount },
              { label: 'Total Value',   value: currency(totalValue), highlight: true },
            ].map(({ label, value, highlight }) => (
              <div key={label} style={{
                background: 'rgb(var(--surface-high))',
                border: `1px solid ${highlight ? 'rgb(var(--primary))' : 'rgb(var(--outline))'}`,
                borderRadius: '0.625rem',
                padding: '0.625rem 1rem',
                minWidth: 110,
              }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgb(var(--on-surface-muted))', marginBottom: '0.2rem' }}>
                  {label}
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: highlight ? 'rgb(var(--primary))' : 'rgb(var(--on-surface))', lineHeight: 1 }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {records === null && (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'rgb(var(--on-surface-muted))', fontSize: '0.875rem' }}>
              Select a date range and click View to load records.
            </div>
          )}
          {records !== null && records.length === 0 && (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'rgb(var(--on-surface-muted))', fontSize: '0.875rem', fontStyle: 'italic' }}>
              No sold or scrapped vehicles found in that date range.
            </div>
          )}
          {records !== null && records.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ background: 'rgb(var(--surface-high))', borderBottom: '1px solid rgb(var(--outline))' }}>
                  {['Call #', 'Vehicle', 'Year', 'Disposition', 'Value', 'Date Disposed'].map(h => (
                    <th key={h} style={{
                      padding: '0.625rem 1rem', textAlign: 'left',
                      fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.06em', color: 'rgb(var(--on-surface-muted))',
                      whiteSpace: 'nowrap', position: 'sticky', top: 0,
                      background: 'rgb(var(--surface-high))',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid rgb(var(--outline))' }}>
                    <td style={{ padding: '0.625rem 1rem', fontWeight: 600, color: 'rgb(var(--primary))' }}>
                      {r.call_number}
                    </td>
                    <td style={{ padding: '0.625rem 1rem' }}>
                      {r.make_model || '—'}
                    </td>
                    <td style={{ padding: '0.625rem 1rem' }}>
                      {r.year || '—'}
                    </td>
                    <td style={{ padding: '0.625rem 1rem' }}>
                      <span style={{
                        display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: 9999,
                        fontSize: '0.7rem', fontWeight: 600,
                        background: r.sold ? '#16a34a22' : '#94a3b822',
                        color: r.sold ? '#16a34a' : 'rgb(var(--on-surface-muted))',
                      }}>
                        {r.sold ? 'Sold' : 'Scrapped'}
                      </span>
                    </td>
                    <td style={{ padding: '0.625rem 1rem', fontWeight: 600 }}>
                      {currency(saleValue(r))}
                    </td>
                    <td style={{ padding: '0.625rem 1rem', color: 'rgb(var(--on-surface-muted))' }}>
                      {formatDate(r.disposition_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
