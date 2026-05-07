import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const addr = typeof body?.addr === 'string' ? body.addr.trim() : ''

  if (!addr) {
    return NextResponse.json({ addr: '', lat: null, lon: null })
  }

  // Try Geocodio first — better accuracy, returns standardized address string.
  // GEOCODIO_KEY must be set in Vercel env vars for this app.
  const geocodioKey = process.env.GEOCODIO_KEY
  if (geocodioKey) {
    try {
      const url = `https://api.geocod.io/v1.7/geocode?q=${encodeURIComponent(addr)}&api_key=${geocodioKey}&limit=1`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'transport-scheduler/1.0 (ops@netruckcenter.com)' },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const data = await res.json()
        const r = data.results?.[0]
        if (r && r.accuracy >= 0.8 && ['rooftop', 'range_interpolation', 'point'].includes(r.accuracy_type)) {
          const c = r.address_components || {}
          const parts = [c.number, c.predirectional, c.street, c.suffix, c.postdirectional].filter(Boolean)
          const stdAddr = `${parts.join(' ')}, ${c.city} ${c.state} ${c.zip}`.trim().replace(/,\s*$/, '')
          return NextResponse.json({
            addr: stdAddr || addr,
            lat:  Number(r.location.lat),
            lon:  Number(r.location.lng),
          })
        }
      }
    } catch (e) {
      console.error('geocode route — Geocodio error:', e)
    }
  }

  // Fall back to Nominatim (free, no key required).
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1&countrycodes=us`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'transport-scheduler/1.0 (ops@netruckcenter.com)' },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      const data = await res.json()
      if (data?.[0]) {
        return NextResponse.json({ addr, lat: Number(data[0].lat), lon: Number(data[0].lon) })
      }
    }
  } catch (e) {
    console.error('geocode route — Nominatim error:', e)
  }

  // Both geocoders failed — return address without coords.
  // The next TowBook sync will retry geocoding server-side.
  return NextResponse.json({ addr, lat: null, lon: null })
}
