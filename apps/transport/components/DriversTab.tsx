'use client'
import { useMemo, useState } from 'react'
import { C, cB, bSt, YARDS } from '../lib/config'
import { cityFrom, lz } from '../lib/geo'
import { fH, fD, fMi, dLb, dayFull, jobTotal, jobMiles } from '../lib/utils'
import type { Job, Driver } from '../lib/types'

interface Props {
  jobs: Job[]
  drivers: Driver[]
  viewDay: string
  hpd: number
  onExportCSV: (jobs: Job[], filename: string) => void
}

export function DriversTab({ jobs, drivers, viewDay, hpd, onExportCSV }: Props) {
  const dayJobs = jobs.filter(j => j.day === viewDay && j.status !== 'cancelled')

  const [drvYard,   setDrvYard]   = useState('ALL')
  const [drvFunc,   setDrvFunc]   = useState('ALL')
  const [drvSearch, setDrvSearch] = useState('')

  const allYards = useMemo(() => {
    const ids = [...new Set(drivers.map(d => d.yard).filter(Boolean))].sort()
    return ['ALL', ...ids]
  }, [drivers])

  const allFuncs = useMemo(() => {
    const fs = [...new Set(drivers.map(d => d.func).filter(Boolean))].sort()
    return ['ALL', ...fs]
  }, [drivers])

  const visDrivers = useMemo(() => {
    let out = drivers
    if (drvYard !== 'ALL') out = out.filter(d => d.yard === drvYard)
    if (drvFunc !== 'ALL') out = out.filter(d => d.func === drvFunc)
    if (drvSearch.trim()) {
      const q = drvSearch.trim().toLowerCase()
      out = out.filter(d => dLb(d).toLowerCase().includes(q))
    }
    const dayJ = jobs.filter(j => j.day === viewDay && j.status !== 'cancelled')
    return [...out].sort((a, b) => {
      const aH = dayJ.filter(j => j.driverId === a.id || j.driverId2 === a.id).reduce((s, j) => s + jobTotal(j), 0)
      const bH = dayJ.filter(j => j.driverId === b.id || j.driverId2 === b.id).reduce((s, j) => s + jobTotal(j), 0)
      if (aH !== bH) return aH - bH
      return dLb(a).localeCompare(dLb(b))
    })
  }, [drivers, drvYard, drvFunc, drvSearch, jobs, viewDay])

  const yardLabel = (id: string) => YARDS.find(y => y.id === id)?.short || id

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{dayFull(viewDay)} - Driver Schedules</div>
        {dayJobs.length > 0 && (
          <button style={{ ...bSt, color: C.gn, borderColor: C.gn, fontSize: 10 }} onClick={() => onExportCSV(dayJobs, 'drivers-' + viewDay + '.csv')}>
            ⬇ CSV
          </button>
        )}
      </div>

      {allYards.length > 2 && (
        <div className="fb" style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 9, color: C.dm, fontWeight: 600, alignSelf: 'center', marginRight: 2 }}>YARD:</span>
          {allYards.map(y => (
            <button key={y} className={'fbtn' + (drvYard === y ? ' on' : '')} onClick={() => setDrvYard(y)}>
              {y === 'ALL' ? 'All' : yardLabel(y)} ({y === 'ALL' ? drivers.length : drivers.filter(d => d.yard === y).length})
            </button>
          ))}
        </div>
      )}

      {allFuncs.length > 2 && (
        <div className="fb" style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 9, color: C.dm, fontWeight: 600, alignSelf: 'center', marginRight: 2 }}>FUNCTION:</span>
          {allFuncs.map(f => (
            <button key={f} className={'fbtn' + (drvFunc === f ? ' on' : '')} onClick={() => setDrvFunc(f)}>
              {f === 'ALL' ? 'All' : f} ({f === 'ALL' ? drivers.length : drivers.filter(d => d.func === f).length})
            </button>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <input
          style={{ background: C.inp, border: '1px solid ' + C.bd, borderRadius: 6, padding: '6px 8px', color: C.tx, fontSize: 12, fontFamily: 'inherit', outline: 'none', width: '100%', maxWidth: 300, boxSizing: 'border-box' }}
          placeholder="Search drivers..."
          value={drvSearch}
          onChange={e => setDrvSearch(e.target.value)}
        />
      </div>

      {visDrivers.map(d => {
        const dj      = dayJobs.filter(j => j.driverId === d.id || j.driverId2 === d.id)
        const totalH  = dj.reduce((s, j) => s + jobTotal(j), 0)
        const totalMi = dj.reduce((s, j) => s + jobMiles(j), 0)
        const pct     = hpd > 0 ? totalH / hpd * 100 : 0
        const col     = pct >= 90 ? C.rd : pct >= 70 ? C.am : C.gn
        const avail   = Math.max(hpd - totalH, 0)
        const PX_HR   = 50

        return (
          <div key={d.id} style={{ ...cB, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{dLb(d)}</span>
                <span style={{ fontSize: 10, color: C.dm, marginLeft: 8 }}>{YARDS.find(y => y.id === d.yard)?.short}</span>
                {d.func && <span style={{ fontSize: 10, color: C.ac, marginLeft: 6, padding: '1px 6px', borderRadius: 10, background: C.ad }}>{d.func}</span>}
                {dj.some(j => j.status === 'active') && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: C.ab, color: C.am, marginLeft: 6, animation: 'pulse 2s infinite' }}>ON JOB</span>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: col }}>{fD(totalH)}</span>
                <span style={{ fontSize: 10, color: C.dm, marginLeft: 4 }}>/ {hpd}h</span>
              </div>
            </div>

            <div style={{ height: 8, background: C.sf, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{ height: '100%', width: Math.min(pct, 100) + '%', background: col, borderRadius: 4 }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.dm, marginBottom: 8 }}>
              <span>{dj.length} jobs · {fMi(totalMi)}</span>
              <span style={{ color: col }}>{fD(avail)} available</span>
            </div>

            {dj.length > 0 && (() => {
              const safeTotal = dj.reduce((s, j) => { const t = jobTotal(j); return s + (isFinite(t) && t > 0 ? t : 1) }, 0)
              const innerW    = Math.max(safeTotal, hpd) * PX_HR
              return (
                <>
                  <div style={{ overflowX: 'auto', borderRadius: 6 }}>
                    <div style={{ position: 'relative', height: 32 * dj.length, width: innerW, background: C.sf, borderRadius: 6 }}>
                      {dj.map((j, idx) => {
                        const jh     = jobTotal(j)
                        const safeH  = isFinite(jh) && jh > 0 ? jh : 1
                        const startH = dj.slice(0, idx).reduce((s, jj) => { const t = jobTotal(jj); return s + (isFinite(t) && t > 0 ? t : 1) }, 0)
                        const puN    = j.pickupAddr ? cityFrom(j.pickupAddr) : (lz(j.pickupZip)?.label || '?')
                        const drNN   = j.dropAddr   ? cityFrom(j.dropAddr)   : (lz(j.dropZip)?.label   || '?')
                        const barCol = j.status === 'active' ? C.am : j.status === 'complete' ? C.gn : C.ac
                        return (
                          <div key={j.id} className="gantt-bar" title={`${j.tbCallNum || ''}${j.tbTruck ? ' · ' + j.tbTruck : ''}\n${puN} → ${drNN}\n${fH(jh)}`}
                            style={{ top: idx * 32 + 4, left: startH * PX_HR, width: safeH * PX_HR, background: barCol + '33', border: '1px solid ' + barCol, color: C.tx }}>
                            <span style={{ color: C.pu, fontWeight: 800, marginRight: 4 }}>{j.tbCallNum || '?'}</span>
                            {puN} → {drNN}
                            <span style={{ marginLeft: 'auto', color: barCol, fontWeight: 700, paddingLeft: 4 }}>{fH(jh)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {dj.map(j => (
                      <div key={j.id} style={{ fontSize: 11, color: C.tx, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: C.pu, fontWeight: 800 }}>{j.tbCallNum || '?'}</span>
                        <span style={{ color: C.dm }}>—</span>
                        <span style={{ color: j.tbTruck ? C.am : C.dm, fontWeight: j.tbTruck ? 700 : 400 }}>{j.tbTruck || 'No equipment'}</span>
                      </div>
                    ))}
                  </div>
                </>
              )
            })()}

            {dj.length === 0 && <div style={{ fontSize: 11, color: C.dm, textAlign: 'center', padding: 10 }}>No jobs assigned</div>}
          </div>
        )
      })}
    </div>
  )
}
