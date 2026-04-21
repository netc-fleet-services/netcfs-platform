'use client'
import { useState, useEffect } from 'react'
import { C, PRI_COLORS, iS, sS, bP, bSt, cB, YARDS } from '../lib/config'
import { crd, dMi, routeLookup, ghRoute, cityFrom, lz, geoCache, jobCrd } from '../lib/geo'
import { fH, fMi, fT, dLb } from '../lib/utils'
import type { Job, Driver } from '../lib/types'

interface Props {
  job: Job
  drivers: Driver[]
  onUpdate: (upd: Partial<Job>) => void
  onRemove: () => void
  onDayChange: (day: string) => void
}

export function JobCard({ job, drivers, onUpdate, onRemove, onDayChange }: Props) {
  const yard  = YARDS.find(y => y.id === job.yardId) || YARDS[0] || { short: '?', addr: '', zip: '' }
  const stops = job.stops || []

  const allPts = [
    { label: yard.short + ' (yard)',   addr: yard.addr, zip: yard.zip, lat: undefined as number | undefined, lon: undefined as number | undefined, color: C.dm },
    { label: 'Pickup', addr: job.pickupAddr, zip: job.pickupZip || '', lat: job.pickupLat ?? undefined, lon: job.pickupLon ?? undefined, color: C.ac },
    ...stops.map((s, i) => ({ label: s.name || ('Stop ' + (i + 1)), addr: s.addr || '', zip: s.zip || '', lat: undefined as number | undefined, lon: undefined as number | undefined, color: C.am })),
    { label: 'Drop',   addr: job.dropAddr,   zip: job.dropZip   || '', lat: job.dropLat   ?? undefined, lon: job.dropLon   ?? undefined, color: C.gn },
    { label: yard.short + ' (return)', addr: yard.addr, zip: yard.zip, lat: undefined as number | undefined, lon: undefined as number | undefined, color: C.dm },
  ]

  const ptCrd = (pt: typeof allPts[0]) =>
    (pt.lat != null && pt.lon != null) ? { lat: pt.lat!, lon: pt.lon! } : crd(pt.addr, pt.zip)

  const legs: { mi: number; hr: number }[] = []
  const ptCoords = []
  let havMi = 0
  for (let i = 0; i < allPts.length - 1; i++) {
    const c1 = ptCrd(allPts[i])
    const c2 = ptCrd(allPts[i + 1])
    if (i === 0 && c1) ptCoords.push(c1)
    if (c2) ptCoords.push(c2)
    const mi = dMi(c1, c2)
    legs.push({ mi, hr: mi / 45 })
    havMi += mi
  }
  const luH = Math.max(1, 0.5 * stops.length + 1)
  const ghHit   = routeLookup(ptCoords)
  const totalMi = ghHit ? ghHit.miles : havMi
  const totalH  = (ghHit ? ghHit.hours : havMi / 45) + luH

  const puN = job.pickupAddr ? (cityFrom(job.pickupAddr) || geoCache[job.pickupAddr]?.name || lz(job.pickupZip)?.label || job.pickupZip || '?') : (lz(job.pickupZip)?.label || job.pickupZip || '?')
  const drN = job.dropAddr   ? (cityFrom(job.dropAddr)   || geoCache[job.dropAddr]?.name   || lz(job.dropZip)?.label   || job.dropZip   || '?') : (lz(job.dropZip)?.label   || job.dropZip   || '?')
  const bc  = job.status === 'cancelled' ? C.dm : job.status === 'complete' ? C.gn : job.status === 'active' ? C.am : job.driverId ? C.ac : C.pu
  const dim = job.status === 'complete' || job.status === 'cancelled'
  const pri = job.priority || 'normal'

  const [showNotes, setShowNotes] = useState(false)
  const [showStops, setShowStops] = useState(false)
  const [newAddr,   setNewAddr]   = useState('')
  const [newZip,    setNewZip]    = useState('')
  const [newName,   setNewName]   = useState('')
  const [, setGhVersion] = useState(0)

  useEffect(() => {
    const ptsCoords = allPts.map(p => ptCrd(p)).filter(Boolean) as { lat: number; lon: number }[]
    if (ptsCoords.length < 2) return
    let cancelled = false
    ghRoute(ptsCoords).then(r => {
      if (cancelled || !r) return
      setGhVersion(v => v + 1)
      if (r.hasTolls !== (job.hasTolls === true)) onUpdate({ hasTolls: r.hasTolls })
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.pickupAddr, job.pickupZip, job.dropAddr, job.dropZip, job.yardId, JSON.stringify(stops)])

  const ptNames = [yard.short, puN, ...stops.map((s, i) => s.name || cityFrom(s.addr) || lz(s.zip)?.label || ('Stop ' + (i + 1))), drN, yard.short]

  const addStop = () => {
    if (!newZip.trim() && !newAddr.trim()) return
    onUpdate({ stops: [...stops, { addr: newAddr.trim(), zip: newZip.trim(), name: newName.trim() }] })
    setNewAddr(''); setNewZip(''); setNewName('')
  }
  const rmStop   = (i: number) => { const s = [...stops]; s.splice(i, 1); onUpdate({ stops: s }) }
  const moveStop = (i: number, dir: number) => {
    if (i + dir < 0 || i + dir >= stops.length) return
    const s = [...stops], tmp = s[i]; s[i] = s[i + dir]; s[i + dir] = tmp; onUpdate({ stops: s })
  }

  return (
    <div style={{ ...cB, borderLeft: '3px solid ' + bc, opacity: dim ? 0.4 : 1, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <div className="tb-pri" style={{ background: PRI_COLORS[pri] }} title={pri} />
          {job.tbCallNum && <span style={{ fontSize: 15, fontWeight: 800, color: C.pu }}>{job.tbCallNum}</span>}
          {job.tbTruck   && <span style={{ fontSize: 10, fontWeight: 700, color: C.am, background: C.ab, padding: '1px 6px', borderRadius: 10 }}>{job.tbTruck}</span>}
          {job.tbAccount && <span style={{ fontSize: 12, fontWeight: 700, color: C.ac }}>{job.tbAccount}</span>}
          {job.tbDesc    && <span style={{ fontSize: 10, fontWeight: 600, color: C.tx, background: C.sf, padding: '1px 6px', borderRadius: 10 }}>{job.tbDesc.trim()}</span>}
          {job.tbReason  && <span style={{ fontSize: 9, color: C.dm, background: C.sf, padding: '1px 6px', borderRadius: 10 }}>{job.tbReason}</span>}
          {stops.length > 0 && <span style={{ fontSize: 8, color: C.am, background: C.ab, padding: '1px 5px', borderRadius: 8, fontWeight: 700 }}>{stops.length + 2} STOPS</span>}
          {job.hasTolls && <span title="Route has toll roads" style={{ fontSize: 9, fontWeight: 700, color: '#ffd966', background: '#3b2f11', padding: '1px 5px', borderRadius: 8 }}>💰 TOLLS</span>}
          {job.status === 'active'    && <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: C.ab, color: C.am, animation: 'pulse 2s infinite' }}>ACTIVE</span>}
          {job.status === 'complete'  && <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: C.gb, color: C.gn }}>DONE</span>}
          {job.status === 'cancelled' && <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: '#3b1111', color: C.rd }}>CANCELLED</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: dim ? C.dm : C.ac }}>{fH(totalH)}</div>
            <div style={{ fontSize: 8, color: C.dm }}>{fMi(totalMi)}</div>
          </div>
          {!dim && <button style={bSt} onClick={onRemove}>✕</button>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 8, color: C.dm, fontWeight: 600 }}>DATE:</span>
          <input type="date" style={{ ...iS, fontSize: 10, padding: '2px 5px', width: 120 }}
            value={job.day || ''} onChange={e => { if (e.target.value) { onUpdate({ day: e.target.value }); onDayChange(e.target.value) } }} />
        </div>
        {job.tbScheduled && <span style={{ fontSize: 12, fontWeight: 600, color: C.tx }}>{job.tbScheduled}</span>}
      </div>

      <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>YARD</div>
          <select style={{ ...sS, fontSize: 10, padding: '3px 5px' }} value={job.yardId || ''} onChange={e => onUpdate({ yardId: e.target.value })}>
            {YARDS.map(y => <option key={y.id} value={y.id}>{y.short}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>DRIVER 1</div>
          <select style={{ ...sS, fontSize: 10, padding: '3px 5px' }} value={job.driverId || ''} onChange={e => onUpdate({ driverId: e.target.value ? parseInt(e.target.value) : null })}>
            <option value="">Unassigned</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{dLb(d)}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>DRIVER 2</div>
          <select style={{ ...sS, fontSize: 10, padding: '3px 5px' }} value={job.driverId2 || ''} onChange={e => onUpdate({ driverId2: e.target.value ? parseInt(e.target.value) : null })}>
            <option value="">None</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{dLb(d)}</option>)}
          </select>
        </div>
        <div style={{ width: 70 }}>
          <div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>PRIORITY</div>
          <select style={{ ...sS, fontSize: 10, padding: '3px 5px' }} value={pri} onChange={e => onUpdate({ priority: e.target.value as Job['priority'] })}>
            <option value="urgent">Urgent</option>
            <option value="normal">Normal</option>
            <option value="flexible">Flex</option>
          </select>
        </div>
      </div>

      {(job.tbDriver || job.tbDriver2) && (
        <div style={{ fontSize: 10, color: C.dm, marginBottom: 4 }}>
          TB Driver: <strong style={{ color: C.am }}>{[job.tbDriver, job.tbDriver2].filter(Boolean).join(', ')}</strong>
        </div>
      )}

      <div style={{ padding: '0 0 0 2px' }}>
        {allPts.map((pt, i) => {
          const isLast = i === allPts.length - 1
          const leg    = i < legs.length ? legs[i] : null
          const name   = ptNames[i]
          const dot    = isLast ? 'A' : String.fromCharCode(65 + (i > allPts.length - 2 ? 0 : i))
          return (
            <div key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid ' + pt.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 700, color: pt.color, flexShrink: 0 }}>{dot}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.tx, flex: 1 }}>{name}</div>
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

      <div style={{ marginTop: 5 }}>
        <button style={{ ...bSt, fontSize: 9, color: C.am, borderColor: C.am }} onClick={() => setShowStops(!showStops)}>
          {showStops ? 'Hide stops' : '+ Add/Edit Stops'}{stops.length > 0 && ' (' + stops.length + ')'}
        </button>
        {showStops && (
          <div style={{ marginTop: 4, padding: 8, background: C.sf, borderRadius: 6, border: '1px solid ' + C.bd }}>
            <div style={{ fontSize: 9, color: C.dm, marginBottom: 5 }}>Stops are inserted between Pickup and Drop.</div>
            {stops.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 3, alignItems: 'center', marginBottom: 4, padding: 4, background: C.cd, borderRadius: 4 }}>
                <span style={{ fontSize: 11, color: C.am, fontWeight: 800, minWidth: 20 }}>S{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: C.tx, fontWeight: 600 }}>{s.name || s.addr || 'Stop ' + (i + 1)}</div>
                  <div style={{ fontSize: 9, color: C.dm }}>{s.addr} {s.zip && <span style={{ color: C.ac }}>({s.zip})</span>}</div>
                </div>
                <button style={{ ...bSt, padding: '1px 4px', fontSize: 8 }} onClick={() => moveStop(i, -1)}>↑</button>
                <button style={{ ...bSt, padding: '1px 4px', fontSize: 8 }} onClick={() => moveStop(i,  1)}>↓</button>
                <button style={{ ...bSt, padding: '1px 4px', color: C.rd, fontSize: 8 }} onClick={() => rmStop(i)}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 3, marginTop: stops.length ? 5 : 0 }}>
              <input style={{ ...iS, flex: 2, fontSize: 10, padding: '4px 6px' }} placeholder="Address" value={newAddr} onChange={e => setNewAddr(e.target.value)} />
              <input style={{ ...iS, width: 60, fontSize: 10, padding: '4px 6px', borderColor: C.am }} placeholder="ZIP *" maxLength={5} value={newZip} onChange={e => setNewZip(e.target.value.replace(/\D/g, ''))} />
              <input style={{ ...iS, width: 70, fontSize: 10, padding: '4px 6px' }} placeholder="Label" value={newName} onChange={e => setNewName(e.target.value)} />
              <button style={{ ...bP, fontSize: 9, padding: '3px 8px' }} onClick={addStop}>Add</button>
            </div>
          </div>
        )}
      </div>

      {job.status !== 'cancelled' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5, paddingTop: 5, borderTop: '1px solid ' + C.bd }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={{ ...bSt, fontSize: 9 }} onClick={() => setShowNotes(!showNotes)}>📝{job.notes ? ' *' : ''}</button>
            {job.status === 'scheduled' && (job.driverId ?? 0) > 0 && (
              <button style={{ ...bSt, color: C.am, borderColor: C.am }} onClick={() => onUpdate({ status: 'active', startedAt: new Date().toISOString() })}>▶ Start</button>
            )}
            {job.status === 'active' && (
              <button style={{ ...bSt, color: C.gn, borderColor: C.gn }} onClick={() => onUpdate({ status: 'complete', completedAt: new Date().toISOString() })}>✓ Done</button>
            )}
            {job.status === 'complete' && (
              <button style={{ ...bSt, color: C.am, borderColor: C.am }} onClick={() => onUpdate({ status: 'scheduled', startedAt: null, completedAt: null })}>↩ Undo</button>
            )}
          </div>
          <div style={{ fontSize: 9, color: C.dm }}>
            {job.startedAt   && <span style={{ color: C.am }}>Started {fT(job.startedAt)} </span>}
            {job.completedAt && <span style={{ color: C.gn }}>Done {fT(job.completedAt)}</span>}
          </div>
        </div>
      )}
      {showNotes && (
        <div style={{ marginTop: 4 }}>
          <textarea style={{ ...iS, height: 45, fontSize: 10, resize: 'vertical' } as React.CSSProperties}
            placeholder="Notes..." value={job.notes || ''} onChange={e => onUpdate({ notes: e.target.value })} />
        </div>
      )}
    </div>
  )
}
