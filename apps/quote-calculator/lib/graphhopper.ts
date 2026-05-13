const BASE = 'https://graphhopper.com/api/1'

function apiKey(): string {
  const k = process.env.GRAPHHOPPER_API_KEY
  if (!k) throw new Error('Missing GRAPHHOPPER_API_KEY')
  return k
}

export interface LatLon {
  lat: number
  lon: number
}

export interface RouteEstimate {
  miles: number
  hours: number
  hasTolls: boolean
}

const ZIP_PATTERN = /^\d{5}(-\d{4})?$/
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

export async function geocode(query: string): Promise<LatLon | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  const url = new URL(NOMINATIM)
  if (ZIP_PATTERN.test(trimmed)) {
    url.searchParams.set('postalcode', trimmed.split('-')[0])
    url.searchParams.set('country', 'USA')
  } else {
    url.searchParams.set('q', trimmed)
    url.searchParams.set('countrycodes', 'us')
  }
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '1')

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'NETC-Quote-Calculator/1.0' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Nominatim geocode failed: ${res.status}`)
  const data = (await res.json()) as Array<{ lat: string; lon: string }>
  const first = data[0]
  if (!first) return null
  return { lat: parseFloat(first.lat), lon: parseFloat(first.lon) }
}

export async function routeEstimate(points: LatLon[]): Promise<RouteEstimate> {
  if (points.length < 2) throw new Error('Need at least 2 points to route')
  const url = new URL(`${BASE}/route`)
  for (const p of points) url.searchParams.append('point', `${p.lat},${p.lon}`)
  url.searchParams.set('vehicle', 'car')
  url.searchParams.set('locale', 'en')
  url.searchParams.set('details', 'toll')
  url.searchParams.set('key', apiKey())

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GraphHopper route failed: ${res.status} ${body}`)
  }
  const data = await res.json()
  const path = data.paths?.[0]
  if (!path) throw new Error('No route returned')

  const miles = path.distance / 1609.344
  const hours = path.time / 3_600_000
  const tollSegments: Array<[number, number, string]> = path.details?.toll ?? []
  const hasTolls = tollSegments.some((s) => s[2] && s[2] !== 'no')

  return { miles, hours, hasTolls }
}
