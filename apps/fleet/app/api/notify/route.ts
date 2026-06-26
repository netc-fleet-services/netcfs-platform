import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isStatusNoop } from '@/lib/notification-digest'

// Status-change notifications are no longer sent inline. They're dropped into the
// fleet_notification_queue and batched into a 5-minute digest by /api/notify-flush.
export async function POST(req: NextRequest) {
  try {
    const { truckId, oldStatus, newStatus, changedBy } = await req.json()

    if (!truckId || !newStatus) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // No-op guard: if the status didn't actually change, there's nothing to notify.
    if (isStatusNoop(oldStatus, newStatus)) {
      return NextResponse.json({ queued: false, reason: 'noop' })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceKey) {
      console.warn('[notify] Missing env vars — skipping enqueue')
      return NextResponse.json({ skipped: true })
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    const { error } = await supabase.from('fleet_notification_queue').insert({
      truck_id:    truckId,
      change_type: 'status',
      old_status:  oldStatus ?? null,
      new_status:  newStatus,
      changed_by:  changedBy ?? null,
    })

    if (error) {
      console.error('[notify] enqueue error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ queued: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[notify] Unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
