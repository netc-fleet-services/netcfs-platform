import { db } from './db'
import { YARDS } from './config'
import type { Coords, RouteResult, GeoCache, RouteCache, Job } from './types'

// ── 3-Digit ZIP → Approx Coordinates ──────────────────────────────
const ZIP3: Record<string, [number, number, string]> = {
  "010":[42.10,-72.59,"Springfield MA"],"011":[42.10,-72.59,"Springfield MA"],
  "012":[42.45,-73.25,"Pittsfield MA"],"013":[42.58,-72.60,"Northampton MA"],
  "014":[42.47,-71.80,"Fitchburg MA"],"015":[42.27,-71.80,"Worcester MA"],
  "016":[42.20,-71.85,"Worcester MA"],"017":[42.30,-71.42,"Framingham MA"],
  "018":[42.50,-71.15,"Lowell MA"],"019":[42.47,-70.95,"Lynn MA"],
  "020":[42.08,-71.02,"Brockton MA"],"021":[42.36,-71.06,"Boston MA"],
  "022":[42.34,-71.05,"Boston MA"],"023":[42.08,-70.95,"South Shore MA"],
  "024":[42.45,-71.23,"Lexington MA"],"025":[41.74,-70.62,"Buzzards Bay MA"],
  "026":[41.65,-70.30,"Cape Cod MA"],"027":[41.64,-70.93,"New Bedford MA"],
  "028":[41.82,-71.41,"Providence RI"],"029":[41.75,-71.45,"S Providence RI"],
  "030":[42.99,-71.46,"Manchester NH"],"031":[43.00,-71.46,"Manchester NH"],
  "032":[43.21,-71.54,"Concord NH"],"033":[43.30,-71.67,"N Concord NH"],
  "034":[42.93,-72.28,"Keene NH"],"035":[44.30,-71.77,"Littleton NH"],
  "036":[43.37,-72.12,"Charlestown NH"],"037":[43.63,-72.25,"Lebanon NH"],
  "038":[43.07,-70.76,"Portsmouth NH"],"039":[43.20,-70.65,"Kittery ME"],
  "040":[43.66,-70.26,"Portland ME"],"041":[43.70,-70.30,"Portland ME"],
  "042":[44.10,-70.22,"Lewiston ME"],"043":[44.31,-69.78,"Augusta ME"],
  "044":[44.80,-68.77,"Bangor ME"],"045":[43.91,-69.82,"Bath ME"],
  "046":[44.54,-68.42,"Ellsworth ME"],"047":[46.13,-67.84,"Houlton ME"],
  "048":[44.10,-69.11,"Rockland ME"],"049":[44.55,-69.63,"Waterville ME"],
  "050":[43.65,-72.32,"White River Jct VT"],"051":[43.13,-72.44,"Bellows Falls VT"],
  "052":[42.88,-73.20,"Bennington VT"],"053":[42.85,-72.56,"Brattleboro VT"],
  "054":[44.48,-73.21,"Burlington VT"],"055":[42.66,-71.14,"Andover MA"],
  "056":[44.50,-73.15,"Burlington VT"],"057":[43.61,-72.97,"Rutland VT"],
  "058":[44.42,-72.02,"St Johnsbury VT"],"059":[44.81,-73.08,"St Albans VT"],
  "060":[41.76,-72.68,"Hartford CT"],"061":[41.77,-72.68,"Hartford CT"],
  "062":[41.71,-72.21,"Willimantic CT"],"063":[41.36,-72.10,"New London CT"],
  "064":[41.54,-72.81,"Meriden CT"],"065":[41.31,-72.92,"New Haven CT"],
  "066":[41.18,-73.19,"Bridgeport CT"],"067":[41.56,-73.04,"Waterbury CT"],
  "068":[41.05,-73.54,"Stamford CT"],"069":[41.40,-73.45,"Danbury CT"],
}

