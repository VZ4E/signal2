// src/app/dashboard/page.tsx
// This page is protected by middleware — only authenticated users reach here
// It serves the full Respawn Signal UI, with API calls going to /api/* routes
import { cookies } from 'next/headers'
import { createServerClient as createSupabaseServerClient } from '@supabase/ssr'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  // Get current user server-side for initial render
  const cookieStore = cookies()
  const supabase = createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, role')
    .eq('id', user.id)
    .single()

  const userName  = profile?.name || user.email?.split('@')[0] || 'User'
  const userRole  = profile?.role || 'user'
  const userEmail = user.email || ''
  const isAdmin   = userRole === 'admin'

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;500;600;700;800&display=swap');
        /* === paste the full CSS from tiktok-brand-scanner.html here === */
        /* For brevity this file references globals.css — see below */
      `}</style>
      <link rel="stylesheet" href="/globals.css" />

      {/* The full app UI — same HTML as the standalone file but auth is real */}
      <div id="app" style={{ display: 'flex', width: '100%', height: '100vh', overflow: 'hidden' }}>

        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-row">
              <div className="logo-icon">⚡</div>
              <div>
                <div className="logo-name">Respawn Signal</div>
                <div className="logo-tag">Brand Scanner</div>
              </div>
            </div>
          </div>
          <nav className="sidebar-nav">
            <div className="nav-sec">Main</div>
            <div className="nav-item active" onClick={() => (window as any).navTo('scan', event?.target)}>
              <span className="nav-icon">🔍</span>Scanner
            </div>
            <div className="nav-item" onClick={() => (window as any).navTo('history', event?.target)}>
              <span className="nav-icon">⏱</span>Scan History
              <span className="nav-badge" id="nb-history">0</span>
            </div>
            <div className="nav-item" onClick={() => (window as any).navTo('deals', event?.target)}>
              <span className="nav-icon">🏷</span>All Deals
              <span className="nav-badge" id="nb-deals">0</span>
            </div>
            <div className="nav-sec" style={{ marginTop: 6 }}>Tools</div>
            <div className="nav-item" onClick={() => (window as any).navTo('automation', event?.target)}>
              <span className="nav-icon">⚙️</span>Automation
            </div>
            <div className="nav-item" onClick={() => (window as any).navTo('credits', event?.target)}>
              <span className="nav-icon">🪙</span>Credits
            </div>
            {isAdmin && (
              <>
                <div className="nav-sec" style={{ marginTop: 6 }}>Admin</div>
                <div className="nav-item" onClick={() => (window as any).navTo('admin', event?.target)}>
                  <span className="nav-icon">👑</span>Dashboard
                  <span className="nav-admin-badge">ADMIN</span>
                </div>
              </>
            )}
          </nav>
          <div className="sidebar-footer">
            <div className="sf-label">Transcript Credits</div>
            <div className="sf-bar-wrap"><div className="sf-bar-fill" id="sb-bar" style={{ width: '100%' }}></div></div>
            <div className="sf-row">
              <span className="sf-num" id="sb-num">— left</span>
              <span className="sf-total" id="sb-total"></span>
            </div>
          </div>
          <div className="sidebar-user">
            <div className="su-row">
              <div className="su-avatar">{userName.slice(0,2).toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="su-name">{userName}</div>
                <div className="su-email">{userEmail}</div>
              </div>
              <button className="su-logout" onClick={() => (window as any).doLogout()} title="Sign out">⎋</button>
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <div className="main">
          <div className="topbar">
            <div className="topbar-title" id="topbar-title">Scanner</div>
            <div className="topbar-pill">
              <div className="dot"></div>
              <span id="topbar-cred">Loading...</span>
            </div>
          </div>

          {/* SCANNER PAGE */}
          <div className="page active" id="page-scan">
            <div className="sec-head"><h1>Scan a Creator</h1><p>Fetch videos, transcribe them, and detect brand deals automatically.</p></div>
            <div className="card">
              <div className="card-label">TikTok Username</div>
              <div className="at-wrap"><span className="at-sym">@</span><input type="text" id="username-input" placeholder="cracklyy" /></div>
            </div>
            <div className="card">
              <div className="card-label">Scan Range</div>
              <div className="range-group">
                <button className="range-btn active" onClick={(e) => (window as any).setRange(3, e.target)}>Last 3</button>
                <button className="range-btn" onClick={(e) => (window as any).setRange(14, e.target)}>Last 14</button>
                <button className="range-btn" onClick={(e) => (window as any).setRange(30, e.target)}>Last 30</button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 9, fontFamily: 'var(--mono)' }}>~1–2 transcript credits per video</p>
            </div>
            <button className="scan-btn" id="scan-btn" onClick={() => (window as any).startScan()}>⚡ Scan for Brand Deals</button>
            <div id="scan-results"></div>
          </div>

          {/* HISTORY PAGE */}
          <div className="page" id="page-history">
            <div className="sec-head"><h1>Scan History</h1><p>Your past scans — click a row to expand.</p></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <button onClick={() => (window as any).clearHistory()} style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 10, padding: '5px 12px', cursor: 'pointer' }}>Clear All</button>
            </div>
            <div id="history-list"><div className="empty-state"><div className="ei">⏱</div>No scans yet</div></div>
          </div>

          {/* ALL DEALS */}
          <div className="page" id="page-deals">
            <div className="sec-head"><h1>All Deals</h1><p>Every brand detected, ranked by frequency.</p></div>
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-lbl">Unique Brands</div><div className="stat-val" id="stat-brands">0</div><div className="stat-sub">brands detected</div></div>
              <div className="stat-card"><div className="stat-lbl">Creators Scanned</div><div className="stat-val" id="stat-scans">0</div><div className="stat-sub">total scans</div></div>
              <div className="stat-card"><div className="stat-lbl">Deal Posts</div><div className="stat-val" id="stat-posts">0</div><div className="stat-sub">sponsored posts</div></div>
            </div>
            <div id="brand-master-list"><div className="empty-state"><div className="ei">🏷</div>No deals yet</div></div>
          </div>

          {/* AUTOMATION */}
          <div className="page" id="page-automation">
            <div className="sec-head"><h1>Automation</h1><p>Bulk scan multiple creators in one queue.</p></div>
            <div className="card">
              <div className="card-label">Import List — one username per line</div>
              <div className="import-textarea-wrap">
                <textarea id="import-textarea" rows={7} placeholder={"cracklyy\nfoxman1x\nbellapoarch"} onInput={() => (window as any).updateImportCount()}></textarea>
                <div className="import-count-float" id="import-count"></div>
              </div>
              <div style={{ marginTop: 14 }}>
                <div className="card-label" style={{ marginBottom: 9 }}>Scan Range</div>
                <div className="range-group">
                  <button className="range-btn active" id="ar3" onClick={(e) => (window as any).setAutoRange(3, e.target)}>Last 3</button>
                  <button className="range-btn" id="ar14" onClick={(e) => (window as any).setAutoRange(14, e.target)}>Last 14</button>
                  <button className="range-btn" id="ar30" onClick={(e) => (window as any).setAutoRange(30, e.target)}>Last 30</button>
                </div>
              </div>
              <button className="run-btn" id="import-run-btn" onClick={() => (window as any).runImportList()}>⚡ Scan All Creators</button>
            </div>
            <div id="import-queue" style={{ display: 'none' }}>
              <div className="queue-hdr">Queue Progress</div>
              <div id="queue-items"></div>
              <div className="qs-card" id="queue-summary"><div className="qs-title">🏷 Brands Found</div><div id="qs-brands"></div></div>
            </div>
          </div>

          {/* CREDITS */}
          <div className="page" id="page-credits">
            <div className="sec-head"><h1>Credits</h1><p>Transcript24 usage.</p></div>
            <div className="cred-big-card">
              <div className="cbc-header">
                <div><div className="cbc-num" id="cbc-num">—</div><div className="cbc-lbl">Credits Remaining</div></div>
                <div className="cbc-svc">Transcript24</div>
              </div>
              <div className="cbc-bar-wrap"><div className="cbc-bar-fill" id="cbc-bar" style={{ width: '0%' }}></div></div>
              <div className="cbc-sub" id="cbc-sub">Fetching balance...</div>
            </div>
            <div className="card"><div className="card-label">Usage Per Scan</div><div id="usage-history"></div></div>
          </div>

          {/* ADMIN */}
          {isAdmin && (
            <div className="page" id="page-admin">
              <div className="sec-head"><h1>Admin Dashboard</h1><p>Platform-wide stats and user management.</p></div>
              <div className="admin-stats">
                <div className="admin-stat highlight"><div className="stat-lbl">Total Users</div><div className="stat-val" id="adm-users">0</div></div>
                <div className="admin-stat"><div className="stat-lbl">Total Scans</div><div className="stat-val" id="adm-scans">0</div></div>
                <div className="admin-stat"><div className="stat-lbl">Total Brands</div><div className="stat-val" id="adm-brands">0</div></div>
                <div className="admin-stat"><div className="stat-lbl">Credits Used</div><div className="stat-val" id="adm-credits">0</div></div>
              </div>
              <div className="card">
                <div className="card-label">User Management</div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="user-table" id="user-table">
                    <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Scans</th><th>Credits</th><th>Joined</th><th>Actions</th></tr></thead>
                    <tbody id="user-table-body"></tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Client-side script — calls /api/* routes with the user's JWT */}
      <script dangerouslySetInnerHTML={{ __html: `
        const IS_ADMIN = ${isAdmin};
        const USER_EMAIL = '${userEmail}';
        const CREDIT_BASELINE = 100;

        let scanRange = 3, autoRange = 3, scanHistory = [], creditsUsed = 0;

        // Get Supabase session token for API calls
        async function getToken() {
          const resp = await fetch('/api/auth/me');
          const data = await resp.json();
          return data.token || '';
        }

        // NAV
        const PAGE_TITLES = {scan:'Scanner',history:'Scan History',deals:'All Deals',automation:'Automation',credits:'Credits',admin:'Admin Dashboard'};
        function navTo(id, el) {
          document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
          document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
          document.getElementById('page-'+id).classList.add('active');
          if (el?.closest) el.closest('.nav-item')?.classList.add('active');
          document.getElementById('topbar-title').textContent = PAGE_TITLES[id]||id;
          if (id==='history')   renderHistory();
          if (id==='deals')     renderDealsPage();
          if (id==='credits')   renderCreditsPage();
          if (id==='admin')     renderAdminPage();
        }

        function setRange(n, el) {
          scanRange = n;
          el.closest('.range-group').querySelectorAll('.range-btn').forEach(b=>b.classList.remove('active'));
          el.classList.add('active');
        }
        function setAutoRange(n, el) {
          autoRange = n;
          ['ar3','ar14','ar30'].forEach(id=>document.getElementById(id)?.classList.remove('active'));
          el.classList.add('active');
        }

        function setStatus(msg) {
          document.getElementById('scan-results').innerHTML = '<div class="status-bar"><div class="pulse"></div>'+msg+'</div>';
        }
        function setError(msg, detail) {
          document.getElementById('scan-results').innerHTML =
            '<div class="err-bar">⚠ '+msg+(detail?'<div style="margin-top:8px;font-size:10px;opacity:0.7;word-break:break-all">'+detail+'</div>':'')+'</div>';
        }

        async function startScan() {
          const username = document.getElementById('username-input').value.trim().replace('@','');
          if (!username) { setError('Enter a TikTok username.'); return; }
          const btn = document.getElementById('scan-btn'); btn.disabled=true;
          setStatus('Scanning @'+username+'...');
          try {
            const token = await getToken();
            const resp = await fetch('/api/scan/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer '+token },
              body: JSON.stringify({ username, range: scanRange })
            });
            const data = await resp.json();
            if (!resp.ok) { setError(data.error||'Scan failed.'); btn.disabled=false; return; }

            const { videos, deals, username: cu } = data;
            const listHtml = '<div class="card" style="margin-bottom:13px"><div class="card-label">Fetched — @'+cu+'</div><div class="video-list">'+
              videos.map((v,i)=>'<div class="video-item"><span class="v-num">'+String(i+1).padStart(2,'0')+'</span><span class="v-title">'+(v.title||v.desc||'Untitled').slice(0,58)+'</span><span class="v-views">'+fmtNum(v.play_count||0)+'</span></div>').join('')+
              '</div></div>';
            renderDeals(deals, listHtml);
            loadHistory(); updateBadges();
          } catch(err) { setError(err.message||'Something went wrong.'); }
          btn.disabled=false;
        }

        function renderDeals(deals, prefix) {
          prefix = prefix||'';
          const r = document.getElementById('scan-results');
          if (!deals||!deals.length) { r.innerHTML=prefix+'<div class="no-results"><div class="ni">🔍</div><div style="font-size:14px;font-weight:600;margin-bottom:3px">No brand deals detected</div></div>'; return; }
          const norm = deals.map(d=>({...d,brands:d.brands?.length?d.brands:(d.brand?[d.brand]:['Unknown'])}));
          const totalBrands = norm.reduce((a,d)=>a+d.brands.length,0);
          const html = norm.map((d,i)=>{
            const cc=d.confidence==='high'?'conf-high':d.confidence==='medium'?'conf-mid':'conf-low';
            const grouped=d.brands.length>1;
            const tags=d.brands.map(b=>'<span class="brand-tag">🏷 '+b+'</span>').join('');
            return '<div class="deal-card" style="animation-delay:'+i*0.05+'s'+(grouped?';border-color:rgba(90,160,232,0.3)':'')+'">'+
              '<div class="deal-top"><div style="flex:1">'+(grouped?'<div class="deal-co-label">Co-Sponsored · '+d.brands.length+' brands</div>':'')+
              '<div class="brand-tags">'+tags+'</div></div><div class="conf-pill '+cc+'">'+d.confidence+'</div></div>'+
              '<div class="deal-type-lbl">'+(d.deal_type||'Sponsorship')+(d.video_ref?' · '+d.video_ref:'')+'</div>'+
              (d.evidence?'<div class="deal-evidence">"'+d.evidence+'"</div>':'')+
              '</div>';
          }).join('');
          r.innerHTML = prefix+'<div class="results-hdr"><div class="results-title">Deals Found</div><div class="count-pill">'+norm.length+' post'+(norm.length!==1?'s':'')+' · '+totalBrands+' brand'+(totalBrands!==1?'s':'')+'</div></div>'+html;
        }

        async function loadHistory() {
          try {
            const token = await getToken();
            const resp = await fetch('/api/scan/history', { headers: { 'Authorization': 'Bearer '+token } });
            const data = await resp.json();
            scanHistory = data.scans || [];
          } catch(_) { scanHistory=[]; }
          updateBadges(); updateCreditsUI();
        }

        function clearHistory() {
          if (!confirm('Clear all scan history?')) return;
          // In production: call DELETE /api/scan/history
          scanHistory=[];
          renderHistory(); updateBadges();
        }

        function toggleExpand(id) { const el=document.getElementById('he-'+id); if(el)el.classList.toggle('open'); }

        function renderHistory() {
          const c=document.getElementById('history-list');
          if (!scanHistory.length) { c.innerHTML='<div class="empty-state"><div class="ei">⏱</div>No scans yet</div>'; return; }
          c.innerHTML=scanHistory.map(e=>{
            const d=new Date(e.created_at);
            const ds=d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
            const ts=d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
            const deals=e.deals||[];
            const allB=deals.flatMap(d=>d.brands||(d.brand?[d.brand]:[])).filter(Boolean);
            const uniq=[...new Set(allB)];
            const preview=uniq.slice(0,3).join(', ')+(uniq.length>3?' +'+(uniq.length-3):'');
            const dealsHtml=!deals.length?'<div style="font-size:12px;color:var(--text3);padding:7px 0">No deals found</div>':deals.map(d=>{
              const brands=(d.brands||(d.brand?[d.brand]:['?'])).join(', ');
              const cc=d.confidence==='high'?'conf-high':d.confidence==='medium'?'conf-mid':'conf-low';
              return '<div class="he-row"><div style="flex:1"><div class="he-brand">🏷 '+brands+'</div><div class="he-type">'+(d.deal_type||'')+(d.video_ref?' · '+d.video_ref:'')+'</div>'+(d.evidence?'<div class="he-evidence">"'+d.evidence.slice(0,85)+(d.evidence.length>85?'...':'')+'"</div>':'')+'</div><div class="conf-pill '+cc+'" style="margin-top:0">'+d.confidence+'</div></div>';
            }).join('');
            return '<div class="history-item" onclick="toggleExpand('+e.id+')"><div><div class="hi-name">@'+e.username+'</div><div class="hi-meta"><span>📅 '+ds+' '+ts+'</span>'+(e.range?'<span>Last '+e.range+'</span>':'')+(e.video_count?'<span>'+e.video_count+' videos</span>':'')+(e.credits_used?'<span>🪙 '+e.credits_used+' cred.</span>':'')+'</div></div><div class="hi-right"><div class="hi-deals">'+deals.length+' deal'+(deals.length!==1?'s':'')+'</div>'+(preview?'<div class="hi-brands">'+preview+'</div>':'')+'</div></div><div class="history-expand" id="he-'+e.id+'">'+dealsHtml+'</div>';
          }).join('');
        }

        function renderDealsPage() {
          const brandMap={};
          let posts=0;
          scanHistory.forEach(e=>{
            (e.deals||[]).forEach(d=>{ posts++; (d.brands||(d.brand?[d.brand]:[])).forEach(b=>{ if(!b)return; if(!brandMap[b])brandMap[b]={count:0,creators:new Set()}; brandMap[b].count++; brandMap[b].creators.add(e.username); }); });
          });
          document.getElementById('stat-brands').textContent=Object.keys(brandMap).length;
          document.getElementById('stat-scans').textContent=scanHistory.length;
          document.getElementById('stat-posts').textContent=posts;
          document.getElementById('nb-deals').textContent=Object.keys(brandMap).length;
          const sorted=Object.entries(brandMap).sort((a,b)=>b[1].count-a[1].count);
          const el=document.getElementById('brand-master-list');
          if(!sorted.length){el.innerHTML='<div class="empty-state"><div class="ei">🏷</div>No deals yet</div>';return;}
          el.innerHTML=sorted.map(([brand,info],i)=>'<div class="bml-item"><div class="bml-rank">'+String(i+1).padStart(2,'0')+'</div><div class="bml-name">🏷 '+brand+'</div><div class="bml-creators">'+[...info.creators].map(c=>'@'+c).join(', ')+'</div><div class="bml-count">'+info.count+' post'+(info.count!==1?'s':'')+'</div></div>').join('');
        }

        async function renderCreditsPage() {
          try {
            const token = await getToken();
            const resp = await fetch('/api/credits/balance', { headers: { 'Authorization': 'Bearer '+token } });
            const data = await resp.json();
            const balance = data.balance ?? CREDIT_BASELINE;
            const used = data.creditsUsed || 0;
            const rem = Math.max(0, balance - used);
            const pct = Math.min(100, (rem/balance)*100);
            document.getElementById('cbc-num').textContent = rem;
            document.getElementById('cbc-bar').style.width = pct+'%';
            document.getElementById('cbc-sub').textContent = used+' used · '+rem+' remaining';
          } catch(_) {}
          const entries = scanHistory.filter(e=>e.video_count);
          const el = document.getElementById('usage-history');
          if (!entries.length) { el.innerHTML='<div class="empty-state" style="border:none;padding:14px"><div class="ei">🪙</div>No scans yet</div>'; return; }
          el.innerHTML=entries.slice(0,20).map(e=>{
            const dt=new Date(e.created_at);
            const ds=dt.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+dt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
            return '<div class="uh-row"><div><div class="uh-lbl">@'+e.username+'</div><div class="uh-date">'+ds+'</div></div><div class="uh-cost">~'+e.credits_used+' credits</div></div>';
          }).join('');
        }

        function updateCreditsUI() {
          const rem = Math.max(0, CREDIT_BASELINE - creditsUsed);
          const pct = Math.min(100, (rem/CREDIT_BASELINE)*100);
          document.getElementById('sb-bar').style.width = pct+'%';
          document.getElementById('sb-num').textContent = rem+' left';
          document.getElementById('sb-total').textContent = '/ '+CREDIT_BASELINE;
          document.getElementById('topbar-cred').textContent = rem+' credits';
        }

        function updateBadges() {
          document.getElementById('nb-history').textContent = scanHistory.length;
          const total = new Set(scanHistory.flatMap(e=>(e.deals||[]).flatMap(d=>d.brands||(d.brand?[d.brand]:[])).filter(Boolean))).size;
          document.getElementById('nb-deals').textContent = total;
        }

        async function renderAdminPage() {
          if (!IS_ADMIN) return;
          try {
            const token = await getToken();
            const resp = await fetch('/api/admin/users', { headers: { 'Authorization': 'Bearer '+token } });
            const data = await resp.json();
            const users = data.users || [];
            const totalScans   = users.reduce((a,u)=>a+u.stats.scans,0);
            const totalBrands  = users.reduce((a,u)=>a+u.stats.deals,0);
            const totalCredits = users.reduce((a,u)=>a+u.stats.credits,0);
            document.getElementById('adm-users').textContent   = users.length;
            document.getElementById('adm-scans').textContent   = totalScans;
            document.getElementById('adm-brands').textContent  = totalBrands;
            document.getElementById('adm-credits').textContent = totalCredits;
            const tbody = document.getElementById('user-table-body');
            if (!users.length) { tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:24px;font-size:12px">No users</td></tr>'; return; }
            tbody.innerHTML = users.map(u=>{
              const joined = new Date(u.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
              const isMe = u.email === USER_EMAIL;
              const roleBadge = u.role==='admin'?'<span class="role-badge role-admin">ADMIN</span>':'<span class="role-badge role-user">USER</span>';
              const actions = isMe?'<span style="font-family:var(--mono);font-size:10px;color:var(--text3)">YOU</span>':
                '<button class="tbl-action tbl-promote" onclick="promoteUser(\''+u.id+'\',\''+u.role+'\')" '+(u.role==='admin'?'style="display:none"':'')+'>↑ Promote</button> <button class="tbl-action" onclick="deleteUser(\''+u.id+'\')">✕ Remove</button>';
              return '<tr><td><div style="font-weight:600">'+u.name+'</div></td><td style="font-family:var(--mono);font-size:12px;color:var(--text2)">'+u.email+'</td><td>'+roleBadge+'</td><td style="font-family:var(--mono);font-size:12px">'+u.stats.scans+'</td><td style="font-family:var(--mono);font-size:12px;color:var(--amber)">'+u.stats.credits+'</td><td style="font-family:var(--mono);font-size:11px;color:var(--text3)">'+joined+'</td><td>'+actions+'</td></tr>';
            }).join('');
          } catch(e) { console.error(e); }
        }

        async function promoteUser(id, currentRole) {
          const newRole = currentRole==='admin' ? 'user' : 'admin';
          if (!confirm('Change role to '+newRole+'?')) return;
          const token = await getToken();
          await fetch('/api/admin/users', { method:'PATCH', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body:JSON.stringify({targetId:id,role:newRole}) });
          renderAdminPage();
        }

        async function deleteUser(id) {
          if (!confirm('Remove this user? This cannot be undone.')) return;
          const token = await getToken();
          await fetch('/api/admin/users', { method:'DELETE', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body:JSON.stringify({targetId:id}) });
          renderAdminPage();
        }

        function updateImportCount() {
          const n = document.getElementById('import-textarea').value.split('\\n').map(l=>l.trim().replace(/^@/,'')).filter(Boolean).length;
          document.getElementById('import-count').textContent = n||'';
        }

        async function runImportList() {
          const usernames = document.getElementById('import-textarea').value.split('\\n').map(l=>l.trim().replace(/^@/,'')).filter(Boolean);
          if (!usernames.length) return;
          const btn = document.getElementById('import-run-btn'); btn.disabled=true;
          document.getElementById('import-queue').style.display='block';
          document.getElementById('queue-summary').classList.remove('visible');
          document.getElementById('queue-items').innerHTML = usernames.map((u,i)=>'<div class="queue-item" id="qi-'+i+'"><div class="q-icon" id="qi-icon-'+i+'">⏳</div><div class="q-name">@'+u+'</div><div class="q-status" id="qi-st-'+i+'">Waiting...</div></div>').join('');
          const allDeals = {};
          for (let i=0;i<usernames.length;i++) {
            const u=usernames[i];
            const itemEl=document.getElementById('qi-'+i);
            const iconEl=document.getElementById('qi-icon-'+i);
            const statusEl=document.getElementById('qi-st-'+i);
            itemEl.classList.add('running'); iconEl.innerHTML='<div class="spinner"></div>';
            try {
              const token = await getToken();
              const resp = await fetch('/api/scan/run', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body:JSON.stringify({username:u,range:autoRange}) });
              const data = await resp.json();
              if (!resp.ok) throw new Error(data.error||'Failed');
              const { deals, username: cu } = data;
              deals.forEach(d=>{ (d.brands||(d.brand?[d.brand]:[])).forEach(b=>{ if(!b)return; if(!allDeals[b])allDeals[b]=[]; if(!allDeals[b].includes(u))allDeals[b].push(u); }); });
              itemEl.classList.remove('running'); itemEl.classList.add('done');
              iconEl.textContent='✅'; statusEl.textContent='';
              if (deals.length) { const p=document.createElement('div'); p.className='q-pill'; p.textContent=deals.length+' deal'+(deals.length!==1?'s':''); itemEl.appendChild(p); }
              else { statusEl.textContent='No deals'; }
            } catch(err) { itemEl.classList.remove('running'); itemEl.classList.add('error'); iconEl.textContent='❌'; statusEl.textContent=(err.message||'Failed').slice(0,36); }
          }
          if (Object.keys(allDeals).length) {
            document.getElementById('qs-brands').innerHTML = Object.entries(allDeals).sort((a,b)=>b[1].length-a[1].length).map(([brand,creators])=>'<div class="qs-row"><div class="qs-brand">🏷 '+brand+'</div><div class="qs-creators">'+creators.map(c=>'@'+c).join(', ')+'</div></div>').join('');
            document.getElementById('queue-summary').classList.add('visible');
          }
          loadHistory(); btn.disabled=false;
        }

        async function doLogout() {
          await fetch('/api/auth/logout', { method: 'POST' });
          window.location.href = '/login';
        }

        function fmtNum(n) {
          if (!n) return '0';
          if (n>=1e6) return (n/1e6).toFixed(1)+'M';
          if (n>=1e3) return (n/1e3).toFixed(1)+'K';
          return String(n);
        }

        // Init
        loadHistory();
        updateCreditsUI();
      `}} />
    </>
  )
}
