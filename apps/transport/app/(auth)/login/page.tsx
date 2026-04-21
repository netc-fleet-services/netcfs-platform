'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/'

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

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
    <div style={{
      width: '100%',
      maxWidth: 400,
      backgroundColor: 'rgb(var(--surface-container))',
      border: '1px solid rgb(var(--outline))',
      borderRadius: '0.875rem',
      padding: '2rem',
    }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div>
          <label className="form-label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="form-input"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
          />
        </div>

        <div>
          <label className="form-label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="form-input"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        {error && (
          <div style={{
            padding: '0.75rem 1rem',
            backgroundColor: 'rgb(var(--error-container))',
            border: '1px solid rgb(var(--error))',
            borderRadius: '0.5rem',
            color: 'rgb(var(--error))',
            fontSize: '0.875rem',
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary"
          disabled={loading}
          style={{ marginTop: '0.25rem', height: '2.75rem', width: '100%' }}
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      backgroundColor: 'rgb(var(--surface))',
    }}>
      <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <img
          src="/logo-main.png"
          alt="NETC Fleet Services"
          style={{ height: 48, width: 'auto', margin: '0 auto 0.75rem', display: 'block' }}
        />
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'rgb(var(--on-surface))' }}>
          Dispatch Board
        </h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'rgb(var(--on-surface-muted))' }}>
          Sign in to manage dispatch
        </p>
      </div>

      <Suspense fallback={<div style={{ color: 'rgb(var(--on-surface-muted))' }}>Loading…</div>}>
        <LoginForm />
      </Suspense>

      <p style={{ color: 'rgb(var(--on-surface-muted))', fontSize: '0.75rem', marginTop: '2rem' }}>
        Contact your administrator to request access.
      </p>
    </div>
  )
}
