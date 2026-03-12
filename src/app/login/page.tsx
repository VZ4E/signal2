'use client'
// src/app/login/page.tsx
// Serves the auth screen — on success redirects to /dashboard
declare function switchTab(t: string): void
declare function doLogin(): void
declare function doRegister(): void

export default function LoginPage() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;500;600;700;800&display=swap');
        :root{--bg:#07080d;--surface:#10111a;--surface2:#161722;--border:#1e2030;--border2:#252740;--accent:#5AA0E8;--accent-dim:rgba(90,160,232,0.12);--purple:#8b5cf6;--green:#10b981;--red:#ef4444;--red-dim:rgba(239,68,68,0.12);--green-dim:rgba(16,185,129,0.12);--text:#e8eaf6;--text2:#9496b0;--text3:#5a5c78;--mono:'DM Mono',monospace;--sans:'Outfit',sans-serif;}
        *{margin:0;padding:0;box-sizing:border-box;}
        html,body{height:100%;background:var(--bg);color:var(--text);font-family:var(--sans);}
        body{display:flex;align-items:center;justify-content:center;}
        body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(90,160,232,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(90,160,232,0.025) 1px,transparent 1px);background-size:44px 44px;pointer-events:none;z-index:0;}
        .box{position:relative;z-index:1;background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:40px 44px;width:420px;box-shadow:0 40px 80px rgba(0,0,0,0.6);}
        .logo{display:flex;align-items:center;gap:12px;margin-bottom:32px;}
        .logo-icon{width:40px;height:40px;background:linear-gradient(135deg,var(--accent),var(--purple));border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;}
        .logo-name{font-size:20px;font-weight:800;letter-spacing:-0.4px;}
        .logo-tag{font-family:var(--mono);font-size:9px;color:var(--text3);letter-spacing:1.5px;text-transform:uppercase;margin-top:2px;}
        .tabs{display:flex;background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:3px;margin-bottom:24px;}
        .tab{flex:1;background:transparent;border:none;color:var(--text3);font-family:var(--sans);font-size:13px;font-weight:600;padding:8px;border-radius:7px;cursor:pointer;transition:all 0.13s;}
        .tab.active{background:var(--surface);color:var(--text);border:1px solid var(--border);}
        .field{margin-bottom:16px;}
        label{display:block;font-family:var(--mono);font-size:9px;color:var(--accent);letter-spacing:2px;text-transform:uppercase;margin-bottom:7px;}
        input{width:100%;background:var(--surface2);border:1px solid var(--border2);border-radius:9px;color:var(--text);font-family:var(--sans);font-size:14px;padding:12px 15px;outline:none;transition:border-color 0.2s;}
        input:focus{border-color:var(--accent);}
        input::placeholder{color:var(--text3);}
        .btn{width:100%;background:linear-gradient(135deg,var(--accent),#3b82f6);border:none;border-radius:10px;color:white;font-family:var(--sans);font-size:15px;font-weight:700;padding:14px;cursor:pointer;transition:opacity 0.13s;margin-top:6px;position:relative;overflow:hidden;}
        .btn::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,0.1),transparent 60%);pointer-events:none;}
        .btn:hover{opacity:0.91;}
        .btn:disabled{opacity:0.42;cursor:not-allowed;}
        .err{background:var(--red-dim);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--red);font-family:var(--mono);margin-bottom:14px;display:none;}
        .err.show{display:block;}
        .ok{background:var(--green-dim);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--green);font-family:var(--mono);margin-bottom:14px;display:none;}
        .ok.show{display:block;}
      `}</style>

      <div className="box">
        <div className="logo">
          <div className="logo-icon">⚡</div>
          <div>
            <div className="logo-name">Respawn Signal</div>
            <div className="logo-tag">Brand Deal Scanner</div>
          </div>
        </div>

        <div className="tabs">
          <button className="tab active" id="tab-login" onClick={() => switchTab('login')}>Sign In</button>
          <button className="tab" id="tab-reg" onClick={() => switchTab('register')}>Register</button>
        </div>

        <div id="err" className="err"></div>
        <div id="ok" className="ok"></div>

        <div id="form-login">
          <div className="field"><label>Email</label><input type="email" id="l-email" placeholder="you@example.com" /></div>
          <div className="field"><label>Password</label><input type="password" id="l-pass" placeholder="••••••••" /></div>
          <button className="btn" id="l-btn" onClick={() => doLogin()}>Sign In →</button>
        </div>

        <div id="form-reg" style={{ display: 'none' }}>
          <div className="field"><label>Full Name</label><input type="text" id="r-name" placeholder="Your name" /></div>
          <div className="field"><label>Email</label><input type="email" id="r-email" placeholder="you@example.com" /></div>
          <div className="field"><label>Password</label><input type="password" id="r-pass" placeholder="Min 6 characters" /></div>
          <button className="btn" id="r-btn" onClick={() => doRegister()}>Create Account →</button>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        // Supabase is loaded via CDN to avoid SSR issues on this simple page
        // In production swap this for the proper Next.js Supabase client
        const SUPABASE_URL  = '${process.env.NEXT_PUBLIC_SUPABASE_URL || ""}';
        const SUPABASE_ANON = '${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""}';

        function switchTab(t) {
          document.getElementById('tab-login').classList.toggle('active', t==='login');
          document.getElementById('tab-reg').classList.toggle('active', t==='register');
          document.getElementById('form-login').style.display = t==='login' ? 'block' : 'none';
          document.getElementById('form-reg').style.display   = t==='register' ? 'block' : 'none';
          document.getElementById('err').classList.remove('show');
          document.getElementById('ok').classList.remove('show');
        }

        function showErr(msg) {
          const el = document.getElementById('err'); el.textContent=msg; el.classList.add('show');
          document.getElementById('ok').classList.remove('show');
        }
        function showOk(msg) {
          const el = document.getElementById('ok'); el.textContent=msg; el.classList.add('show');
          document.getElementById('err').classList.remove('show');
        }

        async function doLogin() {
          const email = document.getElementById('l-email').value.trim();
          const pass  = document.getElementById('l-pass').value;
          if (!email||!pass) { showErr('Email and password required.'); return; }
          const btn = document.getElementById('l-btn'); btn.disabled=true; btn.textContent='Signing in...';
          try {
            const resp = await fetch('/api/auth/login', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({email,password:pass})
            });
            const data = await resp.json();
            if (!resp.ok) { showErr(data.error||'Login failed.'); btn.disabled=false; btn.textContent='Sign In →'; return; }
            window.location.href = '/dashboard';
          } catch(e) { showErr('Network error. Try again.'); btn.disabled=false; btn.textContent='Sign In →'; }
        }

        async function doRegister() {
          const name  = document.getElementById('r-name').value.trim();
          const email = document.getElementById('r-email').value.trim();
          const pass  = document.getElementById('r-pass').value;
          if (!name||!email||!pass) { showErr('All fields required.'); return; }
          if (pass.length<6) { showErr('Password must be at least 6 characters.'); return; }
          const btn = document.getElementById('r-btn'); btn.disabled=true; btn.textContent='Creating account...';
          try {
            const resp = await fetch('/api/auth/register', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({name,email,password:pass})
            });
            const data = await resp.json();
            if (!resp.ok) { showErr(data.error||'Registration failed.'); btn.disabled=false; btn.textContent='Create Account →'; return; }
            showOk('Account created! Redirecting...');
            setTimeout(() => { window.location.href = '/dashboard'; }, 800);
          } catch(e) { showErr('Network error. Try again.'); btn.disabled=false; btn.textContent='Create Account →'; }
        }

        // Allow Enter key
        document.addEventListener('keydown', e => {
          if (e.key==='Enter') {
            const loginVisible = document.getElementById('form-login').style.display !== 'none';
            if (loginVisible) doLogin(); else doRegister();
          }
        });
      `}} />
    </>
  )
}
