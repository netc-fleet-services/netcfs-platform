'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  Chart,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  DoughnutController, ArcElement,
  CategoryScale, LinearScale,
  Title, Tooltip, Legend, Filler,
  type ChartConfiguration,
} from 'chart.js'
import { APP_CONFIG } from '../lib/config'
import type { Driver, ScheduleEntry } from '../lib/types'
import { listDrivers, listScheduleBetween } from '../lib/db'
import { addDays, formatHours, formatTime12, fromIsoDate, shiftDurationHours, startOfWeek, toIsoDate } from '../lib/utils'
import { DriverDetailModal } from './DriverDetailModal'

Chart.register(
  BarController, BarElement,
  LineController, LineElement, PointElement,
  DoughnutController, ArcElement,
  CategoryScale, LinearScale,
  Title, Tooltip, Legend, Filler,
)

const CHART_COLORS = {
  accent: '#3b82f6',
  accent2: '#8b5cf6',
  warn: '#f59e0b',
  err: '#ef4444',
  ok: '#10b981',
  palette: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'],
  gridDark: 'rgba(255,255,255,0.08)',
  textDim: '#9ca3af',
}

type Scope = 'all' | 'drivers' | 'dispatchers'

interface CardRange {
  startIso: string
  endIso: string
  days: number
  label: string
}

interface Props {
  supabase: SupabaseClient
}

const CARD_DEFS: Array<{ id: string; label: string; blurb: string; interactive?: boolean }> = [
  { id: 'coverage-hour',     label: 'Coverage by hour-of-day',         blurb: 'Avg drivers on duty each hour across the range' },
  { id: 'coverage-day',      label: 'Hours by day-of-week',            blurb: 'Total scheduled hours by Mon–Sun' },
  { id: 'coverage-heatmap',  label: 'Coverage heatmap',                blurb: 'Day-of-week × hour. Brighter = more drivers covering.' },
  { id: 'shift-length',      label: 'Shift-length distribution',       blurb: 'How long are shifts in this range' },
  { id: 'top-drivers',       label: 'Top 10 drivers by hours',         blurb: 'Most scheduled in this range' },
  { id: 'bottom-drivers',    label: 'Bottom 10 drivers by hours',      blurb: 'Least scheduled — possible underuse' },
  { id: 'driver-detail',     label: 'Driver detail',                   blurb: 'Click any driver for past 7 + upcoming 7', interactive: false },
  { id: 'function-breakdown',label: 'Hours by function',               blurb: 'HDT / LDT / Transport / Road Service / Dispatch' },
  { id: 'week-over-week',    label: 'Week-over-week total hours',      blurb: 'Last 4 weeks of scheduled hours' },
  { id: 'off-reasons',       label: 'Off-day reasons',                 blurb: 'Why people are off' },
  { id: 'yard-utilization',  label: 'Yard utilization',                blurb: 'Hours scheduled per yard' },
  { id: 'overnight-trend',   label: 'Overnight shifts (4-week trend)', blurb: 'Count of overnight shifts per week' },
]

const CATEGORIES = [
  { title: 'Coverage & Scheduling', cards: ['coverage-hour', 'coverage-day', 'coverage-heatmap', 'shift-length'] },
  { title: 'People & Workload',     cards: ['top-drivers', 'bottom-drivers', 'driver-detail', 'function-breakdown'] },
  { title: 'Trends & Operations',   cards: ['week-over-week', 'off-reasons', 'yard-utilization', 'overnight-trend'] },
]

