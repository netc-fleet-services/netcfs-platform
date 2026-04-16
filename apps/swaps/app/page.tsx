import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'

export default async function SwapsPage() {
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
          <path d="M7 16V4m0 0L3 8m4-4 4 4" />
          <path d="M17 8v12m0 0 4-4m-4 4-4-4" />
        </svg>
      </div>
      <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--on-surface)' }}>
        Swap Optimizer
      </h1>
      <p style={{ margin: 0, color: 'var(--on-surface-muted)', textAlign: 'center', maxWidth: 420, fontSize: '0.9375rem' }}>
        This module is ready for migration from{' '}
        <strong style={{ color: 'var(--primary)' }}>fleet-swap-model</strong>.
        The vanilla JS cost model will be ported to TypeScript with interactive charts and Supabase-backed history.
      </p>
    </div>
  )
}
