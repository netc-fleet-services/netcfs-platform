import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'

export default async function FleetPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--surface)',
        gap: '1rem',
        padding: '2rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 56,
          height: 56,
          borderRadius: '1rem',
          backgroundColor: 'var(--primary-container)',
          color: 'var(--on-primary-container)',
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="1" y="3" width="15" height="13" rx="2" />
          <path d="M16 8h4l3 4v4h-7V8z" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      </div>
      <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--on-surface)' }}>
        Fleet Tracker
      </h1>
      <p style={{ margin: 0, color: 'var(--on-surface-muted)', textAlign: 'center', maxWidth: 400, fontSize: '0.9375rem' }}>
        This module is ready for migration from{' '}
        <strong style={{ color: 'var(--primary)' }}>maintenance-tracker</strong>.
        Copy the app code into this directory, update imports to use{' '}
        <code style={{ fontSize: '0.875em', color: 'var(--on-primary-container)' }}>@netcfs/ui</code>,{' '}
        <code style={{ fontSize: '0.875em', color: 'var(--on-primary-container)' }}>@netcfs/auth</code>, and{' '}
        <code style={{ fontSize: '0.875em', color: 'var(--on-primary-container)' }}>@netcfs/db</code>.
      </p>
    </div>
  )
}
