'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import type { Truck } from '@/lib/types'
import { CATEGORY_LABELS } from '@/lib/constants'

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

  // Still OOS (no closing entry)
  if (oosStart) {
    const ps = oosStart < start ? start : oosStart
    const pe = end
    if (pe > ps) totalMs += pe.getTime() - ps.getTime()
  }

  return Math.round(totalMs / (1000 * 60 * 60 * 24) * 10) / 10
}

export function HistoryReportModal({ trucks, onClose }: Props) {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const [startDate, setStartDate] = useState(firstOfMonth.toISOString().slice(0, 10))
  const [endDate,   setEndDate]   = useState(today.toISOString().slice(0, 10))

  function download() {
    const start = new Date(startDate + 'T00:00:00')
    const end   = new Date(endDate   + 'T23:59:59')

    const summaryRows: unknown[][] = [[
      'Unit #', 'Category', 'Location', 'OOS Days in Range',
      'Work Done Count', 'Last PM Date', 'Next PM Due',
    ]]

    const worklogRows: unknown[][] = [[
      'Date', 'Unit #', 'Category', 'Location', 'Type', 'Description', 'Added By',
    ]]

    for (const truck of trucks) {
      const oosDays = calcOosDaysInRange(truck, start, end)

      const workNotes = (truck.truck_notes || []).filter(n => {
        const d = new Date(n.created_at)
        return d >= start && d <= end && (n.note_type === 'work_done' || n.note_type === 'mechanic')
      })

      summaryRows.push([
        truck.unit_number,
        CATEGORY_LABELS[truck.category ?? ''] || truck.category || '',
        truck.locations?.name || '',
        oosDays,
        workNotes.length,
        truck.maintenance?.last_pm_date || '',
        truck.maintenance?.next_pm_date || '',
      ])

      for (const note of workNotes) {
        worklogRows.push([
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

    // Sort work log by date
    worklogRows.splice(1, worklogRows.length - 1, ...[...worklogRows.slice(1)].sort((a, b) =>
      new Date(a[0] as string).getTime() - new Date(b[0] as string).getTime()
    ))

    const wb = XLSX.utils.book_new()

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows)
    wsSummary['!cols'] = [10, 14, 16, 18, 18, 16, 16].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

    const wsLog = XLSX.utils.aoa_to_sheet(worklogRows)
    wsLog['!cols'] = [14, 10, 14, 16, 16, 50, 24].map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, wsLog, 'Work Log')

    const filename = `fleet-history-${startDate}-to-${endDate}.xlsx`
    XLSX.writeFile(wb, filename)
    onClose()
  }

  const isValid = startDate && endDate && startDate <= endDate

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
        maxWidth: 420,
      }}>
        <h2 style={{ margin: '0 0 0.375rem', fontSize: '1.0625rem', fontWeight: 700, color: 'rgb(var(--on-surface))' }}>
          Download History Report
        </h2>
        <p style={{ margin: '0 0 1.5rem', fontSize: '0.8125rem', color: 'rgb(var(--on-surface-muted))', lineHeight: 1.5 }}>
          Generates an Excel file with a summary of OOS days and a detailed work log for each truck in the selected date range.
        </p>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'rgb(var(--on-surface-muted))', marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Start Date
            </label>
            <input
              type="date"
              className="form-input"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              max={endDate}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'rgb(var(--on-surface-muted))', marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              End Date
            </label>
            <input
              type="date"
              className="form-input"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              min={startDate}
              max={today.toISOString().slice(0, 10)}
            />
          </div>
        </div>

        <div style={{ fontSize: '0.8rem', color: 'rgb(var(--on-surface-muted))', marginBottom: '1.5rem', padding: '0.75rem', background: 'rgb(var(--surface))', borderRadius: '0.5rem' }}>
          <strong style={{ color: 'rgb(var(--on-surface))' }}>{trucks.length} trucks</strong> will be included.
          Report contains two sheets: <em>Summary</em> (OOS days per truck) and <em>Work Log</em> (all maintenance entries).
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={download}
            disabled={!isValid}
            style={{ opacity: isValid ? 1 : 0.5 }}
          >
            ⬇ Download Excel
          </button>
        </div>
      </div>
    </div>
  )
}
