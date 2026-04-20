// Fleet Swap Model — core logic (TypeScript port of lib/model.js)
// Pure functions only — no DOM, no styles, no side effects.

export interface ModelValues {
  purchasePrice: number
  annualMiles: number
  baseMaintenance: number
  maintEscalation: number
  revenuePerDay: number
  resaleY2: number
  resaleY3: number
  resaleY4: number
  resaleY5: number
  resaleY6: number
  resaleY7: number
  resaleY8: number
}

export interface MonthData {
  m: number
  tYears: number
  cumMiles: number
  resaleValue: number
  depreciation: number
  cumMaint: number
  cumLost: number
  cumOpCost: number
  totalCost: number
  costPerYear: number
}

export interface Scenario {
  year: number
  cumMiles: number
  resaleValue: number
  depreciation: number
  cumMaint: number
  cumLost: number
  tco: number
  tcoPerYear: number
}

export interface YearRow {
  year: number
  cumMiles: number
  maintenance: number
  downtimeDays: number
  lostRevenue: number
  cumMaint: number
  cumLost: number
}

export interface ProjectionResult {
  months: MonthData[]
  opt: MonthData
  crossover: MonthData | null
  scenarios: Scenario[]
  winnerYearly: Scenario
  yearRows: YearRow[]
}

export const DEFAULTS: ModelValues = {
  purchasePrice:   185000,
  annualMiles:     45000,
  baseMaintenance: 6000,
  maintEscalation: 25,
  revenuePerDay:   1800,
  resaleY2: 72, resaleY3: 60, resaleY4: 50, resaleY5: 42,
  resaleY6: 35, resaleY7: 29, resaleY8: 24,
}

export const CONDITION_PROFILES: Record<string, { base: number; threshold: number; exponent: number }> = {
  easy:      { base: 3, threshold: 45000, exponent: 1.00 },
  typical:   { base: 5, threshold: 45000, exponent: 1.11 },
  punishing: { base: 7, threshold: 45000, exponent: 1.25 },
}

export const FIELDS = Object.keys(DEFAULTS) as (keyof ModelValues)[]

export const COMMA_FIELDS = new Set(['purchasePrice', 'annualMiles', 'baseMaintenance', 'revenuePerDay'])

export const money  = (n: number) => '$' + Math.round(n).toLocaleString()
export const num    = (n: number) => Math.round(n).toLocaleString()
export const parseN = (s: string | number): number => { const n = parseFloat(String(s).replace(/[,$\s]/g, '')); return isNaN(n) ? 0 : n }
export const fmtIn  = (n: number, f: string) => COMMA_FIELDS.has(f) ? Math.round(n).toLocaleString('en-US') : String(n)
export const mLabel = (m: number) => { const y = Math.floor(m / 12), mo = m % 12; return mo === 0 ? `Year ${y}` : `Year ${y} · M${mo}` }

export function buildPath(points: { x: number; y: number }[], xScale: (x: number) => number, yScale: (y: number) => number): string {
  return points.map((p, i) =>
    (i === 0 ? 'M' : 'L') + xScale(p.x).toFixed(1) + ',' + yScale(p.y).toFixed(1)
  ).join(' ')
}

