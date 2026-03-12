// src/app/api/auth/me/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient as createSupabaseClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const cookieStore = cookies()
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })

  return NextResponse.json({
    token: session.access_token,
    user: { id: session.user.id, email: session.user.email }
  })
}
