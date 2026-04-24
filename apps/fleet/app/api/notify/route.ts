import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const STATUS_LABELS: Record<string, string> = {
  ready:  'Ready for Use',
  issues: 'Known Issues',
  oos:    'Out of Service',
}

const CATEGORY_LABELS: Record<string, string> = {
  hd_tow:    'HD Tow',
  ld_tow:    'LD Tow',
  roadside:  'Roadside',
  transport: 'Transport',
}

export async function POST(req: NextRequest) {
  try {
    const { truckId, oldStatus, newStatus, comment, waitingOn, changedBy } = await req.json()

    if (!truckId || !newStatus) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
    const resendApiKey = process.env.RESEND_API_KEY
    const fromEmail    = process.env.NOTIFY_FROM_EMAIL ?? 'noreply@netruckcenter.com'

    if (!supabaseUrl || !serviceKey || !resendApiKey) {
      console.warn('[notify] Missing env vars — skipping email')
      return NextResponse.json({ skipped: true })
    }

    // Use service role to bypass RLS when reading notification_settings
    const supabase = createClient(supabaseUrl, serviceKey)

    // Fetch truck with category and location
    const { data: truck } = await supabase
      .from('trucks')
      .select('unit_number, category, location_id, locations(name)')
      .eq('id', truckId)
      .single()

    if (!truck) {
      return NextResponse.json({ error: 'Truck not found' }, { status: 404 })
    }

    // Fetch all notification rules
    const { data: rules } = await supabase
      .from('notification_settings')
      .select('category, location_id, emails')

    // Collect recipients: rule matches if its category/location is null (wildcard) or matches truck
    const recipients = new Set<string>()
    for (const rule of rules ?? []) {
      const categoryMatch  = rule.category    === null || rule.category    === truck.category
      const locationMatch  = rule.location_id === null || rule.location_id === truck.location_id
      if (categoryMatch && locationMatch) {
        for (const email of rule.emails ?? []) {
          if (email) recipients.add(email)
        }
      }
    }

    if (recipients.size === 0) {
      return NextResponse.json({ sent: 0 })
    }

    const locationName = (truck.locations as { name?: string } | null)?.name ?? 'Unknown Location'
    const categoryName = CATEGORY_LABELS[truck.category ?? ''] ?? truck.category ?? 'Unknown'
    const oldLabel     = STATUS_LABELS[oldStatus] ?? oldStatus ?? '—'
    const newLabel     = STATUS_LABELS[newStatus] ?? newStatus

    const subject = `${truck.unit_number} → ${newLabel}`

    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">Truck Status Update</h2>
        <p style="margin:0 0 20px;color:#64748b;font-size:14px">NETC Fleet Services</p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:120px">Unit</td>
              <td style="padding:8px 0;font-weight:600;font-size:13px">${truck.unit_number}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;font-size:13px">Category</td>
              <td style="padding:8px 0;font-size:13px">${categoryName}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;font-size:13px">Location</td>
              <td style="padding:8px 0;font-size:13px">${locationName}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;font-size:13px">From</td>
              <td style="padding:8px 0;font-size:13px">${oldLabel}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;font-size:13px">To</td>
              <td style="padding:8px 0;font-weight:600;font-size:13px">${newLabel}</td></tr>
          ${waitingOn ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px">Waiting on</td>
              <td style="padding:8px 0;font-size:13px">${waitingOn}</td></tr>` : ''}
          ${comment ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px">Comment</td>
              <td style="padding:8px 0;font-size:13px">${comment}</td></tr>` : ''}
          <tr><td style="padding:8px 0;color:#64748b;font-size:13px">Changed by</td>
              <td style="padding:8px 0;font-size:13px">${changedBy}</td></tr>
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
      body: JSON.stringify({
        from:    fromEmail,
        to:      [...recipients],
        subject,
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[notify] Resend error:', err)
      return NextResponse.json({ error: err }, { status: 500 })
    }

    return NextResponse.json({ sent: recipients.size })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[notify] Unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
