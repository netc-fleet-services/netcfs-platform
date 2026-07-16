'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import { APP_CONFIG, type CompanyBucket, type TeamId } from '../lib/config'
import type { Driver, ScheduleEntry } from '../lib/types'
import {
  copyEntriesShifted,
  deleteEntriesForDriversInRange,
  fetchEntriesForRange,
  insertEntries,
  listDistinctYards,
  listDrivers,
  listScheduleBetween,
} from '../lib/db'
import {
  addDays, dateRange, formatHours, fromIsoDate, shiftDurationHours, shortDateLabel,
  sortDrivers, startOfWeek, toIsoDate, weekDates, type SortKey,
} from '../lib/utils'
import { SettingsProvider, useSettings } from '../lib/settings'
import { GridView } from './GridView'
import { GanttView } from './GanttView'
import { ShiftModal } from './ShiftModal'
import { DayView } from './DayView'
import { StatsView } from './StatsView'
import { CoveragePanel } from './CoveragePanel'
import { HistoricalView } from './HistoricalView'
import { AdminSettingsView } from './AdminSettingsView'
import { ExportModal } from './ExportModal'
import { DriverDetailModal } from './DriverDetailModal'
import { DriverEditModal } from './DriverEditModal'

type ViewMode = 'grid' | 'gantt'
type TabId = 'drivers' | 'dispatchers' | 'stats' | 'historical' | 'settings'

// Snap the anchor for week-aligned views. 7-day anchors at the Monday of the
// week containing `d`; 14-day anchors a week earlier so the window covers the
// previous week + the week containing `d`. Other view sizes pass through.
function snapAnchor(d: Date, viewDays: number): Date {
  if (viewDays === 7) return startOfWeek(d)
  if (viewDays === 14) return addDays(startOfWeek(d), -7)
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

interface BulkAction {
  driverIds: number[]
  isoStart: string
  isoEnd: string
  snapshot: Array<Pick<ScheduleEntry, 'driver_id' | 'schedule_date' | 'entry_type' | 'start_time' | 'end_time' | 'off_reason' | 'notes'>>
  label: string
}

export function Scheduler() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])
  return (
    <SettingsProvider supabase={supabase}>
      <SchedulerInner />
    </SettingsProvider>
  )
}

