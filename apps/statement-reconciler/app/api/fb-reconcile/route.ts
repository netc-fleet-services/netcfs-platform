import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'fb-reconciliation-files'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(request: NextRequest) {
  const sb = getServiceClient()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const fbFile = formData.get('fb_file') as File | null
  const qbFile = formData.get('qb_file') as File | null

  if (!fbFile || !qbFile) {
    return NextResponse.json({ error: 'fb_file and qb_file are required' }, { status: 400 })
  }

  const jobId = crypto.randomUUID()

  const { error: insertError } = await sb.from('fb_reconciliation_jobs').insert({
    id:     jobId,
    status: 'pending',
  })
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Upload Fullbay CSV
  const fbBytes = await fbFile.arrayBuffer()
  const { error: fbUploadErr } = await sb.storage.from(BUCKET).upload(
    `${jobId}/fullbay.csv`,
    Buffer.from(fbBytes),
    { contentType: 'text/csv' },
  )
  if (fbUploadErr) {
    await sb.from('fb_reconciliation_jobs').update({ status: 'error', error_message: fbUploadErr.message }).eq('id', jobId)
    return NextResponse.json({ error: `Fullbay file upload failed: ${fbUploadErr.message}` }, { status: 500 })
  }

  // Upload QuickBooks Excel
  const qbBytes = await qbFile.arrayBuffer()
  const { error: qbUploadErr } = await sb.storage.from(BUCKET).upload(
    `${jobId}/quickbooks.xlsx`,
    Buffer.from(qbBytes),
    { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  )
  if (qbUploadErr) {
    await sb.from('fb_reconciliation_jobs').update({ status: 'error', error_message: qbUploadErr.message }).eq('id', jobId)
    return NextResponse.json({ error: `QuickBooks file upload failed: ${qbUploadErr.message}` }, { status: 500 })
  }

  // Update job with uploaded file paths
  await sb.from('fb_reconciliation_jobs').update({
    fb_file_path: `${jobId}/fullbay.csv`,
    qb_file_path: `${jobId}/quickbooks.xlsx`,
  }).eq('id', jobId)

  // Trigger GitHub Actions
  const githubRepo = process.env.GITHUB_REPO
  const githubPat  = process.env.GITHUB_PAT
  if (!githubRepo || !githubPat) {
    await sb.from('fb_reconciliation_jobs').update({ status: 'error', error_message: 'GITHUB_REPO or GITHUB_PAT not configured' }).eq('id', jobId)
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
      event_type:     'run-fb-reconciliation',
      client_payload: { job_id: jobId },
    }),
  })

  if (!dispatchRes.ok) {
    const msg = await dispatchRes.text()
    await sb.from('fb_reconciliation_jobs').update({ status: 'error', error_message: `GitHub dispatch failed: ${msg}` }).eq('id', jobId)
    return NextResponse.json({ error: `GitHub dispatch failed: ${msg}` }, { status: 500 })
  }

  return NextResponse.json({ jobId })
}
