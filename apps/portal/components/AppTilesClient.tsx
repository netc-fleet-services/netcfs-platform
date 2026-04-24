'use client'

import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import { ROLE_PERMISSIONS, type UserRole } from '@netcfs/auth/types'

const FLEET_URL       = process.env.NEXT_PUBLIC_FLEET_URL       || 'https://netcfs-platform-fleet.vercel.app'
const TRANSPORT_URL   = process.env.NEXT_PUBLIC_TRANSPORT_URL   || 'https://netcfs-platform-transport.vercel.app'
const INSPECTIONS_URL = process.env.NEXT_PUBLIC_INSPECTIONS_URL || 'https://netcfs-platform-inspections.vercel.app'
const SWAPS_URL       = process.env.NEXT_PUBLIC_SWAPS_URL       || 'https://netcfs-platform-swaps.vercel.app'
const IMPOUNDS_URL    = process.env.NEXT_PUBLIC_IMPOUNDS_URL    || 'https://netcfs-platform-impounds.vercel.app'

const ALL_MODULES = [
  {
    id: 'fleet',
    label: 'Maintenance Tracker',
    description: 'Real-time truck status, maintenance badges, and notes',
    baseUrl: FLEET_URL,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="1" y="3" width="15" height="13" rx="2" />
        <path d="M16 8h4l3 4v4h-7V8z" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
    color: '#22c55e',
  },
  {
    id: 'transport',
    label: 'Dispatch Board',
    description: 'Job scheduling, driver assignment, and route optimization',
    baseUrl: TRANSPORT_URL,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 12h18M3 6h18M3 18h18" />
      </svg>
    ),
    color: '#60a5fa',
  },
  {
    id: 'inspections',
    label: 'Inspections',
    description: 'Driver pre-trip inspection compliance and audit reports',
    baseUrl: INSPECTIONS_URL,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    color: '#f59e0b',
  },
  {
    id: 'swaps',
    label: 'Swap Optimizer',
    description: 'Fleet lifecycle cost analysis and replacement timing',
    baseUrl: SWAPS_URL,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 16V4m0 0L3 8m4-4 4 4" />
        <path d="M17 8v12m0 0 4-4m-4 4-4-4" />
      </svg>
    ),
    color: '#a78bfa',
  },
  {
    id: 'impounds',
    label: 'Impound Tracker',
    description: 'Impounded vehicle inventory, valuations, and disposition',
    baseUrl: IMPOUNDS_URL,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    color: '#fb923c',
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Cross-module summaries, exports, and analytics',
    baseUrl: '/reports',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 20V10M12 20V4M6 20v-6" />
      </svg>
    ),
    color: '#34d399',
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'User preferences, notifications, and account management',
    baseUrl: '/settings',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    color: 'var(--on-surface-muted)',
  },
]

interface Props {
  role: string
  firstName: string
  greeting: string
}

export function AppTilesClient({ role, firstName, greeting }: Props) {
  const [ssoTokens, setSsoTokens] = useState<{ access_token: string; refresh_token: string } | null>(null)

  useEffect(() => {
    getSupabaseBrowserClient().auth.getSession().then(({ data: { session } }) => {
      if (session) setSsoTokens({ access_token: session.access_token, refresh_token: session.refresh_token })
    })
  }, [])

  function makeHref(baseUrl: string): string {
    if (!baseUrl.startsWith('http') || !ssoTokens) return baseUrl
    const url = new URL(`${baseUrl}/auth/sso`)
    url.searchParams.set('access_token',  ssoTokens.access_token)
    url.searchParams.set('refresh_token', ssoTokens.refresh_token)
    return url.toString()
  }

  const allowedModules = ROLE_PERMISSIONS[role as UserRole] ?? []
  const visibleModules = ALL_MODULES.filter(m => allowedModules.includes(m.id))

  return (
    <div style={{ padding: '2rem', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--on-surface)' }}>
          {greeting}, {firstName}
        </h2>
        <p style={{ margin: '0.375rem 0 0', color: 'var(--on-surface-muted)', fontSize: '0.9375rem' }}>
          Here&apos;s what&apos;s available to you today.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '1rem',
        marginBottom: '2.5rem',
      }}>
        {visibleModules.map(mod => (
          <a key={mod.id} href={makeHref(mod.baseUrl)} className="app-tile" style={{ textDecoration: 'none' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: '0.625rem',
              backgroundColor: 'var(--surface-high)',
              color: mod.color,
              flexShrink: 0,
            }}>
              {mod.icon}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--on-surface)', marginBottom: 4 }}>
                {mod.label}
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--on-surface-muted)', lineHeight: 1.4 }}>
                {mod.description}
              </div>
            </div>
          </a>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
        <div style={{
          backgroundColor: 'var(--surface-container)',
          border: '1px solid var(--outline)',
          borderRadius: '0.875rem',
          padding: '1.25rem',
        }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '0.875rem', fontWeight: 700, color: 'var(--on-surface)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Recent Activity
          </h3>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--on-surface-muted)', fontStyle: 'italic' }}>
            Activity feed will populate here as data is migrated into the platform.
          </p>
        </div>

        <div style={{
          backgroundColor: 'var(--surface-container)',
          border: '1px solid var(--outline)',
          borderRadius: '0.875rem',
          padding: '1.25rem',
        }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '0.875rem', fontWeight: 700, color: 'var(--on-surface)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Alerts
          </h3>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--on-surface-muted)', fontStyle: 'italic' }}>
            PM overdue warnings, inspection flags, and blocked jobs will surface here.
          </p>
        </div>
      </div>
    </div>
  )
}
