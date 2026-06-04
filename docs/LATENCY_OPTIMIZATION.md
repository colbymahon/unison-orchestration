# Latency optimization — MCP compute path

## Implemented (core-mcp-server `retrieval/`)

| Layer | Change | Expected impact |
|-------|--------|-----------------|
| **Embeddings** | `moka` TTL cache keyed by normalized query hash | Repeat queries: **~0ms** embed leg |
| **HTTP** | Separate pooled `reqwest` clients for OpenAI vs Qdrant (`HTTP_POOL_MAX_IDLE`, keep-alive, tcp keepalive) | Drops cold TLS on 2nd+ request |
| **Qdrant** | Shared `QdrantPool` — no per-request client construction | Stable **warm** REST latency |
| **Observability** | Response headers `x-unison-embed-ms`, `x-unison-qdrant-ms`, `x-unison-embed-cache-hit` | Ops waveform breakdown |

### Env vars (Fly secrets / `.env`)

```bash
HTTP_POOL_MAX_IDLE=32
EMBED_HTTP_TIMEOUT_MS=8000
QDRANT_HTTP_TIMEOUT_MS=5000
EMBED_CACHE_MAX_ENTRIES=10000
EMBED_CACHE_TTL_SECS=3600
QDRANT_WARMUP=1
# Private peering (when Qdrant Cloud provisions internal URL):
# QDRANT_URL=http://<internal-host>:6333
```

## Deploy

```bash
cd core-mcp-server
cargo build --release
fly deploy --app unison-mcp
```

## Path to sub-40ms (ops + future code)

| Tier | Action | Target |
|------|--------|--------|
| **A** | Qdrant **VPC peering** (iad ↔ us-east4) — set `QDRANT_URL` to internal endpoint | Qdrant leg **&lt;10ms** |
| **B** | Enable **gRPC** (`qdrant-client` crate) on private link | Qdrant leg **3–8ms** |
| **C** | **Local ONNX** embed (`fastembed` / `ort`) in Fly image — optional feature | Embed leg **&lt;5ms** (no OpenAI RTT) |

Cold unique queries still pay OpenAI ~150–220ms until tier C or a regional embed proxy in **iad** is added.

## Realistic mean latency after this deploy

- **Cache-hit traffic:** ~30–80ms total (edge + warm Qdrant + TSV)
- **Cold unique queries:** ~200–280ms (OpenAI dominates until local embed)
- **Dashboard** mean drops as agent swarms repeat intent strings
