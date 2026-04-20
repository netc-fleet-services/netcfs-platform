'use client'

import { PM_SOON_DAYS } from '@/lib/constants'

export function getPMStatus(nextPmDate: string | null | undefined) {
  if (!nextPmDate) return null
  const daysUntil = (new Date(nextPmDate).getTime() - Date.now()) / 86_400_000
  if (daysUntil < 0) return 'overdue'
  if (daysUntil <= PM_SOON_DAYS) return 'soon'
  return 'ok'
}

const PM_LABELS = { ok: 'PM OK', soon: 'PM Soon', overdue: 'PM Overdue' }

export function MaintenanceBadge({ nextPmDate }: { nextPmDate?: string | null }) {
  const status = getPMStatus(nextPmDate)
  if (!status) return <span style={{ color: 'var(--on-surface-muted)', fontSize: '0.75rem' }}>—</span>

  const dateStr = new Date(nextPmDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className={`pm-badge pm-${status}`}>{PM_LABELS[status]}</span>
      <span style={{ fontSize: '0.68rem', color: 'var(--on-surface-muted)' }}>{dateStr}</span>
    </div>
  )
}
