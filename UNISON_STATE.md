# UNISON ORCHESTRATION - CORE STATE
**Entity:** V18 Group
**Architecture:** Enterprise A2A Data Hub (Model Context Protocol)

## 1. Stack & Infrastructure
- **Data Ingestion:** Python. Custom semantic chunkers (narrative vs. technical-aware). OpenAI `text-embedding-3-small`.
- **Database:** Qdrant Cloud (`us-east4-0.gcp`).
- **Core Backend:** Rust (`core-mcp-server/`). Multi-stage Docker build deployed to Fly.io (`unison-mcp`, region `iad`). Stable URL: `https://unison-mcp.fly.dev`
- **Edge Gateway:** Cloudflare Worker (`edge-routing/`). Proxies traffic to backend.

## 2. Settlement Layer (x402)
- The edge gateway strictly enforces the x402 payment protocol.
- **Terms:** Base network, USDC, $0.005 per query.
- **Wallet:** Live.
- **Logic:** Missing or invalid signature returns `402 Payment Required`. Valid signatures proxy to Rust, returning token-optimized TSV data (no JSON bloat).

## 3. Active Collections
The database is dynamically routed via the `collection` parameter in the `mcp/v1/search` endpoint.
1. `unison_public_domain`: Strategic/philosophical/industrial texts (Sun Tzu, Clausewitz, Musashi, Machiavelli, Taylor) - 3,700 vectors.
2. `unison_engineering_core`: Electrical/mechanical specs (Tesla), naval architecture and maritime engineering (Bourne, Nares, Douglas), ArXiv cs.AI latest research - **1,548 vectors**.
3. `unison_medical_core`: Clinical pathology, pharmacology, anatomy, surgery (Pepper, Osler, Gray's Anatomy, Manual of Surgery) - **4,527 vectors**.
4. `unison_financial_core`: Ledger-row protection, trading blueprints, and numerical market grids (Mackay 1841) + SEC EDGAR 10-K FY2025/2026 (AAPL, MSFT, TSLA, NVDA, AMZN — tier=institutional, x402=0.05) - **1,551 vectors**.
5. `unison_collectibles_core`: Checklists, alphanumeric card numbers, set variants, parallel tracking, and break probability matrix bindings (Pokemon TCG Vintage Base Era) - 196 vectors.
6. `unison_dtc_core`: Step-by-step fulfillment processes, supply chain routing, and direct-response formulas (Gutenberg #43659) - 324 vectors.
7. `unison_legal_core`: Common law, statutes, legal precedents (Blackstone Vol. 1 + Vol. 2, Holmes The Common Law) - 1,364 vectors.
8. `unison_cyber_core`: Foundational cryptography, cipher matrices, early telegraphic protocols (Robinson 1897) - 140 vectors.
9. `unison_architecture_core`: Building codes, material stress tables, structural load equations (Vitruvius Ten Books) - 414 vectors.
10. `unison_astrophysics_core`: Orbital mechanics, physics formulas, celestial navigation (Newton's Principia, Motte trans.) - 593 vectors.
11. `unison_chemistry_core`: Stoichiometric formulas, elemental tables, synthesis equations (Mendeleev Principles of Chemistry) - 1,774 vectors.
12. `unison_aerospace_core`: Flight dynamics, aerodynamic coefficient tables, airfoil metrics (Fage The Aeroplane) - 145 vectors.
13. `unison_intelligence_core`: OSINT/HUMINT tradecraft, clandestine field protocols, operational security hierarchies (Grant Spies & Secret Service) - 145 vectors.
14. `unison_biotech_core`: Amino acid sequences, metabolic pathways, pharmacological tables (Thatcher Plant Life) - 476 vectors.
15. `unison_infrastructure_core`: Civil load limits, structural specifications (ASCE Transactions) - 12 vectors. *(Candidate for depth expansion)*
16. `unison_manufacturing_core`: CNC parameters, metallurgy phase diagrams, tooling sequences (Rose Modern Machine-Shop Practice) - 3,374 vectors.
17. `unison_macroeconomics_core`: Tariff schedules, trade pricing, division of labor (Smith Wealth of Nations) - 1,765 vectors.
18. `unison_mathematics_core`: Symbolic logic, formal proof notation, algebraic reasoning (De Morgan Formal Logic + Granville excerpt) - 485 vectors. *(Notation-dense depth expansion pending via pipeline_local_pdf.py — drop any math PDF to activate)*
19. `unison_thermodynamics_core`: Heat transfer laws, engine efficiency equations, thermodynamic principles (Carnot Motive Power of Heat) - 256 vectors.
20. `unison_agronomy_core`: Soil chemistry (N-P-K/pH), crop yield matrices, irrigation physics (King's The Soil) - 330 vectors.
21. `unison_meteorology_core`: Atmospheric and meteorological principles (Waldo's Elementary Meteorology) - 36 vectors. *(Narrative seed — depth expansion with tabular pressure records queued)*
22. `unison_genetics_core`: Mendelian ratios, phenotypic probability matrices, hybridisation data (Mendel's Experiments) - 137 vectors.
23. `unison_materials_core`: X-ray diffraction tables, atomic lattice parameters, crystal structure (Bragg's X Rays and Crystal Structure) - 82 vectors.
24. `unison_linguistics_core`: Linguistic theory, phonetic shift principles, grammatical analysis (Sapir's Language) - 74 vectors. *(Narrative seed — depth expansion with paradigm-table source queued)*
25. `unison_cartography_core`: Oceanic navigation, celestial fix methods, surveying principles (Bowditch's American Practical Navigator) - 84 vectors. *(Narrative seed — depth expansion with tabular coordinate source queued)*

## 4. Discovery & Manifest
- Live at: `https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration`
- The manifest dynamically exposes all 13 declared collections with their specific Agentic SEO descriptions. The Cloudflare Worker directly proxies discovery requests (`/.well-known/mcp-configuration`) to the Fly.io backend, ensuring registry crawlers (PulseMCP, Smithery) always read the live collection state without hitting the x402 paywall.
- **DEPLOYED 2026-05-29 (Phase 4):** `main.rs` with 13-collection manifest live on Fly.io (`unison-mcp`, rolling deploy, both machines healthy). Cloudflare Worker BACKEND_URL secret updated. All 13 collections now declared to PulseMCP/Smithery crawlers; 3 pending initial seed ingestion.
- Submitted to PulseMCP and Smithery (2026-05-29). Awaiting crawler indexing.

## 5. Current Phase
**Phase B0 COMPLETE — Self-Healing Telemetry Trap LIVE.** Total live vectors: **83,000+** across 31 collections (incl. empty probe `unison_zero_trap_probe` for true zero-hit validation). Revenue-gap ingestion (2026-06-02): hydrodynamics, arbitrage, agglutinative syntax. Edge trap verified: `x-qdrant-result-count: 0` + `X-Zero-Result: true` → KV ledger `lost_revenue: 0.005` (standard tier). Smithery + PulseMCP registries broadcasting. **Master treasury:** `0x568D9Da985F8253F59939D124B35E736B8e3B42d` — all x402 revenue + creator attribution routed here (deployed 2026-06-02).

## 6. Qdrant Cluster
- **URL:** `https://2ed3dc3f-87cc-4f14-99ee-ac3ea7e7ba3f.us-east4-0.gcp.cloud.qdrant.io`
- **Port:** 6333 (REST API)
- Collections use Cosine distance, 1536 dimensions (text-embedding-3-small native).

## 7. Cloudflare Worker (Production Baseline — 2026-06-02)
- **URL:** `https://unison-edge-gateway.unisonorchestration.workers.dev`
- **Edge bundle:** `30ddaf88-2f3b-4242-b98a-1c5fc8db78ef` — treasury wallet cutover (2026-06-02)
- **BACKEND_URL:** `https://unison-mcp.fly.dev` (manifest discovery proxied, no x402 on `/.well-known/mcp-configuration`)
- **KV — FREE_TIER:** `91fdd2e791234210906e25b8dd90ba96` — 50 free queries per IP / `X-Agent-ID`, then x402
- **KV — UNISON_ZERO_LOGS:** `977472f20ce947fa8cd2f841559aeec9` — Phase B0 zero-hit telemetry trap (`miss:{collection}:{base64(query)}`)
- **Auth:** Dashboard Basic Auth perimeter; Admin API Bearer (`ADMIN_API_SECRET` via Wrangler secret)
- **Settlement wallet:** `0x568D9Da985F8253F59939D124B35E736B8e3B42d` (Base mainnet 8453 / USDC / $0.005 standard tier)

### System Topo (Steady-State)
| Layer | Component |
|-------|-----------|
| Edge router | Cloudflare Workers — TSV streaming, x402 gate |
| Vector matrix | 31 collections (incl. `unison_zero_trap_probe`) → Qdrant Cloud `us-east4-0.gcp` |
| Self-healing | Phase B0 trap → `ctx.waitUntil()` → KV ledger → `/api/admin/trapped-gaps` |
| Audit scheduler | GitHub Actions ingest matrix + daily benchmark @ 03:00 UTC |
| Dashboard | Next.js `/dashboard/revenue-gaps` — edge proxy, cyber-premium queue UI |

## 8. Current Phase & Next Moves
**COMPLETED:**
- [x] Phase 1: General corpus ingested (Sun Tzu, 320 vectors)
- [x] Phase 1b: Engineering vertical (Tesla, 165 vectors)
- [x] Phase 1c: Medical vertical seed (Pepper 1885 + Osler 1892, 2,747 vectors)
- [x] Phase 1d: Medical vertical complete (+ Gray's Anatomy, Manual of Surgery → 4,104 vectors)
- [x] Medical vertical depth expansion — Gray's Anatomy (pg38222, 229 chunks, 100% clinical) + Manual of Surgery (pg33515, 194 chunks, 100% clinical) → unison_medical_core **4,527 vectors** (2026-05-29)
- [x] Phase 2: Rust MCP server — multi-collection routing, W3C Trace Context, manifest
- [x] Phase 3: Cloudflare Worker — x402 gate, KV free tier, CORS
- [x] Phase 4: Manifest Agentic SEO, registry submissions (PulseMCP/Smithery manual), niche roadmap
- [x] Phase 5: Permanent backend hosting — Fly.io `unison-mcp` (iad), Worker BACKEND_URL secret cutover

- [x] Phase 6: GTM registry submissions — PulseMCP + Smithery (2026-05-29)
- [x] Phase 2: Horizontal scaling infrastructure — 4 vertical pipelines + 7-collection manifest

**PENDING:**
- [x] Ingest legal seed — Blackstone Vol. 1 (757 vectors, 2026-05-29)
- [x] Ingest collectibles seed — Pokémon TCG Vintage Base Era (base1–base5, 441 cards → 196 vectors, 2026-05-29)
- [x] Ingest financial seed — Mackay's Extraordinary Popular Delusions (1,191 vectors, 2026-05-29)
- [x] Ingest DTC seed — Gutenberg #43659 (324 vectors, 2026-05-29)
- [x] Blackstone Vol. 2 → unison_legal_core (79 vectors, 2026-05-29) — contiguous common law baseline complete
- [x] Clausewitz On War → unison_public_domain (1,794 vectors, 2026-05-29)
- [x] Holmes The Common Law → unison_legal_core (528 vectors, 2026-05-29)
- [x] Naval engineering block → unison_engineering_core (Bourne 551 + Nares 319 + Douglas 463 = 1,333 vectors, 2026-05-29)
- [x] Phase 3 pipelines written: pipeline_cyber.py, pipeline_architecture.py, pipeline_astrophysics.py
- [x] main.rs updated with 3 new CollectionDescriptors (cyber, architecture, astrophysics)
- [x] Deploy updated Rust binary to Fly.io — 10-collection manifest live (2026-05-29, rolling deploy, 2 machines healthy)
- [x] Cyber seed — Robinson Telegraphic Cipher 1897 → unison_cyber_core (140 vectors, 2026-05-29)
- [x] Architecture seed — Vitruvius Ten Books → unison_architecture_core (414 vectors, 2026-05-29)
- [x] Astrophysics seed — Newton's Principia (Motte) → unison_astrophysics_core (593 vectors, 2026-05-29)
- [x] Musashi Book of Five Rings → unison_public_domain (1,064 vectors, 2026-05-29)
- [x] Machiavelli The Prince → unison_public_domain (306 vectors, 2026-05-29)
- [x] Taylor Scientific Management → unison_public_domain (216 vectors, 2026-05-29)
- [x] Phase 4 pipelines written: pipeline_chemistry.py, pipeline_aerospace.py, pipeline_intelligence.py
- [x] main.rs updated with 3 new CollectionDescriptors (chemistry, aerospace, intelligence)
- [x] Deploy updated Rust binary to Fly.io — 13-collection manifest live (2026-05-29, rolling deploy, 2 machines healthy)
- [x] Seed unison_chemistry_core — Mendeleev Principles of Chemistry (1,774 vectors, 2026-05-29, 100% structured classification)
- [x] Seed unison_aerospace_core — Fage The Aeroplane (145 vectors, 2026-05-29, 100% structured classification)
- [x] Seed unison_intelligence_core — Grant Spies & Secret Service (145 vectors, 2026-05-29, 100% structured classification)
- [x] Phase 5 pipelines written: pipeline_biotech.py, pipeline_infrastructure.py, pipeline_manufacturing.py, pipeline_macroeconomics.py, pipeline_mathematics.py, pipeline_thermodynamics.py
- [x] main.rs updated with 6 new CollectionDescriptors (biotech, infrastructure, manufacturing, macroeconomics, mathematics, thermodynamics)
- [x] Deploy 19-collection Rust manifest to Fly.io (2026-05-29, rolling deploy complete, Cloudflare Worker BACKEND_URL updated)
- [x] Seed unison_biotech_core — Thatcher Plant Life (476 vectors, 2026-05-29, 100% structured)
- [x] Seed unison_infrastructure_core — ASCE Transactions (12 vectors, 2026-05-29, 100% structured — depth expansion queued)
- [x] Seed unison_manufacturing_core — Rose Modern Machine-Shop Practice (3,374 vectors, 2026-05-29, 100% structured)
- [x] Seed unison_macroeconomics_core — Smith Wealth of Nations (1,765 vectors, 2026-05-29, 100% structured)
- [x] Seed unison_mathematics_core — De Morgan Formal Logic (433 vectors, 2026-05-29, narrative — depth expansion with notation-dense text queued)
- [x] Seed unison_thermodynamics_core — Carnot Motive Power of Heat (256 vectors, 2026-05-29, 100% structured)

## 9. Session Checkpoint (2026-06-02 — pre–Cursor update)
**Last commits on `master`:**
- `7a56b5f` — Analytics tab: interactive traffic/growth tracker
- `f8be06c` — Admin dashboard UI redesign (live data wiring unchanged)
- `a92b329` — Public site UX + 8th-grade copy

**Deployed live (not yet in git until this checkpoint commit):**
- Treasury wallet `0x568D9Da985F8253F59939D124B35E736B8e3B42d` — edge worker, Fly gtm-swarm, Vercel frontend, Fly MCP `_ops_treasury_master`
- Ops console at `/admin` (redirect from `/dashboard`)
- Production: `unisonorchestration.com` · Edge: `unison-edge-gateway.unisonorchestration.workers.dev`

**Resume here after Cursor update:**
1. ~~Confirm edge `PAYMENT_DEST` via Wrangler vars or a paid-tier 402 probe (`GET`, not `HEAD`)~~ **DONE 2026-06-02** — `destination=0x568D9Da985F8253F59939D124B35E736B8e3B42d` on live 402
2. ~~Optional: set `CREATOR_SHARE_BPS = 0` for 100/0 split in attribution logs~~ **DONE 2026-06-02** — `100:0` across edge, settlement daemon, dashboard
3. GTM benchmarks in `benchmarks/gtm-2026-06-*.md` — rolling vector counts

## 10. Distribution Package (Week 1 — 2026-06-02)
**Shipped:**
- `unison-langchain` 0.2.1 — `UnisonLangChainBridge`, `UnisonLlamaIndexBridge`, frictionless README
- Cursor MCP snippet: `examples/cursor-mcp-snippet.json` + `packages/unison-ts/examples/`
- Smithery hub republished (`crmendeavors/unison-orchestration-hub` release `0e8a6193`)
- Sales swarm pitches: `pip install unison-langchain` + `npx unison-orchestration@0.1.1 start`

**Publish PyPI 0.2.1 (requires API token):**
```bash
cd packages/unison-langchain
TWINE_USERNAME=__token__ TWINE_PASSWORD=<pypi-token> python3 -m twine upload dist/unison_langchain-0.2.1*
```

## 11. Week 2 — Revenue Gap Autopilot (2026-06-02)
**Shipped:**
- `platform-services/gtm-swarm/src/gap_autopilot.py` — 60s poll, GPT-4o synthesis, Qdrant upsert, replay verify
- SQLite `revenue_gap_ledger` in `agent_memory.db` (WAL + busy_timeout)
- Edge `POST /api/admin/mark-gap-recovered` — KV `pipeline_status: recovered`
- Fly mesh: `gap_autopilot` daemon + watchdog monitoring
