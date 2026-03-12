// src/lib/supabase-server.ts
// Server client (uses service role key — only used in API routes, never sent to browser)
import { createClient } from '@supabase/supabase-js'

export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // full access — server only
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
