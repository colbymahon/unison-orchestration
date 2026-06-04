# Cloudflare DNS — unisonorchestration.com → Vercel

Use **DNS only** (grey cloud) during initial SSL provisioning so Vercel can complete Let's Encrypt.

## Zone records

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `@` (apex) | `cname.vercel-dns.com` | DNS only (grey) |
| CNAME | `www` | `cname.vercel-dns.com` | DNS only (grey) |

Cloudflare flattens apex CNAME to satisfy root routing without a static A record.

## Vercel domains

```bash
cd frontend
vercel domains add unisonorchestration.com
vercel domains add www.unisonorchestration.com
vercel --prod
```

## Verification

```bash
dig +short unisonorchestration.com
dig +short www.unisonorchestration.com
curl -si "https://unisonorchestration.com/.well-known/ai-plugin.json" | head -15
curl -s "https://unisonorchestration.com/api/v1/data-moat-metrics" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['total_vectors'],d['collection_count'])"
```

Expected moat response: **91663** vectors, **32** collections.

## After SSL is active

Optional: enable Cloudflare proxy (orange cloud) for DDoS/WAF. Re-verify Vercel certificate renewal if you toggle proxy later.
