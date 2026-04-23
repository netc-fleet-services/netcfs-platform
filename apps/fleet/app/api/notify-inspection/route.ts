import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const { truckId, unitNumber, inspector, date, failItems } = await req.json()

    const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
    const resendApiKey = process.env.RESEND_API_KEY
    const fromEmail    = process.env.NOTIFY_FROM_EMAIL ?? 'noreply@netruckcenter.com'

    if (!supabaseUrl || !serviceKey || !resendApiKey) {
      console.warn('[notify-inspection] Missing env vars — skipping email')
      return NextResponse.json({ skipped: true })
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    const { data: truck } = await supabase
      .from('trucks')
      .select('category, location_id, locations(name)')
      .eq('id', truckId)
      .single()

    if (!truck) return NextResponse.json({ skipped: true })

    const { data: rules } = await supabase
      .from('notification_settings')
      .select('category, location_id, emails')

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

    if (recipients.size === 0) return NextResponse.json({ sent: 0 })

    const locationName = (truck.locations as { name?: string } | null)?.name ?? 'Unknown Location'
    const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    const failRows = (failItems as { label: string; comment: string }[])
      .map(f => `
        <tr>
          <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f1f5f9">${f.label}</td>
          <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f1f5f9;color:#ef4444">${f.comment || '—'}</td>
        </tr>`)
      .join('')

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">Inspection Failed Items — ${unitNumber}</h2>
        <p style="margin:0 0 20px;color:#64748b;font-size:14px">NETC Fleet Services · ${formattedDate}</p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
          <tr style="background:#f8fafc">
            <td style="padding:8px 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Item</td>
            <td style="padding:8px 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Comment / Corrective Action</td>
          </tr>
          ${failRows}
        </table>

        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:130px">Unit</td><td style="padding:6px 0;font-weight:600;font-size:13px">${unitNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Location</td><td style="padding:6px 0;font-size:13px">${locationName}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Inspector</td><td style="padding:6px 0;font-size:13px">${inspector}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Date</td><td style="padding:6px 0;font-size:13px">${formattedDate}</td></tr>
        </table>

        <p style="font-size:11px;color:#94a3b8;margin:0">Sent by NETC Fleet Tracker.</p>
      </div>
    `

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: [...recipients], subject: `Inspection Fails — ${unitNumber} (${failItems.length} item${failItems.length !== 1 ? 's' : ''})`, html }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[notify-inspection] Resend error:', err)
      return NextResponse.json({ error: err }, { status: 500 })
    }

    return NextResponse.json({ sent: recipients.size })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[notify-inspection] Unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
