'use client'

import { C } from '../lib/config'
import type { DriverBoardStatus } from '../lib/availability'

const OFF_LABEL: Record<string, string> = {
  PTO: 'PTO',
  sick: 'Sick',
  unavailable: 'Unavailable',
  other: 'Off',
}

function chipText(s: DriverBoardStatus): string {
  if (s.state === 'OFF') return OFF_LABEL[s.offReason ?? 'other'] ?? 'Off'
  if (s.state === 'OUT_OF_SHIFT') {
    return s.shiftPhase === 'before'
      ? `starts ${s.shiftStart ?? '—'}`
      : `shift ended ${s.shiftEnd ?? ''}`.trim()
  }
  return 'not scheduled'
}

export function OffStrip({ statuses }: { statuses: DriverBoardStatus[] }) {
  if (!statuses.length) return null
  const sorted = [...statuses].sort((a, b) => a.driver.name.localeCompare(b.driver.name))
  return (
    <div style={{ marginTop: 22, borderTop: '1px solid ' + C.bd, paddingTop: 10, opacity: 0.75 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: C.dm, marginBottom: 8 }}>
        OFF / NOT SCHEDULED
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {sorted.map(s => (
          <span key={s.driver.id} style={{
            background: C.sf, border: '1px solid ' + C.bd, borderRadius: 6,
            padding: '4px 10px', fontSize: 12, color: C.dm,
          }}>
            <span style={{ color: C.tx, fontWeight: 700 }}>{s.driver.name}</span>
            {' — '}{chipText(s)}
          </span>
        ))}
      </div>
    </div>
  )
}
