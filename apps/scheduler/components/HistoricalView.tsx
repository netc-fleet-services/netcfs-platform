'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  Chart,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  CategoryScale, LinearScale,
  Title, Tooltip, Legend, Filler,
  type ChartConfiguration,
} from 'chart.js'
import { getBaseline, type Baseline } from '../lib/optimizer'
import { formatHour12, formatHourCompact } from '../lib/utils'

Chart.register(
  BarController, BarElement,
  LineController, LineElement, PointElement,
  CategoryScale, LinearScale,
  Title, Tooltip, Legend, Filler,
)

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Props {
  supabase: SupabaseClient
}

function sumGrid(grid: number[][]): number {
  return grid.reduce((s, row) => s + row.reduce((rs, v) => rs + v, 0), 0)
}

function peakCell(grid: number[][]): { dow: number; hour: number; value: number } {
  let best = { dow: 0, hour: 0, value: -Infinity }
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 0; h < 24; h++) {
      if (grid[dow][h] > best.value) best = { dow, hour: h, value: grid[dow][h] }
    }
  }
  return best
}

export function HistoricalView({ supabase }: Props) {
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [month, setMonth] = useState<string>('')  // "" = aggregate

  const hourlyRef = useRef<HTMLCanvasElement | null>(null)
  const dailyRef = useRef<HTMLCanvasElement | null>(null)
  const monthlyRef = useRef<HTMLCanvasElement | null>(null)
  const hourlyChart = useRef<Chart | null>(null)
  const dailyChart = useRef<Chart | null>(null)
  const monthlyChart = useRef<Chart | null>(null)

  useEffect(() => {
    let alive = true
    getBaseline(supabase)
      .then(b => { if (alive) setBaseline(b) })
      .catch(err => {
        console.error('Historical baseline load failed:', err)
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => { alive = false }
  }, [supabase])

  // Cleanup all charts on unmount.
  useEffect(() => {
    return () => {
      hourlyChart.current?.destroy(); hourlyChart.current = null
      dailyChart.current?.destroy(); dailyChart.current = null
      monthlyChart.current?.destroy(); monthlyChart.current = null
    }
  }, [])

  const grid: number[][] | null = useMemo(() => {
    if (!baseline) return null
    if (month) {
      return baseline.byMonth.get(Number(month)) || null
    }
    return baseline.aggregate
  }, [baseline, month])

  const summary = useMemo(() => {
    if (!grid) return month ? 'No data for that month yet.' : 'No baseline loaded.'
    const total = sumGrid(grid)
    const monthLabel = month
      ? new Date(2025, Number(month) - 1, 1).toLocaleString(undefined, { month: 'long' })
      : 'all months (aggregate)'
    const peak = peakCell(grid)
    return `${monthLabel}: avg ${total.toFixed(0)} calls/week · peak ${peak.value.toFixed(1)}/hr at ${DAY_LABELS[peak.dow]} ${formatHour12(peak.hour)}`
  }, [grid, month])

  // Hourly bar chart
  useEffect(() => {
    if (!grid || !hourlyRef.current) return
    const labels = Array.from({ length: 24 }, (_, h) => formatHourCompact(h))
    const data = Array.from({ length: 24 }, (_, h) => grid.reduce((s, row) => s + row[h], 0))
    hourlyChart.current = upsertChart(hourlyChart.current, hourlyRef.current, {
      type: 'bar',
      data: { labels, datasets: [{
        label: 'Avg calls/hr (sum across weekdays)',
        data,
        backgroundColor: 'rgba(59, 130, 246, 0.65)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1,
      }]},
      options: barChartOpts(),
    })
  }, [grid])

  // Daily bar chart
  useEffect(() => {
    if (!grid || !dailyRef.current) return
    const data = grid.map(row => row.reduce((s, v) => s + v, 0))
    dailyChart.current = upsertChart(dailyChart.current, dailyRef.current, {
      type: 'bar',
      data: { labels: DAY_LABELS, datasets: [{
        label: 'Avg calls/day (sum across hours)',
        data,
        backgroundColor: DAY_LABELS.map((_, i) =>
          i >= 5 ? 'rgba(245, 158, 11, 0.65)' : 'rgba(59, 130, 246, 0.65)'),
        borderColor: DAY_LABELS.map((_, i) =>
          i >= 5 ? 'rgba(245, 158, 11, 1)' : 'rgba(59, 130, 246, 1)'),
        borderWidth: 1,
      }]},
      options: barChartOpts(),
    })
  }, [grid])

  // Monthly trend line — always uses byMonth (independent of the selected month).
  useEffect(() => {
    if (!baseline || !monthlyRef.current) return
    const selected = month ? Number(month) : null
    const data = MONTH_LABELS.map((_, i) => {
      const g = baseline.byMonth.get(i + 1)
      return g ? sumGrid(g) : 0
    })
    const accent = 'rgba(245, 158, 11, 1)'
    const base = 'rgba(59, 130, 246, 1)'
    monthlyChart.current = upsertChart(monthlyChart.current, monthlyRef.current, {
      type: 'line',
      data: { labels: MONTH_LABELS, datasets: [{
        label: 'Avg calls/week',
        data,
        borderColor: base,
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: MONTH_LABELS.map((_, i) => (i + 1 === selected ? accent : base)),
        pointBorderColor: MONTH_LABELS.map((_, i) => (i + 1 === selected ? accent : base)),
        pointRadius: MONTH_LABELS.map((_, i) => (i + 1 === selected ? 6 : 3)),
        pointHoverRadius: MONTH_LABELS.map((_, i) => (i + 1 === selected ? 8 : 5)),
        borderWidth: 2,
      }]},
      options: {
        ...barChartOpts(),
        onClick: (_evt, elements) => {
          if (!elements || !elements.length) return
          const idx = elements[0].index
          const m = String(idx + 1)
          setMonth(prev => prev === m ? '' : m)
        },
        onHover: (evt, elements) => {
          const ne = evt.native as { target?: HTMLElement | null } | undefined
          const target = ne?.target
          if (target) target.style.cursor = elements.length ? 'pointer' : 'default'
        },
      },
    })
  }, [baseline, month])

  if (error) {
    return (
      <section className="historical">
        <div className="historical__empty">Couldn&apos;t load baseline: {error}</div>
      </section>
    )
  }

  return (
    <section className="historical">
      <div className="historical__toolbar">
        <label className="historical__field">
          <span>Month</span>
          <select value={month} onChange={e => setMonth(e.target.value)}>
            <option value="">All months (aggregate)</option>
            {MONTH_LABELS.map((m, i) => (
              <option key={m} value={String(i + 1)}>
                {new Date(2025, i, 1).toLocaleString(undefined, { month: 'long' })}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">{summary}</span>
      </div>

      <div className="historical__sections">
        <section className="historical__section">
          <h3>Avg calls per hour × day-of-week</h3>
          <p className="muted">Darker cells = busier hours. Hover for the exact value.</p>
          <Heatmap grid={grid} />
        </section>

        <section className="historical__section historical__section--charts">
          <div className="historical__chart">
            <h3>Calls by hour-of-day</h3>
            <p className="muted">Total avg calls per hour, summed across the week.</p>
            <div className="historical__chart-wrap"><canvas ref={hourlyRef} /></div>
          </div>
          <div className="historical__chart">
            <h3>Calls by day-of-week</h3>
            <p className="muted">Total avg calls per day, summed across hours.</p>
            <div className="historical__chart-wrap"><canvas ref={dailyRef} /></div>
          </div>
        </section>

        <section className="historical__section">
          <h3>Calls by month</h3>
          <p className="muted">Total avg calls per week, one point per month. Click a point to filter; click it again to clear.</p>
          <div className="historical__chart-wrap"><canvas ref={monthlyRef} /></div>
        </section>
      </div>
    </section>
  )
}

function Heatmap({ grid }: { grid: number[][] | null }) {
  if (!grid) return null
  const max = Math.max(0.0001, ...grid.flat())
  return (
    <div className="heatmap">
      <div className="heatmap__row heatmap__row--header">
        <div className="heatmap__cell heatmap__cell--label" />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="heatmap__cell heatmap__cell--header">{formatHourCompact(h)}</div>
        ))}
      </div>
      {grid.map((row, dow) => (
        <div key={dow} className="heatmap__row">
          <div className="heatmap__cell heatmap__cell--label">{DAY_LABELS[dow]}</div>
          {row.map((v, h) => {
            const intensity = v / max
            const tip = `${DAY_LABELS[dow]} ${formatHour12(h)}: ${v.toFixed(2)} calls/hr`
            return (
              <div
                key={h}
                className="heatmap__cell"
                style={{ ['--i' as string]: intensity.toFixed(3) } as React.CSSProperties}
                title={tip}
              >
                {v >= 0.5 ? v.toFixed(1) : ''}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function upsertChart(prev: Chart | null, canvas: HTMLCanvasElement, config: ChartConfiguration): Chart {
  if (prev && prev.canvas === canvas) {
    prev.data = config.data
    prev.options = config.options ?? {}
    prev.update()
    return prev
  }
  if (prev) prev.destroy()
  return new Chart(canvas, config)
}

function barChartOpts(): NonNullable<ChartConfiguration['options']> {
  const dim = '#9ca3af'
  const grid = 'rgba(255,255,255,0.08)'
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15,17,21,0.95)',
        borderColor: 'rgba(59,130,246,0.35)',
        borderWidth: 1,
        titleColor: '#fff',
        bodyColor: '#e5e7eb',
        padding: 10,
        cornerRadius: 6,
      },
    },
    scales: {
      x: { ticks: { color: dim, font: { size: 10 } }, grid: { color: grid } },
      y: { ticks: { color: dim, font: { size: 10 } }, grid: { color: grid }, beginAtZero: true },
    },
  }
}
