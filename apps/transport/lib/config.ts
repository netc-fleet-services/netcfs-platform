import type { CSSProperties } from 'react'
import type { Yard } from './types'

// ── Color Palette ──────────────────────────────────────────────────
// Structural colors map to NETCFS CSS variables (theme-aware).
// Status / accent colors stay as hex since they're used in alpha patterns.
export const C = {
  bg:  'rgb(var(--surface))',
  sf:  'rgb(var(--surface-container))',
  cd:  'rgb(var(--surface-container))',
  ca:  'rgb(var(--surface-high))',
  bd:  'rgb(var(--outline-variant))',
  tx:  'rgb(var(--on-surface))',
  dm:  'rgb(var(--on-surface-muted))',
  inp: 'rgb(var(--surface-high))',
  ac:  '#3b82f6',
  ad:  '#1d3461',
  gn:  '#22c55e',
  gb:  '#132e1b',
  am:  '#f59e0b',
  ab:  '#2d2006',
  rd:  '#ef4444',
  wh:  '#ffffff',
  pu:  '#a78bfa',
  pd:  '#2e1065',
  cy:  '#22d3ee',   // CLAIMED — dispatcher assigned on the board, not in TowBook yet
  cb:  '#083344',
} as const

export const PRI_COLORS: Record<string, string> = {
  urgent: '#ef4444',
  normal: '#f59e0b',
  flexible: '#22c55e',
}

// ── Shared Inline Style Objects ────────────────────────────────────
export const iS: CSSProperties = {
  background: C.inp, border: '1px solid ' + C.bd, borderRadius: 6,
  padding: '6px 8px', color: C.tx, fontSize: 12, fontFamily: 'inherit',
  outline: 'none', width: '100%', boxSizing: 'border-box',
}
export const sS: CSSProperties = {
  ...iS, cursor: 'pointer', appearance: 'none' as const, paddingRight: 22,
}
export const bP: CSSProperties = {
  background: C.ac, color: C.wh, border: 'none', borderRadius: 6,
  padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
}
export const bSt: CSSProperties = {
  background: 'transparent', color: C.dm, border: '1px solid ' + C.bd,
  borderRadius: 5, padding: '3px 7px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
}
export const cB: CSSProperties = {
  background: C.cd, border: '1px solid ' + C.bd, borderRadius: 8, padding: 11, marginBottom: 6,
}

// ── ID Generator ───────────────────────────────────────────────────
let _id = Date.now()
export function uid(): string { return String(_id++) }

// ── Yard Locations ─────────────────────────────────────────────────
// Live global populated from Supabase at startup. Starts with defaults.
export const DEFAULT_YARDS: Yard[] = [
  { id: 'exeter',     short: 'Exeter',       addr: '156 Epping Rd, Exeter NH',        zip: '03833' },
  { id: 'pembroke',   short: 'Pembroke',     addr: '107 Sheep Davis Rd, Pembroke NH', zip: '03275' },
  { id: 'mattbrowns', short: "Matt Brown's", addr: '26 Thibeault Dr, Bow NH',         zip: '03304' },
  { id: 'rays',       short: "Ray's Saco",   addr: '305 Bradley St, Saco ME',         zip: '04072' },
]

// Mutable global — updated in-place so geo/utils functions stay in sync.
export const YARDS: Yard[] = []

// ── Companies & teams ───────────────────────────────────────────────
// Company pills are built from the live roster's "Company" values (NETC,
// Interstate, MBTR, Rays, …) plus an "All Companies" option. Drivers with
// no Company set count as NETC.
export function driverCompany(company: string | null | undefined): string {
  return String(company ?? '').trim() || 'NETC'
}

// Preferred pill order — anything not listed sorts alphabetically after.
export const COMPANY_ORDER = ['NETC', 'Interstate', 'MBTR', 'Rays']

export type TeamId = 'light' | 'heavy' | 'transport' | 'road'
export interface TeamDef { id: TeamId; label: string; functions: string[] }

// Function options for the roster editor — both companies' spellings.
export const DRIVER_FUNCTIONS = ['Transport', 'Heavy Duty Towing', 'Road Service', 'Light Duty Towing', 'LDT', 'HDT']

export const BOARD = {
  defaultCompany: 'all' as string,   // 'all' or an exact "Company" value

  // Team pills — each matches BOTH function spellings (Interstate's LDT/HDT
  // and the NETC side's long names). Same work, different companies; the two
  // conventions are intentional and never normalized.
  teams: [
    { id: 'light',     label: 'Light Duty',   functions: ['LDT', 'Light Duty Towing'] },
    { id: 'heavy',     label: 'Heavy Duty',   functions: ['HDT', 'Heavy Duty Towing'] },
    { id: 'transport', label: 'Transport',    functions: ['Transport'] },
    { id: 'road',      label: 'Road Service', functions: ['Road Service'] },
  ] as TeamDef[],
  defaultTeam: 'transport' as TeamId | 'all',

  // Open-calls rail: which canonical jobs.job_type values belong to each team.
  // Jobs with NULL job_type are always shown.
  teamJobTypes: {
    light:     ['Light Duty Tow'],
    heavy:     ['Heavy Duty Tow', 'Crane Service'],
    transport: ['Equipment Transport'],
    road:      ['Road Service'],
  } as Record<TeamId, string[]>,

  // Sync staleness thresholds (minutes since settings.last_synced)
  staleWarnMin: 10,
  staleAlertMin: 20,
}

// TowBook call numbers carry a location prefix (first digit).
// Unknown/missing prefix → null (the call shows under every company).
export const CALL_PREFIX_COMPANY: Record<string, string> = {
  '1': 'NETC',
  '2': 'MBTR',
  '3': 'Rays',
  '4': 'Interstate',
}
export function callCompany(callNum: string | null): string | null {
  const ch = (callNum ?? '').trim()[0]
  return ch ? (CALL_PREFIX_COMPANY[ch] ?? null) : null
}

