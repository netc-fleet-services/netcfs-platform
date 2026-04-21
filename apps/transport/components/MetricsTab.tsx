'use client'
import { useMemo, useState } from 'react'
import { C, cB } from '../lib/config'
import { fH, fD, isoD, dayNm } from '../lib/utils'
import { jobTotal, jobMiles } from '../lib/utils'
import type { Job, Driver } from '../lib/types'

interface Props {
  jobs: Job[]
  drivers: Driver[]
  viewDay: string
  hpd: number
  staffing: Record<string, number>
  locLabel: (cn: string | null | undefined) => string | null
}

const RANGE_OPTS: [string, string][] = [['7d', '7 Days'], ['14d', '14 Days'], ['30d', '30 Days'], ['all', 'All Time']]

export function MetricsTab({ jobs, drivers, viewDay, hpd, staffing, locLabel }: Props) {
  const [range,   setRange]   = useState('7d')
  const [mReason, setMReason] = useState<Set<string>>(() => new Set(['ALL']))
  const [mLoc,    setMLoc]    = useState<Set<string>>(() => new Set(['ALL']))

  const allReasons = useMemo(() => {
    const s = new Set<string>(); jobs.forEach(j => { if (j.tbReason) s.add(j.tbReason) })
    return ['ALL', ...[...s].sort()]
  }, [jobs])

  const rangeDays = useMemo(() => {
    if (range === 'all') {
      return [...new Set(jobs.map(j => j.day).filter(Boolean))].sort() as string[]
    }
    const n = parseInt(range)
    const days: string[] = []
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      days.push(isoD(d))
    }
    return days
  }, [range, jobs])

  const filtJobs = useMemo(() => {
    let out = jobs.filter(j => j.status !== 'cancelled' && rangeDays.includes(j.day))
    if (!mReason.has('ALL')) out = out.filter(j => mReason.has(j.tbReason || ''))
    if (!mLoc.has('ALL')) out = out.filter(j => mLoc.has(locLabel(j.tbCallNum) || ''))
    return out
  }, [jobs, rangeDays, mReason, mLoc, locLabel])

  const driverStats = drivers.map(d => {
    const dj        = filtJobs.filter(j => j.driverId === d.id)
    const totalH    = dj.reduce((s, j) => s + jobTotal(j), 0)
    const totalMi   = dj.reduce((s, j) => s + jobMiles(j), 0)
    const completed = dj.filter(j => j.status === 'complete').length
    const actH      = dj.filter(j => j.startedAt && j.completedAt).reduce((s, j) => s + (new Date(j.completedAt!).getTime() - new Date(j.startedAt!).getTime()) / 3600000, 0)
    const workDays  = Math.max(rangeDays.length, 1)
    const capH      = hpd * workDays
    return { ...d, totalJobs: dj.length, totalH, totalMi, completed, actualH: actH, utilPct: capH > 0 ? totalH / capH * 100 : 0, avgH: dj.length > 0 ? totalH / dj.length : 0 }
  }).sort((a, b) => b.totalH - a.totalH)

  const typeBreak: Record<string, number> = {}
  filtJobs.forEach(j => { const r = j.tbReason || 'OTHER'; typeBreak[r] = (typeBreak[r] || 0) + 1 })
  const typeEntries = Object.entries(typeBreak).sort((a, b) => b[1] - a[1])
  const typeTotal   = typeEntries.reduce((s, e) => s + e[1], 0)

  const defaultStaff = 8
  const trendDays = useMemo(() => {
    const show = rangeDays.slice(-Math.min(rangeDays.length, 14))
    return show.map(iso => {
      const dj     = filtJobs.filter(j => j.day === iso)
      const totalH = dj.reduce((s, j) => s + jobTotal(j), 0)
      const staff  = staffing[iso] != null ? staffing[iso] : defaultStaff
      const cap    = staff * hpd
      return { iso, n: dj.length, totalH, cap, pct: cap > 0 ? totalH / cap * 100 : 0 }
    })
  }, [filtJobs, rangeDays, staffing, hpd])

  const fleetTotalH  = driverStats.reduce((s, d) => s + d.totalH,  0)
  const fleetTotalMi = driverStats.reduce((s, d) => s + d.totalMi, 0)
  const fleetActualH = driverStats.reduce((s, d) => s + d.actualH, 0)
  const fleetCapH    = rangeDays.reduce((s, iso) => { const st = staffing[iso] != null ? staffing[iso] : defaultStaff; return s + st * hpd }, 0)
  const fleetUtil    = fleetCapH > 0 ? fleetTotalH / fleetCapH * 100 : 0
  const completedCount = filtJobs.filter(j => j.status === 'complete').length

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, val: string) => {
    setter(prev => {
      const next = new Set(prev)
      if (val === 'ALL') return new Set(['ALL'])
      next.delete('ALL')
      if (next.has(val)) next.delete(val); else next.add(val)
      return next.size === 0 ? new Set(['ALL']) : next
    })
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Driver Metrics</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {RANGE_OPTS.map(([k, l]) => <button key={k} className={'fbtn' + (range === k ? ' on' : '')} onClick={() => setRange(k)}>{l}</button>)}
        </div>
      </div>

      {allReasons.length > 1 && (
        <div className="fb" style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 9, color: C.dm, fontWeight: 600, alignSelf: 'center', marginRight: 2 }}>JOB TYPE:</span>
          {allReasons.map(r => (
            <button key={r} className={'fbtn' + (mReason.has(r) ? ' on' : '')} onClick={() => toggleSet(setMReason, r)}>
              {r === 'ALL' ? 'All' : r}
            </button>
          ))}
        </div>
      )}

      <div className="fb" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: C.dm, fontWeight: 600, alignSelf: 'center', marginRight: 2 }}>LOCATION:</span>
        {['ALL', 'NETC', "Matt Brown's", "Ray's", 'Interstate'].map(loc => (
          <button key={loc} className={'fbtn' + (mLoc.has(loc) ? ' on' : '')} onClick={() => toggleSet(setMLoc, loc)}>
            {loc === 'ALL' ? 'All' : loc}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
        <div className="dash-card" style={{ background: C.ad }}><div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase', marginBottom: 3 }}>Fleet Utilization</div><div style={{ fontSize: 28, fontWeight: 800, color: fleetUtil > 80 ? C.am : C.gn }}>{Math.round(fleetUtil)}%</div></div>
        <div className="dash-card" style={{ background: C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase', marginBottom: 3 }}>Est Hours</div><div style={{ fontSize: 28, fontWeight: 800, color: C.ac }}>{fD(fleetTotalH)}</div>{fleetActualH > 0 && <div style={{ fontSize: 9, color: C.dm }}>Actual: {fD(fleetActualH)}</div>}</div>
        <div className="dash-card" style={{ background: C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase', marginBottom: 3 }}>Total Miles</div><div style={{ fontSize: 28, fontWeight: 800, color: C.pu }}>{Math.round(fleetTotalMi).toLocaleString()}</div></div>
        <div className="dash-card" style={{ background: C.cd }}><div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase', marginBottom: 3 }}>Jobs</div><div style={{ fontSize: 28, fontWeight: 800, color: C.am }}>{filtJobs.length}</div><div style={{ fontSize: 9, color: C.gn }}>{completedCount} completed</div></div>
      </div>

      {trendDays.length > 0 && (
        <div style={{ ...cB, padding: 14, marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Daily Trend</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 100 }}>
            {trendDays.map(s => {
              const h   = Math.max(s.pct, 3)
              const col = s.pct >= 90 ? C.rd : s.pct >= 70 ? C.am : C.gn
              return (
                <div key={s.iso} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: col, marginBottom: 2 }}>{s.n}</div>
                  <div style={{ height: 80, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <div style={{ height: Math.min(h, 100) + '%', background: col + '44', border: '1px solid ' + col, borderRadius: 3, minHeight: 4 }} />
                  </div>
                  <div style={{ fontSize: 9, color: s.iso === viewDay ? C.ac : C.dm, fontWeight: s.iso === viewDay ? 700 : 400, marginTop: 3 }}>{dayNm(s.iso)}</div>
                  <div style={{ fontSize: 8, color: C.dm }}>{fD(s.totalH)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {typeEntries.length > 0 && (
        <div style={{ ...cB, padding: 14, marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Job Types</div>
          {typeEntries.map(([type, count]) => {
            const pct = typeTotal > 0 ? count / typeTotal * 100 : 0
            return (
              <div key={type} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                  <span>{type}</span><span style={{ color: C.ac, fontWeight: 700 }}>{count} ({Math.round(pct)}%)</span>
                </div>
                <div style={{ height: 6, background: C.sf, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: pct + '%', background: C.ac, borderRadius: 3 }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ ...cB, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Driver Scorecards — {range === 'all' ? 'All Time' : RANGE_OPTS.find(r => r[0] === range)?.[1]}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px 70px 70px 70px 60px', gap: 4, fontSize: 10 }}>
          <div style={{ fontWeight: 700, color: C.dm }}>Driver</div>
          <div style={{ fontWeight: 700, color: C.dm, textAlign: 'right' }}>Est Hrs</div>
          <div style={{ fontWeight: 700, color: C.dm, textAlign: 'right' }}>Act Hrs</div>
          <div style={{ fontWeight: 700, color: C.dm, textAlign: 'right' }}>Miles</div>
          <div style={{ fontWeight: 700, color: C.dm, textAlign: 'right' }}>Jobs</div>
          <div style={{ fontWeight: 700, color: C.dm, textAlign: 'right' }}>Done</div>
          <div style={{ fontWeight: 700, color: C.dm, textAlign: 'right' }}>Avg Hrs</div>
          {driverStats.map(d => {
            const col = d.utilPct >= 80 ? C.am : d.utilPct >= 50 ? C.gn : C.dm
            return (
              <div key={d.id} style={{ display: 'contents' }}>
                <div style={{ fontWeight: 600 }}>{d.name}{d.truck ? ' #' + d.truck : ''}</div>
                <div style={{ textAlign: 'right', color: C.ac }}>{fD(d.totalH)}</div>
                <div style={{ textAlign: 'right', color: d.actualH > 0 ? C.pu : C.dm }}>{d.actualH > 0 ? fD(d.actualH) : '--'}</div>
                <div style={{ textAlign: 'right', color: C.pu }}>{Math.round(d.totalMi)}</div>
                <div style={{ textAlign: 'right' }}>{d.totalJobs}</div>
                <div style={{ textAlign: 'right', color: C.gn }}>{d.completed}</div>
                <div style={{ textAlign: 'right', color: col, fontWeight: 700 }}>{fH(d.avgH)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
