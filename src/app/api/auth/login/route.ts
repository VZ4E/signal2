import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  if (!email || !password) return NextResponse.json({ error: 'Email and password required.' }, { status: 400 })

  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) return NextResponse.json({ error: error?.message || 'Invalid credentials.' }, { status: 401 })

  return NextResponse.json({ ok: true, token: data.session?.access_token, user: { id: data.user.id, email: data.user.email } })
}
