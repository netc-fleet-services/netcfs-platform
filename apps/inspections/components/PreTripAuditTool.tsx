'use client'

import { useState, useRef, useCallback, useMemo } from 'react'
import {
  parseDriverActivity,
  parsePreTrip,
  calculateAudit,
  fmtDate,
  type AuditResult,
} from '../lib/engine'

type SortCol = 'driver' | 'required' | 'completed' | 'missed' | 'pct'
type SortDir = 'asc' | 'desc'

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    XLSX: any
  }
}

function pctColor(pct: number) {
  if (pct >= 100) return '#4ade80'
  if (pct >= 80)  return 'rgb(var(--primary))'
  if (pct >= 50)  return '#f59e0b'
  return 'rgb(var(--error))'
}

function rowClass(pct: number) {
  if (pct >= 100) return 'pit-row-perfect'
  if (pct < 50)   return 'pit-row-crit'
  if (pct < 80)   return 'pit-row-warn'
  return ''
}

function loadXLSX(): Promise<Window['XLSX']> {
  if (window.XLSX) return Promise.resolve(window.XLSX)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js'
    s.onload  = () => resolve(window.XLSX)
    s.onerror = () => reject(new Error('Failed to load SheetJS from CDN. Check your internet connection.'))
    document.head.appendChild(s)
  })
}

function readBuf(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = e => resolve(new Uint8Array(e.target!.result as ArrayBuffer))
    r.onerror = reject
    r.readAsArrayBuffer(file)
  })
}

