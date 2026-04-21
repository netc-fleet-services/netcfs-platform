'use client'
import { C, bP, bSt, sS } from '../lib/config'
import { YARDS } from '../lib/config'
import { crd, dMi, cityFrom, lz } from '../lib/geo'
import { fH, jobTotal } from '../lib/utils'
import type { Driver, Job, OptimizerState } from '../lib/types'

interface Props {
  state: OptimizerState
  drivers: Driver[]
  onUpdate: (updater: (prev: OptimizerState) => OptimizerState) => void
  onApply: () => void
  onClose: () => void
}

export function OptimizerModal({ state, drivers, onUpdate, onApply, onClose }: Props) {
  const moveJob = (jobId: string, toVal: string) => {
    onUpdate(prev => {
      const next: OptimizerState = {
        driverStates: prev.driverStates.map(ds => ({ ...ds, jobs: [...ds.jobs] })),
        unassigned: [...prev.unassigned],
      }
      let job: Job | null = null
      for (const ds of next.driverStates) {
        const i = ds.jobs.findIndex(j => j.id === jobId)
        if (i > -1) { [job] = ds.jobs.splice(i, 1); break }
      }
      if (!job) {
        const i = next.unassigned.findIndex(j => j.id === jobId)
        if (i > -1) [job] = next.unassigned.splice(i, 1)
      }
      if (!job) return prev
      if (toVal === 'unassigned') {
        next.unassigned.push(job)
      } else {
        const ds = next.driverStates.find(d => String(d.driver.id) === String(toVal))
        if (ds) ds.jobs.push(job)
      }
      next.driverStates.forEach(ds => {
        ds.usedH = ds.jobs.reduce((s, j) => { const t = jobTotal(j); return s + (isFinite(t) && t > 0 ? t : 1) }, 0)
      })
      return next
    })
  }

  const assigned   = state.driverStates.reduce((s, ds) => s + ds.jobs.length, 0)
  const unassigned = state.unassigned.length

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, overflowY: 'auto', padding: 20 }}>
      <div style={{ maxWidth: 740, margin: '0 auto', background: C.bg, borderRadius: 10, border: '1px solid ' + C.bd, padding: 20 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.tx }}>Route Suggestions</div>
            <div style={{ fontSize: 10, color: C.dm }}>{assigned} jobs assigned · {unassigned} unassigned</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...bP, background: C.pu }} onClick={onApply}>Apply Assignments</button>
            <button style={bSt} onClick={onClose}>Discard</button>
          </div>
        </div>

        {state.driverStates.filter(ds => ds.jobs.length > 0).map(ds => {
          const over    = ds.usedH > 8
          const barPct  = Math.min((ds.usedH / 8) * 100, 100)
          const barCol  = ds.usedH >= 8 ? C.rd : ds.usedH >= 6 ? C.am : C.gn
          let prevPos   = crd(ds.yard.addr, ds.yard.zip)

          return (
            <div key={ds.driver.id} style={{ border: '1px solid ' + C.bd, borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
              <div style={{ background: C.cd, padding: '8px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.tx }}>{ds.driver.name}</span>
                    <span style={{ fontSize: 10, color: C.dm, marginLeft: 8 }}>{ds.yard.short}</span>
                    {ds.driver.truck && <span style={{ fontSize: 10, color: C.dm, marginLeft: 4 }}>· {ds.driver.truck}</span>}
                  </div>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 800, color: over ? C.rd : C.tx }}>{fH(ds.usedH)}</span>
                    {over && <span style={{ fontSize: 8, color: C.rd, marginLeft: 4 }}>OVER 8H</span>}
                  </div>
                </div>
                <div style={{ height: 4, background: C.sf, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: barPct + '%', background: barCol, borderRadius: 2 }} />
                </div>
              </div>

              <div style={{ padding: '6px 12px 10px' }}>
                {ds.jobs.map(job => {
                  const pc  = crd(job.pickupAddr, job.pickupZip)
                  const dc  = crd(job.dropAddr, job.dropZip)
                  const dh  = (prevPos && pc) ? Math.round(dMi(prevPos, pc)) : null
                  if (dc) prevPos = dc; else if (pc) prevPos = pc
                  const puN = cityFrom(job.pickupAddr) || lz(job.pickupZip)?.label || job.pickupZip || '?'
                  const drN = cityFrom(job.dropAddr)   || lz(job.dropZip)?.label   || job.dropZip   || '?'
                  return (
                    <div key={job.id}>
                      {dh !== null && <div style={{ fontSize: 10, color: C.dm, paddingLeft: 8, margin: '2px 0' }}>↓ {dh}mi empty</div>}
                      <div style={{ padding: '12px 14px', background: C.sf, borderRadius: 5, marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                              {job.tbCallNum && <span style={{ fontSize: 14, fontWeight: 800, color: C.pu }}>{job.tbCallNum}</span>}
                              {job.tbAccount && <span style={{ fontSize: 12, fontWeight: 600, color: C.ac }}>{job.tbAccount}</span>}
                              {job.tbDesc    && <span style={{ fontSize: 11, color: C.dm }}>{job.tbDesc.trim()}</span>}
                            </div>
                            {job.tbTruck && <div style={{ fontSize: 11, fontWeight: 700, color: C.am, background: C.ab, padding: '2px 8px', borderRadius: 10, display: 'inline-block', marginBottom: 5 }}>{job.tbTruck}</div>}
                            <div style={{ fontSize: 13, color: C.tx, lineHeight: 1.4 }}>{puN} → {drN}</div>
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 700, color: C.am, whiteSpace: 'nowrap' }}>{fH(jobTotal(job))}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <select style={{ ...sS, fontSize: 10, padding: '2px 6px', minWidth: 110 }}
                            value={ds.driver.id} onChange={e => moveJob(job.id, e.target.value)}>
                            {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            <option value="unassigned">— Unassign</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {state.unassigned.length > 0 && (
          <div style={{ border: '1px solid ' + C.rd, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ background: '#1a0d0d', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.rd }}>Unassigned ({state.unassigned.length})</span>
              <span style={{ fontSize: 9, color: C.dm }}>All drivers at shift limit or no capacity</span>
            </div>
            <div style={{ padding: '6px 12px 10px' }}>
              {state.unassigned.map(job => {
                const puN = cityFrom(job.pickupAddr) || lz(job.pickupZip)?.label || job.pickupZip || '?'
                const drN = cityFrom(job.dropAddr)   || lz(job.dropZip)?.label   || job.dropZip   || '?'
                return (
                  <div key={job.id} style={{ padding: '7px 10px', background: C.sf, borderRadius: 5, marginBottom: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                          {job.tbCallNum && <span style={{ fontSize: 13, fontWeight: 800, color: C.pu }}>{job.tbCallNum}</span>}
                          {job.tbTruck   && <span style={{ fontSize: 10, fontWeight: 700, color: C.am, background: C.ab, padding: '1px 6px', borderRadius: 10 }}>{job.tbTruck}</span>}
                          {job.tbAccount && <span style={{ fontSize: 12, fontWeight: 600, color: C.ac }}>{job.tbAccount}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: C.tx }}>{puN} → {drN}</div>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.am }}>{fH(jobTotal(job))}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <select style={{ ...sS, fontSize: 10, padding: '2px 6px', minWidth: 110 }}
                        value="unassigned" onChange={e => { if (e.target.value !== 'unassigned') moveJob(job.id, e.target.value) }}>
                        <option value="unassigned">Assign to…</option>
                        {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
