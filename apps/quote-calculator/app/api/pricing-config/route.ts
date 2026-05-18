import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

// All keys must be present in the pricing_config Supabase table.
// If any are missing the endpoint returns 503 — populate the table before deploying.
const KEYS = [
  'credit_card_fee_percent',
  'escort_markup_percent',
  'time_uncertainty_hours',
  'miles_uncertainty',
] as const

type ConfigKey = (typeof KEYS)[number]

export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from('pricing_config')
    .select('key, value')
    .in('key', KEYS)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const config: Partial<Record<ConfigKey, number>> = {}
  for (const row of data ?? []) {
    if ((KEYS as readonly string[]).includes(row.key)) {
      config[row.key as ConfigKey] = Number(row.value)
    }
  }

  const missing = KEYS.filter(k => config[k] === undefined)
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `pricing_config rows missing: ${missing.join(', ')}` },
      { status: 503 },
    )
  }

  return NextResponse.json(config as Record<ConfigKey, number>)
}
