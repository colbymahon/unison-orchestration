# Integration — Next.js Proxy + Cloudflare Edge

## `frontend/proxy.ts` (Phase 2a hook sketch)

```typescript
import { UNISON_HEADERS } from "../../v18-scale/headers/unison-headers";
// import { verifyLineageToken } from "@/lib/lineage-server"; // Phase 2a impl

export async function proxy(req: NextRequest) {
  // ... existing canonical + WebAuthn session ...

  const lineage = req.headers.get(UNISON_HEADERS.LINEAGE);
  if (lineage && isMcpProxyRoute(pathname)) {
    // Forward; do not strip — edge Worker is source of truth for mint/verify
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set(UNISON_HEADERS.LINEAGE_VERSION, "1");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return NextResponse.next();
}
```

## `edge-routing/src/index.ts` (Phase 2a hook sketch)

```typescript
import { UNISON_HEADERS } from "../../v18-scale/headers/unison-headers";

// On /mcp/v1/search:
// 1. verifyLineageOrMint(env, request)
// 2. proxy to BACKEND_URL with X-Unison-Context-Refs
// 3. append step to UNISON_LINEAGE KV
// 4. response.headers.set(UNISON_HEADERS.LINEAGE, newToken)
```

## Shared types

Copy or symlink `v18-scale/types` into `edge-routing/src/v18-scale/` when implementing (Worker bundler path alias).

## Env vars (Phase 2a)

| Variable | Where |
|----------|-------|
| `LINEAGE_SESSION_SECRET` | Edge + optional Next.js |
| `LINEAGE_TTL_SECONDS` | Edge (default 86400) |
| `LINEAGE_MAX_STEPS` | Edge (default 64) |
