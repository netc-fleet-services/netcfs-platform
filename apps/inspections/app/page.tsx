import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'

export default async function InspectionsPage() {
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
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      </div>
      <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--on-surface)' }}>
        Driver Inspections
      </h1>
      <p style={{ margin: 0, color: 'var(--on-surface-muted)', textAlign: 'center', maxWidth: 420, fontSize: '0.9375rem' }}>
        This module is ready for migration from{' '}
        <strong style={{ color: 'var(--primary)' }}>driver-inspections-tracker</strong>.
        The Excel-processing tool will be converted to a Next.js app with file upload and database storage.
      </p>
    </div>
  )
}
