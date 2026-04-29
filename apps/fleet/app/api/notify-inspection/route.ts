import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
}): Promise<Buffer | null> {
  try {
    // Dynamic import so a missing pdfkit package cannot crash the entire route
    const PDFDocument = (await import('pdfkit')).default
    const { unitNumber, inspector, formattedDate, locationName, allItems } = opts

    return new Promise<Buffer>((resolve, reject) => {
      const doc    = new PDFDocument({ margin: 40, size: 'LETTER' })
      const chunks: Buffer[] = []
      doc.on('data',  (c: Buffer) => chunks.push(c))
      doc.on('end',   () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // ── Title ──────────────────────────────────────────────────────
      doc.fontSize(16).font('Helvetica-Bold')
        .text('Monthly Vehicle Inspection', { align: 'center' })
      doc.fontSize(10).font('Helvetica')
        .text('NETC Fleet Services  ·  Towing / Road Service / Transportation', { align: 'center' })
      doc.moveDown(0.75)

      // ── Info block ─────────────────────────────────────────────────
      const top = doc.y
      doc.fontSize(10).font('Helvetica-Bold').text('Unit:',      40,  top)
      doc.font('Helvetica').text(unitNumber,                     90,  top)
      doc.font('Helvetica-Bold').text('Inspector:',              300, top)
      doc.font('Helvetica').text(inspector,                      365, top)
      doc.font('Helvetica-Bold').text('Location:',               40,  top + 18)
      doc.font('Helvetica').text(locationName,                   100, top + 18)
      doc.font('Helvetica-Bold').text('Date:',                   300, top + 18)
      doc.font('Helvetica').text(formattedDate,                  335, top + 18)
      doc.moveDown(2.25)

      // ── Divider ────────────────────────────────────────────────────
      doc.moveTo(40, doc.y).lineTo(571, doc.y).strokeColor('#cccccc').stroke()
      doc.moveDown(0.75)

      // ── Sections ───────────────────────────────────────────────────
      const bySection = new Map<string, AllItem[]>()
      for (const item of allItems) {
        if (!bySection.has(item.section)) bySection.set(item.section, [])
        bySection.get(item.section)!.push(item)
      }

      for (const [sectionTitle, items] of bySection) {
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
          doc.fontSize(9).font('Helvetica-Bold').fillColor(ratingColor)
            .text(ratingLabel, 40, rowY, { width: 46 })
          doc.fontSize(9).font('Helvetica').fillColor('#000000')
            .text(item.label, 92, rowY, { width: 479 })

          if (item.rating === 'bad' && item.comment) {
            doc.fontSize(8).font('Helvetica-Oblique').fillColor('#dc2626')
              .text('Comment: ' + item.comment, 92, doc.y, { width: 479 })
            doc.fillColor('#000000')
          }
          doc.moveDown(0.2)
        }
        doc.moveDown(0.5)
      }

      doc.fontSize(8).font('Helvetica').fillColor('#94a3b8')
        .text('Generated automatically by NETC Fleet Tracker', { align: 'center' })
      doc.end()
    })
  } catch (e) {
    console.error('[notify-inspection] PDF generation failed:', e)
    return null
  }
}

