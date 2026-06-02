'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { C, cB, bP, bSt, iS, sS, uid } from '../lib/config'
import { crd, geocode, geoCache, dMi, lz, cityFrom, yCrd } from '../lib/geo'
import { fH, fD, fMi, isoD, tmrwISO, dayFull } from '../lib/utils'
import { db } from '../lib/db'
import type { Yard, Coords } from '../lib/types'
import type { MapRun } from './MapView'

// Map style options (kept here so importing MapView's value exports doesn't
// pull Leaflet into the SSR bundle). Must match TILE_DEFS in MapView.tsx.
const MAP_STYLES: { id: string; name: string }[] = [
  { id: 'voyager',   name: 'Streets (soft)' },
  { id: 'standard',  name: 'Streets (OSM)' },
  { id: 'light',     name: 'Light / minimal' },
  { id: 'dark',      name: 'Dark' },
  { id: 'satellite', name: 'Satellite' },
]

// Leaflet needs the browser; load the map only on the client.
const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div style={{ height: 620, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dm, fontSize: 11, background: C.cd, borderRadius: 8 }}>Loading map…</div>,
})

// Distinct line colors per run.
const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#a78bfa', '#ef4444', '#14b8a6', '#ec4899', '#84cc16', '#06b6d4', '#f97316']

// Job time per stop. Mirrors the dispatch board's service-time rule
// (jobTotal in lib/utils.ts: max(1h, 0.5h × stops)) so a run planned here
// matches the committed load the board would show for the same call.
const STOP_SERVICE_MIN = 30

const US_STATES: { abbr: string; name: string }[] = [
  { abbr: 'AL', name: 'Alabama' }, { abbr: 'AK', name: 'Alaska' }, { abbr: 'AZ', name: 'Arizona' },
  { abbr: 'AR', name: 'Arkansas' }, { abbr: 'CA', name: 'California' }, { abbr: 'CO', name: 'Colorado' },
  { abbr: 'CT', name: 'Connecticut' }, { abbr: 'DE', name: 'Delaware' }, { abbr: 'FL', name: 'Florida' },
  { abbr: 'GA', name: 'Georgia' }, { abbr: 'HI', name: 'Hawaii' }, { abbr: 'ID', name: 'Idaho' },
  { abbr: 'IL', name: 'Illinois' }, { abbr: 'IN', name: 'Indiana' }, { abbr: 'IA', name: 'Iowa' },
  { abbr: 'KS', name: 'Kansas' }, { abbr: 'KY', name: 'Kentucky' }, { abbr: 'LA', name: 'Louisiana' },
  { abbr: 'ME', name: 'Maine' }, { abbr: 'MD', name: 'Maryland' }, { abbr: 'MA', name: 'Massachusetts' },
  { abbr: 'MI', name: 'Michigan' }, { abbr: 'MN', name: 'Minnesota' }, { abbr: 'MS', name: 'Mississippi' },
  { abbr: 'MO', name: 'Missouri' }, { abbr: 'MT', name: 'Montana' }, { abbr: 'NE', name: 'Nebraska' },
  { abbr: 'NV', name: 'Nevada' }, { abbr: 'NH', name: 'New Hampshire' }, { abbr: 'NJ', name: 'New Jersey' },
  { abbr: 'NM', name: 'New Mexico' }, { abbr: 'NY', name: 'New York' }, { abbr: 'NC', name: 'North Carolina' },
  { abbr: 'ND', name: 'North Dakota' }, { abbr: 'OH', name: 'Ohio' }, { abbr: 'OK', name: 'Oklahoma' },
  { abbr: 'OR', name: 'Oregon' }, { abbr: 'PA', name: 'Pennsylvania' }, { abbr: 'RI', name: 'Rhode Island' },
  { abbr: 'SC', name: 'South Carolina' }, { abbr: 'SD', name: 'South Dakota' }, { abbr: 'TN', name: 'Tennessee' },
  { abbr: 'TX', name: 'Texas' }, { abbr: 'UT', name: 'Utah' }, { abbr: 'VT', name: 'Vermont' },
  { abbr: 'VA', name: 'Virginia' }, { abbr: 'WA', name: 'Washington' }, { abbr: 'WV', name: 'West Virginia' },
  { abbr: 'WI', name: 'Wisconsin' }, { abbr: 'WY', name: 'Wyoming' },
]