function globalRangeLabel(days: number): string {
  const presets: Record<number, string> = { 7: 'Last 7 days', 14: 'Last 14 days', 30: 'Last 30 days', 60: 'Last 60 days', 90: 'Last 90 days' }
  return presets[days] || `Last ${days} days`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function StatsView({ supabase }: Props) {
  const [rangeDays, setRangeDays] = useState(30)
  const [scope, setScope] = useState<Scope>('all')
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [entries, setEntries] = useState<ScheduleEntry[]>([])
  const [extEntries, setExtEntries] = useState<ScheduleEntry[]>([])
  const [cardOverrides, setCardOverrides] = useState<Record<string, CardRange>>({})
  const [cardEntries, setCardEntries] = useState<Record<string, ScheduleEntry[]>>({})
  const [loading, setLoading] = useState(true)
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null)
  const [driverDetail, setDriverDetail] = useState<Driver | null>(null)
  const [rangePop, setRangePop] = useState<{ cardId: string; top: number; left: number } | null>(null)

  const chartRefs = useRef(new Map<string, Chart>())
  const modalChartRef = useRef<Chart | null>(null)
  const canvasRefs = useRef(new Map<string, HTMLCanvasElement | null>())
  const modalCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayRefs = useRef(new Map<string, HTMLDivElement | null>())

  // ---- Data fetch -------------------------------------------------------

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const todayIso = toIsoDate(new Date())
      const startIso = toIsoDate(addDays(new Date(), -rangeDays))

      const tab = APP_CONFIG.tabs.find(t => t.id === (scope === 'all' ? 'drivers' : scope === 'dispatchers' ? 'dispatchers' : 'drivers'))
      const scopeFunctions: string[] | null = (() => {
        if (scope === 'drivers') return tab?.functions ?? null
        if (scope === 'dispatchers') return APP_CONFIG.tabs.find(t => t.id === 'dispatchers')?.functions ?? null
        return null
      })()

      const ds = await listDrivers(supabase, {
        includeInactive: false,
        company: APP_CONFIG.defaultCompany ?? null,
        functions: scopeFunctions,
      })
      const inScope = new Set(ds.map(d => d.id))

      const mainEntries = (await listScheduleBetween(supabase, startIso, todayIso))
        .filter(e => inScope.has(e.driver_id))

      const extDays = Math.max(rangeDays, 28)
      const extStartIso = toIsoDate(addDays(new Date(), -extDays))
      const ext = (await listScheduleBetween(supabase, extStartIso, todayIso))
        .filter(e => inScope.has(e.driver_id))

      setDrivers(ds)
      setEntries(mainEntries)
      setExtEntries(ext)

      // Reload entries for cards with active overrides
      const overrideIds = Object.keys(cardOverrides)
      if (overrideIds.length) {
        const newCardEntries: Record<string, ScheduleEntry[]> = {}
        await Promise.all(overrideIds.map(async id => {
          const r = cardOverrides[id]
          const data = (await listScheduleBetween(supabase, r.startIso, r.endIso))
            .filter(e => inScope.has(e.driver_id))
          newCardEntries[id] = data
        }))
        setCardEntries(newCardEntries)
      } else {
        setCardEntries({})
      }
    } catch (err) {
      console.error('Stats refresh failed:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase, scope, rangeDays, cardOverrides])

  useEffect(() => { void refresh() }, [refresh])

  // Cleanup all chart instances on unmount
  useEffect(() => {
    const charts = chartRefs.current
    return () => {
      for (const c of charts.values()) c.destroy()
      charts.clear()
      if (modalChartRef.current) { modalChartRef.current.destroy(); modalChartRef.current = null }
    }
  }, [])

  // ---- Helpers ---------------------------------------------------------

  const getCardRange = useCallback((cardId: string): CardRange => {
    if (cardOverrides[cardId]) return cardOverrides[cardId]
    const today = new Date()
    const start = addDays(today, -rangeDays)
    return {
      startIso: toIsoDate(start),
      endIso: toIsoDate(today),
      days: rangeDays,
      label: globalRangeLabel(rangeDays),
    }
  }, [cardOverrides, rangeDays])

  const getEntriesForCard = useCallback((cardId: string): ScheduleEntry[] => {
    if (cardOverrides[cardId]) return cardEntries[cardId] || []
    return entries
  }, [cardOverrides, cardEntries, entries])

  const getExtEntriesForCard = useCallback((cardId: string): ScheduleEntry[] => {
    if (cardOverrides[cardId]) return cardEntries[cardId] || []
    return extEntries
  }, [cardOverrides, cardEntries, extEntries])

  // ---- Render charts whenever inputs change ---------------------------

  useEffect(() => {
    if (loading) return
    for (const def of CARD_DEFS) {
      try { renderCard(def.id, false) } catch (err) { console.error('Card render failed:', def.id, err) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, drivers, entries, extEntries, cardOverrides, cardEntries])

  // When the modal opens, render its expanded chart
  useEffect(() => {
    if (!expandedCardId) {
      if (modalChartRef.current) { modalChartRef.current.destroy(); modalChartRef.current = null }
      return
    }
    const id = setTimeout(() => {
      try { renderCard(expandedCardId, true) } catch (err) { console.error(err) }
    }, 0)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedCardId])

  // Close popover on outside click
  useEffect(() => {
    if (!rangePop) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('#stat-range-pop') || target.closest('[data-range-chip]')) return
      setRangePop(null)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [rangePop])

  // ---- Render one card -------------------------------------------------

  function renderCard(id: string, expanded: boolean) {
    const def = CARD_DEFS.find(c => c.id === id)
    if (!def) return
    const canvas = expanded ? modalCanvasRef.current : canvasRefs.current.get(id)
    if (!canvas) return
    const range = getCardRange(id)
    const cardEnts = getEntriesForCard(id)
    const cardExt = getExtEntriesForCard(id)

    if (id === 'driver-detail') {
      renderDriverDetailPicker(id, cardEnts)
      return
    }
    if (id === 'coverage-heatmap') {
      renderHeatmap(canvas, cardEnts, expanded, overlayRefs.current.get(id) || null)
      return
    }

    const config = buildChartConfig(id, range, cardEnts, cardExt, expanded)
    if (!config) return
    instantiate(canvas, expanded, config)
  }

  function instantiate(canvas: HTMLCanvasElement, expanded: boolean, config: ChartConfiguration) {
    const existing = expanded ? modalChartRef.current : chartRefs.current.get(canvas.id)
    const existingType = (existing?.config as ChartConfiguration | undefined)?.type
    if (existing && existing.canvas === canvas && existingType === config.type) {
      existing.data = config.data
      existing.options = config.options ?? {}
      existing.update()
      return existing
    }
    if (existing) existing.destroy()
    const chart = new Chart(canvas, config)
    if (expanded) modalChartRef.current = chart
    else chartRefs.current.set(canvas.id, chart)
    return chart
  }

  function buildChartConfig(id: string, range: CardRange, ents: ScheduleEntry[], ext: ScheduleEntry[], expanded: boolean): ChartConfiguration | null {
    switch (id) {
      case 'coverage-hour': {
        const data = aggHoursByHourOfDay(ents, range.days)
        const labels = Array.from({ length: 24 }, (_, h) => `${(h % 12) || 12}${h < 12 ? 'a' : 'p'}`)
        return {
          type: 'line',
          data: { labels, datasets: [{
            label: 'Avg drivers on duty', data,
            borderColor: CHART_COLORS.accent,
            backgroundColor: 'rgba(59,130,246,0.15)',
            fill: true, tension: 0.3, pointRadius: expanded ? 3 : 0,
          }] },
          options: commonChartOpts(expanded, { showLegend: expanded }),
        }
      }
      case 'coverage-day': {
        const { labels, data } = aggHoursByDayOfWeek(ents)
        return {
          type: 'bar',
          data: { labels, datasets: [{ label: 'Hours', data, backgroundColor: CHART_COLORS.accent2, borderRadius: 4 }] },
          options: commonChartOpts(expanded, { showLegend: false }),
        }
      }
      case 'shift-length': {
        const { labels, data } = aggShiftLengthDist(ents)
        return {
          type: 'bar',
          data: { labels, datasets: [{ label: 'Shifts', data, backgroundColor: CHART_COLORS.ok, borderRadius: 4 }] },
          options: commonChartOpts(expanded, { showLegend: false }),
        }
      }
      case 'top-drivers': {
        const top = aggHoursPerDriver(ents, drivers).filter(x => x.hours > 0).sort((a, b) => b.hours - a.hours).slice(0, 10)
        return {
          type: 'bar',
          data: { labels: top.map(x => x.name), datasets: [{ label: 'Hours', data: top.map(x => x.hours), backgroundColor: CHART_COLORS.accent, borderRadius: 4 }] },
          options: { ...commonChartOpts(expanded, { showLegend: false }), indexAxis: 'y' as const },
        }
      }
      case 'bottom-drivers': {
        const bottom = aggHoursPerDriver(ents, drivers).sort((a, b) => a.hours - b.hours).slice(0, 10)
        return {
          type: 'bar',
          data: { labels: bottom.map(x => x.name), datasets: [{ label: 'Hours', data: bottom.map(x => x.hours), backgroundColor: CHART_COLORS.warn, borderRadius: 4 }] },
          options: { ...commonChartOpts(expanded, { showLegend: false }), indexAxis: 'y' as const },
        }
      }
      case 'function-breakdown': {
        const { labels, data } = aggFunctionBreakdown(ents, drivers)
        return {
          type: 'doughnut',
          data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS.palette }] },
          options: { ...commonChartOpts(expanded, { showLegend: true, scales: {} }), cutout: '55%' } as ChartConfiguration<'doughnut'>['options'],
        }
      }
      case 'week-over-week': {
        const weeks = cardOverrides[id] ? Math.max(2, Math.ceil(range.days / 7)) : 4
        const { labels, data } = aggWeeklyTotals(ext, weeks)
        return {
          type: 'line',
          data: { labels, datasets: [{ label: 'Hours', data, borderColor: CHART_COLORS.ok, backgroundColor: 'rgba(16,185,129,0.15)', fill: true, tension: 0.3 }] },
          options: commonChartOpts(expanded, { showLegend: false }),
        }
      }
      case 'off-reasons': {
        const { labels, data } = aggOffReasons(ents)
        return {
          type: 'doughnut',
          data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS.palette }] },
          options: { ...commonChartOpts(expanded, { showLegend: true, scales: {} }), cutout: '55%' } as ChartConfiguration<'doughnut'>['options'],
        }
      }
      case 'yard-utilization': {
        const { labels, data } = aggYardUtilization(ents, drivers)
        return {
          type: 'bar',
          data: { labels, datasets: [{ label: 'Hours', data, backgroundColor: CHART_COLORS.accent, borderRadius: 4 }] },
          options: commonChartOpts(expanded, { showLegend: false }),
        }
      }
      case 'overnight-trend': {
        const weeks = cardOverrides[id] ? Math.max(2, Math.ceil(range.days / 7)) : 4
        const { labels, data } = aggOvernightByWeek(ext, weeks)
        return {
          type: 'bar',
          data: { labels, datasets: [{ label: 'Overnight shifts', data, backgroundColor: CHART_COLORS.warn, borderRadius: 4 }] },
          options: commonChartOpts(expanded, { showLegend: false }),
        }
      }
      default:
        return null
    }
  }

  function renderHeatmap(canvas: HTMLCanvasElement, ents: ScheduleEntry[], expanded: boolean, overlayEl: HTMLDivElement | null) {
    const parent = canvas.parentElement
    const w = parent ? parent.clientWidth : 300
    const h = parent ? parent.clientHeight : 200
    if (w === 0 || h === 0) {
      requestAnimationFrame(() => renderHeatmap(canvas, ents, expanded, overlayEl))
      return
    }
    const dpr = window.devicePixelRatio || 1
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const grid = aggHeatmap(ents)
    const days = 7, hours = 24
    const padL = expanded ? 32 : 26, padT = expanded ? 18 : 14
    const cw = (w - padL) / hours
    const ch = (h - padT) / days

    let max = 0
    for (const row of grid) for (const v of row) max = Math.max(max, v)
    max = Math.max(max, 1)

    for (let dow = 0; dow < days; dow++) {
      for (let hr = 0; hr < hours; hr++) {
        const v = grid[dow][hr] / max
        const alpha = 0.05 + v * 0.85
        ctx.fillStyle = `rgba(59,130,246,${alpha})`
        ctx.fillRect(padL + hr * cw + 1, padT + dow * ch + 1, cw - 2, ch - 2)
      }
    }
    ctx.fillStyle = CHART_COLORS.textDim
    ctx.font = `${expanded ? 11 : 9}px sans-serif`
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    for (let i = 0; i < 7; i++) ctx.fillText(dayLabels[i], 2, padT + i * ch + ch / 2 + 3)
    for (let i = 0; i < 24; i += (expanded ? 2 : 4)) {
      const lab = `${(i % 12) || 12}${i < 12 ? 'a' : 'p'}`
      ctx.fillText(lab, padL + i * cw, padT - 4)
    }
    if (overlayEl) overlayEl.textContent = ''
  }

  function renderDriverDetailPicker(id: string, ents: ScheduleEntry[]) {
    const canvas = canvasRefs.current.get(id)
    if (canvas) canvas.style.display = 'none'
    const overlayEl = overlayRefs.current.get(id)
    if (!overlayEl) return
    const all = aggHoursPerDriver(ents, drivers).sort((a, b) => b.hours - a.hours)
    overlayEl.innerHTML = `
      <input type="search" class="driver-detail__search" placeholder="Search by name or #" />
      <ul class="driver-detail__pick">
        ${all.map(d => `
          <li class="driver-detail__pick-item" data-driver-id="${d.id}">
            <div class="driver-detail__pick-main">
              <span class="driver-detail__pick-name">${escapeHtml(d.name)}</span>
              <span class="muted driver-detail__pick-meta">#${escapeHtml(String(d.driver?.irh_driver_number || d.id))} · ${escapeHtml(d.driver?.function || '—')}</span>
            </div>
            <span class="driver-detail__pick-hrs">${escapeHtml(formatHours(d.hours))}</span>
          </li>
        `).join('')}
      </ul>
    `
    const searchInp = overlayEl.querySelector<HTMLInputElement>('.driver-detail__search')
    searchInp?.addEventListener('click', e => e.stopPropagation())
    searchInp?.addEventListener('input', ev => {
      const q = (ev.target as HTMLInputElement).value.trim().toLowerCase()
      overlayEl.querySelectorAll<HTMLLIElement>('.driver-detail__pick-item').forEach(li => {
        li.hidden = !li.textContent?.toLowerCase().includes(q)
      })
    })
    overlayEl.querySelectorAll<HTMLLIElement>('.driver-detail__pick-item').forEach(li => {
      li.addEventListener('click', ev => {
        ev.stopPropagation()
        const id = Number(li.dataset.driverId)
        const drv = drivers.find(x => x.id === id)
        if (drv) setDriverDetail(drv)
      })
    })
  }

  // ---- Range chip / popover -------------------------------------------

  function openRangePopover(cardId: string, e: React.MouseEvent) {
    e.stopPropagation()
    const chip = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setRangePop({
      cardId,
      top: chip.bottom + window.scrollY + 6,
      left: Math.min(chip.left + window.scrollX, window.scrollX + window.innerWidth - 260),
    })
  }

  async function applyRangePreset(preset: string) {
    if (!rangePop) return
    const id = rangePop.cardId
    const today = new Date()
    let startIso: string, endIso: string, days: number, label: string
    if (preset === 'this-week') {
      const monday = startOfWeek(today)
      startIso = toIsoDate(monday)
      endIso = toIsoDate(today)
      days = Math.max(1, Math.round((today.getTime() - monday.getTime()) / 86_400_000) + 1)
      label = 'This week'
    } else if (preset === 'this-month') {
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      startIso = toIsoDate(first)
      endIso = toIsoDate(today)
      days = Math.max(1, Math.round((today.getTime() - first.getTime()) / 86_400_000) + 1)
      label = 'This month'
    } else {
      const n = Number(preset)
      startIso = toIsoDate(addDays(today, -n))
      endIso = toIsoDate(today)
      days = n
      label = preset === '14' ? 'Two weeks' : globalRangeLabel(n)
    }
    setRangePop(null)
    await applyOverride(id, { startIso, endIso, days, label })
  }

  async function applyCustomRange(fromV: string, toV: string) {
    if (!rangePop) return
    const id = rangePop.cardId
    if (!fromV || !toV) return
    if (fromV > toV) { alert('Start date must be on or before end date.'); return }
    const sD = fromIsoDate(fromV), eD = fromIsoDate(toV)
    const days = Math.max(1, Math.round((eD.getTime() - sD.getTime()) / 86_400_000) + 1)
    const label = (fromV === toV)
      ? fromIsoDate(fromV).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : `${fromIsoDate(fromV).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${fromIsoDate(toV).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    setRangePop(null)
    await applyOverride(id, { startIso: fromV, endIso: toV, days, label })
  }

  async function applyOverride(cardId: string, range: CardRange) {
    setCardOverrides(prev => ({ ...prev, [cardId]: range }))
    try {
      const tab = APP_CONFIG.tabs.find(t => t.id === scope)
      const scopeFunctions: string[] | null = (() => {
        if (scope === 'drivers') return tab?.functions ?? null
        if (scope === 'dispatchers') return APP_CONFIG.tabs.find(t => t.id === 'dispatchers')?.functions ?? null
        return null
      })()
      const ds = await listDrivers(supabase, {
        includeInactive: false,
        company: APP_CONFIG.defaultCompany ?? null,
        functions: scopeFunctions,
      })
      const inScope = new Set(ds.map(d => d.id))
      const data = (await listScheduleBetween(supabase, range.startIso, range.endIso))
        .filter(e => inScope.has(e.driver_id))
      setCardEntries(prev => ({ ...prev, [cardId]: data }))
    } catch (err) {
      console.error('card override failed:', err)
    }
  }

  function resetRange() {
    if (!rangePop) return
    const id = rangePop.cardId
    setCardOverrides(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setCardEntries(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setRangePop(null)
  }

  // ---- Summary --------------------------------------------------------

  const summary = useMemo(() => {
    const shifts = entries.filter(e => e.entry_type === 'shift')
    const hours = shifts.reduce((sum, e) => sum + shiftDurationHours(e.start_time, e.end_time), 0)
    return `${drivers.length} ${scope === 'all' ? 'people' : scope} · ${shifts.length} shifts · ${formatHours(hours)}`
  }, [drivers.length, scope, entries])

  return (
    <section className="stats">
      <div className="stats__toolbar">
        <label className="stats__field">
          <span>Range</span>
          <select value={rangeDays} onChange={e => setRangeDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <label className="stats__field">
          <span>Scope</span>
          <select value={scope} onChange={e => setScope(e.target.value as Scope)}>
            <option value="all">All</option>
            <option value="drivers">Drivers only</option>
            <option value="dispatchers">Dispatchers only</option>
          </select>
        </label>
        <span className="muted">{summary}</span>
      </div>

      <div className={`stats__sections ${loading ? 'stats-sections--loading' : ''}`}>
        {CATEGORIES.map((cat, idx) => (
          <section key={cat.title} className="stats-category">
            <header className="stats-category__head">
              <span className="stats-category__num">{idx + 1}</span>
              <h2 className="stats-category__title">{cat.title}</h2>
              <span className="stats-category__count muted">{cat.cards.length} charts</span>
            </header>
            <div className="stats-grid">
              {cat.cards.map(id => {
                const def = CARD_DEFS.find(c => c.id === id)
                if (!def) return null
                const interactive = def.interactive !== false
                const r = cardOverrides[id]
                  ? cardOverrides[id]
                  : { label: globalRangeLabel(rangeDays) } as CardRange
                return (
                  <button
                    key={id}
                    type="button"
                    className={`stat-card ${interactive ? 'stat-card--interactive' : 'stat-card--picker'}`}
                    onClick={() => { if (interactive) setExpandedCardId(id) }}
                    aria-label={interactive ? `Expand ${def.label}` : undefined}
                  >
                    <header className="stat-card__head">
                      <h3>{def.label}</h3>
                      <span
                        className={`stat-card__range-chip ${cardOverrides[id] ? 'stat-card__range-chip--override' : ''}`}
                        data-range-chip
                        data-card={id}
                        role="button"
                        tabIndex={0}
                        title="Change date range for this card"
                        onClick={e => openRangePopover(id, e)}
                      >
                        <span className="stat-card__range-label">{r.label}</span>
                        <span className="stat-card__range-caret" aria-hidden>▾</span>
                      </span>
                      {interactive && <span className="stat-card__expand" aria-hidden>+</span>}
                    </header>
                    <div className="stat-card__body">
                      <canvas
                        id={`canvas-${id}`}
                        ref={el => { canvasRefs.current.set(id, el) }}
                      />
                      <div
                        className="stat-card__overlay"
                        ref={el => { overlayRefs.current.set(id, el) }}
                      />
                    </div>
                    {def.blurb && <p className="stat-card__blurb muted">{def.blurb}</p>}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {expandedCardId && (
        <div className="modal modal--wide" role="dialog" aria-modal="true">
          <div className="modal__backdrop" onClick={() => setExpandedCardId(null)} />
          <div className="modal__panel modal__panel--wide">
            <header className="modal__header">
              <h2>
                {(() => {
                  const def = CARD_DEFS.find(c => c.id === expandedCardId)
                  return def ? `${def.label}${def.blurb ? ' — ' + def.blurb : ''}` : ''
                })()}
              </h2>
              <button type="button" className="sched-btn sched-btn--ghost modal__close" onClick={() => setExpandedCardId(null)} aria-label="Close">×</button>
            </header>
            <div className="modal__body">
              <div className="stat-modal__chart-wrap">
                <canvas id="stat-modal-canvas" ref={el => { modalCanvasRef.current = el }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {rangePop && (
        <RangePopover
          rangePop={rangePop}
          getCardRange={getCardRange}
          onPreset={applyRangePreset}
          onApply={applyCustomRange}
          onReset={resetRange}
        />
      )}

      {driverDetail && (
        <DriverDetailModal
          supabase={supabase}
          driver={driverDetail}
          onClose={() => setDriverDetail(null)}
        />
      )}
    </section>
  )
}

function RangePopover({
  rangePop, getCardRange, onPreset, onApply, onReset,
}: {
  rangePop: { cardId: string; top: number; left: number }
  getCardRange: (id: string) => CardRange
  onPreset: (preset: string) => void
  onApply: (fromV: string, toV: string) => void
  onReset: () => void
}) {
  const r = getCardRange(rangePop.cardId)
  const [fromV, setFromV] = useState(r.startIso)
  const [toV, setToV] = useState(r.endIso)

  return (
    <div id="stat-range-pop" className="range-pop" style={{ top: rangePop.top, left: rangePop.left }} onClick={e => e.stopPropagation()}>
      <div className="range-pop__section">
        {['this-week', '7', '14', 'this-month', '30', '60', '90'].map(p => (
          <button key={p} type="button" className="range-pop__preset" onClick={() => onPreset(p)}>
            {p === 'this-week' ? 'This week'
              : p === 'this-month' ? 'This month'
              : p === '7' ? 'Last 7 days'
              : p === '14' ? 'Two weeks'
              : p === '30' ? 'Last 30 days'
              : p === '60' ? 'Last 60 days'
              : 'Last 90 days'}
          </button>
        ))}
      </div>
      <div className="range-pop__section range-pop__custom">
        <label className="range-pop__label">
          Custom range <span className="muted">(set start = end for a single day)</span>
        </label>
        <div className="range-pop__row">
          <input type="date" className="range-pop__date" value={fromV} onChange={e => setFromV(e.target.value)} />
          <span className="muted">→</span>
          <input type="date" className="range-pop__date" value={toV} onChange={e => setToV(e.target.value)} />
          <button type="button" className="sched-btn sched-btn--primary range-pop__apply" onClick={() => onApply(fromV, toV)}>Apply</button>
        </div>
      </div>
      <div className="range-pop__section range-pop__footer">
        <button type="button" className="range-pop__reset" onClick={onReset}>Reset to global range</button>
      </div>
    </div>
  )
}

// ===========================================================================
//  Aggregations
// ===========================================================================

function totalHours(entries: ScheduleEntry[]): number {
  let total = 0
  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    total += shiftDurationHours(e.start_time, e.end_time)
  }
  return total
}

function aggHoursByHourOfDay(entries: ScheduleEntry[], days: number): number[] {
  const counts = new Array(24).fill(0)
  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    let s = parseTime(e.start_time)
    let f = parseTime(e.end_time)
    if (f <= s) f += 24
    const start = Math.floor(s)
    const end = Math.ceil(f)
    for (let h = start; h < end; h++) counts[h % 24] += 1
  }
  const dayCount = Math.max(1, days)
  return counts.map(c => +(c / dayCount).toFixed(2))
}

function aggHoursByDayOfWeek(entries: ScheduleEntry[]): { labels: string[]; data: number[] } {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const buckets = new Array(7).fill(0)
  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    const d = fromIsoDate(e.schedule_date)
    const dow = (d.getDay() + 6) % 7
    buckets[dow] += shiftDurationHours(e.start_time, e.end_time)
  }
  return { labels, data: buckets.map(v => +v.toFixed(1)) }
}

function aggHeatmap(entries: ScheduleEntry[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  const dayCounts = new Array(7).fill(0)
  const seenDates = new Set<string>()
  for (const e of entries) {
    if (!seenDates.has(e.schedule_date)) {
      const d = fromIsoDate(e.schedule_date)
      const dow = (d.getDay() + 6) % 7
      dayCounts[dow] += 1
      seenDates.add(e.schedule_date)
    }
    if (e.entry_type !== 'shift') continue
    const d = fromIsoDate(e.schedule_date)
    const dow = (d.getDay() + 6) % 7
    let s = parseTime(e.start_time)
    let f = parseTime(e.end_time)
    if (f <= s) f += 24
    for (let h = Math.floor(s); h < Math.ceil(f); h++) {
      grid[dow][h % 24] += 1
    }
  }
  return grid.map((row, dow) =>
    row.map(v => dayCounts[dow] ? +(v / dayCounts[dow]).toFixed(2) : 0),
  )
}

function aggShiftLengthDist(entries: ScheduleEntry[]): { labels: string[]; data: number[] } {
  const bins = [4, 6, 8, 10, 12, 24]
  const labels = ['<4h', '4-6h', '6-8h', '8-10h', '10-12h', '12+h']
  const counts = new Array(bins.length).fill(0)
  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    const h = shiftDurationHours(e.start_time, e.end_time)
    let i = bins.findIndex(b => h <= b); if (i < 0) i = bins.length - 1
    counts[i] += 1
  }
  return { labels, data: counts }
}

function aggHoursPerDriver(entries: ScheduleEntry[], drivers: Driver[]): Array<{ id: number; name: string; hours: number; driver: Driver | undefined }> {
  const map = new Map<number, number>()
  for (const d of drivers) map.set(d.id, 0)
  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    if (!map.has(e.driver_id)) continue
    map.set(e.driver_id, (map.get(e.driver_id) || 0) + shiftDurationHours(e.start_time, e.end_time))
  }
  return [...map.entries()].map(([id, hours]) => {
    const d = drivers.find(x => x.id === id)
    return { id, name: d?.name || `#${id}`, hours: +hours.toFixed(1), driver: d }
  })
}

