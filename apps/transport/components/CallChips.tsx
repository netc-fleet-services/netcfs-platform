'use client'

import { useState } from 'react'
import { C, fmtCall } from '../lib/config'
import { cityFrom } from '../lib/geo'
import { schedLabel } from '../lib/utils'
import type { Job } from '../lib/types'

// A driver's additional calls, shown as compact time+call# chips after the
// headline (earliest) call. Clicking a chip expands that call's detail —
// route and type stay hidden until asked for, so the row stays TV-scannable.
// `jobs` is expected pre-sorted chronologically by the availability engine.
export function CallChips({ jobs, label = 'then:' }: { jobs: Job[]; label?: string }) {
  const [openId, setOpenId] = useState<string | null>(null)
  if (!jobs.length) return null
  const open = openId ? jobs.find(j => j.id === openId) ?? null : null

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: C.dm, fontWeight: 700 }}>{label}</span>
        {jobs.map(j => {
          const active = openId === j.id
          const time = schedLabel(j)
          return (
            <button key={j.id} onClick={() => setOpenId(active ? null : j.id)}
              title="Show call details"
              style={{
                background: active ? C.cb : C.sf,
                border: '1px solid ' + (active ? C.cy : C.bd),
                borderRadius: 6, color: active ? C.cy : C.tx,
                fontSize: 11, fontWeight: 800, padding: '2px 8px',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
              {time ? `${time} · ` : ''}{fmtCall(j.tbCallNum)}
            </button>
          )
        })}
      </div>

      {open && (
        <div style={{ marginTop: 5, paddingLeft: 2, fontSize: 12, color: C.tx }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 900 }}>{fmtCall(open.tbCallNum)}</span>
            {open.jobType && <span style={{ color: C.dm }}>{open.jobType}</span>}
            {open.tbScheduled && <span style={{ color: C.dm }}>{open.tbScheduled}</span>}
          </div>
          <div style={{ marginTop: 2, color: C.dm }}>
            {cityFrom(open.pickupAddr) || '—'} → {cityFrom(open.dropAddr) || '—'}
          </div>
        </div>
      )}
    </div>
  )
}