interface StopInput {
  city: string   // city or ZIP or street line
  state: string  // 2-letter, optional
}

const stopText = (s: StopInput): string => {
  const city = s.city.trim()
  if (!city) return ''
  return s.state ? `${city}, ${s.state}` : city
}

interface ResolvedStop {
  text: string
  coords: Coords | null
  label: string
  failed: boolean   // had text but couldn't be located
}

interface RunCalc {
  driveH: number
  serviceH: number
  totalH: number
  miles: number
  fromGH: boolean
  resolved: ResolvedStop[]  // aligned to the stop fields at route time
  goodCount: number
  yardCoords: Coords | null
  geometry?: [number, number][]  // [lat, lon] road path from GraphHopper
}

interface Run {
  id: string
  date: string        // ISO date the run is planned for; rolls with the calendar
  yardShort: string
  customer?: string   // optional, informational
  equipment?: string  // optional, informational
  calc: RunCalc
}

// Per-date staffing override (drivers / hours-per-driver). Anchored to the
// date so it rolls forward with the run data.
type Overrides = Record<string, { drivers?: number; hours?: number }>

interface PlanState {
  runs: Run[]
  staffing: Overrides
}

const PLAN_KEY = 'capacity_planner'

// 5-digit ZIP out of loose text (so a bare "04101" resolves via the ZIP table).
function zipOf(t: string): string | null {
  const m = (t || '').match(/\b(\d{5})\b/)
  return m ? m[1] : null
}

function labelFor(t: string, c: Coords | null): string {
  if (c?.name) return c.name
  const city = cityFrom(t)
  if (city) return city
  const z = lz(zipOf(t) || '')
  return z?.label || t.trim()
}

// Resolve one free-text stop to coordinates. Fast offline/cache path first
// (New-England ZIP/city tables + geocache), then the app's /api/geocode
// route (Geocodio → Nominatim, server-side, works for any US address),
// then the client Nominatim resolver as a last resort.
async function resolveStop(text: string): Promise<Coords | null> {
  // Real geocoder first — it respects "City, ST" and resolves any US place.
  // The offline ZIP/city tables are New-England-centric and mis-resolve
  // ambiguous names (e.g. "Salisbury" → NH near Concord, ignoring a picked
  // MA), so they're only a fallback when the network lookup fails.
  try {
    const res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addr: text }),
    })
    if (res.ok) {
      const d = await res.json()
      if (d && d.lat != null && d.lon != null) {
        const coords: Coords = {
          lat: Number(d.lat),
          lon: Number(d.lon),
          name: cityFrom(String(d.addr || text)) || labelFor(text, null),
        }
        geoCache[text] = coords
        return coords
      }
    }
  } catch { /* fall through */ }
  try { const g = await geocode(text); if (g) return g } catch { /* */ }
  const cached = crd(text, zipOf(text))
  return cached || null
}

const GH_KEY = process.env.NEXT_PUBLIC_GRAPHHOPPER_KEY

