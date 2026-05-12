'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@netcfs/ui'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { UserProfile } from '@netcfs/auth/types'
import { ROLE_LABELS } from '@netcfs/auth/types'

interface Props {
  profile: UserProfile
  children: React.ReactNode
}

export function DashboardShell({ profile, children }: Props) {
  const router = useRouter()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [menuOpen, setMenuOpen] = useState(false)

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.className = next === 'dark' ? 'theme-midnight' : 'theme-daylight'
    setTheme(next)
    localStorage.setItem('theme', next === 'dark' ? 'midnight' : 'daylight')
  }

  async function handleSignOut() {
    setMenuOpen(false)
    await getSupabaseBrowserClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const initial = (profile.full_name ?? profile.email).charAt(0).toUpperCase()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--surface)' }}>
      <header style={{
        background: 'rgb(var(--surface-container))',
        borderBottom: '1px solid rgb(var(--outline))',
        position: 'sticky',
        top: 0,
        zIndex: 30,
      }}>
        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '0 1.5rem',
          height: '3.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
        }}>
          {/* Logo + title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
            <img src="/logo-main.png" alt="NETC Fleet Services" className="logo-light" style={{ height: 32, width: 'auto', display: 'block' }} />
            <img src="/logo-email.png" alt="NETC Fleet Services" className="logo-dark" style={{ height: 32, width: 'auto', display: 'block' }} />
            <span style={{ fontWeight: 700, fontSize: '1rem', color: 'rgb(var(--on-surface))', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
              NETC Fleet Services Apps Portal
            </span>
          </div>

          <div style={{ flex: 1 }} />

          {/* Right side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />

            {/* User menu */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setMenuOpen(v => !v)}
                style={{
                  width: '2rem', height: '2rem', borderRadius: '50%',
                  background: 'rgb(var(--primary-container))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.8rem', fontWeight: 700,
                  color: 'rgb(var(--on-primary-container))',
                  border: 'none', cursor: 'pointer',
                }}
              >
                {initial}
              </button>

              {menuOpen && (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="user-menu-dropdown" style={{ zIndex: 50 }}>
                    <div className="user-menu-header">
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'rgb(var(--on-surface))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {profile.full_name ?? profile.email}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'rgb(var(--on-surface-muted))', marginTop: 2 }}>
                        {ROLE_LABELS[profile.role]}
                      </div>
                    </div>
                    <button className="user-menu-item danger" onClick={handleSignOut}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  )
}
