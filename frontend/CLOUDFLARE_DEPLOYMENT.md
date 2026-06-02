# Cloudflare Deployment Manual — Unison Orchestration Frontend

## Overview

The frontend (Next.js) is deployed to **Cloudflare Pages**. The backend API  
(`/mcp/v1/search`, `/.well-known/mcp-configuration`) lives on the **Cloudflare Worker**  
(`unison-edge-gateway.unisonorchestration.workers.dev`) which proxies to Fly.io.

This document covers WAF rules, Bot Management, CSP headers, and deployment steps.

---

## 1. Cloudflare Pages Deployment

```bash
# Install Wrangler
npm install -g wrangler

# Login
wrangler login

# Build the Next.js app (output mode: export OR edge)
cd frontend
npm run build

# Deploy to Cloudflare Pages
wrangler pages deploy out/ --project-name unison-portal
```

For Next.js App Router with Edge Runtime, use `@cloudflare/next-on-pages`:
```bash
npm install -D @cloudflare/next-on-pages
npx @cloudflare/next-on-pages
wrangler pages deploy .vercel/output/static --project-name unison-portal
```

---

## 2. WAF Rules — Rate Limiting (Protect Frontend UI Routes)

Navigate: **Cloudflare Dashboard → Your Zone → Security → WAF → Rate Limiting Rules**

### Rule 1: Frontend UI Scrape Protection
```
Name: UI Rate Limit
Expression: (http.request.uri.path matches "^/(corpora|docs)?$")
Action: Block
Rate: 100 requests / 1 minute / per IP
Mitigation timeout: 10 minutes
```

### Rule 2: General DDoS Threshold
```
Name: Global Rate Limit
Expression: (not http.request.uri.path contains "/.well-known" 
             and not http.request.uri.path contains "/mcp/v1")
Action: Managed Challenge (CAPTCHA)
Rate: 500 requests / 1 minute / per IP
```

---

## 3. Bot Management — CRITICAL: Whitelist Agentic Crawlers

> ⚠️ If Cloudflare blocks autonomous agents as "bots", the x402 revenue engine stops.

### Rule: Bypass Bot Management for MCP Routes

Navigate: **Security → WAF → Custom Rules → Create Rule**

```
Name: Allow Agentic Bot Crawlers
Expression: 
  (http.request.uri.path contains "/.well-known/mcp-configuration") OR
  (http.request.uri.path contains "/mcp/v1/search")
Action: SKIP — Skip all remaining custom rules AND Bot Fight Mode

Priority: 1 (highest — must run before Bot Management)
```

### Bot Management Settings (Dashboard → Security → Bots)
- **Bot Fight Mode**: Enabled (for UI routes only — rule above bypasses API routes)
- **Super Bot Fight Mode**: If available, set "Verified bots" to ALLOW
- Explicitly allowlist these user-agent patterns:
  - `GPTBot` (OpenAI)
  - `ClaudeBot` (Anthropic)  
  - `Googlebot`
  - `anthropic-ai`
  - `PerplexityBot`
  - `Smithery-Crawler`
  - `PulseMCP-Crawler`

### Firewall Rule for Known Good Agent Crawlers
```
Name: Trusted AI Crawlers — No Challenge
Expression:
  (http.user_agent contains "GPTBot") OR
  (http.user_agent contains "ClaudeBot") OR
  (http.user_agent contains "anthropic-ai") OR
  (http.user_agent contains "PerplexityBot") OR
  (http.user_agent contains "Smithery") OR
  (http.user_agent contains "PulseMCP")
Action: Allow (bypass all security checks)
```

---

## 4. Content Security Policy (CSP)

The CSP is already injected via `next.config.ts` headers. When deployed to  
Cloudflare Pages, reinforce with a **Transform Rule** to ensure headers are set  
at the edge even for static assets:

Navigate: **Rules → Transform Rules → Modify Response Headers**

```
Name: Inject CSP Headers
Expression: (http.response.headers["content-type"] contains "text/html")

Add Header:
  Name:  Content-Security-Policy
  Value: default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; 
         style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; 
         font-src 'self' https://fonts.gstatic.com; 
         img-src 'self' blob: data:; 
         connect-src 'self' https://unison-mcp.fly.dev https://unison-edge-gateway.unisonorchestration.workers.dev; 
         worker-src blob:; frame-src 'none'; object-src 'none';
```

---

## 5. Additional Security Headers (Cloudflare Transform Rules)

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

---

## 6. SSL/TLS Configuration

- **Mode**: Full (Strict)
- **Min TLS Version**: TLS 1.2
- **Automatic HTTPS Rewrites**: Enabled
- **HSTS**: Enabled — `max-age=63072000; includeSubDomains; preload`

---

## 7. Caching Rules

The API routes MUST NOT be cached. The frontend can be cached aggressively.

