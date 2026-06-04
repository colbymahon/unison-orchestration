# Cloudflare DNS — unisonorchestration.com → Vercel

## Phase 1 — SSL provisioning (grey cloud)

Use **DNS only** while Vercel issues Let's Encrypt certificates.

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `@` | `cname.vercel-dns.com` | DNS only (grey) |
| CNAME | `www` | `cname.vercel-dns.com` | DNS only (grey) |

## Phase 2 — Production edge (orange cloud)

After Vercel shows the domain as verified, enable proxy:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `@` | `cname.vercel-dns.com` | **Proxied (orange)** |
| CNAME | `www` | `cname.vercel-dns.com` | **Proxied (orange)** |

### SSL/TLS mode (required)

Cloudflare → **SSL/TLS** → set encryption to **Full** or **Full (strict)**.

| Mode | Result |
|------|--------|
| Flexible | Cloudflare → Vercel over HTTP → **ERR_TOO_MANY_REDIRECTS** |
| Full / Full (strict) | End-to-end HTTPS → works with `proxy.ts` redirects |

## Application behavior

`frontend/proxy.ts` enforces in production:

- `x-forwarded-proto: https` (or 308 redirect to `https://unisonorchestration.com`)
- Canonical host `unisonorchestration.com` (www → apex)
- Basic Auth only on `/dashboard` and ops APIs **after** HTTPS is confirmed (no double-challenge loop)

## Verification

```bash
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
dig +short unisonorchestration.com
curl -si "https://unisonorchestration.com/.well-known/ai-plugin.json" | head -12
curl -s "https://unisonorchestration.com/api/v1/data-moat-metrics?fresh=1" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['total_vectors'],d['collection_count'])"
```

## Vercel CLI

```bash
cd frontend
vercel domains add unisonorchestration.com
vercel domains add www.unisonorchestration.com
vercel --prod
```
