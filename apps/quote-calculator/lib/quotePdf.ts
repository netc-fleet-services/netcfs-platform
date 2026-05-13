import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { QuoteBreakdown, QuoteInputs, ServiceRate } from './types'

interface QuotePDFArgs {
  service: ServiceRate
  inputs: QuoteInputs
  quote: QuoteBreakdown
  callNum?: string | null
  yardName?: string
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const NETC_YELLOW: [number, number, number] = [255, 199, 0]
const NETC_INK: [number, number, number] = [25, 25, 25]
const NETC_MUTED: [number, number, number] = [120, 120, 120]
const NETC_RULE: [number, number, number] = [225, 225, 225]
const NETC_ERROR: [number, number, number] = [147, 0, 10]

const PAGE_W = 612
const MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2

function buildQuotePDF({ service, inputs, quote, callNum, yardName }: QuotePDFArgs): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const now = new Date()
  const date = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const quoteId = generateQuoteId(now)

  drawHeader(doc)
  let cursor = 140

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...NETC_MUTED)
  doc.text('Quote ID', MARGIN, cursor)
  doc.text('Date', PAGE_W - MARGIN - 150, cursor)
  if (callNum) doc.text('Call #', PAGE_W - MARGIN - 75, cursor)

  cursor += 14
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...NETC_INK)
  doc.text(quoteId, MARGIN, cursor)
  doc.text(`${date} · ${time}`, PAGE_W - MARGIN - 150, cursor)
  if (callNum) doc.text(callNum, PAGE_W - MARGIN - 75, cursor)

  cursor += 24
  drawRule(doc, cursor)
  cursor += 22

  const custLines = customerLine(inputs)
  if (custLines) {
    doc.setTextColor(...NETC_MUTED)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text('CUSTOMER', MARGIN, cursor)
    cursor += 14

    doc.setTextColor(...NETC_INK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(custLines[0], MARGIN, cursor)
    if (custLines[1]) {
      cursor += 14
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...NETC_MUTED)
      doc.text(custLines[1], MARGIN, cursor)
    }
    cursor += 20
  }

  if (inputs.pickup_address && inputs.drop_address) {
    const driveParts: string[] = []
    if (inputs.miles !== undefined) driveParts.push(`${inputs.miles.toFixed(1)} mi`)
    if (inputs.drive_hours !== undefined) driveParts.push(`${inputs.drive_hours.toFixed(2)} hr drive`)
    cursor = drawRouteBlock(doc, cursor, inputs.pickup_address, inputs.drop_address, driveParts.join(' · '))
    cursor += 12
  }

  const details: Array<[string, string]> = []
  details.push(['Service', service.name])
  if (yardName ?? inputs.yard_id) details.push(['Yard', yardName ?? inputs.yard_id!])
  if (inputs.equipment) details.push(['Equipment', inputs.equipment])
  if (inputs.has_tolls) details.push(['Tolls', 'Yes — see below'])

  cursor = drawDetailsGrid(doc, details, cursor)
  cursor += 18

  const showRange = quote.totalLow !== quote.total || quote.totalHigh !== quote.total

  autoTable(doc, {
    startY: cursor,
    head: [['Item', 'Detail', 'Amount']],
    body: quote.lines.map((l) => [l.label, sanitizeDetail(l), money(l.amount)]),
    theme: 'plain',
    styles: {
      fontSize: 10,
      cellPadding: { top: 7, right: 10, bottom: 7, left: 10 },
      lineColor: NETC_RULE,
      lineWidth: 0.5,
      textColor: NETC_INK,
    },
    headStyles: {
      fillColor: NETC_INK,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: { top: 8, right: 10, bottom: 8, left: 10 },
    },
    bodyStyles: { lineColor: NETC_RULE, lineWidth: { bottom: 0.5 } },
    columnStyles: {
      0: { cellWidth: 120, fontStyle: 'bold' },
      1: { cellWidth: 'auto', textColor: NETC_MUTED, fontSize: 9 },
      2: { cellWidth: 90, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: MARGIN, right: MARGIN },
  })

  const afterTable =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursor
  cursor = afterTable + 18

  const boxH = showRange ? 58 : 48
  doc.setFillColor(...NETC_YELLOW)
  doc.rect(MARGIN, cursor, CONTENT_W, boxH, 'F')
  doc.setTextColor(...NETC_INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(showRange ? 'ESTIMATED TOTAL' : 'TOTAL', MARGIN + 18, cursor + 22)

  doc.setFontSize(22)
  const totalText = showRange
    ? `${money(quote.totalLow)} – ${money(quote.totalHigh)}`
    : money(quote.total)
  doc.text(totalText, PAGE_W - MARGIN - 18, cursor + 26, { align: 'right' })

  if (showRange) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text('Range reflects ±20 min drive-time and ±15 mi variance', PAGE_W - MARGIN - 18, cursor + 44, { align: 'right' })
  }
  cursor += boxH + 20

  if (inputs.has_tolls) {
    doc.setFillColor(255, 240, 240)
    doc.rect(MARGIN, cursor, CONTENT_W, 32, 'F')
    doc.setTextColor(...NETC_ERROR)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('⚠ Tolled route', MARGIN + 12, cursor + 13)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80, 0, 0)
    doc.setFontSize(8.5)
    doc.text('GraphHopper detected tolled road segments on this route.', MARGIN + 12, cursor + 24)
    cursor += 42
  }

  if (inputs.notes?.trim()) {
    doc.setTextColor(...NETC_MUTED)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text('NOTES', MARGIN, cursor)
    cursor += 12
    doc.setTextColor(...NETC_INK)
    doc.setFontSize(10)
    const wrapped = doc.splitTextToSize(inputs.notes.trim(), CONTENT_W)
    doc.text(wrapped, MARGIN, cursor)
  }

  drawFooter(doc)

  const safeCall = callNum?.replace(/[^\w-]/g, '') || 'quote'
  const datestamp = now.toISOString().slice(0, 10)
  const filename = `NETC-quote-${safeCall}-${datestamp}.pdf`

  return { doc, filename }
}

