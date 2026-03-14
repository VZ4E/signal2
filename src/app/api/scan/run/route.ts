// src/app/api/scan/run/route.ts
// This is the secure proxy — API keys never reach the browser
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

const RAPIDAPI_KEY     = process.env.RAPIDAPI_KEY!
const TRANSCRIPT_TOKEN = process.env.TRANSCRIPT24_TOKEN!
const PERPLEXITY_KEY   = process.env.PERPLEXITY_KEY!

export async function POST(req: NextRequest) {
  // 1. Verify the user is authenticated
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (authError || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

  const { username, range = 3 } = await req.json()
  if (!username) return NextResponse.json({ error: 'username required' }, { status: 400 })

  const cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9._]/g, '')

  // 2. Fetch TikTok videos via RapidAPI
  let videos: any[] = []
  try {
    const resp = await fetch(
      `https://tiktok-scraper7.p.rapidapi.com/user/posts?unique_id=${encodeURIComponent(cleanUsername)}&count=${range}&cursor=0`,
      { headers: { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com' } }
    )
    const data = await resp.json()
    const items =
      data?.data?.videos ||
      data?.data?.itemList ||
      (Array.isArray(data?.data) ? data.data : null) ||
      data?.result ||
      data?.videos ||
      data?.itemList ||
      (data?.data && Object.values(data.data).find((v: any) => Array.isArray(v) && v.length > 0)) ||
      []
    videos = Array.isArray(items) ? items.slice(0, range) : []
    if (!videos.length) {
      const msg = data?.message || data?.msg || data?.error || 'Account may be private.'
      return NextResponse.json({ error: `No videos found for @${cleanUsername} — ${msg}` }, { status: 404 })
    }
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch TikTok videos' }, { status: 502 })
  }

  // 3. Transcribe each video
  let creditsUsed = 0
  const videosWithTranscripts = await Promise.allSettled(
    videos.map(async (v: any, i: number) => {
      const videoId = v.video_id || v.id || v.aweme_id || v.item_id
      const title   = v.title || v.desc || v.description || `Video ${i + 1}`
      let transcript = ''
      try {
        const tr = await fetch('https://api.transcript24.com/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TRANSCRIPT_TOKEN}` },
          body: JSON.stringify({ url: `https://www.tiktok.com/@${cleanUsername}/video/${videoId}` })
        })
        const td = await tr.json()
        if (td?.caption && Array.isArray(td.caption)) {
          transcript = td.caption.map((c: any) => c.text).join(' ')
          creditsUsed += td.taskCredits || 1
        }
      } catch (_) {}
      if (!transcript) {
        transcript = v.title || v.desc || v.description || ''
        const tags = (v.text_extra || []).map((t: any) => t.hashtag_name).filter(Boolean).join(' ')
        if (tags) transcript += ' ' + tags
      }
      return { title, videoId, transcript, views: v.play_count || v.statistics?.playCount || v.statsV2?.playCount || 0 }
    })
  )
  const transcripts = videosWithTranscripts
    .filter(r => r.status === 'fulfilled')
    .map((r: any) => r.value)

  // 4. Run Perplexity AI brand detection
  const combinedText = transcripts.map((v, i) => `[Video ${i+1}: "${v.title}"]\n${v.transcript}`).join('\n\n---\n\n')
  const prompt = `You are an expert at identifying brand deals, sponsorships, and paid partnerships in social media content.

Analyze the following TikTok video transcript(s) and identify ALL brand deals, sponsorships, paid promotions, or affiliate partnerships.

CRITICAL GROUPING RULE: If multiple brands appear together in the same sentence/context within the same video, group them as ONE deal entry with all names in the "brands" array.

Return a JSON array where each object has:
- "brands": string[]
- "deal_type": "Paid Sponsorship"|"Affiliate Link"|"Product Placement"|"Brand Ambassador"|"Gifted Product"|"Discount Code"|"Unknown"
- "confidence": "high"|"medium"|"low"
- "evidence": specific quote indicating the deal
- "video_ref": e.g. "Video 1"

Return ONLY a JSON array. No markdown. Return [] if nothing found.

TRANSCRIPTS:\n${combinedText.slice(0, 8000)}`

  let deals: any[] = []
  try {
    const aiResp = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${PERPLEXITY_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: prompt }], max_tokens: 2000, temperature: 0.1 })
    })
    const aiData = await aiResp.json()
    const raw = aiData?.choices?.[0]?.message?.content || '[]'
    deals = JSON.parse(raw.replace(/```json|```/g, '').trim())
  } catch (_) { deals = [] }

  // 5. Save scan to database
  await supabase.from('scans').insert({
    user_id:      user.id,
    username:     cleanUsername,
    range,
    video_count:  videos.length,
    credits_used: creditsUsed,
    deals,
  })

  return NextResponse.json({ username: cleanUsername, videos, deals, creditsUsed })
}
