'use client'

import { useState } from 'react'
import { C, COMPANY_ORDER, DRIVER_FUNCTIONS, bP, bSt, cB, iS, sS } from '../lib/config'
import type { Driver, Yard } from '../lib/types'

export function SettingsPanel({
  drivers, aliases, yards, ghRepo, ghToken, syncStatus,
  onClose, onTriggerSync, onSaveGh, onSaveDriver, onAddDriver, onSetActive, onDeleteAlias, onSaveYard, onDeleteYard,
}: {
  drivers: Driver[]                       // full roster incl. hidden
  aliases: Record<string, number>
  yards: Yard[]
  ghRepo: string
  ghToken: string
  syncStatus: 'triggering' | 'ok' | 'error' | null
  onClose: () => void
  onTriggerSync: () => void
  onSaveGh: (repo: string, token: string) => void
  onSaveDriver: (d: Driver) => void
  onAddDriver: (d: Omit<Driver, 'id'>) => void
  onSetActive: (id: number, active: boolean) => void
  onDeleteAlias: (normName: string) => void
  onSaveYard: (y: Yard) => void
  onDeleteYard: (id: string) => void
}) {
  const [repo, setRepo] = useState(ghRepo)
  const [token, setToken] = useState(ghToken)
  const visible = [...drivers].filter(d => d.active).sort((a, b) => a.name.localeCompare(b.name))
  const hidden  = [...drivers].filter(d => !d.active).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 900, overflowY: 'auto', padding: '5vh 16px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ maxWidth: 760, margin: '0 auto', background: C.bg, border: '1px solid ' + C.bd, borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 900 }}>Board Settings</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.dm, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* ── TowBook sync ── */}
        <div style={{ ...cB, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>TowBook Sync</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...iS, width: 220 }} placeholder="github owner/repo" value={repo} onChange={e => setRepo(e.target.value)} />
            <input style={{ ...iS, width: 220 }} placeholder="github token" type="password" value={token} onChange={e => setToken(e.target.value)} />
            <button style={bP} onClick={() => onSaveGh(repo, token)}>Save</button>
            <button style={{ ...bP, background: C.gn }} onClick={onTriggerSync} disabled={syncStatus === 'triggering'}>
              {syncStatus === 'triggering' ? 'Triggering…' : '🔄 Sync TowBook now'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: C.dm, marginTop: 6 }}>
            The scraper also runs automatically every 5 minutes via GitHub Actions.
          </div>
        </div>

        {/* ── Roster ── */}
        <div style={{ ...cB, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Driver Roster</div>

          <AddDriverRow onAdd={onAddDriver} />

          <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 8 }}>
            {visible.map(d => (
              <RosterRow key={d.id} driver={d} onSave={onSaveDriver} onHide={() => onSetActive(d.id, false)} />
            ))}
          </div>

          {hidden.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid ' + C.bd, paddingTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: C.dm, marginBottom: 6 }}>
                HIDDEN ({hidden.length}) — never shown on the board or scheduler
              </div>
              {hidden.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12, opacity: 0.8 }}>
                  <span style={{ fontWeight: 700 }}>{d.name}</span>
                  {d.func && <span style={{ color: C.dm }}>{d.func}</span>}
                  <button style={{ ...bSt, marginLeft: 'auto', color: C.gn, borderColor: C.gn }} onClick={() => onSetActive(d.id, true)}>
                    restore
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 10, color: C.dm, marginTop: 8, lineHeight: 1.5 }}>
            Hiding a driver (they quit, seasonal, etc.) removes them from the board and the
            scheduler instantly but keeps all their history — restore any time. Drivers are
            never deleted: schedules and calls reference them.
          </div>
        </div>

        {/* ── Name aliases ── */}
        <div style={{ ...cB, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>TowBook Name Aliases</div>
          {Object.keys(aliases).length === 0 && <div style={{ fontSize: 11, color: C.dm }}>None yet — created automatically when you resolve an unmatched TowBook name.</div>}
          {Object.entries(aliases).map(([name, id]) => {
            const d = drivers.find(x => x.id === id)
            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                <span style={{ fontWeight: 700 }}>&ldquo;{name}&rdquo;</span>
                <span style={{ color: C.dm }}>→ {d?.name ?? `driver #${id}`}</span>
                <button style={{ ...bSt, marginLeft: 'auto' }} onClick={() => onDeleteAlias(name)}>remove</button>
              </div>
            )
          })}
        </div>

        {/* ── Yards ── */}
        <div style={{ ...cB, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Yards (round-trip origins for job time math)</div>
          {yards.map(y => <YardRow key={y.id} yard={y} onSave={onSaveYard} onDelete={onDeleteYard} />)}
          <AddYard onSave={onSaveYard} />
        </div>
      </div>
    </div>
  )
}

function CompanySelect({ value, onChange, width = 110 }: { value: string; onChange: (v: string) => void; width?: number }) {
  return (
    <select style={{ ...sS, width }} value={value} onChange={e => onChange(e.target.value)}>
      {COMPANY_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
      {value && !COMPANY_ORDER.includes(value) && <option value={value}>{value}</option>}
    </select>
  )
}

function RosterRow({ driver, onSave, onHide }: { driver: Driver; onSave: (d: Driver) => void; onHide: () => void }) {
  const [d, setD] = useState(driver)
  const dirty = d.name !== driver.name || d.truck !== driver.truck || d.func !== driver.func
    || d.yard !== driver.yard || d.company !== driver.company
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 0' }}>
      <input style={{ ...iS, width: 160 }} value={d.name} onChange={e => setD({ ...d, name: e.target.value })} />
      <input style={{ ...iS, width: 60 }} placeholder="truck" value={d.truck} onChange={e => setD({ ...d, truck: e.target.value })} />
      <select style={{ ...sS, width: 140 }} value={d.func} onChange={e => setD({ ...d, func: e.target.value })}>
        <option value="">— function —</option>
        {DRIVER_FUNCTIONS.map(f => <option key={f} value={f}>{f}</option>)}
        {d.func && !DRIVER_FUNCTIONS.includes(d.func) && <option value={d.func}>{d.func}</option>}
      </select>
      <CompanySelect value={d.company ?? 'NETC'} onChange={v => setD({ ...d, company: v })} />
      <input style={{ ...iS, width: 90 }} placeholder="yard" value={d.yard} onChange={e => setD({ ...d, yard: e.target.value })} />
      {dirty && <button style={bP} onClick={() => onSave(d)}>Save</button>}
      <button style={bSt} title="Hide this driver (quit / no longer drives) — restorable below" onClick={onHide}>hide</button>
    </div>
  )
}

function AddDriverRow({ onAdd }: { onAdd: (d: Omit<Driver, 'id'>) => void }) {
  const [name, setName] = useState('')
  const [truck, setTruck] = useState('')
  const [func, setFunc] = useState('')
  const [company, setCompany] = useState('NETC')
  const [yard, setYard] = useState('')
  const canAdd = !!name.trim()
  const submit = () => {
    if (!canAdd) return
    onAdd({ name: name.trim(), truck: truck.trim(), yard: yard.trim(), func, company, active: true })
    setName(''); setTruck(''); setFunc(''); setYard('')
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 8px', background: C.ca, border: '1px dashed ' + C.bd, borderRadius: 8 }}>
      <input style={{ ...iS, width: 160 }} placeholder="new driver name" value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit() }} />
      <input style={{ ...iS, width: 60 }} placeholder="truck" value={truck} onChange={e => setTruck(e.target.value)} />
      <select style={{ ...sS, width: 140 }} value={func} onChange={e => setFunc(e.target.value)}>
        <option value="">— function —</option>
        {DRIVER_FUNCTIONS.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
      <CompanySelect value={company} onChange={setCompany} />
      <input style={{ ...iS, width: 90 }} placeholder="yard" value={yard} onChange={e => setYard(e.target.value)} />
      <button style={{ ...bP, opacity: canAdd ? 1 : 0.5, cursor: canAdd ? 'pointer' : 'default' }} disabled={!canAdd} onClick={submit}>
        + Add
      </button>
    </div>
  )
}

