import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!auth) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const token = auth.replace('Bearer ', '')
  return NextResponse.json({ token })
}
