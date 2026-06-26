// TEST B — proves the digest logic in isolation. Run with:  node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideFlush, isStatusNoop, isWaitingOnNoop, matchRecipients,
  escapeHtml, buildRecipientDigest, QUIET_MS, CAP_MS,
} from './notification-digest.spec.mjs'

const MIN = 60 * 1000

// ─── 1. The 5-minute reset timer ────────────────────────────────────────────
test('does nothing when the waiting list is empty', () => {
  assert.deepEqual(decideFlush([], 0), { flush: false, reason: 'empty' })
})

test('waits while changes are still recent (under 5 min quiet)', () => {
  const now = 100 * MIN
  // last change was 3 minutes ago → still waiting
  const r = decideFlush([now - 3 * MIN], now)
  assert.deepEqual(r, { flush: false, reason: 'waiting' })
})

test('fires after a full 5 quiet minutes', () => {
  const now = 100 * MIN
  const r = decideFlush([now - QUIET_MS], now)
  assert.deepEqual(r, { flush: true, reason: 'quiet' })
})

test('a new change RESETS the clock (does not fire on the old one)', () => {
  const now = 100 * MIN
  // an old change from 10 min ago, but a fresh one 1 min ago → newest wins, keep waiting
  const r = decideFlush([now - 10 * MIN, now - 1 * MIN], now)
  assert.deepEqual(r, { flush: false, reason: 'waiting' })
})

test('30-minute safety cap fires even if changes keep trickling in', () => {
  const now = 100 * MIN
  // newest change is only 1 min old (would normally wait), but the oldest is 30 min old
  const r = decideFlush([now - CAP_MS, now - 1 * MIN], now)
  assert.deepEqual(r, { flush: true, reason: 'cap' })
})

// ─── 2. No-op suppression ───────────────────────────────────────────────────
test('status no-op: same status is a no-op', () => {
  assert.equal(isStatusNoop('oos', 'oos'), true)
  assert.equal(isStatusNoop('oos', 'ready'), false)
})

test('waiting-on no-op: unchanged text (incl. whitespace) is a no-op', () => {
  assert.equal(isWaitingOnNoop('parts', 'parts'), true)
  assert.equal(isWaitingOnNoop('parts ', ' parts'), true)   // trimmed compare
  assert.equal(isWaitingOnNoop(null, ''), true)             // empty stays empty
  assert.equal(isWaitingOnNoop('parts', 'tires'), false)
})

// ─── 3. Recipient matching ──────────────────────────────────────────────────
const truckHD_PHX = { category: 'hd_tow', location_id: 'phx' }
test('recipient matching honors category + location wildcards', () => {
  const rules = [
    { category: null,     location_id: null,  emails: ['all@x.com'] },           // everything
    { category: 'hd_tow', location_id: null,  emails: ['hd@x.com'] },            // all HD tow
    { category: null,     location_id: 'phx', emails: ['phx@x.com'] },           // all Phoenix
    { category: 'ld_tow', location_id: 'phx', emails: ['nope@x.com'] },          // wrong category
    { category: 'hd_tow', location_id: 'tuc', emails: ['nope2@x.com'] },         // wrong location
  ]
  assert.deepEqual(matchRecipients(rules, truckHD_PHX), ['all@x.com', 'hd@x.com', 'phx@x.com'])
})

test('recipient matching de-dupes overlapping rules', () => {
  const rules = [
    { category: null,     location_id: null,  emails: ['dup@x.com'] },
    { category: 'hd_tow', location_id: 'phx', emails: ['dup@x.com'] },
  ]
  assert.deepEqual(matchRecipients(rules, truckHD_PHX), ['dup@x.com'])
})

// ─── 4. HTML escaping (one bad note can't break everyone's email) ───────────
test('escapes HTML-breaking characters', () => {
  assert.equal(escapeHtml('<b>"x" & y</b>'), '&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;')
})

