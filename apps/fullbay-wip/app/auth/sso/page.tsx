'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@netcfs/auth/client'

function SSOHandler() {
  const router = useRouter()
  const params = useSearchParams()

  useEffect(() => {
    const access_token  = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    const next          = params.get('next') || '/'

    if (!access_token || !refresh_token) { router.replace('/login'); return }

    getSupabaseBrowserClient()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => {
        router.replace(error ? '/login' : next)
        router.refresh()
      })
  }, [params, router])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgb(var(--surface))' }}>
      <p style={{ color: 'rgb(var(--on-surface-muted))', fontSize: '0.9rem' }}>Signing you in…</p>
    </div>
  )
}

export default function SSOPage() {
  return (
    <Suspense>
      <SSOHandler />
    </Suspense>
  )
}
