import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const TYPE_LABELS: Record<string, string> = {
  replacement: 'Broken / Damage Replacement',
  new:         'New Equipment / Tool Request',
}

export async function POST(req: NextRequest) {
  try {
    const { submittedBy, urgent, requestType, description, purpose, ifNotPurchased } = await req.json()

    const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
    const resendApiKey = process.env.RESEND_API_KEY
    const fromEmail    = process.env.NOTIFY_FROM_EMAIL ?? 'noreply@netruckcenter.com'

    if (!supabaseUrl || !serviceKey || !resendApiKey) {
      console.warn('[notify-equipment-request] Missing env vars — skipping email')
      return NextResponse.json({ skipped: true })
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    // Read the dedicated equipment-request notification email from settings
    const { data: setting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'equipment_request_notify_email')
      .single()

    const notifyEmail = setting?.value?.trim()
    if (!notifyEmail) {
      console.warn('[notify-equipment-request] equipment_request_notify_email not configured — skipping email')
      return NextResponse.json({ skipped: true, reason: 'no_email_configured' })
    }

    const urgentBanner = urgent
      ? `<div style="background:#fef2f2;border:2px solid #ef4444;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-weight:700;color:#dc2626;font-size:14px">
           URGENT — Bring this request to the manager immediately
         </div>`
      : ''

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">Equipment / Tool Request</h2>
        <p style="margin:0 0 20px;color:#64748b;font-size:14px">NETC Fleet Services · ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>

        ${urgentBanner}

        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:160px">Requester</td><td style="padding:8px 0;font-weight:600;font-size:13px">${submittedBy}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;font-size:13px">Request Type</td><td style="padding:8px 0;font-size:13px">${TYPE_LABELS[requestType] ?? requestType}</td></tr>
        </table>

        <div style="margin-bottom:16px">
          <p style="margin:0 0 4px;font-weight:700;font-size:13px;color:#1e293b">Description of tool / equipment requested:</p>
          <p style="margin:0;font-size:13px;color:#334155;background:#f8fafc;padding:10px 12px;border-radius:6px;border:1px solid #e2e8f0">${description}</p>
        </div>

        <div style="margin-bottom:16px">
          <p style="margin:0 0 4px;font-weight:700;font-size:13px;color:#1e293b">Purpose of the tool / equipment:</p>
          <p style="margin:0;font-size:13px;color:#334155;background:#f8fafc;padding:10px 12px;border-radius:6px;border:1px solid #e2e8f0">${purpose}</p>
        </div>

        <div style="margin-bottom:24px">
          <p style="margin:0 0 4px;font-weight:700;font-size:13px;color:#1e293b">What is done now / impact if NOT purchased:</p>
          <p style="margin:0;font-size:13px;color:#334155;background:#f8fafc;padding:10px 12px;border-radius:6px;border:1px solid #e2e8f0">${ifNotPurchased}</p>
        </div>

        <p style="font-size:11px;color:#94a3b8;margin:0">View and manage this request in the Fleet Tracker admin settings under Equipment Requests.</p>
      </div>
    `

    const subject = urgent
      ? `URGENT Equipment Request from ${submittedBy}`
      : `Equipment Request from ${submittedBy}`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: [notifyEmail], subject, html }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[notify-equipment-request] Resend error:', err)
      return NextResponse.json({ error: err }, { status: 500 })
    }

    return NextResponse.json({ sent: 1 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[notify-equipment-request] Unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
