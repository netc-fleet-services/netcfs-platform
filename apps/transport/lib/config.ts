import type { CSSProperties } from 'react'
import type { Driver, Yard } from './types'

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

// ── Default Driver Roster ──────────────────────────────────────────
export const defaultDrivers: Driver[] = [
  { id: 1, name: 'Robert Welch',      truck: '3223', yard: 'exeter',     func: 'Transport' },
  { id: 2, name: 'Trevor Tardif',     truck: '49',   yard: 'exeter',     func: 'Transport' },
  { id: 3, name: 'Greg Rutherford',   truck: '2425', yard: 'exeter',     func: 'Transport' },
  { id: 4, name: 'Matt Cashin',       truck: '5222', yard: 'exeter',     func: 'Transport' },
  { id: 5, name: 'Kevin Curtis',      truck: '721',  yard: 'pembroke',   func: 'Transport' },
  { id: 6, name: 'Robert Deleon',     truck: '2125', yard: 'mattbrowns', func: 'Transport' },
  { id: 7, name: 'Andrew Broughton',  truck: '2822', yard: 'mattbrowns', func: 'Transport' },
  { id: 8, name: 'Jonathan Wright',   truck: '52',   yard: 'mattbrowns', func: 'Transport' },
]

export const DRIVER_FUNCTIONS = ['Transport', 'Heavy Duty Towing', 'Road Service', 'Light Duty Towing']

// ── TowBook Bookmarklet ────────────────────────────────────────────
// Run on the TowBook dispatch page to copy jobs to clipboard.
export const NETC_BM = 'javascript:(function(){function xz(a){var m=a.match(/\\b[A-Za-z]{2}\\s*(\\d{5})\\b/);if(m)return m[1];var all=[],re=/\\b(\\d{5})\\b/g,r;while((r=re.exec(a))!==null)all.push(r[1]);return all.length?all[all.length-1]:\'\';}function xc(s){return s.replace(/\\s*\\([^)]*\\)\\s*$/,\'\').replace(/,?\\s*USA\\s*$/i,\'\').trim();}function xa(s){if(!s||/^\\d/.test(s))return s;var m=s.match(/\\d+\\s+[A-Za-z]/);return m?s.substring(m.index):s;}var rows=document.querySelectorAll(\'li.entryRow\');var jobs=[];rows.forEach(function(r){var lis=r.querySelectorAll(\'ul.details1>li\');var pickup=\'\',drop=\'\',desc=\'\',sched=\'\',reason=\'\',driver=\'\',truck=\'\';for(var i=0;i<lis.length;i++){var tEl=lis[i].querySelector(\'.title\');var vEl=lis[i].querySelector(\'.text\');if(!tEl||!vEl)continue;var lbl=tEl.textContent.trim();var val=(vEl.getAttribute(\'title\')||vEl.textContent).replace(/\\s+/g,\' \').trim();if(lbl===\'Tow Source\')pickup=val;else if(lbl===\'Reason\')reason=val;else if(lbl===\'Driver\')driver=val;else if(lbl===\'Truck\')truck=val;else if(lbl===\'Destination\')drop=val;}pickup=xa(xc(pickup));drop=xa(xc(drop));var bEl=r.querySelector(\'.big-text\');if(bEl)desc=(bEl.getAttribute(\'title\')||bEl.textContent).trim();var eta=r.querySelector(\'.scheduled-eta-container\');if(eta){var sp=eta.closest(\'span[title]\');if(sp){var title=sp.getAttribute(\'title\');var paren=title.indexOf(\'(\');sched=paren>-1?title.substring(0,paren).trim():title.trim();}}var pz=xz(pickup),dz=xz(drop);var cn=r.getAttribute(\'data-call-number\')||\'\';if(pickup||drop)jobs.push({callNum:cn,desc:desc,pickup:pickup,drop:drop,pickupZip:pz,dropZip:dz,scheduled:sched,reason:reason,driver:driver,truck:truck});});var json=JSON.stringify(jobs);var ta=document.createElement(\'textarea\');ta.value=json;ta.style.position=\'fixed\';ta.style.left=\'-9999px\';document.body.appendChild(ta);ta.select();document.execCommand(\'copy\');document.body.removeChild(ta);var rt={};jobs.forEach(function(j){if(j.reason)rt[j.reason]=(rt[j.reason]||0)+1;});alert(\'Copied \'+jobs.length+\' jobs\\n\\nTypes: \'+Object.keys(rt).sort().map(function(k){return k+\': \'+rt[k]}).join(\', \')+\'\\n\\nOpen Planner > Import\');})()';
