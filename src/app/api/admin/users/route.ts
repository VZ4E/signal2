// src/app/api/admin/users/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()

  // Verify caller is authenticated
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (error || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

  // Verify caller is admin
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Fetch all profiles + their scan stats
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, name, role, created_at')
    .order('created_at', { ascending: false })

  // Get scan counts and credit totals per user
  const { data: scanStats } = await supabase
    .from('scans')
    .select('user_id, credits_used, deals')

  const statsMap: Record<string, { scans: number; credits: number; deals: number }> = {}
  for (const s of (scanStats || [])) {
    if (!statsMap[s.user_id]) statsMap[s.user_id] = { scans: 0, credits: 0, deals: 0 }
    statsMap[s.user_id].scans++
    statsMap[s.user_id].credits += s.credits_used || 0
    statsMap[s.user_id].deals  += Array.isArray(s.deals) ? s.deals.length : 0
  }

  const usersWithStats = (profiles || []).map(p => ({
    ...p,
    stats: statsMap[p.id] || { scans: 0, credits: 0, deals: 0 }
  }))

  return NextResponse.json({ users: usersWithStats })
}

export async function PATCH(req: NextRequest) {
  // Promote/demote user role
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { targetId, role } = await req.json()
  await supabase.from('profiles').update({ role }).eq('id', targetId)

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { targetId } = await req.json()
  // Deleting from auth.users cascades to profiles and scans
  await supabase.auth.admin.deleteUser(targetId)

  return NextResponse.json({ ok: true })
}
