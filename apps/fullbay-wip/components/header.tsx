'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { UserProfile } from '@netcfs/auth/types'

function ThemeToggle() {
  function toggle() {
    const html = document.documentElement
    const next = html.classList.contains('theme-daylight') ? 'theme-midnight' : 'theme-daylight'
    html.className = next
    localStorage.setItem('theme', next)
  }

  return (
    <button className="theme-toggle-btn" onClick={toggle} title="Toggle theme">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="5" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    </button>
  )
}

export function Header({ profile }: { profile: UserProfile }) {
  const router  = useRouter()
  const [open, setOpen] = useState(false)
  const initial = (profile.full_name ?? profile.email)[0].toUpperCase()

  async function handleSignOut() {
    setOpen(false)
    await getSupabaseBrowserClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
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
        padding: '0 1.25rem',
        height: '3.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        position: 'relative',
      }}>
        {/* Portal back link */}
        <a
          href={process.env.NEXT_PUBLIC_PORTAL_URL || 'http://localhost:3000'}
          style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'rgb(var(--on-surface-muted))', textDecoration: 'none', fontSize: '0.8rem', flexShrink: 0, padding: '0.25rem 0.5rem', borderRadius: '0.375rem' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          NETCFS
        </a>

        <span style={{ color: 'rgb(var(--outline))', flexShrink: 0 }}>|</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'rgb(var(--primary))' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: 'rgb(var(--on-surface))', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
            Fullbay WIP
          </span>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ThemeToggle />
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setOpen(v => !v)}
              style={{
                width: '1.875rem', height: '1.875rem', borderRadius: '50%',
                background: 'rgb(var(--primary-container))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', fontWeight: 700,
                color: 'rgb(var(--on-primary-container))',
                border: 'none', cursor: 'pointer',
              }}
            >
              {initial}
            </button>
            {open && (
              <div className="user-menu-dropdown">
                <div className="user-menu-header">
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'rgb(var(--on-surface))' }}>{profile.email}</div>
                  <div style={{ fontSize: '0.7rem', color: 'rgb(var(--on-surface-muted))', marginTop: 2, textTransform: 'capitalize' }}>{profile.role}</div>
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
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
