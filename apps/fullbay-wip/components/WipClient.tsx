'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type RunStatus = 'pending' | 'running' | 'done' | 'error'

interface ShopRow {
  shop: string
  total_cost: number
}

interface WipResultJson {
  week_label: string
  total_so_count: number
  grand_total: number
  shops: ShopRow[]
}

interface WipRun {
  id: string
  status: RunStatus
  week_label: string | null
  summary_file_path: string | null
  detail_file_path:  string | null
  result_json: WipResultJson | null
  error_message: string | null
  summaryUrl?: string | null
  detailUrl?:  string | null
  created_at: string
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function StatusBadge({ status }: { status: RunStatus }) {
  const colors: Record<RunStatus, { bg: string; color: string }> = {
    pending: { bg: 'rgba(var(--on-surface-muted), 0.12)', color: 'rgb(var(--on-surface-muted))' },
    running: { bg: 'rgba(96, 165, 250, 0.15)',           color: '#60a5fa' },
    done:    { bg: 'rgba(34, 197, 94, 0.15)',             color: '#22c55e' },
    error:   { bg: 'rgba(var(--error), 0.15)',            color: 'rgb(var(--error))' },
  }
  const s = colors[status] ?? colors.pending
  return (
    <span style={{
      display: 'inline-block', padding: '0.2rem 0.6rem',
      borderRadius: 9999, fontSize: '0.75rem', fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      {status}
    </span>
  )
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

export function WipClient() {
  const [triggering, setTriggering] = useState(false)
  const [triggerError, setTriggerError] = useState('')
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [activeRun, setActiveRun] = useState<WipRun | null>(null)
  const [history, setHistory] = useState<WipRun[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/wip-runs')
      if (res.ok) setHistory(await res.json())
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  useEffect(() => {
    if (!activeRunId) return
    const poll = async () => {
      const res = await fetch(`/api/wip-runs/${activeRunId}`)
      if (!res.ok) return
      const run: WipRun = await res.json()
      setActiveRun(run)
      if (run.status === 'done' || run.status === 'error') {
        clearInterval(pollRef.current!)
        loadHistory()
      }
    }
    poll()
    pollRef.current = setInterval(poll, 4000)
    return () => clearInterval(pollRef.current!)
  }, [activeRunId, loadHistory])

  async function handleRunNow() {
    setTriggerError('')
    setTriggering(true)
    setActiveRun(null)
    try {
      const res = await fetch('/api/wip-trigger', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setTriggerError(data.error ?? 'Unknown error'); return }
      setActiveRunId(data.runId)
    } catch (err) {
      setTriggerError(String(err))
    } finally {
      setTriggering(false)
    }
  }

  const result = activeRun?.result_json

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.25rem' }}>

      {/* Run Now card */}
      <div style={{
        background: 'rgb(var(--surface-container))',
        border: '1px solid rgb(var(--outline))',
        borderRadius: '0.875rem',
        padding: '1.5rem',
        marginBottom: '2rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: '0 0 0.375rem', fontSize: '1.125rem', fontWeight: 700, color: 'rgb(var(--on-surface))' }}>
              Fullbay WIP Report
            </h2>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'rgb(var(--on-surface-muted))', maxWidth: 540 }}>
              Pulls the current Work In Progress snapshot from Fullbay and analyzes all service orders open during the previous week (Mon–Sun). Runs automatically every Monday morning; use the button to trigger a manual run.
            </p>
          </div>
          <button
            className="btn-primary"
            onClick={handleRunNow}
            disabled={triggering || activeRun?.status === 'pending' || activeRun?.status === 'running'}
            style={{ height: '2.75rem', paddingLeft: '1.5rem', paddingRight: '1.5rem', flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            {triggering ? 'Triggering…' : 'Run Now'}
          </button>
        </div>

        {triggerError && (
          <div style={{
            marginTop: '1rem', padding: '0.75rem 1rem', borderRadius: '0.5rem',
            background: 'rgb(var(--error-container))', border: '1px solid rgb(var(--error))',
            color: 'rgb(var(--error))', fontSize: '0.875rem',
          }}>
            {triggerError}
          </div>
        )}
      </div>

      {/* Active run results */}
      {activeRun && (
        <div style={{
          background: 'rgb(var(--surface-container))',
          border: '1px solid rgb(var(--outline))',
          borderRadius: '0.875rem',
          padding: '1.5rem',
          marginBottom: '2rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'rgb(var(--on-surface))' }}>
              {result?.week_label ?? activeRun.week_label ?? 'WIP Run'}
            </h3>
            <StatusBadge status={activeRun.status} />
            {(activeRun.status === 'pending' || activeRun.status === 'running') && (
              <span style={{ fontSize: '0.8rem', color: 'rgb(var(--on-surface-muted))' }}>Checking every 4s…</span>
            )}
          </div>

          {activeRun.status === 'done' && result && (
            <>
              {/* Stats row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                  { label: 'Service Orders', value: result.total_so_count },
                  { label: 'Grand Total',    value: fmt(result.grand_total) },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: 'rgb(var(--surface-high))', borderRadius: '0.625rem', padding: '0.875rem 1.25rem', minWidth: 140 }}>
                    <div style={{ fontSize: '0.7rem', color: 'rgb(var(--on-surface-muted))', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'rgb(var(--on-surface))' }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Shop summary table */}
              {result.shops.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'rgb(var(--on-surface))', marginBottom: '0.75rem' }}>
                    Summary by Shop
                  </div>
                  <div style={{ borderRadius: '0.625rem', border: '1px solid rgb(var(--outline))', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                      <thead>
                        <tr style={{ background: 'rgb(var(--surface-high))', borderBottom: '1px solid rgb(var(--outline))' }}>
                          <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontWeight: 600, color: 'rgb(var(--on-surface-muted))' }}>Shop</th>
                          <th style={{ padding: '0.5rem 1rem', textAlign: 'right', fontWeight: 600, color: 'rgb(var(--on-surface-muted))' }}>Total Cost of Parts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.shops.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid rgb(var(--outline))' }}>
                            <td style={{ padding: '0.6rem 1rem', color: 'rgb(var(--on-surface))' }}>{row.shop}</td>
                            <td style={{ padding: '0.6rem 1rem', textAlign: 'right', color: 'rgb(var(--on-surface))', fontVariantNumeric: 'tabular-nums' }}>{fmt(row.total_cost)}</td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: '2px solid rgb(var(--outline))', background: 'rgb(var(--surface-high))' }}>
                          <td style={{ padding: '0.6rem 1rem', fontWeight: 700, color: 'rgb(var(--on-surface))' }}>Grand Total</td>
                          <td style={{ padding: '0.6rem 1rem', textAlign: 'right', fontWeight: 700, color: 'rgb(var(--on-surface))', fontVariantNumeric: 'tabular-nums' }}>{fmt(result.grand_total)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Downloads */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {activeRun.summaryUrl && (
                  <a
                    href={activeRun.summaryUrl}
                    className="btn-primary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', height: '2.25rem', padding: '0 1rem', textDecoration: 'none', fontSize: '0.875rem' }}
                  >
                    <DownloadIcon />
                    Download Summary CSV
                  </a>
                )}
                {activeRun.detailUrl && (
                  <a
                    href={activeRun.detailUrl}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', height: '2.25rem', padding: '0 1rem', textDecoration: 'none', fontSize: '0.875rem', borderRadius: '0.5rem', border: '1px solid rgb(var(--outline))', color: 'rgb(var(--on-surface))', background: 'rgb(var(--surface-high))' }}
                  >
                    <DownloadIcon />
                    Download Detail CSV
                  </a>
                )}
              </div>
            </>
          )}

          {activeRun.status === 'error' && activeRun.error_message && (
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'rgb(var(--error))' }}>{activeRun.error_message}</p>
          )}
        </div>
      )}

      {/* Run history */}
      <div style={{
        background: 'rgb(var(--surface-container))',
        border: '1px solid rgb(var(--outline))',
        borderRadius: '0.875rem',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid rgb(var(--outline))' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'rgb(var(--on-surface))' }}>Recent Runs</h3>
        </div>

        {historyLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'rgb(var(--on-surface-muted))' }}>Loading…</div>
        ) : history.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'rgb(var(--on-surface-muted))' }}>No WIP runs yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgb(var(--outline))' }}>
                  {['Week', 'Status', 'SOs', 'Grand Total', 'Date', ''].map(h => (
                    <th key={h} style={{ padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, color: 'rgb(var(--on-surface-muted))', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(run => (
                  <HistoryRow key={run.id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function HistoryRow({ run }: { run: WipRun }) {
  const [summaryUrl, setSummaryUrl] = useState<string | null>(null)
  const [detailUrl,  setDetailUrl]  = useState<string | null>(null)

  async function fetchUrls() {
    if (summaryUrl || run.status !== 'done') return
    const res = await fetch(`/api/wip-runs/${run.id}`)
    if (res.ok) {
      const data = await res.json()
      setSummaryUrl(data.summaryUrl ?? null)
      setDetailUrl(data.detailUrl ?? null)
    }
  }

  const result = run.result_json

  return (
    <tr
      style={{ borderBottom: '1px solid rgb(var(--outline))', transition: 'background 0.1s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--surface-high))'; fetchUrls() }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
    >
      <td style={{ padding: '0.75rem 1rem', color: 'rgb(var(--on-surface))' }}>{run.week_label ?? '—'}</td>
      <td style={{ padding: '0.75rem 1rem' }}><StatusBadge status={run.status} /></td>
      <td style={{ padding: '0.75rem 1rem', color: 'rgb(var(--on-surface))' }}>{result?.total_so_count ?? '—'}</td>
      <td style={{ padding: '0.75rem 1rem', color: 'rgb(var(--on-surface))', fontVariantNumeric: 'tabular-nums' }}>{fmt(result?.grand_total)}</td>
      <td style={{ padding: '0.75rem 1rem', color: 'rgb(var(--on-surface-muted))', whiteSpace: 'nowrap' }}>
        {new Date(run.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </td>
      <td style={{ padding: '0.75rem 1rem' }}>
        {summaryUrl ? (
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <a href={summaryUrl} style={{ color: 'rgb(var(--primary))', fontSize: '0.8rem', fontWeight: 600 }}>Summary</a>
            {detailUrl && <a href={detailUrl} style={{ color: 'rgb(var(--primary))', fontSize: '0.8rem', fontWeight: 600 }}>Detail</a>}
          </div>
        ) : run.status === 'error' && run.error_message ? (
          <span style={{ color: 'rgb(var(--error))', fontSize: '0.75rem' }} title={run.error_message}>Error</span>
        ) : null}
      </td>
    </tr>
  )
}