function YardRow({ yard, onSave, onDelete }: { yard: Yard; onSave: (y: Yard) => void; onDelete: (id: string) => void }) {
  const [y, setY] = useState(yard)
  const dirty = y.short !== yard.short || y.addr !== yard.addr || y.zip !== yard.zip
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 0' }}>
      <input style={{ ...iS, width: 120 }} value={y.short} onChange={e => setY({ ...y, short: e.target.value })} />
      <input style={{ ...iS, flex: 1 }} value={y.addr} onChange={e => setY({ ...y, addr: e.target.value })} />
      <input style={{ ...iS, width: 70 }} value={y.zip} onChange={e => setY({ ...y, zip: e.target.value })} />
      {dirty && <button style={bP} onClick={() => onSave(y)}>Save</button>}
      <button style={bSt} onClick={() => onDelete(y.id)}>remove</button>
    </div>
  )
}

function AddYard({ onSave }: { onSave: (y: Yard) => void }) {
  const [y, setY] = useState<Yard>({ id: '', short: '', addr: '', zip: '' })
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 8, borderTop: '1px solid ' + C.bd, marginTop: 8 }}>
      <input style={{ ...iS, width: 120 }} placeholder="name" value={y.short} onChange={e => setY({ ...y, short: e.target.value })} />
      <input style={{ ...iS, flex: 1 }} placeholder="address" value={y.addr} onChange={e => setY({ ...y, addr: e.target.value })} />
      <input style={{ ...iS, width: 70 }} placeholder="zip" value={y.zip} onChange={e => setY({ ...y, zip: e.target.value })} />
      <button
        style={bP}
        disabled={!y.short || !y.addr}
        onClick={() => {
          if (!y.short || !y.addr) return
          onSave({ ...y, id: y.short.toLowerCase().replace(/[^a-z0-9]+/g, '') || String(Date.now()) })
          setY({ id: '', short: '', addr: '', zip: '' })
        }}>
        + Add
      </button>
    </div>
  )
}
