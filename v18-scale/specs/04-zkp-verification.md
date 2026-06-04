# Phase 2d — ZKP Data Verification Ring

## Problem

Enterprise agents (legal, financial, biotech) need proof vectors match primary sources.

## Solution

1. **Ingest:** `autonomous_knowledge_agent.py` computes SHA-256 of normalized source bytes; stores in Qdrant payload `source_digest` + optional Base anchor.
2. **Query:** MCP returns `X-Unison-Source-Digest` + `X-Unison-ZKP-Attestation` (MVP: hash chain + signature; full ZKP later).
3. **Verify:** Consumer agent checks digest against known arXiv/legal corpus hash tables.

## Dependencies

- Ingest pipeline hooks (`data-ingestion/_pipeline_common.py` payload extension)
- Base L2 anchor worker (optional)

See `types/zkp-verification.ts`.
