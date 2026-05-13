import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface NominatimHit {
  display_name: string
  lat: string
  lon: string
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 3) return NextResponse.json({ suggestions: [] })

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', q)
  url.searchParams.set('countrycodes', 'us')
  url.searchParams.set('format', 'json')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', '5')

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'NETC-Quote-Calculator/1.0' },
    cache: 'no-store',
  })
  if (!res.ok) return NextResponse.json({ suggestions: [], error: `Nominatim ${res.status}` }, { status: 200 })

  const hits = (await res.json()) as NominatimHit[]
  const suggestions = hits.map((h) => ({
    label: h.display_name,
    lat: parseFloat(h.lat),
    lon: parseFloat(h.lon),
  }))
  return NextResponse.json({ suggestions })
}
