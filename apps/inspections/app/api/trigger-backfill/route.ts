import { NextRequest, NextResponse } from 'next/server'

const REPO     = 'netc-fleet-services/netcfs-platform'
const WORKFLOW = 'backfill-samsara.yml'
const REF      = 'main'
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: NextRequest) {
  const { start, end } = await req.json()

  if (!start || !end) {
    return NextResponse.json({ error: 'start and end dates are required' }, { status: 400 })
  }
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json({ error: 'Dates must be in YYYY-MM-DD format' }, { status: 400 })
  }
  if (start > end) {
    return NextResponse.json({ error: 'Start date must not be after end date' }, { status: 400 })
  }

  const pat = process.env.GITHUB_PAT
  if (!pat) {
    return NextResponse.json({ error: 'GITHUB_PAT is not configured on this server' }, { status: 500 })
  }

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization':        `Bearer ${pat}`,
        'Accept':               'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type':         'application/json',
      },
      body: JSON.stringify({
        ref: REF,
        inputs: { backfill_start: start, backfill_end: end },
      }),
    },
  )

  if (!res.ok) {
    const text = await res.text()
    console.error(`GitHub dispatch failed ${res.status}:`, text)
    return NextResponse.json(
      { error: `GitHub returned ${res.status} — check that GITHUB_PAT has the workflow scope` },
      { status: 502 },
    )
  }

  // GitHub returns 204 No Content on success — workflow is now queued
  return NextResponse.json({ ok: true })
}
