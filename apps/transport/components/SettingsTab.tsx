'use client'
import { useState } from 'react'
import { C, cB, bP, bSt, iS, sS, YARDS } from '../lib/config'
import type { Driver, Yard } from '../lib/types'

interface NewYard { short: string; addr: string; zip: string }
interface NewDriver { name: string; truck: string; yard: string; func: string }

interface Props {
  yards: Yard[]
  onAddYard: (y: Yard) => void
  onUpdateYard: (id: string, fields: Partial<Yard>) => void
  onDeleteYard: (id: string) => void
  newYard: NewYard
  setNewYard: (y: NewYard) => void
  drivers: Driver[]
  onAddDriver: (d: Driver) => void
  onUpdateDriver: (id: number, fields: Partial<Driver>) => void
  onDeleteDriver: (id: number) => void
  hpd: number
  onSetHpd: (n: number) => void
  newDr: NewDriver
  setNewDr: (d: NewDriver) => void
  driverFunctions: string[]
  ghRepo: string
  ghToken: string
  onSaveGH: (key: string, val: string) => void
}

export function SettingsTab({
  yards, onAddYard, onUpdateYard, onDeleteYard, newYard, setNewYard,
  drivers, onAddDriver, onUpdateDriver, onDeleteDriver, hpd, onSetHpd, newDr, setNewDr,
  driverFunctions, ghRepo, ghToken, onSaveGH,
}: Props) {
  const [tokenInput, setTokenInput] = useState('')
  const [tokenSaved, setTokenSaved] = useState(false)

  const toYardId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20)

  const addYd = () => {
    if (!newYard.short.trim() || !newYard.addr.trim() || !newYard.zip.trim()) return
    const id = toYardId(newYard.short)
    if (yards.find(y => y.id === id)) { alert(`A yard with id "${id}" already exists.`); return }
    onAddYard({ id, short: newYard.short.trim(), addr: newYard.addr.trim(), zip: newYard.zip.trim() })
    setNewYard({ short: '', addr: '', zip: '' })
  }

  const addDr = () => {
    if (!newDr.name.trim()) return
    onAddDriver({ id: Date.now(), name: newDr.name.trim(), truck: newDr.truck.trim(), yard: newDr.yard, func: newDr.func })
    setNewDr({ name: '', truck: '', yard: YARDS[0]?.id || 'exeter', func: 'Transport' })
  }

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Settings</div>

      <div style={{ ...cB, padding: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.pu, marginBottom: 4 }}>TowBook Sync</div>
        <div style={{ fontSize: 10, color: C.dm, marginBottom: 8 }}>
          The &ldquo;🔄 Sync TowBook&rdquo; button on the Schedule tab triggers the GitHub Actions sync workflow on demand.
          Enter your repo and a Personal Access Token (with <strong style={{ color: C.tx }}>Actions: write</strong> permission) below.
          These are saved to Supabase and shared across all users.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <div style={{ fontSize: 9, color: C.dm, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 1 }}>GitHub Repo (owner/repo)</div>
            <input style={iS} placeholder="e.g. netc-fleet-services/netcfs-platform" defaultValue={ghRepo}
              onBlur={e => onSaveGH('github_repo', e.target.value.trim())} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.dm, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 1 }}>
              Personal Access Token
              {ghToken && !tokenSaved && <span style={{ color: C.gn, marginLeft: 6 }}>✓ saved</span>}
              {tokenSaved           && <span style={{ color: C.gn, marginLeft: 6 }}>✓ updated</span>}
            </div>
            <input style={iS} type="password"
              placeholder={ghToken ? 'Token saved — paste new token to replace' : 'ghp_…'}
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              onBlur={() => {
                const val = tokenInput.trim()
                if (!val) return
                onSaveGH('github_token', val)
                setTokenInput('')
                setTokenSaved(true)
                setTimeout(() => setTokenSaved(false), 3000)
              }} />
          </div>
        </div>
      </div>

      <div style={{ ...cB, padding: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Yard Locations</div>
        <div style={{ fontSize: 10, color: C.dm, marginBottom: 8 }}>
          Changes apply immediately for all users. Jobs reference yards by ID — don&apos;t delete a yard that has jobs assigned to it.
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          <input style={{ ...iS, flex: 1 }} placeholder="Name (e.g. Portsmouth)" value={newYard.short}
            onChange={e => setNewYard({ ...newYard, short: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') addYd() }} />
          <input style={{ ...iS, flex: 2 }} placeholder="Full address" value={newYard.addr}
            onChange={e => setNewYard({ ...newYard, addr: e.target.value })} />
          <input style={{ ...iS, width: 60 }} placeholder="ZIP" maxLength={5} value={newYard.zip}
            onChange={e => setNewYard({ ...newYard, zip: e.target.value.replace(/\D/g, '') })} />
          <button style={{ ...bP, padding: '5px 10px' }} onClick={addYd}>+</button>
        </div>
        {yards.map(y => (
          <div key={y.id} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 6px', marginBottom: 3, background: C.sf, borderRadius: 6, border: '1px solid ' + C.bd }}>
            <span style={{ fontSize: 9, color: C.dm, minWidth: 70, fontFamily: 'monospace' }}>{y.id}</span>
            <input style={{ ...iS, width: 90, padding: '2px 5px', fontSize: 11, fontWeight: 600, background: 'transparent', border: 'none' }}
              value={y.short} onChange={e => onUpdateYard(y.id, { short: e.target.value })} />
            <input style={{ ...iS, flex: 1, padding: '2px 5px', fontSize: 10, background: 'transparent', border: 'none' }}
              value={y.addr} onChange={e => onUpdateYard(y.id, { addr: e.target.value })} />
            <input style={{ ...iS, width: 55, padding: '2px 4px', fontSize: 10, background: 'transparent', border: '1px solid ' + C.bd }}
              value={y.zip} onChange={e => onUpdateYard(y.id, { zip: e.target.value.replace(/\D/g, '') })} maxLength={5} />
            <button style={{ ...bSt, padding: '1px 3px', color: C.rd }}
              onClick={() => { if (confirm(`Delete yard "${y.short}"? Jobs assigned to it will lose their yard.`)) onDeleteYard(y.id) }}>✕</button>
          </div>
        ))}
      </div>

      <div style={{ ...cB, padding: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Working Hours</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: C.dm }}>Default hours per driver per day:</span>
          <select style={{ ...sS, width: 60, fontSize: 12 }} value={hpd} onChange={e => onSetHpd(parseInt(e.target.value))}>
            {[6, 7, 8, 9, 10, 11, 12, 13, 14].map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
      </div>

      <div style={{ ...cB, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Driver Roster</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
          <input style={{ ...iS, flex: 1, minWidth: 100 }} placeholder="Name" value={newDr.name}
            onChange={e => setNewDr({ ...newDr, name: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') addDr() }} />
          <input style={{ ...iS, width: 55 }} placeholder="Truck#" value={newDr.truck}
            onChange={e => setNewDr({ ...newDr, truck: e.target.value })} />
          <select style={{ ...sS, width: 110, fontSize: 11 }} value={newDr.yard}
            onChange={e => setNewDr({ ...newDr, yard: e.target.value })}>
            {yards.map(y => <option key={y.id} value={y.id}>{y.short}</option>)}
          </select>
          <select style={{ ...sS, width: 140, fontSize: 11 }} value={newDr.func}
            onChange={e => setNewDr({ ...newDr, func: e.target.value })}>
            {driverFunctions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <button style={{ ...bP, padding: '5px 10px' }} onClick={addDr}>+</button>
        </div>
        {yards.map(y => {
          const yd = drivers.filter(d => d.yard === y.id)
          if (!yd.length) return null
          return (
            <div key={y.id} style={{ marginBottom: 5 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.ac, marginBottom: 2 }}>{y.short} ({yd.length})</div>
              {yd.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 5px', marginBottom: 1, background: C.sf, borderRadius: 4, border: '1px solid ' + C.bd, flexWrap: 'wrap' }}>
                  <input style={{ ...iS, flex: 1, minWidth: 80, padding: '2px 5px', fontSize: 11, fontWeight: 600, background: 'transparent', border: 'none' }}
                    value={d.name} onChange={e => onUpdateDriver(d.id, { name: e.target.value })} />
                  <input style={{ ...iS, width: 40, padding: '2px 4px', fontSize: 10, background: 'transparent', border: '1px solid ' + C.bd }}
                    value={d.truck || ''} onChange={e => onUpdateDriver(d.id, { truck: e.target.value })} />
                  <select style={{ ...sS, width: 90, padding: '2px 4px', fontSize: 10 }} value={d.yard}
                    onChange={e => onUpdateDriver(d.id, { yard: e.target.value })}>
                    {yards.map(v => <option key={v.id} value={v.id}>{v.short}</option>)}
                  </select>
                  <select style={{ ...sS, width: 140, padding: '2px 4px', fontSize: 10 }} value={d.func || ''}
                    onChange={e => onUpdateDriver(d.id, { func: e.target.value })}>
                    <option value="">— Function —</option>
                    {driverFunctions.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <button style={{ ...bSt, padding: '1px 3px', color: C.rd }} onClick={() => onDeleteDriver(d.id)}>✕</button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
