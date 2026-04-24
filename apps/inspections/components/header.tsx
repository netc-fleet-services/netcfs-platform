'use client'

export function Header() {
  const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL || 'http://localhost:3000'

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
        position: 'relative',
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

        <span style={{ color: 'rgb(var(--outline))', fontSize: '1rem' }}>|</span>

        {/* Center: company logo */}
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }}>
          <img src="/logo-main.png" alt="NETC Fleet Services" style={{ height: 28, width: 'auto', display: 'block' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'rgb(var(--primary))' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: 'rgb(var(--on-surface))', letterSpacing: '-0.01em' }}>
            Safety Program
          </span>
        </div>
      </div>
    </header>
  )
}
