# 24/7 Autonomous Multi-Agent Mesh

## Processes

| PM2 name | Script | Default cadence |
|----------|--------|-----------------|
| `unison-knowledge-crawler` | `data-ingestion/autonomous_knowledge_agent.py` | 1h (`KNOWLEDGE_CYCLE_SECONDS=3600`) |
| `unison-gtm-swarm` | `distribution-agents/gtm_swarm_coordinator.py` | 12h (`GTM_TICK_SECONDS=43200`) |

## Prerequisites

```bash
cd data-ingestion && pip install -r requirements.txt
cd ../distribution-agents && pip install -r requirements.txt
```

Ensure `data-ingestion/.env` contains `OPENAI_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`.

Required for trapped-gap lane: `ADMIN_API_SECRET` (same bearer as edge worker + dashboard).
Sync from `frontend/.env.local` into `data-ingestion/.env`, then `pm2 reload unison-knowledge-crawler`.

Optional: `GITHUB_TOKEN` (GitHub discovery lane).

## Reboot persistence (launchd)

```bash
sudo env PATH=$PATH:/opt/homebrew/Cellar/node@20/20.20.2/bin /opt/homebrew/lib/node_modules/pm2/bin/pm2 startup launchd -u colbymahon --hp /Users/colbymahon
```

## Command sheet

| Objective | Command | Telemetry |
|-----------|---------|-----------|
| Fleet status | `pm2 status` | — |
| arXiv / gap ingest logs | `pm2 logs unison-knowledge-crawler` | `data-ingestion/.agent_state/knowledge_agent_telemetry.json` |
| GTM / SEO logs | `pm2 logs unison-gtm-swarm` | `distribution-agents/.agent_state/gtm_swarm_telemetry.json` |
| Single-pass ingest (credits) | `python3 data-ingestion/autonomous_knowledge_agent.py --once` | — |

## PM2 (persistent on server / Mac)

PM2 cannot parse paths with spaces on the external volume. Use the home symlink:

```bash
ln -sfn "/Volumes/Colby - Ext. 01/Unison Orchestration" ~/unison-orchestration
cd ~/unison-orchestration
npm install -g pm2
mkdir -p logs
pip install -r data-ingestion/requirements.txt
pip install -r distribution-agents/requirements.txt
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # copy/paste the sudo launchd command it prints
pm2 status
pm2 logs
```

## Smoke tests (single tick, no PM2)

```bash
python3 distribution-agents/gtm_swarm_coordinator.py --once
python3 data-ingestion/autonomous_knowledge_agent.py --once
```

## Telemetry state files

- `data-ingestion/.agent_state/knowledge_agent_telemetry.json`
- `distribution-agents/.agent_state/gtm_swarm_telemetry.json`
- `benchmarks/gtm-YYYY-MM-DD.md` (advertising lane daily collateral)

## Dashboard

Live vector growth: https://unisonorchestration.com/dashboard (Basic Auth).
