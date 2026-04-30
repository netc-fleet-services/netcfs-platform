'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { Truck } from '@/lib/types'
import { CATEGORY_LABELS } from '@/lib/constants'

interface InspectionRecord {
  unit_number: string
  inspector: string
  inspected_date: string
  has_fails: boolean
  items: { key: string; label: string; rating: string; comment: string }[]
  trucks?: { category: string | null; locations?: { name: string } | null } | null
}

interface Props {
  trucks: Truck[]
  onClose: () => void
}

function calcOosDaysInRange(truck: Truck, start: Date, end: Date): number {
  const history = [...(truck.status_history || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  let totalMs = 0
  let oosStart: Date | null = null

  for (const entry of history) {
    const t = new Date(entry.created_at)
    if (entry.new_status === 'oos') {
      if (!oosStart) oosStart = t
    } else if (oosStart) {
      const ps = oosStart < start ? start : oosStart
      const pe = t > end ? end : t
      if (pe > ps) totalMs += pe.getTime() - ps.getTime()
      oosStart = null
    }
  }

  if (oosStart) {
    const ps = oosStart < start ? start : oosStart
    const pe = end
    if (pe > ps) totalMs += pe.getTime() - ps.getTime()
  }

  return Math.round(totalMs / (1000 * 60 * 60 * 24) * 10) / 10
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'rgb(var(--on-surface-muted))',
  marginBottom: '0.375rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

export function HistoryReportModal({ trucks, onClose }: Props) {
  const supabase = getSupabaseBrowserClient()
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const [startDate, setStartDate]               = useState(firstOfMonth.toISOString().slice(0, 10))
  const [endDate,   setEndDate]                 = useState(today.toISOString().slice(0, 10))
  const [includeOos,         setIncludeOos]         = useState(true)
  const [includeWorkLog,     setIncludeWorkLog]     = useState(true)
  const [includeInspections, setIncludeInspections] = useState(true)
  const [downloading, setDownloading] = useState(false)

  const noneSelected = !includeOos && !includeWorkLog && !includeInspections
  const isValid = startDate && endDate && startDate <= endDate && !noneSelected

  async function download() {
    setDownloading(true)
    const start = new Date(startDate + 'T00:00:00')
    const end   = new Date(endDate   + 'T23:59:59')

    const wb = XLSX.utils.book_new()

    if (includeOos) {
      const rows: unknown[][] = [[
        'Unit #', 'Category', 'Location', 'OOS Days in Range', 'Last PM Date', 'Next PM Due',
      ]]
      for (const truck of trucks) {
        rows.push([
          truck.unit_number,
          CATEGORY_LABELS[truck.category ?? ''] || truck.category || '',
          truck.locations?.name || '',
          calcOosDaysInRange(truck, start, end),
          truck.maintenance?.last_pm_date || '',
          truck.maintenance?.next_pm_date || '',
        ])
      }
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [10, 14, 16, 18, 16, 16].map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, ws, 'OOS Summary')
    }

    if (includeWorkLog) {
      const rows: unknown[][] = [[
        'Date', 'Unit #', 'Category', 'Location', 'Type', 'Description', 'Added By',
      ]]
      for (const truck of trucks) {
        const notes = (truck.truck_notes || []).filter(n => {
          const d = new Date(n.created_at)
          return d >= start && d <= end && (n.note_type === 'work_done' || n.note_type === 'mechanic')
        })
        for (const note of notes) {
          rows.push([
            new Date(note.created_at).toLocaleDateString('en-US'),
            truck.unit_number,
            CATEGORY_LABELS[truck.category ?? ''] || truck.category || '',
            truck.locations?.name || '',
            note.note_type === 'work_done' ? 'Work Done' : 'Mechanic Note',
            note.body,
            note.created_by,
          ])
        }
      }
      rows.splice(1, rows.length - 1, ...[...rows.slice(1)].sort((a, b) =>
        new Date(a[0] as string).getTime() - new Date(b[0] as string).getTime()
      ))
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [14, 10, 14, 16, 16, 50, 24].map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, ws, 'Work Log')
    }

    if (includeInspections) {
      const { data: inspections } = await supabase
        .from('vehicle_inspections')
        .select('unit_number, inspector, inspected_date, has_fails, items, trucks(category, locations(name))')
        .gte('inspected_date', startDate)
        .lte('inspected_date', endDate)
        .order('inspected_date', { ascending: true })

      const rows: unknown[][] = [[
        'Date', 'Unit #', 'Category', 'Location', 'Inspector', 'Result', 'Failed Items',
      ]]
      for (const insp of ((inspections ?? []) as InspectionRecord[])) {
        const failedItems = (insp.items || [])
          .filter(i => i.rating === 'bad')
          .map(i => i.comment ? `${i.label} — ${i.comment}` : i.label)
          .join('; ')
        const failCount = (insp.items || []).filter(i => i.rating === 'bad').length
        rows.push([
          insp.inspected_date,
          insp.unit_number,
          CATEGORY_LABELS[insp.trucks?.category ?? ''] || '',
          insp.trucks?.locations?.name || '',
          insp.inspector,
          insp.has_fails ? `${failCount} Failed` : 'Passed',
          failedItems || '—',
        ])
      }
      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [14, 10, 14, 16, 18, 12, 60].map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, ws, 'Inspections')
    }

    XLSX.writeFile(wb, `fleet-report-${startDate}-to-${endDate}.xlsx`)
    setDownloading(false)
    onClose()
  }

  const CheckRow = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
    <label style={{
      display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer',
      padding: '0.5rem 0.75rem',
      background: checked ? 'rgb(var(--primary-container))' : 'rgb(var(--surface))',
      border: `1px solid ${checked ? 'rgb(var(--primary))' : 'rgb(var(--outline))'}`,
      borderRadius: '0.5rem',
      transition: 'background 0.1s, border-color 0.1s',
      userSelect: 'none',
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ accentColor: 'rgb(var(--primary))', width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }}
      />
      <span style={{ fontSize: '0.8375rem', fontWeight: checked ? 600 : 400, color: checked ? 'rgb(var(--on-primary-container))' : 'rgb(var(--on-surface))' }}>
        {label}
      </span>
    </label>
  )

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'rgb(var(--surface-container))',
        border: '1px solid rgb(var(--outline))',
        borderRadius: '0.875rem',
        padding: '1.75rem',
        width: '100%',
        maxWidth: 440,
      }}>
        <h2 style={{ margin: '0 0 0.375rem', fontSize: '1.0625rem', fontWeight: 700, color: 'rgb(var(--on-surface))' }}>
          Download History Report
        </h2>
        <p style={{ margin: '0 0 1.5rem', fontSize: '0.8125rem', color: 'rgb(var(--on-surface-muted))', lineHeight: 1.5 }}>
          Select the sheets to include and a date range.
        </p>

        {/* Date range */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ flex: 1 }}>
            <label style={LABEL_STYLE}>Start Date</label>
            <input type="date" className="form-input" value={startDate} onChange={e => setStartDate(e.target.value)} max={endDate} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={LABEL_STYLE}>End Date</label>
            <input type="date" className="form-input" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} max={today.toISOString().slice(0, 10)} />
          </div>
        </div>

        {/* Sheet selection */}
        <label style={{ ...LABEL_STYLE, marginBottom: '0.5rem' }}>Include in Report</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginBottom: '1.5rem' }}>
          <CheckRow label="OOS Days Summary"     checked={includeOos}         onChange={setIncludeOos} />
          <CheckRow label="Work Log"             checked={includeWorkLog}     onChange={setIncludeWorkLog} />
          <CheckRow label="Inspections Completed" checked={includeInspections} onChange={setIncludeInspections} />
        </div>

        {noneSelected && (
          <div style={{ marginBottom: '1rem', fontSize: '0.8rem', color: 'rgb(var(--error))', padding: '0.5rem 0.75rem', background: 'rgb(var(--error-container))', borderRadius: '0.5rem' }}>
            Select at least one sheet to download.
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={download}
            disabled={!isValid || downloading}
            style={{ opacity: isValid && !downloading ? 1 : 0.5 }}
          >
            {downloading ? 'Building…' : '⬇ Download Excel'}
          </button>
        </div>
      </div>
    </div>
  )
}
