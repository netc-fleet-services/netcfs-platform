'use client'

import { C, fmtCall } from '../lib/config'
import type { DriverBoardStatus } from '../lib/availability'
import { cityFrom } from '../lib/geo'
import { fT } from '../lib/utils'
import { CallChips } from './CallChips'

const STATE_COLOR: Record<string, { fg: string; bg: string }> = {
  AVAILABLE: { fg: C.gn, bg: C.gb },
  ON_CALL:   { fg: C.rd, bg: '#2d0b0b' },
  CLAIMED:   { fg: C.cy, bg: C.cb },
}

function countdown(freeAt: Date, now: Date): string {
  const min = Math.round((freeAt.getTime() - now.getTime()) / 60_000)
  if (min <= 0) return 'due back'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

function ageMin(since: Date, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000))
}

export function DriverCard({ status: s, now, onRelease, onClaim, draggable, onDragStart }: {
  status: DriverBoardStatus
  now: Date
  onRelease?: () => void
  onClaim?: () => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
}) {
  const col = STATE_COLOR[s.state] ?? { fg: C.dm, bg: C.sf }
  const busy = s.state === 'ON_CALL' || s.state === 'CLAIMED'
  const overdue = s.state === 'ON_CALL' && s.overdue
  const claimAge = s.claimedAt ? ageMin(s.claimedAt, now) : null
  const claimStale = claimAge != null && claimAge >= 30

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      style={{
        background: C.cd,
        border: `1px solid ${overdue ? C.rd : C.bd}`,
        borderLeft: `6px solid ${overdue ? C.rd : col.fg}`,
        borderRadius: 10,
        padding: '12px 14px',
        cursor: draggable ? 'grab' : undefined,
        animation: overdue ? 'board-pulse 1.6s ease-in-out infinite' : undefined,
      }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        {/* Full name — wraps instead of truncating */}
        <span style={{ fontSize: 21, fontWeight: 900, letterSpacing: -0.3, lineHeight: 1.12 }}>
          {s.driver.name}
        </span>
        {s.driver.truck && <span style={{ fontSize: 13, color: C.dm, fontWeight: 700, whiteSpace: 'nowrap' }}>#{s.driver.truck}</span>}
        {onRelease && (
          <button onClick={onRelease} title="Release this driver"
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid ' + C.bd, borderRadius: 6, color: C.dm, fontSize: 11, padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            ✕ release
          </button>
        )}
      </div>

      {s.state === 'AVAILABLE' && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: C.gn, fontWeight: 700 }}>
            READY
            {s.shiftEnd && <span style={{ color: C.dm, fontWeight: 600 }}> · shift until {s.shiftEnd}</span>}
          </span>
          {onClaim && (
            <button onClick={onClaim} title="Claim this driver for an incoming call"
              style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid ' + C.cy, borderRadius: 6, color: C.cy, fontSize: 11, fontWeight: 800, padding: '2px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              claim →
            </button>
          )}
        </div>
      )}

      {busy && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: claimStale && s.state === 'CLAIMED' ? C.am : col.fg }}>
              {s.state === 'CLAIMED'
                ? (s.job ? 'PENDING IN TOWBOOK' : 'CLAIMED — ENTER CALL IN TOWBOOK')
                : (s.actionStatus || 'ON CALL').toUpperCase()}
            </span>
            {s.job?.tbCallNum && <span style={{ fontSize: 12, color: C.dm, fontWeight: 700 }}>{fmtCall(s.job.tbCallNum)}</span>}
            {s.job?.jobType && <span style={{ fontSize: 11, color: C.dm, border: '1px solid ' + C.bd, borderRadius: 4, padding: '1px 6px' }}>{s.job.jobType}</span>}
          </div>

          {s.claimNote && (
            <div style={{ marginTop: 4, fontSize: 13, color: C.cy, fontWeight: 700 }}>
              “{s.claimNote}”
            </div>
          )}

          {s.job && (
            <div style={{ marginTop: 4, fontSize: 14, color: C.tx, fontWeight: 600 }}>
              {cityFrom(s.job.pickupAddr) || '—'} → {cityFrom(s.job.dropAddr) || '—'}
            </div>
          )}

          <div style={{ marginTop: 6, display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
            {s.claimedAt && (
              <span style={{ fontSize: 12, fontWeight: 700, color: claimStale ? C.am : C.dm }}>
                claimed {claimAge}m ago
              </span>
            )}
            {s.activeSince && (
              <span style={{ fontSize: 12, color: C.dm }}>since {fT(s.activeSince)}</span>
            )}
            {s.estHours != null && (
              <span style={{ fontSize: 12, color: C.dm }}>est {s.estHours.toFixed(1)}h</span>
            )}
            {s.state === 'ON_CALL' && (s.freeAt ? (
              <span style={{ fontSize: 16, fontWeight: 900, color: overdue ? C.rd : C.tx, fontVariantNumeric: 'tabular-nums' }}>
                {overdue ? `DUE BACK — est ${fT(s.freeAt)}` : `free ~${fT(s.freeAt)} (${countdown(s.freeAt, now)})`}
              </span>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 700, color: C.dm }}>no ETA</span>
            ))}
          </div>

          <CallChips jobs={s.extraJobs} />
        </div>
      )}
    </div>
  )
}
