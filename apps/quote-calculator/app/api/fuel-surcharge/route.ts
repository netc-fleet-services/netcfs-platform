import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

// All keys must be present in the pricing_config Supabase table.
// If any are missing the endpoint returns 503 — populate the table before deploying.
const FUEL_KEYS = [
  'fuel_min_price',
  'fuel_max_price',
  'fuel_base_percent',
  'fuel_step_price',
  'fuel_step_percent',
  'fuel_max_percent',
] as const

type FuelKey = (typeof FUEL_KEYS)[number]
type FuelCfg = Record<FuelKey, number>

function surchargePercent(total: number, cfg: FuelCfg): number {
  if (total < cfg.fuel_min_price) return 0
  if (total >= cfg.fuel_max_price) return cfg.fuel_max_percent
  const tier = Math.floor((total - cfg.fuel_min_price) / cfg.fuel_step_price)
  return cfg.fuel_base_percent + tier * cfg.fuel_step_percent
}

export async function GET() {
  const supabase = getSupabaseAdmin()

  const [latestRes, configRes] = await Promise.all([
    supabase.from('fuel_prices').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('pricing_config').select('key, value').in('key', FUEL_KEYS),
  ])

  if (latestRes.error) return NextResponse.json({ error: latestRes.error.message }, { status: 500 })
  if (!latestRes.data?.date) return NextResponse.json({ percent: 0, basis: null, reason: 'No fuel_prices data available' })

  const partial: Partial<FuelCfg> = {}
  for (const row of configRes.data ?? []) {
    if ((FUEL_KEYS as readonly string[]).includes(row.key)) {
      partial[row.key as FuelKey] = Number(row.value)
    }
  }
  const missing = FUEL_KEYS.filter(k => partial[k] === undefined)
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `pricing_config rows missing: ${missing.join(', ')}` },
      { status: 503 },
    )
  }
  const cfg = partial as FuelCfg

  const { data: rows, error: rowsErr } = await supabase
    .from('fuel_prices')
    .select('location, product, total')
    .eq('date', latestRes.data.date)
    .order('total', { ascending: false })
    .limit(1)

  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 })
  const top = rows?.[0]
  if (!top) return NextResponse.json({ percent: 0, basis: null, reason: `No rows for ${latestRes.data.date}` })

  return NextResponse.json({
    percent: surchargePercent(top.total, cfg),
    basis: { date: latestRes.data.date, location: top.location, product: top.product, total: top.total },
  })
}
