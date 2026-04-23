'use client'
import { C, cB, bSt, PRI_COLORS } from '../lib/config'
import { YARDS } from '../lib/config'
import { crd, dMi, cityFrom, lz } from '../lib/geo'
import { fH, fMi, fT } from '../lib/utils'
import type { Job, Driver } from '../lib/types'

interface Props {
  job: Job
  drivers: Driver[]
  onClose: () => void
}

export function JobDetailModal({ job, drivers, onClose }: Props) {
  const yard  = YARDS.find(y => y.id === job.yardId) || YARDS[0] || { short: '?', addr: '', zip: '' }
  const stops = job.stops || []

  const allPts = [
    { label: yard.short + ' (yard)',   addr: yard.addr,      zip: yard.zip,      color: C.dm },
    { label: 'Pickup',                  addr: job.pickupAddr, zip: job.pickupZip, color: C.ac },
    ...stops.map((s, i) => ({ label: s.name || ('Stop ' + (i + 1)), addr: s.addr || '', zip: s.zip || '', color: C.am })),
    { label: 'Drop',                    addr: job.dropAddr,   zip: job.dropZip,   color: C.gn },
    { label: yard.short + ' (return)',  addr: yard.addr,      zip: yard.zip,      color: C.dm },
  ]

  const legs: { mi: number; hr: number }[] = []
  let totalMi = 0
  for (let i = 0; i < allPts.length - 1; i++) {
    const c1 = crd(allPts[i].addr, allPts[i].zip)
    const c2 = crd(allPts[i + 1].addr, allPts[i + 1].zip)
    const mi = dMi(c1, c2)
    legs.push({ mi, hr: mi / 45 })
    totalMi += mi
  }
  const luH    = Math.max(1, 0.5 * stops.length + 1)
  const totalH = totalMi / 45 + luH

  const puN = job.pickupAddr ? (cityFrom(job.pickupAddr) || lz(job.pickupZip)?.label || job.pickupZip || '?') : (lz(job.pickupZip)?.label || job.pickupZip || '?')
  const drN = job.dropAddr   ? (cityFrom(job.dropAddr)   || lz(job.dropZip)?.label   || job.dropZip   || '?') : (lz(job.dropZip)?.label   || job.dropZip   || '?')
  const ptNames = [yard.short, puN, ...stops.map((s, i) => s.name || cityFrom(s.addr) || lz(s.zip)?.label || ('Stop ' + (i + 1))), drN, yard.short]

  const driverName = drivers.find(d => d.id === job.driverId)?.name || 'Unassigned'
  const actualH = (job.startedAt && job.completedAt)
    ? (new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 3600000
    : null
  const pri = job.priority || 'normal'
  const bc  = job.status === 'complete' ? C.gn : job.status === 'active' ? C.am : C.ac

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ ...cB, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', padding: 14, borderLeft: '3px solid ' + bc }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <div className="tb-pri" style={{ background: PRI_COLORS[pri] }} title={pri} />
            {job.tbCallNum && <span style={{ fontSize: 15, fontWeight: 800, color: C.pu }}>{job.tbCallNum}</span>}
            {job.tbAccount && <span style={{ fontSize: 12, fontWeight: 700, color: C.ac }}>{job.tbAccount}</span>}
            {job.tbDesc    && <span style={{ fontSize: 10, color: C.tx, background: C.sf, padding: '1px 6px', borderRadius: 10 }}>{job.tbDesc.trim()}</span>}
            {job.tbReason  && <span style={{ fontSize: 9, color: C.dm, background: C.sf, padding: '1px 6px', borderRadius: 10 }}>{job.tbReason}</span>}
            {job.status === 'complete' && <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: C.gb, color: C.gn }}>DONE</span>}
            {job.status === 'active'   && <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: C.ab, color: C.am }}>ACTIVE</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.ac }}>{fH(totalH)}</div>
              <div style={{ fontSize: 8, color: C.dm }}>{fMi(totalMi)}</div>
            </div>
            <button style={bSt} onClick={onClose}>✕</button>
          </div>
        </div>

        {job.tbScheduled && <div style={{ fontSize: 12, fontWeight: 600, color: C.tx, marginBottom: 6 }}>{job.tbScheduled}</div>}

        <div style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 10 }}>
          <div><span style={{ color: C.dm }}>Yard: </span><strong>{yard.short}</strong></div>
          <div><span style={{ color: C.dm }}>Driver: </span><strong style={{ color: C.ac }}>{driverName}</strong></div>
          <div><span style={{ color: C.dm }}>Priority: </span><strong>{pri}</strong></div>
        </div>
        {job.tbDriver && <div style={{ fontSize: 10, color: C.dm, marginBottom: 6 }}>TB Driver: <strong style={{ color: C.am }}>{job.tbDriver}</strong></div>}

        <div style={{ padding: '0 0 0 2px', marginBottom: 8 }}>
          {allPts.map((pt, i) => {
            const isLast = i === allPts.length - 1
            const leg    = i < legs.length ? legs[i] : null
            const dot    = isLast ? 'A' : String.fromCharCode(65 + (i > allPts.length - 2 ? 0 : i))
            return (
              <div key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid ' + pt.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 700, color: pt.color, flexShrink: 0 }}>{dot}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.tx, flex: 1 }}>{ptNames[i]}</div>
                  {!isLast && i > 0 && i < allPts.length - 2 && <div style={{ fontSize: 8, color: C.am }}>+30m</div>}
                  {i === 1 && stops.length === 0 && <div style={{ fontSize: 8, color: C.am }}>+1h load</div>}
                </div>
                {!isLast && leg && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 14, display: 'flex', justifyContent: 'center' }}><div style={{ width: 2, height: 16, background: C.bd }} /></div>
                    <span style={{ fontSize: 10, color: leg.hr > 0 ? C.ac : C.rd, fontWeight: 700 }}>{leg.hr > 0 ? fH(leg.hr) : '? no zip'}</span>
                    {leg.mi > 0 && <span style={{ fontSize: 9, color: C.dm }}>{fMi(leg.mi)}</span>}
                  </div>
                )}
              </div>
            )
          })}
          <div style={{ fontSize: 9, color: C.am, marginTop: 2 }}>Load/unload: {fH(luH)}</div>
        </div>

        {stops.length > 0 && (
          <div style={{ marginBottom: 8, padding: 8, background: C.sf, borderRadius: 6, border: '1px solid ' + C.bd }}>
            <div style={{ fontSize: 9, color: C.dm, marginBottom: 4, fontWeight: 600 }}>STOPS</div>
            {stops.map((s, i) => (
              <div key={i} style={{ fontSize: 10, color: C.tx, marginBottom: 2 }}>
                <span style={{ color: C.am, fontWeight: 800, marginRight: 6 }}>S{i + 1}</span>
                {s.name && <span style={{ fontWeight: 600, marginRight: 4 }}>{s.name}</span>}
                {s.addr} {s.zip && <span style={{ color: C.ac }}>({s.zip})</span>}
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: '1px solid ' + C.bd, paddingTop: 8, fontSize: 10 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ color: C.dm }}>Est: <strong style={{ color: C.am }}>{isFinite(totalH) ? fH(totalH) : '--'}</strong></span>
            {actualH != null && <span style={{ color: C.dm }}>Actual: <strong style={{ color: C.gn }}>{fH(actualH)}</strong></span>}
            {actualH != null && isFinite(totalH) && (() => {
              const diff = actualH - totalH
              return <span style={{ color: diff > 0 ? C.rd : C.gn, fontWeight: 700 }}>{diff > 0 ? '+' : ''}{fH(Math.abs(diff))} {diff > 0 ? 'over' : 'under'}</span>
            })()}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: C.dm }}>
            {job.startedAt   && <span>Started: <strong style={{ color: C.tx }}>{fT(job.startedAt)}</strong></span>}
            {job.completedAt && <span>Done: <strong style={{ color: C.tx }}>{fT(job.completedAt)}</strong></span>}
            {job.hasTolls && <span style={{ padding: '1px 6px', borderRadius: 4, background: '#2d1f00', border: '1px solid #f59e0b', color: '#f59e0b', fontWeight: 700, fontSize: 9 }}>TOLLS</span>}
          </div>
          {job.notes && <div style={{ marginTop: 6, padding: '6px 8px', background: C.sf, borderRadius: 4, fontSize: 10, color: C.tx }}>{job.notes}</div>}
        </div>
      </div>
    </div>
  )
}
