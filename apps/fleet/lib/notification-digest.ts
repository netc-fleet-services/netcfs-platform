// ─────────────────────────────────────────────────────────────────────────────
// Fleet status-change digest — pure logic (no DB, no email, no network).
//
// This is the TypeScript production copy of the algorithm proven in
// notification-digest.mjs / notification-digest.test.mjs (run: `node --test`).
// Keep the two in sync — the .mjs is the tested spec, this is what the app imports.
// ─────────────────────────────────────────────────────────────────────────────

export const QUIET_MS = 5 * 60 * 1000   // send after 5 quiet minutes
export const CAP_MS   = 30 * 60 * 1000  // ...but never hold longer than 30 minutes

export type ChangeType = 'status' | 'waiting_on' | 'driver_note' | 'mechanic_note' | 'work_done'

export interface QueueChange {
  truckId:    string
  type:       ChangeType
  oldStatus?: string | null
  newStatus?: string | null
  value?:     string | null   // waiting-on / note text
  changedBy?: string | null
  createdAt:  number          // epoch ms
}

export interface TruckMeta {
  id:             string
  unit_number:    string
  category:       string | null
  location_id:    string | null
  locationName:   string
  current_status: string
  waiting_on?:    string | null
}

export interface NotificationRule {
  category:    string | null
  location_id: string | null
  emails:      string[] | null
}

export const STATUS_LABELS: Record<string, string> = {
  ready:  'Ready for Use',
  issues: 'Known Issues',
  oos:    'Out of Service',
}

export const CATEGORY_LABELS: Record<string, string> = {
  hd_tow:    'HD Tow',
  ld_tow:    'LD Tow',
  roadside:  'Roadside',
  transport: 'Transport',
  other:     'Other',
}

export const CHANGE_TYPE_LABELS: Record<string, string> = {
  waiting_on:    'Waiting On',
  driver_note:   'Driver Note',
  mechanic_note: 'Mechanic Note',
  work_done:     'Work Done',
}

const SEVERITY_ORDER: Record<string, number> = { oos: 0, issues: 1, ready: 2 }
const STATUS_COLORS:  Record<string, string> = { oos: '#dc2626', issues: '#d97706', ready: '#16a34a' }

// ── 1. The debounce decision ────────────────────────────────────────────────
export function decideFlush(
  pendingTimestamps: number[],
  now: number,
  opts: { quietMs?: number; capMs?: number } = {},
): { flush: boolean; reason: 'empty' | 'waiting' | 'quiet' | 'cap' } {
  const quietMs = opts.quietMs ?? QUIET_MS
  const capMs   = opts.capMs   ?? CAP_MS
  if (pendingTimestamps.length === 0) return { flush: false, reason: 'empty' }
  const newest = Math.max(...pendingTimestamps)
  const oldest = Math.min(...pendingTimestamps)
  if (now - newest >= quietMs) return { flush: true, reason: 'quiet' }
  if (now - oldest >= capMs)   return { flush: true, reason: 'cap' }
  return { flush: false, reason: 'waiting' }
}

// ── 2. No-op detection ──────────────────────────────────────────────────────
export function isStatusNoop(oldStatus: unknown, newStatus: unknown): boolean {
  return oldStatus === newStatus
}

export function isWaitingOnNoop(oldValue: string | null | undefined, newValue: string | null | undefined): boolean {
  return (oldValue ?? '').trim() === (newValue ?? '').trim()
}

// ── 3. Recipient matching (wildcards) ───────────────────────────────────────
export function matchRecipients(rules: NotificationRule[] | null | undefined, truck: TruckMeta): string[] {
  const out = new Set<string>()
  for (const rule of rules ?? []) {
    const categoryMatch = rule.category    == null || rule.category    === truck.category
    const locationMatch = rule.location_id == null || rule.location_id === truck.location_id
    if (categoryMatch && locationMatch) {
      for (const email of rule.emails ?? []) if (email) out.add(email)
    }
  }
  return [...out].sort()
}

// ── 4. HTML escaping ────────────────────────────────────────────────────────
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// ── 5. Collapse one truck's changes into a single section ───────────────────
export interface TruckSection {
  truckId:           string
  unitNumber:        string
  category:          string | null
  locationName:      string
  currentStatus:     string
  statusTrail:       string[]
  statusTrailLabels: string[]
  waitingOn:         string | null
  notes:             { kind: ChangeType; body: string | null; changedBy: string | null }[]
  changeCount:       number
}

function buildTruckSection(truck: TruckMeta, changes: QueueChange[]): TruckSection {
  const ordered = [...changes].sort((a, b) => a.createdAt - b.createdAt)

  const statusChanges = ordered.filter(c => c.type === 'status')
  let statusTrail: string[] = []
  if (statusChanges.length > 0) {
    statusTrail = [statusChanges[0].oldStatus ?? '', ...statusChanges.map(c => c.newStatus ?? '')]
      .filter((s, i, arr) => i === 0 || s !== arr[i - 1])
  }

  const notes = ordered
    .filter(c => c.type === 'driver_note' || c.type === 'mechanic_note' || c.type === 'work_done')
    .map(c => ({ kind: c.type, body: c.value ?? null, changedBy: c.changedBy ?? null }))

  const waitingOnChange = [...ordered].reverse().find(c => c.type === 'waiting_on')

  return {
    truckId:           truck.id,
    unitNumber:        truck.unit_number,
    category:          truck.category,
    locationName:      truck.locationName,
    currentStatus:     truck.current_status,
    statusTrail,
    statusTrailLabels: statusTrail.map(s => STATUS_LABELS[s] ?? s),
    // prefer the latest in-window waiting-on; otherwise show the truck's current value
    waitingOn:         waitingOnChange ? (waitingOnChange.value ?? null) : (truck.waiting_on ?? null),
    notes,
    changeCount:       changes.length,
  }
}

