'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_CONFIG } from '../lib/config'
import type { Driver, ScheduleEntry } from '../lib/types'
import { deleteEntry, upsertEntry } from '../lib/db'
import { formatTime12, fromIsoDate } from '../lib/utils'

interface Props {
  supabase: SupabaseClient
  driver: Driver
  isoDate: string
  entry: ScheduleEntry | null
  userId: string | null
  onSaved: () => void
  onClose: () => void
}

const TIME_OPTIONS = (() => {
  const step = APP_CONFIG.timeStepMinutes
  const out: string[] = []
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += step) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return out
})()

export function ShiftModal({ supabase, driver, isoDate, entry, userId, onSaved, onClose }: Props) {
  const initialIsOff = entry?.entry_type === 'off'
  const [entryType, setEntryType] = useState<'shift' | 'off'>(initialIsOff ? 'off' : 'shift')
  const [start, setStart] = useState<string>((entry?.start_time?.slice(0, 5)) || '08:00')
  const [end, setEnd] = useState<string>((entry?.end_time?.slice(0, 5)) || '17:00')
  const [reason, setReason] = useState<string>(entry?.off_reason || 'PTO')
  const [notes, setNotes] = useState<string>(entry?.notes || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const startRef = useRef<HTMLSelectElement>(null)
  const reasonRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    setTimeout(() => {
      if (entryType === 'off') reasonRef.current?.focus()
      else startRef.current?.focus()
    }, 0)
  }, [entryType])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const overnight = entryType === 'shift' && end <= start

  const dateLabel = useMemo(() => {
    const d = fromIsoDate(isoDate)
    return d.toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
  }, [isoDate])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (entryType === 'shift' && start === end) {
      setError("Start and end times can't be the same.")
      return
    }

    setSaving(true)
    try {
      const draft = entryType === 'shift'
        ? {
            ...(entry?.id ? { id: entry.id } : {}),
            driver_id: driver.id,
            schedule_date: isoDate,
            entry_type: 'shift' as const,
            start_time: start,
            end_time: end,
            off_reason: null,
            notes: notes.trim() || null,
            created_by: userId,
          }
        : {
            ...(entry?.id ? { id: entry.id } : {}),
            driver_id: driver.id,
            schedule_date: isoDate,
            entry_type: 'off' as const,
            start_time: null,
            end_time: null,
            off_reason: reason,
            notes: notes.trim() || null,
            created_by: userId,
          }
      await upsertEntry(supabase, draft)
      onSaved()
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed.'
      setError(message)
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!entry?.id) return
    if (!confirm('Delete this entry?')) return
    setDeleting(true)
    try {
      await deleteEntry(supabase, entry.id)
      onSaved()
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delete failed.'
      setError(message)
      console.error(err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={onClose} />
      <form className="modal__panel" onSubmit={handleSave}>
        <header className="modal__header">
          <h2>{entry ? 'Edit entry' : 'Add entry'}</h2>
          <button type="button" className="sched-btn sched-btn--ghost modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal__body">
          <div className="modal__context">
            <strong>{driver.name}</strong>{' '}
            <span className="muted">
              #{driver.irh_driver_number || driver.id} · {driver.function || '—'}
            </span>
            <br />
            <span className="muted">{dateLabel}</span>
          </div>

          <div className="entry-type">
            <label>
              <input
                type="radio"
                name="entry-type"
                value="shift"
                checked={entryType === 'shift'}
                onChange={() => setEntryType('shift')}
              />
              <span>Shift</span>
            </label>
            <label>
              <input
                type="radio"
                name="entry-type"
                value="off"
                checked={entryType === 'off'}
                onChange={() => setEntryType('off')}
              />
              <span>Off / unavailable</span>
            </label>
          </div>

          {entryType === 'shift' && (
            <fieldset className="entry-fields">
              <div className="row-fields">
                <label className="field">
                  <span>Start</span>
                  <select ref={startRef} value={start} onChange={e => setStart(e.target.value)}>
                    {TIME_OPTIONS.map(t => (
                      <option key={t} value={t}>{formatTime12(t)}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>End</span>
                  <select value={end} onChange={e => setEnd(e.target.value)}>
                    {TIME_OPTIONS.map(t => (
                      <option key={t} value={t}>{formatTime12(t)}</option>
                    ))}
                  </select>
                </label>
              </div>
              {overnight && (
                <p className="muted hint">End is before start — shift crosses midnight into the next day.</p>
              )}
            </fieldset>
          )}

          {entryType === 'off' && (
            <fieldset className="entry-fields">
              <label className="field">
                <span>Reason</span>
                <select ref={reasonRef} value={reason} onChange={e => setReason(e.target.value)}>
                  {APP_CONFIG.offReasons.map(r => (
                    <option key={r} value={r}>{r === 'PTO' ? 'PTO' : r.charAt(0).toUpperCase() + r.slice(1)}</option>
                  ))}
                </select>
              </label>
            </fieldset>
          )}

          <label className="field">
            <span>Notes <span className="muted">(optional)</span></span>
            <textarea
              rows={2}
              placeholder="OT, training, anything to flag…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </label>

          {error && <div className="form-error">{error}</div>}
        </div>

        <footer className="modal__footer">
          {entry && (
            <button
              type="button"
              className="sched-btn sched-btn--danger"
              onClick={handleDelete}
              disabled={deleting || saving}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
          <div className="modal__footer-spacer" />
          <button type="button" className="sched-btn sched-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="sched-btn sched-btn--primary" disabled={saving || deleting}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>
    </div>
  )
}