function SchedulerInner() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])
  const { hiddenDriverIds } = useSettings()

  // ---- View / filter state ----------------------------------------------
  const [activeTab, setActiveTab] = useState<TabId>(APP_CONFIG.defaultTab)
  const [view, setView] = useState<ViewMode>('grid')
  const [viewDays, setViewDays] = useState(APP_CONFIG.defaultViewDays)
  const [anchorDate, setAnchorDate] = useState<Date>(() => snapAnchor(new Date(), APP_CONFIG.defaultViewDays))
  const [showInactive, setShowInactive] = useState(false)
  // Company scope — defaults to Interstate so live Interstate users see zero
  // change until they click a pill. Last choice persists per browser.
  const [companyBucket, setCompanyBucket] = useState<CompanyBucket>(() => {
    if (typeof window === 'undefined') return APP_CONFIG.defaultCompanyBucket
    const v = window.localStorage.getItem('scheduler.companyBucket')
    return v === 'all' || v === 'netc' || v === 'interstate' ? v : APP_CONFIG.defaultCompanyBucket
  })
  // Team (type of work) filter — unifies LDT/'Light Duty Towing' etc., so it
  // works under any company bucket including All Companies.
  const [team, setTeam] = useState<'all' | TeamId>('all')
  const [yard, setYard] = useState<string>('')
  const [search, setSearch] = useState('')
  const [gridSort, setGridSort] = useState<SortKey>('function')
  const [ganttSort, setGanttSort] = useState<SortKey>('startTime')

  // ---- Data --------------------------------------------------------------
  const [yards, setYards] = useState<string[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [allEntries, setAllEntries] = useState<ScheduleEntry[]>([])
  const [error, setError] = useState('')
  const [userId, setUserId] = useState<string | null>(null)

  // ---- Modals ------------------------------------------------------------
  const [shiftModalTarget, setShiftModalTarget] = useState<{ driver: Driver; isoDate: string; entry: ScheduleEntry | null } | null>(null)
  const [dayViewIso, setDayViewIso] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [detailDriver, setDetailDriver] = useState<Driver | null>(null)
  const [editDriver, setEditDriver] = useState<Driver | null>(null)

  // ---- Bulk actions / undo ----------------------------------------------
  const [lastBulkAction, setLastBulkAction] = useState<BulkAction | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  // ---- Persist company scope ---------------------------------------------
  useEffect(() => {
    window.localStorage.setItem('scheduler.companyBucket', companyBucket)
  }, [companyBucket])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [supabase])

  // 7-day view locks to Mon–Sun of the current week; 14-day view locks to
  // last Monday so the window covers last week + this week. Snap the anchor
  // whenever the user switches into one of those views.
  useEffect(() => {
    setAnchorDate(prev => {
      const snapped = snapAnchor(prev, viewDays)
      return snapped.getTime() === prev.getTime() ? prev : snapped
    })
  }, [viewDays])

  // ---- Active functions for current tab ---------------------------------
  // A team pill narrows the drivers tab to that team's function spellings
  // (covers both companies' naming, so it works under All Companies too).
  const activeFunctions = useMemo<string[] | null>(() => {
    if (activeTab === 'drivers' && team !== 'all') {
      const def = APP_CONFIG.teams.find(x => x.id === team)
      if (def) return def.functions.slice()
    }
    const t = APP_CONFIG.tabs.find(t => t.id === activeTab)
    return t ? t.functions : APP_CONFIG.schedulableFunctions.slice()
  }, [activeTab, team])

  // ---- Load yards on filter changes -------------------------------------
  // Yard codes (irh_yard_number) only exist on Interstate rows; for the NETC
  // or All buckets the yard filter is hidden and cleared.
  useEffect(() => {
    if (activeTab !== 'drivers' && activeTab !== 'dispatchers') return
    if (companyBucket !== 'interstate') { setYards([]); setYard(''); return }
    ;(async () => {
      try {
        const allYards = await listDistinctYards(supabase, {
          company: 'Interstate',
          functions: activeFunctions,
        })
        const aliases = APP_CONFIG.yardAliases
        const visible = [...new Set(allYards.map(y => aliases[y] || y))]
          .filter(y => /^\d+$/.test(y) || y === 'UFP')
          .sort()
        setYards(visible)
        if (!visible.includes(yard)) setYard('')
      } catch (err) {
        console.error('Failed to load yards:', err)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, companyBucket, activeFunctions, activeTab])

  // ---- Date windows -----------------------------------------------------
  const week = useMemo(() => dateRange(anchorDate, viewDays), [anchorDate, viewDays])
  const lastWindow = useMemo(() => dateRange(addDays(anchorDate, -viewDays), viewDays), [anchorDate, viewDays])
  const nextWindow = useMemo(() => dateRange(addDays(anchorDate, +viewDays), viewDays), [anchorDate, viewDays])
  const isoStart = toIsoDate(week[0])
  const isoEnd = toIsoDate(week[week.length - 1])
  const isoRangeStart = toIsoDate(lastWindow[0])
  const isoRangeEnd = toIsoDate(nextWindow[nextWindow.length - 1])

  const yardFilterFor = useCallback((display: string): string[] | null => {
    if (!display) return null
    const aliases = APP_CONFIG.yardAliases
    const sources = Object.keys(aliases).filter(k => aliases[k] === display)
    return [display, ...sources]
  }, [])

  // ---- Load drivers + 3-window entry slice ------------------------------
  const reload = useCallback(async () => {
    if (activeTab !== 'drivers' && activeTab !== 'dispatchers') return
    setError('')
    try {
      const [ds, ents] = await Promise.all([
        listDrivers(supabase, {
          includeInactive: showInactive,
          companyBucket,
          yard: companyBucket === 'interstate' ? yardFilterFor(yard) : null,
          functions: activeFunctions,
          hiddenIds: hiddenDriverIds,
        }),
        listScheduleBetween(supabase, isoRangeStart, isoRangeEnd),
      ])
      setDrivers(ds)
      setAllEntries(ents)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      console.error(err)
    }
  }, [supabase, activeTab, showInactive, companyBucket, yard, yardFilterFor, activeFunctions, isoRangeStart, isoRangeEnd, hiddenDriverIds])

  useEffect(() => { void reload() }, [reload])

  // ---- Realtime subscription on schedule changes ------------------------
  const reloadRef = useRef(reload)
  useEffect(() => { reloadRef.current = reload }, [reload])
  useEffect(() => {
    const channel = supabase
      .channel('scheduler-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scheduler_driver_schedule' },
        () => { void reloadRef.current() },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase])

  // ---- Derived ----------------------------------------------------------
  const filteredDrivers = useMemo(() => {
    if (!search) return drivers
    const q = search.toLowerCase()
    return drivers.filter(d => {
      const name = String(d.name || '').toLowerCase()
      const irh = String(d.irh_driver_number || '').toLowerCase()
      const id = String(d.id || '').toLowerCase()
      return name.includes(q) || irh.includes(q) || id.includes(q)
    })
  }, [drivers, search])

  const weekEntries = useMemo(
    () => allEntries.filter(e => e.schedule_date >= isoStart && e.schedule_date <= isoEnd),
    [allEntries, isoStart, isoEnd],
  )

  const stats = useMemo(() => {
    const driverIds = new Set(drivers.map(d => d.id))
    const sumWindow = (wk: Date[]) => {
      const dateSet = new Set(wk.map(toIsoDate))
      let total = 0
      for (const e of allEntries) {
        if (e.entry_type !== 'shift') continue
        if (!driverIds.has(e.driver_id)) continue
        if (!dateSet.has(e.schedule_date)) continue
        total += shiftDurationHours(e.start_time, e.end_time)
      }
      return total
    }
    return {
      lastH: sumWindow(lastWindow),
      thisH: sumWindow(week),
      nextH: sumWindow(nextWindow),
    }
  }, [allEntries, drivers, week, lastWindow, nextWindow])

  // ---- Bulk actions (always operate on full Mon–Sun calendar week) ------

  function snapshotEntries(driverIds: number[], list: ScheduleEntry[], isoA: string, isoB: string): BulkAction['snapshot'] {
    const set = new Set(driverIds)
    return list
      .filter(e => set.has(e.driver_id) && e.schedule_date >= isoA && e.schedule_date <= isoB)
      .map(e => ({
        driver_id: e.driver_id,
        schedule_date: e.schedule_date,
        entry_type: e.entry_type,
        start_time: e.start_time,
        end_time: e.end_time,
        off_reason: e.off_reason,
        notes: e.notes,
      }))
  }

  async function onCopyLastWeek() {
    const thisWk = weekDates(anchorDate)
    const lastWk = thisWk.map(d => addDays(d, -7))
    const driverIds = drivers.map(d => d.id)
    if (!driverIds.length) { alert('No drivers visible — nothing to copy into.'); return }

    const isoA = toIsoDate(thisWk[0])
    const isoB = toIsoDate(thisWk[6])
    const isoSrcStart = toIsoDate(lastWk[0])
    const isoSrcEnd = toIsoDate(lastWk[6])

    setBulkBusy(true)
    try {
      const snapshot = await fetchEntriesForRange(supabase, driverIds, isoA, isoB)
      const n = await copyEntriesShifted(supabase, driverIds, isoSrcStart, isoSrcEnd, 7)
      setLastBulkAction({
        driverIds, isoStart: isoA, isoEnd: isoB, snapshot,
        label: `Copy last week (${shortDateLabel(thisWk[0])})`,
      })
      await reload()
      if (n === 0) alert('Last week had no entries to copy.')
    } catch (err) {
      console.error('Copy last week failed:', err)
      alert(`Copy failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setBulkBusy(false)
    }
  }

  async function onCopyToNextWeek() {
    const thisWk = weekDates(anchorDate)
    const nextWk = thisWk.map(d => addDays(d, 7))
    const driverIds = drivers.map(d => d.id)
    if (!driverIds.length) { alert('No drivers visible — nothing to copy.'); return }

    const tabLabel = APP_CONFIG.tabs.find(t => t.id === activeTab)?.label || 'drivers'
    const confirmMsg =
      `Copy this week (${shortDateLabel(thisWk[0])} → ${shortDateLabel(thisWk[6])}) ` +
      `to next week (${shortDateLabel(nextWk[0])} → ${shortDateLabel(nextWk[6])}) ` +
      `for ${driverIds.length} ${tabLabel}?\n\n` +
      `This will overwrite any existing entries in that range.`
    if (!confirm(confirmMsg)) return

    const isoSrcStart = toIsoDate(thisWk[0])
    const isoSrcEnd = toIsoDate(thisWk[6])
    const isoDestStart = toIsoDate(nextWk[0])
    const isoDestEnd = toIsoDate(nextWk[6])

    setBulkBusy(true)
    try {
      const snapshot = await fetchEntriesForRange(supabase, driverIds, isoDestStart, isoDestEnd)
      const n = await copyEntriesShifted(supabase, driverIds, isoSrcStart, isoSrcEnd, 7)
      setLastBulkAction({
        driverIds, isoStart: isoDestStart, isoEnd: isoDestEnd, snapshot,
        label: `Copy to next week (${shortDateLabel(nextWk[0])})`,
      })
      await reload()
      if (n === 0) alert('This week had no entries to copy.')
    } catch (err) {
      console.error('Copy to next week failed:', err)
      alert(`Copy failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setBulkBusy(false)
    }
  }

  async function onClearWeek() {
    const thisWk = weekDates(anchorDate)
    const driverIds = drivers.map(d => d.id)
    if (!driverIds.length) return

    const isoA = toIsoDate(thisWk[0])
    const isoB = toIsoDate(thisWk[6])

    let snapshot: BulkAction['snapshot']
    try {
      snapshot = await fetchEntriesForRange(supabase, driverIds, isoA, isoB)
    } catch (err) {
      console.error('Clear week pre-fetch failed:', err)
      alert(`Couldn't read this week's entries: ${err instanceof Error ? err.message : err}`)
      return
    }
    if (!snapshot.length) { alert('No entries to clear for this week.'); return }

    const tabLabel = APP_CONFIG.tabs.find(t => t.id === activeTab)?.label || 'drivers'
    const confirmMsg =
      `Delete all ${snapshot.length} entries for ${driverIds.length} ${tabLabel} ` +
      `(${shortDateLabel(thisWk[0])} → ${shortDateLabel(thisWk[6])})?\n\n` +
      `Use Undo to restore.`
    if (!confirm(confirmMsg)) return

    setBulkBusy(true)
    try {
      await deleteEntriesForDriversInRange(supabase, driverIds, isoA, isoB)
      setLastBulkAction({
        driverIds, isoStart: isoA, isoEnd: isoB, snapshot,
        label: `Clear ${shortDateLabel(thisWk[0])} → ${shortDateLabel(thisWk[6])}`,
      })
      await reload()
    } catch (err) {
      console.error('Clear week failed:', err)
      alert(`Clear failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setBulkBusy(false)
    }
  }

  async function onUndo() {
    if (!lastBulkAction) return
    const { driverIds, isoStart: a, isoEnd: b, snapshot, label } = lastBulkAction
    if (!confirm(`Undo: ${label}?`)) return

    setBulkBusy(true)
    try {
      await deleteEntriesForDriversInRange(supabase, driverIds, a, b)
      await insertEntries(supabase, snapshot)
      setLastBulkAction(null)
      await reload()
    } catch (err) {
      console.error('Undo failed:', err)
      alert(`Undo failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setBulkBusy(false)
    }
  }

  // ---- Click handlers ----------------------------------------------------
  function handleCellClick(driver: Driver, isoDate: string, entry: ScheduleEntry | null) {
    setShiftModalTarget({ driver, isoDate, entry })
  }
  function handleHeaderClick(isoDate: string) { setDayViewIso(isoDate) }
  function handleGanttBarClick(driver: Driver, entry: ScheduleEntry) {
    setShiftModalTarget({ driver, isoDate: entry.schedule_date, entry })
  }
  function shiftWindow(deltaDays: number) { setAnchorDate(prev => addDays(prev, deltaDays)) }
  function goToToday() {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    setAnchorDate(snapAnchor(d, viewDays))
  }
  function handleTabChange(next: TabId) {
    if (next === activeTab) return
    setActiveTab(next)
    setYard('')
    setSearch('')
    setTeam('all')
  }
  function handleBucketChange(next: CompanyBucket) {
    if (next === companyBucket) return
    setCompanyBucket(next)
    setYard('')
    // team is kept on purpose — every team exists in both companies
  }

  const totalDriverCount = drivers.length
  const shownCount = filteredDrivers.length
  const countLabel = search
    ? `${shownCount} of ${totalDriverCount} driver${totalDriverCount === 1 ? '' : 's'}`
    : (shownCount ? `${shownCount} driver${shownCount === 1 ? '' : 's'}` : '')

  const isAuxTab = activeTab === 'stats' || activeTab === 'historical' || activeTab === 'settings'

  return (
    <>
      {/* Company scope — the top-level switch between NETC and Interstate */}
      <div className="company-toggle" role="group" aria-label="Company">
        {APP_CONFIG.companyBuckets.map(b => (
          <button
            key={b.id}
            type="button"
            className={`company-btn ${b.id === companyBucket ? 'company-btn--active' : ''}`}
            onClick={() => handleBucketChange(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="tabs">
        {APP_CONFIG.tabs.map(t => (
          <button
            key={t.id}
            type="button"
            className={`tab ${t.id === activeTab ? 'tab--active' : ''}`}
            onClick={() => handleTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!isAuxTab && (
        <>
          <div className="week-stats">
            <Stat label="Last week" value={formatHours(stats.lastH)} />
            <Stat label="This week" value={formatHours(stats.thisH)} delta={delta(stats.thisH, stats.lastH)} deltaSuffix="vs last" current />
            <Stat label="Next week" value={formatHours(stats.nextH)} delta={delta(stats.nextH, stats.thisH)} deltaSuffix="vs this" />
          </div>

          {/* Optimizer counts LDT/HDT supply against the Interstate call
              baseline — only meaningful for Interstate + All Teams. */}
          {activeTab === 'drivers' && companyBucket === 'interstate' && team === 'all' && (
            <CoveragePanel
              supabase={supabase}
              drivers={drivers}
              allEntries={allEntries}
              isoStart={isoStart}
              isoEnd={isoEnd}
              onItemClick={iso => setDayViewIso(iso)}
            />
          )}

          <div className="week-nav">
            <div className="week-nav__left">
              <button className="sched-btn sched-btn--ghost" onClick={() => shiftWindow(-viewDays)} title="Previous period">←</button>
              <button className="sched-btn sched-btn--ghost" onClick={goToToday}>Today</button>
              <button className="sched-btn sched-btn--ghost" onClick={() => shiftWindow(+viewDays)} title="Next period">→</button>
              <input
                type="date"
                className="week-jump"
                value={isoStart}
                onChange={e => {
                  if (!e.target.value) return
                  setAnchorDate(snapAnchor(fromIsoDate(e.target.value), viewDays))
                }}
              />
            </div>
            <div className="week-nav__title">
              {shortDateLabel(week[0])} → {shortDateLabel(week[week.length - 1])}
            </div>
            <div className="week-nav__right">
              <label className="toggle">
                <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
                <span>Show inactive</span>
              </label>
              <button className="sched-btn sched-btn--ghost" onClick={onCopyLastWeek} disabled={bulkBusy} title="Duplicate last week into this one">
                {bulkBusy ? 'Working…' : '← Copy last week'}
              </button>
              <button className="sched-btn sched-btn--ghost" onClick={onCopyToNextWeek} disabled={bulkBusy} title="Duplicate this week into next">
                {bulkBusy ? 'Working…' : 'Copy to next →'}
              </button>
              <button className="sched-btn sched-btn--danger" onClick={onClearWeek} disabled={bulkBusy} title="Delete every entry this week">
                {bulkBusy ? 'Working…' : 'Clear week'}
              </button>
              <button
                className="sched-btn sched-btn--ghost"
                onClick={onUndo}
                disabled={bulkBusy || !lastBulkAction}
                title={lastBulkAction ? `Undo: ${lastBulkAction.label}` : 'Nothing to undo'}
              >
                Undo
              </button>
            </div>
          </div>

          <div className="filters">
            {/* Team (type of work) pills — unified across both companies'
                function spellings, so they work under any company scope. */}
            {activeTab === 'drivers' && (
              <div className="view-toggle" role="group" aria-label="Team">
                <button
                  type="button"
                  className={`view-btn ${team === 'all' ? 'view-btn--active' : ''}`}
                  onClick={() => setTeam('all')}
                >
                  All Teams
                </button>
                {APP_CONFIG.teams.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`view-btn ${team === t.id ? 'view-btn--active' : ''}`}
                    onClick={() => setTeam(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            {/* Yard codes only exist on Interstate rows */}
            {companyBucket === 'interstate' && (
              <label className="filter">
                <span>Yard</span>
                <select value={yard} onChange={e => setYard(e.target.value)}>
                  <option value="">All yards</option>
                  {yards.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            )}
            <label className="filter filter--grow">
              <span>Search</span>
              <input
                type="search"
                className="filter__search"
                placeholder="name or driver #…"
                autoComplete="off"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </label>
            <span className="filter-count muted">{countLabel}</span>
          </div>

          <div className="view-toolbar">
            <label className="days-picker">
              <span className="days-picker__label">Show</span>
              <select value={viewDays} onChange={e => setViewDays(Number(e.target.value) || 7)}>
                {APP_CONFIG.viewDayChoices.map(n => (
                  <option key={n} value={n}>{n} day{n === 1 ? '' : 's'}</option>
                ))}
              </select>
            </label>
            <div className="view-toggle">
              <button type="button" className={`view-btn ${view === 'grid' ? 'view-btn--active' : ''}`} onClick={() => setView('grid')}>Grid</button>
              <button type="button" className={`view-btn ${view === 'gantt' ? 'view-btn--active' : ''}`} onClick={() => setView('gantt')}>Gantt</button>
            </div>
            <button
              type="button"
              className="sched-btn sched-btn--ghost"
              onClick={() => setExportOpen(true)}
              title="Export the schedule (print or CSV)"
            >
              Export…
            </button>
          </div>

          {error ? (
            <div className="schedule">
              <div className="schedule__empty">
                <p><strong>Couldn&apos;t load schedule.</strong></p>
                <p className="muted">{error}</p>
              </div>
            </div>
          ) : !filteredDrivers.length ? (
            <div className="schedule">
              <div className="schedule__empty">
                <p><strong>No drivers match the current filters.</strong></p>
                <p className="muted">
                  Clear the search, change a filter above, or add drivers via the Settings tab.
                </p>
              </div>
            </div>
          ) : view === 'grid' ? (
            <GridView
              drivers={filteredDrivers}
              entries={weekEntries}
              week={week}
              sortKey={gridSort}
              onSortChange={setGridSort}
              onCellClick={handleCellClick}
              onHeaderClick={handleHeaderClick}
              onDriverClick={setDetailDriver}
            />
          ) : (
            <GanttView
              supabase={supabase}
              drivers={filteredDrivers}
              entries={weekEntries}
              week={week}
              viewDays={viewDays}
              sortKey={ganttSort}
              onSortChange={setGanttSort}
              onChanged={reload}
              onBarClick={handleGanttBarClick}
              onAxisClick={handleHeaderClick}
              onDriverClick={setDetailDriver}
            />
          )}
        </>
      )}

      {activeTab === 'stats' && <StatsView supabase={supabase} />}
      {activeTab === 'historical' && <HistoricalView supabase={supabase} />}
      {activeTab === 'settings' && (
        <AdminSettingsView supabase={supabase} onDriverAdded={reload} />
      )}

      {shiftModalTarget && (
        <ShiftModal
          supabase={supabase}
          driver={shiftModalTarget.driver}
          isoDate={shiftModalTarget.isoDate}
          entry={shiftModalTarget.entry}
          userId={userId}
          onSaved={reload}
          onClose={() => setShiftModalTarget(null)}
        />
      )}

      {dayViewIso && (
        <DayView
          supabase={supabase}
          isoDate={dayViewIso}
          drivers={filteredDrivers}
          entries={weekEntries}
          activeTab={activeTab === 'dispatchers' ? 'dispatchers' : 'drivers'}
          onChanged={reload}
          onClose={() => setDayViewIso(null)}
          onEditEntry={(driver, entry) => {
            setDayViewIso(null)
            setShiftModalTarget({ driver, isoDate: entry.schedule_date, entry })
          }}
        />
      )}

      {detailDriver && (
        <DriverDetailModal
          supabase={supabase}
          driver={detailDriver}
          onClose={() => setDetailDriver(null)}
          onEdit={driver => { setDetailDriver(null); setEditDriver(driver) }}
          onChanged={reload}
        />
      )}

      {editDriver && (
        <DriverEditModal
          supabase={supabase}
          driver={editDriver}
          onClose={() => setEditDriver(null)}
          onSaved={() => { setEditDriver(null); void reload() }}
        />
      )}

      {exportOpen && (
        <ExportModal
          supabase={supabase}
          companyBucket={companyBucket}
          defaultStartIso={toIsoDate(weekDates(anchorDate)[0])}
          defaultTab={activeTab === 'dispatchers' ? 'dispatchers' : 'drivers'}
          defaultFormat={view === 'gantt' ? 'gantt' : 'table'}
          defaultYard={yard}
          yardOptions={yards}
          yardFilterFor={yardFilterFor}
          driverSort={(ds, { entries, week }) =>
            sortDrivers(ds, view === 'gantt' ? ganttSort : gridSort, { entries, week })
          }
          onClose={() => setExportOpen(false)}
        />
      )}
    </>
  )
}

function Stat({
  label, value, delta, deltaSuffix, current,
}: {
  label: string
  value: string
  delta?: string
  deltaSuffix?: string
  current?: boolean
}) {
  return (
    <div className={`stat ${current ? 'stat--current' : ''}`}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {delta && <div className="stat__delta">{delta} {deltaSuffix}</div>}
    </div>
  )
}

function delta(a: number, b: number): string {
  const d = a - b
  if (Math.abs(d) < 0.01) return '—'
  const formatted = formatHours(Math.abs(d))
  return (d > 0 ? '+' : '-') + formatted
}