// ── 6. Build one recipient's ordered digest ─────────────────────────────────
export interface RecipientDigest {
  totalChanges: number
  truckCount:   number
  locations:    { location: string; trucks: TruckSection[] }[]
}

export function buildRecipientDigest(changes: QueueChange[], trucksById: Record<string, TruckMeta>): RecipientDigest {
  const byTruck = new Map<string, QueueChange[]>()
  for (const c of changes) {
    if (!byTruck.has(c.truckId)) byTruck.set(c.truckId, [])
    byTruck.get(c.truckId)!.push(c)
  }

  const sections: TruckSection[] = []
  for (const [truckId, truckChanges] of byTruck) {
    const truck = trucksById[truckId]
    if (!truck) continue
    sections.push(buildTruckSection(truck, truckChanges))
  }

  const byLocation = new Map<string, TruckSection[]>()
  for (const s of sections) {
    if (!byLocation.has(s.locationName)) byLocation.set(s.locationName, [])
    byLocation.get(s.locationName)!.push(s)
  }

  const locations = [...byLocation.keys()].sort()
  return {
    totalChanges: changes.length,
    truckCount:   sections.length,
    locations: locations.map(location => {
      const trucks = byLocation.get(location)!.sort((a, b) => {
        const sev = (SEVERITY_ORDER[a.currentStatus] ?? 99) - (SEVERITY_ORDER[b.currentStatus] ?? 99)
        if (sev !== 0) return sev
        return String(a.unitNumber).localeCompare(String(b.unitNumber))
      })
      return { location, trucks }
    }),
  }
}

// ── 7. Render a recipient's digest to HTML (all user text escaped) ──────────
export function renderDigestHtml(digest: RecipientDigest): string {
  const locationBlocks = digest.locations.map(loc => {
    const truckBlocks = loc.trucks.map(t => {
      const color = STATUS_COLORS[t.currentStatus] ?? '#64748b'
      const categoryName = CATEGORY_LABELS[t.category ?? ''] ?? t.category ?? ''
      const trail = t.statusTrailLabels.length
        ? `<div style="font-size:13px;color:#334155;margin-top:4px">${t.statusTrailLabels
            .map((s, i) => i === t.statusTrailLabels.length - 1 ? `<strong>${escapeHtml(s)}</strong>` : escapeHtml(s))
            .join(' &rarr; ')}${t.changeCount > 1 ? ` <span style="color:#94a3b8">(${t.changeCount} changes)</span>` : ''}</div>`
        : ''
      const waiting = t.waitingOn
        ? `<div style="font-size:13px;color:#334155;margin-top:2px"><span style="color:#64748b">Waiting on:</span> ${escapeHtml(t.waitingOn)}</div>`
        : ''
      const notes = t.notes.map(n =>
        `<div style="font-size:13px;color:#334155;margin-top:2px"><span style="color:#64748b">${escapeHtml(CHANGE_TYPE_LABELS[n.kind] ?? n.kind)}:</span> ${escapeHtml(n.body)}${n.changedBy ? ` <span style="color:#94a3b8;font-size:12px">by ${escapeHtml(n.changedBy)}</span>` : ''}</div>`
      ).join('')
      return `
        <div style="border-left:3px solid ${color};padding:6px 0 6px 12px;margin-bottom:12px">
          <div style="font-size:14px;font-weight:600;color:#0f172a">Unit ${escapeHtml(t.unitNumber)}${categoryName ? ` <span style="color:#94a3b8;font-weight:400">· ${escapeHtml(categoryName)}</span>` : ''}</div>
          ${trail}${waiting}${notes}
        </div>`
    }).join('')
    return `
      <div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#475569;border-bottom:1px solid #e2e8f0;padding:14px 0 8px;margin-bottom:8px">📍 ${escapeHtml(loc.location)}</div>
      ${truckBlocks}`
  }).join('')

  return `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 2px;color:#0f172a;font-size:18px">Fleet Updates</h2>
      <p style="margin:0 0 8px;color:#64748b;font-size:13px">NETC Fleet Services · ${digest.totalChanges} change${digest.totalChanges === 1 ? '' : 's'} across ${digest.truckCount} truck${digest.truckCount === 1 ? '' : 's'}</p>
      ${locationBlocks}
      <p style="font-size:11px;color:#94a3b8;margin:16px 0 0;border-top:1px solid #e2e8f0;padding-top:12px">
        You're receiving this because you subscribe to these categories/locations in NETC Fleet Tracker.
        Changes are batched into a short digest. Reply to contact your administrator.
      </p>
    </div>`
}
