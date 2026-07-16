'use client'

import { C } from '../lib/config'
import type { DriverBoardStatus } from '../lib/availability'
import { cityFrom } from '../lib/geo'
import { fT } from '../lib/utils'

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

export function DriverCard({ status: s, now, onRelease }: {
  status: DriverBoardStatus
  now: Date
  onRelease?: () => void
}) {
  const col = STATE_COLOR[s.state] ?? { fg: C.dm, bg: C.sf }
  const busy = s.state === 'ON_CALL' || s.state === 'CLAIMED'
  const overdue = s.state === 'ON_CALL' && s.overdue

  return (
    <div style={{
      background: C.cd,
      border: `1px solid ${overdue ? C.rd : C.bd}`,
      borderLeft: `6px solid ${overdue ? C.rd : col.fg}`,
      borderRadius: 10,
      padding: '12px 14px',
      animation: overdue ? 'board-pulse 1.6s ease-in-out infinite' : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {s.driver.name}
        </span>
        {s.driver.truck && <span style={{ fontSize: 13, color: C.dm, fontWeight: 700 }}>#{s.driver.truck}</span>}
        {onRelease && (
          <button onClick={onRelease} title="Release this driver (clear the board assignment)"
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid ' + C.bd, borderRadius: 6, color: C.dm, fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}>
            ✕ release
          </button>
        )}
      </div>

      {s.state === 'AVAILABLE' && (
        <div style={{ marginTop: 6, fontSize: 13, color: C.gn, fontWeight: 700 }}>
          READY
          {s.shiftEnd && <span style={{ color: C.dm, fontWeight: 600 }}> · shift until {s.shiftEnd}</span>}
        </div>
      )}

      {busy && s.job && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: col.fg }}>
              {s.state === 'CLAIMED' ? 'PENDING IN TOWBOOK' : (s.actionStatus || 'ON CALL').toUpperCase()}
            </span>
            {s.job.tbCallNum && <span style={{ fontSize: 12, color: C.dm, fontWeight: 700 }}>#{s.job.tbCallNum}</span>}
            {s.job.jobType && <span style={{ fontSize: 11, color: C.dm, border: '1px solid ' + C.bd, borderRadius: 4, padding: '1px 6px' }}>{s.job.jobType}</span>}
          </div>

          <div style={{ marginTop: 4, fontSize: 14, color: C.tx, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cityFrom(s.job.pickupAddr) || '—'} → {cityFrom(s.job.dropAddr) || '—'}
          </div>

          <div style={{ marginTop: 6, display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
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

          {s.extraJobs.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 11, color: C.dm }}>+{s.extraJobs.length} more call{s.extraJobs.length === 1 ? '' : 's'}</div>
          )}
        </div>
      )}
    </div>
  )
}
