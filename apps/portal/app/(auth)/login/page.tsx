'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'

export default function LoginPage() {
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
        {/* Logo / Brand */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 52,
              height: 52,
              borderRadius: '0.875rem',
              backgroundColor: 'var(--primary)',
              marginBottom: '1rem',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2.5">
              <rect x="1" y="3" width="15" height="13" rx="2" />
              <path d="M16 8h4l3 4v4h-7V8z" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          </div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--on-surface)' }}>
            NETCFS Platform
          </h1>
          <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: 'var(--on-surface-muted)' }}>
            Sign in to continue
          </p>
        </div>

        {/* Form */}
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
        </form>
      </div>
    </div>
  )
}