export async function POST(req: NextRequest) {
  console.log('[notify-inspection] Route called')
  try {
    const body = await req.json()
    const { truckId, unitNumber, inspector, date, hasFails, failItems, allItems } = body
    console.log('[notify-inspection] Payload:', { truckId, unitNumber, inspector, date, hasFails, failCount: (failItems as unknown[])?.length, allItemCount: (allItems as unknown[])?.length })

    const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
    const resendApiKey = process.env.RESEND_API_KEY
    const fromEmail    = process.env.NOTIFY_FROM_EMAIL ?? 'noreply@netruckcenter.com'

    if (!supabaseUrl)  { console.error('[notify-inspection] Missing NEXT_PUBLIC_SUPABASE_URL'); return NextResponse.json({ skipped: true }) }
    if (!serviceKey)   { console.error('[notify-inspection] Missing SUPABASE_SERVICE_ROLE_KEY'); return NextResponse.json({ skipped: true }) }
    if (!resendApiKey) { console.error('[notify-inspection] Missing RESEND_API_KEY'); return NextResponse.json({ skipped: true }) }

    const supabase = createClient(supabaseUrl, serviceKey)

    const { data: truck, error: truckErr } = await supabase
      .from('trucks')
      .select('category, location_id, locations(name)')
      .eq('id', truckId)
      .single()

    if (truckErr) console.error('[notify-inspection] Truck lookup error:', truckErr.message)
    if (!truck)   { console.warn('[notify-inspection] Truck not found for id:', truckId); return NextResponse.json({ skipped: true }) }
    console.log('[notify-inspection] Truck:', { category: truck.category, location_id: truck.location_id })

    const { data: rules, error: rulesErr } = await supabase
      .from('notification_settings')
      .select('category, location_id, emails')

    if (rulesErr) console.error('[notify-inspection] Rules lookup error:', rulesErr.message)
    console.log('[notify-inspection] Rules found:', rules?.length ?? 0)

    const recipients = new Set<string>()
    for (const rule of rules ?? []) {
      const categoryMatch = rule.category    === null || rule.category    === truck.category
      const locationMatch = rule.location_id === null || rule.location_id === truck.location_id
      console.log('[notify-inspection] Rule check:', { rule_cat: rule.category, rule_loc: rule.location_id, categoryMatch, locationMatch })
      if (categoryMatch && locationMatch) {
        for (const email of rule.emails ?? []) {
          if (email) recipients.add(email)
        }
      }
    }

    console.log('[notify-inspection] Recipients:', [...recipients])
    if (recipients.size === 0) {
      console.warn('[notify-inspection] No matching recipients — check notification rules match truck category/location')
      return NextResponse.json({ sent: 0 })
    }

    const locationName  = (truck.locations as { name?: string } | null)?.name ?? 'Unknown Location'
    const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })

    const failList  = (failItems as { label: string; comment: string }[]) ?? []
    const hasFailsB = Boolean(hasFails) || failList.length > 0

    const failSection = hasFailsB ? `
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#dc2626">Failed Items (${failList.length})</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#fff;border:1px solid #fecaca;border-radius:8px;overflow:hidden">
          <tr style="background:#fef2f2">
            <td style="padding:8px 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Item</td>
            <td style="padding:8px 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Comment / Corrective Action</td>
          </tr>
          ${failList.map(f => `
            <tr>
              <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #fef2f2">${f.label}</td>
              <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #fef2f2;color:#dc2626">${f.comment || '—'}</td>
            </tr>`).join('')}
        </table>` : `
        <p style="margin:0 0 20px;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:13px;color:#16a34a;font-weight:600">
          ✓ All items passed — no failures recorded
        </p>`

    const subject = hasFailsB
      ? `Inspection — ${unitNumber} · ${failList.length} failed item${failList.length !== 1 ? 's' : ''}`
      : `Inspection Complete — ${unitNumber} · All passed`

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">Vehicle Inspection — ${unitNumber}</h2>
        <p style="margin:0 0 20px;color:#64748b;font-size:14px">NETC Fleet Services · ${formattedDate}</p>
        ${failSection}
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:130px">Unit</td><td style="padding:6px 0;font-weight:600;font-size:13px">${unitNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Location</td><td style="padding:6px 0;font-size:13px">${locationName}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Inspector</td><td style="padding:6px 0;font-size:13px">${inspector}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Date</td><td style="padding:6px 0;font-size:13px">${formattedDate}</td></tr>
        </table>
        <p style="font-size:12px;color:#94a3b8;margin:0">Full inspection report attached as PDF.</p>
      </div>
    `

    const emailBody: Record<string, unknown> = {
      from:    fromEmail,
      to:      [...recipients],
      subject,
      html,
    }

    if (Array.isArray(allItems) && allItems.length > 0) {
      console.log('[notify-inspection] Generating PDF...')
      const pdfBuffer = await buildInspectionPdf({ unitNumber, inspector, formattedDate, locationName, allItems })
      if (pdfBuffer) {
        emailBody.attachments = [{
          filename: `inspection-${unitNumber}-${date}.pdf`,
          content:  pdfBuffer.toString('base64'),
        }]
        console.log('[notify-inspection] PDF generated, size:', pdfBuffer.length)
      } else {
        console.warn('[notify-inspection] PDF skipped — sending email without attachment')
      }
    }

    console.log('[notify-inspection] Sending email via Resend to:', [...recipients])
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(emailBody),
    })

    const resBody = await res.text()
    if (!res.ok) {
      console.error('[notify-inspection] Resend error:', res.status, resBody)
      return NextResponse.json({ error: resBody }, { status: 500 })
    }

    console.log('[notify-inspection] Email sent successfully:', resBody)
    return NextResponse.json({ sent: recipients.size })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[notify-inspection] Unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
