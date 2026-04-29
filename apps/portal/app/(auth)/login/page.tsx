'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = getSupabaseBrowserClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    router.push(next)
    router.refresh()
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        backgroundColor: 'var(--surface-container)',
        border: '1px solid var(--outline)',
        borderRadius: '0.875rem',
        padding: '1.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      {error && (
        <div
          style={{
            padding: '0.625rem 0.875rem',
            backgroundColor: 'var(--error-container)',
            border: '1px solid var(--error)',
            borderRadius: '0.5rem',
            fontSize: '0.8125rem',
            color: 'var(--error)',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <label htmlFor="email" className="form-label">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          className="form-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@netcfs.com"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <label htmlFor="password" className="form-label">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          className="form-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </div>

      <button
        type="submit"
        className="btn-primary"
        disabled={loading}
        style={{ width: '100%', marginTop: '0.25rem', justifyContent: 'center' }}
      >
        {loading ? 'Signing in…' : 'Sign In'}
      </button>

      <a
        href="/forgot-password"
        style={{ textAlign: 'center', fontSize: '0.8125rem', color: '#64748b', textDecoration: 'underline' }}
      >
        Forgot password?
      </a>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        backgroundColor: 'var(--surface)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src="/logo-main.png"
            alt="NETC Fleet Services"
            style={{ height: 48, width: 'auto', margin: '0 auto 1.25rem', display: 'block' }}
          />
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--on-surface-muted)' }}>
            Sign in to continue
          </p>
        </div>

        <Suspense fallback={<div style={{ textAlign: 'center', color: 'var(--on-surface-muted)' }}>Loading…</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
