export interface SchedulerTab {
  id: 'drivers' | 'dispatchers' | 'stats' | 'historical' | 'settings'
  label: string
  functions: string[] | null
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
  driverCategories: ['LDT', 'HDT', 'Transport', 'Road Service', 'Dispatch', 'Office Manager'] as const,

  schedulableFunctions: ['LDT', 'HDT', 'Transport', 'Road Service'] as const,

  tabs: [
    { id: 'drivers',     label: 'Drivers',     functions: ['LDT', 'HDT', 'Transport', 'Road Service'] },
    { id: 'dispatchers', label: 'Dispatchers', functions: ['Dispatch', 'Office Manager'] },
    { id: 'stats',       label: 'Stats',       functions: null },
    { id: 'historical',  label: 'Historical',  functions: null },
    { id: 'settings',    label: 'Settings',    functions: null },
  ] as SchedulerTab[],
  defaultTab: 'drivers' as const,

  offReasons: ['PTO', 'sick', 'unavailable', 'other'] as const,

  timeStepMinutes: 30,

  defaultDayStartHour: 6,
  defaultDayEndHour: 22,

  weekStartsOnMonday: true,

  defaultViewDays: 7,
  viewDayChoices: [1, 2, 3, 4, 5, 6, 7, 14],

  defaultCompany: 'Interstate' as string | null,

  allowedCompanies: ['Interstate'] as string[] | null,

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