export function projectFromData(v: ModelValues, condition = 'typical'): ProjectionResult {
  const profile      = CONDITION_PROFILES[condition] ?? CONDITION_PROFILES.typical
  const { base: baseDowntime, threshold, exponent } = profile
  const r = v.maintEscalation / 100

  const resaleAnchors: Record<number, number> = {
    0: 100, 1: (100 + v.resaleY2) / 2,
    2: v.resaleY2, 3: v.resaleY3, 4: v.resaleY4, 5: v.resaleY5,
    6: v.resaleY6, 7: v.resaleY7, 8: v.resaleY8,
  }
  function resalePctAt(tYears: number): number {
    const y  = Math.max(0, Math.min(8, tYears))
    const lo = Math.floor(y), hi = Math.min(8, lo + 1)
    return (resaleAnchors[lo] + (resaleAnchors[hi] - resaleAnchors[lo]) * (y - lo)) / 100
  }

  const months: MonthData[] = []
  let cumMaint = 0, cumLost = 0

  for (let m = 1; m <= 96; m++) {
    const tYears       = m / 12
    const cumMiles     = v.annualMiles * tYears
    const yearIdx      = Math.ceil(m / 12)
    const monthlyMaint = (v.baseMaintenance * Math.pow(1 + r, yearIdx - 1)) / 12
    const rawDowntime  = baseDowntime * Math.pow(cumMiles / threshold, exponent)
    const annualDT     = Math.min(60, rawDowntime)
    const monthlyLost  = (annualDT / 12) * v.revenuePerDay

    cumMaint += monthlyMaint
    cumLost  += monthlyLost

    const resaleValue  = v.purchasePrice * resalePctAt(tYears)
    const depreciation = v.purchasePrice - resaleValue
    const cumOpCost    = cumMaint + cumLost
    const totalCost    = depreciation + cumOpCost
    const costPerYear  = totalCost / tYears

    months.push({ m, tYears, cumMiles, resaleValue, depreciation,
                  cumMaint, cumLost, cumOpCost, totalCost, costPerYear })
  }

  let opt = months[23]
  for (let i = 23; i < months.length; i++) {
    if (months[i].costPerYear < opt.costPerYear) opt = months[i]
  }

  let crossover: MonthData | null = null
  for (const p of months) {
    if (p.cumOpCost >= p.resaleValue) { crossover = p; break }
  }

  const scenarios: Scenario[] = []
  for (let y = 2; y <= 8; y++) {
    const row = months[y * 12 - 1]
    scenarios.push({
      year: y, cumMiles: row.cumMiles, resaleValue: row.resaleValue,
      depreciation: row.depreciation, cumMaint: row.cumMaint,
      cumLost: row.cumLost, tco: row.totalCost, tcoPerYear: row.costPerYear,
    })
  }
  const winnerYearly = scenarios.reduce((a, b) => a.tcoPerYear < b.tcoPerYear ? a : b)

  const yearRows: YearRow[] = []
  for (let y = 1; y <= 8; y++) {
    const row  = months[y * 12 - 1]
    const prev = y === 1 ? { cumMaint: 0, cumLost: 0 } : months[(y - 1) * 12 - 1]
    yearRows.push({
      year: y, cumMiles: row.cumMiles,
      maintenance:  row.cumMaint - prev.cumMaint,
      downtimeDays: Math.min(60, baseDowntime * Math.pow(row.cumMiles / threshold, exponent)),
      lostRevenue:  row.cumLost - prev.cumLost,
      cumMaint: row.cumMaint, cumLost: row.cumLost,
    })
  }

  return { months, opt, crossover, scenarios, winnerYearly, yearRows }
}

export function validateData(v: ModelValues): { warnings: string[]; invalidFields: Set<string> } {
  const w: string[] = [], bad = new Set<string>()

  if (v.purchasePrice   <= 0) { w.push('Purchase Price must be greater than zero.');                                         bad.add('purchasePrice') }
  if (v.annualMiles     <= 0) { w.push('Annual Miles must be greater than zero.');                                           bad.add('annualMiles') }
  if (v.revenuePerDay   <= 0) { w.push('Revenue per Operating Day must be greater than zero.');                              bad.add('revenuePerDay') }
  if (v.baseMaintenance <  0) {                                                                                               bad.add('baseMaintenance') }
  if (v.maintEscalation <  0) { w.push('Maintenance escalation is negative — maintenance is shrinking, which is unusual.'); bad.add('maintEscalation') }
  if (v.maintEscalation > 100){ w.push('Maintenance escalation above 100%/yr is extreme — double-check this value.');       bad.add('maintEscalation') }

  const resales = [100, v.resaleY2, v.resaleY3, v.resaleY4, v.resaleY5, v.resaleY6, v.resaleY7, v.resaleY8]
  for (let i = 1; i < resales.length; i++) {
    if (resales[i] > 100 || resales[i] < 0) {
      w.push(`Resale % Year ${i + 1} must be between 0 and 100.`); bad.add('resaleY' + (i + 1))
    }
    if (resales[i] > resales[i - 1]) {
      w.push(`Resale % Year ${i + 1} (${resales[i]}%) is higher than Year ${i} — trucks don't appreciate.`)
      bad.add('resaleY' + (i + 1))
    }
  }
  if (v.baseMaintenance > v.purchasePrice * 0.5) {
    w.push('Year 1 base maintenance is more than half the purchase price — likely a typo.'); bad.add('baseMaintenance')
  }

  return { warnings: w, invalidFields: bad }
}

export function buildCSVString(scenarios: Scenario[], opt: MonthData): string {
  const rows = [
    ['Swap After','Cum Miles','Resale','Depreciation','Cum Maintenance','Cum Lost Revenue','Total Cost','Cost Per Year'],
    ...scenarios.map(s => [
      `Year ${s.year}`, Math.round(s.cumMiles), Math.round(s.resaleValue),
      Math.round(s.depreciation), Math.round(s.cumMaint), Math.round(s.cumLost),
      Math.round(s.tco), Math.round(s.tcoPerYear),
    ]),
    [],
    ['Optimal Month', opt.m, 'Cost/Year', Math.round(opt.costPerYear), 'Miles', Math.round(opt.cumMiles)],
  ]
  return rows.map(r => r.join(',')).join('\n')
}
