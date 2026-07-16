import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const STATUS_LABELS: Record<string, string> = {
  issues: 'Known Issues',
  oos:    'Out of Service',
}

const CATEGORY_LABELS: Record<string, string> = {
  hd_tow:    'HD Tow',
  ld_tow:    'LD Tow',
  roadside:  'Roadside',
  transport: 'Transport',
  other:     'Other',
}

function daysAgo(isoString: string): number {
  return Math.floor((Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24))
}

export async function GET(req: NextRequest) {
  // Vercel cron sends Authorization: Bearer {CRON_SECRET} automatically.
  // If CRON_SECRET is set, reject any request that doesn't carry it.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendApiKey = process.env.RESEND_API_KEY
  const fromEmail    = process.env.NOTIFY_FROM_EMAIL ?? 'noreply@netruckcenter.com'

  if (!supabaseUrl || !serviceKey || !resendApiKey) {
    console.warn('[notify-reminder] Missing env vars — skipping')
    return NextResponse.json({ skipped: true })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Trucks in oos/issues with no user-visible change in 7+ days,
  // and no reminder already sent in the last 7 days.
  const { data: staleTrucks, error } = await supabase
    .from('trucks')
    .select('id, unit_number, category, location_id, current_status, waiting_on, updated_at, last_reminder_sent_at, locations(name)')
    .in('current_status', ['oos', 'issues'])
    .eq('active', true)
    .lt('updated_at', sevenDaysAgo)
    .or(`last_reminder_sent_at.is.null,last_reminder_sent_at.lt.${sevenDaysAgo}`)

  if (error) {
    console.error('[notify-reminder] Query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!staleTrucks?.length) {
    return NextResponse.json({ sent: 0, checked: 0 })
  }

  const { data: rules } = await supabase
    .from('notification_settings')
    .select('category, location_id, emails')

  let totalSent = 0
  const sentTruckIds: string[] = []

  for (const truck of staleTrucks) {
    // Collect recipients using the same category+location matching as status-change emails.
    const recipients = new Set<string>()
    for (const rule of rules ?? []) {
      const categoryMatch = rule.category    === null || rule.category    === truck.category
      const locationMatch = rule.location_id === null || rule.location_id === truck.location_id
      if (categoryMatch && locationMatch) {
        for (const email of rule.emails ?? []) {
          if (email) recipients.add(email)
        }
      }
    }

    if (recipients.size === 0) continue

    const locationName = (truck.locations as { name?: string } | null)?.name ?? 'Unknown Location'
    const categoryName = CATEGORY_LABELS[truck.category ?? ''] ?? truck.category ?? 'Unknown'
    const statusLabel  = STATUS_LABELS[truck.current_status] ?? truck.current_status
    const statusColor  = truck.current_status === 'oos' ? '#ef4444' : '#f59e0b'
    const days         = daysAgo(truck.updated_at)
    const lastUpdated  = new Date(truck.updated_at).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    })

    const subject = `Reminder: ${truck.unit_number} — ${days} day${days === 1 ? '' : 's'} with no updates`

    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">Stale Truck Reminder</h2>
        <p style="margin:0 0 20px;color:#64748b;font-size:14px">NETC Fleet Services</p>

        <div style="background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#713f12">
          <strong>${truck.unit_number}</strong> has been <strong style="color:${statusColor}">${statusLabel}</strong>
          for <strong>${days} day${days === 1 ? '' : 's'}</strong> with no updates.
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px;width:120px">Unit</td>
            <td style="padding:8px 0;font-weight:600;font-size:13px">${truck.unit_number}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">Status</td>
            <td style="padding:8px 0;font-size:13px;font-weight:600;color:${statusColor}">${statusLabel}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">Category</td>
            <td style="padding:8px 0;font-size:13px">${categoryName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">Location</td>
            <td style="padding:8px 0;font-size:13px">${locationName}</td>
          </tr>
          ${truck.waiting_on ? `
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">Waiting on</td>
            <td style="padding:8px 0;font-size:13px">${truck.waiting_on}</td>
          </tr>` : ''}
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">Last updated</td>
            <td style="padding:8px 0;font-size:13px">${lastUpdated}</td>
          </tr>
        </table>

        <p style="font-size:11px;color:#94a3b8;margin:0">
          Sent by NETC Fleet Tracker. Reply to this email to contact your administrator.
        </p>
      </div>
    `

    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ from: fromEmail, to: [...recipients], subject, html }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error(`[notify-reminder] Resend error for ${truck.unit_number}:`, err)
      continue
    }

    totalSent++
    sentTruckIds.push(truck.id)
  }

  // Record that reminders were sent so we don't re-send for another 7 days.
  if (sentTruckIds.length > 0) {
    await supabase
      .from('trucks')
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .in('id', sentTruckIds)
  }

  console.log(`[notify-reminder] Checked ${staleTrucks.length} stale trucks, sent ${totalSent} reminders`)
  return NextResponse.json({ sent: totalSent, checked: staleTrucks.length })
}
