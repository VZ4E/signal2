import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { name, email, password } = await req.json()
  if (!name || !email || !password) return NextResponse.json({ error: 'All fields required.' }, { status: 400 })
  if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })

  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } })
  if (error || !data.user) return NextResponse.json({ error: error?.message || 'Registration failed.' }, { status: 400 })

  if (email.toLowerCase() === (process.env.ADMIN_EMAIL || 'aj@respawnmedia.co').toLowerCase()) {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    await admin.from('profiles').update({ role: 'admin' }).eq('id', data.user.id)
  }

  const { data: session } = await supabase.auth.signInWithPassword({ email, password })
  return NextResponse.json({ ok: true, token: session?.session?.access_token, user: { id: data.user.id, email: data.user.email } })
}
