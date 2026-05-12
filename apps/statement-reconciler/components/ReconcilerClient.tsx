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

interface FbDiscrepancy {
  invoice: string
  status: 'fullbay_only' | 'qb_only'
  shop: string | null
  fb_total: number | null
  qb_total: number | null
}

interface FbResultJson {
  summary: {
    total_fb: number
    total_qb: number
    in_both: number
    fullbay_only: number
    qb_only: number
    fb_total: number
    qb_total: number
    variance: number
  }
  discrepancies: FbDiscrepancy[]
}

interface FbJob {
  id: string
  status: JobStatus
  in_both_count: number | null
  fullbay_only_count: number | null
  qb_only_count: number | null
  fb_total: number | null
  qb_total: number | null
  variance: number | null
  result_json: FbResultJson | null
  error_message: string | null
  downloadUrl?: string | null
  created_at: string
}

function fmt(n: number | null | undefined) {
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
  const [activeTab, setActiveTab] = useState<'vendor-statements' | 'fb-reconcile'>('vendor-statements')

  // vendor-statements state
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

  const tabStyle = (tab: string): React.CSSProperties => ({
    padding: '0.625rem 1.25rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    border: 'none',
    borderBottom: activeTab === tab
      ? '2px solid rgb(var(--primary))'
      : '2px solid transparent',
    background: 'transparent',
    color: activeTab === tab ? 'rgb(var(--primary))' : 'rgb(var(--on-surface-muted))',
    cursor: 'pointer',
    transition: 'color 0.15s, border-color 0.15s',
  })

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.25rem' }}>

      {/* Tab navigation */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgb(var(--outline))', marginBottom: '2rem' }}>
        <button style={tabStyle('vendor-statements')} onClick={() => setActiveTab('vendor-statements')}>
          Vendor Statements
        </button>
        <button style={tabStyle('fb-reconcile')} onClick={() => setActiveTab('fb-reconcile')}>
          Fullbay / QuickBooks
        </button>
      </div>

      {/* ── Vendor Statements tab ── */}
      {activeTab === 'vendor-statements' && (
        <>
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
                  <DownloadIcon />
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
        </>
      )}

      {/* ── Fullbay / QuickBooks tab ── */}
      {activeTab === 'fb-reconcile' && <FbReconcileTab />}
    </div>
  )
}

// ── Fullbay / QuickBooks reconcile tab ─────────────────────────────────────

