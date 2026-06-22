'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_CONFIG } from '../lib/config'
import type { Driver, ScheduleEntry } from '../lib/types'
import { deleteEntry, upsertEntry } from '../lib/db'
import { formatName, formatTime12, fromIsoDate } from '../lib/utils'

interface Props {
  supabase: SupabaseClient
  driver: Driver
  isoDate: string
  entry: ScheduleEntry | null
  userId: string | null
  onSaved: () => void
  onClose: () => void
}

interface ShiftBlock {
  key: string
  id?: string
  start: string
  end: string
  notes: string
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
  const [blocks, setBlocks] = useState<ShiftBlock[]>(() => {
    if (entry && entry.entry_type === 'shift') {
      return [{
        key: 'b0',
        id: entry.id,
        start: entry.start_time?.slice(0, 5) || '08:00',
        end: entry.end_time?.slice(0, 5) || '17:00',
        notes: entry.notes || '',
      }]
    }
    // If we're editing an existing entry that is currently "off" (e.g. PTO)
    // and the user switches it to a shift, reuse the existing row id so the
    // save updates that row in place instead of inserting a duplicate shift
    // alongside the lingering off entry.
    return [{ key: 'b0', ...(entry?.id ? { id: entry.id } : {}), start: '08:00', end: '17:00', notes: '' }]
  })
  const [reason, setReason] = useState<string>(entry?.off_reason || 'PTO')
  const [offNotes, setOffNotes] = useState<string>(initialIsOff ? (entry?.notes || '') : '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const blockCounter = useRef(1)
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

  const dateLabel = useMemo(() => {
    const d = fromIsoDate(isoDate)
    return d.toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
  }, [isoDate])

  function updateBlock(key: string, patch: Partial<ShiftBlock>) {
    setBlocks(prev => prev.map(b => (b.key === key ? { ...b, ...patch } : b)))
  }

  function addBlock() {
    // Default a new block to an evening-into-next-day shift to make
    // double / overnight shifts quick to enter.
    const key = `b${blockCounter.current++}`
    setBlocks(prev => [...prev, { key, start: '18:00', end: '02:00', notes: '' }])
  }

  function removeBlock(key: string) {
    setBlocks(prev => prev.filter(b => b.key !== key))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (entryType === 'shift') {
      if (blocks.some(b => b.start === b.end)) {
        setError("A shift's start and end times can't be the same.")
        return
      }
      setSaving(true)
      try {
        for (const b of blocks) {
          await upsertEntry(supabase, {
            ...(b.id ? { id: b.id } : {}),
            driver_id: driver.id,
            schedule_date: isoDate,
            entry_type: 'shift',
            start_time: b.start,
            end_time: b.end,
            off_reason: null,
            notes: b.notes.trim() || null,
            created_by: userId,
          })
        }
        onSaved()
        onClose()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Save failed.'
        setError(message)
        console.error(err)
      } finally {
        setSaving(false)
      }
      return
    }

    // entryType === 'off'
    setSaving(true)
    try {
      await upsertEntry(supabase, {
        ...(entry?.id ? { id: entry.id } : {}),
        driver_id: driver.id,
        schedule_date: isoDate,
        entry_type: 'off',
        start_time: null,
        end_time: null,
        off_reason: reason,
        notes: offNotes.trim() || null,
        created_by: userId,
      })
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
            <strong>{formatName(driver.name)}</strong>{' '}
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
            <>
              {blocks.map((b, i) => {
                const overnight = b.end <= b.start
                return (
                  <fieldset className="entry-fields shift-block" key={b.key}>
                    <div className="shift-block__head">
                      <span className="shift-block__title">
                        {blocks.length > 1 ? `Shift ${i + 1}` : 'Shift'}
                      </span>
                      {blocks.length > 1 && (
                        <button
                          type="button"
                          className="shift-block__remove"
                          onClick={() => removeBlock(b.key)}
                          aria-label="Remove this shift"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="row-fields">
                      <label className="field">
                        <span>Start</span>
                        <select
                          ref={i === 0 ? startRef : undefined}
                          value={b.start}
                          onChange={e => updateBlock(b.key, { start: e.target.value })}
                        >
                          {TIME_OPTIONS.map(t => (
                            <option key={t} value={t}>{formatTime12(t)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>End</span>
                        <select
                          value={b.end}
                          onChange={e => updateBlock(b.key, { end: e.target.value })}
                        >
                          {TIME_OPTIONS.map(t => (
                            <option key={t} value={t}>{formatTime12(t)}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {overnight && (
                      <p className="muted hint">End is before start — this shift ends the next day (+1d).</p>
                    )}
                    <label className="field">
                      <span>Notes <span className="muted">(optional)</span></span>
                      <textarea
                        rows={2}
                        placeholder="OT, training, anything to flag…"
                        value={b.notes}
                        onChange={e => updateBlock(b.key, { notes: e.target.value })}
                      />
                    </label>
                  </fieldset>
                )
              })}

              <button type="button" className="sched-btn sched-btn--ghost add-shift-btn" onClick={addBlock}>
                + Add another shift
              </button>
            </>
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
              <label className="field">
                <span>Notes <span className="muted">(optional)</span></span>
                <textarea
                  rows={2}
                  placeholder="Anything to flag…"
                  value={offNotes}
                  onChange={e => setOffNotes(e.target.value)}
                />
              </label>
            </fieldset>
          )}

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
