'use client'

import { useState } from 'react'
import { BOARD, C, callCompanyBucket, sS, type CompanyBucket, type TeamId } from '../lib/config'
import type { Driver, Job } from '../lib/types'
import { cityFrom } from '../lib/geo'
import { jobTotal } from '../lib/utils'

export function OpenCallsRail({ openCalls, unmatchedCalls, availableDrivers, bucket, team, onAssign }: {
  openCalls: Job[]
  unmatchedCalls: { job: Job; tbName: string }[]
  availableDrivers: Driver[]
  bucket: CompanyBucket
  team: TeamId | 'all'
  onAssign: (job: Job, driverId: number) => void
}) {
  // Scope the rail to the board's company + team. Unknown prefixes / NULL
  // job types are always shown (never silently hide a call).
  const teamTypes = team === 'all' ? null : new Set(BOARD.teamJobTypes[team])
  const visible = openCalls.filter(j => {
    const jb = callCompanyBucket(j.tbCallNum)
    if (jb && jb !== bucket) return false
    if (teamTypes && j.jobType && !teamTypes.has(j.jobType)) return false
    return true
  })
  const unmatchedVisible = unmatchedCalls.filter(({ job }) => {
    const jb = callCompanyBucket(job.tbCallNum)
    return !jb || jb === bucket
  })

  return (
    <div style={{ width: 340, flexShrink: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: 1.2, color: C.am, margin: '4px 0 10px' }}>
        OPEN CALLS <span style={{ fontSize: 22 }}>{visible.length}</span>
      </div>

      {visible.length === 0 && (
        <div style={{ color: C.dm, fontSize: 12, marginBottom: 12 }}>No unassigned calls.</div>
      )}

      {visible.map(j => <OpenCallCard key={j.id} job={j} availableDrivers={availableDrivers} onAssign={onAssign} />)}

      {unmatchedVisible.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1.2, color: C.rd, margin: '16px 0 8px' }}>
            UNMATCHED DRIVER NAMES
          </div>
          {unmatchedVisible.map(({ job, tbName }, i) => (
            <div key={`${job.id}-${i}`} style={{ background: C.cd, border: '1px solid ' + C.bd, borderLeft: '4px solid ' + C.rd, borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.rd }}>&ldquo;{tbName}&rdquo;</div>
              <div style={{ fontSize: 11, color: C.dm, marginTop: 2 }}>
                on #{job.tbCallNum} — resolve in the match popup (appears automatically)
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function OpenCallCard({ job: j, availableDrivers, onAssign }: {
  job: Job
  availableDrivers: Driver[]
  onAssign: (job: Job, driverId: number) => void
}) {
  const [picking, setPicking] = useState(false)
  const est = jobTotal(j)

  return (
    <div style={{ background: C.cd, border: '1px solid ' + C.bd, borderLeft: '4px solid ' + C.am, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 900 }}>#{j.tbCallNum ?? '—'}</span>
        {j.jobType && <span style={{ fontSize: 10, color: C.dm, border: '1px solid ' + C.bd, borderRadius: 4, padding: '1px 5px' }}>{j.jobType}</span>}
        {j.status === 'active' && <span style={{ fontSize: 10, fontWeight: 800, color: C.rd }}>ACTIVE</span>}
        {j.tbScheduled && <span style={{ fontSize: 11, color: C.dm, marginLeft: 'auto' }}>{j.tbScheduled}</span>}
      </div>

      <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {cityFrom(j.pickupAddr) || '—'} → {cityFrom(j.dropAddr) || '—'}
      </div>
      <div style={{ marginTop: 2, fontSize: 11, color: C.dm }}>
        {Number.isFinite(est) ? `est ${est.toFixed(1)}h` : 'est —'}
        {j.tbDesc ? ` · ${j.tbDesc}` : ''}
      </div>

      {picking ? (
        <select
          autoFocus
          style={{ ...sS, marginTop: 8, fontSize: 12 }}
          defaultValue=""
          onChange={e => {
            const id = Number(e.target.value)
            if (id) onAssign(j, id)
            setPicking(false)
          }}
          onBlur={() => setPicking(false)}
        >
          <option value="" disabled>Pick an available driver…</option>
          {availableDrivers.map(d => (
            <option key={d.id} value={d.id}>{d.name}{d.truck ? ` (#${d.truck})` : ''}</option>
          ))}
        </select>
      ) : (
        <button
          onClick={() => setPicking(true)}
          disabled={!availableDrivers.length}
          style={{
            marginTop: 8, width: '100%', background: availableDrivers.length ? C.ac : C.sf,
            color: availableDrivers.length ? C.wh : C.dm, border: 'none', borderRadius: 6,
            padding: '7px 0', fontSize: 12, fontWeight: 800, cursor: availableDrivers.length ? 'pointer' : 'default',
            fontFamily: 'inherit',
          }}>
          {availableDrivers.length ? 'Assign driver →' : 'No available drivers'}
        </button>
      )}
    </div>
  )
}
