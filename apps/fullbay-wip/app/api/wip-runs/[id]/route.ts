import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'wip-reports'

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
    .from('wip_runs')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })

  let summaryUrl: string | null = null
  let detailUrl:  string | null = null

  if (data.status === 'done') {
    if (data.summary_file_path) {
      const { data: s } = await sb.storage.from(BUCKET).createSignedUrl(data.summary_file_path, 3600)
      summaryUrl = s?.signedUrl ?? null
    }
    if (data.detail_file_path) {
      const { data: d } = await sb.storage.from(BUCKET).createSignedUrl(data.detail_file_path, 3600)
      detailUrl = d?.signedUrl ?? null
    }
  }

  return NextResponse.json({ ...data, summaryUrl, detailUrl })
}
