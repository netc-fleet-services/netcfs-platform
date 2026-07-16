'use client'

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_CONFIG, type CompanyBucket } from '../lib/config'
import type { Driver, ScheduleEntry } from '../lib/types'
import { listDrivers, listScheduleBetween } from '../lib/db'
import {
  addDays,
  dateRange,
  escapeHtml,
  formatName,
  formatTime12,
  fromIsoDate,
  shortDateLabel,
  startOfWeek,
  timeToHours,
  toIsoDate,
} from '../lib/utils'
import { useSettings } from '../lib/settings'

type Output = 'print' | 'csv'
type Format = 'table' | 'gantt'
type Tab = 'drivers' | 'dispatchers'

interface Props {
  supabase: SupabaseClient
  companyBucket: CompanyBucket
  defaultStartIso: string
  defaultTab: Tab
  defaultFormat: Format
  defaultYard: string
  yardOptions: string[]
  yardFilterFor: (display: string) => string[] | null
  driverSort?: (drivers: Driver[], opts: { entries: ScheduleEntry[]; week: Date[] }) => Driver[]
  onClose: () => void
}

export function ExportModal({
  supabase,
  companyBucket,
  defaultStartIso,
  defaultTab,
  defaultFormat,
  defaultYard,
  yardOptions,
  yardFilterFor,
  driverSort,
  onClose,
}: Props) {
  const { hiddenDriverIds } = useSettings()
  const [output, setOutput] = useState<Output>('print')
  const [tab, setTab] = useState<Tab>(defaultTab)
  const [format, setFormat] = useState<Format>(defaultFormat)
  const [start, setStart] = useState(defaultStartIso || toIsoDate(startOfWeek(new Date())))
  const [days, setDays] = useState(7)
  const [yard, setYard] = useState(defaultYard)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!start) { setError('Pick a start date.'); return }
    const n = Math.max(1, Math.min(31, Number(days) || 7))
    setBusy(true)
    try {
      const data = await loadScheduleData(supabase, { tab, companyBucket, isoStart: start, days: n, yard, yardFilterFor, driverSort, hiddenIds: hiddenDriverIds })
      if (output === 'csv') {
        const csv = buildCsv(data)
        downloadCsv(`${tab}-schedule_${start}_${n}d${yard ? `_yard-${yard}` : ''}.csv`, csv)
      } else {
        const html = format === 'gantt'
          ? buildGanttDoc(data)
          : buildTableDoc(data)
        openPrintWindow(html)
      }
      onClose()
    } catch (err) {
      console.error('Export build failed:', err)
      setError(err instanceof Error ? err.message : "Couldn’t build the export.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={onClose} />
      <form className="modal__panel" onSubmit={onSubmit}>
        <header className="modal__header">
          <h2>Export schedule</h2>
          <button type="button" className="sched-btn sched-btn--ghost modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal__body">
          <div className="entry-type">
            <label>
              <input type="radio" name="print-output" value="print" checked={output === 'print'} onChange={() => setOutput('print')} />
              <span>Print preview</span>
            </label>
            <label>
              <input type="radio" name="print-output" value="csv" checked={output === 'csv'} onChange={() => setOutput('csv')} />
              <span>CSV download</span>
            </label>
          </div>

          <div className="entry-type">
            <label>
              <input type="radio" name="print-tab" value="drivers" checked={tab === 'drivers'} onChange={() => setTab('drivers')} />
              <span>Drivers</span>
            </label>
            <label>
              <input type="radio" name="print-tab" value="dispatchers" checked={tab === 'dispatchers'} onChange={() => setTab('dispatchers')} />
              <span>Dispatchers</span>
            </label>
          </div>

          {output === 'print' && (
            <div className="entry-type">
              <label>
                <input type="radio" name="print-format" value="table" checked={format === 'table'} onChange={() => setFormat('table')} />
                <span>Table (one cell per day)</span>
              </label>
              <label>
                <input type="radio" name="print-format" value="gantt" checked={format === 'gantt'} onChange={() => setFormat('gantt')} />
                <span>Gantt (timeline bars)</span>
              </label>
            </div>
          )}

          <div className="row-fields">
            <label className="field">
              <span>Start date</span>
              <input type="date" required value={start} onChange={e => setStart(e.target.value)} />
            </label>
            <label className="field">
              <span>Days</span>
              <input type="number" min="1" max="31" required value={days} onChange={e => setDays(Number(e.target.value) || 7)} />
            </label>
            <label className="field">
              <span>Yard</span>
              <select value={yard} onChange={e => setYard(e.target.value)}>
                <option value="">All yards</option>
                {yardOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </div>
          <p className="muted hint">Default starts on Monday of the visible week and runs 7 days through Sunday.</p>

          {error && <div className="form-error">{error}</div>}
        </div>
        <footer className="modal__footer">
          <div className="modal__footer-spacer" />
          <button type="button" className="sched-btn sched-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="sched-btn sched-btn--primary" disabled={busy}>
            {busy ? 'Loading…' : (output === 'csv' ? 'Download CSV' : 'Open print preview')}
          </button>
        </footer>
      </form>
    </div>
  )
}

// ============================================================================
//  Data fetch + HTML build
// ============================================================================

interface ScheduleDataInput {
  tab: Tab
  companyBucket: CompanyBucket
  isoStart: string
  days: number
  yard: string
  yardFilterFor: (display: string) => string[] | null
  driverSort?: (drivers: Driver[], opts: { entries: ScheduleEntry[]; week: Date[] }) => Driver[]
  hiddenIds?: number[]
}

interface ScheduleData {
  tab: Tab
  sorted: Driver[]
  entries: ScheduleEntry[]
  dates: Date[]
  byKey: Map<string, ScheduleEntry[]>
  days: number
  tabLabel: string
  title: string
  subtitle: string
  isoStart: string
  isoEnd: string
}

async function loadScheduleData(
  supabase: SupabaseClient,
  { tab, companyBucket, isoStart, days, yard, yardFilterFor, driverSort, hiddenIds }: ScheduleDataInput,
): Promise<ScheduleData> {
  const tabDef = APP_CONFIG.tabs.find(t => t.id === tab)
  const functions = tabDef ? tabDef.functions : null

  const startDate = fromIsoDate(isoStart)
  const dates = dateRange(startDate, days)
  const isoEnd = toIsoDate(dates[dates.length - 1])

  const yardFilter = yard ? yardFilterFor(yard) : null

  const [drivers, entries] = await Promise.all([
    listDrivers(supabase, {
      includeInactive: false,
      companyBucket,
      yard: companyBucket === 'interstate' ? yardFilter : null,
      functions,
      hiddenIds: hiddenIds ?? null,
    }),
    listScheduleBetween(supabase, isoStart, isoEnd),
  ])

  const byKey = new Map<string, ScheduleEntry[]>()
  for (const e of entries) {
    const k = `${e.driver_id}|${e.schedule_date}`
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(e)
  }

  const sorted = driverSort
    ? driverSort(drivers, { entries, week: dates })
    : drivers.slice().sort((a, b) => {
        const cmp = String(a.function || '').localeCompare(String(b.function || ''))
        if (cmp !== 0) return cmp
        return formatName(a.name).localeCompare(formatName(b.name))
      })

  const tabLabel = tab === 'dispatchers' ? 'Dispatcher' : 'Driver'
  const rangeLabel = days === 1
    ? shortDateLabel(dates[0])
    : `${shortDateLabel(dates[0])} → ${shortDateLabel(dates[days - 1])}`
  const printedAt = new Date().toLocaleString()
  const yardLabel = yard ? `Yard ${yard}` : 'All yards'
  const bucketLabel = APP_CONFIG.companyBuckets.find(b => b.id === companyBucket)?.label ?? ''
  const title = `${tabLabel} Schedule — ${rangeLabel}`
  const subtitle = `${bucketLabel} · ${yardLabel} · ${sorted.length} ${tabLabel.toLowerCase()}${sorted.length === 1 ? '' : 's'} · printed ${printedAt}`

  return { tab, sorted, entries, dates, byKey, days, tabLabel, title, subtitle, isoStart, isoEnd }
}

// ---------- Table format ----------

function buildTableDoc({ title, subtitle, sorted, dates, byKey, days }: ScheduleData): string {
  const headerRow = `
    <tr>
      <th class="col-driver">Driver</th>
      ${dates.map(d => `
        <th>
          <div class="dow">${d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
          <div class="dom">${d.getMonth() + 1}/${d.getDate()}</div>
        </th>`).join('')}
    </tr>`

  const bodyRows = sorted.map(driver => {
    const driverCell = `
      <td class="col-driver">
        <div class="name">${escapeHtml(driver.name || '(unnamed)')}</div>
        <div class="meta">
          <span>${escapeHtml(driver.function || '—')}</span>
          <span>#${escapeHtml(driver.irh_driver_number || driver.id)}</span>
          <span>yard ${escapeHtml(driver.irh_yard_number || driver.yard || '—')}</span>
        </div>
      </td>`
    const dayCells = dates.map(d => {
      const iso = toIsoDate(d)
      const list = byKey.get(`${driver.id}|${iso}`) || []
      return `<td>${renderTableCell(list)}</td>`
    }).join('')
    return `<tr>${driverCell}${dayCells}</tr>`
  }).join('')

  return tablePrintDocTemplate({ title, subtitle, headerRow, bodyRows, colCount: days })
}

function renderTableCell(entries: ScheduleEntry[]): string {
  if (!entries.length) return `<span class="empty">—</span>`
  const off = entries.find(e => e.entry_type === 'off')
  if (off) return `<div class="off">OFF${off.off_reason ? ` · ${escapeHtml(off.off_reason)}` : ''}</div>`
  const shifts = entries
    .filter(e => e.entry_type === 'shift')
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
  return shifts.map(e => {
    const start = formatTime12(e.start_time)
    const end = formatTime12(e.end_time)
    const overnight = e.end_time != null && e.start_time != null && e.end_time < e.start_time
    return `
      <div class="shift">
        <span class="times">${start} – ${end}${overnight ? ' <small>+1d</small>' : ''}</span>
        ${e.notes ? `<div class="notes">${escapeHtml(e.notes)}</div>` : ''}
      </div>`
  }).join('')
}

function tablePrintDocTemplate({
  title, subtitle, headerRow, bodyRows, colCount,
}: {
  title: string; subtitle: string; headerRow: string; bodyRows: string; colCount: number
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  /* margin: 0 leaves the browser no room to print its own header/footer
     (date, "about:blank" URL, page number); body padding restores the margin. */
  @page { size: ${colCount > 7 ? '11in 17in' : 'letter'} landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { font: 10pt -apple-system, "Segoe UI", Roboto, sans-serif; color: #000; background: #fff; margin: 0; padding: 0.4in; }
  header { margin-bottom: 10px; }
  h1 { font-size: 16pt; margin: 0 0 4px; }
  .subtitle { font-size: 9pt; color: #555; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #888; padding: 4px 6px; vertical-align: top; text-align: left; word-wrap: break-word; }
  thead th { background: #eee; font-weight: 600; font-size: 9pt; }
  thead th .dow { font-size: 13pt; }
  thead th .dom { font-size: 11pt; color: #555; font-weight: 400; }
  td.col-driver, th.col-driver { width: 1.6in; }
  .name { font-weight: 600; font-size: 10pt; }
  .meta { font-size: 8pt; color: #555; display: flex; flex-wrap: wrap; gap: 4px 8px; margin-top: 2px; }
  .shift { font-size: 9pt; }
  .shift + .shift { margin-top: 3px; padding-top: 3px; border-top: 1px dashed #bbb; }
  .times { font-weight: 600; }
  .notes { font-size: 8pt; color: #555; }
  .off { color: #b91c1c; font-weight: 700; font-size: 9pt; text-transform: uppercase; }
  .empty { color: #bbb; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .toolbar { margin: 8px 0 14px; }
  .toolbar button { padding: 6px 12px; font: inherit; cursor: pointer; }
  @media print { .toolbar { display: none; } @page { margin: 0; } html, body { height: auto; } }
  .page { transform-origin: top left; }
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Print</button>
    <button type="button" onclick="window.close()">Close</button>
  </div>
  <main class="page">
    <header>
      <h1>${escapeHtml(title)}</h1>
      <div class="subtitle">${escapeHtml(subtitle)}</div>
    </header>
    <table>
      <thead>${headerRow}</thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </main>
  ${fitOnePageScript(colCount)}
</body>
</html>`
}

// Scales the printable container down (never up) so the whole schedule lands on
// one printed page. Uses CSS `zoom` rather than `transform: scale` because
// Chromium pagination respects zoom's layout dimensions, while transformed
// elements keep their pre-transform bounding box for page-break purposes.
// Paper choice mirrors the @page rule above: letter landscape for ≤7 columns,
// tabloid (11×17) landscape for wider ranges.
function fitOnePageScript(colCount: number): string {
  const isLarge = colCount > 7
  const pageWidthIn = isLarge ? 17 : 11
  const pageHeightIn = isLarge ? 11 : 8.5
  const marginIn = 0.4
  return `<script>
(function(){
  var DPI = 96;
  var availW = (${pageWidthIn} - 2 * ${marginIn}) * DPI;
  var availH = (${pageHeightIn} - 2 * ${marginIn}) * DPI;
  function fit(){
    var el = document.querySelector('.page');
    if (!el) return;
    el.style.zoom = '';
    // Force a reflow so scrollWidth/Height reflect the un-zoomed layout.
    void el.offsetHeight;
    var w = el.scrollWidth;
    var h = el.scrollHeight;
    if (!w || !h) return;
    var s = Math.min(1, availW / w, availH / h);
    // Leave a tiny safety margin so rounding can't push us onto a 2nd page.
    s = s * 0.98;
    if (s < 1) el.style.zoom = String(s);
  }
  window.addEventListener('load', fit);
  window.addEventListener('beforeprint', fit);
  window.addEventListener('resize', fit);
})();
</script>`
}

function openPrintWindow(html: string) {
  // No "noopener" — Chrome returns null in that case, leaving us without a
  // handle to the popup. We need the reference to write the document.
  const w = window.open('', '_blank', 'width=1100,height=800')
  if (!w) {
    alert('Popup blocked. Allow popups for this site, then try again.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  setTimeout(() => {
    try { w.focus(); w.print() }
    catch (err) { console.error('Print failed:', err) }
  }, 250)
}

// ---------- Gantt format ----------

function buildGanttDoc({ title, subtitle, sorted, dates, byKey, days }: ScheduleData): string {
  const totalHours = days * 24
  const weekStartMs = dates[0].getTime()

  const axisLabels = dates.map((d, i) => {
    const leftPct = ((i * 24) / totalHours) * 100
    const widthPct = (24 / totalHours) * 100
    const dow = d.toLocaleDateString(undefined, { weekday: 'short' })
    const dom = `${d.getMonth() + 1}/${d.getDate()}`
    return `<div class="gx-day" style="left:${leftPct}%;width:${widthPct}%">
              <span class="gx-dow">${dow}</span>
              <span class="gx-dom">${dom}</span>
            </div>`
  }).join('')

  const dayDividers = Array.from({ length: days - 1 }, (_, i) => {
    const leftPct = (((i + 1) * 24) / totalHours) * 100
    return `<div class="gx-divider" style="left:${leftPct}%"></div>`
  }).join('')

  const rows = sorted.map(driver => {
    const driverEntries: ScheduleEntry[] = []
    for (const d of dates) {
      const iso = toIsoDate(d)
      const list = byKey.get(`${driver.id}|${iso}`) || []
      for (const e of list) driverEntries.push(e)
    }
    const bars = driverEntries.map(e => {
      const date = fromIsoDate(e.schedule_date)
      const dayOffsetH = Math.round((date.getTime() - weekStartMs) / 3600000)
      if (dayOffsetH < 0 || dayOffsetH >= totalHours) return ''

      if (e.entry_type === 'off') {
        const leftPct = (dayOffsetH / totalHours) * 100
        const widthPct = (24 / totalHours) * 100
        return `<div class="gx-bar gx-bar--off" style="left:${leftPct}%;width:${widthPct}%"
                     title="OFF${e.off_reason ? ' · ' + escapeHtml(e.off_reason) : ''}">
                  <span>OFF${e.off_reason ? ' · ' + escapeHtml(e.off_reason) : ''}</span>
                </div>`
      }
      if (e.entry_type !== 'shift') return ''

      const sH = timeToHours(e.start_time)
      let eH = timeToHours(e.end_time)
      if (eH <= sH) eH += 24
      const startTotal = dayOffsetH + sH
      const endTotal = Math.min(totalHours, dayOffsetH + eH)
      if (endTotal <= startTotal) return ''
      const leftPct = (startTotal / totalHours) * 100
      const widthPct = ((endTotal - startTotal) / totalHours) * 100
      const start = formatTime12(e.start_time)
      const end = formatTime12(e.end_time)
      const overnight = eH > 24
      return `<div class="gx-bar gx-bar--shift" style="left:${leftPct}%;width:${widthPct}%"
                   title="${start} – ${end}${overnight ? ' (next day)' : ''}">
                <span class="gx-bar__times">${start} – ${end}${overnight ? ' <small>+1d</small>' : ''}</span>
              </div>`
    }).join('')

    return `
      <div class="gx-row">
        <div class="gx-driver">
          <div class="name">${escapeHtml(formatName(driver.name) || '(unnamed)')}</div>
          <div class="meta">
            <span>${escapeHtml(driver.function || '—')}</span>
            <span>#${escapeHtml(driver.irh_driver_number || driver.id)}</span>
            <span>yard ${escapeHtml(driver.irh_yard_number || driver.yard || '—')}</span>
          </div>
        </div>
        <div class="gx-track">
          ${dayDividers}
          ${bars}
        </div>
      </div>`
  }).join('')

  return ganttPrintDocTemplate({ title, subtitle, axisLabels, rows, colCount: days })
}

function ganttPrintDocTemplate({
  title, subtitle, axisLabels, rows, colCount,
}: {
  title: string; subtitle: string; axisLabels: string; rows: string; colCount: number
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  /* margin: 0 leaves the browser no room to print its own header/footer
     (date, "about:blank" URL, page number); body padding restores the margin. */
  @page { size: ${colCount > 7 ? '11in 17in' : 'letter'} landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { font: 9pt -apple-system, "Segoe UI", Roboto, sans-serif; color: #000; background: #fff; margin: 0; padding: 0.4in; }
  header { margin-bottom: 10px; }
  h1 { font-size: 16pt; margin: 0 0 4px; }
  .subtitle { font-size: 9pt; color: #555; }
  .gx-head { display: flex; align-items: stretch; border: 1px solid #888; border-bottom: none; }
  .gx-head__driver { width: 1.6in; flex: 0 0 1.6in; padding: 4px 6px; font-weight: 600; background: #eee; border-right: 1px solid #888; }
  .gx-axis { position: relative; flex: 1 1 auto; height: 42px; background: #eee; }
  .gx-day { position: absolute; top: 0; bottom: 0; padding: 4px 6px; border-left: 1px solid #888; }
  .gx-day:first-child { border-left: none; }
  .gx-dow { display: block; font-weight: 600; font-size: 13pt; }
  .gx-dom { display: block; font-size: 11pt; color: #555; }
  .gx-row { display: flex; align-items: stretch; border: 1px solid #888; border-top: none; min-height: 38px; page-break-inside: avoid; }
  .gx-driver { width: 1.6in; flex: 0 0 1.6in; padding: 4px 6px; border-right: 1px solid #888; }
  .gx-driver .name { font-weight: 600; font-size: 10pt; }
  .gx-driver .meta { font-size: 8pt; color: #555; display: flex; flex-wrap: wrap; gap: 2px 6px; margin-top: 2px; }
  .gx-track { position: relative; flex: 1 1 auto; }
  .gx-divider { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px solid #ccc; }
  .gx-bar { position: absolute; top: 4px; bottom: 4px; padding: 2px 4px; overflow: hidden; border-radius: 2px; font-size: 8pt; }
  .gx-bar--shift { background: #dbeafe; border: 1px solid #1d4ed8; color: #1d4ed8; }
  .gx-bar--shift .gx-bar__times { font-weight: 700; white-space: nowrap; }
  .gx-bar--off   { background: #fee2e2; border: 1px solid #b91c1c; color: #b91c1c; font-weight: 700; text-align: center; }
  .toolbar { margin: 8px 0 14px; }
  .toolbar button { padding: 6px 12px; font: inherit; cursor: pointer; }
  @media print { .toolbar { display: none; } @page { margin: 0; } html, body { height: auto; } }
  .page { transform-origin: top left; }
</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Print</button>
    <button type="button" onclick="window.close()">Close</button>
  </div>
  <main class="page">
    <header>
      <h1>${escapeHtml(title)}</h1>
      <div class="subtitle">${escapeHtml(subtitle)}</div>
    </header>
    <div class="gx-head">
      <div class="gx-head__driver">Driver</div>
      <div class="gx-axis">${axisLabels}</div>
    </div>
    ${rows}
  </main>
  ${fitOnePageScript(colCount)}
</body>
</html>`
}

// ---------- CSV ----------

function buildCsv({ sorted, dates, byKey }: ScheduleData): string {
  const header = ['Name', 'Number', 'Function', 'Yard', 'Date', 'Day', 'Type', 'Start', 'End', 'Off reason', 'Notes']
  const rows: (string | number)[][] = [header]
  for (const d of sorted) {
    for (const date of dates) {
      const iso = toIsoDate(date)
      const dow = date.toLocaleDateString(undefined, { weekday: 'short' })
      const list = byKey.get(`${d.id}|${iso}`) || []
      if (!list.length) continue
      for (const e of list) {
        rows.push([
          formatName(d.name),
          d.irh_driver_number || d.id,
          d.function || '',
          d.irh_yard_number || '',
          iso,
          dow,
          e.entry_type || '',
          e.entry_type === 'shift' ? (e.start_time || '') : '',
          e.entry_type === 'shift' ? (e.end_time || '') : '',
          e.entry_type === 'off' ? (e.off_reason || '') : '',
          (e.notes || '').replace(/\r?\n/g, ' '),
        ])
      }
    }
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n')
}

function csvCell(v: string | number): string {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(filename: string, csv: string) {
  // BOM so Excel detects UTF-8.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Unused — kept for clarity that addDays is part of the same date toolkit.
void addDays
