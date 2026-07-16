export interface SchedulerTab {
  id: 'drivers' | 'dispatchers' | 'stats' | 'historical' | 'settings'
  label: string
  functions: string[] | null
}

// ── Company buckets ─────────────────────────────────────────────────
// Two top-level companies: Interstate ("Company" === 'Interstate') and
// NETC (everything else — NETC, MBTR, Rays, and NULL fold together).
export type CompanyBucket = 'all' | 'interstate' | 'netc'

export function matchesCompanyBucket(company: string | null | undefined, bucket: CompanyBucket): boolean {
  if (bucket === 'all') return true
  const isInterstate = String(company ?? '').trim().toLowerCase() === 'interstate'
  return bucket === 'interstate' ? isInterstate : !isInterstate
}

// ── Teams ───────────────────────────────────────────────────────────
// A "team" is a type of work, unified across the two function-naming
// conventions: Interstate uses LDT/HDT, the NETC side uses the long
// names. The values are intentionally distinct in the data (same work,
// different companies) — do NOT normalize them.
export type TeamId = 'light' | 'heavy' | 'transport' | 'road'
export interface TeamDef {
  id: TeamId
  label: string
  functions: string[]
}

export interface OptimizerConfig {
  callsPerDriverPerHour: number
  understaffedThreshold: number
  overstaffedThreshold: number
  supplyFunctions: string[]
  excludeYards: string[]
  topUnderstaffedCount: number
  topOverstaffedCount: number
}

export const APP_CONFIG = {
  driverCategories: ['LDT', 'HDT', 'Transport', 'Road Service', 'Light Duty Towing', 'Heavy Duty Towing', 'Dispatch', 'Office Manager'] as const,

  schedulableFunctions: ['LDT', 'HDT', 'Transport', 'Road Service', 'Light Duty Towing', 'Heavy Duty Towing'] as const,

  tabs: [
    { id: 'drivers',     label: 'Drivers',     functions: ['LDT', 'HDT', 'Transport', 'Road Service', 'Light Duty Towing', 'Heavy Duty Towing'] },
    { id: 'dispatchers', label: 'Dispatchers', functions: ['Dispatch', 'Office Manager'] },
    { id: 'stats',       label: 'Stats',       functions: null },
    { id: 'historical',  label: 'Historical',  functions: null },
    { id: 'settings',    label: 'Settings',    functions: null },
  ] as SchedulerTab[],
  defaultTab: 'drivers' as const,

  // Top-level company scope pills. Interstate is the default so the live
  // Interstate schedulers see zero change until they click something.
  companyBuckets: [
    { id: 'all',        label: 'All Companies' },
    { id: 'netc',       label: 'NETC' },
    { id: 'interstate', label: 'Interstate' },
  ] as Array<{ id: CompanyBucket; label: string }>,
  defaultCompanyBucket: 'interstate' as CompanyBucket,

  // Team filter pills (drivers tab). Each team matches the function
  // spellings of BOTH companies so it works under "All Companies" too.
  teams: [
    { id: 'light',     label: 'Light Duty',   functions: ['LDT', 'Light Duty Towing'] },
    { id: 'heavy',     label: 'Heavy Duty',   functions: ['HDT', 'Heavy Duty Towing'] },
    { id: 'transport', label: 'Transport',    functions: ['Transport'] },
    { id: 'road',      label: 'Road Service', functions: ['Road Service'] },
  ] as TeamDef[],

  offReasons: ['PTO', 'sick', 'unavailable', 'other'] as const,

  timeStepMinutes: 30,

  defaultDayStartHour: 6,
  defaultDayEndHour: 22,

  weekStartsOnMonday: true,

  defaultViewDays: 7,
  viewDayChoices: [1, 2, 3, 4, 5, 6, 7, 14],

  // Still used by StatsView (stats stay Interstate-pinned — their demand
  // baseline is Interstate call data).
  defaultCompany: 'Interstate' as string | null,

  // Names suppressed entirely from scheduler/stats/print (case-insensitive,
  // trimmed). Use for managers / non-driver staff who happen to live in the
  // drivers table.
  excludedDriverNames: ['Stephen Gonneville'] as string[],

  // Yard merge map: real yard code -> display yard
  yardAliases: { '5': '1' } as Record<string, string>,

  // Demand-vs-supply optimizer defaults. Settings tab can override per-key
  // via the app_settings row "optimizer".
  optimizer: {
    callsPerDriverPerHour: 0.6,
    understaffedThreshold: -1.5,
    overstaffedThreshold: 2.0,
    supplyFunctions: ['LDT', 'HDT'],
    excludeYards: ['UFP'],
    topUnderstaffedCount: 5,
    topOverstaffedCount: 3,
  } as OptimizerConfig,
}

export type OffReason = (typeof APP_CONFIG.offReasons)[number]