// ---------------------------------------------------------------------------
// DropZone sub-component
// ---------------------------------------------------------------------------
function DropZone({
  label, hint, icon, file, over, onFile, onOver,
}: {
  label: string
  hint: string
  icon: string
  file: File | null
  over: boolean
  onFile: (f: File | null) => void
  onOver: (b: boolean) => void
}) {
  return (
    <div
      className={`pit-drop${over ? ' pit-over' : ''}${file ? ' pit-loaded' : ''}`}
      onDragOver={e => { e.preventDefault(); onOver(true) }}
      onDragLeave={() => onOver(false)}
      onDrop={e => { e.preventDefault(); onOver(false); onFile(e.dataTransfer.files[0] ?? null) }}
    >
      <input type="file" accept=".xlsx,.xls" onChange={e => onFile(e.target.files?.[0] ?? null)} />
      <div className="pit-drop-icon">{icon}</div>
      <div className="pit-drop-label">{label}</div>
      <div className="pit-drop-hint">{hint}</div>
      {file && <div className="pit-drop-file">✓ {file.name}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SortHeader sub-component
// ---------------------------------------------------------------------------
function SortHeader({
  col, label, sortCol, sortDir, onSort, numeric,
}: {
  col: SortCol
  label: string
  sortCol: SortCol
  sortDir: SortDir
  onSort: (col: SortCol) => void
  numeric?: boolean
}) {
  const active = sortCol === col
  const cls = [
    numeric ? 'pit-num' : '',
    active && sortDir === 'asc'  ? 'pit-asc'  : '',
    active && sortDir === 'desc' ? 'pit-desc' : '',
  ].filter(Boolean).join(' ')

  return (
    <th data-col={col} className={cls || undefined} onClick={() => onSort(col)}>
      {label}
    </th>
  )
}

// ---------------------------------------------------------------------------
// Main tool component
// ---------------------------------------------------------------------------
export function PreTripAuditTool() {
  const [activityFile, setActivityFile] = useState<File | null>(null)
  const [pretripFile,  setPretripFile]  = useState<File | null>(null)
  const [auditData,    setAuditData]    = useState<AuditResult | null>(null)
  const [sortCol,      setSortCol]      = useState<SortCol>('pct')
  const [sortDir,      setSortDir]      = useState<SortDir>('asc')
  const [query,        setQuery]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [actOver,      setActOver]      = useState(false)
  const [ptOver,       setPtOver]       = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xlsxRef = useRef<any>(null)

  const handleSort = useCallback((col: SortCol) => {
    if (col === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }, [sortCol])

  const handleRun = useCallback(async () => {
    if (!activityFile || !pretripFile) return
    setError(null)
    setLoading(true)
    try {
      if (!xlsxRef.current) xlsxRef.current = await loadXLSX()
      const XLSX = xlsxRef.current

      const [actBuf, ptBuf] = await Promise.all([readBuf(activityFile), readBuf(pretripFile)])
      const actWb = XLSX.read(actBuf, { type: 'array', cellDates: true })
      const ptWb  = XLSX.read(ptBuf,  { type: 'array', cellDates: true })

      const required    = parseDriverActivity(actWb, XLSX)
      const completions = parsePreTrip(ptWb, XLSX)
      setAuditData(calculateAudit(required, completions))
    } catch (err) {
      setError((err as Error).message || 'An unexpected error occurred. Check that the correct files were uploaded.')
    } finally {
      setLoading(false)
    }
  }, [activityFile, pretripFile])

  const handleReset = useCallback(() => {
    setActivityFile(null)
    setPretripFile(null)
    setAuditData(null)
    setSortCol('pct')
    setSortDir('asc')
    setQuery('')
    setError(null)
  }, [])

  const handleExport = useCallback(async () => {
    if (!auditData || !xlsxRef.current) return
    const XLSX = xlsxRef.current
    const { results, fuzzyMatches, missedDetails, dateRange } = auditData

    const wb = XLSX.utils.book_new()

    const ws1 = XLSX.utils.json_to_sheet(results.map(r => ({
      'Driver': r.driver, 'Required': r.required,
      'Completed': r.completed, 'Missed': r.missed, 'Completion %': r.pct,
    })))
    ws1['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 11 }, { wch: 8 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Audit Results')

    if (missedDetails.length) {
      const ws2 = XLSX.utils.json_to_sheet(missedDetails.map(m => ({
        'Driver': m.driver, 'Date': m.date, 'Truck': m.truck,
      })))
      ws2['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 32 }]
      XLSX.utils.book_append_sheet(wb, ws2, 'Missing Inspections')
    }

    if (fuzzyMatches.length) {
      const ws3 = XLSX.utils.json_to_sheet(fuzzyMatches.map(f => ({
        'Dispatch Name': f.dispatchName, 'Inspection Name': f.inspectionName,
        'Date': f.date, 'Truck': f.truck, 'Match Type': f.matchType,
      })))
      ws3['!cols'] = [{ wch: 24 }, { wch: 24 }, { wch: 12 }, { wch: 32 }, { wch: 22 }]
      XLSX.utils.book_append_sheet(wb, ws3, 'Fuzzy Matches')
    }

    const buf  = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const blob = new Blob([buf], { type: 'application/octet-stream' })
    const tag  = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(blob),
      download: `pretrip-audit-${dateRange.min ?? 'report'}.xlsx`,
    })
    tag.click()
    URL.revokeObjectURL(tag.href)
  }, [auditData])

  const sortedRows = useMemo(() => {
    if (!auditData) return []
    let rows = auditData.results
    if (query) {
      const q = query.toLowerCase()
      rows = rows.filter(r => r.driver.toLowerCase().includes(q))
    }
    return [...rows].sort((a, b) => {
      const cmp = sortCol === 'driver'
        ? a.driver.localeCompare(b.driver)
        : a[sortCol] - b[sortCol]
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [auditData, query, sortCol, sortDir])

  // ── Upload view ────────────────────────────────────────────────────────────
  if (!auditData) {
    return (
      <div>
        <div className="pit-upload-grid">
          <DropZone
            label="Driver Activity Report"
            hint="DriverActivity.xlsx — Detailed tab"
            icon="📋"
            file={activityFile}
            over={actOver}
            onFile={setActivityFile}
            onOver={setActOver}
          />
          <DropZone
            label="PreTrip Inspections Report"
            hint="PreTripInspections.xlsx — Export tab"
            icon="🔍"
            file={pretripFile}
            over={ptOver}
            onFile={setPretripFile}
            onOver={setPtOver}
          />
        </div>
        {error && <div className="pit-error">⚠ {error}</div>}
        <button
          className="pit-btn-run"
          disabled={!activityFile || !pretripFile || loading}
          onClick={handleRun}
        >
          {loading
            ? <><span className="pit-spinner" />Processing…</>
            : 'Run Audit'}
        </button>
      </div>
    )
  }

  // ── Results view ───────────────────────────────────────────────────────────
  const { results, dateRange, fuzzyMatches, missedDetails } = auditData
  const totReq   = results.reduce((s, r) => s + r.required,  0)
  const totDone  = results.reduce((s, r) => s + r.completed, 0)
  const fleetPct = totReq > 0 ? Math.round(totDone / totReq * 1000) / 10 : 100
  const below80  = results.filter(r => r.pct < 80).length
  const perfect  = results.filter(r => r.pct >= 100).length

  return (
    <div>
      {/* Summary cards */}
      <div className="pit-cards">
        <div className="pit-card pit-card-hl">
          <div className="pit-card-lbl">Fleet Completion</div>
          <div className="pit-card-val">{fleetPct}%</div>
        </div>
        <div className="pit-card">
          <div className="pit-card-lbl">Required</div>
          <div className="pit-card-val">{totReq.toLocaleString()}</div>
        </div>
        <div className="pit-card">
          <div className="pit-card-lbl">Completed</div>
          <div className="pit-card-val">{totDone.toLocaleString()}</div>
        </div>
        <div className="pit-card">
          <div className="pit-card-lbl">Missed</div>
          <div className="pit-card-val">{(totReq - totDone).toLocaleString()}</div>
        </div>
        <div className={`pit-card${below80 > 0 ? ' pit-card-warn' : ''}`}>
          <div className="pit-card-lbl">Drivers &lt; 80%</div>
          <div className="pit-card-val">{below80}</div>
        </div>
        <div className={`pit-card${perfect > 0 ? ' pit-card-good' : ''}`}>
          <div className="pit-card-lbl">Drivers at 100%</div>
          <div className="pit-card-val">{perfect}</div>
        </div>
      </div>

      {/* Controls */}
      <div className="pit-controls">
        <input
          type="search"
          className="pit-search"
          placeholder="Search drivers, trucks…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {dateRange.min && (
          <span className="pit-date-range">
            {fmtDate(dateRange.min)} – {fmtDate(dateRange.max)}
          </span>
        )}
        <button className="pit-btn-sec" onClick={handleExport}>↓ Export Excel</button>
        <button className="pit-btn-sec" onClick={handleReset}>← New Audit</button>
      </div>

      {/* Table */}
      <div className="pit-tbl-wrap">
        <table className="pit-tbl">
          <thead>
            <tr>
              <SortHeader col="driver"    label="Driver"        sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortHeader col="required"  label="Required"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} numeric />
              <SortHeader col="completed" label="Completed"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} numeric />
              <SortHeader col="missed"    label="Missed"        sortCol={sortCol} sortDir={sortDir} onSort={handleSort} numeric />
              <SortHeader col="pct"       label="Completion %"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr><td className="pit-empty" colSpan={5}>No results match your search.</td></tr>
            ) : sortedRows.map(r => {
              const fillColor = pctColor(r.pct)
              const fillPct   = Math.min(r.pct, 100)
              return (
                <tr key={r.driver} className={rowClass(r.pct) || undefined}>
                  <td className="pit-driver">{r.driver}</td>
                  <td className="pit-num">{r.required}</td>
                  <td className="pit-num">{r.completed}</td>
                  <td className="pit-num">{r.missed}</td>
                  <td>
                    <div className="pit-pct-cell">
                      <div className="pit-bar">
                        <div className="pit-bar-fill" style={{ width: `${fillPct}%`, background: fillColor }} />
                      </div>
                      <span className="pit-pct-lbl" style={{ color: fillColor }}>{r.pct}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Missing inspections accordion */}
      {missedDetails.length > 0 && (
        <details className="pit-accord">
          <summary><span>Missing Inspections ({missedDetails.length})</span></summary>
          <div className="pit-accord-body">
            <table className="pit-sub-tbl">
              <thead><tr><th>Driver</th><th>Date</th><th>Truck</th></tr></thead>
              <tbody>
                {missedDetails.map((m, i) => (
                  <tr key={i}>
                    <td>{m.driver}</td>
                    <td>{fmtDate(m.date)}</td>
                    <td>{m.truck}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Fuzzy matches accordion */}
      {fuzzyMatches.length > 0 && (
        <details className="pit-accord">
          <summary><span>Fuzzy Matches Applied ({fuzzyMatches.length})</span></summary>
          <div className="pit-accord-body">
            <p style={{ fontSize: '0.72rem', color: 'rgb(var(--on-surface-muted))', margin: '0 0 0.5rem' }}>
              These inspections were matched using name or truck-label variations. Review to confirm they are correct.
            </p>
            <table className="pit-sub-tbl">
              <thead>
                <tr>
                  <th>Dispatch Name</th>
                  <th>Inspection Name</th>
                  <th>Date</th>
                  <th>Truck</th>
                  <th>Match Type</th>
                </tr>
              </thead>
              <tbody>
                {fuzzyMatches.map((f, i) => (
                  <tr key={i}>
                    <td>{f.dispatchName}</td>
                    <td>{f.inspectionName}</td>
                    <td>{fmtDate(f.date)}</td>
                    <td>{f.truck}</td>
                    <td>{f.matchType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}
