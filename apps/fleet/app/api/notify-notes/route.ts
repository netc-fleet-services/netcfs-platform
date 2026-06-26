import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { ChangeType } from '@/lib/notification-digest'

const VALID_CHANGE_TYPES: ChangeType[] = ['waiting_on', 'driver_note', 'mechanic_note', 'work_done']

// Note / waiting-on notifications are no longer sent inline. They're dropped into
// the fleet_notification_queue and batched into a 5-minute digest by /api/notify-flush.
// (The waiting-on no-op is suppressed client-side in truck-row.tsx, because the row is
//  already saved to the DB before this route runs.)
export async function POST(req: NextRequest) {
  try {
    const { truckId, changeType, newValue, changedBy } = await req.json()

    if (!truckId || !changeType || !newValue) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!VALID_CHANGE_TYPES.includes(changeType)) {
      return NextResponse.json({ error: `Invalid changeType: ${changeType}` }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceKey) {
      console.warn('[notify-notes] Missing env vars — skipping enqueue')
      return NextResponse.json({ skipped: true })
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    const { error } = await supabase.from('fleet_notification_queue').insert({
      truck_id:    truckId,
      change_type: changeType,
      new_value:   newValue,
      changed_by:  changedBy ?? null,
    })

    if (error) {
      console.error('[notify-notes] enqueue error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ queued: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[notify-notes] Unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
