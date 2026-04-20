// Pure data processing — no DOM, no external imports.
// Pass the SheetJS library object (XLSX) to the parse* functions.

export interface RequiredInspection {
  driver: string
  date: string
  truck: string
}

export interface Completion {
  employee: string
  date: string
  truck: string
  passFail: string
}

export interface DriverResult {
  driver: string
  required: number
  completed: number
  missed: number
  pct: number
}

export interface FuzzyMatch {
  dispatchName: string
  inspectionName: string
  date: string
  truck: string
  matchType: string
}

export interface MissedDetail {
  driver: string
  date: string
  truck: string
}

export interface AuditResult {
  results: DriverResult[]
  dateRange: { min: string | null; max: string | null }
  fuzzyMatches: FuzzyMatch[]
  missedDetails: MissedDetail[]
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

export function normName(name: unknown): string {
  if (name == null) return ''
  return String(name).toLowerCase().trim().replace(/\s+/g, ' ')
}

export function normTruck(truck: unknown): string {
  if (truck == null) return ''
  return String(truck).toLowerCase().trim()
    .replace(/^[#\s]+/, '')
    .replace(/\*+$/, '')
    .replace(/\s+/g, ' ')
}

export function toDateStr(val: unknown): string | null {
  if (val == null || val === '') return null
  let d: Date
  if (val instanceof Date) {
    d = val
  } else if (typeof val === 'number') {
    d = new Date(Math.round((val - 25569) * 86400 * 1000))
  } else {
    d = new Date(String(val))
  }
  if (isNaN(d.getTime())) return null
  const y = d.getFullYear()
  if (y < 2000 || y > 2100) return null
  const m   = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[+m - 1]} ${+d}, ${y}`
}

// ---------------------------------------------------------------------------
// Fuzzy match helpers
// ---------------------------------------------------------------------------

export function namesMatch(a: string, b: string): boolean {
  const n1 = normName(a)
  const n2 = normName(b)
  if (!n1 || !n2) return false
  if (n1 === n2) return true

  const p1 = n1.split(' ')
  const p2 = n2.split(' ')
  if (p1.length < 2 || p2.length < 2) return false
  if (p1[p1.length - 1] !== p2[p2.length - 1]) return false

  const fn1 = p1[0], fn2 = p2[0]
  return fn1.startsWith(fn2) || fn2.startsWith(fn1)
}

export function trucksMatch(a: string, b: string): boolean {
  const t1 = normTruck(a)
  const t2 = normTruck(b)
  if (!t1 || !t2) return false
  if (t1 === t2) return true

  const nums1 = (a.match(/\d+/g) || []).filter(n => n.length >= 3)
  const nums2 = (b.match(/\d+/g) || []).filter(n => n.length >= 3)
  return nums1.length > 0 && nums2.length > 0 && nums1.some(n => nums2.includes(n))
}

// ---------------------------------------------------------------------------
// File parsers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseDriverActivity(workbook: any, XLSX: any): RequiredInspection[] {
  const ws = workbook.Sheets['Detailed']
  if (!ws) {
    throw new Error(
      '"Detailed" sheet not found. Make sure you uploaded the Driver Activity report (not the PreTrip file).'
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  const headerIdx = rows.findIndex(
    (r: unknown[]) => Array.isArray(r) && r[0] === 'Driver Name'
  )
  if (headerIdx < 0) {
    throw new Error(
      '"Driver Name" column not found in the Detailed sheet. Check that the correct file was uploaded.'
    )
  }

  const required = new Map<string, RequiredInspection>()

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !row[0]) continue

    const truck = row[13]
    if (!truck) continue

    const date =
      toDateStr(row[16]) ||
      toDateStr(row[17]) ||
      toDateStr(row[15]) ||
      toDateStr(row[20]) ||
      toDateStr(row[14])

    if (!date) continue

    const drivers = [row[0], row[1], row[2], row[3], row[4], row[5]]
      .map((d: unknown) => (d == null ? '' : String(d).trim()))
      .filter(Boolean)

    for (const driver of drivers) {
      const key = `${normName(driver)}||${date}||${normTruck(truck)}`
      if (!required.has(key)) {
        required.set(key, { driver, date, truck: String(truck).trim() })
      }
    }
  }

  return Array.from(required.values())
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parsePreTrip(workbook: any, XLSX: any): Completion[] {
  const ws = workbook.Sheets['Export']
  if (!ws) {
    throw new Error(
      '"Export" sheet not found. Make sure you uploaded the PreTrip Inspections report (not the Driver Activity file).'
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  const headerIdx = rows.findIndex(
    (r: unknown[]) => Array.isArray(r) && r[0] === 'Date' && r[3] === 'Employee'
  )
  if (headerIdx < 0) {
    throw new Error(
      '"Date" / "Employee" columns not found in the Export sheet. Check that the correct file was uploaded.'
    )
  }

  const completions = new Map<string, Completion>()

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !row[3]) continue

    const date = toDateStr(row[0])
    if (!date) continue

    const truck    = row[1] ? String(row[1]).trim() : ''
    const employee = String(row[3]).trim()
    const passFail = row[4] ? String(row[4]).trim() : ''

    const key = `${normName(employee)}||${date}||${normTruck(truck)}`
    if (!completions.has(key)) {
      completions.set(key, { employee, date, truck, passFail })
    }
  }

  return Array.from(completions.values())
}

// ---------------------------------------------------------------------------
// Audit engine
// ---------------------------------------------------------------------------

export function calculateAudit(
  required: RequiredInspection[],
  completions: Completion[]
): AuditResult {
  const exactKeys = new Set(
    completions.map(c => `${normName(c.employee)}||${c.date}||${normTruck(c.truck)}`)
  )

  const byDateTruck = new Map<string, Completion[]>()
  for (const c of completions) {
    const k = `${c.date}||${normTruck(c.truck)}`
    if (!byDateTruck.has(k)) byDateTruck.set(k, [])
    byDateTruck.get(k)!.push(c)
  }

  const byDate = new Map<string, Completion[]>()
  for (const c of completions) {
    if (!byDate.has(c.date)) byDate.set(c.date, [])
    byDate.get(c.date)!.push(c)
  }

  const driverStats  = new Map<string, { driver: string; required: number; completed: number }>()
  const fuzzyMatches: FuzzyMatch[]  = []
  const missedDetails: MissedDetail[] = []
  let minDate: string | null = null
  let maxDate: string | null = null

  for (const req of required) {
    const dKey = normName(req.driver)
    if (!driverStats.has(dKey)) {
      driverStats.set(dKey, { driver: req.driver, required: 0, completed: 0 })
    }
    const stat = driverStats.get(dKey)!
    stat.required++

    if (!minDate || req.date < minDate) minDate = req.date
    if (!maxDate || req.date > maxDate) maxDate = req.date

    // 1. Exact match
    const exactKey = `${normName(req.driver)}||${req.date}||${normTruck(req.truck)}`
    if (exactKeys.has(exactKey)) {
      stat.completed++
      continue
    }

    // 2. Fuzzy name match
    const sameDateTruck = byDateTruck.get(`${req.date}||${normTruck(req.truck)}`) || []
    const fuzzyName = sameDateTruck.find(c => namesMatch(req.driver, c.employee))
    if (fuzzyName) {
      stat.completed++
      fuzzyMatches.push({
        dispatchName:   req.driver,
        inspectionName: fuzzyName.employee,
        date:           req.date,
        truck:          req.truck,
        matchType:      'Name variation',
      })
      continue
    }

    // 3. Fuzzy truck match
    const sameDate = byDate.get(req.date) || []
    const fuzzyTruck = sameDate.find(
      c => normName(c.employee) === normName(req.driver) && trucksMatch(req.truck, c.truck)
    )
    if (fuzzyTruck) {
      stat.completed++
      fuzzyMatches.push({
        dispatchName:   req.driver,
        inspectionName: fuzzyTruck.employee,
        date:           req.date,
        truck:          req.truck,
        matchType:      'Truck label variation',
      })
      continue
    }

    missedDetails.push({ driver: req.driver, date: req.date, truck: req.truck })
  }

  const results: DriverResult[] = Array.from(driverStats.values()).map(s => ({
    driver:    s.driver,
    required:  s.required,
    completed: s.completed,
    missed:    s.required - s.completed,
    pct:       s.required > 0
      ? Math.round(s.completed / s.required * 1000) / 10
      : 100,
  }))

  results.sort((a, b) => a.pct - b.pct || a.driver.localeCompare(b.driver))
  missedDetails.sort((a, b) => a.date.localeCompare(b.date) || a.driver.localeCompare(b.driver))

  return { results, dateRange: { min: minDate, max: maxDate }, fuzzyMatches, missedDetails }
}