// ── City Name → ZIP Prefix ─────────────────────────────────────────
const CITY_ZIP: Record<string, string> = {
  "andover":"018","assonet":"027","auburn":"030","auburn me":"042","augusta":"043",
  "baileyville":"046","bangor":"044","bar harbor":"046","bartlett":"038","bath":"045",
  "bedford":"030","belmont":"032","bennington":"052","berwick":"039","beverly":"019",
  "biddeford":"040","boston":"021","bow":"032","bradford":"032","brattleboro":"053",
  "brentwood":"038","brewer":"044","bridgeport":"066","brockton":"023","brunswick":"040",
  "burlington":"054","cambridge":"021","camden":"048","canterbury":"032","caribou":"047",
  "charlestown":"036","chelmsford":"018","chelsea":"021","chichester":"032","chicopee":"010",
  "claremont":"036","concord":"032","conway":"038","cranston":"028","derry":"030",
  "dover":"038","dracut":"018","durham":"038","east boston":"021","ellsworth":"046",
  "enfield":"037","epping":"038","epsom":"032","exeter":"038","exeter ri":"028",
  "fall river":"027","fitchburg":"014","framingham":"017","franconia":"035","freeport":"040",
  "gardiner":"043","gilford":"032","goffstown":"030","groveland":"018","hampstead":"038",
  "hampton":"038","hanover":"037","hartford":"061","hartford vt":"050","haverhill":"018",
  "henniker":"032","holyoke":"010","hooksett":"032","hopkinton":"032","hopkinton ma":"017",
  "houlton":"047","hudson":"030","jackson":"038","jaffrey":"034","keene":"034",
  "kennebunk":"040","kingston":"038","kittery":"039","laconia":"032","lawrence":"018",
  "lebanon":"037","leominster":"014","lewiston":"042","lincoln":"035","littleton":"035",
  "londonderry":"030","loudon":"032","lowell":"018","lynn":"019","malden":"021",
  "manchester":"030","marblehead":"019","marlborough":"017","medford":"021","meredith":"032",
  "merrimack":"030","methuen":"018","milford":"017","montpelier":"056","nashua":"030",
  "natick":"017","new bedford":"027","new haven":"065","newmarket":"038","newport":"036",
  "north andover":"018","north conway":"038","northwood":"032","norwich":"050",
  "old orchard beach":"040","orono":"044","peabody":"019","pembroke":"032",
  "peterborough":"034","plaistow":"038","portland":"041","portsmouth":"038",
  "presque isle":"047","providence":"028","quincy":"021","revere":"021","rochester":"038",
  "rockland":"048","rutland":"057","saco":"040","salem":"019","salisbury":"032",
  "sanford":"040","scarborough":"040","seabrook":"038","somersworth":"038","somerville":"021",
  "south portland":"041","springfield":"011","st albans":"059","st johnsbury":"058",
  "stamford":"068","swanzey":"034","taunton":"027","tewksbury":"018","tilton":"032",
  "topsham":"040","warner":"032","warwick":"028","waterville":"049","wellesley":"017",
  "wells":"040","west greenwich":"028","westbrook":"041","westfield":"010","weymouth":"021",
  "white river junction":"050","windham":"030","woodstock":"035","worcester":"016",
  "york":"039","knox":"048","etna":"037","west springfield":"010","agawam":"010","sturbridge":"015",
}

// ── Geocoding Cache ────────────────────────────────────────────────
export const geoCache: GeoCache = {
  "156 Epping Rd, Exeter NH":        { lat: 42.9814, lon: -70.9319, name: "Exeter, NH" },
  "107 Sheep Davis Rd, Pembroke NH": { lat: 43.1473, lon: -71.4579, name: "Pembroke, NH" },
  "26 Thibeault Dr, Bow NH":         { lat: 43.1379, lon: -71.4792, name: "Bow, NH" },
  "305 Bradley St, Saco ME":         { lat: 43.5084, lon: -70.4618, name: "Saco, ME" },
}

// ── Route Cache ────────────────────────────────────────────────────
export const routeCache: RouteCache = {}
if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem('ghRouteCache')
    if (stored) Object.assign(routeCache, JSON.parse(stored))
  } catch { /* */ }
}

// ── ZIP3 Lookup ────────────────────────────────────────────────────
export function lz(z: string | null | undefined): { lat: number; lon: number; label: string } | null {
  const s = (z || '').replace(/\D/g, '')
  if (s.length < 3) return null
  const d = ZIP3[s.substring(0, 3)]
  return d ? { lat: d[0], lon: d[1], label: d[2] } : null
}

