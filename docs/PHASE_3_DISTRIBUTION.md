# Phase 3 — Programmatic Distribution

Frozen engineering baseline: commit `2bc9051` · worker `160ee2ac`.

## Channel 1 — Smithery CLI funnel

```bash
cd ~/unison-orchestration
npx @smithery/cli auth login
npx @smithery/cli run colbymahon/unison-orchestration-hub
npx @smithery/cli mcp publish \
  "https://unison-edge-gateway.unisonorchestration.workers.dev" \
  -n colbymahon/unison-orchestration-hub
```

Assets: [`smithery.yaml`](../smithery.yaml) · [`integrations/SMITHERY_SUBMISSION.md`](../integrations/SMITHERY_SUBMISSION.md)

## Channel 2 — Framework PRs

| Target | Doc |
|--------|-----|
| LangChain | [`integrations/LANGCHAIN_PR_BLUEPRINT.md`](../integrations/LANGCHAIN_PR_BLUEPRINT.md) |
| LlamaIndex | [`integrations/LLAMAINDEX_SUBMISSION.md`](../integrations/LLAMAINDEX_SUBMISSION.md) |

## Channel 3 — Public telemetry mirror

GitHub → **Settings → Secrets → Actions** (both required for full pipeline):

| Secret | Purpose |
|--------|---------|
| `OPENAI_API_KEY` | Frontier model probes in `benchmark_bot.py` (run fails ~10s without it) |
| `TELEMETRY_REPO_TOKEN` | PAT with `contents: write` on `colbymahon/unison-data-telemetry` |

Manual trigger after secrets are set:

```bash
cd ~/unison-orchestration
gh workflow run daily_benchmark.yml
gh run watch   # follow latest run to completion
```

Workflow: [`.github/workflows/daily_benchmark.yml`](../.github/workflows/daily_benchmark.yml) · 03:00 UTC cron.

## Ops symlink

Always use `~/unison-orchestration` for PM2 and CLI (no spaces in volume path).