// ─── 5 & 6. Grouping, ordering, and trail-collapsing ────────────────────────
const trucksById = {
  t1: { id: 't1', unit_number: '4821', category: 'hd_tow',    location_id: 'phx', locationName: 'Phoenix Shop', current_status: 'oos' },
  t2: { id: 't2', unit_number: '3310', category: 'roadside',  location_id: 'phx', locationName: 'Phoenix Shop', current_status: 'issues' },
  t3: { id: 't3', unit_number: '2087', category: 'ld_tow',    location_id: 'tuc', locationName: 'Tucson Shop',  current_status: 'ready' },
  t4: { id: 't4', unit_number: '5102', category: 'transport', location_id: 'phx', locationName: 'Phoenix Shop', current_status: 'oos' },
}

test('collapses multiple status changes on one truck into a single trail', () => {
  const changes = [
    { truckId: 't1', type: 'status', oldStatus: 'ready',  newStatus: 'issues', createdAt: 1, changedBy: 'jdoe' },
    { truckId: 't1', type: 'status', oldStatus: 'issues', newStatus: 'oos',    createdAt: 2, changedBy: 'jdoe' },
  ]
  const d = buildRecipientDigest(changes, trucksById)
  const truck = d.locations[0].trucks[0]
  assert.deepEqual(truck.statusTrail, ['ready', 'issues', 'oos'])
  assert.equal(truck.changeCount, 2)
  assert.deepEqual(truck.statusTrailLabels, ['Ready for Use', 'Known Issues', 'Out of Service'])
})

test('groups by location (alphabetical), then severity OOS→Issues→Ready, then unit', () => {
  const changes = [
    { truckId: 't3', type: 'status', oldStatus: 'oos',    newStatus: 'ready',  createdAt: 1, changedBy: 'a' }, // Tucson, ready
    { truckId: 't2', type: 'waiting_on', value: 'tires',                       createdAt: 2, changedBy: 'b' }, // Phoenix, issues
    { truckId: 't1', type: 'status', oldStatus: 'ready',  newStatus: 'oos',    createdAt: 3, changedBy: 'c' }, // Phoenix, oos, unit 4821
    { truckId: 't4', type: 'mechanic_note', value: 'DEF fault',                createdAt: 4, changedBy: 'd' }, // Phoenix, oos, unit 5102
  ]
  const d = buildRecipientDigest(changes, trucksById)

  // locations alphabetical: Phoenix before Tucson
  assert.deepEqual(d.locations.map(l => l.location), ['Phoenix Shop', 'Tucson Shop'])

  // within Phoenix: both OOS trucks first (sorted by unit 4821, 5102), then the Issues truck
  const phoenixUnits = d.locations[0].trucks.map(t => `${t.unitNumber}:${t.currentStatus}`)
  assert.deepEqual(phoenixUnits, ['4821:oos', '5102:oos', '3310:issues'])

  // Tucson has the single ready truck
  assert.deepEqual(d.locations[1].trucks.map(t => t.unitNumber), ['2087'])

  assert.equal(d.totalChanges, 4)
  assert.equal(d.truckCount, 4)
})

test('a waiting-on change with no status change still shows the truck (no trail)', () => {
  const changes = [{ truckId: 't2', type: 'waiting_on', value: 'brake parts', createdAt: 1, changedBy: 'x' }]
  const d = buildRecipientDigest(changes, trucksById)
  const truck = d.locations[0].trucks[0]
  assert.deepEqual(truck.statusTrail, [])
  assert.equal(truck.waitingOn, 'brake parts')
})

test('skips a change whose truck is missing instead of crashing', () => {
  const changes = [{ truckId: 'ghost', type: 'status', oldStatus: 'oos', newStatus: 'ready', createdAt: 1 }]
  const d = buildRecipientDigest(changes, trucksById)
  assert.equal(d.truckCount, 0)
  assert.deepEqual(d.locations, [])
})
