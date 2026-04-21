'use client'
import { C, cB, bSt } from '../lib/config'
import { cityFrom, lz } from '../lib/geo'
import type { StackPair } from '../lib/types'

interface Props {
  queue: StackPair[]
  onDismiss: () => void
  onIgnore: () => void
}

export function NewStackModal({ queue, onDismiss, onIgnore }: Props) {
  if (!queue.length) return null
  const m = queue[0]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 950, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ ...cB, width: '100%', maxWidth: 460, padding: 18, background: C.cd, borderColor: C.am }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.am }}>🔗 New Stacking Opportunity</div>
            <div style={{ fontSize: 10, color: C.dm, marginTop: 2 }}>Detected on the most recent sync · {queue.length} remaining</div>
          </div>
        </div>

        <div style={{ border: '1px solid ' + C.bd, borderRadius: 6, padding: 10, background: C.sf, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.am, marginBottom: 6 }}>{Math.round(m.dist)} mi apart</div>
          <div style={{ fontSize: 11, color: C.tx, marginBottom: 4 }}>
            <span style={{ color: C.pu, fontWeight: 800 }}>{m.a.tbCallNum || '?'}</span>
            <span style={{ color: C.dm }}> drops in </span>
            <strong>{cityFrom(m.a.dropAddr) || lz(m.a.dropZip)?.label || '?'}</strong>
            {m.aDriver && <span style={{ color: C.dm }}> · {m.aDriver.name}</span>}
          </div>
          <div style={{ fontSize: 11, color: C.tx }}>
            <span style={{ color: C.pu, fontWeight: 800 }}>{m.b.tbCallNum || '?'}</span>
            <span style={{ color: C.dm }}> picks up in </span>
            <strong>{m.city}</strong>
            {m.bDriver && <span style={{ color: C.dm }}> · {m.bDriver.name}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...bSt, flex: 1, fontSize: 11 }} onClick={onDismiss}>Dismiss</button>
          <button style={{ ...bSt, flex: 1, fontSize: 11, color: C.dm, borderColor: C.bd }} onClick={onIgnore}>Ignore permanently</button>
        </div>
      </div>
    </div>
  )
}
