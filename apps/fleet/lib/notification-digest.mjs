// ─────────────────────────────────────────────────────────────────────────────
// TEST B — pure logic for the fleet status-change digest.
//
// This is the "brain" of the feature, written as pure functions with NO database,
// NO email, NO network — so it can be proven correct in isolation. When we do the
// full build, these get ported into the app's TypeScript (lib/notification-digest.ts)
// and called by the flush endpoint. Nothing here touches production.
// ─────────────────────────────────────────────────────────────────────────────

export const QUIET_MS = 5 * 60 * 1000   // send after 5 quiet minutes
export const CAP_MS   = 30 * 60 * 1000  // ...but never hold longer than 30 minutes

const SEVERITY_ORDER = { oos: 0, issues: 1, ready: 2 }

const STATUS_LABELS = {
  ready:  'Ready for Use',
  issues: 'Known Issues',
  oos:    'Out of Service',
}

// ── 1. The debounce decision ────────────────────────────────────────────────
// Given the timestamps (ms) of everything currently waiting, and "now", decide
// whether it's time to send. Reset-on-change is automatic: the newest timestamp
// moves forward every time a change arrives, pushing the quiet deadline out.
export function decideFlush(pendingTimestamps, now, opts = {}) {
  const quietMs = opts.quietMs ?? QUIET_MS
  const capMs   = opts.capMs   ?? CAP_MS

  if (pendingTimestamps.length === 0) {
    return { flush: false, reason: 'empty' }
  }
  const newest = Math.max(...pendingTimestamps)
  const oldest = Math.min(...pendingTimestamps)

  if (now - newest >= quietMs) return { flush: true, reason: 'quiet' }
  if (now - oldest >= capMs)   return { flush: true, reason: 'cap' }
  return { flush: false, reason: 'waiting' }
}

// ── 2. No-op detection ──────────────────────────────────────────────────────
export function isStatusNoop(oldStatus, newStatus) {
  return oldStatus === newStatus
}

export function isWaitingOnNoop(oldValue, newValue) {
  return (oldValue ?? '').trim() === (newValue ?? '').trim()
}

// ── 3. Recipient matching (wildcards) ───────────────────────────────────────
// A rule's null category/location means "all". Returns a de-duped, sorted list.
export function matchRecipients(rules, truck) {
  const out = new Set()
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
// User-typed text (notes, waiting-on) is escaped so a stray character can't
// break the digest layout for everyone.
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// ── 5. Collapse one truck's changes into a single section ───────────────────
// Multiple status changes become one trail (Ready → Issues → Out of Service).
function buildTruckSection(truck, changes) {
  const ordered = [...changes].sort((a, b) => a.createdAt - b.createdAt)

  const statusChanges = ordered.filter(c => c.type === 'status')
  let statusTrail = []
  if (statusChanges.length > 0) {
    statusTrail = [statusChanges[0].oldStatus, ...statusChanges.map(c => c.newStatus)]
      .filter((s, i, arr) => i === 0 || s !== arr[i - 1]) // drop consecutive repeats
  }

  const notes = ordered
    .filter(c => c.type === 'driver_note' || c.type === 'mechanic_note' || c.type === 'work_done')
    .map(c => ({ kind: c.type, body: c.value, changedBy: c.changedBy }))

  const waitingOnChange = [...ordered].reverse().find(c => c.type === 'waiting_on')

  return {
    truckId:       truck.id,
    unitNumber:    truck.unit_number,
    category:      truck.category,
    locationName:  truck.locationName,
    currentStatus: truck.current_status,
    statusTrail,                              // [] if no status change in window
    statusTrailLabels: statusTrail.map(s => STATUS_LABELS[s] ?? s),
    waitingOn:     waitingOnChange ? waitingOnChange.value : null,
    notes,
    changeCount:   changes.length,
  }
}

// ── 6. Build one recipient's ordered digest ─────────────────────────────────
// Groups by location (alphabetical), then by severity (OOS → Issues → Ready),
// then by unit number. `trucksById` supplies each truck's current metadata.
export function buildRecipientDigest(changes, trucksById) {
  // group changes by truck
  const byTruck = new Map()
  for (const c of changes) {
    if (!byTruck.has(c.truckId)) byTruck.set(c.truckId, [])
    byTruck.get(c.truckId).push(c)
  }

  const sections = []
  for (const [truckId, truckChanges] of byTruck) {
    const truck = trucksById[truckId]
    if (!truck) continue // truck vanished; skip rather than crash
    sections.push(buildTruckSection(truck, truckChanges))
  }

  // group sections by location
  const byLocation = new Map()
  for (const s of sections) {
    if (!byLocation.has(s.locationName)) byLocation.set(s.locationName, [])
    byLocation.get(s.locationName).push(s)
  }

  const locations = [...byLocation.keys()].sort()
  const totalChanges = changes.length

  return {
    totalChanges,
    truckCount: sections.length,
    locations: locations.map(location => {
      const trucks = byLocation.get(location).sort((a, b) => {
        const sev = (SEVERITY_ORDER[a.currentStatus] ?? 99) - (SEVERITY_ORDER[b.currentStatus] ?? 99)
        if (sev !== 0) return sev
        return String(a.unitNumber).localeCompare(String(b.unitNumber))
      })
      return { location, trucks }
    }),
  }
}
