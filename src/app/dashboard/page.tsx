'use client';
import { useEffect } from 'react';
 
export default function DashboardPage() {
  useEffect(() => {
    const TOKEN = localStorage.getItem('rs_token');
    const EMAIL = localStorage.getItem('rs_email') || '';
    if (!TOKEN) { window.location.href = '/login'; return; }
 
    const CREDIT_BASELINE = 100;
    let scanRange = 3, autoRange = 3, scanHistory = [], isAdmin = false;
 
    async function apiFetch(url, opts) {
      opts = opts || {};
      opts.headers = Object.assign({ 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, opts.headers || {});
      return fetch(url, opts);
    }
 
    async function init() {
      document.getElementById('su-email').textContent = EMAIL;
      document.getElementById('su-name').textContent = EMAIL.split('@')[0];
      document.getElementById('su-avatar').textContent = EMAIL.slice(0,2).toUpperCase();
      document.getElementById('app-loading').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      await loadHistory();
      await loadCredits();
      try {
        const r = await apiFetch('/api/admin/users');
        if (r.ok) {
          isAdmin = true;
          document.getElementById('admin-nav-section').style.display = 'block';
        }
      } catch(_) {}
      setupNav();
      setupScan();
      setupAutomation();
      document.getElementById('su-logout').onclick = doLogout;
      document.getElementById('clear-history-btn').onclick = clearHistory;
    }
 
    function setupNav() {
      const pages = { scan:'Scanner', history:'Scan History', deals:'All Deals', automation:'Automation', credits:'Credits', admin:'Admin Dashboard' };
      Object.keys(pages).forEach(id => {
        const el = document.getElementById('nav-' + id);
        if (el) el.onclick = () => navTo(id);
      });
    }
 
    function navTo(id) {
      document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = ''; });
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      const page = document.getElementById('page-' + id);
      if (page) { page.classList.add('active'); page.style.display = 'block'; }
      const nav = document.getElementById('nav-' + id);
      if (nav) nav.classList.add('active');
      const titles = { scan:'Scanner', history:'Scan History', deals:'All Deals', automation:'Automation', credits:'Credits', admin:'Admin Dashboard' };
      document.getElementById('topbar-title').textContent = titles[id] || id;
      if (id === 'history') renderHistory();
      if (id === 'deals') renderDealsPage();
      if (id === 'credits') renderCreditsPage();
      if (id === 'admin') renderAdminPage();
    }
 
    function setupScan() {
      ['rb3','rb14','rb30'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.onclick = function() {
          scanRange = parseInt(this.textContent.replace('Last ',''));
          document.querySelectorAll('.range-group')[0].querySelectorAll('.range-btn').forEach(b=>b.classList.remove('active'));
          this.classList.add('active');
        };
      });
      const scanBtn = document.getElementById('scan-btn');
      if (scanBtn) scanBtn.onclick = startScan;
      const input = document.getElementById('username-input');
      if (input) input.addEventListener('keydown', e => { if(e.key==='Enter') startScan(); });
    }
 
    function setupAutomation() {
      ['ar3','ar14','ar30'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.onclick = function() {
          autoRange = parseInt(this.textContent.replace('Last ',''));
          ['ar3','ar14','ar30'].forEach(i => document.getElementById(i).classList.remove('active'));
          this.classList.add('active');
        };
      });
      const ta = document.getElementById('import-textarea');
      if (ta) ta.oninput = updateImportCount;
      const runBtn = document.getElementById('import-run-btn');
      if (runBtn) runBtn.onclick = runImportList;
    }
 
    function setStatus(msg) { document.getElementById('scan-results').innerHTML = '<div class="status-bar"><div class="pulse"></div>'+msg+'</div>'; }
    function setError(msg) { document.getElementById('scan-results').innerHTML = '<div class="err-bar">⚠ '+msg+'</div>'; }
 
    async function startScan() {
      const username = document.getElementById('username-input').value.trim().replace('@','');
      if (!username) { setError('Enter a TikTok username.'); return; }
      const btn = document.getElementById('scan-btn'); btn.disabled = true;
      setStatus('Scanning @' + username + '...');
      try {
        const r = await apiFetch('/api/scan/run', { method:'POST', body: JSON.stringify({ username, range: scanRange }) });
        const d = await r.json();
        if (!r.ok) { setError(d.error || 'Scan failed.'); btn.disabled = false; return; }
        renderDeals(d.deals, d.videos, d.username);
        await loadHistory();
      } catch(e) { setError(e.message || 'Something went wrong.'); }
      btn.disabled = false;
    }
 
    function fmtNum(n) {
      if (!n) return '0';
      if (n>=1e6) return (n/1e6).toFixed(1)+'M';
      if (n>=1e3) return (n/1e3).toFixed(1)+'K';
      return String(n);
    }
 
    function renderDeals(deals, videos, username) {
      const r = document.getElementById('scan-results');
      const listHtml = '<div class="card" style="margin-bottom:13px"><div class="card-label">Fetched — @'+username+'</div><div class="video-list">'+
        (videos||[]).map((v,i)=>'<div class="video-item"><span class="v-num">'+String(i+1).padStart(2,'0')+'</span><span class="v-title">'+(v.title||v.desc||'Untitled').slice(0,58)+'</span><span class="v-views">'+fmtNum(v.play_count||0)+'</span></div>').join('')+
        '</div></div>';
      if (!deals||!deals.length) { r.innerHTML=listHtml+'<div class="no-results"><div class="ni">🔍</div><div>No brand deals detected</div></div>'; return; }
      const norm = deals.map(d=>({...d, brands: d.brands&&d.brands.length?d.brands:(d.brand?[d.brand]:['Unknown'])}));
      const total = norm.reduce((a,d)=>a+d.brands.length,0);
      const html = norm.map((d,i)=>{
        const cc = d.confidence==='high'?'conf-high':d.confidence==='medium'?'conf-mid':'conf-low';
        return '<div class="deal-card" style="animation-delay:'+i*0.05+'s">'
          +'<div class="deal-top"><div style="flex:1"><div class="brand-tags">'+d.brands.map(b=>'<span class="brand-tag">🏷 '+b+'</span>').join('')+'</div></div><div class="conf-pill '+cc+'">'+d.confidence+'</div></div>'
          +'<div class="deal-type-lbl">'+(d.deal_type||'Sponsorship')+(d.video_ref?' · '+d.video_ref:'')+'</div>'
          +(d.evidence?'<div class="deal-evidence">'+d.evidence+'</div>':'')
          +'</div>';
      }).join('');
      r.innerHTML = listHtml+'<div class="results-hdr"><div class="results-title">Deals Found</div><div class="count-pill">'+norm.length+' post'+(norm.length!==1?'s':'')+' · '+total+' brand'+(total!==1?'s':'')+'</div></div>'+html;
    }
 
    async function loadHistory() {
      try {
        const r = await apiFetch('/api/scan/history');
        const d = await r.json();
        scanHistory = d.scans || [];
      } catch(_) { scanHistory = []; }
      updateBadges();
      updateCreditsUI();
    }
 
    async function clearHistory() {
      if (!confirm('Clear all scan history?')) return;
      await apiFetch('/api/scan/history', { method: 'DELETE' });
      scanHistory = [];
      renderHistory(); updateBadges();
    }
 
    function toggleExpand(id) {
      const el = document.getElementById('he-'+id);
      if (el) el.classList.toggle('open');
    }
 
    function renderHistory() {
      const c = document.getElementById('history-list');
      if (!scanHistory.length) { c.innerHTML='<div class="empty-state"><div class="ei">⏱</div>No scans yet</div>'; return; }
      c.innerHTML = scanHistory.map(e => {
        const d = new Date(e.created_at);
        const ds = d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
        const deals = e.deals||[];
        const brands = [...new Set(deals.flatMap(d=>d.brands||(d.brand?[d.brand]:[])).filter(Boolean))];
        const preview = brands.slice(0,3).join(', ')+(brands.length>3?' +'+(brands.length-3):'');
        const dealsHtml = !deals.length
          ? '<div style="font-size:12px;color:var(--text3);padding:7px 0">No deals found</div>'
          : deals.map(d=>{
              const bs=(d.brands||(d.brand?[d.brand]:['?'])).join(', ');
              const cc=d.confidence==='high'?'conf-high':d.confidence==='medium'?'conf-mid':'conf-low';
              return '<div class="he-row"><div style="flex:1"><div class="he-brand">🏷 '+bs+'</div><div class="he-type">'+(d.deal_type||'')+(d.video_ref?' · '+d.video_ref:'')+'</div>'+(d.evidence?'<div class="he-evidence">'+d.evidence.slice(0,85)+(d.evidence.length>85?'...':'')+'</div>':'')+'</div><div class="conf-pill '+cc+'" style="margin-top:0">'+d.confidence+'</div></div>';
            }).join('');
        return '<div class="history-item" data-id="'+e.id+'" onclick="toggleExpand(this.dataset.id)">'
          +'<div><div class="hi-name">@'+e.username+'</div><div class="hi-meta"><span>📅 '+ds+'</span>'+(e.range?'<span>Last '+e.range+'</span>':'')+(e.video_count?'<span>'+e.video_count+' videos</span>':'')+(e.credits_used?'<span>🪙 '+e.credits_used+'</span>':'')+'</div></div>'
          +'<div class="hi-right"><div class="hi-deals">'+deals.length+' deal'+(deals.length!==1?'s':'')+'</div>'+(preview?'<div class="hi-brands">'+preview+'</div>':'')+'</div></div>'
          +'<div class="history-expand" id="he-'+e.id+'">'+dealsHtml+'</div>';
      }).join('');
 
      // Re-attach toggleExpand to history items since they're in innerHTML (can't use inline onclick with CSP)
      document.querySelectorAll('.history-item').forEach(item => {
        item.onclick = () => toggleExpand(item.dataset.id);
      });
    }
 
    function renderDealsPage() {
      const brandMap = {};
      let posts = 0;
      scanHistory.forEach(e => {
        (e.deals||[]).forEach(d => {
          posts++;
          (d.brands||(d.brand?[d.brand]:[])).forEach(b => {
            if (!b) return;
            if (!brandMap[b]) brandMap[b] = { count:0, creators:new Set() };
            brandMap[b].count++; brandMap[b].creators.add(e.username);
          });
        });
      });
      document.getElementById('stat-brands').textContent = Object.keys(brandMap).length;
      document.getElementById('stat-scans').textContent = scanHistory.length;
      document.getElementById('stat-posts').textContent = posts;
      document.getElementById('nb-deals').textContent = Object.keys(brandMap).length;
      const sorted = Object.entries(brandMap).sort((a,b)=>b[1].count-a[1].count);
      const el = document.getElementById('brand-master-list');
      if (!sorted.length) { el.innerHTML='<div class="empty-state"><div class="ei">🏷</div>No deals yet</div>'; return; }
      el.innerHTML = sorted.map(([brand,info],i)=>'<div class="bml-item"><div class="bml-rank">'+String(i+1).padStart(2,'0')+'</div><div class="bml-name">🏷 '+brand+'</div><div class="bml-creators">'+[...info.creators].map(c=>'@'+c).join(', ')+'</div><div class="bml-count">'+info.count+' post'+(info.count!==1?'s':'')+'</div></div>').join('');
    }
 
    async function loadCredits() {
      try {
        const r = await apiFetch('/api/credits/balance');
        const d = await r.json();
        const used = d.creditsUsed || 0;
        const rem = Math.max(0, CREDIT_BASELINE - used);
        document.getElementById('sb-num').textContent = rem + ' left';
        document.getElementById('sb-total').textContent = '/ ' + CREDIT_BASELINE;
        document.getElementById('sb-bar').style.width = Math.min(100,(rem/CREDIT_BASELINE)*100) + '%';
        document.getElementById('topbar-cred').textContent = rem + ' credits';
      } catch(_) { document.getElementById('topbar-cred').textContent = '— credits'; }
    }
 
    function updateCreditsUI() {
      const used = scanHistory.reduce((a,e)=>a+(e.credits_used||0),0);
      const rem = Math.max(0, CREDIT_BASELINE - used);
      document.getElementById('sb-num').textContent = rem + ' left';
      document.getElementById('sb-total').textContent = '/ ' + CREDIT_BASELINE;
      document.getElementById('sb-bar').style.width = Math.min(100,(rem/CREDIT_BASELINE)*100) + '%';
      document.getElementById('topbar-cred').textContent = rem + ' credits';
    }
 
    async function renderCreditsPage() {
      try {
        const r = await apiFetch('/api/credits/balance');
        const d = await r.json();
        const used = d.creditsUsed || 0;
        const rem = Math.max(0, CREDIT_BASELINE - used);
        document.getElementById('cbc-num').textContent = rem;
        document.getElementById('cbc-bar').style.width = Math.min(100,(rem/CREDIT_BASELINE)*100) + '%';
        document.getElementById('cbc-sub').textContent = used + ' used · ' + rem + ' remaining';
      } catch(_) {}
      const el = document.getElementById('usage-history');
      if (!scanHistory.length) { el.innerHTML='<div class="empty-state" style="border:none;padding:14px"><div class="ei">🪙</div>No scans yet</div>'; return; }
      el.innerHTML = scanHistory.filter(e=>e.video_count).slice(0,20).map(e=>{
        const dt=new Date(e.created_at);
        const ds=dt.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+dt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
        return '<div class="uh-row"><div><div class="uh-lbl">@'+e.username+'</div><div class="uh-date">'+ds+'</div></div><div class="uh-cost">~'+e.credits_used+' credits</div></div>';
      }).join('');
    }
 
    async function renderAdminPage() {
      try {
        const r = await apiFetch('/api/admin/users');
        const d = await r.json();
        const users = d.users || [];
        document.getElementById('adm-users').textContent = users.length;
        document.getElementById('adm-scans').textContent = users.reduce((a,u)=>a+u.stats.scans,0);
        document.getElementById('adm-brands').textContent = users.reduce((a,u)=>a+u.stats.deals,0);
        document.getElementById('adm-credits').textContent = users.reduce((a,u)=>a+u.stats.credits,0);
        const tbody = document.getElementById('user-table-body');
        tbody.innerHTML = users.map(u=>{
          const joined = new Date(u.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
          const isMe = u.email === EMAIL;
          const roleBadge = u.role==='admin'?'<span class="role-badge role-admin">ADMIN</span>':'<span class="role-badge role-user">USER</span>';
          const actions = isMe
            ? '<span style="font-size:10px;color:var(--text3)">YOU</span>'
            : '<button class="tbl-action tbl-promote" data-id="'+u.id+'" data-role="'+u.role+'">↑ Promote</button> <button class="tbl-action" data-id="'+u.id+'">✕ Remove</button>';
          return '<tr><td>'+u.name+'</td><td style="font-family:var(--mono);font-size:12px;color:var(--text2)">'+u.email+'</td><td>'+roleBadge+'</td><td style="font-family:var(--mono);font-size:12px">'+u.stats.scans+'</td><td style="font-family:var(--mono);font-size:12px;color:var(--amber)">'+u.stats.credits+'</td><td style="font-family:var(--mono);font-size:11px;color:var(--text3)">'+joined+'</td><td>'+actions+'</td></tr>';
        }).join('');
        // Attach admin button handlers after innerHTML set
        tbody.querySelectorAll('.tbl-promote').forEach(btn => {
          btn.onclick = () => promoteUser(btn.dataset.id, btn.dataset.role);
        });
        tbody.querySelectorAll('.tbl-action:not(.tbl-promote)').forEach(btn => {
          btn.onclick = () => deleteUser(btn.dataset.id);
        });
      } catch(e) { console.error(e); }
    }
 
    async function promoteUser(id, role) {
      const newRole = role==='admin'?'user':'admin';
      if (!confirm('Change role to '+newRole+'?')) return;
      await apiFetch('/api/admin/users', { method:'PATCH', body: JSON.stringify({targetId:id,role:newRole}) });
      renderAdminPage();
    }
 
    async function deleteUser(id) {
      if (!confirm('Remove this user?')) return;
      await apiFetch('/api/admin/users', { method:'DELETE', body: JSON.stringify({targetId:id}) });
      renderAdminPage();
    }
 
    function updateImportCount() {
      const n = document.getElementById('import-textarea').value.split('\n').map(l=>l.trim().replace(/^@/,'')).filter(Boolean).length;
      document.getElementById('import-count').textContent = n||'';
    }
 
    async function runImportList() {
      const usernames = document.getElementById('import-textarea').value.split('\n').map(l=>l.trim().replace(/^@/,'')).filter(Boolean);
      if (!usernames.length) return;
      const btn = document.getElementById('import-run-btn'); btn.disabled = true;
      document.getElementById('import-queue').style.display = 'block';
      document.getElementById('queue-summary').classList.remove('visible');
      document.getElementById('queue-items').innerHTML = usernames.map((u,i)=>'<div class="queue-item" id="qi-'+i+'"><div class="q-icon" id="qi-icon-'+i+'">⏳</div><div class="q-name">@'+u+'</div><div class="q-status" id="qi-st-'+i+'">Waiting...</div></div>').join('');
      const allDeals = {};
      for (let i=0;i<usernames.length;i++) {
        const u = usernames[i];
        document.getElementById('qi-'+i).classList.add('running');
        document.getElementById('qi-icon-'+i).innerHTML = '<div class="spinner"></div>';
        try {
          const r = await apiFetch('/api/scan/run', { method:'POST', body: JSON.stringify({username:u,range:autoRange}) });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error||'Failed');
          d.deals.forEach(deal=>{(deal.brands||(deal.brand?[deal.brand]:[])).forEach(b=>{if(!b)return;if(!allDeals[b])allDeals[b]=[];if(!allDeals[b].includes(u))allDeals[b].push(u);});});
          document.getElementById('qi-'+i).classList.remove('running');
          document.getElementById('qi-'+i).classList.add('done');
          document.getElementById('qi-icon-'+i).textContent='✅';
          document.getElementById('qi-st-'+i).textContent = d.deals.length ? d.deals.length+' deals' : 'No deals';
        } catch(err) {
          document.getElementById('qi-'+i).classList.remove('running');
          document.getElementById('qi-'+i).classList.add('error');
          document.getElementById('qi-icon-'+i).textContent='❌';
          document.getElementById('qi-st-'+i).textContent=(err.message||'Failed').slice(0,36);
        }
      }
      if (Object.keys(allDeals).length) {
        document.getElementById('qs-brands').innerHTML = Object.entries(allDeals).sort((a,b)=>b[1].length-a[1].length).map(([brand,creators])=>'<div class="qs-row"><div class="qs-brand">🏷 '+brand+'</div><div class="qs-creators">'+creators.map(c=>'@'+c).join(', ')+'</div></div>').join('');
        document.getElementById('queue-summary').classList.add('visible');
      }
      await loadHistory(); btn.disabled = false;
    }
 
    function updateBadges() {
      document.getElementById('nb-history').textContent = scanHistory.length;
      const total = new Set(scanHistory.flatMap(e=>(e.deals||[]).flatMap(d=>d.brands||(d.brand?[d.brand]:[])).filter(Boolean))).size;
      document.getElementById('nb-deals').textContent = total;
    }
 
    async function doLogout() {
      localStorage.removeItem('rs_token');
      localStorage.removeItem('rs_email');
      window.location.href = '/login';
    }
 
    init();
  }, []);
 
  return (
    <>
      <link rel="stylesheet" href="/globals.css" />
      <div id="app-loading" style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontFamily:'monospace',color:'#5a5c78',fontSize:'13px'}}>
        Loading...
      </div>
      <div id="app" style={{display:'none',width:'100%',height:'100vh',overflow:'hidden',flexDirection:'row'}} className="app-flex">
        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-row">
              <div className="logo-icon">⚡</div>
              <div><div className="logo-name">Respawn Signal</div><div className="logo-tag">Brand Scanner</div></div>
            </div>
          </div>
          <nav className="sidebar-nav">
            <div className="nav-sec">Main</div>
            <div className="nav-item active" id="nav-scan"><span className="nav-icon">🔍</span>Scanner</div>
            <div className="nav-item" id="nav-history"><span className="nav-icon">⏱</span>Scan History<span className="nav-badge" id="nb-history">0</span></div>
            <div className="nav-item" id="nav-deals"><span className="nav-icon">🏷</span>All Deals<span className="nav-badge" id="nb-deals">0</span></div>
            <div className="nav-sec" style={{marginTop:6}}>Tools</div>
            <div className="nav-item" id="nav-automation"><span className="nav-icon">⚙️</span>Automation</div>
            <div className="nav-item" id="nav-credits"><span className="nav-icon">🪙</span>Credits</div>
            <div id="admin-nav-section" style={{display:'none'}}>
              <div className="nav-sec" style={{marginTop:6}}>Admin</div>
              <div className="nav-item" id="nav-admin"><span className="nav-icon">👑</span>Dashboard<span className="nav-admin-badge">ADMIN</span></div>
            </div>
          </nav>
          <div className="sidebar-footer">
            <div className="sf-label">Transcript Credits</div>
            <div className="sf-bar-wrap"><div className="sf-bar-fill" id="sb-bar" style={{width:'100%'}}></div></div>
            <div className="sf-row"><span className="sf-num" id="sb-num">— left</span><span className="sf-total" id="sb-total"></span></div>
          </div>
          <div className="sidebar-user">
            <div className="su-row">
              <div className="su-avatar" id="su-avatar">AJ</div>
              <div style={{flex:1,minWidth:0}}>
                <div className="su-name" id="su-name">Loading...</div>
                <div className="su-email" id="su-email"></div>
              </div>
              <button className="su-logout" id="su-logout" title="Sign out">⎋</button>
            </div>
          </div>
        </aside>
 
        {/* MAIN */}
        <div className="main">
          <div className="topbar">
            <div className="topbar-title" id="topbar-title">Scanner</div>
            <div className="topbar-pill"><div className="dot"></div><span id="topbar-cred">Loading...</span></div>
          </div>
 
          {/* SCANNER */}
          <div className="page active" id="page-scan">
            <div className="sec-head"><h1>Scan a Creator</h1><p>Fetch videos, transcribe them, and detect brand deals automatically.</p></div>
            <div className="card">
              <div className="card-label">TikTok Username</div>
              <div className="at-wrap"><span className="at-sym">@</span><input type="text" id="username-input" placeholder="cracklyy" /></div>
            </div>
            <div className="card">
              <div className="card-label">Scan Range</div>
              <div className="range-group">
                <button className="range-btn active" id="rb3">Last 3</button>
                <button className="range-btn" id="rb14">Last 14</button>
                <button className="range-btn" id="rb30">Last 30</button>
              </div>
              <p style={{fontSize:11,color:'var(--text3)',marginTop:9,fontFamily:'var(--mono)'}}>~1-2 transcript credits per video</p>
            </div>
            <button className="scan-btn" id="scan-btn">⚡ Scan for Brand Deals</button>
            <div id="scan-results"></div>
          </div>
 
          {/* HISTORY */}
          <div className="page" id="page-history">
            <div className="sec-head"><h1>Scan History</h1><p>Your past scans — click a row to expand.</p></div>
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:14}}>
              <button id="clear-history-btn" style={{background:'transparent',border:'1px solid rgba(239,68,68,0.3)',borderRadius:7,color:'var(--red)',fontFamily:'var(--mono)',fontSize:10,padding:'5px 12px',cursor:'pointer'}}>Clear All</button>
            </div>
            <div id="history-list"><div className="empty-state"><div className="ei">⏱</div>No scans yet</div></div>
          </div>
 
          {/* ALL DEALS */}
          <div className="page" id="page-deals">
            <div className="sec-head"><h1>All Deals</h1><p>Every brand detected, ranked by frequency.</p></div>
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-lbl">Unique Brands</div><div className="stat-val" id="stat-brands">0</div><div className="stat-sub">detected</div></div>
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
                <textarea id="import-textarea" rows={7} placeholder={"cracklyy\nfoxman1x\nbellapoarch"}></textarea>
                <div className="import-count-float" id="import-count"></div>
              </div>
              <div style={{marginTop:14}}>
                <div className="card-label" style={{marginBottom:9}}>Scan Range</div>
                <div className="range-group">
                  <button className="range-btn active" id="ar3">Last 3</button>
                  <button className="range-btn" id="ar14">Last 14</button>
                  <button className="range-btn" id="ar30">Last 30</button>
                </div>
              </div>
              <button className="run-btn" id="import-run-btn">⚡ Scan All Creators</button>
            </div>
            <div id="import-queue" style={{display:'none'}}>
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
              <div className="cbc-bar-wrap"><div className="cbc-bar-fill" id="cbc-bar" style={{width:'0%'}}></div></div>
              <div className="cbc-sub" id="cbc-sub">Fetching balance...</div>
            </div>
            <div className="card"><div className="card-label">Usage Per Scan</div><div id="usage-history"></div></div>
          </div>
 
          {/* ADMIN */}
          <div className="page" id="page-admin" style={{display:'none'}}>
            <div className="sec-head"><h1>Admin Dashboard</h1><p>Platform-wide stats and user management.</p></div>
            <div className="admin-stats">
              <div className="admin-stat highlight"><div className="stat-lbl">Total Users</div><div className="stat-val" id="adm-users">0</div></div>
              <div className="admin-stat"><div className="stat-lbl">Total Scans</div><div className="stat-val" id="adm-scans">0</div></div>
              <div className="admin-stat"><div className="stat-lbl">Total Brands</div><div className="stat-val" id="adm-brands">0</div></div>
              <div className="admin-stat"><div className="stat-lbl">Credits Used</div><div className="stat-val" id="adm-credits">0</div></div>
            </div>
            <div className="card">
              <div className="card-label">User Management</div>
              <div style={{overflowX:'auto'}}>
                <table className="user-table">
                  <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Scans</th><th>Credits</th><th>Joined</th><th>Actions</th></tr></thead>
                  <tbody id="user-table-body"></tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
