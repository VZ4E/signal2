const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const app = express()
app.use(express.json())

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY
const TRANSCRIPT_TOKEN = process.env.TRANSCRIPT24_TOKEN
const PERPLEXITY_KEY = process.env.PERPLEXITY_KEY
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'aj@respawnmedia.co'

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function getUser(req) {
  const auth = req.headers.authorization
  if (!auth) return null
  const token = auth.replace('Bearer ', '')
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON)
  const { data: { user } } = await sb.auth.getUser(token)
  return user
}

// ── AUTH ROUTES ──────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required.' })
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' })
  // Use admin client to create user — faster and more reliable than signUp
  const admin = adminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email, password,
    user_metadata: { name },
    email_confirm: true
  })
  if (error || !data.user) return res.status(400).json({ error: error?.message || 'Registration failed.' })
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    await admin.from('profiles').update({ role: 'admin' }).eq('id', data.user.id)
  }
  res.json({ ok: true, registered: true, user: { id: data.user.id, email: data.user.email } })
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' })
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON)
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error || !data.user) return res.status(401).json({ error: error?.message || 'Invalid credentials.' })
  res.json({ ok: true, token: data.session.access_token, user: { id: data.user.id, email: data.user.email } })
})

// ── SCAN ROUTES ───────────────────────────────────────────
app.post('/api/scan/run', async (req, res) => {
  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  const { username, range = 3 } = req.body
  if (!username) return res.status(400).json({ error: 'username required' })
  const cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9._]/g, '')

  // 1. Fetch TikTok videos
  let videos = []
  try {
    const r = await fetch(`https://tiktok-scraper7.p.rapidapi.com/user/posts?unique_id=${encodeURIComponent(cleanUsername)}&count=${range}&cursor=0`, {
      headers: { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com' }
    })
    const d = await r.json()
    const items = d?.data?.videos || d?.data?.itemList || (Array.isArray(d?.data) ? d.data : null) || d?.result || d?.videos || d?.itemList || []
    videos = Array.isArray(items) ? items.slice(0, range) : []
    if (!videos.length) return res.status(404).json({ error: `No videos found for @${cleanUsername}. Account may be private.` })
  } catch (e) {
    return res.status(502).json({ error: 'Failed to fetch TikTok videos.' })
  }

  // 2. Transcribe
  let creditsUsed = 0
  const transcripts = await Promise.all(videos.map(async (v, i) => {
    const videoId = v.video_id || v.id || v.aweme_id || v.item_id
    const title = v.title || v.desc || v.description || `Video ${i + 1}`
    let transcript = ''
    try {
      const tr = await fetch('https://api.transcript24.com/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TRANSCRIPT_TOKEN}` },
        body: JSON.stringify({ url: `https://www.tiktok.com/@${cleanUsername}/video/${videoId}` })
      })
      const td = await tr.json()
      if (td?.caption) { transcript = td.caption.map(c => c.text).join(' '); creditsUsed += td.taskCredits || 1 }
    } catch (_) {}
    if (!transcript) transcript = title + ' ' + (v.text_extra || []).map(t => t.hashtag_name).filter(Boolean).join(' ')
    return { title, videoId, transcript, views: v.play_count || 0 }
  }))

  // 3. Perplexity AI brand detection
  const combined = transcripts.map((v, i) => `[Video ${i+1}: "${v.title}"]\n${v.transcript}`).join('\n\n---\n\n')
  const prompt = `You are an expert at identifying brand deals in TikTok content. Analyze these transcripts and find ALL brand deals, sponsorships, or paid promotions.

Return ONLY a JSON array. Each object must have:
- "brands": string[] (array of brand names)
- "deal_type": "Paid Sponsorship"|"Affiliate Link"|"Product Placement"|"Brand Ambassador"|"Gifted Product"|"Discount Code"|"Unknown"
- "confidence": "high"|"medium"|"low"
- "evidence": specific quote from transcript
- "video_ref": e.g. "Video 1"

If multiple brands in same video/context, group as one entry. Return [] if nothing found. NO markdown, just JSON array.

TRANSCRIPTS:
${combined.slice(0, 8000)}`

  let deals = []
  try {
    const ai = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${PERPLEXITY_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: prompt }], max_tokens: 2000, temperature: 0.1 })
    })
    const aid = await ai.json()
    const raw = aid?.choices?.[0]?.message?.content || '[]'
    deals = JSON.parse(raw.replace(/```json|```/g, '').trim())
  } catch (_) { deals = [] }

  // 4. Save to DB
  await adminClient().from('scans').insert({ user_id: user.id, username: cleanUsername, range, video_count: videos.length, credits_used: creditsUsed, deals })

  res.json({ username: cleanUsername, videos, deals, creditsUsed })
})

