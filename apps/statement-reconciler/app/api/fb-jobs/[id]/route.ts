import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = getServiceClient()

  const { data, error } = await sb
    .from('fb_reconciliation_jobs')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })

  let downloadUrl: string | null = null
  if (data.status === 'done' && data.result_file_path) {
    const { data: signed } = await sb.storage
      .from('fb-reconciliation-files')
      .createSignedUrl(data.result_file_path, 3600)
    downloadUrl = signed?.signedUrl ?? null
  }

  return NextResponse.json({ ...data, downloadUrl })
}
