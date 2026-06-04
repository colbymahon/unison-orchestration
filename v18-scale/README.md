# V18 Scale — Phase 2 A2A Marketplace Primitives

Specifications and shared type contracts for agent-to-agent infrastructure that sits on top of:

- **Edge:** `edge-routing/` (Cloudflare Worker, x402, KV)
- **Storefront:** `frontend/proxy.ts` (WebAuthn ops perimeter)
- **Substrate:** Qdrant Cloud + Fly MCP (`unison-mcp.fly.dev`)

## Recommended build order

| Phase | Module | Why first |
|-------|--------|-----------|
| **2a** | [Memory Breadcrumbs](./specs/01-memory-breadcrumbs.md) | Extends existing `X-Agent-ID` + KV; turns MCP from stateless pump into shared-state backplane. Prerequisite for revenue splits and auction identity. |
| **2b** | [Cooldown Auctions](./specs/03-cooldown-auctions.md) | Directly monetizes saturation; replaces dead-end HTTP 429 for machine consumers. |
| **2c** | [Revenue Routers](./specs/02-revenue-routers.md) | Requires stable lineage + settlement hooks on Base L2. |
| **2d** | [ZKP Verification](./specs/04-zkp-verification.md) | Highest lift; depends on ingest pipeline emitting digests (knowledge crawler). |

**Inject into monorepo first:** **Memory Breadcrumbs (2a)** — lowest friction, highest leverage for swarm retention.

## Directory layout

```
v18-scale/
├── README.md
├── specs/           # Architecture narratives per primitive
├── types/           # Portable TS contracts (edge + Next.js)
├── headers/         # Canonical X-Unison-* header names & parsing
└── integration/     # Wiring notes for proxy.ts + Worker
```

## Header registry (quick reference)

| Header | Direction | Purpose |
|--------|-----------|---------|
| `X-Unison-Lineage` | Request | Episodic session token (signed JWT or ULID+MAC) |
| `X-Unison-Lineage-Version` | Request | Schema version (`1`) |
| `X-Unison-Satiation` | Response | `ready` \| `auction-active` \| `queued` |
| `X-Unison-Priority-Premium` | Request | Micro-bid USDC string for auction lane |
| `X-Unison-Revenue-Split` | Response | JSON split receipt (post x402) |
| `X-Unison-Source-Digest` | Response | SHA-256 primary-source anchor |
| `X-Unison-ZKP-Attestation` | Response | Compact verification snippet (phase 2d) |
