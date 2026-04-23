'use client'

import { useState } from 'react'
import { STATUS, STATUS_LABELS } from '@/lib/constants'
import { TruckRow } from './truck-row'
import type { Truck, FleetProfile } from '@/lib/types'

const STATUS_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  [STATUS.READY]:  { text: 'var(--status-ready)',  bg: 'var(--status-ready-bg)',  border: 'var(--status-ready-border)' },
  [STATUS.ISSUES]: { text: 'var(--status-issues)', bg: 'var(--status-issues-bg)', border: 'var(--status-issues-border)' },
  [STATUS.OOS]:    { text: 'var(--status-oos)',    bg: 'var(--status-oos-bg)',    border: 'var(--status-oos-border)' },
}

const STATUS_ICONS: Record<string, string> = {
  [STATUS.READY]: '✓', [STATUS.ISSUES]: '⚠', [STATUS.OOS]: '✕',
}

interface Props {
  status: string
  trucks: Truck[]
  totalCount: number
  profile: FleetProfile | null
  onStatusChange: (truck: Truck, newStatus: string, comment: string, waitingOn: string | null) => Promise<void>
  onViewHistory: (truck: Truck) => void
  onInspect: (truck: Truck) => void
  onViewInspections: (truck: Truck) => void
  onUpdateWaitingOn: (id: string, val: string) => Promise<void>
}

export function StatusTable({ status, trucks, totalCount, profile, onStatusChange, onViewHistory, onInspect, onViewInspections, onUpdateWaitingOn }: Props) {
  const [open, setOpen] = useState(true)
  const colors = STATUS_COLORS[status]

  return (
    <div style={{ border: '1px solid var(--outline-variant)', borderRadius: '0.75rem', overflow: 'hidden' }}>
      <button
        className="section-header"
        data-open={open}
        style={{
          width: '100%', border: 'none',
          borderRadius: open ? '0.75rem 0.75rem 0 0' : '0.75rem',
          borderBottom: open ? `1px solid ${colors.border}` : 'none',
        }}
        onClick={() => setOpen(v => !v)}
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '1.5rem', height: '1.5rem', borderRadius: '50%',
          background: colors.bg, border: `1px solid ${colors.border}`,
          color: colors.text, fontSize: '0.7rem', fontWeight: 800, flexShrink: 0,
        }}>
          {STATUS_ICONS[status]}
        </span>

        <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--on-surface)', flex: 1, textAlign: 'left' }}>
          {STATUS_LABELS[status]}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {trucks.length !== totalCount && (
            <span className="section-count" style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}>
              {trucks.length} shown
            </span>
          )}
          <span className="section-count" style={{ background: 'var(--surface-high)', color: 'var(--on-surface-muted)', border: '1px solid var(--outline-variant)' }}>
            {totalCount} total
          </span>
          <span style={{
            color: 'var(--on-surface-muted)', fontSize: '0.75rem',
            transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', display: 'inline-block',
          }}>▾</span>
        </div>
      </button>

      {open && (
        <div style={{ overflowX: 'auto', background: 'var(--surface-container)' }}>
          {trucks.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--on-surface-muted)', fontSize: '0.875rem' }}>
              No trucks in this section
            </div>
          ) : (
            <table className="fleet-table">
              <thead>
                <tr>
                  <th>Unit</th><th>Category</th><th>Location</th>
                  <th>Waiting On</th><th>Next PM</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {trucks.map(truck => (
                  <TruckRow
                    key={truck.id}
                    truck={truck}
                    currentStatus={status}
                    profile={profile}
                    onStatusChange={onStatusChange}
                    onViewHistory={onViewHistory}
                    onInspect={onInspect}
                    onViewInspections={onViewInspections}
                    onUpdateWaitingOn={onUpdateWaitingOn}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
