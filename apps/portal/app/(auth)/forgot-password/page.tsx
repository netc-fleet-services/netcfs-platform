'use client'

import { useState } from 'react'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent,    setSent]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = getSupabaseBrowserClient()
    const redirectTo = window.location.origin + '/reset-password'

    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    setLoading(false)

    if (err) { setError(err.message); return }
    setSent(true)
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      backgroundColor: 'var(--surface)',
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src="/logo-main.png"
            alt="NETC Fleet Services"
            style={{ height: 48, width: 'auto', margin: '0 auto 1.25rem', display: 'block' }}
          />
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--on-surface-muted)' }}>
            Reset your password
          </p>
        </div>

        <div style={{
          backgroundColor: 'var(--surface-container)',
          border: '1px solid var(--outline)',
          borderRadius: '0.875rem',
          padding: '1.75rem',
        }}>
          {sent ? (
            <div>
              <div style={{
                padding: '0.75rem 1rem',
                backgroundColor: 'var(--success-container, #dcfce7)',
                border: '1px solid var(--success, #16a34a)',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                color: 'var(--success, #16a34a)',
                marginBottom: '1.25rem',
              }}>
                Check your email — we sent a password reset link to <strong>{email}</strong>.
              </div>
              <a href="/login" style={{ fontSize: '0.875rem', color: 'var(--primary)', textDecoration: 'none' }}>
                ← Back to sign in
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--on-surface-muted)', lineHeight: 1.5 }}>
                Enter your email and we&apos;ll send you a link to reset your password.
              </p>

              {error && (
                <div style={{
                  padding: '0.625rem 0.875rem',
                  backgroundColor: 'var(--error-container)',
                  border: '1px solid var(--error)',
                  borderRadius: '0.5rem',
                  fontSize: '0.8125rem',
                  color: 'var(--error)',
                }}>
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
                  autoFocus
                  className="form-input"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@netcfs.com"
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
                style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>

              <a href="/login" style={{ textAlign: 'center', fontSize: '0.8125rem', color: 'var(--on-surface-muted)', textDecoration: 'none' }}>
                ← Back to sign in
              </a>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
