'use client'
import { useEffect, useState } from 'react'
import { C, cB, bP, sS } from '../lib/config'
import type { Driver, DriverMatchItem } from '../lib/types'

interface Props {
  item: DriverMatchItem
  drivers: Driver[]
  onAssign: (driver: Driver, callNums: string[]) => void
  onCreateNew: (tbName: string, callNums: string[]) => void
}

export function DriverMatchModal({ item, drivers, onAssign, onCreateNew }: Props) {
  const [selected, setSelected] = useState(item.suggested ? String(item.suggested.id) : '__new__')

  useEffect(() => {
    setSelected(item.suggested ? String(item.suggested.id) : '__new__')
  }, [item.tbName])

  const handleConfirm = () => {
    if (selected === '__new__') {
      onCreateNew(item.tbName, item.callNums)
    } else {
      const driver = drivers.find(d => String(d.id) === selected)
      if (driver) onAssign(driver, item.callNums)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...cB, width: 380, padding: 20, background: C.ca, borderColor: C.am }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.am, marginBottom: 4 }}>Unmatched TowBook Driver</div>
        <div style={{ fontSize: 11, color: C.dm, marginBottom: 14 }}>
          No driver in the roster exactly matches the name from TowBook. Choose an existing driver or create a new record.
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: C.dm, fontWeight: 600, marginBottom: 2 }}>TOWBOOK NAME</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.tx }}>{item.tbName}</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: C.dm, fontWeight: 600, marginBottom: 2 }}>AFFECTED CALL{item.callNums.length > 1 ? 'S' : ''}</div>
          <div style={{ fontSize: 11, color: C.pu, fontWeight: 700 }}>{item.callNums.join(', ')}</div>
        </div>

        {item.suggested && (
          <div style={{ marginBottom: 10, padding: '6px 10px', background: C.ab, borderRadius: 6, border: '1px solid ' + C.am }}>
            <span style={{ fontSize: 9, color: C.am, fontWeight: 600 }}>CLOSEST MATCH: </span>
            <span style={{ fontSize: 11, color: C.tx }}>{item.suggested.name}</span>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, color: C.dm, fontWeight: 600, marginBottom: 4 }}>ASSIGN TO</div>
          <select style={{ ...sS, width: '100%', fontSize: 11, padding: '5px 8px' }}
            value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="__new__">+ Create new driver &quot;{item.tbName}&quot;</option>
            {drivers.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
          </select>
        </div>

        <button style={{ ...bP, width: '100%', fontSize: 12 }} onClick={handleConfirm}>Confirm</button>
      </div>
    </div>
  )
}
