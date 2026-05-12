import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'reconciliation-files'

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

  const vendorKey  = formData.get('vendor_key') as string | null
  const qbFiles    = formData.getAll('qb_files') as File[]
  const stmtFiles  = formData.getAll('stmt_files') as File[]

  if (!vendorKey || qbFiles.length === 0 || stmtFiles.length === 0) {
    return NextResponse.json({ error: 'vendor_key, qb_files, and stmt_files are required' }, { status: 400 })
  }

  const jobId = crypto.randomUUID()

  // Create job row
  const { error: insertError } = await sb.from('reconciliation_jobs').insert({
    id:              jobId,
    status:          'pending',
    vendor_key:      vendorKey,
    qb_file_count:   qbFiles.length,
    stmt_file_count: stmtFiles.length,
  })
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Upload QB files
  for (let i = 0; i < qbFiles.length; i++) {
    const bytes = await qbFiles[i].arrayBuffer()
    const { error } = await sb.storage.from(BUCKET).upload(
      `${jobId}/qb_${i}.xlsx`,
      Buffer.from(bytes),
      { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    )
    if (error) {
      await sb.from('reconciliation_jobs').update({ status: 'error', error_message: `Upload failed: ${error.message}` }).eq('id', jobId)
      return NextResponse.json({ error: `QB file upload failed: ${error.message}` }, { status: 500 })
    }
  }

  // Upload statement files (PDF or XLSX)
  const stmtExts: string[] = []
  for (let i = 0; i < stmtFiles.length; i++) {
    const isXlsx = stmtFiles[i].name.toLowerCase().endsWith('.xlsx')
    const ext = isXlsx ? 'xlsx' : 'pdf'
    const contentType = isXlsx
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf'
    stmtExts.push(ext)
    const bytes = await stmtFiles[i].arrayBuffer()
    const { error } = await sb.storage.from(BUCKET).upload(
      `${jobId}/statement_${i}.${ext}`,
      Buffer.from(bytes),
      { contentType },
    )
    if (error) {
      await sb.from('reconciliation_jobs').update({ status: 'error', error_message: `Upload failed: ${error.message}` }).eq('id', jobId)
      return NextResponse.json({ error: `Statement file upload failed: ${error.message}` }, { status: 500 })
    }
  }

  // Trigger GitHub Actions via repository_dispatch
  const githubRepo = process.env.GITHUB_REPO
  const githubPat  = process.env.GITHUB_PAT
  if (!githubRepo || !githubPat) {
    await sb.from('reconciliation_jobs').update({ status: 'error', error_message: 'GITHUB_REPO or GITHUB_PAT not configured' }).eq('id', jobId)
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
      event_type:     'run-reconciliation',
      client_payload: {
        job_id:          jobId,
        vendor_key:      vendorKey,
        qb_file_count:   qbFiles.length,
        stmt_file_count: stmtFiles.length,
        stmt_exts:       stmtExts.join(','),
      },
    }),
  })

  if (!dispatchRes.ok) {
    const msg = await dispatchRes.text()
    await sb.from('reconciliation_jobs').update({ status: 'error', error_message: `GitHub dispatch failed: ${msg}` }).eq('id', jobId)
    return NextResponse.json({ error: `GitHub dispatch failed: ${msg}` }, { status: 500 })
  }

  return NextResponse.json({ jobId })
}
