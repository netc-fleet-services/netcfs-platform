import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

// Fallback values used when the pricing_config row is missing.
// Expected pricing_config keys: credit_card_fee_percent, escort_markup_percent,
// time_uncertainty_hours, miles_uncertainty
const DEFAULTS = {
  credit_card_fee_percent: 3.5,
  escort_markup_percent: 25,
  time_uncertainty_hours: 20 / 60,
  miles_uncertainty: 15,
} as const

type ConfigKey = keyof typeof DEFAULTS

const KEYS: ConfigKey[] = [
  'credit_card_fee_percent',
  'escort_markup_percent',
  'time_uncertainty_hours',
  'miles_uncertainty',
]

export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from('pricing_config')
    .select('key, value')
    .in('key', KEYS)

  const config = { ...DEFAULTS } as Record<ConfigKey, number>

  if (!error) {
    for (const row of data ?? []) {
      if (KEYS.includes(row.key as ConfigKey)) {
        config[row.key as ConfigKey] = Number(row.value)
      }
    }
  }

  return NextResponse.json(config)
}
