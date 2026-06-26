import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  decideFlush, matchRecipients, buildRecipientDigest, renderDigestHtml,
  type QueueChange, type TruckMeta, type NotificationRule, type ChangeType,
} from '@/lib/notification-digest'

// A flush can fan out one email per recipient; give it room beyond the 10s default.
export const maxDuration = 60

const MAX_ATTEMPTS = 5  // give up on a row after this many failed flushes (kills retry loops)

type QueueRow = {
  id: string
  truck_id: string
  change_type: ChangeType
  old_status: string | null
  new_status: string | null
  new_value: string | null
  changed_by: string | null
  created_at: string
  attempts: number
}

function toChange(row: QueueRow): QueueChange {
  return {
    truckId:   row.truck_id,
    type:      row.change_type,
    oldStatus: row.old_status,
    newStatus: row.new_status,
    value:     row.new_value,
    changedBy: row.changed_by,
    createdAt: new Date(row.created_at).getTime(),
  }
}

// Classify a Resend outcome so we retry transient failures but never loop on a bad address.
async function sendEmail(
  apiKey: string, from: string, to: string, subject: string, html: string,
): Promise<'sent' | 'hard_fail' | 'transient'> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from, to: [to], subject, html }),
    })
    if (res.ok) return 'sent'
    const text = await res.text()
    console.error(`[notify-flush] Resend ${res.status} for ${to}: ${text}`)
    // 4xx (except 429 rate-limit) = permanent; don't retry or it loops forever.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) return 'hard_fail'
    return 'transient'
  } catch (err) {
    console.error(`[notify-flush] network error for ${to}:`, err)
    return 'transient'
  }
}

