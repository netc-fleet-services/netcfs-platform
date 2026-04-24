'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface NavItem {
  label: string
  href: string
  icon?: React.ReactNode
  requiredModule?: string
}

interface SidebarProps {
  items: NavItem[]
  logo?: React.ReactNode
  footer?: React.ReactNode
  mobileOpen?: boolean
  onClose?: () => void
}

export function Sidebar({ items, logo, footer, mobileOpen, onClose }: SidebarProps) {
  const pathname = usePathname()

  return (
    <nav
      className={`sidebar-nav${mobileOpen ? ' open' : ''}`}
      style={{
        width: 220,
        flexShrink: 0,
        height: '100vh',
        position: 'sticky',
        top: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'rgb(var(--surface-container))',
        borderRight: '1px solid rgb(var(--outline))',
        padding: '1rem 0.75rem',
        gap: '0.25rem',
        overflowY: 'auto',
      }}
    >
      {logo && (
        <div style={{ padding: '0.5rem 0.75rem', marginBottom: '0.75rem' }}>
          {logo}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem', flex: 1 }}>
        {items.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link${isActive ? ' active' : ''}`}
              onClick={onClose}
            >
              {item.icon && (
                <span style={{ width: 18, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                  {item.icon}
                </span>
              )}
              {item.label}
            </Link>
          )
        })}
      </div>

      {footer && (
        <div style={{ borderTop: '1px solid var(--outline)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
          {footer}
        </div>
      )}
    </nav>
  )
}
