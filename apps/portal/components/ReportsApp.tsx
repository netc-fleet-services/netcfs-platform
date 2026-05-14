'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'

// ── Types ──────────────────────────────────────────────────────────────────────

type Row = Record<string, string | number | boolean | null>
type Col = { id: string; label: string; optional?: boolean }
type Section = { title: string; columns: Col[]; rows: Row[] }
type ReportResult = { sections: Section[]; summaryLines?: string[] }

// ── Constants ──────────────────────────────────────────────────────────────────

const SCRAP_VALUE = 600

const IMPOUND_STATUSES = ['Owned', 'Police Hold', 'Current Impound']
const LOCATIONS        = ['Exeter', 'Pembroke', 'Bow', 'Saco', 'Lee']
const TRUCK_CATEGORIES = [
  { value: 'hd_tow',    label: 'HD Tow' },
  { value: 'ld_tow',    label: 'LD Tow' },
  { value: 'roadside',  label: 'Roadside' },
  { value: 'transport', label: 'Transport' },
]
const COMPLIANCE_TYPES = [
  { value: 'dot_citation', label: 'DOT Citation' },
  { value: 'oos',          label: 'Out of Service' },
  { value: 'accident',     label: 'Accident' },
  { value: 'other',        label: 'Other' },
]

const REPORTS = [
  { id: 'driver-safety',        label: 'Driver Safety Report',         description: 'Scorecards, safety events, and mileage for drivers over a period.' },
  { id: 'dvir-compliance',      label: 'DVIR Compliance',              description: 'Daily vehicle inspection completion by driver and date.' },
  { id: 'compliance-incidents', label: 'Compliance Incidents',         description: 'DOT citations, out-of-service orders, and accidents.' },
  { id: 'impound-inventory',    label: 'Impound Inventory',            description: 'Active and historical impound records filtered by status and location.' },
  { id: 'impound-disposition',  label: 'Impound Disposition & Revenue',description: 'Sold, scrapped, and released vehicles with revenue totals.' },
  { id: 'dispatch-history',     label: 'Dispatch History',             description: 'TowBook jobs filterable by date, status, and job type.' },
  { id: 'maintenance-history',  label: 'Maintenance History',          description: 'Truck OOS days, PM dates, and work notes by category and location.' },
  { id: 'equipment-requests',   label: 'Equipment Requests',           description: 'Submitted equipment requests with approval status.' },
  { id: 'scheduler-analytics',  label: 'Scheduler Analytics',          description: 'Aggregated analytics from the driver scheduler — coverage, hours, trends, and more.' },
]

const SCHED_CARD_DEFS = [
  { id: 'coverage-hour',      label: 'Coverage by hour-of-day' },
  { id: 'coverage-day',       label: 'Hours by day-of-week' },
  { id: 'coverage-heatmap',   label: 'Coverage heatmap' },
  { id: 'shift-length',       label: 'Shift-length distribution' },
  { id: 'top-drivers',        label: 'Top 10 drivers by hours' },
  { id: 'bottom-drivers',     label: 'Bottom 10 drivers by hours' },
  { id: 'function-breakdown', label: 'Hours by function' },
  { id: 'week-over-week',     label: 'Week-over-week total hours' },
  { id: 'off-reasons',        label: 'Off-day reasons' },
  { id: 'yard-utilization',   label: 'Yard utilization' },
  { id: 'overnight-trend',    label: 'Overnight shifts trend' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function quarterStart(): string {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  return new Date(now.getFullYear(), q * 3, 1).toISOString().split('T')[0]
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso.includes('T') ? iso : iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// Calculate total days in OOS status within a date range from status_history entries
function calcOosDays(
  entries: { new_status: string; created_at: string }[],
  startDate: string,
  endDate: string,
): number {
  const rangeStart = new Date(startDate).getTime()
  const rangeEnd   = new Date(endDate + 'T23:59:59').getTime()
  const sorted = [...entries].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  let totalMs = 0
  let oosStart: number | null = null
  for (const e of sorted) {
    const ts = new Date(e.created_at).getTime()
    if (e.new_status === 'oos') {
      if (oosStart === null) oosStart = ts
    } else if (oosStart !== null) {
      const s = Math.max(oosStart, rangeStart)
      const f = Math.min(ts, rangeEnd)
      if (f > s) totalMs += f - s
      oosStart = null
    }
  }
  if (oosStart !== null) {
    const s = Math.max(oosStart, rangeStart)
    if (rangeEnd > s) totalMs += rangeEnd - s
  }
  return Math.round(totalMs / 86_400_000)
}

// ── Scheduler helpers (ported from apps/scheduler/lib/utils.ts) ───────────────

function schedToIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function schedFromIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d)
}
function schedAddDays(d: Date, n: number): Date {
  const out = new Date(d); out.setDate(out.getDate() + n); return out
}
function schedStartOfWeek(d: Date): Date {
  const out = new Date(d); const dow = out.getDay()
  out.setDate(out.getDate() + (dow === 0 ? -6 : 1 - dow)); out.setHours(0, 0, 0, 0); return out
}
function schedShiftDurationHours(startTime: string | null, endTime: string | null): number {
  if (!startTime || !endTime) return 0
  const t = (s: string) => { const [h, m] = s.split(':').map(Number); return h + (m || 0) / 60 }
  const s = t(startTime); let e = t(endTime); if (e <= s) e += 24; return e - s
}
function schedParseTime(t: string | null | undefined): number {
  if (!t) return 0; const [h, m] = String(t).split(':').map(Number); return h + (m || 0) / 60
}

// ── Scheduler aggregations (ported from apps/scheduler/components/StatsView.tsx) ─

interface SchedEntry {
  driver_id: number; schedule_date: string; entry_type: string
  start_time: string | null; end_time: string | null; off_reason: string | null
}
interface SchedDriver {
  id: number; name: string | null; function: string | null; irh_yard_number: string | null
}

function schedAggHoursByHourOfDay(entries: SchedEntry[], days: number): number[] {
  const counts = new Array(24).fill(0)
  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    let s = schedParseTime(e.start_time); let f = schedParseTime(e.end_time)
    if (f <= s) f += 24
    for (let h = Math.floor(s); h < Math.ceil(f); h++) counts[h % 24] += 1
  }
  return counts.map(c => +(c / Math.max(1, days)).toFixed(2))
}
function schedAggHoursByDayOfWeek(entries: SchedEntry[]): { labels: string[]; data: number[] } {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const buckets = new Array(7).fill(0)
  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    const dow = (schedFromIsoDate(e.schedule_date).getDay() + 6) % 7
    buckets[dow] += schedShiftDurationHours(e.start_time, e.end_time)
  }
  return { labels, data: buckets.map(v => +v.toFixed(1)) }
}
function schedAggHeatmap(entries: SchedEntry[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  const dayCounts = new Array(7).fill(0)
  const seenDates = new Set<string>()
  for (const e of entries) {
    if (!seenDates.has(e.schedule_date)) {
      const dow = (schedFromIsoDate(e.schedule_date).getDay() + 6) % 7
      dayCounts[dow] += 1; seenDates.add(e.schedule_date)
    }
    if (e.entry_type !== 'shift') continue
    const dow = (schedFromIsoDate(e.schedule_date).getDay() + 6) % 7
    let s = schedParseTime(e.start_time); let f = schedParseTime(e.end_time)
    if (f <= s) f += 24
    for (let h = Math.floor(s); h < Math.ceil(f); h++) grid[dow][h % 24] += 1
  }
  return grid.map((row, dow) => row.map(v => dayCounts[dow] ? +(v / dayCounts[dow]).toFixed(2) : 0))
}
function schedAggShiftLengthDist(entries: SchedEntry[]): { labels: string[]; data: number[] } {
  const bins = [4, 6, 8, 10, 12, 24]; const labels = ['<4h', '4-6h', '6-8h', '8-10h', '10-12h', '12+h']
  const counts = new Array(bins.length).fill(0)
  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    const h = schedShiftDurationHours(e.start_time, e.end_time)
    let i = bins.findIndex(b => h <= b); if (i < 0) i = bins.length - 1
    counts[i] += 1
  }
  return { labels, data: counts }
}
function schedAggHoursPerDriver(entries: SchedEntry[], drivers: SchedDriver[]): Array<{ id: number; name: string; fn: string; hours: number }> {
  const map = new Map<number, number>()
  for (const d of drivers) map.set(d.id, 0)
  for (const e of entries) {
    if (e.entry_type !== 'shift' || !map.has(e.driver_id)) continue
    map.set(e.driver_id, (map.get(e.driver_id) || 0) + schedShiftDurationHours(e.start_time, e.end_time))
  }
  return [...map.entries()].map(([id, hours]) => {
    const d = drivers.find(x => x.id === id)
    return { id, name: d?.name || `#${id}`, fn: d?.function || '', hours: +hours.toFixed(1) }
  })
}
function schedAggFunctionBreakdown(entries: SchedEntry[], drivers: SchedDriver[]): { labels: string[]; data: number[] } {
  const drvFn = new Map(drivers.map(d => [d.id, d.function || 'Unknown']))
  const buckets = new Map<string, number>()
  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    const fn = drvFn.get(e.driver_id) || 'Unknown'
    buckets.set(fn, (buckets.get(fn) || 0) + schedShiftDurationHours(e.start_time, e.end_time))
  }
  const arr = [...buckets.entries()].sort((a, b) => b[1] - a[1])
  return { labels: arr.map(x => x[0]), data: arr.map(x => +x[1].toFixed(1)) }
}
function schedAggOffReasons(entries: SchedEntry[]): { labels: string[]; data: number[] } {
  const buckets = new Map<string, number>()
  for (const e of entries) {
    if (e.entry_type !== 'off') continue
    const r = e.off_reason || 'unknown'
    buckets.set(r, (buckets.get(r) || 0) + 1)
  }
  const arr = [...buckets.entries()].sort((a, b) => b[1] - a[1])
  return { labels: arr.map(x => x[0]), data: arr.map(x => x[1]) }
}
function schedAggYardUtilization(entries: SchedEntry[], drivers: SchedDriver[]): { labels: string[]; data: number[] } {
  const drvYard = new Map<number, string[]>()
  for (const d of drivers) {
    const list = String(d.irh_yard_number || '—').split(',').map(s => s.trim()).filter(Boolean)
    drvYard.set(d.id, list.length ? list : ['—'])
  }
  const buckets = new Map<string, number>()
  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    const yards = drvYard.get(e.driver_id) || ['—']
    const h = schedShiftDurationHours(e.start_time, e.end_time) / yards.length
    for (const y of yards) buckets.set(y, (buckets.get(y) || 0) + h)
  }
  const arr = [...buckets.entries()].sort((a, b) => b[1] - a[1])
  return { labels: arr.map(x => x[0]), data: arr.map(x => +x[1].toFixed(1)) }
}
function schedBucketByWeek(entries: SchedEntry[], weeks: number): { labels: string[]; buckets: SchedEntry[][] } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const bkts: SchedEntry[][] = new Array(weeks).fill(null).map(() => [])
  const labels: string[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = schedAddDays(today, -7 * (i + 1) + 1)
    labels.push(start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
  }
  for (const e of entries) {
    const d = schedFromIsoDate(e.schedule_date)
    const diffDays = Math.floor((today.getTime() - d.getTime()) / 86_400_000)
    if (diffDays < 0) continue
    const wIdx = weeks - 1 - Math.floor(diffDays / 7)
    if (wIdx >= 0 && wIdx < weeks) bkts[wIdx].push(e)
  }
  return { labels, buckets: bkts }
}
function schedAggWeeklyTotals(entries: SchedEntry[], weeks: number): { labels: string[]; data: number[] } {
  const { labels, buckets } = schedBucketByWeek(entries, weeks)
  return {
    labels,
    data: buckets.map(b => +b.filter(e => e.entry_type === 'shift')
      .reduce((s, e) => s + schedShiftDurationHours(e.start_time, e.end_time), 0).toFixed(1)),
  }
}
function schedAggOvernightByWeek(entries: SchedEntry[], weeks: number): { labels: string[]; data: number[] } {
  const { labels, buckets } = schedBucketByWeek(entries, weeks)
  return {
    labels,
    data: buckets.map(b => b.filter(e =>
      e.entry_type === 'shift' && e.end_time && e.start_time && e.end_time < e.start_time,
    ).length),
  }
}

