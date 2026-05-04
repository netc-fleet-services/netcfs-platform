import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { assignmentId, date, mileage, hours, loggedBy } = await req.json()

    if (!assignmentId || !date) {
      return NextResponse.json({ error: 'assignmentId and date are required' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    const payload: Record<string, unknown> = {
      last_pm_date:    date,
      last_pm_mileage: mileage != null ? Number(mileage) : null,
      last_pm_hours:   hours   != null ? Number(hours)   : null,
      logged_by:       loggedBy ?? null,
      logged_at:       new Date().toISOString(),
    }

    const { error } = await supabase
      .from('truck_pm_assignments')
      .update(payload)
      .eq('id', assignmentId)

    if (error) {
      console.error('[log-pm] DB error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[log-pm] Unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
