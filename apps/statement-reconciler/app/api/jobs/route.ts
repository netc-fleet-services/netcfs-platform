import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  const sb = getServiceClient()

  const { data, error } = await sb
    .from('reconciliation_jobs')
    .select('id, status, vendor_key, qb_file_count, stmt_file_count, matched_count, mismatch_count, stmt_total, qb_total, created_at, error_message')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