export async function GET(req: NextRequest) {
  // Same auth pattern as /api/notify-reminder: if CRON_SECRET is set, require it.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendApiKey = process.env.RESEND_API_KEY
  const fromEmail    = process.env.NOTIFY_FROM_EMAIL ?? 'noreply@netruckcenter.com'

  if (!supabaseUrl || !serviceKey || !resendApiKey) {
    console.warn('[notify-flush] Missing env vars — skipping')
    return NextResponse.json({ skipped: true })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  // 1) Everything still waiting to be sent.
  const { data: rows, error } = await supabase
    .from('fleet_notification_queue')
    .select('id, truck_id, change_type, old_status, new_status, new_value, changed_by, created_at, attempts')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .returns<QueueRow[]>()

  if (error) {
    console.error('[notify-flush] queue read error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const claimed = rows ?? []

  // 2) Is it time? (5 quiet minutes, or the 30-minute cap.)
  const decision = decideFlush(claimed.map(r => new Date(r.created_at).getTime()), Date.now())
  if (!decision.flush) {
    return NextResponse.json({ flushed: false, reason: decision.reason, pending: claimed.length })
  }

  // 3) Truck metadata for everything in this batch.
  const truckIds = [...new Set(claimed.map(r => r.truck_id))]
  const { data: trucks } = await supabase
    .from('trucks')
    .select('id, unit_number, category, location_id, current_status, waiting_on, locations(name)')
    .in('id', truckIds)

  const trucksById: Record<string, TruckMeta> = {}
  for (const t of trucks ?? []) {
    const locationName = (t.locations as { name?: string } | null)?.name ?? 'Unknown Location'
    trucksById[t.id] = {
      id: t.id, unit_number: t.unit_number, category: t.category,
      location_id: t.location_id, current_status: t.current_status,
      waiting_on: t.waiting_on, locationName,
    }
  }

  // 4) Notification rules + who has already received which row.
  const { data: rules } = await supabase
    .from('notification_settings')
    .select('category, location_id, emails')
    .returns<NotificationRule[]>()

  const { data: prior } = await supabase
    .from('fleet_notification_delivery')
    .select('queue_id, recipient')
    .in('queue_id', claimed.map(r => r.id))

  const deliveredByRow = new Map<string, Set<string>>()
  for (const d of prior ?? []) {
    if (!deliveredByRow.has(d.queue_id)) deliveredByRow.set(d.queue_id, new Set())
    deliveredByRow.get(d.queue_id)!.add(d.recipient)
  }

  // 5) Per row: its full recipient set. Per recipient: the rows they haven't seen yet.
  const recipientsByRow = new Map<string, string[]>()
  const perRecipient = new Map<string, { rowId: string; change: QueueChange }[]>()
  for (const row of claimed) {
    const truck = trucksById[row.truck_id]
    const recips = truck ? matchRecipients(rules, truck) : []
    recipientsByRow.set(row.id, recips)
    const change = toChange(row)
    const already = deliveredByRow.get(row.id)
    for (const r of recips) {
      if (already?.has(r)) continue
      if (!perRecipient.has(r)) perRecipient.set(r, [])
      perRecipient.get(r)!.push({ rowId: row.id, change })
    }
  }

  // 6) Send each recipient their personalized digest.
  const deliveryInserts: { queue_id: string; recipient: string }[] = []
  let sentCount = 0
  for (const [recipient, items] of perRecipient) {
    const digest  = buildRecipientDigest(items.map(i => i.change), trucksById)
    if (digest.truckCount === 0) continue
    const subject = `Fleet Updates — ${digest.totalChanges} change${digest.totalChanges === 1 ? '' : 's'} · ${digest.truckCount} truck${digest.truckCount === 1 ? '' : 's'}`
    const outcome = await sendEmail(resendApiKey, fromEmail, recipient, subject, renderDigestHtml(digest))

    if (outcome === 'sent' || outcome === 'hard_fail') {
      // Record delivery either way: 'sent' = success; 'hard_fail' = bad address, don't retry it.
      for (const i of items) {
        deliveryInserts.push({ queue_id: i.rowId, recipient })
        if (!deliveredByRow.has(i.rowId)) deliveredByRow.set(i.rowId, new Set())
        deliveredByRow.get(i.rowId)!.add(recipient)
      }
      if (outcome === 'sent') sentCount++
    }
    // 'transient' → leave undelivered; the next poll retries just this recipient.
  }

  if (deliveryInserts.length) {
    await supabase.from('fleet_notification_delivery')
      .upsert(deliveryInserts, { onConflict: 'queue_id,recipient', ignoreDuplicates: true })
  }

  // 7) A row is done when every one of its recipients has it (or it has none).
  const now = new Date().toISOString()
  const doneIds: string[] = []
  const retryRows: QueueRow[] = []
  for (const row of claimed) {
    const recips    = recipientsByRow.get(row.id) ?? []
    const delivered = deliveredByRow.get(row.id) ?? new Set<string>()
    if (recips.every(r => delivered.has(r))) doneIds.push(row.id)
    else retryRows.push(row)
  }

  if (doneIds.length) {
    await supabase.from('fleet_notification_queue').update({ sent_at: now }).in('id', doneIds)
  }

  // 8) Retries: bump the attempt counter; give up (and mark done) past the cap.
  let gaveUp = 0
  for (const row of retryRows) {
    const attempts = (row.attempts ?? 0) + 1
    if (attempts >= MAX_ATTEMPTS) {
      gaveUp++
      console.error(`[notify-flush] giving up on row ${row.id} after ${attempts} attempts`)
      await supabase.from('fleet_notification_queue').update({ attempts, sent_at: now }).eq('id', row.id)
    } else {
      await supabase.from('fleet_notification_queue').update({ attempts }).eq('id', row.id)
    }
  }

  console.log(`[notify-flush] ${decision.reason}: ${sentCount} emails, ${doneIds.length} rows done, ${retryRows.length - gaveUp} retrying, ${gaveUp} gave up`)
  return NextResponse.json({
    flushed:    true,
    reason:     decision.reason,
    emailsSent: sentCount,
    rowsDone:   doneIds.length,
    retrying:   retryRows.length - gaveUp,
    gaveUp,
  })
}
