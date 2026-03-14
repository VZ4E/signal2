# ⚡ Respawn Signal — Brand Deal Scanner

## Stack
- **Next.js 14** (App Router)
- **Supabase** (Auth + Postgres database)
- **Vercel** (Hosting + serverless functions)
- API keys stored server-side — never exposed to browser

---

## Deploy in 3 steps

### Step 1 — Create GitHub repo & push

```bash
# In this folder:
git init
git add .
git commit -m "init: respawn signal"

# On github.com → New repository → name it "respawn-signal" → Create
# Then:
git remote add origin https://github.com/YOUR_USERNAME/respawn-signal.git
git branch -M main
git push -u origin main
```

---

### Step 2 — Set up Supabase

1. Go to **https://supabase.com** → New project
2. Name it `respawn-signal`, set a strong DB password, pick US East region
3. Go to **SQL Editor** → paste the entire contents of `supabase-schema.sql` → Run
4. Go to **Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
5. Go to **Authentication → Providers** → make sure Email is enabled
6. Go to **Authentication → URL Configuration** → set Site URL to your Vercel URL (after deploy)

---

### Step 3 — Deploy to Vercel

1. Go to **https://vercel.com** → New Project → Import from GitHub → select `respawn-signal`
2. Framework: **Next.js** (auto-detected)
3. Add these **Environment Variables**:

```
NEXT_PUBLIC_SUPABASE_URL         = https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY    = eyJ...
SUPABASE_SERVICE_ROLE_KEY        = eyJ...
RAPIDAPI_KEY                     = ef0d419763msh4dad964a696e371p17e7d2jsn9eaa9d32a33c
TRANSCRIPT24_TOKEN               = t24_186e2039e51ad6a75159b835140b5b9ec157a8f2922fa2b9
PERPLEXITY_KEY                   = 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
ADMIN_EMAIL                      = aj@respawnmedia.co
NEXT_PUBLIC_APP_URL              = https://your-vercel-url.vercel.app
```

4. Click **Deploy** → done

---

### Optional: Custom domain

In Vercel → your project → Settings → Domains → add `signal.respawnmedia.co`
In your DNS (wherever respawnmedia.co is registered): add a CNAME pointing to `cname.vercel-dns.com`

---

## Local development

```bash
npm install
# Fill in .env.local with your real Supabase keys
npm run dev
# Open http://localhost:3000
```

---

## Admin access

Log in with `aj@respawnmedia.co` / `123` — the Admin Dashboard will appear automatically in the sidebar.

> **Security note:** Change the default password after first login via Supabase Dashboard → Authentication → Users

---

## Architecture

```
/login          → Auth page (Sign In / Register)
/dashboard      → Protected app shell (all pages)
/api/auth/*     → Login, register, logout, session
/api/scan/run   → Proxies TikTok + Transcript24 + Perplexity (keys server-side)
/api/scan/history → Fetch user's scan history from DB
/api/credits/balance → Fetch Transcript24 balance (server-side)
/api/admin/users → Admin: list/promote/delete users
```

All sensitive API keys live in Vercel environment variables. The browser never sees them.
