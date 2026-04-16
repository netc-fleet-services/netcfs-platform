'use client'

import React from 'react'

interface HeaderProps {
  title: string
  actions?: React.ReactNode
  breadcrumb?: string
}

export function Header({ title, actions, breadcrumb }: HeaderProps) {
  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.5rem',
        backgroundColor: 'var(--surface-container)',
        borderBottom: '1px solid var(--outline)',
        gap: '1rem',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {breadcrumb && (
          <span style={{ fontSize: '0.68rem', color: 'var(--on-surface-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {breadcrumb}
          </span>
        )}
        <h1 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: 'var(--on-surface)' }}>
          {title}
        </h1>
      </div>
      {actions && <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>{actions}</div>}
    </header>
  )
}

interface ThemeToggleProps {
  theme: 'dark' | 'light'
  onToggle: () => void
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  return (
    <button onClick={onToggle} className="theme-toggle-btn" aria-label="Toggle theme" title="Toggle theme">
      {theme === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}
