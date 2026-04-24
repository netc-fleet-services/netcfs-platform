'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { FleetProfile } from '@/lib/types'

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

interface Props {
  profile: FleetProfile
}

export function Header({ profile }: Props) {
  const router = useRouter()
  const supabase = getSupabaseBrowserClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  function handleMenuToggle() {
    setMenuOpen(v => !v)
  }

  function handleMenuBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!menuRef.current?.contains(e.relatedTarget as Node)) {
      setMenuOpen(false)
    }
  }

  async function handleSignOut() {
    setMenuOpen(false)
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isAdmin = profile.role === 'admin' || profile.role === 'shop_manager' || profile.role === 'dispatcher'
  const initial = (profile.email || '?')[0].toUpperCase()

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
        gap: '1rem',
        position: 'relative',
      }}>
        {/* Portal home link */}
        <a
          href={process.env.NEXT_PUBLIC_PORTAL_URL || 'http://localhost:3000'}
          style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'rgb(var(--on-surface-muted))', textDecoration: 'none', fontSize: '0.8rem', flexShrink: 0, padding: '0.25rem 0.5rem', borderRadius: '0.375rem', transition: 'color 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgb(var(--on-surface))')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgb(var(--on-surface-muted))')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          NETCFS
        </a>

        <span style={{ color: 'rgb(var(--outline))', fontSize: '1rem', flexShrink: 0 }}>|</span>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, color: 'rgb(var(--primary))' }}>
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="7" fill="rgb(var(--primary-container))" />
            <path d="M6 22 L6 14 L12 10 L18 14 L18 22 M12 22 L12 16 L16 16 L16 22"
              stroke="rgb(var(--primary))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" fill="none" />
            <path d="M20 12 L26 12 M26 16 L22 16 M26 20 L22 20"
              stroke="rgb(var(--primary))" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
          <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: 'rgb(var(--on-surface))', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
            Fleet Tracker
          </span>
        </div>

        {/* Center: company logo — hidden on narrow screens */}
        <div className="header-center-logo" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}>
          <img src="/logo-main.png" alt="NETC Fleet Services" style={{ height: 28, width: 'auto', display: 'block' }} />
        </div>

        <div style={{ flex: 1 }} />

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ThemeToggle />

          {/* User menu */}
          <div ref={menuRef} style={{ position: 'relative' }} onBlur={handleMenuBlur}>
            <button
              className="user-menu-trigger"
              onClick={handleMenuToggle}
              aria-label="User menu"
              aria-expanded={menuOpen}
            >
              <div style={{
                width: '1.875rem', height: '1.875rem', borderRadius: '50%',
                background: 'rgb(var(--primary-container))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', fontWeight: 700,
                color: 'rgb(var(--on-primary-container))',
              }}>
                {initial}
              </div>
            </button>

            {menuOpen && (
              <div className="user-menu-dropdown">
                <div className="user-menu-header">
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'rgb(var(--on-surface))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {profile.email}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'rgb(var(--on-surface-muted))', marginTop: 2, textTransform: 'capitalize' }}>
                    {profile.role?.replace('_', ' ')}
                  </div>
                </div>
                {isAdmin && (
                  <button className="user-menu-item" onClick={() => { setMenuOpen(false); router.push('/admin') }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    Admin Settings
                  </button>
                )}
                <button className="user-menu-item" onClick={() => { setMenuOpen(false); router.push('/reset-password') }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Change Password
                </button>
                <button className="user-menu-item danger" onClick={handleSignOut}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
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
