// src/app/api/auth/register/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { createBrowserClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'aj@respawnmedia.co'

export async function POST(req: NextRequest) {
  const { name, email, password } = await req.json()
  if (!name || !email || !password) return NextResponse.json({ error: 'All fields required.' }, { status: 400 })
  if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })

  const cookieStore = cookies()
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) => {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
          catch (_) {}
        }
      }
    }
  )

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } }
  })

  if (error || !data.user) {
    return NextResponse.json({ error: error?.message || 'Registration failed.' }, { status: 400 })
  }

  // If this is the admin email, immediately set their role
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    const adminClient = createServerClient()
    await adminClient.from('profiles').update({ role: 'admin' }).eq('id', data.user.id)
  }

  return NextResponse.json({ ok: true, user: { id: data.user.id, email: data.user.email } })
}
