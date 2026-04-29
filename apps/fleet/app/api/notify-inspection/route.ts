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
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
    const { unitNumber, inspector, formattedDate, locationName, allItems } = opts

    const pdfDoc  = await PDFDocument.create()
    const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const italic  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

    const PW = 612, PH = 792, M = 40
    const LABEL_X = M + 46          // rating badge is 46pt wide
    const LABEL_W = PW - M - LABEL_X // remaining width for item text

    let page = pdfDoc.addPage([PW, PH])
    let y    = PH - M

    function ensureSpace(pts: number) {
      if (y - pts < M + 20) {
        page = pdfDoc.addPage([PW, PH])
        y    = PH - M
      }
    }

    function splitLines(text: string, font: typeof bold, size: number, maxW: number): string[] {
      const words = text.split(' ')
      const lines: string[] = []
      let line = ''
      for (const word of words) {
        const test = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(test, size) <= maxW) {
          line = test
        } else {
          if (line) lines.push(line)
          line = word
        }
      }
      if (line) lines.push(line)
      return lines.length ? lines : [text]
    }

    const BLACK = rgb(0, 0, 0)
    const GRAY  = rgb(0.39, 0.45, 0.55)
    const BLUE  = rgb(0.114, 0.306, 0.851)
    const GREEN = rgb(0.086, 0.639, 0.290)
    const MID   = rgb(0.420, 0.447, 0.502)
    const RED   = rgb(0.863, 0.149, 0.149)
    const LIGHT = rgb(0.580, 0.631, 0.682)

    // ── Title ───────────────────────────────────────────────────────────
    y -= 16
    const titleText = 'Monthly Vehicle Inspection'
    page.drawText(titleText, {
      x: (PW - bold.widthOfTextAtSize(titleText, 16)) / 2,
      y, font: bold, size: 16, color: BLACK,
    })
    y -= 18
    const subText = 'NETC Fleet Services  ·  Towing / Road Service / Transportation'
    page.drawText(subText, {
      x: (PW - regular.widthOfTextAtSize(subText, 10)) / 2,
      y, font: regular, size: 10, color: GRAY,
    })
    y -= 24

    // ── Info block ──────────────────────────────────────────────────────
    page.drawText('Unit:',      { x: M,   y, font: bold,    size: 10, color: BLACK })
    page.drawText(unitNumber,   { x: M+30, y, font: regular, size: 10, color: BLACK })
    page.drawText('Inspector:', { x: 300, y, font: bold,    size: 10, color: BLACK })
    page.drawText(inspector,    { x: 362, y, font: regular, size: 10, color: BLACK })
    y -= 16
    page.drawText('Location:',  { x: M,   y, font: bold,    size: 10, color: BLACK })
    page.drawText(locationName, { x: M+54, y, font: regular, size: 10, color: BLACK })
    page.drawText('Date:',      { x: 300, y, font: bold,    size: 10, color: BLACK })
    page.drawText(formattedDate,{ x: 330, y, font: regular, size: 10, color: BLACK })
    y -= 20

    // ── Divider ─────────────────────────────────────────────────────────
    page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.5, color: LIGHT })
    y -= 14

    // ── Sections ────────────────────────────────────────────────────────
    const bySection = new Map<string, AllItem[]>()
    for (const item of allItems) {
      if (!bySection.has(item.section)) bySection.set(item.section, [])
      bySection.get(item.section)!.push(item)
    }

    for (const [sectionTitle, items] of bySection) {
      ensureSpace(28)
      page.drawText(sectionTitle.toUpperCase(), {
        x: M, y, font: bold, size: 8, color: BLUE, characterSpacing: 0.5,
      })
      y -= 13

      for (const item of items) {
        const ratingLabel =
          item.rating === 'ok'  ? '[OK]'   :
          item.rating === 'na'  ? '[N/A]'  :
          item.rating === 'bad' ? '[FAIL]' : '[--]'
        const ratingColor =
          item.rating === 'ok'  ? GREEN :
          item.rating === 'na'  ? MID   :
          item.rating === 'bad' ? RED   : LIGHT

        const labelLines   = splitLines(item.label, regular, 9, LABEL_W)
        const commentLines = (item.rating === 'bad' && item.comment)
          ? splitLines('Comment: ' + item.comment, italic, 8, LABEL_W)
          : []
        const rowH = labelLines.length * 12 + commentLines.length * 11 + 5
        ensureSpace(rowH)

        // Rating badge aligned with first label line
        page.drawText(ratingLabel, { x: M, y, font: bold, size: 9, color: ratingColor })

        for (const line of labelLines) {
          page.drawText(line, { x: LABEL_X, y, font: regular, size: 9, color: BLACK })
          y -= 12
        }
        for (const line of commentLines) {
          page.drawText(line, { x: LABEL_X, y, font: italic, size: 8, color: RED })
          y -= 11
        }
        y -= 4
      }
      y -= 8
    }

    // ── Footer ──────────────────────────────────────────────────────────
    const footerText = 'Generated automatically by NETC Fleet Tracker'
    page.drawText(footerText, {
      x: (PW - regular.widthOfTextAtSize(footerText, 8)) / 2,
      y: M, font: regular, size: 8, color: LIGHT,
    })

    return Buffer.from(await pdfDoc.save())
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

    if (!supabaseUrl)  { console.error('[notify-inspection] Missing NEXT_PUBLIC_SUPABASE_URL');  return NextResponse.json({ skipped: true }) }
    if (!serviceKey)   { console.error('[notify-inspection] Missing SUPABASE_SERVICE_ROLE_KEY'); return NextResponse.json({ skipped: true }) }
    if (!resendApiKey) { console.error('[notify-inspection] Missing RESEND_API_KEY');            return NextResponse.json({ skipped: true }) }

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

    const emailBody: Record<string, unknown> = { from: fromEmail, to: [...recipients], subject, html }

    if (Array.isArray(allItems) && allItems.length > 0) {
      console.log('[notify-inspection] Generating PDF...')
      const pdfBuffer = await buildInspectionPdf({ unitNumber, inspector, formattedDate, locationName, allItems })
      if (pdfBuffer) {
        emailBody.attachments = [{ filename: `inspection-${unitNumber}-${date}.pdf`, content: pdfBuffer.toString('base64') }]
        console.log('[notify-inspection] PDF generated, bytes:', pdfBuffer.length)
      } else {
        console.warn('[notify-inspection] PDF skipped — sending without attachment')
      }
    }

    console.log('[notify-inspection] Sending to Resend:', [...recipients])
    const res     = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(emailBody),
    })
    const resBody = await res.text()

    if (!res.ok) {
      console.error('[notify-inspection] Resend error:', res.status, resBody)
      return NextResponse.json({ error: resBody }, { status: 500 })
    }

    console.log('[notify-inspection] Sent successfully:', resBody)
    return NextResponse.json({ sent: recipients.size })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[notify-inspection] Unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
