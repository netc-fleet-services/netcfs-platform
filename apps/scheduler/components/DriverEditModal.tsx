'use client'

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_CONFIG } from '../lib/config'
import type { Driver } from '../lib/types'
import { updateDriver } from '../lib/db'
import { combineName, splitName } from '../lib/utils'

interface Props {
  supabase: SupabaseClient
  driver: Driver
  onClose: () => void
  onSaved: (updated: Driver) => void
}

// Edit every field on a driver/dispatcher. Writes to the shared, roster-synced
// `drivers` table — identity fields can be re-overwritten by an IRH sync, hence
// the note in the form.
export function DriverEditModal({ supabase, driver, onClose, onSaved }: Props) {
  const initialName = splitName(driver.name)
  const [firstName, setFirstName] = useState(initialName.first)
  const [lastName, setLastName] = useState(initialName.last)
  const [fn, setFn] = useState(driver.function || '')
  const [company, setCompany] = useState(driver.Company || '')
  const [irhNum, setIrhNum] = useState(driver.irh_driver_number || '')
  const [irhYard, setIrhYard] = useState(driver.irh_yard_number || '')
  const [yard, setYard] = useState(driver.yard || '')
  const [truck, setTruck] = useState(driver.truck || '')
  const [active, setActive] = useState(driver.active !== false)
  const [inactiveReason, setInactiveReason] = useState(driver.inactive_reason || '')
  const [inactiveSince, setInactiveSince] = useState(driver.inactive_since || '')
  const [status, setStatus] = useState<{ text: string; kind?: 'ok' | 'error' } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus(null)
    if (!lastName.trim()) { setStatus({ text: 'Last name is required.', kind: 'error' }); return }
    if (!fn) { setStatus({ text: 'Function is required.', kind: 'error' }); return }

    const patch: Partial<Omit<Driver, 'id'>> = {
      name: combineName(firstName, lastName),
      function: fn,
      Company: company.trim() || null,
      irh_driver_number: irhNum.trim() || null,
      irh_yard_number: irhYard.trim() || null,
      yard: yard.trim() || null,
      truck: truck.trim() || null,
      active,
      inactive_reason: active ? null : (inactiveReason.trim() || null),
      inactive_since: active ? null : (inactiveSince || null),
    }

    setSaving(true)
    setStatus({ text: 'Saving…' })
    try {
      const row = await updateDriver(supabase, driver.id, patch)
      onSaved(row)
    } catch (err) {
      console.error('Update driver failed:', err)
      setStatus({ text: err instanceof Error ? err.message : 'Couldn’t save.', kind: 'error' })
      setSaving(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={onClose} />
      <form className="modal__panel" onSubmit={handleSave}>
        <header className="modal__header">
          <h2>Edit driver / dispatcher</h2>
          <button type="button" className="sched-btn sched-btn--ghost modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal__body">
          <p className="muted" style={{ margin: 0 }}>
            Heads up: name, driver&nbsp;#, company, yard and truck come from the
            IRH roster. A future roster sync may overwrite changes to those
            fields. Function, status and the hidden flag are scheduler-managed.
          </p>

          <fieldset className="settings-group">
            <legend>Identity</legend>
            <div className="settings-row settings-row--two">
              <label className="field">
                <span>First name</span>
                <input type="text" autoComplete="off" value={firstName} onChange={e => setFirstName(e.target.value)} />
              </label>
              <label className="field">
                <span>Last name</span>
                <input type="text" autoComplete="off" value={lastName} onChange={e => setLastName(e.target.value)} />
              </label>
            </div>
            <div className="settings-row settings-row--two">
              <label className="field">
                <span>Function</span>
                <select value={fn} onChange={e => setFn(e.target.value)}>
                  <option value="" disabled>Pick one…</option>
                  {APP_CONFIG.driverCategories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Company</span>
                <input type="text" value={company} onChange={e => setCompany(e.target.value)} />
              </label>
            </div>
            <div className="settings-row">
              <label className="field">
                <span>IRH driver number</span>
                <input type="text" autoComplete="off" value={irhNum} onChange={e => setIrhNum(e.target.value)} />
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
                  autoComplete="off"
                  placeholder="1, 5, 6, UFP, Dispatch, …"
                  value={irhYard}
                  onChange={e => setIrhYard(e.target.value)}
                />
                <small className="muted">Supports comma-separated multi-yard, e.g. <code>1,6</code>.</small>
              </label>
              <label className="field">
                <span>Yard</span>
                <input type="text" autoComplete="off" value={yard} onChange={e => setYard(e.target.value)} />
              </label>
            </div>
            <div className="settings-row">
              <label className="field">
                <span>Truck</span>
                <input type="text" autoComplete="off" value={truck} onChange={e => setTruck(e.target.value)} />
              </label>
            </div>
          </fieldset>

          <fieldset className="settings-group">
            <legend>Status</legend>
            <label className="toggle">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
              <span>Active in the scheduler</span>
            </label>
            {!active && (
              <div className="settings-row settings-row--two">
                <label className="field">
                  <span>Inactive reason</span>
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder="terminated / quit / transferred / other"
                    value={inactiveReason}
                    onChange={e => setInactiveReason(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Inactive since</span>
                  <input type="date" value={inactiveSince} onChange={e => setInactiveSince(e.target.value)} />
                </label>
              </div>
            )}
          </fieldset>
        </div>

        <footer className="modal__footer">
          {status && (
            <span className={'settings-status' + (status.kind ? ' settings-status--' + status.kind : '')}>
              {status.text}
            </span>
          )}
          <div className="modal__footer-spacer" />
          <button type="button" className="sched-btn sched-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="sched-btn sched-btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </form>
    </div>
  )
}
