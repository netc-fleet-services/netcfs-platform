import { NextRequest, NextResponse } from 'next/server'

const MARKETCHECK_KEY = process.env.MARKETCHECK_API_KEY
const BASE_URL = 'https://mc-api.marketcheck.com/v2/search/car/active'
const ZIP = '03842'
const RADIUS = 50

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

function parseMakeModel(makeModel: string): { make: string; model: string } {
  const parts = makeModel.trim().split(/\s+/)
  return {
    make:  parts[0] ?? '',
    model: parts.slice(1).join(' ') || (parts[0] ?? ''),
  }
}

export async function POST(req: NextRequest) {
  const { make_model, year } = await req.json()

  if (!make_model || !year) {
    return NextResponse.json({ error: 'make_model and year are required' }, { status: 400 })
  }

  if (!MARKETCHECK_KEY) {
    return NextResponse.json({ error: 'MARKETCHECK_API_KEY not configured' }, { status: 500 })
  }

  const { make, model } = parseMakeModel(make_model)
  const yearNum = parseInt(year, 10)

  if (isNaN(yearNum)) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
  }

  const params = new URLSearchParams({
    api_key:  MARKETCHECK_KEY,
    make,
    model,
    year_min: String(yearNum - 2),
    year_max: String(yearNum + 2),
    zip:      ZIP,
    radius:   String(RADIUS),
    rows:     '50',
    fl:       'price',
    price_min: '500',   // filter out obvious bad data
  })

  try {
    const res = await fetch(`${BASE_URL}?${params}`, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 3600 },  // cache for 1 hour
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('[estimate-value] MarketCheck error:', text)
      return NextResponse.json({ error: 'MarketCheck API error', detail: text }, { status: 502 })
    }

    const data = await res.json()
    const listings: { price?: number }[] = data.listings ?? []

    const prices = listings
      .map(l => l.price)
      .filter((p): p is number => typeof p === 'number' && p > 0)

    if (!prices.length) {
      return NextResponse.json({ estimated_value: null, comparable_count: 0 })
    }

    return NextResponse.json({
      estimated_value:  median(prices),
      comparable_count: prices.length,
      low:              Math.min(...prices),
      high:             Math.max(...prices),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[estimate-value] Unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