export function downloadQuotePDF(args: QuotePDFArgs) {
  const { doc, filename } = buildQuotePDF(args)
  doc.save(filename)
}

export function generateQuotePDFBlob(args: QuotePDFArgs): { blob: Blob; filename: string } {
  const { doc, filename } = buildQuotePDF(args)
  return { blob: doc.output('blob'), filename }
}

function customerLine(inputs: QuoteInputs): [string, string?] | null {
  const name = inputs.customer_name?.trim()
  const phone = inputs.customer_phone?.trim()
  const email = inputs.customer_email?.trim()
  if (!name && !phone && !email) return null
  const primary = name || phone || email || ''
  const secondaryParts = [
    name && phone ? phone : null,
    (name || phone) && email ? email : null,
  ].filter(Boolean) as string[]
  return [primary, secondaryParts.join(' · ') || undefined]
}

function sanitizeDetail(line: { label: string; detail: string }): string {
  if (line.label === 'Fuel surcharge') return line.detail.split('—')[0]?.trim() ?? ''
  return line.detail
}

function drawRouteBlock(doc: jsPDF, y: number, pickupAddr: string, dropAddr: string, driveDetail: string): number {
  doc.setTextColor(...NETC_MUTED)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('ROUTE', MARGIN, y)
  if (driveDetail) doc.text(driveDetail.toUpperCase(), PAGE_W - MARGIN, y, { align: 'right' })

  const addrFontSize = 13
  const addrLineH = 16
  const pickupLines = doc.splitTextToSize(pickupAddr, CONTENT_W)
  const dropLines = doc.splitTextToSize(dropAddr, CONTENT_W)

  let yy = y + 20
  doc.setTextColor(...NETC_INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(addrFontSize)
  doc.text(pickupLines, MARGIN, yy)
  yy += addrLineH * pickupLines.length + 2

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(...NETC_MUTED)
  doc.text('to', MARGIN + 4, yy)
  yy += 14

  doc.setTextColor(...NETC_INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(addrFontSize)
  doc.text(dropLines, MARGIN, yy)
  yy += addrLineH * dropLines.length

  return yy + 4
}

function drawHeader(doc: jsPDF) {
  doc.setFillColor(...NETC_YELLOW)
  doc.rect(0, 0, PAGE_W, 96, 'F')
  doc.setTextColor(...NETC_INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('NETC FLEET SERVICES', MARGIN, 46)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text('Towing Quote', MARGIN, 66)
  doc.setDrawColor(...NETC_INK)
  doc.setLineWidth(1.5)
  doc.line(MARGIN, 90, PAGE_W - MARGIN, 90)
}

function drawRule(doc: jsPDF, y: number) {
  doc.setDrawColor(...NETC_RULE)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
}

function drawDetailsGrid(doc: jsPDF, rows: Array<[string, string]>, startY: number): number {
  const colW = CONTENT_W / 2 - 8
  const lineH = 22
  let y = startY
  for (let i = 0; i < rows.length; i += 2) {
    const left = rows[i]
    const right = rows[i + 1]
    drawDetailCell(doc, MARGIN, y, colW, left)
    if (right) drawDetailCell(doc, MARGIN + CONTENT_W / 2 + 8, y, colW, right)
    y += lineH
  }
  return y
}

function drawDetailCell(doc: jsPDF, x: number, y: number, w: number, [label, value]: [string, string]) {
  doc.setTextColor(...NETC_MUTED)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(label.toUpperCase(), x, y)
  doc.setTextColor(...NETC_INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  const wrapped = doc.splitTextToSize(value, w)
  doc.text(wrapped, x, y + 12)
}

function drawFooter(doc: jsPDF) {
  const y = 760
  doc.setDrawColor(...NETC_RULE)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...NETC_MUTED)
  doc.text(
    'This quote is an estimate. Final price may vary based on actual job conditions.',
    MARGIN,
    y + 14,
  )
}

function generateQuoteId(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `Q-${date}-${rand}`
}