// ── City Lookup ────────────────────────────────────────────────────
export function cityLookup(addr: string): { lat: number; lon: number } | null {
  if (!addr) return null
  const a = addr.toLowerCase().replace(/[^a-z\s,]/g, '').trim()
  const m = a.match(/([a-z\s]+),?\s*(ma|me|nh|vt|ri|ct)\b/)
  if (!m) return null
  const words = m[1].trim().split(/\s+/)
  const st = m[2]
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    const city = words.slice(-n).join(' ')
    if (CITY_ZIP[city]) return lz(CITY_ZIP[city] + '00')
    if (CITY_ZIP[city + ' ' + st]) return lz(CITY_ZIP[city + ' ' + st] + '00')
  }
  return null
}

// ── Coordinate Resolution ──────────────────────────────────────────
export function crd(addr: string | null | undefined, zip: string | null | undefined): Coords | null {
  if (addr && geoCache[addr]) return geoCache[addr]
  const z = lz(zip)
  if (z) return { lat: z.lat, lon: z.lon, name: z.label }
  const cl = cityLookup(addr || '')
  if (cl) return cl as Coords
  return null
}

export function jobCrd(j: Job, which: 'pickup' | 'drop'): Coords | null {
  const lat = which === 'pickup' ? j.pickupLat : j.dropLat
  const lon = which === 'pickup' ? j.pickupLon : j.dropLon
  if (lat != null && lon != null) return { lat, lon, name: '' }
  const addr = which === 'pickup' ? j.pickupAddr : j.dropAddr
  const zip  = which === 'pickup' ? j.pickupZip  : j.dropZip
  return crd(addr, zip)
}

