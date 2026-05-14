import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

// Fallback formula constants — overridden by pricing_config rows:
// fuel_min_price, fuel_max_price, fuel_base_percent, fuel_step_price, fuel_step_percent, fuel_max_percent
const FUEL_DEFAULTS = {
  fuel_min_price: 4.0,
  fuel_max_price: 10.0,
  fuel_base_percent: 2.73,
  fuel_step_price: 0.5,
  fuel_step_percent: 2.5,
  fuel_max_percent: 32.73,
}

type FuelKey = keyof typeof FUEL_DEFAULTS

function surchargePercent(total: number, cfg: typeof FUEL_DEFAULTS): number {
  if (total < cfg.fuel_min_price) return 0
  if (total >= cfg.fuel_max_price) return cfg.fuel_max_percent
  const tier = Math.floor((total - cfg.fuel_min_price) / cfg.fuel_step_price)
  return cfg.fuel_base_percent + tier * cfg.fuel_step_percent
}

export async function GET() {
  const supabase = getSupabaseAdmin()
  const fuelKeys = Object.keys(FUEL_DEFAULTS) as FuelKey[]

  const [latestRes, configRes] = await Promise.all([
    supabase.from('fuel_prices').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('pricing_config').select('key, value').in('key', fuelKeys),
  ])

  if (latestRes.error) return NextResponse.json({ error: latestRes.error.message }, { status: 500 })
  if (!latestRes.data?.date) return NextResponse.json({ percent: 0, basis: null, reason: 'No fuel_prices data available' })

  const cfg = { ...FUEL_DEFAULTS }
  for (const row of configRes.data ?? []) {
    if (fuelKeys.includes(row.key as FuelKey)) cfg[row.key as FuelKey] = Number(row.value)
  }

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
