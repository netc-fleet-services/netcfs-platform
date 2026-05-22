import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const STATUS_LABELS: Record<string, string> = {
  ready:  'Ready for Use',
  issues: 'Known Issues',
  oos:    'Out of Service',
}

const STATUS_COLORS: Record<string, string> = {
  ready:  '#22c55e',
  issues: '#f59e0b',
  oos:    '#ef4444',
}

const CATEGORY_LABELS: Record<string, string> = {
  hd_tow:    'HD Tow',
  ld_tow:    'LD Tow',
  roadside:  'Roadside',
  transport: 'Transport',
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  waiting_on:    'Waiting On',
  driver_note:   'Driver Note',
  mechanic_note: 'Mechanic Note',
  work_done:     'Work Done',
}

export async function POST(req: NextRequest) {
  try {
    const { truckId, changeType, newValue, changedBy } = await req.json()

    if (!truckId || !changeType || !newValue) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
    const resendApiKey = process.env.RESEND_API_KEY
    const fromEmail    = process.env.NOTIFY_FROM_EMAIL ?? 'noreply@netruckcenter.com'

    if (!supabaseUrl || !serviceKey || !resendApiKey) {
      console.warn('[notify-notes] Missing env vars — skipping email')
      return NextResponse.json({ skipped: true })
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    const { data: truck } = await supabase
      .from('trucks')
      .select('unit_number, category, location_id, current_status, locations(name)')
      .eq('id', truckId)
      .single()

    if (!truck) {
      return NextResponse.json({ error: 'Truck not found' }, { status: 404 })
    }

    const { data: rules } = await supabase
      .from('notification_settings')
      .select('category, location_id, emails')

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

    const locationName  = (truck.locations as { name?: string } | null)?.name ?? 'Unknown Location'
    const categoryName  = CATEGORY_LABELS[truck.category ?? ''] ?? truck.category ?? 'Unknown'
    const statusLabel   = STATUS_LABELS[truck.current_status] ?? truck.current_status
    const statusColor   = STATUS_COLORS[truck.current_status] ?? '#64748b'
    const changeLabel   = CHANGE_TYPE_LABELS[changeType] ?? changeType

    const subject = `${truck.unit_number} — ${changeLabel} updated`

    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">Vehicle Note Update</h2>
        <p style="margin:0 0 20px;color:#64748b;font-size:14px">NETC Fleet Services</p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px;width:120px">Unit</td>
            <td style="padding:8px 0;font-weight:600;font-size:13px">${truck.unit_number}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">Category</td>
            <td style="padding:8px 0;font-size:13px">${categoryName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">Location</td>
            <td style="padding:8px 0;font-size:13px">${locationName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">Status</td>
            <td style="padding:8px 0;font-size:13px;font-weight:600;color:${statusColor}">${statusLabel}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">Updated field</td>
            <td style="padding:8px 0;font-size:13px;font-weight:600">${changeLabel}</td>
          </tr>
          ${changedBy ? `
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:13px">Changed by</td>
            <td style="padding:8px 0;font-size:13px">${changedBy}</td>
          </tr>` : ''}
        </table>

        <div style="background:#f1f5f9;border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;padding:12px 16px;margin-bottom:20px">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">${changeLabel}</p>
          <p style="margin:0;font-size:13px;color:#1e293b;line-height:1.5">${newValue}</p>
        </div>

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
      console.error('[notify-notes] Resend error:', err)
      return NextResponse.json({ error: err }, { status: 500 })
    }

    return NextResponse.json({ sent: recipients.size })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[notify-notes] Unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