function aggFunctionBreakdown(entries: ScheduleEntry[], drivers: Driver[]): { labels: string[]; data: number[] } {
  const drvFn = new Map(drivers.map(d => [d.id, d.function || 'Unknown']))
  const buckets = new Map<string, number>()
  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    const fn = drvFn.get(e.driver_id) || 'Unknown'
    const h = shiftDurationHours(e.start_time, e.end_time)
    buckets.set(fn, (buckets.get(fn) || 0) + h)
  }
  const arr = [...buckets.entries()].sort((a, b) => b[1] - a[1])
  return { labels: arr.map(x => x[0]), data: arr.map(x => +x[1].toFixed(1)) }
}

function aggOffReasons(entries: ScheduleEntry[]): { labels: string[]; data: number[] } {
  const buckets = new Map<string, number>()
  for (const e of entries) {
    if (e.entry_type !== 'off') continue
    const r = e.off_reason || 'unknown'
    buckets.set(r, (buckets.get(r) || 0) + 1)
  }
  const arr = [...buckets.entries()].sort((a, b) => b[1] - a[1])
  return { labels: arr.map(x => x[0]), data: arr.map(x => x[1]) }
}

function aggYardUtilization(entries: ScheduleEntry[], drivers: Driver[]): { labels: string[]; data: number[] } {
  const drvYard = new Map<number, string[]>()
  for (const d of drivers) {
    const y = d.irh_yard_number || '—'
    const list = String(y).split(',').map(s => s.trim()).filter(Boolean)
    drvYard.set(d.id, list.length ? list : ['—'])
  }
  const buckets = new Map<string, number>()
  for (const e of entries) {
    if (e.entry_type !== 'shift') continue
    const yards = drvYard.get(e.driver_id) || ['—']
    const h = shiftDurationHours(e.start_time, e.end_time) / yards.length
    for (const y of yards) buckets.set(y, (buckets.get(y) || 0) + h)
  }
  const arr = [...buckets.entries()].sort((a, b) => b[1] - a[1])
  return { labels: arr.map(x => x[0]), data: arr.map(x => +x[1].toFixed(1)) }
}

