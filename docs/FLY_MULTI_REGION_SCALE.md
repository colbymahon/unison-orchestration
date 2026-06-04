# Fly.io multi-region scale (unison-mcp)

## Provision nodes

From repo root (requires `fly auth login`):

```bash
# List existing machines
fly machines list --app unison-mcp

# Clone primary machine to new regions (pick source machine ID from list)
fly machine clone <SOURCE_MACHINE_ID> --region lhr --app unison-mcp
fly machine clone <SOURCE_MACHINE_ID> --region nrt --app unison-mcp

fly status --app unison-mcp
```

Set dashboard regions string on Vercel:

```bash
FLY_ACTIVE_REGIONS=iad,lhr,nrt
```

## Cloudflare tiered caching

Requires `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` with Zone Settings Edit:

```bash
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/settings/tiered_caching" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value":"on"}'
```

Manifest responses are already `Cache-Control: no-store` on dynamic search; tiered cache helps static `.well-known` assets.
