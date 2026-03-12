// src/app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient as createSupabaseClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  const cookieStore = cookies()
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
          catch (_) {}
        }
      }
    }
  )

  await supabase.auth.signOut()
  return NextResponse.json({ ok: true })
}
