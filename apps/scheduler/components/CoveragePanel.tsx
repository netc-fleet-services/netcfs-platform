'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Driver, ScheduleEntry } from '../lib/types'
import { useOptimizerConfig } from '../lib/settings'
import {
  computeGaps,
  filterSupplyDrivers,
  getBaseline,
  suggestionText,
  topSuggestions,
  type Baseline,
} from '../lib/optimizer'
import { addDays, fromIsoDate, toIsoDate } from '../lib/utils'

interface Props {
  supabase: SupabaseClient
  drivers: Driver[]                 // unfiltered roster (coverage = system metric)
  allEntries: ScheduleEntry[]       // 3-week window
  isoStart: string                  // visible-window start
  isoEnd: string                    // visible-window end
  onItemClick: (isoDate: string) => void
}

export function CoveragePanel({ supabase, drivers, allEntries, isoStart, isoEnd, onItemClick }: Props) {
  const opt = useOptimizerConfig()
  const [expanded, setExpanded] = useState(true)
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [baselineError, setBaselineError] = useState(false)

  useEffect(() => {
    let alive = true
    setBaselineError(false)
    getBaseline(supabase)
      .then(b => { if (alive) setBaseline(b) })
      .catch(err => {
        console.warn('Optimizer baseline load failed:', err)
        if (alive) setBaselineError(true)
      })
    return () => { alive = false }
  }, [supabase])

  const supplyDrivers = useMemo(() => filterSupplyDrivers(drivers, opt), [drivers, opt])

  const summaryText = useMemo(() => {
    if (baselineError) return "couldn't load baseline"
    if (!baseline) return 'loading historical baseline…'
    return null
  }, [baseline, baselineError])

  const { gaps, under, over } = useMemo(() => {
    if (!baseline) return { gaps: [] as ReturnType<typeof computeGaps>, under: [], over: [] }

    // Visible-window entries plus yesterday's overnights (their tail bleeds
    // into the first morning).
    const dayBeforeIso = toIsoDate(addDays(fromIsoDate(isoStart), -1))
    const inWindow = allEntries.filter(e => e.schedule_date >= isoStart && e.schedule_date <= isoEnd)
    const carryIns = allEntries.filter(e =>
      e.schedule_date === dayBeforeIso &&
      e.entry_type === 'shift' &&
      e.end_time != null && e.start_time != null && e.end_time < e.start_time,
    )

    const g = computeGaps([...inWindow, ...carryIns], supplyDrivers, baseline, isoStart, isoEnd, opt)
    const tops = topSuggestions(g, opt)
    return { gaps: g, under: tops.under, over: tops.over }
  }, [baseline, allEntries, isoStart, isoEnd, supplyDrivers, opt])

  const totalUnder = useMemo(() => gaps.filter(g => g.status === 'under').length, [gaps])
  const totalOver = useMemo(() => gaps.filter(g => g.status === 'over').length, [gaps])

  return (
    <section className="coverage">
      <header className="coverage__header">
        <button
          type="button"
          className="coverage__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
          title="Show / hide coverage suggestions"
        >
          <span className="coverage__chevron" aria-hidden>▾</span>
          <span className="coverage__title">Coverage</span>
          <span className="coverage__summary muted">
            {summaryText ?? `${totalUnder} understaffed · ${totalOver} overstaffed (LDT+HDT vs historical avg)`}
          </span>
        </button>
      </header>
      {expanded && (
        <div className="coverage__body">
          <div className="coverage__col">
            <h4 className="coverage__col-title coverage__col-title--under">Understaffed</h4>
            <ul className="coverage__list">
              {!baseline && !baselineError && <li className="coverage__empty">Loading…</li>}
              {baseline && under.length === 0 && (
                <li className="coverage__empty">No flagged hours this week.</li>
              )}
              {under.map(g => (
                <li
                  key={`${g.isoDate}-${g.hour}`}
                  className="coverage__item"
                  title="Click to open day detail"
                  onClick={() => onItemClick(g.isoDate)}
                >
                  <span className="coverage__chip coverage__chip--under">
                    {g.gap > 0 ? '+' : ''}{g.gap.toFixed(1)}
                  </span>
                  <span className="coverage__text">{suggestionText(g)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="coverage__col">
            <h4 className="coverage__col-title coverage__col-title--over">Overstaffed</h4>
            <ul className="coverage__list">
              {!baseline && !baselineError && <li className="coverage__empty">Loading…</li>}
              {baseline && over.length === 0 && (
                <li className="coverage__empty">No flagged hours this week.</li>
              )}
              {over.map(g => (
                <li
                  key={`${g.isoDate}-${g.hour}`}
                  className="coverage__item"
                  title="Click to open day detail"
                  onClick={() => onItemClick(g.isoDate)}
                >
                  <span className="coverage__chip coverage__chip--over">
                    {g.gap > 0 ? '+' : ''}{g.gap.toFixed(1)}
                  </span>
                  <span className="coverage__text">{suggestionText(g)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
