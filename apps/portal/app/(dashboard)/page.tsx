import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { type UserRole } from '@netcfs/auth/types'
import { AppTilesClient } from '@/components/AppTilesClient'

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
    href: FLEET_URL,
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
    href: TRANSPORT_URL,
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
    href: INSPECTIONS_URL,
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
    href: SWAPS_URL,
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
    description: 'Towbook vehicle impound tracking, photos, and sales management',
    href: IMPOUNDS_URL,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    color: '#f97316',
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Cross-module summaries, exports, and analytics',
    href: '/reports',
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
    href: '/settings',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    color: 'var(--on-surface-muted)',
  },
]

export default async function HomePage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')

  const firstName = profile.full_name?.split(' ')[0] ?? profile.email.split('@')[0]
  const greeting  = getGreeting()

  return (
    <AppTilesClient
      role={profile.role as UserRole}
      firstName={firstName}
      greeting={greeting}
    />
  )
}