function FbReconcileTab() {
  const [fbFile,      setFbFile]      = useState<File | null>(null)
  const [qbFile,      setQbFile]      = useState<File | null>(null)
  const [submitting,  setSubmitting]  = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [activeJob,   setActiveJob]   = useState<FbJob | null>(null)
  const [history,     setHistory]     = useState<FbJob[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/fb-jobs')
      if (res.ok) setHistory(await res.json())
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  useEffect(() => {
    if (!activeJobId) return
    const poll = async () => {
      const res = await fetch(`/api/fb-jobs/${activeJobId}`)
      if (!res.ok) return
      const job: FbJob = await res.json()
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
    if (!fbFile || !qbFile) return
    setSubmitError('')
    setSubmitting(true)
    setActiveJob(null)

    const form = new FormData()
    form.set('fb_file', fbFile)
    form.set('qb_file', qbFile)

    try {
      const res = await fetch('/api/fb-reconcile', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) { setSubmitError(data.error ?? 'Unknown error'); return }
      setActiveJobId(data.jobId)
    } catch (err) {
      setSubmitError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const summary = activeJob?.result_json?.summary
  const discrepancies = activeJob?.result_json?.discrepancies ?? []

  return (
    <>
      {/* Instructions */}
      <div style={{
        background: 'rgba(96, 165, 250, 0.08)',
        border: '1px solid rgba(96, 165, 250, 0.25)',
        borderRadius: '0.875rem',
        padding: '1.25rem 1.5rem',
        marginBottom: '1.5rem',
        fontSize: '0.875rem',
        color: 'rgb(var(--on-surface))',
        lineHeight: 1.6,
      }}>
        <div style={{ fontWeight: 700, marginBottom: '0.75rem', color: 'rgb(var(--on-surface))' }}>How to export the required files</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '0.35rem', color: '#60a5fa' }}>Fullbay CSV</div>
            <ol style={{ margin: 0, paddingLeft: '1.25rem', color: 'rgb(var(--on-surface-muted))' }}>
              <li>In Fullbay, go to <strong>Reports → Invoice Report</strong></li>
              <li>Set the date range you want to reconcile</li>
              <li>Click <strong>Export → CSV</strong></li>
            </ol>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '0.35rem', color: '#60a5fa' }}>QuickBooks Excel</div>
            <ol style={{ margin: 0, paddingLeft: '1.25rem', color: 'rgb(var(--on-surface-muted))' }}>
              <li>In QuickBooks, go to <strong>Reports → Transaction List by Date</strong></li>
              <li>Filter: Type = <em>Invoice</em>, same date range</li>
              <li>Click <strong>Export → Export to Excel</strong></li>
            </ol>
          </div>
        </div>
        <div style={{ marginTop: '0.875rem', padding: '0.625rem 0.875rem', borderRadius: '0.5rem', background: 'rgba(96, 165, 250, 0.08)', color: 'rgb(var(--on-surface-muted))', fontSize: '0.8rem' }}>
          <strong>Output:</strong> Three categories — invoices in both sources (with any amount variance), invoices only in Fullbay (missing from QB), and invoices only in QuickBooks (missing from Fullbay). Includes totals and a downloadable Excel workbook with full detail.
        </div>
      </div>

      {/* Upload form */}
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label className="form-label" htmlFor="fb-file">Fullbay Invoice Report (.csv)</label>
              <input
                id="fb-file"
                type="file"
                className="form-input"
                accept=".csv"
                onChange={e => setFbFile(e.target.files?.[0] ?? null)}
                style={{ padding: '0.4rem 0.75rem', cursor: 'pointer' }}
              />
              {fbFile && <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))' }}>{fbFile.name}</p>}
            </div>

            <div>
              <label className="form-label" htmlFor="qb-fb-file">QuickBooks Transaction Export (.xlsx)</label>
              <input
                id="qb-fb-file"
                type="file"
                className="form-input"
                accept=".xlsx,.xls"
                onChange={e => setQbFile(e.target.files?.[0] ?? null)}
                style={{ padding: '0.4rem 0.75rem', cursor: 'pointer' }}
              />
              {qbFile && <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))' }}>{qbFile.name}</p>}
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
            disabled={submitting || !fbFile || !qbFile}
            style={{ height: '2.75rem', alignSelf: 'flex-start', paddingLeft: '1.5rem', paddingRight: '1.5rem' }}
          >
            {submitting ? 'Submitting…' : 'Run Reconciliation'}
          </button>
        </form>
      </div>

      {/* Active job results */}
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
              Fullbay / QuickBooks Reconciliation
            </h3>
            <StatusBadge status={activeJob.status} />
            {(activeJob.status === 'pending' || activeJob.status === 'running') && (
              <span style={{ fontSize: '0.8rem', color: 'rgb(var(--on-surface-muted))' }}>Checking every 4s…</span>
            )}
          </div>

          {activeJob.status === 'done' && summary && (
            <>
              {/* Summary stats */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: '1rem',
                marginBottom: '1.5rem',
              }}>
                {[
                  { label: 'In Both',        value: summary.in_both,       color: '#22c55e' },
                  { label: 'Fullbay Only',   value: summary.fullbay_only,  color: 'rgb(var(--error))' },
                  { label: 'QB Only',        value: summary.qb_only,       color: 'rgb(var(--error))' },
                  { label: 'Fullbay Total',  value: fmt(summary.fb_total), color: 'rgb(var(--on-surface))' },
                  { label: 'QB Total',       value: fmt(summary.qb_total), color: 'rgb(var(--on-surface))' },
                  { label: 'Variance',       value: fmt(summary.variance), color: summary.variance !== 0 ? 'rgb(var(--error))' : '#22c55e' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{
                    background: 'rgb(var(--surface-high))',
                    borderRadius: '0.625rem',
                    padding: '0.875rem',
                  }}>
                    <div style={{ fontSize: '0.7rem', color: 'rgb(var(--on-surface-muted))', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Download button */}
              {activeJob.downloadUrl && (
                <a
                  href={activeJob.downloadUrl}
                  className="btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', height: '2.25rem', padding: '0 1rem', textDecoration: 'none', fontSize: '0.875rem', marginBottom: discrepancies.length ? '1.5rem' : 0 }}
                >
                  <DownloadIcon />
                  Download Excel Workbook
                </a>
              )}

              {/* Discrepancies table */}
              {discrepancies.length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'rgb(var(--on-surface))', marginBottom: '0.75rem' }}>
                    Discrepancies ({discrepancies.length}{discrepancies.length === 200 ? '+' : ''})
                  </div>
                  <div style={{ overflowX: 'auto', borderRadius: '0.625rem', border: '1px solid rgb(var(--outline))' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                      <thead>
                        <tr style={{ background: 'rgb(var(--surface-high))', borderBottom: '1px solid rgb(var(--outline))' }}>
                          {['Invoice #', 'Source', 'Shop / Class', 'Fullbay Total', 'QB Total'].map(h => (
                            <th key={h} style={{ padding: '0.5rem 0.875rem', textAlign: 'left', fontWeight: 600, color: 'rgb(var(--on-surface-muted))', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {discrepancies.map((d, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid rgb(var(--outline))' }}>
                            <td style={{ padding: '0.5rem 0.875rem', fontWeight: 600, color: 'rgb(var(--on-surface))', fontFamily: 'monospace' }}>{d.invoice}</td>
                            <td style={{ padding: '0.5rem 0.875rem' }}>
                              <span style={{
                                display: 'inline-block', padding: '0.15rem 0.5rem',
                                borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600,
                                background: d.status === 'fullbay_only' ? 'rgba(251, 146, 60, 0.15)' : 'rgba(167, 139, 250, 0.15)',
                                color: d.status === 'fullbay_only' ? '#fb923c' : '#a78bfa',
                              }}>
                                {d.status === 'fullbay_only' ? 'Fullbay only' : 'QB only'}
                              </span>
                            </td>
                            <td style={{ padding: '0.5rem 0.875rem', color: 'rgb(var(--on-surface-muted))' }}>{d.shop ?? '—'}</td>
                            <td style={{ padding: '0.5rem 0.875rem', color: d.fb_total != null ? 'rgb(var(--on-surface))' : 'rgb(var(--on-surface-muted))' }}>
                              {d.fb_total != null ? fmt(d.fb_total) : '—'}
                            </td>
                            <td style={{ padding: '0.5rem 0.875rem', color: d.qb_total != null ? 'rgb(var(--on-surface))' : 'rgb(var(--on-surface-muted))' }}>
                              {d.qb_total != null ? fmt(d.qb_total) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {discrepancies.length === 200 && (
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'rgb(var(--on-surface-muted))' }}>
                      Showing first 200 discrepancies. Download the Excel workbook for the full list.
                    </p>
                  )}
                </div>
              )}

              {discrepancies.length === 0 && (
                <div style={{ padding: '1rem', borderRadius: '0.625rem', background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.2)', color: '#22c55e', fontSize: '0.875rem', fontWeight: 600 }}>
                  No discrepancies found — all invoices match between Fullbay and QuickBooks.
                </div>
              )}
            </>
          )}

          {activeJob.status === 'error' && activeJob.error_message && (
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'rgb(var(--error))' }}>{activeJob.error_message}</p>
          )}
        </div>
      )}

      {/* FB job history */}
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
                  {['Status', 'In Both', 'FB Only', 'QB Only', 'FB Total', 'QB Total', 'Variance', 'Date', ''].map(h => (
                    <th key={h} style={{ padding: '0.625rem 1rem', textAlign: 'left', fontWeight: 600, color: 'rgb(var(--on-surface-muted))', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(job => (
                  <FbHistoryRow key={job.id} job={job} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

// ── Vendor statement history row ────────────────────────────────────────────

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

// ── FB reconcile history row ────────────────────────────────────────────────

function FbHistoryRow({ job }: { job: FbJob }) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

  async function fetchDownload() {
    if (downloadUrl || job.status !== 'done') return
    const res = await fetch(`/api/fb-jobs/${job.id}`)
    if (res.ok) {
      const data = await res.json()
      setDownloadUrl(data.downloadUrl ?? null)
    }
  }

  const hasIssue = (job.fullbay_only_count ?? 0) > 0 || (job.qb_only_count ?? 0) > 0

  return (
    <tr
      style={{ borderBottom: '1px solid rgb(var(--outline))', transition: 'background 0.1s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--surface-high))'; fetchDownload() }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
    >
      <td style={{ padding: '0.75rem 1rem' }}><StatusBadge status={job.status} /></td>
      <td style={{ padding: '0.75rem 1rem', color: 'rgb(var(--on-surface))' }}>{job.in_both_count ?? '—'}</td>
      <td style={{ padding: '0.75rem 1rem', color: (job.fullbay_only_count ?? 0) > 0 ? 'rgb(var(--error))' : 'rgb(var(--on-surface))' }}>{job.fullbay_only_count ?? '—'}</td>
      <td style={{ padding: '0.75rem 1rem', color: (job.qb_only_count ?? 0) > 0 ? 'rgb(var(--error))' : 'rgb(var(--on-surface))' }}>{job.qb_only_count ?? '—'}</td>
      <td style={{ padding: '0.75rem 1rem', color: 'rgb(var(--on-surface))' }}>{fmt(job.fb_total)}</td>
      <td style={{ padding: '0.75rem 1rem', color: 'rgb(var(--on-surface))' }}>{fmt(job.qb_total)}</td>
      <td style={{ padding: '0.75rem 1rem', color: hasIssue ? 'rgb(var(--error))' : '#22c55e', fontWeight: 600 }}>{fmt(job.variance)}</td>
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