function bucketByWeek(entries: ScheduleEntry[], weeks: number): { labels: string[]; buckets: ScheduleEntry[][] } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const buckets: ScheduleEntry[][] = new Array(weeks).fill(null).map(() => [])
  const labels: string[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(today, -7 * (i + 1) + 1)
    labels.push(start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
  }
  for (const e of entries) {
    const d = fromIsoDate(e.schedule_date)
    const diffDays = Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays < 0) continue
    const wIdx = weeks - 1 - Math.floor(diffDays / 7)
    if (wIdx < 0 || wIdx >= weeks) continue
    buckets[wIdx].push(e)
  }
  return { labels, buckets }
}

function aggWeeklyTotals(entries: ScheduleEntry[], weeks: number): { labels: string[]; data: number[] } {
  const { labels, buckets } = bucketByWeek(entries, weeks)
  return { labels, data: buckets.map(b => +totalHours(b).toFixed(1)) }
}

function aggOvernightByWeek(entries: ScheduleEntry[], weeks: number): { labels: string[]; data: number[] } {
  const { labels, buckets } = bucketByWeek(entries, weeks)
  return {
    labels,
    data: buckets.map(b => b.filter(e => e.entry_type === 'shift' && e.end_time && e.start_time && e.end_time < e.start_time).length),
  }
}

