'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [done,     setDone]     = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm)  { setError('Passwords do not match.'); return }
    if (password.length < 8)   { setError('Password must be at least 8 characters.'); return }

    setLoading(true)
    const supabase = getSupabaseBrowserClient()
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (err) { setError(err.message); return }
    setDone(true)
    setTimeout(() => router.push('/'), 2500)
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
        </div>

        <div style={{
          backgroundColor: 'var(--surface-container)',
          border: '1px solid var(--outline)',
          borderRadius: '0.875rem',
          padding: '1.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}>
          <h2 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 700, color: 'var(--on-surface)' }}>
            Set your password
          </h2>

          {done ? (
            <div style={{
              padding: '0.75rem 1rem',
              backgroundColor: 'var(--success-container, #dcfce7)',
              border: '1px solid var(--success, #16a34a)',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              color: 'var(--success, #16a34a)',
            }}>
              Password updated! Redirecting…
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                <label htmlFor="password" className="form-label">New password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  autoFocus
                  className="form-input"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label htmlFor="confirm" className="form-label">Confirm password</label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="form-input"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
                style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}
              >
                {loading ? 'Saving…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
