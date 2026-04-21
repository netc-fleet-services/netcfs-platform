'use client'
import { C, cB, bSt, sS } from '../lib/config'
import { cityFrom, lz } from '../lib/geo'
import { dayFull } from '../lib/utils'
import type { StackPair } from '../lib/types'

interface StackData {
  results: StackPair[]
  skipped: number
}

interface Props {
  data: StackData | null
  radius: number
  onRadiusChange: (r: number) => void
  onClose: () => void
  onIgnore: (m: StackPair) => void
}

export function PossibleStackingModal({ data, radius, onRadiusChange, onClose, onIgnore }: Props) {
  if (!data) return null
  const { results, skipped } = data

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ ...cB, background: C.cd, maxWidth: 720, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 16 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.pu }}>🔗 Possible Stacking</div>
            <div style={{ fontSize: 10, color: C.dm }}>Drop → pickup matches within {radius}mi. Suggestions only — review before acting.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 10, color: C.dm }}>Radius:</label>
            <select value={radius} onChange={e => onRadiusChange(Number(e.target.value))} style={{ ...sS, fontSize: 11, padding: '3px 6px' }}>
              {[5, 10, 15, 20, 25, 30, 40, 50, 75, 100].map(v => <option key={v} value={v}>{v} mi</option>)}
            </select>
            <button style={bSt} onClick={onClose}>Close</button>
          </div>
        </div>

        {results.length === 0 && (
          <div style={{ fontSize: 12, color: C.dm, padding: 20, textAlign: 'center' }}>No stacking opportunities found for this day.</div>
        )}

        {results.map((m, i) => (
          <div key={i} style={{ border: '1px solid ' + C.bd, borderRadius: 6, padding: 10, marginBottom: 6, background: C.sf }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: C.am, minWidth: 50 }}>{Math.round(m.dist)}mi</span>
              <span style={{ fontSize: 11, color: C.dm, flex: 1 }}>near <strong style={{ color: C.tx }}>{m.city}</strong></span>
              <button style={{ ...bSt, fontSize: 10, padding: '2px 8px', color: C.dm, borderColor: C.bd }} onClick={() => onIgnore(m)} title="Hide this suggestion">Ignore</button>
            </div>
            <div style={{ fontSize: 11, color: C.tx, marginLeft: 60, marginBottom: 3 }}>
              <span style={{ color: C.pu, fontWeight: 800 }}>{m.a.tbCallNum || '?'}</span>
              {m.a.tbTruck && <span style={{ color: C.am, fontWeight: 700, fontSize: 9, background: C.ab, padding: '1px 6px', borderRadius: 8, marginLeft: 5 }}>{m.a.tbTruck}</span>}
              <span style={{ color: C.ac, marginLeft: 5 }}>{dayFull(m.a.day)}{m.a.tbScheduled ? ' · ' + m.a.tbScheduled : ''}</span>
              <span style={{ color: C.dm }}> — drops in </span>
              <span>{cityFrom(m.a.dropAddr) || lz(m.a.dropZip)?.label || '?'}</span>
              <span style={{ color: C.dm }}> — {m.aDriver ? m.aDriver.name : <em>unassigned</em>}</span>
            </div>
            <div style={{ fontSize: 11, color: C.tx, marginLeft: 60 }}>
              <span style={{ color: C.pu, fontWeight: 800 }}>{m.b.tbCallNum || '?'}</span>
              {m.b.tbTruck && <span style={{ color: C.am, fontWeight: 700, fontSize: 9, background: C.ab, padding: '1px 6px', borderRadius: 8, marginLeft: 5 }}>{m.b.tbTruck}</span>}
              <span style={{ color: C.ac, marginLeft: 5 }}>{dayFull(m.b.day)}{m.b.tbScheduled ? ' · ' + m.b.tbScheduled : ''}</span>
              <span style={{ color: C.dm }}> — picks up in </span>
              <span>{m.city}</span>
              <span style={{ color: C.dm }}> — {m.bDriver ? m.bDriver.name : <em>unassigned</em>}</span>
            </div>
          </div>
        ))}

        {skipped > 0 && (
          <div style={{ fontSize: 10, color: C.dm, textAlign: 'center', marginTop: 8 }}>
            {skipped} job{skipped === 1 ? '' : 's'} skipped (drop address not geocoded yet)
          </div>
        )}
      </div>
    </div>
  )
}