app.get('/api/scan/history', async (req, res) => {
  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  const { data } = await adminClient().from('scans').select('id,username,range,video_count,credits_used,deals,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100)
  res.json({ scans: data || [] })
})

app.delete('/api/scan/history', async (req, res) => {
  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  await adminClient().from('scans').delete().eq('user_id', user.id)
  res.json({ ok: true })
})

app.get('/api/credits/balance', async (req, res) => {
  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  const { data: scans } = await adminClient().from('scans').select('credits_used').eq('user_id', user.id)
  const creditsUsed = (scans || []).reduce((a, s) => a + (s.credits_used || 0), 0)
  res.json({ creditsUsed, balance: 100 })
})

app.get('/api/admin/users', async (req, res) => {
  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  const { data: profile } = await adminClient().from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
  const { data: profiles } = await adminClient().from('profiles').select('id,email,name,role,created_at').order('created_at', { ascending: false })
  const { data: scanStats } = await adminClient().from('scans').select('user_id,credits_used,deals')
  const statsMap = {}
  for (const s of (scanStats || [])) {
    if (!statsMap[s.user_id]) statsMap[s.user_id] = { scans: 0, credits: 0, deals: 0 }
    statsMap[s.user_id].scans++
    statsMap[s.user_id].credits += s.credits_used || 0
    statsMap[s.user_id].deals += Array.isArray(s.deals) ? s.deals.length : 0
  }
  res.json({ users: (profiles || []).map(p => ({ ...p, stats: statsMap[p.id] || { scans: 0, credits: 0, deals: 0 } })) })
})

app.patch('/api/admin/users', async (req, res) => {
  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  const { data: profile } = await adminClient().from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
  const { targetId, role } = req.body
  await adminClient().from('profiles').update({ role }).eq('id', targetId)
  res.json({ ok: true })
})

app.delete('/api/admin/users', async (req, res) => {
  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  const { data: profile } = await adminClient().from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
  const { targetId } = req.body
  await adminClient().auth.admin.deleteUser(targetId)
  res.json({ ok: true })
})

// ── HTML PAGES ────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;500;600;700;800&display=swap');
:root{--bg:#07080d;--sidebar:#0c0d14;--surface:#10111a;--surface2:#161722;--border:#1e2030;--border2:#252740;--accent:#5AA0E8;--accent-dim:rgba(90,160,232,0.12);--purple:#8b5cf6;--green:#10b981;--green-dim:rgba(16,185,129,0.12);--amber:#f59e0b;--amber-dim:rgba(245,158,11,0.12);--red:#ef4444;--red-dim:rgba(239,68,68,0.12);--text:#e8eaf6;--text2:#9496b0;--text3:#5a5c78;--mono:'DM Mono',monospace;--sans:'Outfit',sans-serif;}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:var(--sans);}
.sidebar{width:220px;flex-shrink:0;background:var(--sidebar);border-right:1px solid var(--border);display:flex;flex-direction:column;height:100vh;position:fixed;left:0;top:0;z-index:100;}
.sidebar-logo{padding:20px 18px 18px;border-bottom:1px solid var(--border);}
.logo-row{display:flex;align-items:center;gap:10px;}
.logo-icon{width:32px;height:32px;background:linear-gradient(135deg,var(--accent),var(--purple));border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;}
.logo-name{font-size:15px;font-weight:800;letter-spacing:-0.3px;}
.logo-tag{font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:1.5px;text-transform:uppercase;margin-top:2px;}
.sidebar-nav{flex:1;padding:10px 8px;overflow-y:auto;}
.nav-sec{font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:2px;text-transform:uppercase;padding:10px 10px 5px;}
.nav-item{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:8px;cursor:pointer;transition:all 0.13s;font-size:13.5px;font-weight:500;color:var(--text2);border:1px solid transparent;margin-bottom:2px;user-select:none;}
.nav-item:hover{background:var(--surface);color:var(--text);}
.nav-item.active{background:var(--accent-dim);border-color:rgba(90,160,232,0.2);color:var(--accent);}
.nav-icon{font-size:14px;width:18px;text-align:center;flex-shrink:0;}
.nav-badge{margin-left:auto;background:var(--accent-dim);color:var(--accent);font-family:var(--mono);font-size:10px;padding:1px 6px;border-radius:99px;}
.nav-admin-badge{margin-left:auto;background:rgba(245,158,11,0.15);color:var(--amber);font-family:var(--mono);font-size:9px;padding:1px 7px;border-radius:99px;}
.sidebar-footer{padding:12px 16px;border-top:1px solid var(--border);}
.sf-label{font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:2px;text-transform:uppercase;margin-bottom:7px;}
.sf-bar-wrap{background:var(--surface2);border-radius:99px;height:5px;overflow:hidden;margin-bottom:6px;}
.sf-bar-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--purple));border-radius:99px;transition:width 0.5s ease;}
.sf-row{display:flex;justify-content:space-between;}
.sf-num{font-family:var(--mono);font-size:12px;color:var(--text);font-weight:500;}
.sf-total{font-family:var(--mono);font-size:11px;color:var(--text3);}
.sidebar-user{padding:14px 16px;border-top:1px solid var(--border);}
.su-row{display:flex;align-items:center;gap:10px;}
.su-avatar{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--purple));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0;color:white;}
.su-name{font-size:13px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.su-email{font-family:var(--mono);font-size:10px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.su-logout{background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:14px;flex-shrink:0;padding:2px;transition:color 0.13s;}
.su-logout:hover{color:var(--red);}
.main{margin-left:220px;flex:1;height:100vh;overflow-y:auto;}
.topbar{height:54px;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 26px;gap:14px;position:sticky;top:0;background:var(--bg);z-index:10;}
.topbar-title{font-size:15px;font-weight:700;flex:1;}
.topbar-pill{display:flex;align-items:center;gap:7px;background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:6px 12px;font-family:var(--mono);font-size:11px;color:var(--text2);}
.dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 5px var(--green);}
.page{display:none;padding:26px;max-width:820px;}
.page.active{display:block;}
.sec-head{margin-bottom:22px;}
.sec-head h1{font-size:21px;font-weight:800;letter-spacing:-0.4px;margin-bottom:3px;}
.sec-head p{font-size:13px;color:var(--text2);}
.card{background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:20px 22px;margin-bottom:13px;}
.card-label{font-family:var(--mono);font-size:9px;color:var(--accent);letter-spacing:2px;text-transform:uppercase;margin-bottom:13px;}
input[type=text],input[type=email],input[type=password],textarea{width:100%;background:var(--surface2);border:1px solid var(--border2);border-radius:9px;color:var(--text);font-family:var(--sans);font-size:15px;padding:12px 15px;outline:none;transition:border-color 0.2s;}
input:focus,textarea:focus{border-color:var(--accent);}
input::placeholder,textarea::placeholder{color:var(--text3);}
textarea{resize:vertical;min-height:110px;font-family:var(--mono);font-size:13px;}
.at-wrap{display:flex;align-items:center;background:var(--surface2);border:1px solid var(--border2);border-radius:9px;overflow:hidden;transition:border-color 0.2s;}
.at-wrap:focus-within{border-color:var(--accent);}
.at-sym{padding:0 0 0 13px;color:var(--text3);font-size:16px;font-weight:600;flex-shrink:0;}
.at-wrap input{border:none;background:transparent;border-radius:0;padding-left:4px;}
.range-group{display:flex;gap:7px;}
.range-btn{flex:1;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;color:var(--text3);font-family:var(--mono);font-size:12px;padding:9px 0;cursor:pointer;transition:all 0.13s;text-align:center;}
.range-btn:hover{border-color:var(--accent);color:var(--text);}
.range-btn.active{background:var(--accent-dim);border-color:var(--accent);color:var(--accent);}
.scan-btn{width:100%;background:linear-gradient(135deg,var(--accent),#3b82f6);border:none;border-radius:10px;color:white;font-family:var(--sans);font-size:15px;font-weight:700;padding:14px;cursor:pointer;transition:opacity 0.13s;margin-top:5px;}
.scan-btn:hover{opacity:0.91;}
.scan-btn:disabled{opacity:0.42;cursor:not-allowed;}
.run-btn{background:linear-gradient(135deg,var(--purple),#6d28d9);border:none;border-radius:9px;color:white;font-family:var(--sans);font-size:14px;font-weight:700;padding:12px 22px;cursor:pointer;margin-top:10px;}
.run-btn:disabled{opacity:0.38;cursor:not-allowed;}
.status-bar{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 15px;display:flex;align-items:center;gap:10px;font-size:12px;color:var(--text2);font-family:var(--mono);margin-top:13px;}
.pulse{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:pulse 1.1s ease-in-out infinite;flex-shrink:0;}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.3;transform:scale(0.7)}}
.err-bar{background:var(--red-dim);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px 15px;font-size:12px;color:var(--red);font-family:var(--mono);margin-top:13px;}
.results-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;}
.results-title{font-size:15px;font-weight:700;}
.count-pill{background:var(--accent-dim);border:1px solid rgba(90,160,232,0.22);color:var(--accent);font-family:var(--mono);font-size:11px;padding:3px 10px;border-radius:99px;}
.deal-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:17px 19px;margin-bottom:9px;animation:slideUp 0.22s ease both;}
@keyframes slideUp{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:translateY(0)}}
.deal-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:7px;}
.brand-tags{display:flex;flex-wrap:wrap;gap:6px;flex:1;}
.brand-tag{display:inline-flex;align-items:center;gap:5px;background:var(--surface2);border:1px solid var(--border2);border-radius:7px;padding:4px 10px;font-size:13px;font-weight:700;}
.conf-pill{font-family:var(--mono);font-size:10px;padding:3px 9px;border-radius:99px;flex-shrink:0;}
.conf-high{background:var(--green-dim);color:var(--green);border:1px solid rgba(16,185,129,0.25);}
.conf-mid{background:var(--amber-dim);color:var(--amber);border:1px solid rgba(245,158,11,0.25);}
.conf-low{background:var(--red-dim);color:var(--red);border:1px solid rgba(239,68,68,0.25);}
.deal-type-lbl{font-family:var(--mono);font-size:10px;color:var(--text3);margin-bottom:6px;}
.deal-evidence{font-size:12px;color:var(--text2);border-left:2px solid var(--border2);padding-left:10px;line-height:1.55;font-style:italic;}
.video-list{display:flex;flex-direction:column;gap:6px;margin-top:11px;}
.video-item{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:9px 13px;display:flex;align-items:center;gap:9px;}
.v-num{font-family:var(--mono);color:var(--text3);font-size:10px;width:20px;flex-shrink:0;}
.v-title{flex:1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.v-views{font-family:var(--mono);color:var(--text3);font-size:10px;flex-shrink:0;}
.no-results{text-align:center;padding:42px;color:var(--text3);}
.no-results .ni{font-size:30px;margin-bottom:9px;}
.history-item{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 17px;margin-bottom:8px;cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;}
.history-item:hover{border-color:var(--border2);}
.hi-name{font-size:14px;font-weight:700;margin-bottom:3px;}
.hi-meta{display:flex;gap:11px;flex-wrap:wrap;font-family:var(--mono);font-size:10px;color:var(--text3);}
.hi-right{display:flex;flex-direction:column;align-items:flex-end;gap:4px;}
.hi-deals{background:var(--accent-dim);border:1px solid rgba(90,160,232,0.18);color:var(--accent);font-family:var(--mono);font-size:10px;padding:2px 9px;border-radius:99px;}
.hi-brands{font-size:11px;color:var(--text3);text-align:right;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.history-expand{background:var(--surface2);border:1px solid var(--border);border-top:none;border-radius:0 0 12px 12px;padding:14px 17px;margin-top:-8px;margin-bottom:8px;display:none;}
.history-expand.open{display:block;}
.he-row{display:flex;align-items:flex-start;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);gap:9px;}
.he-row:last-child{border-bottom:none;}
.he-brand{font-size:13px;font-weight:600;margin-bottom:2px;}
.he-type{font-family:var(--mono);font-size:10px;color:var(--text3);}
.he-evidence{font-size:11px;color:var(--text3);font-style:italic;margin-top:2px;}
.stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-bottom:20px;}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;}
.stat-lbl{font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;}
.stat-val{font-size:28px;font-weight:800;letter-spacing:-1px;}
.stat-sub{font-size:11px;color:var(--text3);margin-top:2px;}
.bml-item{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 15px;display:flex;align-items:center;gap:11px;margin-bottom:8px;}
.bml-rank{font-family:var(--mono);font-size:11px;color:var(--text3);width:20px;flex-shrink:0;}
.bml-name{font-size:14px;font-weight:700;flex:1;}
.bml-creators{font-family:var(--mono);font-size:10px;color:var(--text3);}
.bml-count{background:var(--accent-dim);border:1px solid rgba(90,160,232,0.18);color:var(--accent);font-family:var(--mono);font-size:10px;padding:2px 9px;border-radius:99px;flex-shrink:0;}
.import-textarea-wrap{position:relative;}
.import-count-float{position:absolute;top:11px;right:11px;font-family:var(--mono);font-size:10px;color:var(--accent);background:var(--accent-dim);border:1px solid rgba(90,160,232,0.2);border-radius:5px;padding:2px 7px;pointer-events:none;}
.queue-hdr{font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:2px;text-transform:uppercase;margin-bottom:9px;}
.queue-item{background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:10px 13px;margin-bottom:6px;display:flex;align-items:center;gap:9px;font-size:13px;}
.queue-item.running{border-color:rgba(90,160,232,0.4);}
.queue-item.done{border-color:rgba(16,185,129,0.3);}
.queue-item.error{border-color:rgba(239,68,68,0.3);}
.q-icon{font-size:13px;width:17px;text-align:center;flex-shrink:0;}
.q-name{font-size:13px;font-weight:600;flex:1;}
.q-status{font-family:var(--mono);font-size:10px;color:var(--text3);}
.q-pill{background:var(--accent-dim);border:1px solid rgba(90,160,232,0.18);color:var(--accent);font-family:var(--mono);font-size:10px;padding:2px 8px;border-radius:99px;flex-shrink:0;}
.spinner{width:12px;height:12px;border:2px solid var(--border2);border-top-color:var(--accent);border-radius:50%;animation:spin 0.6s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.qs-card{background:var(--surface2);border:1px solid var(--border2);border-radius:11px;padding:17px;margin-top:13px;display:none;}
.qs-card.visible{display:block;}
.qs-title{font-size:13px;font-weight:700;margin-bottom:11px;}
.qs-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;}
.qs-row:last-child{border-bottom:none;}
.qs-brand{font-weight:600;}
.qs-creators{font-family:var(--mono);font-size:10px;color:var(--text3);}
.cred-big-card{background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:22px;margin-bottom:13px;}
.cbc-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;}
.cbc-num{font-size:52px;font-weight:800;letter-spacing:-2px;line-height:1;}
.cbc-lbl{font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:1.5px;text-transform:uppercase;margin-top:4px;}
.cbc-svc{font-family:var(--mono);font-size:11px;color:var(--text2);background:var(--surface2);border:1px solid var(--border2);border-radius:7px;padding:5px 10px;}
.cbc-bar-wrap{background:var(--bg);border-radius:99px;height:6px;overflow:hidden;margin-bottom:9px;}
.cbc-bar-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--purple));border-radius:99px;transition:width 0.6s ease;}
.cbc-sub{font-size:12px;color:var(--text3);}
.uh-row{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:9px;font-size:13px;margin-bottom:7px;}
.uh-lbl{font-weight:600;margin-bottom:2px;}
.uh-date{font-family:var(--mono);font-size:10px;color:var(--text3);}
.uh-cost{font-family:var(--mono);font-size:12px;color:var(--amber);}
.admin-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px;}
.admin-stat{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;}
.admin-stat.highlight{border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.05);}
.user-table{width:100%;border-collapse:collapse;}
.user-table th{font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:1.5px;text-transform:uppercase;padding:10px 14px;text-align:left;border-bottom:1px solid var(--border);}
.user-table td{padding:12px 14px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:middle;}
.user-table tr:last-child td{border-bottom:none;}
.user-table tr:hover td{background:var(--surface2);}
.role-badge{font-family:var(--mono);font-size:9px;padding:2px 8px;border-radius:99px;}
.role-admin{background:rgba(245,158,11,0.15);color:var(--amber);border:1px solid rgba(245,158,11,0.25);}
.role-user{background:var(--accent-dim);color:var(--accent);border:1px solid rgba(90,160,232,0.2);}
.tbl-action{background:transparent;border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-family:var(--mono);font-size:10px;padding:3px 9px;cursor:pointer;transition:all 0.13s;}
.tbl-action:hover{border-color:var(--red);color:var(--red);}
.tbl-promote{border-color:rgba(90,160,232,0.3);color:var(--accent);}
.empty-state{text-align:center;padding:44px 20px;color:var(--text3);font-family:var(--mono);font-size:12px;border:1px dashed var(--border2);border-radius:12px;}
.empty-state .ei{font-size:26px;margin-bottom:9px;}
::-webkit-scrollbar{width:4px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px;}
/* Login page */
body.login-page{display:flex;align-items:center;justify-content:center;}
body.login-page::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(90,160,232,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(90,160,232,0.025) 1px,transparent 1px);background-size:44px 44px;pointer-events:none;z-index:0;}
.login-box{position:relative;z-index:1;background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:40px 44px;width:420px;box-shadow:0 40px 80px rgba(0,0,0,0.6);}
.login-logo{display:flex;align-items:center;gap:12px;margin-bottom:32px;}
.login-logo-icon{width:40px;height:40px;background:linear-gradient(135deg,var(--accent),var(--purple));border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;}
.login-logo-name{font-size:20px;font-weight:800;letter-spacing:-0.4px;}
.login-logo-tag{font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:1.5px;text-transform:uppercase;margin-top:2px;}
.tabs{display:flex;background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:3px;margin-bottom:24px;}
.tab{flex:1;background:transparent;border:none;color:var(--text3);font-family:var(--sans);font-size:13px;font-weight:600;padding:8px;border-radius:7px;cursor:pointer;transition:all 0.13s;}
.tab.active{background:var(--surface);color:var(--text);border:1px solid var(--border);}
.field{margin-bottom:16px;}
label{display:block;font-family:var(--mono);font-size:9px;color:var(--accent);letter-spacing:2px;text-transform:uppercase;margin-bottom:7px;}
.btn{width:100%;background:linear-gradient(135deg,var(--accent),#3b82f6);border:none;border-radius:10px;color:white;font-family:var(--sans);font-size:15px;font-weight:700;padding:14px;cursor:pointer;transition:opacity 0.13s;margin-top:6px;}
.btn:hover{opacity:0.91;}
.btn:disabled{opacity:0.42;cursor:not-allowed;}
.msg{border-radius:8px;padding:10px 14px;font-size:12px;font-family:var(--mono);margin-bottom:14px;display:none;}
.msg.show{display:block;}
.msg.err{background:var(--red-dim);border:1px solid rgba(239,68,68,0.3);color:var(--red);}
.msg.ok{background:var(--green-dim);border:1px solid rgba(16,185,129,0.3);color:var(--green);}
`

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Respawn Signal</title>
<style>${CSS}</style>
</head>
<body class="login-page">
<div class="login-box">
  <div class="login-logo">
    <div class="login-logo-icon">⚡</div>
    <div><div class="login-logo-name">Respawn Signal</div><div class="login-logo-tag">Brand Deal Scanner</div></div>
  </div>
  <div class="tabs">
    <button class="tab active" id="tab-login" onclick="switchTab('login')">Sign In</button>
    <button class="tab" id="tab-reg" onclick="switchTab('register')">Register</button>
  </div>
  <div id="msg" class="msg"></div>
  <div id="form-login">
    <div class="field"><label>Email</label><input type="email" id="l-email" placeholder="you@example.com"></div>
    <div class="field"><label>Password</label><input type="password" id="l-pass" placeholder="••••••••"></div>
    <button class="btn" id="l-btn" onclick="doLogin()">Sign In →</button>
  </div>
  <div id="form-reg" style="display:none">
    <div class="field"><label>Full Name</label><input type="text" id="r-name" placeholder="Your name"></div>
    <div class="field"><label>Email</label><input type="email" id="r-email" placeholder="you@example.com"></div>
    <div class="field"><label>Password</label><input type="password" id="r-pass" placeholder="Min 6 characters"></div>
    <button class="btn" id="r-btn" onclick="doRegister()">Create Account →</button>
  </div>
</div>
<script>
if (localStorage.getItem('rs_token')) location.href = '/dashboard';
function switchTab(t) {
  document.getElementById('tab-login').classList.toggle('active', t==='login');
  document.getElementById('tab-reg').classList.toggle('active', t==='register');
  document.getElementById('form-login').style.display = t==='login'?'block':'none';
  document.getElementById('form-reg').style.display = t==='register'?'block':'none';
  hideMsg();
}
function showMsg(msg, type) { const el=document.getElementById('msg'); el.textContent=msg; el.className='msg show '+type; }
function hideMsg() { document.getElementById('msg').classList.remove('show'); }
async function doLogin() {
  const email=document.getElementById('l-email').value.trim();
  const pass=document.getElementById('l-pass').value;
  if(!email||!pass){showMsg('Email and password required.','err');return;}
  const btn=document.getElementById('l-btn'); btn.disabled=true; btn.textContent='Signing in...';
  try {
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pass})});
    const d=await r.json();
    if(!r.ok){showMsg(d.error||'Login failed.','err');btn.disabled=false;btn.textContent='Sign In →';return;}
    localStorage.setItem('rs_token',d.token); localStorage.setItem('rs_email',email);
    location.href='/dashboard';
  } catch(e){showMsg('Network error.','err');btn.disabled=false;btn.textContent='Sign In →';}
}
async function doRegister() {
  const name=document.getElementById('r-name').value.trim();
  const email=document.getElementById('r-email').value.trim();
  const pass=document.getElementById('r-pass').value;
  if(!name||!email||!pass){showMsg('All fields required.','err');return;}
  if(pass.length<6){showMsg('Password must be at least 6 characters.','err');return;}
  const btn=document.getElementById('r-btn'); btn.disabled=true; btn.textContent='Creating account...';
  try {
    const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password:pass})});
    const d=await r.json();
    if(!r.ok){showMsg(d.error||'Registration failed.','err');btn.disabled=false;btn.textContent='Create Account →';return;}
    localStorage.setItem('rs_token',d.token); localStorage.setItem('rs_email',email);
    showMsg('Account created! Redirecting...','ok');
    setTimeout(()=>location.href='/dashboard',800);
  } catch(e){showMsg('Network error.','err');btn.disabled=false;btn.textContent='Create Account →';}
}
document.addEventListener('keydown',e=>{if(e.key==='Enter'){const lv=document.getElementById('form-login').style.display!=='none';if(lv)doLogin();else doRegister();}});
</script>
</body></html>`

function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Respawn Signal</title>
<style>${CSS}
body{display:flex;}
#app{display:flex;width:100%;height:100vh;overflow:hidden;}
</style>
</head>
<body>
<div id="app">
  <aside class="sidebar">
    <div class="sidebar-logo"><div class="logo-row"><div class="logo-icon">⚡</div><div><div class="logo-name">Respawn Signal</div><div class="logo-tag">Brand Scanner</div></div></div></div>
    <nav class="sidebar-nav">
      <div class="nav-sec">Main</div>
      <div class="nav-item active" onclick="navTo('scan',this)"><span class="nav-icon">🔍</span>Scanner</div>
      <div class="nav-item" onclick="navTo('history',this)"><span class="nav-icon">⏱</span>Scan History<span class="nav-badge" id="nb-history">0</span></div>
      <div class="nav-item" onclick="navTo('deals',this)"><span class="nav-icon">🏷</span>All Deals<span class="nav-badge" id="nb-deals">0</span></div>
      <div class="nav-sec" style="margin-top:6px">Tools</div>
      <div class="nav-item" onclick="navTo('automation',this)"><span class="nav-icon">⚙️</span>Automation</div>
      <div class="nav-item" onclick="navTo('credits',this)"><span class="nav-icon">🪙</span>Credits</div>
      <div id="admin-nav" style="display:none">
        <div class="nav-sec" style="margin-top:6px">Admin</div>
        <div class="nav-item" onclick="navTo('admin',this)"><span class="nav-icon">👑</span>Dashboard<span class="nav-admin-badge">ADMIN</span></div>
      </div>
    </nav>
    <div class="sidebar-footer">
      <div class="sf-label">Transcript Credits</div>
      <div class="sf-bar-wrap"><div class="sf-bar-fill" id="sb-bar" style="width:100%"></div></div>
      <div class="sf-row"><span class="sf-num" id="sb-num">— left</span><span class="sf-total" id="sb-total"></span></div>
    </div>
    <div class="sidebar-user">
      <div class="su-row">
        <div class="su-avatar" id="su-av">AJ</div>
        <div style="flex:1;min-width:0"><div class="su-name" id="su-name">Loading</div><div class="su-email" id="su-email"></div></div>
        <button class="su-logout" onclick="doLogout()" title="Sign out">⎋</button>
      </div>
    </div>
  </aside>
  <div class="main">
    <div class="topbar"><div class="topbar-title" id="topbar-title">Scanner</div><div class="topbar-pill"><div class="dot"></div><span id="topbar-cred">Loading...</span></div></div>
    <!-- SCANNER -->
    <div class="page active" id="page-scan">
      <div class="sec-head"><h1>Scan a Creator</h1><p>Fetch videos, transcribe them, and detect brand deals automatically.</p></div>
      <div class="card"><div class="card-label">TikTok Username</div><div class="at-wrap"><span class="at-sym">@</span><input type="text" id="username-input" placeholder="cracklyy" onkeydown="if(event.key==='Enter')startScan()"></div></div>
      <div class="card">
        <div class="card-label">Scan Range</div>
        <div class="range-group">
          <button class="range-btn active" onclick="setRange(3,this)">Last 3</button>
          <button class="range-btn" onclick="setRange(14,this)">Last 14</button>
          <button class="range-btn" onclick="setRange(30,this)">Last 30</button>
        </div>
        <p style="font-size:11px;color:var(--text3);margin-top:9px;font-family:var(--mono)">~1–2 transcript credits per video</p>
      </div>
      <button class="scan-btn" id="scan-btn" onclick="startScan()">⚡ Scan for Brand Deals</button>
      <div id="scan-results"></div>
    </div>
    <!-- HISTORY -->
    <div class="page" id="page-history">
      <div class="sec-head"><h1>Scan History</h1><p>Your past scans — click a row to expand.</p></div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:14px"><button onclick="clearHistory()" style="background:transparent;border:1px solid rgba(239,68,68,0.3);border-radius:7px;color:var(--red);font-family:var(--mono);font-size:10px;padding:5px 12px;cursor:pointer">Clear All</button></div>
      <div id="history-list"><div class="empty-state"><div class="ei">⏱</div>No scans yet</div></div>
    </div>
    <!-- ALL DEALS -->
    <div class="page" id="page-deals">
      <div class="sec-head"><h1>All Deals</h1><p>Every brand detected, ranked by frequency.</p></div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-lbl">Unique Brands</div><div class="stat-val" id="stat-brands">0</div><div class="stat-sub">detected</div></div>
        <div class="stat-card"><div class="stat-lbl">Creators Scanned</div><div class="stat-val" id="stat-scans">0</div><div class="stat-sub">total scans</div></div>
        <div class="stat-card"><div class="stat-lbl">Deal Posts</div><div class="stat-val" id="stat-posts">0</div><div class="stat-sub">sponsored posts</div></div>
      </div>
      <div id="brand-master-list"><div class="empty-state"><div class="ei">🏷</div>No deals yet</div></div>
    </div>
    <!-- AUTOMATION -->
    <div class="page" id="page-automation">
      <div class="sec-head"><h1>Automation</h1><p>Bulk scan multiple creators in one queue.</p></div>
      <div class="card">
        <div class="card-label">Import List — one username per line</div>
        <div class="import-textarea-wrap"><textarea id="import-textarea" rows="7" placeholder="cracklyy&#10;foxman1x&#10;bellapoarch" oninput="updateImportCount()"></textarea><div class="import-count-float" id="import-count"></div></div>
        <div style="margin-top:14px">
          <div class="card-label" style="margin-bottom:9px">Scan Range</div>
          <div class="range-group">
            <button class="range-btn active" id="ar3" onclick="setAutoRange(3,this)">Last 3</button>
            <button class="range-btn" id="ar14" onclick="setAutoRange(14,this)">Last 14</button>
            <button class="range-btn" id="ar30" onclick="setAutoRange(30,this)">Last 30</button>
          </div>
        </div>
        <button class="run-btn" id="import-run-btn" onclick="runImportList()">⚡ Scan All Creators</button>
      </div>
      <div id="import-queue" style="display:none">
        <div class="queue-hdr">Queue Progress</div>
        <div id="queue-items"></div>
        <div class="qs-card" id="queue-summary"><div class="qs-title">🏷 Brands Found</div><div id="qs-brands"></div></div>
      </div>
    </div>
    <!-- CREDITS -->
    <div class="page" id="page-credits">
      <div class="sec-head"><h1>Credits</h1><p>Transcript24 usage.</p></div>
      <div class="cred-big-card">
        <div class="cbc-header"><div><div class="cbc-num" id="cbc-num">—</div><div class="cbc-lbl">Credits Remaining</div></div><div class="cbc-svc">Transcript24</div></div>
        <div class="cbc-bar-wrap"><div class="cbc-bar-fill" id="cbc-bar" style="width:0%"></div></div>
        <div class="cbc-sub" id="cbc-sub">Loading...</div>
      </div>
      <div class="card"><div class="card-label">Usage Per Scan</div><div id="usage-history"></div></div>
    </div>
    <!-- ADMIN -->
    <div class="page" id="page-admin">
      <div class="sec-head"><h1>Admin Dashboard</h1><p>Platform-wide stats and user management.</p></div>
      <div class="admin-stats">
        <div class="admin-stat highlight"><div class="stat-lbl">Total Users</div><div class="stat-val" id="adm-users">0</div></div>
        <div class="admin-stat"><div class="stat-lbl">Total Scans</div><div class="stat-val" id="adm-scans">0</div></div>
        <div class="admin-stat"><div class="stat-lbl">Total Brands</div><div class="stat-val" id="adm-brands">0</div></div>
        <div class="admin-stat"><div class="stat-lbl">Credits Used</div><div class="stat-val" id="adm-credits">0</div></div>
      </div>
      <div class="card"><div class="card-label">User Management</div><div style="overflow-x:auto"><table class="user-table"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Scans</th><th>Credits</th><th>Joined</th><th>Actions</th></tr></thead><tbody id="user-table-body"></tbody></table></div></div>
    </div>
  </div>
</div>
<script>
const TOKEN = localStorage.getItem('rs_token');
const EMAIL = localStorage.getItem('rs_email') || '';
if (!TOKEN) location.href = '/login';

const CREDIT_BASELINE = 100;
let scanRange = 3, autoRange = 3, scanHistory = [], isAdmin = false;

function api(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'}, opts.headers||{});
  return fetch(url, opts);
}

async function init() {
  document.getElementById('su-email').textContent = EMAIL;
  document.getElementById('su-name').textContent = EMAIL.split('@')[0];
  document.getElementById('su-av').textContent = EMAIL.slice(0,2).toUpperCase();
  await loadHistory();
  await loadCredits();
  // Check if admin
  try {
    const r = await api('/api/admin/users');
    if (r.ok) { isAdmin = true; document.getElementById('admin-nav').style.display = 'block'; }
  } catch(_) {}
}

const PAGE_TITLES = {scan:'Scanner',history:'Scan History',deals:'All Deals',automation:'Automation',credits:'Credits',admin:'Admin Dashboard'};
function navTo(id, el) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  if(el) el.classList.add('active');
  document.getElementById('topbar-title').textContent = PAGE_TITLES[id]||id;
  if(id==='history') renderHistory();
  if(id==='deals') renderDealsPage();
  if(id==='credits') renderCreditsPage();
  if(id==='admin') renderAdminPage();
}

function setRange(n,el) { scanRange=n; el.closest('.range-group').querySelectorAll('.range-btn').forEach(b=>b.classList.remove('active')); el.classList.add('active'); }
function setAutoRange(n,el) { autoRange=n; ['ar3','ar14','ar30'].forEach(i=>document.getElementById(i).classList.remove('active')); el.classList.add('active'); }

function setStatus(msg) { document.getElementById('scan-results').innerHTML='<div class="status-bar"><div class="pulse"></div>'+msg+'</div>'; }
function setError(msg) { document.getElementById('scan-results').innerHTML='<div class="err-bar">⚠ '+msg+'</div>'; }

async function startScan() {
  const username = document.getElementById('username-input').value.trim().replace('@','');
  if (!username) { setError('Enter a TikTok username.'); return; }
  const btn = document.getElementById('scan-btn'); btn.disabled=true;
  setStatus('Scanning @'+username+'...');
  try {
    const r = await api('/api/scan/run', {method:'POST', body:JSON.stringify({username, range:scanRange})});
    const d = await r.json();
    if (!r.ok) { setError(d.error||'Scan failed.'); btn.disabled=false; return; }
    renderDeals(d.deals, d.videos, d.username);
    await loadHistory();
  } catch(e) { setError(e.message||'Something went wrong.'); }
  btn.disabled=false;
}

function fmtNum(n) { if(!n)return'0'; if(n>=1e6)return(n/1e6).toFixed(1)+'M'; if(n>=1e3)return(n/1e3).toFixed(1)+'K'; return String(n); }

function renderDeals(deals, videos, username) {
  const r = document.getElementById('scan-results');
  const listHtml = '<div class="card" style="margin-bottom:13px"><div class="card-label">Fetched — @'+username+'</div><div class="video-list">'+(videos||[]).map((v,i)=>'<div class="video-item"><span class="v-num">'+String(i+1).padStart(2,'0')+'</span><span class="v-title">'+(v.title||v.desc||'Untitled').slice(0,58)+'</span><span class="v-views">'+fmtNum(v.play_count||0)+'</span></div>').join('')+'</div></div>';
  if(!deals||!deals.length){r.innerHTML=listHtml+'<div class="no-results"><div class="ni">🔍</div><div>No brand deals detected</div></div>';return;}
  const norm=deals.map(d=>({...d,brands:d.brands?.length?d.brands:(d.brand?[d.brand]:['Unknown'])}));
  const total=norm.reduce((a,d)=>a+d.brands.length,0);
  const html=norm.map((d,i)=>{
    const cc=d.confidence==='high'?'conf-high':d.confidence==='medium'?'conf-mid':'conf-low';
    return '<div class="deal-card" style="animation-delay:'+i*0.05+'s"><div class="deal-top"><div style="flex:1"><div class="brand-tags">'+d.brands.map(b=>'<span class="brand-tag">🏷 '+b+'</span>').join('')+'</div></div><div class="conf-pill '+cc+'">'+d.confidence+'</div></div><div class="deal-type-lbl">'+(d.deal_type||'Sponsorship')+(d.video_ref?' · '+d.video_ref:'')+'</div>'+(d.evidence?'<div class="deal-evidence">"'+d.evidence+'"</div>':'')+'</div>';
  }).join('');
  r.innerHTML=listHtml+'<div class="results-hdr"><div class="results-title">Deals Found</div><div class="count-pill">'+norm.length+' post'+(norm.length!==1?'s':'')+' · '+total+' brand'+(total!==1?'s':'')+'</div></div>'+html;
}

async function loadHistory() {
  try { const r=await api('/api/scan/history'); const d=await r.json(); scanHistory=d.scans||[]; } catch(_){scanHistory=[];}
  updateBadges(); updateCreditsUI();
}

async function clearHistory() {
  if(!confirm('Clear all scan history?'))return;
  await api('/api/scan/history',{method:'DELETE'});
  scanHistory=[]; renderHistory(); updateBadges();
}

function toggleExpand(id){const el=document.getElementById('he-'+id);if(el)el.classList.toggle('open');}

function renderHistory() {
  const c=document.getElementById('history-list');
  if(!scanHistory.length){c.innerHTML='<div class="empty-state"><div class="ei">⏱</div>No scans yet</div>';return;}
  c.innerHTML=scanHistory.map(e=>{
    const d=new Date(e.created_at);
    const ds=d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    const deals=e.deals||[];
    const brands=[...new Set(deals.flatMap(d=>d.brands||(d.brand?[d.brand]:[])).filter(Boolean))];
    const preview=brands.slice(0,3).join(', ')+(brands.length>3?' +'+(brands.length-3):'');
    const dealsHtml=!deals.length?'<div style="font-size:12px;color:var(--text3);padding:7px 0">No deals found</div>':deals.map(d=>{
      const bs=(d.brands||(d.brand?[d.brand]:['?'])).join(', ');
      const cc=d.confidence==='high'?'conf-high':d.confidence==='medium'?'conf-mid':'conf-low';
      return '<div class="he-row"><div style="flex:1"><div class="he-brand">🏷 '+bs+'</div><div class="he-type">'+(d.deal_type||'')+(d.video_ref?' · '+d.video_ref:'')+'</div>'+(d.evidence?'<div class="he-evidence">"'+d.evidence.slice(0,85)+(d.evidence.length>85?'...':'')+'"</div>':'')+'</div><div class="conf-pill '+cc+'" style="margin-top:0">'+d.confidence+'</div></div>';
    }).join('');
    return '<div class="history-item" onclick="toggleExpand(\''+e.id+'\')"><div><div class="hi-name">@'+e.username+'</div><div class="hi-meta"><span>📅 '+ds+'</span>'+(e.range?'<span>Last '+e.range+'</span>':'')+(e.video_count?'<span>'+e.video_count+' videos</span>':'')+(e.credits_used?'<span>🪙 '+e.credits_used+'</span>':'')+'</div></div><div class="hi-right"><div class="hi-deals">'+deals.length+' deal'+(deals.length!==1?'s':'')+'</div>'+(preview?'<div class="hi-brands">'+preview+'</div>':'')+'</div></div><div class="history-expand" id="he-'+e.id+'">'+dealsHtml+'</div>';
  }).join('');
}

function renderDealsPage() {
  const brandMap={};let posts=0;
  scanHistory.forEach(e=>{(e.deals||[]).forEach(d=>{posts++;(d.brands||(d.brand?[d.brand]:[])).forEach(b=>{if(!b)return;if(!brandMap[b])brandMap[b]={count:0,creators:new Set()};brandMap[b].count++;brandMap[b].creators.add(e.username);});});});
  document.getElementById('stat-brands').textContent=Object.keys(brandMap).length;
  document.getElementById('stat-scans').textContent=scanHistory.length;
  document.getElementById('stat-posts').textContent=posts;
  document.getElementById('nb-deals').textContent=Object.keys(brandMap).length;
  const sorted=Object.entries(brandMap).sort((a,b)=>b[1].count-a[1].count);
  const el=document.getElementById('brand-master-list');
  if(!sorted.length){el.innerHTML='<div class="empty-state"><div class="ei">🏷</div>No deals yet</div>';return;}
  el.innerHTML=sorted.map(([brand,info],i)=>'<div class="bml-item"><div class="bml-rank">'+String(i+1).padStart(2,'0')+'</div><div class="bml-name">🏷 '+brand+'</div><div class="bml-creators">'+[...info.creators].map(c=>'@'+c).join(', ')+'</div><div class="bml-count">'+info.count+' post'+(info.count!==1?'s':'')+'</div></div>').join('');
}

async function loadCredits() {
  try {
    const r=await api('/api/credits/balance'); const d=await r.json();
    const used=d.creditsUsed||0; const rem=Math.max(0,CREDIT_BASELINE-used);
    document.getElementById('sb-num').textContent=rem+' left';
    document.getElementById('sb-total').textContent='/ '+CREDIT_BASELINE;
    document.getElementById('sb-bar').style.width=Math.min(100,(rem/CREDIT_BASELINE)*100)+'%';
    document.getElementById('topbar-cred').textContent=rem+' credits';
  } catch(_){document.getElementById('topbar-cred').textContent='— credits';}
}

function updateCreditsUI() {
  const used=scanHistory.reduce((a,e)=>a+(e.credits_used||0),0);
  const rem=Math.max(0,CREDIT_BASELINE-used);
  document.getElementById('sb-num').textContent=rem+' left';
  document.getElementById('sb-total').textContent='/ '+CREDIT_BASELINE;
  document.getElementById('sb-bar').style.width=Math.min(100,(rem/CREDIT_BASELINE)*100)+'%';
  document.getElementById('topbar-cred').textContent=rem+' credits';
}

async function renderCreditsPage() {
  await loadCredits();
  const el=document.getElementById('usage-history');
  if(!scanHistory.length){el.innerHTML='<div class="empty-state" style="border:none;padding:14px"><div class="ei">🪙</div>No scans yet</div>';return;}
  el.innerHTML=scanHistory.filter(e=>e.video_count).slice(0,20).map(e=>{
    const dt=new Date(e.created_at);
    const ds=dt.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+dt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    return '<div class="uh-row"><div><div class="uh-lbl">@'+e.username+'</div><div class="uh-date">'+ds+'</div></div><div class="uh-cost">~'+e.credits_used+' credits</div></div>';
  }).join('');
}

async function renderAdminPage() {
  try {
    const r=await api('/api/admin/users'); const d=await r.json(); const users=d.users||[];
    document.getElementById('adm-users').textContent=users.length;
    document.getElementById('adm-scans').textContent=users.reduce((a,u)=>a+u.stats.scans,0);
    document.getElementById('adm-brands').textContent=users.reduce((a,u)=>a+u.stats.deals,0);
    document.getElementById('adm-credits').textContent=users.reduce((a,u)=>a+u.stats.credits,0);
    const tbody=document.getElementById('user-table-body');
    tbody.innerHTML=users.map(u=>{
      const joined=new Date(u.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
      const isMe=u.email===EMAIL;
      const roleBadge=u.role==='admin'?'<span class="role-badge role-admin">ADMIN</span>':'<span class="role-badge role-user">USER</span>';
      const actions=isMe?'<span style="font-size:10px;color:var(--text3)">YOU</span>':'<button class="tbl-action tbl-promote" onclick="promoteUser(\''+u.id+'\',\''+u.role+'\')">↑ Promote</button> <button class="tbl-action" onclick="deleteUser(\''+u.id+'\')">✕ Remove</button>';
      return '<tr><td>'+u.name+'</td><td style="font-family:var(--mono);font-size:12px;color:var(--text2)">'+u.email+'</td><td>'+roleBadge+'</td><td style="font-family:var(--mono);font-size:12px">'+u.stats.scans+'</td><td style="font-family:var(--mono);font-size:12px;color:var(--amber)">'+u.stats.credits+'</td><td style="font-family:var(--mono);font-size:11px;color:var(--text3)">'+joined+'</td><td>'+actions+'</td></tr>';
    }).join('');
  } catch(e){console.error(e);}
}

async function promoteUser(id,role) {
  if(!confirm('Change role to '+(role==='admin'?'user':'admin')+'?'))return;
  await api('/api/admin/users',{method:'PATCH',body:JSON.stringify({targetId:id,role:role==='admin'?'user':'admin'})});
  renderAdminPage();
}

async function deleteUser(id) {
  if(!confirm('Remove this user?'))return;
  await api('/api/admin/users',{method:'DELETE',body:JSON.stringify({targetId:id})});
  renderAdminPage();
}

function updateImportCount() {
  const n=document.getElementById('import-textarea').value.split('\\n').map(l=>l.trim().replace(/^@/,'')).filter(Boolean).length;
  document.getElementById('import-count').textContent=n||'';
}

async function runImportList() {
  const usernames=document.getElementById('import-textarea').value.split('\\n').map(l=>l.trim().replace(/^@/,'')).filter(Boolean);
  if(!usernames.length)return;
  const btn=document.getElementById('import-run-btn'); btn.disabled=true;
  document.getElementById('import-queue').style.display='block';
  document.getElementById('queue-summary').classList.remove('visible');
  document.getElementById('queue-items').innerHTML=usernames.map((u,i)=>'<div class="queue-item" id="qi-'+i+'"><div class="q-icon" id="qi-icon-'+i+'">⏳</div><div class="q-name">@'+u+'</div><div class="q-status" id="qi-st-'+i+'">Waiting...</div></div>').join('');
  const allDeals={};
  for(let i=0;i<usernames.length;i++){
    const u=usernames[i];
    document.getElementById('qi-'+i).classList.add('running');
    document.getElementById('qi-icon-'+i).innerHTML='<div class="spinner"></div>';
    try {
      const r=await api('/api/scan/run',{method:'POST',body:JSON.stringify({username:u,range:autoRange})});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||'Failed');
      d.deals.forEach(deal=>{(deal.brands||(deal.brand?[deal.brand]:[])).forEach(b=>{if(!b)return;if(!allDeals[b])allDeals[b]=[];if(!allDeals[b].includes(u))allDeals[b].push(u);});});
      document.getElementById('qi-'+i).classList.remove('running'); document.getElementById('qi-'+i).classList.add('done');
      document.getElementById('qi-icon-'+i).textContent='✅';
      document.getElementById('qi-st-'+i).textContent=d.deals.length?d.deals.length+' deals':'No deals';
    } catch(err){
      document.getElementById('qi-'+i).classList.remove('running'); document.getElementById('qi-'+i).classList.add('error');
      document.getElementById('qi-icon-'+i).textContent='❌'; document.getElementById('qi-st-'+i).textContent=(err.message||'Failed').slice(0,36);
    }
  }
  if(Object.keys(allDeals).length){
    document.getElementById('qs-brands').innerHTML=Object.entries(allDeals).sort((a,b)=>b[1].length-a[1].length).map(([brand,creators])=>'<div class="qs-row"><div class="qs-brand">🏷 '+brand+'</div><div class="qs-creators">'+creators.map(c=>'@'+c).join(', ')+'</div></div>').join('');
    document.getElementById('queue-summary').classList.add('visible');
  }
  await loadHistory(); btn.disabled=false;
}

function updateBadges() {
  document.getElementById('nb-history').textContent=scanHistory.length;
  const total=new Set(scanHistory.flatMap(e=>(e.deals||[]).flatMap(d=>d.brands||(d.brand?[d.brand]:[])).filter(Boolean))).size;
  document.getElementById('nb-deals').textContent=total;
}

function doLogout() { localStorage.removeItem('rs_token'); localStorage.removeItem('rs_email'); location.href='/login'; }

init();
</script>
</body></html>`
}

// ── PAGE ROUTES ───────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/login'))
app.get('/login', (req, res) => res.send(LOGIN_HTML))
app.get('/dashboard', (req, res) => res.send(dashboardHTML()))

// ── START ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Respawn Signal running on port ${PORT}`))
module.exports = app
