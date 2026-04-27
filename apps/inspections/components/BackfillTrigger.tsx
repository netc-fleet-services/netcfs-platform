'use client'

import { useState } from 'react'

const ACTIONS_URL = 'https://github.com/netc-fleet-services/netcfs-platform/actions/workflows/backfill-samsara.yml'

function currentQuarterStart(): string {
  const now = new Date()
  const m = now.getMonth() + 1
  const y = now.getFullYear()
  const qm = m <= 3 ? 1 : m <= 6 ? 4 : m <= 9 ? 7 : 10
  return `${y}-${String(qm).padStart(2, '0')}-01`
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

type Status = 'idle' | 'loading' | 'success' | 'error'

export function BackfillTrigger() {
  const [start,   setStart]   = useState(currentQuarterStart)
  const [end,     setEnd]     = useState(todayStr)
  const [status,  setStatus]  = useState<Status>('idle')
  const [message, setMessage] = useState('')

  async function handleRun() {
    setStatus('loading')
    setMessage('')
    try {
      const res = await fetch('/api/trigger-backfill', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ start, end }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus('error')
        setMessage(data.error || 'An unknown error occurred.')
      } else {
        setStatus('success')
        setMessage('Workflow queued — it will appear in GitHub Actions within a few seconds.')
      }
    } catch {
      setStatus('error')
      setMessage('Network error — could not reach the server.')
    }
  }

  const isLoading = status === 'loading'

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: 'rgb(var(--on-surface-muted))',
    marginBottom: '0.375rem',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    fontSize: '0.9rem',
    background: 'rgb(var(--surface))',
    border: '1px solid rgb(var(--outline))',
    borderRadius: '0.5rem',
    color: 'rgb(var(--on-surface))',
    outline: 'none',
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <p style={{ margin: '0 0 1.5rem', color: 'rgb(var(--on-surface-muted))', fontSize: '0.9rem', lineHeight: 1.6 }}>
        Pulls safety events, mileage, and DVIR records from Samsara and TowBook for the selected
        date range and writes them into Supabase. Run this before scoring a new period.
      </p>

      {/* Date inputs */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={labelStyle}>Start date</label>
          <input
            type="date"
            value={start}
            max={end}
            onChange={e => setStart(e.target.value)}
            disabled={isLoading}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={labelStyle}>End date</label>
          <input
            type="date"
            value={end}
            min={start}
            max={todayStr()}
            onChange={e => setEnd(e.target.value)}
            disabled={isLoading}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Trigger button */}
      <button
        onClick={handleRun}
        disabled={isLoading || !start || !end}
        style={{
          padding: '0.625rem 1.5rem',
          fontSize: '0.875rem',
          fontWeight: 700,
          background: isLoading ? 'rgb(var(--outline))' : 'rgb(var(--primary))',
          color: isLoading ? 'rgb(var(--on-surface-muted))' : 'rgb(var(--on-primary))',
          border: 'none',
          borderRadius: '0.5rem',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        {isLoading && (
          <span style={{
            width: 14, height: 14, borderRadius: '50%',
            border: '2px solid rgb(var(--on-surface-muted))',
            borderTopColor: 'transparent',
            display: 'inline-block',
            animation: 'spin 0.7s linear infinite',
          }} />
        )}
        {isLoading ? 'Triggering…' : 'Run Backfill'}
      </button>

      {/* Status feedback */}
      {status === 'success' && (
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem 1rem',
          background: 'color-mix(in srgb, rgb(var(--primary)) 10%, transparent)',
          border: '1px solid color-mix(in srgb, rgb(var(--primary)) 30%, transparent)',
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          color: 'rgb(var(--on-surface))',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.5rem',
        }}>
          <span style={{ color: 'rgb(var(--primary))', fontWeight: 700, flexShrink: 0 }}>✓</span>
          <span>
            {message}{' '}
            <a
              href={ACTIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'rgb(var(--primary))', fontWeight: 600 }}
            >
              View in GitHub Actions →
            </a>
          </span>
        </div>
      )}

      {status === 'error' && (
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem 1rem',
          background: 'color-mix(in srgb, #ef4444 10%, transparent)',
          border: '1px solid color-mix(in srgb, #ef4444 30%, transparent)',
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          color: 'rgb(var(--on-surface))',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.5rem',
        }}>
          <span style={{ color: '#ef4444', fontWeight: 700, flexShrink: 0 }}>✗</span>
          <span>{message}</span>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
