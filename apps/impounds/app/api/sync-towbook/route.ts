import { NextResponse } from 'next/server'

const GITHUB_TOKEN  = process.env.GITHUB_PAT
const GITHUB_REPO   = process.env.GITHUB_REPO   ?? 'netc-fleet-services/netcfs-platform'
const WORKFLOW_FILE = process.env.SYNC_WORKFLOW  ?? 'sync-towbook.yml'
const WORKFLOW_REF  = process.env.SYNC_BRANCH    ?? 'main'

export async function POST() {
  if (!GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GITHUB_PAT not configured' }, { status: 500 })
  }

  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept':        'application/vnd.github+json',
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ ref: WORKFLOW_REF }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[sync-towbook] GitHub dispatch error:', text)
    return NextResponse.json({ error: text }, { status: 500 })
  }

  return NextResponse.json({ dispatched: true })
}
