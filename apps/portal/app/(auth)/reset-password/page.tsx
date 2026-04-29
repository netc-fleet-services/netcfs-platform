'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'
import type { EmailOtpType } from '@supabase/supabase-js'

type Status = 'verifying' | 'ready' | 'link-error'

function ResetPasswordForm() {
  const router      = useRouter()
  const searchParams = useSearchParams()
  const tokenHash   = searchParams.get('token_hash')
  const type        = searchParams.get('type') as EmailOtpType | null

  const [status,     setStatus]     = useState<Status>(tokenHash ? 'verifying' : 'ready')
  const [password,   setPassword]   = useState('')
  const [confirm,    setConfirm]    = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError,  setFormError]  = useState<string | null>(null)
  const [done,       setDone]       = useState(false)

  useEffect(() => {
    if (!tokenHash || !type) return
    getSupabaseBrowserClient()
      .auth.verifyOtp({ token_hash: tokenHash, type })
      .then(({ error }) => setStatus(error ? 'link-error' : 'ready'))
  }, [tokenHash, type])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (password !== confirm) { setFormError('Passwords do not match.'); return }
    if (password.length < 8)  { setFormError('Password must be at least 8 characters.'); return }

    setSubmitting(true)
    const { error } = await getSupabaseBrowserClient().auth.updateUser({ password })
    setSubmitting(false)
    if (error) { setFormError(error.message); return }
    setDone(true)
    setTimeout(() => router.push('/'), 2500)
  }

  return (
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

      {status === 'verifying' && (
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>
          Verifying your link…
        </p>
      )}

      {status === 'link-error' && (
        <div style={{
          padding: '0.75rem 1rem',
          backgroundColor: 'var(--error-container)',
          border: '1px solid var(--error)',
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          color: 'var(--error)',
        }}>
          This link has expired or is invalid.{' '}
          <a href="/forgot-password" style={{ color: 'inherit', textDecoration: 'underline' }}>
            Request a new one
          </a>
        </div>
      )}

      {status === 'ready' && (
        done ? (
          <div style={{
            padding: '0.75rem 1rem',
            backgroundColor: 'var(--success-container, #dcfce7)',
            border: '1px solid var(--success, #16a34a)',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            color: 'var(--success, #16a34a)',
          }}>
            Password set! Redirecting…
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {formError && (
              <div style={{
                padding: '0.625rem 0.875rem',
                backgroundColor: 'var(--error-container)',
                border: '1px solid var(--error)',
                borderRadius: '0.5rem',
                fontSize: '0.8125rem',
                color: 'var(--error)',
              }}>
                {formError}
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
              disabled={submitting}
              style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}
            >
              {submitting ? 'Saving…' : 'Set password'}
            </button>
          </form>
        )
      )}
    </div>
  )
}

export default function ResetPasswordPage() {
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
        <Suspense fallback={<div style={{ textAlign: 'center', color: '#64748b' }}>Loading…</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  )
}
