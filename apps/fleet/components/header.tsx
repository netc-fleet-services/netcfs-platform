'use client'

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

  async function handleSignOut() {
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

        <div style={{ flex: 1 }} />

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isAdmin && (
            <button className="btn-ghost" onClick={() => router.push('/admin')}>
              Admin
            </button>
          )}

          <ThemeToggle />

          {/* User avatar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.25rem 0.5rem', borderRadius: '0.375rem', cursor: 'default',
          }}>
            <div style={{
              width: '1.75rem', height: '1.75rem', borderRadius: '50%',
              background: 'rgb(var(--primary-container))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.7rem', fontWeight: 700,
              color: 'rgb(var(--on-primary-container))', flexShrink: 0,
            }}>
              {initial}
            </div>
          </div>

          <button className="btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => router.push('/reset-password')}>
            Change Password
          </button>

          <button className="btn-secondary" style={{ fontSize: '0.8rem' }} onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </div>
    </header>
  )
}
