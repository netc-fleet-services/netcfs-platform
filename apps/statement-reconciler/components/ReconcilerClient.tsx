'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const VENDORS = [
  { key: 'advantage',     label: 'Advantage' },
  { key: 'arcsource',     label: 'ArcSource' },
  { key: 'brookline',     label: 'Brookline' },
  { key: 'castle',        label: 'Castle' },
  { key: 'cdk_global',    label: 'CDK Global' },
  { key: 'dennison',      label: 'Dennison' },
  { key: 'fleetpride',    label: 'FleetPride' },
  { key: 'keystone',      label: 'Keystone' },
  { key: 'kimball',       label: 'Kimball' },
  { key: 'kljack',        label: 'KL Jack' },
  { key: 'myers',         label: 'Myers' },
  { key: 'nationaltire',  label: 'National Tire' },
  { key: 'nekw',          label: 'NEKW' },
  { key: 'omni',          label: 'Omni' },
  { key: 'rctoolbox',     label: 'RC Toolbox' },
  { key: 'sullivan',      label: 'Sullivan' },
  { key: 'unitedpacific', label: 'United Pacific' },
  { key: 'whelen',        label: 'Whelen' },
  { key: 'wisupply',      label: 'WI Supply' },
  { key: 'zips',          label: 'Zips (OCR)' },
  { key: 'stmt_unknown',  label: 'Unknown Vendor' },
]

type JobStatus = 'pending' | 'running' | 'done' | 'error'

interface Job {
  id: string
  status: JobStatus
  vendor_key: string
  qb_file_count: number
  stmt_file_count: number
  matched_count: number | null
  mismatch_count: number | null
  stmt_total: number | null
  qb_total: number | null
  created_at: string
  error_message: string | null
  downloadUrl?: string | null
}

