import React from 'react'

type StatusVariant = 'ready' | 'issues' | 'oos'
type PmVariant = 'ok' | 'soon' | 'overdue'

interface StatusBadgeProps {
  status: StatusVariant
  label?: string
}

const STATUS_LABELS: Record<StatusVariant, string> = {
  ready: 'Ready',
  issues: 'Known Issues',
  oos: 'Out of Service',
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge-${status}`}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: 'currentColor',
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
      {label ?? STATUS_LABELS[status]}
    </span>
  )
}

interface PmBadgeProps {
  variant: PmVariant
  label: string
}

export function PmBadge({ variant, label }: PmBadgeProps) {
  return <span className={`pm-badge pm-${variant}`}>{label}</span>
}

interface TagProps {
  children: React.ReactNode
}

export function Tag({ children }: TagProps) {
  return <span className="tag">{children}</span>
}
