import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'
import { geocode, routeEstimate, type LatLon } from '@/lib/graphhopper'

export const dynamic = 'force-dynamic'

const yardCoords = new Map<string, LatLon>()

async function getYardCoord(yardId: string): Promise<LatLon | null> {
  const cached = yardCoords.get(yardId)
  if (cached) return cached

  const { data: yard } = await getSupabaseAdmin()
    .from('yards')
    .select('id, addr')
    .eq('id', yardId)
    .maybeSingle()
  if (!yard) return null

  const firstLine = yard.addr.split(',')[0]?.trim()
  if (firstLine) {
    const { data: cachedGeo } = await getSupabaseAdmin()
      .from('geocache')
      .select('lat, lon')
      .ilike('addr', `%${firstLine}%`)
      .limit(1)
      .maybeSingle()
    if (cachedGeo) {
      const coord = { lat: cachedGeo.lat, lon: cachedGeo.lon }
      yardCoords.set(yardId, coord)
      return coord
    }
  }

  const coord = await geocode(yard.addr)
  if (coord) yardCoords.set(yardId, coord)
  return coord
}

export async function POST(req: Request) {
  let body: { yardId?: string; pickupAddress?: string; stops?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { yardId, pickupAddress, stops } = body
  const cleanStops = (stops ?? []).map((s) => s.trim()).filter(Boolean)
  if (!yardId || !pickupAddress || cleanStops.length === 0) {
    return NextResponse.json({ error: 'yardId, pickupAddress, and at least one stop are required' }, { status: 400 })
  }

  try {
    const [yardCoord, pickupCoord, ...stopCoords] = await Promise.all([
      getYardCoord(yardId),
      geocode(pickupAddress),
      ...cleanStops.map((s) => geocode(s)),
    ])

    if (!yardCoord) return NextResponse.json({ error: `Couldn't locate yard '${yardId}'` }, { status: 404 })
    if (!pickupCoord) return NextResponse.json({ error: `Couldn't find pickup address '${pickupAddress}'` }, { status: 400 })
    for (let i = 0; i < stopCoords.length; i++) {
      if (!stopCoords[i]) return NextResponse.json({ error: `Couldn't find stop address '${cleanStops[i]}'` }, { status: 400 })
    }

    const points = [yardCoord, pickupCoord, ...(stopCoords as NonNullable<(typeof stopCoords)[number]>[]), yardCoord]
    const estimate = await routeEstimate(points)

    return NextResponse.json({ route: { miles: estimate.miles, hours: estimate.hours, hasTolls: estimate.hasTolls, source: 'graphhopper' } })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
