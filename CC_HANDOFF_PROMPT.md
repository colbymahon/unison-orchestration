# MISSION BRIEF: UNISON COMMAND CENTER INTERFACE IMPLEMENTATION
Target Agent: Cursor Sonnet 4.6
Context State: Unified Data Moat (25 Active Collections / 23,749 Vectors), x402 Tokenomic Settlement Core, Global Edge Mesh (Cloudflare Workers proxy routing to Fly.io Rust/Axum Backend via iad region deployment co-located with Qdrant us-east4).

## 1. PROJECT DIRECTORY ARCHITECTURE REFERENCE
Verify and operate natively inside this folder mesh:
v18-unison-orchestration/
├── data-ingestion/          # Python ingestion pipelines (_pipeline_common.py)
├── core-mcp-server/         # Rust / Axum core binary (Fly.io deployment)
├── edge-routing/            # Cloudflare Worker reverse proxy + x402 validation gate
└── portal/                  # <-- TARGET DIRECTORY FOR THIS WORKSPACE BUILD
    ├── index.html           # Core single-page entry portal anchor
    └── server_dashboard.py  # Zero-allocation python logging aggregator backend

## 2. COMPONENT 1: FRONTEND PORTAL DEVELOPMENT (`portal/index.html`)
Generate a fully production-ready, beautiful, ultra-high-fidelity standalone web dashboard. Avoid mock wrappers. Use native inline scripts or CDNs for React 18, Tailwind CSS, and Lucide Icons to prevent complex npm build steps for this internal tooling sub-layer.

### Strict UI/UX System Guidelines:
- Theme: Deep cybernetic obsidian (#030712 / #0b0f19 background scaling). High contrast typography matching premium terminals. Accent states tied to status loops: Operational (Emerald-400), Offline/Degraded (Rose-500), Cryptographic Authorization (Cyan-400).
- Layout: Top persistent infrastructure pillar status network bar. Split view workspace toggles supporting: 'System Overview Matrix', 'Data Moat Analytics', 'x402 Ledger Engine', and 'Verification REPL Terminal'.

### Live Functional Mechanics (Direct Fetch Integrations):
- Configuration: Read infrastructure target endpoints from local environment hooks:
  * LOCAL_API: "http://localhost:3000"
  * FLY_API: "https://unison-mcp.fly.dev"
  * EDGE_GATEWAY: "https://unison-edge-gateway.unisonorchestration.workers.dev"
- Heartbeat Telemetry: Implement an async poll looping every 10,000ms mapping live latency metrics via high-resolution performance timestamps against the `/health` routes. Transition the portal component state to 'DEGRADED' or 'OFFLINE' if handshakes fail or timeout spikes exceed 350ms.
- Active Vector Verification REPL: Under the Verification Terminal panel, construct a fully working search form that issues real `fetch` tasks directly to `${EDGE_GATEWAY}/mcp/v1/search?q={query}&collection={target}`. Render the raw output cleanly inside a scrolling natural-text command module matching plain-text `text/tab-separated-values` parameters (Sequence\tURL\tContent).
- Tokenomic Counter Syncing: Capture successful mock completions or trace logs, calculating micro-revenues incrementally based on exactly $0.005 USDC metrics per valid query cleared by the edge proxy.

## 3. COMPONENT 2: ENGINE TELEMETRY EXPOSURE (Rust Backend Updates)
Open `core-mcp-server/src/main.rs`. Modify the existing Axum router layer to ensure telemetry aggregation functions properly with cross-origin fetches originating from the portal workspace:
1. Ensure the `tower-http` CORS configuration completely exposes all custom headers used across the orchestration pipelines (specifically `PAYMENT-SIGNATURE`, `traceparent`, `tracestate`, and custom billing metrics).
2. Wire up a low-overhead runtime aggregation memory bucket tracking:
   - Total queries dispatched through routing selectors.
   - Total rejected 402 anomalies thrown during client authorization drops.

## 4. BUILD PROTOCOL REQUIREMENTS
- Do not abbreviate code strings or drop parts of modules using comments like `// ... rest of code`. Output full files completely so they compile instantly on the file system.
- Use explicit types, complete type-hints, and robust error catch blocks mapping failures out as clean string-stream terminal outputs inside the log telemetry modules.
