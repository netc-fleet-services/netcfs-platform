import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

let client: ReturnType<typeof createClient<Database>> | null = null

export function getTypedClient(url?: string, key?: string) {
  if (client) return client
  const supabaseUrl = url ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const supabaseKey = key ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  client = createClient<Database>(supabaseUrl, supabaseKey)
  return client
}
