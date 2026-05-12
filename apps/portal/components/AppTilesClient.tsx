'use client'

import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import { ROLE_PERMISSIONS, type UserRole } from '@netcfs/auth/types'

const FLEET_URL       = process.env.NEXT_PUBLIC_FLEET_URL       || 'https://netcfs-platform-fleet.vercel.app'
const TRANSPORT_URL   = process.env.NEXT_PUBLIC_TRANSPORT_URL   || 'https://netcfs-platform-transport.vercel.app'
const INSPECTIONS_URL = process.env.NEXT_PUBLIC_INSPECTIONS_URL || 'https://netcfs-platform-inspections.vercel.app'
const SWAPS_URL       = process.env.NEXT_PUBLIC_SWAPS_URL       || 'https://netcfs-platform-swaps.vercel.app'
const IMPOUNDS_URL    = process.env.NEXT_PUBLIC_IMPOUNDS_URL    || 'https://netcfs-platform-impounds.vercel.app'
const RECONCILER_URL  = process.env.NEXT_PUBLIC_RECONCILER_URL  || 'https://netcfs-platform-statement-reconcile.vercel.app'

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
    label: 'Safety',
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
    id: 'statement-reconciler',
    label: 'Statement Reconciler',
    description: 'Reconcile vendor PDF statements against QuickBooks exports',
    baseUrl: RECONCILER_URL,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" />
        <line x1="9" y1="17" x2="12" y2="17" />
      </svg>
    ),
    color: '#10b981',
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
    id: 'grist-news',
    label: 'NEWS Grist',
    description: 'NEWS build shop documents',
    baseUrl: 'https://netcnews.getgrist.com/aJns236vLxGe/NEWS-Build-Shop',
    external: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
        <path d="M8 9h8M8 13h6M8 17h4" />
      </svg>
    ),
    color: '#06b6d4',
  },
  {
    id: 'grist-fleet',
    label: 'Fleet Management Grist',
    description: 'Fleet management spreadsheets and data',
    baseUrl: 'https://netcfleet.getgrist.com/9PG2sk9t9yFW/Fleet-Management',
    external: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      </svg>
    ),
    color: '#6366f1',
  },
  {
    id: 'netctools',
    label: 'NETC Tools',
    description: 'Internal NETC tools and analytics',
    baseUrl: 'https://netctools.vercel.app/login',
    external: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    color: '#f43f5e',
  },
  {
    id: 'netclabs',
    label: 'NETCLabs Toolhub',
    description: 'Open Source Previews of all projects',
    baseUrl: 'https://netc-fleet-services.github.io/netc-labs/#/',
    external: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 3h6v8l3 6H6l3-6V3z" />
        <path d="M6 17h12" />
        <path d="M9 3H6a1 1 0 0 0-1 1v2h14V4a1 1 0 0 0-1-1h-3" />
      </svg>
    ),
    color: '#14b8a6',
  },
  {
    id: 'github',
    label: 'NETC Fleet Services Github',
    description: 'Source code and repositories',
    baseUrl: 'https://github.com/netc-fleet-services',
    external: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    ),
    color: '#94a3b8',
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

  function makeHref(mod: typeof ALL_MODULES[number]): string {
    if (mod.external || !mod.baseUrl.startsWith('http') || !ssoTokens) return mod.baseUrl
    const url = new URL(`${mod.baseUrl}/auth/sso`)
    url.searchParams.set('access_token',  ssoTokens.access_token)
    url.searchParams.set('refresh_token', ssoTokens.refresh_token)
    return url.toString()
  }

  const allowedModules = ROLE_PERMISSIONS[role as UserRole] ?? []
  const visibleModules = ALL_MODULES.filter(m =>
    m.external ? role === 'admin' : allowedModules.includes(m.id)
  )

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
      }}>
        {visibleModules.map(mod => (
          <a
            key={mod.id}
            href={makeHref(mod)}
            className="app-tile"
            style={{ textDecoration: 'none' }}
            {...(mod.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
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

    </div>
  )
}
