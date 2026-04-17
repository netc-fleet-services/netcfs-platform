'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar, type NavItem } from '@netcfs/ui'
import { ThemeToggle } from '@netcfs/ui'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { UserProfile } from '@netcfs/auth/types'
import { ROLE_PERMISSIONS, ROLE_LABELS } from '@netcfs/auth/types'

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Home',
    href: '/',
    requiredModule: undefined,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    label: 'Fleet Tracker',
    href: '/fleet',
    requiredModule: 'fleet',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="1" y="3" width="15" height="13" rx="2" />
        <path d="M16 8h4l3 4v4h-7V8z" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  {
    label: 'Dispatch Board',
    href: '/transport',
    requiredModule: 'transport',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 12h18M3 6h18M3 18h18" />
      </svg>
    ),
  },
  {
    label: 'Inspections',
    href: '/inspections',
    requiredModule: 'inspections',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    label: 'Swap Optimizer',
    href: '/swaps',
    requiredModule: 'swaps',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 16V4m0 0L3 8m4-4 4 4" />
        <path d="M17 8v12m0 0 4-4m-4 4-4-4" />
      </svg>
    ),
  },
  {
    label: 'Reports',
    href: '/reports',
    requiredModule: 'reports',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 20V10M12 20V4M6 20v-6" />
      </svg>
    ),
  },
  {
    label: 'Settings',
    href: '/settings',
    requiredModule: 'settings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
]

interface Props {
  profile: UserProfile
  children: React.ReactNode
}

export function DashboardShell({ profile, children }: Props) {
  const router = useRouter()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  const allowedModules = ROLE_PERMISSIONS[profile.role] ?? []
  const visibleNav = NAV_ITEMS.filter(
    (item) => !item.requiredModule || allowedModules.includes(item.requiredModule)
  )

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    const themeClass = next === 'dark' ? 'theme-midnight' : 'theme-daylight'
    setTheme(next)
    document.documentElement.className = themeClass
    localStorage.setItem('theme', next === 'dark' ? 'midnight' : 'daylight')
  }

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const Logo = (
    <div style={{ padding: '0 0.25rem' }}>
      <img src="/logo-main.png" alt="NETC Fleet Services" className="logo-light" style={{ height: 28, width: 'auto', display: 'block' }} />
      <img src="/logo-email.png" alt="NETC Fleet Services" className="logo-dark" style={{ height: 28, width: 'auto', display: 'block' }} />
    </div>
  )

  const UserFooter = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.75rem' }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            backgroundColor: 'var(--primary-container)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            fontWeight: 700,
            color: 'var(--on-primary-container)',
            flexShrink: 0,
          }}
        >
          {(profile.full_name ?? profile.email).charAt(0).toUpperCase()}
        </div>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {profile.full_name ?? profile.email}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--on-surface-muted)', textTransform: 'capitalize' }}>
            {ROLE_LABELS[profile.role]}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.375rem' }}>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <button onClick={handleSignOut} className="btn-ghost" style={{ flex: 1, fontSize: '0.75rem' }}>
          Sign out
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar items={visibleNav} logo={Logo} footer={UserFooter} />
      <main style={{ flex: 1, overflow: 'auto', backgroundColor: 'var(--surface)' }}>
        {children}
      </main>
    </div>
  )
}
