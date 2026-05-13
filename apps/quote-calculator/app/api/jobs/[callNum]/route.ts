import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

type JobLookup = {
  id: string
  tb_call_num: string | null
  tb_desc: string | null
  tb_reason: string | null
  tb_account: string | null
  tb_scheduled: string | null
  tb_driver: string | null
  truck_and_equipment: string | null
  yard_id: string | null
  pickup_addr: string | null
  drop_addr: string | null
  pickup_lat: number | null
  pickup_lon: number | null
  drop_lat: number | null
  drop_lon: number | null
  status: string | null
  day: string | null
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ callNum: string }> },
) {
  const { callNum } = await params
  const decoded = decodeURIComponent(callNum).trim()
  if (!decoded) return NextResponse.json({ error: 'Missing call number' }, { status: 400 })

  const variants = Array.from(
    new Set([decoded, decoded.startsWith('#') ? decoded.slice(1) : `#${decoded}`]),
  )

  let job: JobLookup | null = null
  for (const v of variants) {
    const { data, error } = await getSupabaseAdmin()
      .from('jobs')
      .select('id, tb_call_num, tb_desc, tb_reason, tb_account, tb_scheduled, tb_driver, truck_and_equipment, yard_id, pickup_addr, drop_addr, pickup_lat, pickup_lon, drop_lat, drop_lon, status, day')
      .eq('tb_call_num', v)
      .order('added_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (data) { job = data as JobLookup; break }
  }

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  let route: { miles: number; hours: number; matched: boolean } | null = null
  if (job.pickup_lat !== null && job.pickup_lon !== null && job.drop_lat !== null && job.drop_lon !== null) {
    const pickupFrag = `${round4(job.pickup_lat)},${round4(job.pickup_lon)}`
    const dropFrag   = `${round4(job.drop_lat)},${round4(job.drop_lon)}`
    const { data: cached } = await getSupabaseAdmin()
      .from('route_cache')
      .select('miles, hours')
      .like('key', `%${pickupFrag}|${dropFrag}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (cached) route = { miles: cached.miles, hours: cached.hours, matched: true }
  }

  return NextResponse.json({ job, route })
}
