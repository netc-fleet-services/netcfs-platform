'use client'
import { useMemo, useState } from 'react'
import { C, cB, bP, bSt } from '../lib/config'
import { fH, fT, isoD, jobTotal } from '../lib/utils'
import { JobDetailModal } from './JobDetailModal'
import type { Job, Driver } from '../lib/types'

interface Props {
  jobs: Job[]
  drivers: Driver[]
}

export function HistoryTab({ jobs, drivers }: Props) {
  const [histDay,   setHistDay]   = useState<string | null>(null)
  const [detailJob, setDetailJob] = useState<Job | null>(null)

  const pastDays = useMemo(() => {
    const days: string[] = []
    for (let i = 1; i <= 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      days.push(isoD(d))
    }
    return days
  }, [])

  const selectedDay = histDay || pastDays[0]
  const dayJobs = jobs.filter(j => j.day === selectedDay && j.status !== 'cancelled')

  const driverName = (id: number | null | undefined) => drivers.find(d => d.id === id)?.name || 'Unassigned'

  const actualH = (job: Job) => {
    if (!job.startedAt || !job.completedAt) return null
    return (new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 3600000
  }

  const downloadCSV = () => {
    const rows = [
      ['Date', 'Call#', 'Account', 'Description', 'Driver', 'Reason', 'Pickup', 'Drop', 'Est Hours', 'Actual Hours', 'Started', 'Completed', 'Status']
    ]
    for (const j of dayJobs) {
      const est = jobTotal(j)
      const act = actualH(j)
      rows.push([
        j.day,
        j.tbCallNum || '',
        j.tbAccount || '',
        j.tbDesc    || '',
        driverName(j.driverId),
        j.tbReason  || '',
        j.pickupAddr || '',
        j.dropAddr   || '',
        isFinite(est) ? est.toFixed(2) : '',
        act != null  ? act.toFixed(2)  : '',
        j.startedAt   ? new Date(j.startedAt).toLocaleString()   : '',
        j.completedAt ? new Date(j.completedAt).toLocaleString() : '',
        j.status,
      ])
    }
    const csv  = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'jobs-' + selectedDay + '.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const complete   = dayJobs.filter(j => j.status === 'complete')
  const incomplete = dayJobs.filter(j => j.status !== 'complete')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Job History</div>
        {dayJobs.length > 0 && <button style={{ ...bP, background: C.gn, fontSize: 10 }} onClick={downloadCSV}>⬇ Download CSV</button>}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {pastDays.map(d => (
          <button key={d} style={{ ...bSt, ...(selectedDay === d ? { color: C.ac, borderColor: C.ac } : {}) }} onClick={() => setHistDay(d)}>
            {new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </button>
        ))}
      </div>

      {dayJobs.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <div style={{ ...cB, flex: 1, textAlign: 'center', padding: '8px 4px' }}>
            <div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase', marginBottom: 2 }}>Total Jobs</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.ac }}>{dayJobs.length}</div>
          </div>
          <div style={{ ...cB, flex: 1, textAlign: 'center', padding: '8px 4px' }}>
            <div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase', marginBottom: 2 }}>Completed</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.gn }}>{complete.length}</div>
          </div>
          <div style={{ ...cB, flex: 1, textAlign: 'center', padding: '8px 4px' }}>
            <div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase', marginBottom: 2 }}>Est Hours</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.am }}>{fH(dayJobs.reduce((s, j) => { const t = jobTotal(j); return s + (isFinite(t) ? t : 0) }, 0))}</div>
          </div>
          <div style={{ ...cB, flex: 1, textAlign: 'center', padding: '8px 4px' }}>
            <div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase', marginBottom: 2 }}>Actual Hours</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.pu }}>{fH(complete.reduce((s, j) => { const a = actualH(j); return s + (a != null ? a : 0) }, 0))}</div>
          </div>
        </div>
      )}

      {complete.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 700, color: C.gn, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Completed ({complete.length})</div>
          {complete.map(j => {
            const est  = jobTotal(j)
            const act  = actualH(j)
            const diff = (act != null && isFinite(est)) ? act - est : null
            return (
              <div key={j.id} style={{ ...cB, padding: '10px 12px', marginBottom: 5, cursor: 'pointer' }} onClick={() => setDetailJob(j)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <div>
                    {j.tbCallNum && <span style={{ fontSize: 14, fontWeight: 800, color: C.pu, marginRight: 8 }}>{j.tbCallNum}</span>}
                    {j.tbAccount && <span style={{ fontSize: 12, fontWeight: 600, color: C.ac, marginRight: 6 }}>{j.tbAccount}</span>}
                    {j.tbDesc    && <span style={{ fontSize: 11, color: C.dm }}>{j.tbDesc}</span>}
                  </div>
                  <span style={{ fontSize: 11, color: C.dm }}>{driverName(j.driverId)}</span>
                </div>
                <div style={{ fontSize: 11, color: C.tx, marginBottom: 6 }}>{j.pickupAddr || j.pickupZip || '?'} → {j.dropAddr || j.dropZip || '?'}</div>
                <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
                  <span style={{ color: C.dm }}>Est: <strong style={{ color: C.am }}>{isFinite(est) ? fH(est) : '--'}</strong></span>
                  <span style={{ color: C.dm }}>Actual: <strong style={{ color: act != null ? C.gn : C.dm }}>{act != null ? fH(act) : '--'}</strong></span>
                  {diff != null && <span style={{ color: diff > 0 ? C.rd : C.gn, fontWeight: 700 }}>{diff > 0 ? '+' : ''}{fH(Math.abs(diff))} {diff > 0 ? 'over' : 'under'}</span>}
                  {j.startedAt   && <span style={{ color: C.dm }}>Start: <strong style={{ color: C.tx }}>{fT(j.startedAt)}</strong></span>}
                  {j.completedAt && <span style={{ color: C.dm }}>Done: <strong style={{ color: C.tx }}>{fT(j.completedAt)}</strong></span>}
                </div>
              </div>
            )
          })}
        </>
      )}

      {incomplete.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 700, color: C.am, textTransform: 'uppercase', letterSpacing: 1, marginTop: 10, marginBottom: 4 }}>Not Completed ({incomplete.length})</div>
          {incomplete.map(j => (
            <div key={j.id} style={{ ...cB, padding: '10px 12px', marginBottom: 5, opacity: 0.65, cursor: 'pointer' }} onClick={() => setDetailJob(j)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  {j.tbCallNum && <span style={{ fontSize: 13, fontWeight: 800, color: C.pu, marginRight: 8 }}>{j.tbCallNum}</span>}
                  {j.tbAccount && <span style={{ fontSize: 11, color: C.ac, marginRight: 6 }}>{j.tbAccount}</span>}
                </div>
                <span style={{ fontSize: 10, color: C.dm }}>{driverName(j.driverId)}</span>
              </div>
              <div style={{ fontSize: 11, color: C.tx, marginTop: 3 }}>{j.pickupAddr || j.pickupZip || '?'} → {j.dropAddr || j.dropZip || '?'}</div>
            </div>
          ))}
        </>
      )}

      {dayJobs.length === 0 && <div style={{ ...cB, textAlign: 'center', padding: 20, color: C.dm, fontSize: 11 }}>No jobs recorded for this day.</div>}

      {detailJob && <JobDetailModal job={detailJob} drivers={drivers} onClose={() => setDetailJob(null)} />}
    </div>
  )
}