function fmt(n: number | null) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function StatusBadge({ status }: { status: JobStatus }) {
  const colors: Record<JobStatus, { bg: string; color: string }> = {
    pending: { bg: 'rgba(var(--on-surface-muted), 0.12)', color: 'rgb(var(--on-surface-muted))' },
    running: { bg: 'rgba(96, 165, 250, 0.15)', color: '#60a5fa' },
    done:    { bg: 'rgba(34, 197, 94, 0.15)',  color: '#22c55e' },
    error:   { bg: 'rgba(var(--error), 0.15)', color: 'rgb(var(--error))' },
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

export function ReconcilerClient() {
  const [vendor,    setVendor]    = useState(VENDORS[0].key)
  const [qbFiles,   setQbFiles]   = useState<FileList | null>(null)
  const [stmtFiles, setStmtFiles] = useState<FileList | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const [history, setHistory] = useState<Job[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs')
      if (res.ok) setHistory(await res.json())
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  // Poll active job until terminal state
  useEffect(() => {
    if (!activeJobId) return
    const poll = async () => {
      const res = await fetch(`/api/jobs/${activeJobId}`)
      if (!res.ok) return
      const job: Job = await res.json()
      setActiveJob(job)
      if (job.status === 'done' || job.status === 'error') {
        clearInterval(pollRef.current!)
        loadHistory()
      }
    }
    poll()
    pollRef.current = setInterval(poll, 4000)
    return () => clearInterval(pollRef.current!)
  }, [activeJobId, loadHistory])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!qbFiles?.length || !stmtFiles?.length) return
    setSubmitError('')
    setSubmitting(true)
    setActiveJob(null)

    const form = new FormData()
    form.set('vendor_key', vendor)
    for (const f of Array.from(qbFiles))   form.append('qb_files', f)
    for (const f of Array.from(stmtFiles)) form.append('stmt_files', f)

    try {
      const res = await fetch('/api/reconcile', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) { setSubmitError(data.error ?? 'Unknown error'); return }
      setActiveJobId(data.jobId)
    } catch (err) {
      setSubmitError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const vendorLabel = (key: string) => VENDORS.find(v => v.key === key)?.label ?? key

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.25rem' }}>

      {/* Submit form */}
      <div style={{
        background: 'rgb(var(--surface-container))',
        border: '1px solid rgb(var(--outline))',
        borderRadius: '0.875rem',
        padding: '1.5rem',
        marginBottom: '2rem',
      }}>
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.125rem', fontWeight: 700, color: 'rgb(var(--on-surface))' }}>
          New Reconciliation
        </h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="form-label" htmlFor="vendor">Vendor</label>
            <select
              id="vendor"
              className="form-input"
              value={vendor}
              onChange={e => setVendor(e.target.value)}
              style={{ cursor: 'pointer' }}
            >
              {VENDORS.map(v => (
                <option key={v.key} value={v.key}>{v.label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label className="form-label" htmlFor="qb-files">QuickBooks Export (.xlsx)</label>
              <input
                id="qb-files"
                type="file"
                className="form-input"
                accept=".xlsx,.xls"
                multiple
                onChange={e => setQbFiles(e.target.files)}
                style={{ padding: '0.4rem 0.75rem', cursor: 'pointer' }}
              />
              {qbFiles && <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))' }}>{qbFiles.length} file{qbFiles.length !== 1 ? 's' : ''} selected</p>}
            </div>

            <div>
              <label className="form-label" htmlFor="stmt-files">Vendor Statement (.pdf)</label>
              <input
                id="stmt-files"
                type="file"
                className="form-input"
                accept=".pdf"
                multiple
                onChange={e => setStmtFiles(e.target.files)}
                style={{ padding: '0.4rem 0.75rem', cursor: 'pointer' }}
              />
              {stmtFiles && <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))' }}>{stmtFiles.length} file{stmtFiles.length !== 1 ? 's' : ''} selected</p>}
            </div>
          </div>

          {submitError && (
            <div style={{
              padding: '0.75rem 1rem', borderRadius: '0.5rem',
              background: 'rgb(var(--error-container))', border: '1px solid rgb(var(--error))',
              color: 'rgb(var(--error))', fontSize: '0.875rem',
            }}>
              {submitError}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={submitting || !qbFiles?.length || !stmtFiles?.length}
            style={{ height: '2.75rem', alignSelf: 'flex-start', paddingLeft: '1.5rem', paddingRight: '1.5rem' }}
          >
            {submitting ? 'Submitting…' : 'Run Reconciliation'}
          </button>
        </form>
      </div>

      {/* Active job status */}
      {activeJob && (
        <div style={{
          background: 'rgb(var(--surface-container))',
          border: '1px solid rgb(var(--outline))',
          borderRadius: '0.875rem',
          padding: '1.5rem',
          marginBottom: '2rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'rgb(var(--on-surface))' }}>
              {vendorLabel(activeJob.vendor_key)}
            </h3>
            <StatusBadge status={activeJob.status} />
            {(activeJob.status === 'pending' || activeJob.status === 'running') && (
              <span style={{ fontSize: '0.8rem', color: 'rgb(var(--on-surface-muted))' }}>Checking every 4s…</span>
            )}
          </div>

          {activeJob.status === 'done' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1rem' }}>
              {[
                { label: 'Matched',      value: activeJob.matched_count },
                { label: 'Discrepancies', value: activeJob.mismatch_count },
                { label: 'Statement Total', value: fmt(activeJob.stmt_total) },
                { label: 'QB Total',       value: fmt(activeJob.qb_total) },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ fontSize: '0.7rem', color: 'rgb(var(--on-surface-muted))', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'rgb(var(--on-surface))' }}>{value ?? '—'}</div>
                </div>
              ))}
            </div>
          )}

          {activeJob.status === 'error' && activeJob.error_message && (
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'rgb(var(--error))' }}>{activeJob.error_message}</p>
          )}

          {activeJob.downloadUrl && (
            <a
              href={activeJob.downloadUrl}
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', height: '2.25rem', padding: '0 1rem', textDecoration: 'none', fontSize: '0.875rem' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download Excel
            </a>
          )}
        </div>
      )}

      {/* Job history */}
      <div style={{
        background: 'rgb(var(--surface-container))',
        border: '1px solid rgb(var(--outline))',
        borderRadius: '0.875rem',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid rgb(var(--outline))' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'rgb(var(--on-surface))' }}>Recent Jobs</h3>
        </div>

        {historyLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'rgb(var(--on-surface-muted))' }}>Loading…</div>
        ) : history.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'rgb(var(--on-surface-muted))' }}>No reconciliation jobs yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgb(var(--outline))' }}>
                  {['Vendor', 'Status', 'Matched', 'Discrepancies', 'Stmt Total', 'QB Total', 'Date', ''].map(h => (
                    <th key={h} style={{ padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, color: 'rgb(var(--on-surface-muted))', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(job => (
                  <HistoryRow key={job.id} job={job} vendorLabel={vendorLabel} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function HistoryRow({ job, vendorLabel }: { job: Job; vendorLabel: (k: string) => string }) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

  async function fetchDownload() {
    if (downloadUrl || job.status !== 'done') return
    const res = await fetch(`/api/jobs/${job.id}`)
    if (res.ok) {
      const data = await res.json()
      setDownloadUrl(data.downloadUrl ?? null)
    }
  }

  return (
    <tr
      style={{ borderBottom: '1px solid rgb(var(--outline))', transition: 'background 0.1s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--surface-high))'; fetchDownload() }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
    >
      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: 'rgb(var(--on-surface))' }}>{vendorLabel(job.vendor_key)}</td>
      <td style={{ padding: '0.75rem 1rem' }}><StatusBadge status={job.status} /></td>
      <td style={{ padding: '0.75rem 1rem', color: 'rgb(var(--on-surface))' }}>{job.matched_count ?? '—'}</td>
      <td style={{ padding: '0.75rem 1rem', color: job.mismatch_count ? 'rgb(var(--error))' : 'rgb(var(--on-surface))' }}>{job.mismatch_count ?? '—'}</td>
      <td style={{ padding: '0.75rem 1rem', color: 'rgb(var(--on-surface))' }}>{fmt(job.stmt_total)}</td>
      <td style={{ padding: '0.75rem 1rem', color: 'rgb(var(--on-surface))' }}>{fmt(job.qb_total)}</td>
      <td style={{ padding: '0.75rem 1rem', color: 'rgb(var(--on-surface-muted))', whiteSpace: 'nowrap' }}>
        {new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </td>
      <td style={{ padding: '0.75rem 1rem' }}>
        {downloadUrl ? (
          <a href={downloadUrl} style={{ color: 'rgb(var(--primary))', fontSize: '0.8rem', fontWeight: 600 }}>Download</a>
        ) : job.status === 'error' && job.error_message ? (
          <span style={{ color: 'rgb(var(--error))', fontSize: '0.75rem' }} title={job.error_message}>Error</span>
        ) : null}
      </td>
    </tr>
  )
}