// ── Distance Math ──────────────────────────────────────────────────
function hav(a: number, b: number, c: number, d: number): number {
  const R = 3958.8
  const x = (c - a) * Math.PI / 180
  const y = (d - b) * Math.PI / 180
  const s = Math.sin(x / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(y / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

export function dMi(c1: Coords | null, c2: Coords | null): number {
  if (!c1 || !c2) return 0
  return hav(c1.lat, c1.lon, c2.lat, c2.lon) * 1.25
}

// ── Nominatim Geocoding ────────────────────────────────────────────
export async function geocode(addr: string): Promise<Coords | null> {
  if (!addr || geoCache[addr]) return geoCache[addr] || null

  const zipM   = addr.match(/\b[A-Za-z]{2}\s*(\d{5})\b/)
  const zip    = zipM ? zipM[1] : ((addr.match(/\b(\d{5})\b/) || [])[1] || null)
  const stateM = addr.match(/\b([A-Za-z]{2})\s*(?:\d{5}(?:-\d{4})?)?\s*$/)
  const addrSt = stateM ? stateM[1].toUpperCase() : null

  try {
    const r = await fetch(
      'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(addr) +
      '&format=json&limit=1&countrycodes=us&addressdetails=1',
      { headers: { 'User-Agent': 'NETC-Planner' } }
    )
    const d = await r.json()
    let res: Coords | null = null

    if (d && d[0]) {
      const ad         = d[0].address || {}
      const returnedSt = ((ad['ISO3166-2-lvl4'] || '').split('-')[1] || '').toUpperCase()
      let regionOk   = true

      if (zip) {
        const returnedZip = (ad.postcode || '').replace(/\D/g, '')
        if (returnedZip && returnedZip.substring(0, 3) !== zip.substring(0, 3)) regionOk = false
      } else if (addrSt && returnedSt) {
        if (returnedSt !== addrSt) regionOk = false
      }

      if (regionOk) {
        const city   = ad.city || ad.town || ad.village || ad.hamlet || ad.suburb || ad.county || ''
        const stCode = returnedSt || (ad.state || '').substring(0, 2).toUpperCase()
        const nm     = city && stCode ? city + ', ' + stCode : d[0].display_name.split(',')[0].trim()
        res = { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon), name: nm }
      }
    }

    if (!res && zip) {
      const z = lz(zip)
      if (z) res = { lat: z.lat, lon: z.lon, name: z.label }
    }
    if (!res) {
      const cl = cityLookup(addr)
      if (cl) res = { lat: cl.lat, lon: cl.lon, name: cityFrom(addr) || addr }
    }

    if (res) {
      geoCache[addr] = res
      db.saveGeocode(addr, res)
      return res
    }
  } catch { /* */ }
  return null
}

export async function batchGeo(addrs: string[], onP?: (done: number, total: number) => void): Promise<void> {
  const u = [...new Set(addrs.filter(Boolean))].filter(a => !geoCache[a])
  let done = 0
  for (const a of u) {
    await geocode(a)
    done++
    if (onP) onP(done, u.length)
    if (done < u.length) await new Promise(r => setTimeout(r, 1100))
  }
}

// ── GraphHopper Routing ────────────────────────────────────────────
function routeKey(points: Coords[]): string {
  return points.map(p => p.lat.toFixed(4) + ',' + p.lon.toFixed(4)).join('|')
}

export function routeLookup(points: (Coords | null)[]): RouteResult | null {
  if (!points || points.length < 2) return null
  for (const p of points) {
    if (!p || p.lat == null || p.lon == null) return null
  }
  return routeCache[routeKey(points as Coords[])] || null
}

export async function ghRoute(points: (Coords | null)[]): Promise<RouteResult | null> {
  if (!points || points.length < 2) return null
  const key = process.env.NEXT_PUBLIC_GRAPHHOPPER_KEY
  if (!key) return null
  for (const p of points) {
    if (!p || p.lat == null || p.lon == null) return null
  }
  const validPts = points as Coords[]
  const cacheKey = routeKey(validPts)
  if (routeCache[cacheKey]) return routeCache[cacheKey]

  const qs = validPts.map(p => 'point=' + p.lat.toFixed(6) + ',' + p.lon.toFixed(6)).join('&')
  const url = 'https://graphhopper.com/api/1/route?' + qs +
    '&vehicle=car&locale=en&points_encoded=true&details=toll&key=' + encodeURIComponent(key)

  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const d = await r.json()
    const path = d && d.paths && d.paths[0]
    if (!path) return null

    const tollSegs = (path.details && path.details.toll) || []
    const hasTolls = tollSegs.some((s: unknown[]) => s[2] && s[2] !== 'no')

    const result: RouteResult = {
      miles: path.distance / 1609.344,
      hours: path.time / 3600000,
      hasTolls,
      tollSegments: tollSegs,
    }

    routeCache[cacheKey] = result
    try { localStorage.setItem('ghRouteCache', JSON.stringify(routeCache)) } catch { /* */ }
    db.saveRoute(cacheKey, result)
    return result
  } catch {
    return null
  }
}

// ── Yard Helpers ───────────────────────────────────────────────────
export function yCrd(y: { addr: string; zip: string }): Coords | null {
  return crd(y.addr, y.zip)
}

export function closestYard(pa: string, pz: string | null) {
  const pc = crd(pa, pz)
  if (!pc) {
    const addr = (pa || '').toUpperCase()
    if (addr.indexOf(', ME') > -1 || addr.indexOf(' ME ') > -1 || addr.indexOf(' MAINE') > -1)
      return YARDS.find(y => y.id === 'rays') || YARDS[0]
    if (addr.indexOf('BOW') > -1 || addr.indexOf('CONCORD') > -1)
      return YARDS.find(y => y.id === 'mattbrowns') || YARDS[0]
    return YARDS[0]
  }
  let b = YARDS[0]
  let bd = Infinity
  YARDS.forEach(y => {
    const yc = yCrd(y)
    if (yc) {
      const dist = hav(pc.lat, pc.lon, yc.lat, yc.lon)
      if (dist < bd) { bd = dist; b = y }
    }
  })
  return b
}

// ── City extraction ────────────────────────────────────────────────
export function cityFrom(addr: string | null | undefined): string {
  if (!addr) return ''
  const m = addr.match(/\b([A-Za-z]{3,}),?\s+([A-Za-z]{2})\s*\d{0,5}(?:-\d{4})?\s*$/)
  if (m) return m[1] + ', ' + m[2].toUpperCase()
  return ''
}