```
Rule 1 — Bypass Cache for API:
  Expression: (http.request.uri.path contains "/mcp/v1") OR 
              (http.request.uri.path contains "/.well-known")
  Cache TTL: Bypass

Rule 2 — Cache Frontend Static Assets:
  Expression: (http.request.uri.path matches "\\.(js|css|woff2|png|ico)$")
  Edge Cache TTL: 30 days
  Browser Cache TTL: 7 days
```

---

## 8. Page Rules (Redirects)

```
# Redirect bare domain to www (or vice versa — choose one)
unisonorchestration.com/* → https://www.unisonorchestration.com/$1  (301)

# Ensure MCP manifest is always accessible
/.well-known/* → Cloudflare Worker bypass (already configured in WAF)
```

---

## 9. Environment Variables (Cloudflare Pages Settings)

Navigate: **Pages → unison-portal → Settings → Environment Variables**

```
NEXT_PUBLIC_EDGE_URL=https://unison-edge-gateway.unisonorchestration.workers.dev
NEXT_PUBLIC_MCP_MANIFEST=https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration
NODE_ENV=production
```

---

## 10. Dashboard Security — Rule 4: Admin Bypass Rule

The `/dashboard` route is protected by Next.js Edge Middleware (HTTP Basic Auth).
Cloudflare must not interfere with the `401 WWW-Authenticate` challenge/response
cycle or rate-limit your own admin sessions.

### WAF Custom Rule: Admin Static-IP Bypass (Recommended)

If you have a static office or home IP, add this rule **at the highest priority**
so Cloudflare skips all security checks for your known IP on the dashboard route:

Navigate: **Security → WAF → Custom Rules → Create Rule**

```
Name:       Admin Dashboard IP Bypass
Expression: (http.request.uri.path starts_with "/dashboard")
            and (ip.src eq YOUR_STATIC_IP)
Action:     Skip — Skip all remaining custom rules, rate limiting, and Bot Fight Mode
Priority:   1 (must run before all other rules)
```

Replace `YOUR_STATIC_IP` with your actual static IPv4 (e.g. `203.0.113.42`).  
For dynamic IPs use the CIDR block of your ISP or VPN exit node instead.

### Rate Limiting: Exclude Dashboard Auth Challenges

Add an exception to your existing rate-limiting rule so repeated Basic Auth
challenges from your IP don't trigger a ban:

```
Rule: UI Rate Limit — Exception
Expression: (http.request.uri.path starts_with "/dashboard")
            and (ip.src eq YOUR_STATIC_IP)
Action: Skip rate limiting rule
```

### No-Cache for 401 Responses

Cloudflare must not cache 401 responses from the dashboard (this could lock out
legitimate logins with a stale challenge). The middleware already sets
`Cache-Control: no-store` on 401s, but reinforce at the edge:

Navigate: **Rules → Cache Rules → Create Rule**

```
Name:       Never cache dashboard auth challenges
Expression: (http.request.uri.path starts_with "/dashboard")
            and (http.response.code eq 401)
Cache:      Bypass cache
```

---

## 11. Production Secret Provisioning

### Cloudflare Pages
Navigate: **Pages → unison-portal → Settings → Environment Variables**

```
DASHBOARD_USERNAME = v18_admin
DASHBOARD_PASSWORD = <your_secure_password>
```
Add to both **Production** and **Preview** environments.

### Fly.io (if running SSR via Fly)
```bash
fly secrets set DASHBOARD_USERNAME=v18_admin
fly secrets set DASHBOARD_PASSWORD=<your_secure_password>
```

### Verify the lock is active
```bash
# Should return 401 with WWW-Authenticate header
curl -I https://unisonorchestration.com/dashboard

# Should return 200 with correct credentials
curl -u v18_admin:<password> https://unisonorchestration.com/dashboard
```

---

## 12. Deployment Checklist

- [ ] `wrangler pages deploy` succeeds
- [ ] MCP manifest accessible: `curl https://unisonorchestration.com/.well-known/mcp-configuration`
- [ ] `/mcp/v1/search` returns 402 without payment header (not 403/blocked)
- [ ] GPTBot user-agent receives 200 on manifest (not CAPTCHA)
- [ ] Lighthouse score ≥ 90 on all pages
- [ ] CSP headers present on HTML responses
- [ ] HSTS preload header confirmed
- [ ] Rate limiting active on `/` (test with `ab -n 200 -c 10 https://unisonorchestration.com/`)
- [ ] `/dashboard` returns 401 without credentials (`curl -I .../dashboard`)
- [ ] `/dashboard` returns 200 with correct credentials (`curl -u v18_admin:... .../dashboard`)
- [ ] `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` set in Cloudflare Pages env vars
- [ ] Cloudflare Admin IP Bypass rule active (Rule 4)
