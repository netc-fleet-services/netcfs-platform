import { YARDS } from './config'
import { crd, dMi, routeLookup, jobCrd } from './geo'
import type { Job, Stop } from './types'

// ── LocalStorage Persistence ───────────────────────────────────────
export const LS = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem('netc_' + k)
      return v ? (JSON.parse(v) as T) : d
    } catch { return d }
  },
  set(k: string, v: unknown): void {
    try { localStorage.setItem('netc_' + k, JSON.stringify(v)) } catch { /* */ }
  },
}

// ── Date / Time Helpers ────────────────────────────────────────────
export function fH(h: number | null | undefined): string {
  if (h == null || isNaN(h)) return '--'
  if (h < 0) return '0m'
  const hr = Math.floor(h), m = Math.round((h - hr) * 60)
  return hr > 0 ? hr + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm'
}

export function fD(h: number | null | undefined): string { return ((h || 0) as number).toFixed(1) + 'h' }

export function fT(d: string | Date): string {
  return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function fMi(m: number | null | undefined): string { return Math.round(m || 0) + ' mi' }

export function dLb(d: { name: string; truck: string }): string {
  return d.truck ? d.name + ' #' + d.truck : d.name
}

export function isoD(d: Date): string {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}

export function todayISO(): string { return isoD(new Date()) }
export function tmrwISO(): string { const d = new Date(); d.setDate(d.getDate() + 1); return isoD(d) }

export function dayNm(iso: string): string {
  if (iso === todayISO()) return 'Today'
  if (iso === tmrwISO()) return 'Tmrw'
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
}

export function dayFull(iso: string): string {
  if (iso === todayISO()) return 'Today'
  if (iso === tmrwISO()) return 'Tomorrow'
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export function daySh(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
}

export function genDays(n: number): string[] {
  const o: string[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(); d.setDate(d.getDate() + i); o.push(isoD(d))
  }
  return o
}

// ── Job Time / Distance Calculation ───────────────────────────────
export function jCalc(
  ya: string, yz: string,
  pa: string, pz: string | null,
  da: string, dz: string | null,
  stops: Stop[],
  _pc?: ReturnType<typeof crd>,
  _dc?: ReturnType<typeof crd>
) {
  const yc = crd(ya, yz)
  const pc = _pc !== undefined ? _pc : crd(pa, pz)
  const dc = _dc !== undefined ? _dc : crd(da, dz)

  if (!stops || stops.length === 0) {
    const m1 = dMi(yc, pc), m2 = dMi(pc, dc), m3 = dMi(dc, yc)
    const driveMi = m1 + m2 + m3
    let driveHr = driveMi / 45
    const gh = routeLookup([yc, pc, dc, yc])
    if (gh) { driveHr = gh.hours }
    return {
      h1: m1/45, h2: m2/45, h3: m3/45, m1, m2, m3,
      total: (gh ? gh.hours : driveHr) + 1,
      totalMi: gh ? gh.miles : driveMi,
      legs: null, luH: 1, fromGH: !!gh,
    }
  }

  const pts = [
    { c: yc, label: 'Yard', addr: ya },
    { c: pc, label: 'Pickup', addr: pa },
    ...stops.map((s, i) => ({ c: crd(s.addr, s.zip), label: s.name || ('Stop ' + (i + 1)), addr: s.addr || '' })),
    { c: dc, label: 'Drop', addr: da },
    { c: yc, label: 'Yard', addr: ya },
  ]

  const legs = []
  let tm = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const mi = dMi(pts[i].c, pts[i + 1].c)
    legs.push({ from: pts[i].label, to: pts[i + 1].label, mi, hr: mi / 45, fromAddr: pts[i].addr, toAddr: pts[i + 1].addr })
    tm += mi
  }
  const luH = Math.max(1, 0.5 * (pts.length - 2))
  const m1b = legs[0]?.mi || 0
  const m2b = legs.length > 2 ? legs.slice(1, -1).reduce((s, l) => s + l.mi, 0) : 0
  const m3b = legs[legs.length - 1]?.mi || 0
  const ghM = routeLookup(pts.map(p => p.c))

  return {
    h1: m1b/45, h2: m2b/45, h3: m3b/45, m1: m1b, m2: m2b, m3: m3b,
    total: (ghM ? ghM.hours : tm / 45) + luH,
    totalMi: ghM ? ghM.miles : tm,
    legs, luH, multiLeg: true, fromGH: !!ghM,
  }
}

export function jobTotal(j: Job): number {
  const yd = YARDS.find(y => y.id === j.yardId) || YARDS[0]
  if (!yd) return 1
  const stops = j.stops || []
  const pc = jobCrd(j, 'pickup')
  const dc = jobCrd(j, 'drop')
  if (stops.length === 0) return jCalc(yd.addr, yd.zip, j.pickupAddr, j.pickupZip, j.dropAddr, j.dropZip, [], pc, dc).total
  const pts = [crd(yd.addr, yd.zip), pc]
  stops.forEach(s => pts.push(crd(s.addr, s.zip)))
  pts.push(dc, crd(yd.addr, yd.zip))
  const luH = Math.max(1, 0.5 * stops.length + 1)
  const gh = routeLookup(pts)
  if (gh) return gh.hours + luH
  let tm = 0
  for (let i = 0; i < pts.length - 1; i++) tm += dMi(pts[i], pts[i + 1])
  return tm / 45 + luH
}

export function jobMiles(j: Job): number {
  const yd = YARDS.find(y => y.id === j.yardId) || YARDS[0]
  if (!yd) return 0
  const stops = j.stops || []
  const pc = jobCrd(j, 'pickup')
  const dc = jobCrd(j, 'drop')
  if (stops.length === 0) {
    return jCalc(yd.addr, yd.zip, j.pickupAddr, j.pickupZip, j.dropAddr, j.dropZip, [], pc, dc).totalMi
  }
  const pts = [crd(yd.addr, yd.zip), pc]
  stops.forEach(s => pts.push(crd(s.addr, s.zip)))
  pts.push(dc, crd(yd.addr, yd.zip))
  const gh = routeLookup(pts)
  if (gh) return gh.miles
  let tm = 0
  for (let i = 0; i < pts.length - 1; i++) tm += dMi(pts[i], pts[i + 1])
  return tm
}
