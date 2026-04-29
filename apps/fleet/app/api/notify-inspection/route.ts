import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import PDFDocument from 'pdfkit'

export const runtime = 'nodejs'

interface AllItem {
  key:     string
  label:   string
  section: string
  rating:  'ok' | 'na' | 'bad' | ''
  comment: string
}

async function buildInspectionPdf(opts: {
  unitNumber:    string
  inspector:     string
  formattedDate: string
  locationName:  string
  allItems:      AllItem[]
}): Promise<Buffer> {
  const { unitNumber, inspector, formattedDate, locationName, allItems } = opts

  return new Promise<Buffer>((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 40, size: 'LETTER' })
    const chunks: Buffer[] = []
    doc.on('data',  (c: Buffer) => chunks.push(c))
    doc.on('end',   () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // ── Title ────────────────────────────────────────────────────────
    doc.fontSize(16).font('Helvetica-Bold')
      .text('Monthly Vehicle Inspection', { align: 'center' })
    doc.fontSize(10).font('Helvetica')
      .text('NETC Fleet Services  ·  Towing / Road Service / Transportation', { align: 'center' })
    doc.moveDown(0.75)

    // ── Info block ───────────────────────────────────────────────────
    const top = doc.y
    doc.fontSize(10).font('Helvetica-Bold').text('Unit:',     40,  top)
    doc.font('Helvetica').text(unitNumber,                    90,  top)
    doc.font('Helvetica-Bold').text('Inspector:',             300, top)
    doc.font('Helvetica').text(inspector,                     365, top)
    doc.font('Helvetica-Bold').text('Location:',              40,  top + 18)
    doc.font('Helvetica').text(locationName,                  100, top + 18)
    doc.font('Helvetica-Bold').text('Date:',                  300, top + 18)
    doc.font('Helvetica').text(formattedDate,                 335, top + 18)

    doc.moveDown(2.25)

    // ── Divider ──────────────────────────────────────────────────────
    doc.moveTo(40, doc.y).lineTo(571, doc.y).strokeColor('#cccccc').stroke()
    doc.moveDown(0.75)

    // ── Sections ─────────────────────────────────────────────────────
    const bySection = new Map<string, AllItem[]>()
    for (const item of allItems) {
      if (!bySection.has(item.section)) bySection.set(item.section, [])
      bySection.get(item.section)!.push(item)
    }

    for (const [sectionTitle, items] of bySection) {
      // Section heading
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#1d4ed8')
        .text(sectionTitle.toUpperCase(), { characterSpacing: 0.5 })
      doc.fillColor('#000000').moveDown(0.2)

      for (const item of items) {
        const ratingLabel =
          item.rating === 'ok'  ? '[OK]'   :
          item.rating === 'na'  ? '[N/A]'  :
          item.rating === 'bad' ? '[FAIL]' : '[--]'

        const ratingColor =
          item.rating === 'ok'  ? '#16a34a' :
          item.rating === 'na'  ? '#6b7280' :
          item.rating === 'bad' ? '#dc2626' : '#94a3b8'

        const rowY = doc.y

        // Rating badge (left column, 46px wide)
        doc.fontSize(9).font('Helvetica-Bold').fillColor(ratingColor)
          .text(ratingLabel, 40, rowY, { width: 46 })

        // Item label (remaining width — may wrap)
        doc.fontSize(9).font('Helvetica').fillColor('#000000')
          .text(item.label, 92, rowY, { width: 479 })

        // Comment beneath (only for bad items)
        if (item.rating === 'bad' && item.comment) {
          doc.fontSize(8).font('Helvetica-Oblique').fillColor('#dc2626')
            .text('Comment: ' + item.comment, 92, doc.y, { width: 479 })
          doc.fillColor('#000000')
        }

        doc.moveDown(0.2)
      }

      doc.moveDown(0.5)
    }

    // ── Footer ───────────────────────────────────────────────────────
    doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
      .text('Generated automatically by NETC Fleet Tracker', { align: 'center' })

    doc.end()
  })
}

export async function POST(req: NextRequest) {
  try {
    const { truckId, unitNumber, inspector, date, failItems, allItems } = await req.json()

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

    const locationName    = (truck.locations as { name?: string } | null)?.name ?? 'Unknown Location'
    const formattedDate   = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })

    // ── Build HTML email body ─────────────────────────────────────────
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

        <p style="font-size:12px;color:#94a3b8;margin:0">Full inspection report attached as PDF.</p>
      </div>
    `

    // ── Build PDF attachment ──────────────────────────────────────────
    const emailBody: Record<string, unknown> = {
      from:    fromEmail,
      to:      [...recipients],
      subject: `Inspection Fails — ${unitNumber} (${(failItems as unknown[]).length} item${(failItems as unknown[]).length !== 1 ? 's' : ''})`,
      html,
    }

    if (Array.isArray(allItems) && allItems.length > 0) {
      const pdfBuffer = await buildInspectionPdf({ unitNumber, inspector, formattedDate, locationName, allItems })
      emailBody.attachments = [{
        filename: `inspection-${unitNumber}-${date}.pdf`,
        content:  pdfBuffer.toString('base64'),
      }]
    }

    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(emailBody),
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
