import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST() {
  const sb = getServiceClient()

  const runId = crypto.randomUUID()

  const { error: insertError } = await sb.from('wip_runs').insert({
    id:     runId,
    status: 'pending',
  })
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  const githubRepo = process.env.GITHUB_REPO
  const githubPat  = process.env.GITHUB_PAT
  if (!githubRepo || !githubPat) {
    await sb.from('wip_runs').update({ status: 'error', error_message: 'GITHUB_REPO or GITHUB_PAT not configured' }).eq('id', runId)
    return NextResponse.json({ error: 'GitHub integration not configured' }, { status: 500 })
  }

  const dispatchRes = await fetch(`https://api.github.com/repos/${githubRepo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${githubPat}`,
      Accept:         'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type:     'run-wip',
      client_payload: { run_id: runId },
    }),
  })

  if (!dispatchRes.ok) {
    const msg = await dispatchRes.text()
    await sb.from('wip_runs').update({ status: 'error', error_message: `GitHub dispatch failed: ${msg}` }).eq('id', runId)
    return NextResponse.json({ error: `GitHub dispatch failed: ${msg}` }, { status: 500 })
  }

  return NextResponse.json({ runId })
}