// ── Export helpers ─────────────────────────────────────────────────────────────

function buildCSV(columns: Col[], rows: Row[]): string {
  const esc = (v: Row[string]) => {
    const s = v == null ? '' : String(v)
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [
    columns.map(c => esc(c.label)).join(','),
    ...rows.map(r => columns.map(c => esc(r[c.id] ?? null)).join(',')),
  ].join('\n')
}

function downloadCSV(filename: string, sections: Section[]) {
  const parts: string[] = []
  for (const sec of sections) {
    if (sections.length > 1) parts.push(`# ${sec.title}`)
    parts.push(buildCSV(sec.columns, sec.rows))
    if (sections.length > 1) parts.push('')
  }
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([parts.join('\n')], { type: 'text/csv' })),
    download: filename,
  })
  a.click()
  URL.revokeObjectURL(a.href)
}

async function downloadXLSX(filename: string, sections: Section[]) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const sec of sections) {
    const data = [
      sec.columns.map(c => c.label),
      ...sec.rows.map(r => sec.columns.map(c => r[c.id] ?? '')),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), sec.title.substring(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const inputSt: React.CSSProperties = {
  padding: '0.375rem 0.625rem',
  background: 'rgb(var(--surface-high))',
  border: '1px solid rgb(var(--outline))',
  borderRadius: '0.5rem',
  color: 'rgb(var(--on-surface))',
  fontSize: '0.8125rem',
  fontFamily: 'inherit',
}

const labelSt: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '0.25rem',
  fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: 'rgb(var(--on-surface-muted))',
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ReportsApp() {
  const supabase = getSupabaseBrowserClient()

  const [selected,    setSelected]    = useState('driver-safety')
  const [loading,     setLoading]     = useState(false)
  const [result,      setResult]      = useState<ReportResult | null>(null)
  const [error,       setError]       = useState<string | null>(null)

  // Filters
  const [dateFrom,     setDateFrom]     = useState(quarterStart)
  const [dateTo,       setDateTo]       = useState(todayStr)
  const [yard,         setYard]         = useState('all')
  const [category,     setCategory]     = useState('all')
  const [location,     setLocation]     = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [jobType,      setJobType]      = useState('all')
  const [dispType,     setDispType]     = useState('all')
  const [missedOnly,   setMissedOnly]   = useState(false)
  const [eligibleOnly, setEligibleOnly] = useState(false)

  // Populated after running Dispatch History so job type filter is dynamic
  const [knownJobTypes, setKnownJobTypes] = useState<string[]>([])

  // Scheduler analytics state
  const [schedPreset, setSchedPreset] = useState('30')
  const [schedFrom, setSchedFrom] = useState(quarterStart)
  const [schedTo, setSchedTo] = useState(todayStr)
  const [schedCards, setSchedCards] = useState<Set<string>>(() => new Set(SCHED_CARD_DEFS.map(c => c.id)))
  const [schedExportFilter, setSchedExportFilter] = useState<Set<string>>(new Set())

  const [hiddenCols,    setHiddenCols]    = useState<Set<string>>(new Set())
  const [showColPicker, setShowColPicker] = useState(false)
  const colsInitializedRef = useRef(false)

  function selectReport(id: string) {
    setSelected(id)
    setResult(null)
    setError(null)
    setStatusFilter('all')
    setJobType('all')
    setHiddenCols(new Set())
    setShowColPicker(false)
    colsInitializedRef.current = false
    if (id === 'scheduler-analytics') {
      setSchedCards(new Set(SCHED_CARD_DEFS.map(c => c.id)))
    }
  }

  function toggleCol(id: string) {
    setHiddenCols(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function run() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch()
      if (!colsInitializedRef.current) {
        setHiddenCols(new Set(
          (res.sections[0]?.columns ?? []).filter(c => c.optional).map(c => c.id)
        ))
        colsInitializedRef.current = true
      }
      if (selected === 'scheduler-analytics') {
        setSchedExportFilter(new Set(res.sections.map(s => s.title)))
      }
      setResult(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  // ── Fetch functions ──────────────────────────────────────────────────────────

  async function fetch(): Promise<ReportResult> {
    switch (selected) {
      case 'driver-safety':        return fetchDriverSafety()
      case 'dvir-compliance':      return fetchDvir()
      case 'compliance-incidents': return fetchCompliance()
      case 'impound-inventory':    return fetchImpoundInventory()
      case 'impound-disposition':  return fetchImpoundDisposition()
      case 'dispatch-history':     return fetchDispatch()
      case 'maintenance-history':   return fetchMaintenance()
      case 'equipment-requests':    return fetchEquipment()
      case 'scheduler-analytics':  return fetchSchedulerAnalytics()
      default: throw new Error('Unknown report')
    }
  }

  async function fetchDriverSafety(): Promise<ReportResult> {
    let q = supabase
      .from('score_snapshots')
      .select('*')
      .gte('period_start', dateFrom)
      .lte('period_end', dateTo)
      .order('driver_name')
    if (yard !== 'all') q = q.eq('driver_yard', yard)
    if (eligibleOnly) q = q.eq('eligible', true)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const scoreCols: Col[] = [
      { id: 'driver_name',        label: 'Driver' },
      { id: 'driver_yard',        label: 'Yard' },
      { id: 'driver_function',    label: 'Function' },
      { id: 'period_start',       label: 'Period Start' },
      { id: 'period_end',         label: 'Period End' },
      { id: 'safety_score',       label: 'Safety Score' },
      { id: 'miles_driven',       label: 'Miles' },
      { id: 'total_event_points', label: 'Event Points' },
      { id: 'severity_rate',      label: 'Severity Rate' },
      { id: 'dvir_days_missed',   label: 'DVIR Missed' },
      { id: 'compliance_penalty', label: 'Compliance Penalty' },
      { id: 'rank',               label: 'Rank' },
      { id: 'rank_group',         label: 'Group' },
      { id: 'eligible',           label: 'Eligible' },
      { id: 'disqualified',       label: 'Disqualified' },
      { id: 'driving_score',      label: 'Driving Score',  optional: true },
      { id: 'dvir_penalty',       label: 'DVIR Penalty',   optional: true },
      { id: 'locked',             label: 'Locked',         optional: true },
    ]
    const scoreRows: Row[] = (data ?? []).map(r => ({
      driver_name:        r.driver_name,
      driver_yard:        r.driver_yard ?? '',
      driver_function:    r.driver_function ?? '',
      period_start:       fmtDate(r.period_start),
      period_end:         fmtDate(r.period_end),
      safety_score:       r.eligible ? Number(r.safety_score).toFixed(1) : '—',
      miles_driven:       Number(r.miles_driven).toFixed(0),
      total_event_points: r.total_event_points,
      severity_rate:      r.eligible ? Number(r.severity_rate).toFixed(2) : '—',
      dvir_days_missed:   r.dvir_days_missed,
      compliance_penalty: r.compliance_penalty,
      rank:               r.rank ?? '—',
      rank_group:         r.rank_group ?? '',
      eligible:           r.eligible ? 'Yes' : 'No',
      disqualified:       r.disqualified ? 'Yes' : '',
      driving_score:      r.eligible ? Number(r.driving_score).toFixed(1) : '—',
      dvir_penalty:       r.dvir_penalty ?? 0,
      locked:             r.locked ? 'Yes' : 'No',
    }))

    // Fetch events + mileage for same drivers/period (included in XLSX extra sheets)
    const driverIds = (data ?? []).map(r => r.driver_id).filter(Boolean)
    const sections: Section[] = [{ title: 'Scorecards', columns: scoreCols, rows: scoreRows }]

    if (driverIds.length > 0) {
      const [{ data: evData }, { data: miData }] = await Promise.all([
        supabase
          .from('safety_events')
          .select('driver_name, occurred_at, event_type, final_status, severity_points, max_speed, speed_limit, unit_number')
          .in('driver_id', driverIds)
          .gte('occurred_at', dateFrom + 'T00:00:00Z')
          .lte('occurred_at', dateTo + 'T23:59:59Z')
          .order('occurred_at', { ascending: false }),
        supabase
          .from('mileage_logs')
          .select('driver_name, log_date, miles')
          .in('driver_id', driverIds)
          .gte('log_date', dateFrom)
          .lte('log_date', dateTo)
          .order('log_date', { ascending: false }),
      ])

      if (evData?.length) {
        sections.push({
          title: 'Safety Events',
          columns: [
            { id: 'driver_name',     label: 'Driver' },
            { id: 'occurred_at',     label: 'Date' },
            { id: 'event_type',      label: 'Event Type' },
            { id: 'final_status',    label: 'Status' },
            { id: 'severity_points', label: 'Points' },
            { id: 'max_speed',       label: 'Max Speed' },
            { id: 'speed_limit',     label: 'Speed Limit' },
            { id: 'unit_number',     label: 'Unit' },
          ],
          rows: evData.map(e => ({
            driver_name:     e.driver_name,
            occurred_at:     fmtDate(e.occurred_at),
            event_type:      e.event_type,
            final_status:    e.final_status,
            severity_points: e.severity_points,
            max_speed:       e.max_speed ?? '',
            speed_limit:     e.speed_limit ?? '',
            unit_number:     e.unit_number ?? '',
          })),
        })
      }
      if (miData?.length) {
        sections.push({
          title: 'Daily Mileage',
          columns: [
            { id: 'driver_name', label: 'Driver' },
            { id: 'log_date',    label: 'Date' },
            { id: 'miles',       label: 'Miles' },
          ],
          rows: miData.map(m => ({
            driver_name: m.driver_name,
            log_date:    fmtDate(m.log_date),
            miles:       Number(m.miles).toFixed(1),
          })),
        })
      }
    }

    const eligible = scoreRows.filter(r => r.eligible === 'Yes').length
    return {
      sections,
      summaryLines: [
        `${scoreRows.length} drivers · ${eligible} eligible`,
        sections.length > 1 ? `Excel export includes ${sections.length} sheets: ${sections.map(s => s.title).join(', ')}` : '',
      ].filter(Boolean),
    }
  }

  async function fetchDvir(): Promise<ReportResult> {
    let q = supabase
      .from('dvir_logs')
      .select('driver_name, log_date, completed, manually_overridden, source, notes')
      .gte('log_date', dateFrom)
      .lte('log_date', dateTo)
      .order('log_date', { ascending: false })
    if (missedOnly) q = q.eq('completed', false)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const rows: Row[] = (data ?? []).map(r => ({
      driver_name:         r.driver_name,
      log_date:            fmtDate(r.log_date),
      completed:           r.completed ? 'Yes' : 'No',
      manually_overridden: r.manually_overridden ? 'Yes' : '',
      source:              r.source ?? '',
      notes:               r.notes ?? '',
    }))
    const missed = rows.filter(r => r.completed === 'No').length
    return {
      sections: [{ title: 'DVIR Compliance', columns: [
        { id: 'driver_name',         label: 'Driver' },
        { id: 'log_date',            label: 'Date' },
        { id: 'completed',           label: 'Completed' },
        { id: 'manually_overridden', label: 'Manually Verified' },
        { id: 'source',              label: 'Source' },
        { id: 'notes',               label: 'Notes' },
      ], rows }],
      summaryLines: [`${rows.length} records · ${missed} missed`],
    }
  }

  async function fetchCompliance(): Promise<ReportResult> {
    const TYPE_LABELS: Record<string, string> = {
      dot_citation: 'DOT Citation', oos: 'Out of Service', accident: 'Accident', other: 'Other',
    }
    let q = supabase
      .from('compliance_events')
      .select('driver_name, event_date, event_type, points, notes, entered_by')
      .gte('event_date', dateFrom)
      .lte('event_date', dateTo)
      .order('event_date', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('event_type', statusFilter)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const rows: Row[] = (data ?? []).map(r => ({
      driver_name: r.driver_name,
      event_date:  fmtDate(r.event_date),
      event_type:  TYPE_LABELS[r.event_type] ?? r.event_type,
      points:      r.points,
      notes:       r.notes ?? '',
      entered_by:  r.entered_by ?? '',
    }))
    const totalPts = rows.reduce((s, r) => s + Number(r.points), 0)
    return {
      sections: [{ title: 'Compliance Incidents', columns: [
        { id: 'driver_name', label: 'Driver' },
        { id: 'event_date',  label: 'Date' },
        { id: 'event_type',  label: 'Type' },
        { id: 'points',      label: 'Points' },
        { id: 'notes',       label: 'Notes' },
        { id: 'entered_by',  label: 'Entered By' },
      ], rows }],
      summaryLines: [`${rows.length} incidents · ${totalPts} total points`],
    }
  }

  async function fetchImpoundInventory(): Promise<ReportResult> {
    let q = supabase
      .from('impounds')
      .select('call_number, date_of_impound, make_model, year, vin, location, status, reason_for_impound, released, keys, drives, sell, estimated_value, notes, sales_description, needs_detail, needs_mechanic, estimated_repair_cost, internal_cost, amount_paid')
      .gte('date_of_impound', dateFrom)
      .lte('date_of_impound', dateTo)
      .order('date_of_impound', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    if (location !== 'all')     q = q.eq('location', location)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const rows: Row[] = (data ?? []).map(r => ({
      call_number:        r.call_number,
      date_of_impound:    fmtDate(r.date_of_impound),
      vehicle:            [r.year, r.make_model].filter(Boolean).join(' '),
      vin:                r.vin ?? '',
      location:           r.location ?? '',
      status:             r.status ?? '',
      reason_for_impound: r.reason_for_impound ?? '',
      released:           r.released ? 'Yes' : 'No',
      keys:               r.keys === true ? 'Yes' : r.keys === false ? 'No' : '',
      drives:             r.drives === true ? 'Yes' : r.drives === false ? 'No' : '',
      sell:                  r.sell ? 'Yes' : '',
      estimated_value:       r.estimated_value != null ? `$${Number(r.estimated_value).toLocaleString()}` : '',
      notes:                 r.notes ?? '',
      sales_description:     r.sales_description ?? '',
      needs_detail:          r.needs_detail ? 'Yes' : '',
      needs_mechanic:        r.needs_mechanic ? 'Yes' : '',
      estimated_repair_cost: r.estimated_repair_cost != null ? `$${Number(r.estimated_repair_cost).toLocaleString()}` : '',
      internal_cost:         r.internal_cost != null ? `$${Number(r.internal_cost).toLocaleString()}` : '',
      amount_paid:           r.amount_paid != null ? `$${Number(r.amount_paid).toLocaleString()}` : '',
    }))
    return {
      sections: [{ title: 'Impound Inventory', columns: [
        { id: 'call_number',           label: 'Call #' },
        { id: 'date_of_impound',       label: 'Date' },
        { id: 'vehicle',               label: 'Vehicle' },
        { id: 'vin',                   label: 'VIN' },
        { id: 'location',              label: 'Location' },
        { id: 'status',                label: 'Status' },
        { id: 'reason_for_impound',    label: 'Reason' },
        { id: 'released',              label: 'Released' },
        { id: 'keys',                  label: 'Keys' },
        { id: 'drives',                label: 'Drives' },
        { id: 'sell',                  label: 'For Sale' },
        { id: 'estimated_value',       label: 'Est. Value' },
        { id: 'notes',                 label: 'Notes' },
        { id: 'sales_description',     label: 'Sales Description',      optional: true },
        { id: 'needs_detail',          label: 'Needs Detail',           optional: true },
        { id: 'needs_mechanic',        label: 'Needs Mechanic',         optional: true },
        { id: 'estimated_repair_cost', label: 'Est. Repair Cost',       optional: true },
        { id: 'internal_cost',         label: 'Internal Cost',          optional: true },
        { id: 'amount_paid',           label: 'Amount Paid',            optional: true },
      ], rows }],
      summaryLines: [`${rows.length} vehicles`],
    }
  }

  async function fetchImpoundDisposition(): Promise<ReportResult> {
    const dispLabel = (r: { sold: boolean; scrapped: boolean; released: boolean }) =>
      r.sold ? 'Sold' : r.scrapped ? 'Scrapped' : r.released ? 'Released' : ''
    const dispValue = (r: { sold: boolean; scrapped: boolean; estimated_value: number | null }) =>
      r.sold ? (r.estimated_value ?? 0) : r.scrapped ? SCRAP_VALUE : 0

    let q = supabase
      .from('impounds')
      .select('call_number, make_model, year, vin, location, sold, scrapped, released, disposition_date, estimated_value, amount_paid, internal_cost, notes')
      .gte('disposition_date', dateFrom)
      .lte('disposition_date', dateTo)
      .order('disposition_date', { ascending: false })
    if (location !== 'all') q = q.eq('location', location)
    if (dispType === 'sold')     q = q.eq('sold', true)
    else if (dispType === 'scrapped') q = q.eq('scrapped', true)
    else if (dispType === 'released') q = q.eq('released', true).eq('sold', false).eq('scrapped', false)
    else q = q.or('sold.eq.true,scrapped.eq.true,released.eq.true')

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const rows: Row[] = (data ?? []).map(r => {
      const val = dispValue(r as any)
      return {
        call_number:      r.call_number,
        vehicle:          r.make_model ?? '',
        year:             r.year ?? '',
        vin:              (r as any).vin ?? '',
        location:         r.location ?? '',
        disposition:      dispLabel(r as any),
        value:            val > 0 ? `$${val.toLocaleString()}` : '—',
        disposition_date: fmtDate(r.disposition_date),
        internal_cost:    (r as any).internal_cost != null ? `$${Number((r as any).internal_cost).toLocaleString()}` : '',
        notes:            (r as any).notes ?? '',
        _numValue:        val,
      }
    })
    const totalRevenue  = rows.reduce((s, r) => s + Number(r._numValue), 0)
    const soldCount     = rows.filter(r => r.disposition === 'Sold').length
    const scrappedCount = rows.filter(r => r.disposition === 'Scrapped').length
    const releasedCount = rows.filter(r => r.disposition === 'Released').length
    const exportRows    = rows.map(({ _numValue: _, ...rest }) => rest)

    return {
      sections: [{ title: 'Impound Disposition', columns: [
        { id: 'call_number',      label: 'Call #' },
        { id: 'vehicle',          label: 'Vehicle' },
        { id: 'year',             label: 'Year' },
        { id: 'location',         label: 'Location' },
        { id: 'disposition',      label: 'Disposition' },
        { id: 'value',            label: 'Value' },
        { id: 'disposition_date', label: 'Date' },
        { id: 'vin',              label: 'VIN',           optional: true },
        { id: 'internal_cost',    label: 'Internal Cost', optional: true },
        { id: 'notes',            label: 'Notes',         optional: true },
      ], rows: exportRows }],
      summaryLines: [
        `${rows.length} vehicles — Sold: ${soldCount}, Scrapped: ${scrappedCount}, Released: ${releasedCount}`,
        `Total Revenue: $${totalRevenue.toLocaleString()}`,
      ],
    }
  }

  async function fetchDispatch(): Promise<ReportResult> {
    let q = supabase
      .from('jobs')
      .select('tb_call_num, day, pickup_addr, drop_addr, tb_reason, tb_driver, truck_and_equipment, status, tb_account, tb_desc, tb_driver_2, priority, notes, tb_scheduled, has_tolls')
      .gte('day', dateFrom)
      .lte('day', dateTo)
      .order('day', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    if (jobType !== 'all')      q = q.eq('tb_reason', jobType)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const types = [...new Set((data ?? []).map(r => r.tb_reason).filter(Boolean))].sort() as string[]
    setKnownJobTypes(types)

    const rows: Row[] = (data ?? []).map(r => ({
      tb_call_num:          r.tb_call_num ?? '',
      day:                  fmtDate(r.day),
      pickup_addr:          r.pickup_addr ?? '',
      drop_addr:            r.drop_addr ?? '',
      tb_reason:            r.tb_reason ?? '',
      tb_driver:            r.tb_driver ?? '',
      truck_and_equipment:  r.truck_and_equipment ?? '',
      status:               r.status ?? '',
      tb_account:           r.tb_account ?? '',
      tb_desc:              (r as any).tb_desc ?? '',
      tb_driver_2:          (r as any).tb_driver_2 ?? '',
      priority:             (r as any).priority ?? '',
      notes:                (r as any).notes ?? '',
      tb_scheduled:         (r as any).tb_scheduled ? fmtDate((r as any).tb_scheduled) : '',
      has_tolls:            (r as any).has_tolls ? 'Yes' : '',
    }))
    return {
      sections: [{ title: 'Dispatch History', columns: [
        { id: 'tb_call_num',         label: 'Call #' },
        { id: 'day',                 label: 'Date' },
        { id: 'pickup_addr',         label: 'Pickup' },
        { id: 'drop_addr',           label: 'Drop' },
        { id: 'tb_reason',           label: 'Job Type' },
        { id: 'tb_driver',           label: 'Driver' },
        { id: 'truck_and_equipment', label: 'Truck' },
        { id: 'status',              label: 'Status' },
        { id: 'tb_account',          label: 'Account' },
        { id: 'tb_desc',             label: 'Description',    optional: true },
        { id: 'tb_driver_2',         label: 'Second Driver',  optional: true },
        { id: 'priority',            label: 'Priority',       optional: true },
        { id: 'notes',               label: 'Notes',          optional: true },
        { id: 'tb_scheduled',        label: 'Scheduled Time', optional: true },
        { id: 'has_tolls',           label: 'Has Tolls',      optional: true },
      ], rows }],
      summaryLines: [`${rows.length} jobs`],
    }
  }

  async function fetchMaintenance(): Promise<ReportResult> {
    // Query trucks with location join; filter category server-side, location client-side
    let truckQ = supabase
      .from('trucks')
      .select('id, unit_number, category, current_status, vin, waiting_on, maintenance(last_pm_date, next_pm_date, last_pm_mileage, next_pm_mileage), locations(id, name)')
      .eq('active', true)
    if (category !== 'all') truckQ = truckQ.eq('category', category)

    const { data: trucks, error: truckErr } = await truckQ
    if (truckErr) throw new Error(truckErr.message)

    const filtered = (trucks ?? []).filter(t => {
      if (location === 'all') return true
      return (t.locations as { name: string } | null)?.name === location
    })
    if (filtered.length === 0) {
      return { sections: [{ title: 'Maintenance History', columns: [], rows: [] }], summaryLines: ['No trucks found for the selected filters.'] }
    }

    const ids = filtered.map(t => t.id)
    const [{ data: history }, { data: notes }] = await Promise.all([
      supabase
        .from('status_history')
        .select('truck_id, new_status, created_at')
        .in('truck_id', ids)
        .gte('created_at', dateFrom + 'T00:00:00Z')
        .lte('created_at', dateTo + 'T23:59:59Z')
        .order('created_at'),
      supabase
        .from('truck_notes')
        .select('truck_id, body, created_at')
        .in('truck_id', ids)
        .eq('note_type', 'work_done')
        .gte('created_at', dateFrom + 'T00:00:00Z')
        .lte('created_at', dateTo + 'T23:59:59Z')
        .order('created_at', { ascending: false }),
    ])

    const histByTruck: Record<string, { new_status: string; created_at: string }[]> = {}
    for (const h of (history ?? [])) {
      ;(histByTruck[h.truck_id] ??= []).push(h)
    }
    const notesByTruck: Record<string, string[]> = {}
    for (const n of (notes ?? [])) {
      ;(notesByTruck[n.truck_id] ??= []).push(n.body)
    }

    const CAT_LABELS: Record<string, string> = {
      hd_tow: 'HD Tow', ld_tow: 'LD Tow', roadside: 'Roadside', transport: 'Transport',
    }
    const STATUS_LABELS: Record<string, string> = {
      ready: 'Ready', issues: 'Known Issues', oos: 'Out of Service',
    }

    const rows: Row[] = filtered.map(t => {
      const hist     = histByTruck[t.id] ?? []
      const oosDays  = calcOosDays(hist, dateFrom, dateTo)
      const oosEvts  = hist.filter(h => h.new_status === 'oos').length
      const workDone = (notesByTruck[t.id] ?? []).slice(0, 5).join(' | ')
      const maint    = (t as any).maintenance as { last_pm_date: string | null; next_pm_date: string | null; last_pm_mileage: number | null; next_pm_mileage: number | null } | null
      return {
        unit_number:      t.unit_number,
        category:         CAT_LABELS[t.category ?? ''] ?? (t.category ?? ''),
        location:         (t.locations as { name: string } | null)?.name ?? '',
        current_status:   STATUS_LABELS[t.current_status] ?? t.current_status,
        last_pm_date:     fmtDate(maint?.last_pm_date ?? null),
        next_pm_due:      fmtDate(maint?.next_pm_date ?? null),
        oos_days:         oosDays,
        oos_events:       oosEvts,
        work_notes:       workDone,
        vin:              (t as any).vin ?? '',
        waiting_on:       (t as any).waiting_on ?? '',
        last_pm_mileage:  maint?.last_pm_mileage != null ? `${Number(maint.last_pm_mileage).toLocaleString()} mi` : '',
        next_pm_mileage:  maint?.next_pm_mileage != null ? `${Number(maint.next_pm_mileage).toLocaleString()} mi` : '',
      }
    })
    const totalOos = rows.reduce((s, r) => s + Number(r.oos_days), 0)
    return {
      sections: [{ title: 'Maintenance History', columns: [
        { id: 'unit_number',     label: 'Unit #' },
        { id: 'category',        label: 'Category' },
        { id: 'location',        label: 'Location' },
        { id: 'current_status',  label: 'Status' },
        { id: 'last_pm_date',    label: 'Last PM' },
        { id: 'next_pm_due',     label: 'Next PM Due' },
        { id: 'oos_days',        label: 'OOS Days' },
        { id: 'oos_events',      label: 'OOS Events' },
        { id: 'work_notes',      label: 'Work Done Notes' },
        { id: 'vin',             label: 'VIN',              optional: true },
        { id: 'waiting_on',      label: 'Waiting On',       optional: true },
        { id: 'last_pm_mileage', label: 'Last PM Mileage',  optional: true },
        { id: 'next_pm_mileage', label: 'Next PM Mileage',  optional: true },
      ], rows }],
      summaryLines: [`${rows.length} trucks · ${totalOos} total OOS days in period`],
    }
  }

  async function fetchEquipment(): Promise<ReportResult> {
    let q = supabase
      .from('equipment_requests')
      .select('submitted_by, submitted_at, request_type, urgent, description, purpose, if_not_purchased, status, manager_notes, denial_reason, reviewed_by, reviewed_at')
      .gte('submitted_at', dateFrom + 'T00:00:00Z')
      .lte('submitted_at', dateTo + 'T23:59:59Z')
      .order('submitted_at', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const rows: Row[] = (data ?? []).map(r => ({
      submitted_by:     r.submitted_by,
      submitted_at:     fmtDate(r.submitted_at),
      request_type:     r.request_type === 'replacement' ? 'Replacement' : 'New',
      urgent:           r.urgent ? 'Yes' : '',
      description:      r.description ?? '',
      purpose:          r.purpose ?? '',
      status:           r.status,
      manager_notes:    r.manager_notes ?? '',
      if_not_purchased: (r as any).if_not_purchased ?? '',
      denial_reason:    r.denial_reason ?? '',
      reviewed_by:      r.reviewed_by ?? '',
      reviewed_at:      fmtDate(r.reviewed_at),
    }))
    return {
      sections: [{ title: 'Equipment Requests', columns: [
        { id: 'submitted_by',     label: 'Submitted By' },
        { id: 'submitted_at',     label: 'Date' },
        { id: 'request_type',     label: 'Type' },
        { id: 'urgent',           label: 'Urgent' },
        { id: 'description',      label: 'Description' },
        { id: 'purpose',          label: 'Purpose' },
        { id: 'status',           label: 'Status' },
        { id: 'manager_notes',    label: 'Manager Notes' },
        { id: 'if_not_purchased', label: 'Impact if Not Purchased', optional: true },
        { id: 'denial_reason',    label: 'Denial Reason',           optional: true },
        { id: 'reviewed_by',      label: 'Reviewed By',             optional: true },
        { id: 'reviewed_at',      label: 'Review Date',             optional: true },
      ], rows }],
      summaryLines: [`${rows.length} requests`],
    }
  }

  async function fetchSchedulerAnalytics(): Promise<ReportResult> {
    const today = new Date()
    const todayIso = schedToIsoDate(today)
    let from: string, days: number

    if (schedPreset === 'this-week') {
      const monday = schedStartOfWeek(today)
      from = schedToIsoDate(monday)
      days = Math.max(1, Math.round((today.getTime() - monday.getTime()) / 86_400_000) + 1)
    } else if (schedPreset === 'this-month') {
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      from = schedToIsoDate(first)
      days = Math.max(1, Math.round((today.getTime() - first.getTime()) / 86_400_000) + 1)
    } else if (schedPreset === 'custom') {
      from = schedFrom
      const sD = schedFromIsoDate(schedFrom); const eD = schedFromIsoDate(schedTo)
      days = Math.max(1, Math.round((eD.getTime() - sD.getTime()) / 86_400_000) + 1)
    } else {
      const n = Number(schedPreset)
      from = schedToIsoDate(schedAddDays(today, -n))
      days = n
    }
    const to = schedPreset === 'custom' ? schedTo : todayIso

    const [{ data: entData, error: entErr }, { data: drvData, error: drvErr }] = await Promise.all([
      supabase
        .from('scheduler_driver_schedule')
        .select('driver_id, schedule_date, entry_type, start_time, end_time, off_reason')
        .gte('schedule_date', from)
        .lte('schedule_date', to),
      supabase
        .from('drivers')
        .select('id, name, function, irh_yard_number')
        .eq('active', true),
    ])
    if (entErr) throw new Error(entErr.message)
    if (drvErr) throw new Error(drvErr.message)

    const entries = (entData ?? []) as SchedEntry[]
    const drivers = (drvData ?? []) as SchedDriver[]

    // Week-based cards need at least 4 weeks of history
    const extDays = Math.max(days, 28)
    let extEntries = entries
    if (extDays > days) {
      const extFrom = schedToIsoDate(schedAddDays(today, -extDays))
      const { data: extData, error: extErr } = await supabase
        .from('scheduler_driver_schedule')
        .select('driver_id, schedule_date, entry_type, start_time, end_time, off_reason')
        .gte('schedule_date', extFrom)
        .lte('schedule_date', todayIso)
      if (extErr) throw new Error(extErr.message)
      extEntries = (extData ?? []) as SchedEntry[]
    }

    const weeks = Math.max(4, Math.ceil(extDays / 7))
    const sections: Section[] = []

    if (schedCards.has('coverage-hour')) {
      const data = schedAggHoursByHourOfDay(entries, days)
      const hourLabels = Array.from({ length: 24 }, (_, h) => `${(h % 12) || 12}${h < 12 ? 'a' : 'p'}`)
      sections.push({
        title: 'Coverage by Hour',
        columns: [{ id: 'hour', label: 'Hour' }, { id: 'avg_drivers', label: 'Avg Drivers on Duty' }],
        rows: hourLabels.map((lbl, i) => ({ hour: lbl, avg_drivers: data[i] })),
      })
    }

    if (schedCards.has('coverage-day')) {
      const { labels, data } = schedAggHoursByDayOfWeek(entries)
      sections.push({
        title: 'Hours by Day of Week',
        columns: [{ id: 'day', label: 'Day' }, { id: 'hours', label: 'Total Hours' }],
        rows: labels.map((lbl, i) => ({ day: lbl, hours: data[i] })),
      })
    }

    if (schedCards.has('coverage-heatmap')) {
      const grid = schedAggHeatmap(entries)
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      const hourCols: Col[] = [
        { id: 'day', label: 'Day' },
        ...Array.from({ length: 24 }, (_, h) => ({ id: `h${h}`, label: `${(h % 12) || 12}${h < 12 ? 'a' : 'p'}` })),
      ]
      sections.push({
        title: 'Coverage Heatmap',
        columns: hourCols,
        rows: dayNames.map((day, dow) => ({
          day,
          ...Object.fromEntries(Array.from({ length: 24 }, (_, h) => [`h${h}`, grid[dow][h]])),
        })),
      })
    }

    if (schedCards.has('shift-length')) {
      const { labels, data } = schedAggShiftLengthDist(entries)
      sections.push({
        title: 'Shift Length Distribution',
        columns: [{ id: 'length', label: 'Shift Length' }, { id: 'count', label: 'Count' }],
        rows: labels.map((lbl, i) => ({ length: lbl, count: data[i] })),
      })
    }

    if (schedCards.has('top-drivers') || schedCards.has('bottom-drivers')) {
      const allDriverHours = schedAggHoursPerDriver(entries, drivers)
      if (schedCards.has('top-drivers')) {
        const top = [...allDriverHours].filter(x => x.hours > 0).sort((a, b) => b.hours - a.hours).slice(0, 10)
        sections.push({
          title: 'Top 10 Drivers by Hours',
          columns: [{ id: 'name', label: 'Driver' }, { id: 'fn', label: 'Function' }, { id: 'hours', label: 'Hours' }],
          rows: top.map(x => ({ name: x.name, fn: x.fn, hours: x.hours })),
        })
      }
      if (schedCards.has('bottom-drivers')) {
        const bottom = [...allDriverHours].sort((a, b) => a.hours - b.hours).slice(0, 10)
        sections.push({
          title: 'Bottom 10 Drivers by Hours',
          columns: [{ id: 'name', label: 'Driver' }, { id: 'fn', label: 'Function' }, { id: 'hours', label: 'Hours' }],
          rows: bottom.map(x => ({ name: x.name, fn: x.fn, hours: x.hours })),
        })
      }
    }

    if (schedCards.has('function-breakdown')) {
      const { labels, data } = schedAggFunctionBreakdown(entries, drivers)
      sections.push({
        title: 'Hours by Function',
        columns: [{ id: 'fn', label: 'Function' }, { id: 'hours', label: 'Hours' }],
        rows: labels.map((lbl, i) => ({ fn: lbl, hours: data[i] })),
      })
    }

    if (schedCards.has('week-over-week')) {
      const { labels, data } = schedAggWeeklyTotals(extEntries, weeks)
      sections.push({
        title: 'Week-over-Week Hours',
        columns: [{ id: 'week', label: 'Week of' }, { id: 'hours', label: 'Total Hours' }],
        rows: labels.map((lbl, i) => ({ week: lbl, hours: data[i] })),
      })
    }

    if (schedCards.has('off-reasons')) {
      const { labels, data } = schedAggOffReasons(entries)
      sections.push({
        title: 'Off-Day Reasons',
        columns: [{ id: 'reason', label: 'Reason' }, { id: 'count', label: 'Count' }],
        rows: labels.map((lbl, i) => ({ reason: lbl, count: data[i] })),
      })
    }

    if (schedCards.has('yard-utilization')) {
      const { labels, data } = schedAggYardUtilization(entries, drivers)
      sections.push({
        title: 'Yard Utilization',
        columns: [{ id: 'yard', label: 'Yard' }, { id: 'hours', label: 'Hours' }],
        rows: labels.map((lbl, i) => ({ yard: lbl, hours: data[i] })),
      })
    }

    if (schedCards.has('overnight-trend')) {
      const { labels, data } = schedAggOvernightByWeek(extEntries, weeks)
      sections.push({
        title: 'Overnight Shifts by Week',
        columns: [{ id: 'week', label: 'Week of' }, { id: 'count', label: 'Overnight Shifts' }],
        rows: labels.map((lbl, i) => ({ week: lbl, count: data[i] })),
      })
    }

    if (!sections.length) {
      return { sections: [{ title: 'Scheduler Analytics', columns: [], rows: [] }], summaryLines: ['No analytics selected.'] }
    }

    const totalShifts = entries.filter(e => e.entry_type === 'shift').length
    const totalHrs = +entries
      .filter(e => e.entry_type === 'shift')
      .reduce((s, e) => s + schedShiftDurationHours(e.start_time, e.end_time), 0)
      .toFixed(1)

    return {
      sections,
      summaryLines: [
        `${totalShifts} shifts · ${totalHrs}h total · ${sections.length} analytics card${sections.length !== 1 ? 's' : ''}`,
        sections.length > 1 ? `Excel export includes ${sections.length} sheets: ${sections.map(s => s.title).join(', ')}` : '',
      ].filter(Boolean),
    }
  }

  // ── Download ─────────────────────────────────────────────────────────────────

  function getSectionsForExport(): Section[] {
    if (!result) return []
    let sections = result.sections
    if (selected === 'scheduler-analytics' && schedExportFilter.size > 0) {
      sections = sections.filter(s => schedExportFilter.has(s.title))
    }
    return sections.map((sec, i) =>
      i === 0 ? { ...sec, columns: sec.columns.filter(c => !hiddenCols.has(c.id)) } : sec
    )
  }

  function handleCSV() {
    const sections = getSectionsForExport()
    if (!sections.length) return
    downloadCSV(`${selected}-${todayStr()}.csv`, sections)
  }

  async function handleXLSX() {
    const sections = getSectionsForExport()
    if (!sections.length) return
    await downloadXLSX(`${selected}-${todayStr()}.xlsx`, sections)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const selectedDef    = REPORTS.find(r => r.id === selected)!
  const primarySection = result?.sections[0]
  const visibleCols    = primarySection?.columns.filter(c => !hiddenCols.has(c.id)) ?? []

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'rgb(var(--surface))' }}>

      {/* ── Left rail ── */}
      <div style={{
        width: 220, flexShrink: 0,
        borderRight: '1px solid rgb(var(--outline))',
        padding: '1.5rem 0.75rem',
        display: 'flex', flexDirection: 'column', gap: '0.2rem',
      }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgb(var(--on-surface-muted))', padding: '0 0.5rem', marginBottom: '0.625rem' }}>
          Report Type
        </div>
        {REPORTS.map(r => (
          <button
            key={r.id}
            onClick={() => selectReport(r.id)}
            style={{
              textAlign: 'left', padding: '0.5rem 0.75rem', borderRadius: '0.5rem',
              border: 'none', cursor: 'pointer', fontSize: '0.8125rem',
              fontWeight: selected === r.id ? 700 : 400,
              background: selected === r.id ? 'rgb(var(--primary-container))' : 'transparent',
              color: selected === r.id ? 'rgb(var(--on-primary-container))' : 'rgb(var(--on-surface))',
              lineHeight: 1.35,
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ── Main panel ── */}
      <div style={{ flex: 1, padding: '1.5rem 1.75rem', overflow: 'auto', minWidth: 0 }}>

        {/* Header */}
        <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'rgb(var(--on-surface))' }}>
              {selectedDef.label}
            </h1>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'rgb(var(--on-surface-muted))' }}>
              {selectedDef.description}
            </p>
          </div>
          <Link
            href="/"
            style={{
              flexShrink: 0,
              display: 'inline-block',
              padding: '0.375rem 0.75rem',
              border: '1px solid rgb(var(--outline-variant))',
              borderRadius: '0.375rem',
              background: 'rgb(var(--surface-container))',
              color: 'rgb(var(--on-surface))',
              fontSize: '0.8125rem',
              textDecoration: 'none',
            }}
          >
            ← Back to portal
          </Link>
        </div>

        {/* Filter bar */}
        <div style={{
          background: 'rgb(var(--surface-container))',
          border: '1px solid rgb(var(--outline))',
          borderRadius: '0.75rem',
          padding: '1rem 1.25rem',
          marginBottom: '1.25rem',
          display: 'flex', flexWrap: 'wrap', gap: '0.875rem', alignItems: 'flex-end',
        }}>
          {/* Date range — standard reports */}
          {selected !== 'scheduler-analytics' && (
            <>
              <label style={labelSt}>
                From
                <input type="date" style={inputSt} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </label>
              <label style={labelSt}>
                To
                <input type="date" style={inputSt} value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </label>
            </>
          )}

          {/* Date range — scheduler analytics */}
          {selected === 'scheduler-analytics' && (
            <>
              <label style={labelSt}>
                Date Range
                <select style={inputSt} value={schedPreset} onChange={e => setSchedPreset(e.target.value)}>
                  <option value="this-week">This week</option>
                  <option value="7">Last 7 days</option>
                  <option value="14">Two weeks</option>
                  <option value="this-month">This month</option>
                  <option value="30">Last 30 days</option>
                  <option value="60">Last 60 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="custom">Custom range</option>
                </select>
              </label>
              {schedPreset === 'custom' && (
                <>
                  <label style={labelSt}>
                    From
                    <input type="date" style={inputSt} value={schedFrom} onChange={e => setSchedFrom(e.target.value)} />
                  </label>
                  <label style={labelSt}>
                    To
                    <input type="date" style={inputSt} value={schedTo} onChange={e => setSchedTo(e.target.value)} />
                  </label>
                </>
              )}
            </>
          )}

          {/* Yard — driver safety */}
          {selected === 'driver-safety' && (
            <label style={labelSt}>
              Yard
              <select style={inputSt} value={yard} onChange={e => setYard(e.target.value)}>
                <option value="all">All Yards</option>
                {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          )}
          {selected === 'driver-safety' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'rgb(var(--on-surface))', cursor: 'pointer', paddingBottom: '0.1rem' }}>
              <input type="checkbox" checked={eligibleOnly} onChange={e => setEligibleOnly(e.target.checked)} />
              Eligible only
            </label>
          )}

          {/* Compliance type */}
          {selected === 'compliance-incidents' && (
            <label style={labelSt}>
              Type
              <select style={inputSt} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All Types</option>
                {COMPLIANCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          )}

          {/* Impound status */}
          {selected === 'impound-inventory' && (
            <label style={labelSt}>
              Status
              <select style={inputSt} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All Statuses</option>
                {IMPOUND_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}

          {/* Location — impounds + maintenance */}
          {(selected === 'impound-inventory' || selected === 'impound-disposition' || selected === 'maintenance-history') && (
            <label style={labelSt}>
              Location
              <select style={inputSt} value={location} onChange={e => setLocation(e.target.value)}>
                <option value="all">All Locations</option>
                {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          )}

          {/* Disposition type */}
          {selected === 'impound-disposition' && (
            <label style={labelSt}>
              Disposition
              <select style={inputSt} value={dispType} onChange={e => setDispType(e.target.value)}>
                <option value="all">All Types</option>
                <option value="sold">Sold</option>
                <option value="scrapped">Scrapped</option>
                <option value="released">Released</option>
              </select>
            </label>
          )}

          {/* Dispatch status + job type */}
          {selected === 'dispatch-history' && (
            <label style={labelSt}>
              Status
              <select style={inputSt} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All Statuses</option>
                <option value="scheduled">Scheduled</option>
                <option value="active">Active</option>
                <option value="complete">Complete</option>
              </select>
            </label>
          )}
          {selected === 'dispatch-history' && (
            <label style={labelSt}>
              Job Type
              <select style={inputSt} value={jobType} onChange={e => setJobType(e.target.value)}>
                <option value="all">All Types</option>
                {knownJobTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}

          {/* Category — maintenance */}
          {selected === 'maintenance-history' && (
            <label style={labelSt}>
              Category
              <select style={inputSt} value={category} onChange={e => setCategory(e.target.value)}>
                <option value="all">All Categories</option>
                {TRUCK_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          )}

          {/* Equipment status */}
          {selected === 'equipment-requests' && (
            <label style={labelSt}>
              Status
              <select style={inputSt} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="denied">Denied</option>
              </select>
            </label>
          )}

          {/* Missed only — DVIR */}
          {selected === 'dvir-compliance' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'rgb(var(--on-surface))', cursor: 'pointer', paddingBottom: '0.1rem' }}>
              <input type="checkbox" checked={missedOnly} onChange={e => setMissedOnly(e.target.checked)} />
              Missed only
            </label>
          )}

          <button
            onClick={run}
            disabled={loading}
            style={{
              padding: '0.5rem 1.25rem',
              background: 'rgb(var(--primary))',
              color: 'rgb(var(--on-primary))',
              border: 'none', borderRadius: '0.5rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem', fontWeight: 700,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Loading…' : 'Run Report'}
          </button>
        </div>

        {/* Scheduler card selection */}
        {selected === 'scheduler-analytics' && (
          <div style={{
            background: 'rgb(var(--surface-container))',
            border: '1px solid rgb(var(--outline))',
            borderRadius: '0.75rem',
            padding: '1rem 1.25rem',
            marginBottom: '1.25rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgb(var(--on-surface-muted))' }}>
                Analytics to export
              </span>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  onClick={() => setSchedCards(new Set(SCHED_CARD_DEFS.map(c => c.id)))}
                  style={{ fontSize: '0.72rem', color: 'rgb(var(--primary))', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                >
                  Select all
                </button>
                <button
                  onClick={() => setSchedCards(new Set())}
                  style={{ fontSize: '0.72rem', color: 'rgb(var(--on-surface-muted))', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                >
                  Clear
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.375rem' }}>
              {SCHED_CARD_DEFS.map(card => (
                <label key={card.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: 'rgb(var(--on-surface))', cursor: 'pointer', userSelect: 'none' as const }}>
                  <input
                    type="checkbox"
                    checked={schedCards.has(card.id)}
                    onChange={() => setSchedCards(prev => {
                      const next = new Set(prev)
                      if (next.has(card.id)) next.delete(card.id); else next.add(card.id)
                      return next
                    })}
                    style={{ cursor: 'pointer' }}
                  />
                  {card.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '0.75rem 1rem', background: 'rgb(var(--error) / 0.1)', border: '1px solid rgb(var(--error) / 0.3)', borderRadius: '0.5rem', color: 'rgb(var(--error))', fontSize: '0.875rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {/* Results */}
        {result && primarySection && (
          <>
            {/* Summary + download bar */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.75rem', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                {result.summaryLines?.map((line, i) => (
                  <div key={i} style={{ fontSize: '0.875rem', color: i === 0 ? 'rgb(var(--on-surface))' : 'rgb(var(--on-surface-muted))', fontWeight: i === 0 ? 600 : 400 }}>
                    {line}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, alignItems: 'center' }}>
                {/* Column picker — hidden for scheduler analytics */}
                <div style={{ position: 'relative', display: selected === 'scheduler-analytics' ? 'none' : undefined }}>
                  <button
                    onClick={() => setShowColPicker(v => !v)}
                    style={{
                      padding: '0.4rem 0.875rem',
                      background: showColPicker ? 'rgb(var(--primary-container))' : 'rgb(var(--surface-container))',
                      border: '1px solid rgb(var(--outline))',
                      borderRadius: '0.5rem', cursor: 'pointer',
                      fontSize: '0.8125rem', fontWeight: 600,
                      color: showColPicker ? 'rgb(var(--on-primary-container))' : 'rgb(var(--on-surface))',
                    }}
                  >
                    Columns{hiddenCols.size > 0 ? ` (${visibleCols.length}/${primarySection!.columns.length})` : ''}
                  </button>
                  {showColPicker && (
                    <div style={{
                      position: 'absolute', right: 0, top: 'calc(100% + 0.25rem)',
                      background: 'rgb(var(--surface-container))',
                      border: '1px solid rgb(var(--outline))',
                      borderRadius: '0.75rem',
                      padding: '0.875rem',
                      zIndex: 50,
                      minWidth: 200,
                      boxShadow: '0 4px 20px rgb(0 0 0 / 0.25)',
                      display: 'flex', flexDirection: 'column', gap: '0.375rem',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgb(var(--on-surface-muted))' }}>
                          Columns
                        </span>
                        <button
                          onClick={() => setHiddenCols(new Set())}
                          style={{ fontSize: '0.72rem', color: 'rgb(var(--primary))', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                        >
                          Show all
                        </button>
                      </div>
                      {primarySection!.columns.filter(c => !c.optional).map(col => (
                        <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: 'rgb(var(--on-surface))', cursor: 'pointer', userSelect: 'none' as const }}>
                          <input type="checkbox" checked={!hiddenCols.has(col.id)} onChange={() => toggleCol(col.id)} style={{ cursor: 'pointer' }} />
                          {col.label}
                        </label>
                      ))}
                      {primarySection!.columns.some(c => c.optional) && (
                        <>
                          <div style={{ margin: '0.5rem 0 0.375rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgb(var(--on-surface-muted))', borderTop: '1px solid rgb(var(--outline))', paddingTop: '0.5rem' }}>
                            Additional
                          </div>
                          {primarySection!.columns.filter(c => c.optional).map(col => (
                            <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: 'rgb(var(--on-surface))', cursor: 'pointer', userSelect: 'none' as const }}>
                              <input type="checkbox" checked={!hiddenCols.has(col.id)} onChange={() => toggleCol(col.id)} style={{ cursor: 'pointer' }} />
                              {col.label}
                            </label>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleCSV}
                  style={{ padding: '0.4rem 0.875rem', background: 'rgb(var(--surface-container))', border: '1px solid rgb(var(--outline))', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, color: 'rgb(var(--on-surface))' }}
                >
                  ↓ CSV
                </button>
                <button
                  onClick={handleXLSX}
                  style={{ padding: '0.4rem 0.875rem', background: 'rgb(var(--primary))', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, color: 'rgb(var(--on-primary))' }}
                >
                  ↓ Excel
                </button>
              </div>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto', border: '1px solid rgb(var(--outline))', borderRadius: '0.75rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: 'rgb(var(--surface-container))' }}>
                    {visibleCols.map(col => (
                      <th key={col.id} style={{
                        padding: '0.625rem 0.875rem',
                        textAlign: 'left',
                        fontSize: '0.68rem', fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.07em',
                        color: 'rgb(var(--on-surface-muted))',
                        whiteSpace: 'nowrap',
                        borderBottom: '1px solid rgb(var(--outline))',
                        position: 'sticky', top: 0,
                        background: 'rgb(var(--surface-container))',
                      }}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {primarySection.rows.length === 0 ? (
                    <tr>
                      <td colSpan={visibleCols.length} style={{ padding: '2.5rem', textAlign: 'center', color: 'rgb(var(--on-surface-muted))', fontStyle: 'italic' }}>
                        No results for the selected filters.
                      </td>
                    </tr>
                  ) : primarySection.rows.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgb(var(--outline-variant))' }}>
                      {visibleCols.map(col => (
                        <td key={col.id} style={{ padding: '0.5rem 0.875rem', color: 'rgb(var(--on-surface))', whiteSpace: 'nowrap', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {String(row[col.id] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Scheduler analytics: per-section export selection */}
            {selected === 'scheduler-analytics' && result.sections.length > 0 && (
              <div style={{
                marginTop: '1rem',
                background: 'rgb(var(--surface-container))',
                border: '1px solid rgb(var(--outline))',
                borderRadius: '0.75rem',
                padding: '0.875rem 1.125rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgb(var(--on-surface-muted))' }}>
                    Include in export ({schedExportFilter.size} of {result.sections.length} selected)
                  </span>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button
                      onClick={() => setSchedExportFilter(new Set(result.sections.map(s => s.title)))}
                      style={{ fontSize: '0.72rem', color: 'rgb(var(--primary))', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setSchedExportFilter(new Set())}
                      style={{ fontSize: '0.72rem', color: 'rgb(var(--on-surface-muted))', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                    >
                      None
                    </button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '0.375rem' }}>
                  {result.sections.map(sec => (
                    <label key={sec.title} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: 'rgb(var(--on-surface))', cursor: 'pointer', userSelect: 'none' as const }}>
                      <input
                        type="checkbox"
                        checked={schedExportFilter.has(sec.title)}
                        onChange={() => setSchedExportFilter(prev => {
                          const next = new Set(prev)
                          if (next.has(sec.title)) next.delete(sec.title); else next.add(sec.title)
                          return next
                        })}
                        style={{ cursor: 'pointer' }}
                      />
                      <span>{sec.title}</span>
                      <span style={{ fontSize: '0.72rem', color: 'rgb(var(--on-surface-muted))' }}>({sec.rows.length})</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {primarySection.rows.length > 0 && result.sections.length > 1 && selected !== 'scheduler-analytics' && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))' }}>
                Showing {primarySection.title} · Excel download includes all {result.sections.length} sheets
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
