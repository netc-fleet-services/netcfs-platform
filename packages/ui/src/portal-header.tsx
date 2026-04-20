'use client'

import type { ReactNode } from 'react'

const APP_ICONS: Record<string, ReactNode> = {
  'Driver Inspections': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  'Dispatch Board': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12h18M3 6h18M3 18h18" />
    </svg>
  ),
  'Swap Optimizer': (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 16V4m0 0L3 8m4-4 4 4" />
      <path d="M17 8v12m0 0 4-4m-4 4-4-4" />
    </svg>
  ),
}

interface PortalHeaderProps {
  appTitle: string
  portalUrl?: string
  children?: ReactNode
}

export function PortalHeader({ appTitle, portalUrl = 'http://localhost:3000', children }: PortalHeaderProps) {
  const icon = APP_ICONS[appTitle]

  return (
    <header style={{
      background: 'rgb(var(--surface-container))',
      borderBottom: '1px solid rgb(var(--outline))',
      position: 'sticky',
      top: 0,
      zIndex: 30,
    }}>
      <div style={{
        maxWidth: 1400,
        margin: '0 auto',
        padding: '0 1.25rem',
        height: '3.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
      }}>
        <a
          href={portalUrl}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.375rem',
            color: 'rgb(var(--on-surface-muted))', textDecoration: 'none',
            fontSize: '0.8rem', flexShrink: 0, padding: '0.25rem 0.5rem',
            borderRadius: '0.375rem', transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgb(var(--on-surface))')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgb(var(--on-surface-muted))')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          NETCFS
        </a>

        <span style={{ color: 'rgb(var(--outline))', fontSize: '1rem', flexShrink: 0 }}>|</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          {icon && <div style={{ color: 'rgb(var(--primary))' }}>{icon}</div>}
          <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: 'rgb(var(--on-surface))', letterSpacing: '-0.01em' }}>
            {appTitle}
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {children && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {children}
          </div>
        )}
      </div>
    </header>
  )
}
