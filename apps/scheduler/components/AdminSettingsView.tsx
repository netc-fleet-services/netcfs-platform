'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_CONFIG, type OptimizerConfig } from '../lib/config'
import { useSettings } from '../lib/settings'
import { insertDriver, listDistinctYardNames, listDriversByIds } from '../lib/db'
import type { Driver } from '../lib/types'
import { combineName, formatName } from '../lib/utils'

// Sensitivity presets — the UI shows one dropdown; on save we expand the
// chosen preset back into the two threshold fields the optimizer reads.
const SENSITIVITY_PRESETS = [
  { value: 'very-relaxed',    understaffedThreshold: -3.5, overstaffedThreshold: 4.5 },
  { value: 'relaxed',         understaffedThreshold: -2.5, overstaffedThreshold: 3.5 },
  { value: 'balanced',        understaffedThreshold: -1.5, overstaffedThreshold: 2.0 },
  { value: 'aggressive',      understaffedThreshold: -0.5, overstaffedThreshold: 1.0 },
  { value: 'very-aggressive', understaffedThreshold: 0.0,  overstaffedThreshold: 0.5 },
]
const DEFAULT_PRESET = SENSITIVITY_PRESETS[2]

function presetByValue(v: string) {
  return SENSITIVITY_PRESETS.find(p => p.value === v) || DEFAULT_PRESET
}

function presetFromThresholds(under: number, over: number) {
  let best = DEFAULT_PRESET
  let bestScore = Infinity
  for (const p of SENSITIVITY_PRESETS) {
    const du = p.understaffedThreshold - under
    const dov = p.overstaffedThreshold - over
    const score = du * du + dov * dov
    if (score < bestScore) { bestScore = score; best = p }
  }
  return best
}