function parseTime(t: string | null | undefined): number {
  if (!t) return 0
  const [h, m] = String(t).split(':').map(Number)
  return h + (m || 0) / 60
}

// ===========================================================================
//  Chart options
// ===========================================================================

interface CommonOpts { showLegend?: boolean; scales?: Record<string, unknown> }

function commonChartOpts(expanded: boolean, extra: CommonOpts = {}): NonNullable<ChartConfiguration['options']> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 700, easing: 'easeInOutQuart' },
    plugins: {
      legend: {
        display: !!extra.showLegend,
        labels: { color: CHART_COLORS.textDim, font: { size: expanded ? 13 : 10 } },
      },
      tooltip: {
        enabled: true,
        backgroundColor: 'rgba(15,17,21,0.95)',
        borderColor: 'rgba(59,130,246,0.35)',
        borderWidth: 1,
        titleColor: '#fff',
        bodyColor: '#e5e7eb',
        padding: 10,
        cornerRadius: 6,
      },
    },
    scales: extra.scales !== undefined ? extra.scales as never : {
      x: { ticks: { color: CHART_COLORS.textDim, font: { size: expanded ? 12 : 10 } }, grid: { color: CHART_COLORS.gridDark } },
      y: { ticks: { color: CHART_COLORS.textDim, font: { size: expanded ? 12 : 10 } }, grid: { color: CHART_COLORS.gridDark }, beginAtZero: true },
    },
  } as NonNullable<ChartConfiguration['options']>
}

// formatTime12 used by aggregations? -> not directly; keep import for clarity (linter may flag)
void formatTime12
