import type { QuoteBreakdown, QuoteInputs, QuoteLine, ServiceRate } from './types'

const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export interface FuelSurchargeBasis {
  percent: number
  date: string
  location: string
  product: string
  fuelTotal: number
}

export const CREDIT_CARD_FEE_PERCENT = 3.5
export const TIME_UNCERTAINTY_HOURS = 20 / 60
export const MILES_UNCERTAINTY = 15

interface CoreResult {
  lines: QuoteLine[]
  total: number
}

function computeLines(
  rate: ServiceRate,
  inputs: QuoteInputs,
  fuelSurcharge: FuelSurchargeBasis | null | undefined,
  creditCardFee: boolean | undefined,
): CoreResult {
  const lines: QuoteLine[] = []
  const hours = inputs.hours ?? 0
  const miles = inputs.miles ?? 0
  const travelHours = inputs.travel_hours ?? 0
  const partsCost = inputs.parts_cost ?? 0

  if (rate.flat_rate !== null) {
    lines.push({ label: 'Flat rate', detail: money(rate.flat_rate), amount: rate.flat_rate })
  }

  const isIdleRate = rate.travel_hourly_rate !== null
  const laborLabel = isIdleRate ? 'Idle (on-scene)' : 'Labor'

  if (rate.hourly_rate !== null) {
    const minHours = rate.minimum_hours ?? 0
    const billable = Math.max(hours, minHours)
    const amount = round2(rate.hourly_rate * billable)
    const minNote = minHours > 0 && hours < minHours ? ` (${minHours} hr min)` : ''
    lines.push({ label: laborLabel, detail: `${round2(billable)} hr × ${money(rate.hourly_rate)}${minNote}`, amount })
  }

  if (rate.hookup_fee !== null) {
    lines.push({ label: 'Hookup fee', detail: money(rate.hookup_fee), amount: rate.hookup_fee })
  }

  if (rate.per_mile_rate !== null && miles > 0) {
    const amount = round2(rate.per_mile_rate * miles)
    lines.push({ label: 'Mileage', detail: `${miles} mi × ${money(rate.per_mile_rate)}`, amount })
  }

  if (rate.travel_per_mile_rate !== null && miles > 0) {
    const amount = round2(rate.travel_per_mile_rate * miles)
    lines.push({ label: 'Travel (mileage)', detail: `${miles} mi × ${money(rate.travel_per_mile_rate)}`, amount })
  }

  if (rate.travel_hourly_rate !== null && travelHours > 0) {
    const amount = round2(rate.travel_hourly_rate * travelHours)
    lines.push({ label: 'Travel (hourly)', detail: `${round2(travelHours)} hr × ${money(rate.travel_hourly_rate)}`, amount })
  }

  if (rate.parts_applicable && partsCost > 0) {
    lines.push({ label: 'Parts', detail: money(partsCost), amount: round2(partsCost) })
  }

  const extraHours = inputs.extra_hours ?? 0
  if (extraHours > 0 && rate.hourly_rate !== null) {
    const amount = round2(rate.hourly_rate * extraHours)
    lines.push({ label: 'Extra hours', detail: `${extraHours} hr × ${money(rate.hourly_rate)}`, amount })
  }

  const extraCharge = inputs.extra_charge ?? 0
  if (extraCharge > 0) {
    lines.push({ label: 'Extra charge', detail: money(extraCharge), amount: round2(extraCharge) })
  }

  if (fuelSurcharge && fuelSurcharge.percent > 0) {
    const subtotal = lines.reduce((sum, l) => sum + l.amount, 0)
    const amount = round2(subtotal * (fuelSurcharge.percent / 100))
    if (amount > 0) {
      lines.push({ label: 'Fuel surcharge', detail: `${fuelSurcharge.percent.toFixed(2)}%`, amount })
    }
  }

  const permitCost = inputs.permit_cost ?? 0
  if (permitCost > 0) {
    lines.push({ label: 'Permit', detail: money(permitCost), amount: round2(permitCost) })
  }

  const escortCost = inputs.escort_cost ?? 0
  if (escortCost > 0) {
    const marked = round2(escortCost * 1.25)
    lines.push({ label: 'Escort fee', detail: `${money(escortCost)} + 25%`, amount: marked })
  }

  if (creditCardFee) {
    const subtotal = lines.reduce((sum, l) => sum + l.amount, 0)
    const amount = round2(subtotal * (CREDIT_CARD_FEE_PERCENT / 100))
    if (amount > 0) {
      lines.push({ label: 'Credit card fee', detail: `${CREDIT_CARD_FEE_PERCENT.toFixed(2)}% processing fee`, amount })
    }
  }

  const total = round2(lines.reduce((sum, l) => sum + l.amount, 0))
  return { lines, total }
}

export function calculateQuote(
  rate: ServiceRate,
  inputs: QuoteInputs,
  fuelSurcharge?: FuelSurchargeBasis | null,
  creditCardFee?: boolean,
): QuoteBreakdown {
  const base = computeLines(rate, inputs, fuelSurcharge, creditCardFee)

  const isIdleRate = rate.travel_hourly_rate !== null
  const shift = (hoursDelta: number, milesDelta: number): QuoteInputs => {
    const adj = { ...inputs }
    if (isIdleRate) {
      const t = (adj.travel_hours ?? 0) + hoursDelta
      adj.travel_hours = Math.max(0, t)
    } else if (rate.hourly_rate !== null) {
      const h = (adj.hours ?? 0) + hoursDelta
      adj.hours = Math.max(0, h)
    }
    if (adj.miles !== undefined) adj.miles = Math.max(0, adj.miles + milesDelta)
    return adj
  }

  const low = computeLines(rate, shift(-TIME_UNCERTAINTY_HOURS, -MILES_UNCERTAINTY), fuelSurcharge, creditCardFee)
  const high = computeLines(rate, shift(TIME_UNCERTAINTY_HOURS, MILES_UNCERTAINTY), fuelSurcharge, creditCardFee)

  return { lines: base.lines, total: base.total, totalLow: low.total, totalHigh: high.total }
}

export function formatMoney(n: number) {
  return money(n)
}
