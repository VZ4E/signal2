// src/app/api/credits/balance/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch real balance from Transcript24
  let balance = null
  try {
    const resp = await fetch('https://api.transcript24.com/balance', {
      headers: { 'Authorization': `Bearer ${process.env.TRANSCRIPT24_TOKEN}` }
    })
    const data = await resp.json()
    balance = data?.credits ?? data?.balance ?? null
  } catch (_) {}

  // Get credits used by this user from DB
  const { data: scans } = await supabase
    .from('scans')
    .select('credits_used')
    .eq('user_id', user.id)

  const creditsUsed = (scans || []).reduce((sum, s) => sum + (s.credits_used || 0), 0)

  return NextResponse.json({ balance, creditsUsed })
}