export function CapacityPlanner({
  yards,
  staffing,
  hpd,
}: {
  yards: Yard[]
  staffing: Record<string, number>
  hpd: number
}) {
  const day1 = tmrwISO()
  const day2 = (() => { const d = new Date(); d.setDate(d.getDate() + 2); return isoD(d) })()

  const defaultStaff = (iso: string) => (staffing[iso] != null ? staffing[iso] : 8)

  // ── Builder (Run Estimator) state ──────────────────────────────────
  const [bYard,  setBYard]  = useState<string>(yards[0]?.id || '')
  const [bStops, setBStops] = useState<StopInput[]>([{ city: '', state: '' }])
  const [bCustomer,  setBCustomer]  = useState('')
  const [bEquipment, setBEquipment] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)  // run being edited, if any
  const [routing, setRouting] = useState(false)
  const [routeResult, setRouteResult] = useState<RunCalc | null>(null)
  const [routedSig, setRoutedSig] = useState('')

  // ── Shared, persisted plan (Supabase settings row) ─────────────────
  const [runs, setRuns] = useState<Run[]>([])
  const [overrides, setOverrides] = useState<Overrides>({})

  const [confirmClear, setConfirmClear] = useState(false)
  const [mapSel, setMapSel] = useState<'both' | 'd1' | 'd2'>('both')
  const [mapStyle, setMapStyle] = useState('voyager')
  const [hidden, setHidden] = useState<Set<string>>(new Set())   // routes hidden from the map (view-only)

  const toggleHidden = (id: string) =>
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  // Persist the whole plan as one JSONB blob (upsert; never a delete).
  const persist = (nextRuns: Run[], nextOv: Overrides) =>
    void db.saveSetting(PLAN_KEY, { runs: nextRuns, staffing: nextOv } satisfies PlanState)

  // Load on mount, then prune anything that has rolled off (date < tomorrow).
  // What was Day 2 yesterday is Day 1 today; what was Day 1 becomes today and
  // drops out. Save back only if pruning actually removed something.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const data = await db.loadSetting<Partial<PlanState>>(PLAN_KEY, { runs: [], staffing: {} })
      if (cancelled) return
      const allRuns = Array.isArray(data?.runs) ? (data.runs as Run[]) : []
      const ov = (data?.staffing && typeof data.staffing === 'object') ? (data.staffing as Overrides) : {}
      const keep = new Set([day1, day2])
      const prunedRuns = allRuns.filter(r => keep.has(r.date))
      const prunedOv: Overrides = {}
      for (const d of keep) if (ov[d]) prunedOv[d] = ov[d]
      setRuns(prunedRuns)
      setOverrides(prunedOv)
      if (prunedRuns.length !== allRuns.length || Object.keys(prunedOv).length !== Object.keys(ov).length) {
        persist(prunedRuns, prunedOv)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const yard = useMemo(() => yards.find(y => y.id === bYard) || yards[0], [yards, bYard])

  // Signature of the current inputs; if it drifts from what we last routed,
  // the shown result is stale and must be re-routed before it can be added.
  const sig = useMemo(() => bYard + '|' + bStops.map(stopText).join('>'), [bYard, bStops])
  const stale        = !!routeResult && routedSig !== sig
  const hasStops     = bStops.some(s => s.city.trim())
  const missingState = bStops.some(s => s.city.trim() && !s.state)
  const usable       = !!routeResult && !stale && routeResult.goodCount > 0

  // ── Builder actions ────────────────────────────────────────────────
  const setStop = (i: number, field: keyof StopInput, v: string) =>
    setBStops(prev => prev.map((s, idx) => (idx === i ? { ...s, [field]: v } : s)))
  const addStopField = () => setBStops(prev => [...prev, { city: '', state: '' }])
  const removeStop   = (i: number) =>
    setBStops(prev => (prev.length === 1 ? [{ city: '', state: '' }] : prev.filter((_, idx) => idx !== i)))

  async function doRoute() {
    if (!yard || !hasStops || missingState || routing) return
    setRouting(true)
    try {
      const resolved: ResolvedStop[] = []
      for (const s of bStops) {
        const text = stopText(s)
        if (!text) { resolved.push({ text: '', coords: null, label: '', failed: false }); continue }
        const c = await resolveStop(text)
        resolved.push({ text, coords: c, label: labelFor(text, c), failed: !c })
      }
      const calc = await buildCalc(yCrd(yard), resolved)
      setRouteResult(calc)
      setRoutedSig(sig)
    } finally {
      setRouting(false)
    }
  }

  function addRun(iso: string) {
    if (!usable || !yard || !routeResult) return
    const entry: Run = {
      id: editingId || uid(), date: iso, yardShort: yard.short, calc: routeResult,
      customer: bCustomer.trim() || undefined,
      equipment: bEquipment.trim() || undefined,
    }
    const next: Run[] = editingId ? runs.map(r => (r.id === editingId ? entry : r)) : [...runs, entry]
    setRuns(next)
    persist(next, overrides)
    resetBuilder()
  }

  function removeRun(id: string) {
    const next = runs.filter(r => r.id !== id)
    setRuns(next)
    persist(next, overrides)
    if (editingId === id) resetBuilder()
  }

  function resetBuilder() {
    setBStops([{ city: '', state: '' }])
    setBCustomer('')
    setBEquipment('')
    setRouteResult(null)
    setRoutedSig('')
    setEditingId(null)
  }

  // Load an existing run back into the estimator to change it. We rebuild the
  // city/state inputs from each stop's stored "City, ST" text.
  function editRun(r: Run) {
    const yId = yards.find(y => y.short === r.yardShort)?.id || yards[0]?.id || ''
    const inputs: StopInput[] = r.calc.resolved.filter(s => s.text).map(s => {
      const m = s.text.match(/^(.*),\s*([A-Za-z]{2})$/)
      return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : { city: s.text, state: '' }
    })
    const stops = inputs.length ? inputs : [{ city: '', state: '' }]
    setEditingId(r.id)
    setBYard(yId)
    setBStops(stops)
    setBCustomer(r.customer || '')
    setBEquipment(r.equipment || '')
    setRouteResult(r.calc)
    setRoutedSig(yId + '|' + stops.map(stopText).join('>'))  // matches live sig → not stale
  }

  function setDayOverride(iso: string, patch: { drivers?: number; hours?: number }) {
    const next = { ...overrides, [iso]: { ...overrides[iso], ...patch } }
    setOverrides(next)
    persist(runs, next)
  }

  function clearAll() {
    setRuns([])
    setOverrides({})
    persist([], {})
    setBStops([{ city: '', state: '' }])
    setBYard(yards[0]?.id || '')
    setBCustomer('')
    setBEquipment('')
    setRouteResult(null)
    setRoutedSig('')
    setEditingId(null)
    setHidden(new Set())
    setConfirmClear(false)
  }

  // ── Derived capacity ───────────────────────────────────────────────
  const anyApprox = runs.some(r => !r.calc.fromGH)
  const dayRuns = (iso: string) => runs.filter(r => r.date === iso)
  const dayLoad = (iso: string) => dayRuns(iso).reduce((s, r) => s + r.calc.totalH, 0)
  const driversFor = (iso: string) => overrides[iso]?.drivers ?? defaultStaff(iso)
  const hoursFor   = (iso: string) => overrides[iso]?.hours ?? hpd

  // Stable letter + color per run (A, B, C…), ordered Day 1 then Day 2, so the
  // badge in the day card matches the line + pin on the map.
  const runMeta = useMemo(() => {
    const ordered = [...runs.filter(r => r.date === day1), ...runs.filter(r => r.date === day2)]
    const m: Record<string, { letter: string; color: string }> = {}
    ordered.forEach((r, i) => {
      m[r.id] = { letter: i < 26 ? String.fromCharCode(65 + i) : '#' + (i + 1), color: PALETTE[i % PALETTE.length] }
    })
    return m
  }, [runs, day1, day2])

  // ── Map data ───────────────────────────────────────────────────────
  // Everything in the selected day(s); the legend shows all of these so any
  // can be toggled back on.
  const scopedRuns: MapRun[] = useMemo(() => {
    const list = runs.filter(r =>
      mapSel === 'both' ? (r.date === day1 || r.date === day2)
      : mapSel === 'd1' ? r.date === day1
      : r.date === day2,
    )
    return list.map(r => ({
      id: r.id,
      letter: runMeta[r.id]?.letter || '?',
      color: runMeta[r.id]?.color || '#888',
      label: `${r.customer?.trim() || r.yardShort} • ${fH(r.calc.totalH)}`,
      yard: r.calc.yardCoords ? { lat: r.calc.yardCoords.lat, lon: r.calc.yardCoords.lon } : null,
      stops: r.calc.resolved.filter(s => s.coords).map(s => ({ lat: (s.coords as Coords).lat, lon: (s.coords as Coords).lon, label: s.label })),
      geometry: r.calc.geometry,
    }))
  }, [runs, mapSel, day1, day2, runMeta])

  // Only the non-hidden routes actually draw on the map.
  const mapRuns = useMemo(() => scopedRuns.filter(r => !hidden.has(r.id)), [scopedRuns, hidden])

  // Per-field resolved status to show under each stop input.
  const resolvedFor = (i: number): ResolvedStop | null =>
    !stale && routeResult ? routeResult.resolved[i] || null : null

  return (
    <div>
      {/* Header + Clear */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Quick Capacity Planner</div>
          <div style={{ fontSize: 10, color: C.dm }}>Scratchpad — nothing here is saved. Refresh or Clear resets it.</div>
        </div>
        {confirmClear ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: C.am }}>Clear everything?</span>
            <button style={{ ...bP, background: C.rd }} onClick={clearAll}>Yes, clear</button>
            <button style={bSt} onClick={() => setConfirmClear(false)}>Cancel</button>
          </div>
        ) : (
          <button style={bSt} onClick={() => setConfirmClear(true)} disabled={!runs.length}>🗑 Clear</button>
        )}
      </div>

      {/* Mode banner */}
      {!GH_KEY ? (
        <div style={{ ...cB, background: C.ab, borderColor: C.am, fontSize: 11, color: C.am, padding: '8px 12px' }}>
          ⚠ Approximate mode — no routing key set. Times are straight-line estimates (haversine ×1.25 ÷ 45&nbsp;mph), not road routes. Don&rsquo;t treat capacity as exact.
        </div>
      ) : anyApprox ? (
        <div style={{ ...cB, background: C.ab, borderColor: C.am, fontSize: 11, color: C.am, padding: '8px 12px' }}>
          ⚠ Some runs (marked <b>approx</b>) couldn&rsquo;t be routed and fall back to straight-line estimates.
        </div>
      ) : null}

      {/* ══ Feature A — Run Estimator ══ */}
      <div style={{ ...cB, background: C.ca, borderColor: C.ac }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: editingId ? C.am : C.ac }}>
            {editingId ? `EDITING ROUTE ${runMeta[editingId]?.letter || ''}` : 'RUN ESTIMATOR — round trip out of the yard and back'}
          </div>
          {editingId && <button style={bSt} onClick={resetBuilder}>Cancel edit</button>}
        </div>

        <div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>START / END YARD</div>
        <select style={{ ...sS, marginBottom: 8 }} value={bYard} onChange={e => setBYard(e.target.value)}>
          {yards.map(y => <option key={y.id} value={y.id}>{y.short} — {y.addr}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>CUSTOMER (optional)</div>
            <input style={iS} placeholder="Customer name" value={bCustomer} onChange={e => setBCustomer(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>EQUIPMENT (optional)</div>
            <input style={iS} placeholder="e.g. excavator, flatbed" value={bEquipment} onChange={e => setBEquipment(e.target.value)} />
          </div>
        </div>

        <div style={{ fontSize: 8, color: C.dm, marginBottom: 2 }}>STOPS (city / ZIP + state, in order)</div>
        {bStops.map((s, i) => {
          const r = resolvedFor(i)
          return (
            <div key={i} style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 9, color: C.dm, width: 14, textAlign: 'right' }}>{i + 1}.</span>
                <input
                  style={{ ...iS, flex: 1 }}
                  placeholder="City, ZIP, or street (e.g. San Antonio)"
                  value={s.city}
                  onChange={e => setStop(i, 'city', e.target.value)}
                />
                <select
                  style={{ ...sS, width: 150, flex: 'none', ...(s.city.trim() && !s.state ? { border: '1px solid ' + C.rd } : {}) }}
                  value={s.state}
                  onChange={e => setStop(i, 'state', e.target.value)}
                >
                  <option value="">Select State</option>
                  {US_STATES.map(st => <option key={st.abbr} value={st.abbr}>{st.abbr}</option>)}
                </select>
                <button style={{ ...bSt, padding: '4px 8px' }} onClick={() => removeStop(i)} title="Remove stop">×</button>
              </div>
              {s.city.trim() && r && (
                <div style={{ fontSize: 8, marginLeft: 18, color: r.failed ? C.rd : C.gn }}>
                  {r.failed ? '⚠ couldn’t find this location — excluded from total' : '✓ ' + r.label}
                </div>
              )}
            </div>
          )
        })}
        <button style={{ ...bSt, marginTop: 2 }} onClick={addStopField}>+ Add stop</button>

        {/* Route button */}
        <button
          style={{ ...bP, width: '100%', marginTop: 8, opacity: hasStops && !missingState && !routing ? 1 : 0.4 }}
          disabled={!hasStops || missingState || routing}
          onClick={doRoute}
        >
          {routing ? 'Routing…' : stale ? '↻ Re-route' : '🧭 Route'}
        </button>
        {hasStops && missingState && (
          <div style={{ fontSize: 9, color: C.rd, marginTop: 4, fontWeight: 700 }}>⚠ Must select a state for every stop before routing.</div>
        )}

        {/* Result */}
        {routeResult && (
          <div style={{ background: C.sf, borderRadius: 6, padding: 10, marginTop: 8, opacity: stale ? 0.5 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 9, color: C.dm, textTransform: 'uppercase' }}>Round-trip total</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: routeResult.goodCount > 0 ? C.wh : C.dm }}>
                  {routeResult.goodCount > 0 ? fH(routeResult.totalH) : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 9, color: C.dm, lineHeight: 1.5 }}>
                {routeResult.goodCount > 0 ? (
                  <>
                    <div>{fMi(routeResult.miles)} · {routeResult.goodCount} stop{routeResult.goodCount === 1 ? '' : 's'}</div>
                    <div>drive {fH(routeResult.driveH)} + job {fH(routeResult.serviceH)}</div>
                    <div style={{ color: routeResult.fromGH ? C.gn : C.am }}>
                      {routeResult.fromGH ? '✓ GraphHopper routed' : '⚠ approx (couldn’t route)'}
                    </div>
                  </>
                ) : (
                  <div style={{ color: C.rd }}>No stops could be located</div>
                )}
              </div>
            </div>
            {stale && <div style={{ fontSize: 8, color: C.am, marginTop: 4 }}>Inputs changed — re-route before adding.</div>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button style={{ ...bP, flex: 1, opacity: usable ? 1 : 0.4 }} disabled={!usable} onClick={() => addRun(day1)}>{editingId ? 'Save to ' : '+ '}{dayFull(day1)}</button>
          <button style={{ ...bP, flex: 1, opacity: usable ? 1 : 0.4 }} disabled={!usable} onClick={() => addRun(day2)}>{editingId ? 'Save to ' : '+ '}{dayFull(day2)}</button>
        </div>
      </div>

      {/* ══ Feature B — Capacity Guardrail ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
        <DayCard
          label={dayFull(day1)} runs={dayRuns(day1)} load={dayLoad(day1)}
          drivers={driversFor(day1)} hours={hoursFor(day1)}
          onDrivers={n => setDayOverride(day1, { drivers: n })} onHours={n => setDayOverride(day1, { hours: n })}
          onRemoveRun={removeRun} meta={runMeta} hidden={hidden} onToggle={toggleHidden} onEdit={editRun} editingId={editingId}
        />
        <DayCard
          label={dayFull(day2)} runs={dayRuns(day2)} load={dayLoad(day2)}
          drivers={driversFor(day2)} hours={hoursFor(day2)}
          onDrivers={n => setDayOverride(day2, { drivers: n })} onHours={n => setDayOverride(day2, { hours: n })}
          onRemoveRun={removeRun} meta={runMeta} hidden={hidden} onToggle={toggleHidden} onEdit={editRun} editingId={editingId}
        />
      </div>

      {/* ══ Route Map ══ */}
      <div style={{ ...cB, background: C.cd, marginTop: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 800 }}>Route Map</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select style={{ ...sS, width: 140 }} value={mapStyle} onChange={e => setMapStyle(e.target.value)}>
              {MAP_STYLES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {([['both', 'Both'], ['d1', dayFull(day1)], ['d2', dayFull(day2)]] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setMapSel(k)}
                style={{ ...bSt, ...(mapSel === k ? { color: C.ac, border: '1px solid ' + C.ac } : {}) }}
              >{l}</button>
            ))}
          </div>
        </div>
        {scopedRuns.length === 0 ? (
          <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dm, fontSize: 11 }}>
            Route a run and add it to a day to see it here.
          </div>
        ) : (
          <>
            <MapView runs={mapRuns} tileStyle={mapStyle} />
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <span style={{ fontSize: 11, color: C.dm }}>Click to show/hide:</span>
              {scopedRuns.map(r => {
                const off = hidden.has(r.id)
                return (
                  <button
                    key={r.id}
                    onClick={() => toggleHidden(r.id)}
                    title={off ? 'Show on map' : 'Hide from map'}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: off ? C.dm : C.tx, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: off ? 0.55 : 1, textDecoration: off ? 'line-through' : 'none' }}
                  >
                    <span style={{ background: off ? 'transparent' : r.color, border: '1px solid ' + r.color, color: off ? r.color : '#fff', fontWeight: 800, fontSize: 11, width: 18, height: 18, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{r.letter}</span>
                    {r.label}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Day card (capacity + assigned runs) ───────────────────────────────
function DayCard({
  label, runs, load, drivers, hours, onDrivers, onHours, onRemoveRun, meta, hidden, onToggle, onEdit, editingId,
}: {
  label: string
  runs: Run[]
  load: number
  drivers: number
  hours: number
  onDrivers: (n: number) => void
  onHours: (n: number) => void
  onRemoveRun: (id: string) => void
  meta: Record<string, { letter: string; color: string }>
  hidden: Set<string>
  onToggle: (id: string) => void
  onEdit: (r: Run) => void
  editingId: string | null
}) {
  const cap  = drivers * hours
  const over = load > cap
  const pct  = cap > 0 ? (load / cap) * 100 : 0
  const col  = over ? C.rd : pct >= 90 ? C.am : C.gn

  const num = (v: string, fb: number) => { const n = parseFloat(v); return isNaN(n) ? fb : Math.max(0, n) }

  return (
    <div style={{ ...cB, background: C.cd }}>
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{label}</div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <label style={{ flex: 1 }}>
          <div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>DRIVERS</div>
          <input style={iS} type="number" min={0} value={drivers} onChange={e => onDrivers(num(e.target.value, 0))} />
        </label>
        <label style={{ flex: 1 }}>
          <div style={{ fontSize: 8, color: C.dm, marginBottom: 1 }}>HRS / DRIVER</div>
          <input style={iS} type="number" min={0} value={hours} onChange={e => onHours(num(e.target.value, 0))} />
        </label>
      </div>

      <div style={{ height: 6, background: C.sf, borderRadius: 3, overflow: 'hidden', marginBottom: 3 }}>
        <div style={{ height: '100%', width: Math.min(pct, 100) + '%', background: col, borderRadius: 3 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 8 }}>
        <span style={{ color: C.dm }}>{fD(load)} planned of {fD(cap)}</span>
        <span style={{ color: col, fontWeight: 700 }}>
          {over ? 'OVER by ' + fD(load - cap) : fD(Math.max(cap - load, 0)) + ' free'}
        </span>
      </div>

      {runs.length === 0 ? (
        <div style={{ fontSize: 10, color: C.dm, textAlign: 'center', padding: '8px 0' }}>No runs yet</div>
      ) : (
        runs.map(r => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.sf, borderRadius: 5, padding: '5px 7px', marginBottom: 4, border: '1px solid ' + (editingId === r.id ? C.ac : 'transparent') }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {(() => { const off = hidden.has(r.id); const col = meta[r.id]?.color || '#888'; return (
                <button
                  onClick={() => onToggle(r.id)}
                  title={off ? 'Show on map' : 'Hide from map'}
                  style={{ background: off ? 'transparent' : col, border: '1px solid ' + col, color: off ? col : '#fff', fontWeight: 800, fontSize: 12, width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
                >{meta[r.id]?.letter || '?'}</button>
              ) })()}
              <div onClick={() => onEdit(r)} title="Click to edit this run" style={{ minWidth: 0, cursor: 'pointer' }}>
                {r.customer ? (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 800, color: C.tx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.customer}</div>
                    <div style={{ fontSize: 12, color: C.tx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.yardShort} → {r.calc.resolved.filter(s => s.coords).map(s => s.label).join(' → ') || '…'} → {r.yardShort}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.tx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.yardShort} → {r.calc.resolved.filter(s => s.coords).map(s => s.label).join(' → ') || '…'} → {r.yardShort}
                  </div>
                )}
                <div style={{ fontSize: 11, color: C.dm }}>
                  {fMi(r.calc.miles)}
                  {r.equipment && <span> · {r.equipment}</span>}
                  {!r.calc.fromGH && <span style={{ color: C.am }}> · approx</span>}
                  {r.calc.resolved.some(s => s.failed) && <span style={{ color: C.rd }}> · {r.calc.resolved.filter(s => s.failed).length} unlocated</span>}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: C.am }}>{fH(r.calc.totalH)}</span>
              <button style={{ ...bSt, padding: '2px 6px' }} onClick={() => onRemoveRun(r.id)}>×</button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ── Estimate math ──────────────────────────────────────────────────────
function serviceHours(goodCount: number): number {
  return goodCount > 0 ? Math.max(1, (STOP_SERVICE_MIN / 60) * goodCount) : 0
}

// Planner-local GraphHopper call that also returns route geometry (for the
// map). Kept separate from the shared ghRoute() so we don't change the
// dispatch board's routing or the route_cache shape. One call per run.
async function ghRouteGeo(
  pts: Coords[],
): Promise<{ miles: number; hours: number; geometry: [number, number][] } | null> {
  const key = process.env.NEXT_PUBLIC_GRAPHHOPPER_KEY
  if (!key || pts.length < 2) return null
  const qs = pts.map(p => 'point=' + p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join('&')
  const url = 'https://graphhopper.com/api/1/route?' + qs +
    '&vehicle=car&locale=en&points_encoded=false&key=' + encodeURIComponent(key)
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const d = await r.json()
    const path = d && d.paths && d.paths[0]
    if (!path) return null
    const coords: number[][] = path.points?.coordinates || []
    const geometry = coords.map(c => [c[1], c[0]] as [number, number]) // GeoJSON [lon,lat] → [lat,lon]
    return { miles: path.distance / 1609.344, hours: path.time / 3600000, geometry }
  } catch {
    return null
  }
}

// One whole-route GraphHopper call; haversine fallback when it can't route
// (no key, API error, or unresolved points).
async function buildCalc(yc: Coords | null, resolved: ResolvedStop[]): Promise<RunCalc> {
  const good = resolved.filter(r => r.coords)
  const goodCount = good.length
  const serviceH = serviceHours(goodCount)
  if (!yc || goodCount === 0) {
    return { driveH: 0, serviceH, totalH: serviceH, miles: 0, fromGH: false, resolved, goodCount, yardCoords: yc }
  }
  const pts: Coords[] = [yc, ...good.map(r => r.coords as Coords), yc]
  const gh = await ghRouteGeo(pts)
  const driveH = gh ? gh.hours : haversineHours(pts)
  const miles  = gh ? gh.miles : haversineMiles(pts)
  return { driveH, serviceH, totalH: driveH + serviceH, miles, fromGH: !!gh, resolved, goodCount, yardCoords: yc, geometry: gh?.geometry }
}

function haversineMiles(pts: Coords[]): number {
  let mi = 0
  for (let i = 0; i < pts.length - 1; i++) mi += dMi(pts[i], pts[i + 1])
  return mi
}
function haversineHours(pts: Coords[]): number {
  return haversineMiles(pts) / 45 // 45 mph, matching jCalc's degraded mode
}
