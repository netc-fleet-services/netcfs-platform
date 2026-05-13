import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

function surchargePercent(total: number): number {
  if (total < 4.0) return 0
  if (total >= 10.0) return 32.73
  const tier = Math.floor((total - 4.0) / 0.5)
  return 2.73 + tier * 2.5
}

export async function GET() {
  const { data: latest, error: dateErr } = await getSupabaseAdmin()
    .from('fuel_prices')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (dateErr) return NextResponse.json({ error: dateErr.message }, { status: 500 })
  if (!latest?.date) return NextResponse.json({ percent: 0, basis: null, reason: 'No fuel_prices data available' })

  const { data: rows, error: rowsErr } = await getSupabaseAdmin()
    .from('fuel_prices')
    .select('location, product, total')
    .eq('date', latest.date)
    .order('total', { ascending: false })
    .limit(1)

  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 })
  const top = rows?.[0]
  if (!top) return NextResponse.json({ percent: 0, basis: null, reason: `No rows for ${latest.date}` })

  return NextResponse.json({
    percent: surchargePercent(top.total),
    basis: { date: latest.date, location: top.location, product: top.product, total: top.total },
  })
}