function numberOr(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parseList(s: string): string[] {
  return String(s || '').split(',').map(x => x.trim()).filter(Boolean)
}

interface Props {
  supabase: SupabaseClient
  onDriverAdded: () => void
}

export function AdminSettingsView({ supabase, onDriverAdded }: Props) {
  return (
    <div className="settings-view">
      <OptimizerForm />
      <HiddenDriversForm supabase={supabase} onChanged={onDriverAdded} />
      <AddDriverForm supabase={supabase} onAdded={onDriverAdded} />
    </div>
  )
}

function HiddenDriversForm({ supabase, onChanged }: { supabase: SupabaseClient; onChanged: () => void }) {
  const { hiddenDriverIds, unhideDriver } = useSettings()
  const [rows, setRows] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    listDriversByIds(supabase, hiddenDriverIds)
      .then(ds => { if (alive) setRows(ds) })
      .catch(err => console.error("Couldn't load hidden drivers:", err))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [supabase, hiddenDriverIds])

  // Ids in settings but not (yet) resolved to a roster row — still let the
  // user clear them so a stale id can't trap someone off the schedule.
  const orphanIds = hiddenDriverIds.filter(id => !rows.some(r => r.id === id))

  async function onUnhide(id: number) {
    setBusyId(id)
    try {
      await unhideDriver(id)
      onChanged()
    } catch (err) {
      console.error('Unhide failed:', err)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="settings-form">
      <h2>Hidden drivers / dispatchers</h2>
      <p className="muted">
        People you’ve hidden from the scheduler. They’re removed from every
        schedule, stat and export view until you unhide them here. This is
        scheduler-only and doesn’t affect other NETC apps.
      </p>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (hiddenDriverIds.length === 0) ? (
        <p className="muted">No hidden drivers. Hide someone from their detail popup.</p>
      ) : (
        <ul className="hidden-drivers__list">
          {rows.map(d => (
            <li key={d.id} className="hidden-drivers__item">
              <div className="hidden-drivers__main">
                <span className="hidden-drivers__name">{formatName(d.name) || '(unnamed)'}</span>
                <span className="muted">
                  #{d.irh_driver_number || d.id} · {d.function || '—'}
                  {d.active === false ? ' · inactive' : ''}
                </span>
              </div>
              <button
                type="button"
                className="sched-btn sched-btn--ghost"
                onClick={() => onUnhide(d.id)}
                disabled={busyId === d.id}
              >
                {busyId === d.id ? 'Unhiding…' : 'Unhide'}
              </button>
            </li>
          ))}
          {orphanIds.map(id => (
            <li key={id} className="hidden-drivers__item">
              <div className="hidden-drivers__main">
                <span className="hidden-drivers__name">Driver #{id}</span>
                <span className="muted">no longer in roster</span>
              </div>
              <button
                type="button"
                className="sched-btn sched-btn--ghost"
                onClick={() => onUnhide(id)}
                disabled={busyId === id}
              >
                {busyId === id ? 'Removing…' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function OptimizerForm() {
  const { settings, setOptimizer } = useSettings()
  const o = settings.optimizer

  const [cpd, setCpd] = useState(String(o.callsPerDriverPerHour))
  const [sensitivity, setSensitivity] = useState(
    presetFromThresholds(o.understaffedThreshold, o.overstaffedThreshold).value,
  )
  const [topU, setTopU] = useState(String(o.topUnderstaffedCount))
  const [topO, setTopO] = useState(String(o.topOverstaffedCount))
  const [fns, setFns] = useState(o.supplyFunctions.join(', '))
  const [yards, setYards] = useState(o.excludeYards.join(', '))
  const [status, setStatus] = useState<{ text: string; kind?: 'ok' | 'error' } | null>(null)
  const [saving, setSaving] = useState(false)

  // Re-sync from context when settings refresh externally.
  useEffect(() => {
    setCpd(String(o.callsPerDriverPerHour))
    setSensitivity(presetFromThresholds(o.understaffedThreshold, o.overstaffedThreshold).value)
    setTopU(String(o.topUnderstaffedCount))
    setTopO(String(o.topOverstaffedCount))
    setFns(o.supplyFunctions.join(', '))
    setYards(o.excludeYards.join(', '))
  }, [o])

  function read(): OptimizerConfig {
    const preset = presetByValue(sensitivity)
    return {
      callsPerDriverPerHour: numberOr(cpd, 1.0),
      understaffedThreshold: preset.understaffedThreshold,
      overstaffedThreshold: preset.overstaffedThreshold,
      topUnderstaffedCount: Math.max(0, Math.round(numberOr(topU, 5))),
      topOverstaffedCount: Math.max(0, Math.round(numberOr(topO, 3))),
      supplyFunctions: parseList(fns),
      excludeYards: parseList(yards),
    }
  }

  function validate(v: OptimizerConfig): string | null {
    if (v.callsPerDriverPerHour <= 0) return 'Calls per driver per hour must be > 0.'
    if (v.understaffedThreshold > 0) return 'Understaffed cutoff must be ≤ 0 (negative gap means short).'
    if (v.overstaffedThreshold < 0) return 'Overstaffed cutoff must be ≥ 0 (positive gap means surplus).'
    if (!v.supplyFunctions.length) return 'At least one supply function is required.'
    return null
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const v = read()
    const err = validate(v)
    if (err) { setStatus({ text: err, kind: 'error' }); return }
    setSaving(true)
    setStatus({ text: 'Saving…' })
    try {
      await setOptimizer(v)
      setStatus({ text: 'Saved. Coverage panel will update on next paint.', kind: 'ok' })
    } catch (err) {
      console.error('Save settings failed:', err)
      setStatus({ text: err instanceof Error ? err.message : 'Couldn’t save.', kind: 'error' })
    } finally {
      setSaving(false)
    }
  }

  function onReset() {
    setCpd('0.6')
    setSensitivity(DEFAULT_PRESET.value)
    setTopU('5')
    setTopO('3')
    setFns('LDT, HDT')
    setYards('UFP')
    setStatus({ text: 'Reverted to config defaults — click Save to persist.' })
  }

  return (
    <form className="settings-form" onSubmit={onSubmit}>
      <h2>Optimizer settings</h2>
      <p className="muted">
        These knobs drive the Coverage panel and day-view coverage strip.
        Saved values are shared across all dispatchers.
      </p>

      <fieldset className="settings-group">
        <legend>Thresholds</legend>
        <div className="settings-row">
          <label className="field">
            <span>Calls per driver per hour</span>
            <input type="number" step="0.1" min="0.1" max="10" value={cpd} onChange={e => setCpd(e.target.value)} />
            <small className="muted">How many calls one driver can handle per hour. Default 0.6.</small>
          </label>
        </div>
        <div className="settings-row">
          <label className="field">
            <span>Coverage sensitivity</span>
            <select value={sensitivity} onChange={e => setSensitivity(e.target.value)}>
              <option value="very-relaxed">Very relaxed</option>
              <option value="relaxed">Relaxed</option>
              <option value="balanced">Balanced (default)</option>
              <option value="aggressive">Aggressive</option>
              <option value="very-aggressive">Very aggressive — flag any imbalance</option>
            </select>
            <small className="muted">How readily Coverage flags hours as under- or overstaffed.</small>
          </label>
        </div>
        <div className="settings-row settings-row--two">
          <label className="field">
            <span>Top understaffed shown</span>
            <input type="number" step="1" min="0" max="50" value={topU} onChange={e => setTopU(e.target.value)} />
            <small className="muted">Items in the Coverage panel.</small>
          </label>
          <label className="field">
            <span>Top overstaffed shown</span>
            <input type="number" step="1" min="0" max="50" value={topO} onChange={e => setTopO(e.target.value)} />
            <small className="muted">Items in the Coverage panel.</small>
          </label>
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Supply scope</legend>
        <p className="muted">
          Comma-separated lists. Drivers must match a supply function and
          must NOT be in any excluded yard to count toward towing capacity.
        </p>
        <label className="field">
          <span>Supply functions</span>
          <input type="text" placeholder="LDT, HDT" value={fns} onChange={e => setFns(e.target.value)} />
          <small className="muted">Driver `function` values that count. Default: LDT, HDT.</small>
        </label>
        <label className="field">
          <span>Excluded yards</span>
          <input type="text" placeholder="UFP" value={yards} onChange={e => setYards(e.target.value)} />
          <small className="muted">Yards in `irh_yard_number` to skip. Default: UFP.</small>
        </label>
      </fieldset>

      <div className="settings-actions">
        <button type="button" className="sched-btn sched-btn--ghost" onClick={onReset}>Reset to defaults</button>
        <button type="submit" className="sched-btn sched-btn--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {status && (
          <span className={'settings-status' + (status.kind ? ' settings-status--' + status.kind : '')}>
            {status.text}
          </span>
        )}
      </div>
    </form>
  )
}

function AddDriverForm({ supabase, onAdded }: { supabase: SupabaseClient; onAdded: () => void }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [fn, setFn] = useState('')
  const [company, setCompany] = useState('Interstate')
  const [irhNum, setIrhNum] = useState('')
  const [irhYard, setIrhYard] = useState('')
  const [yard, setYard] = useState('')
  const [truck, setTruck] = useState('')
  const [yardOptions, setYardOptions] = useState<string[]>([])
  const [status, setStatus] = useState<{ text: string; kind?: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listDistinctYardNames(supabase)
      .then(setYardOptions)
      .catch(err => console.error("Couldn't load yards:", err))
  }, [supabase])

  function reset() {
    setFirstName(''); setLastName(''); setFn(''); setCompany('Interstate'); setIrhNum('')
    setIrhYard(''); setYard(''); setTruck('')
    setStatus(null)
  }

  const payload = useMemo(() => ({
    name: combineName(firstName, lastName),
    function: fn,
    Company: company.trim(),
    irh_driver_number: irhNum.trim(),
    irh_yard_number: irhYard.trim(),
    yard: yard.trim(),
    truck: truck.trim(),
    active: true,
  }), [firstName, lastName, fn, company, irhNum, irhYard, yard, truck])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus(null)
    for (const [k, v] of Object.entries(payload)) {
      if (k === 'active') continue
      if (!v) { setStatus({ text: `${k} is required.`, kind: 'error' }); return }
    }
    setBusy(true)
    setStatus({ text: 'Adding…' })
    try {
      const row = await insertDriver(supabase, payload)
      setStatus({ text: `Added ${formatName(row.name)} (#${row.irh_driver_number}).`, kind: 'ok' })
      reset()
      onAdded()
    } catch (err) {
      console.error('Insert driver failed:', err)
      setStatus({ text: err instanceof Error ? err.message : "Couldn’t insert.", kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="settings-form" onSubmit={onSubmit}>
      <h2>Add driver / dispatcher</h2>
      <p className="muted">
        Inserts a new row into the <code>drivers</code> table. All fields
        required. New rows start as active.
      </p>

      <fieldset className="settings-group">
        <legend>Identity</legend>
        <div className="settings-row settings-row--two">
          <label className="field">
            <span>First name</span>
            <input type="text" required autoComplete="off" value={firstName} onChange={e => setFirstName(e.target.value)} />
          </label>
          <label className="field">
            <span>Last name</span>
            <input type="text" required autoComplete="off" value={lastName} onChange={e => setLastName(e.target.value)} />
          </label>
        </div>
        <div className="settings-row settings-row--two">
          <label className="field">
            <span>Function</span>
            <select required value={fn} onChange={e => setFn(e.target.value)}>
              <option value="" disabled>Pick one…</option>
              {APP_CONFIG.driverCategories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Company</span>
            <input type="text" required value={company} onChange={e => setCompany(e.target.value)} />
          </label>
        </div>
        <div className="settings-row">
          <label className="field">
            <span>IRH driver number</span>
            <input type="text" required autoComplete="off" value={irhNum} onChange={e => setIrhNum(e.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Location &amp; equipment</legend>
        <div className="settings-row settings-row--two">
          <label className="field">
            <span>IRH yard number</span>
            <input
              type="text"
              required
              autoComplete="off"
              placeholder="1, 5, 6, UFP, Dispatch, …"
              value={irhYard}
              onChange={e => setIrhYard(e.target.value)}
            />
            <small className="muted">Supports comma-separated multi-yard, e.g. <code>1,6</code>.</small>
          </label>
          <label className="field">
            <span>Yard</span>
            <select required value={yard} onChange={e => setYard(e.target.value)}>
              <option value="" disabled>Pick one…</option>
              {yardOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>
        <div className="settings-row">
          <label className="field">
            <span>Truck</span>
            <input type="text" required autoComplete="off" value={truck} onChange={e => setTruck(e.target.value)} />
          </label>
        </div>
      </fieldset>

      <div className="settings-actions">
        <button type="button" className="sched-btn sched-btn--ghost" onClick={reset}>Clear</button>
        <button type="submit" className="sched-btn sched-btn--primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add to roster'}
        </button>
        {status && (
          <span className={'settings-status' + (status.kind ? ' settings-status--' + status.kind : '')}>
            {status.text}
          </span>
        )}
      </div>
    </form>
  )
}
