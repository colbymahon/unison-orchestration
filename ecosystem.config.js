/**
 * PM2 process manager — Unison 24/7 multi-agent mesh
 *
 * IMPORTANT: Paths with spaces break PM2 (external volume). Always start from:
 *   cd ~/unison-orchestration
 *   pm2 start ecosystem.config.js
 *
 * First-time symlink:
 *   ln -sfn "/Volumes/Colby - Ext. 01/Unison Orchestration" ~/unison-orchestration
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const SYMLINK_ROOT = path.join(os.homedir(), "unison-orchestration");
const REPO_ROOT = fs.existsSync(path.join(SYMLINK_ROOT, "ecosystem.config.js"))
  ? SYMLINK_ROOT
  : __dirname;

const PYTHON_BIN =
  process.env.PYTHON_BIN ||
  "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3";

module.exports = {
  apps: [
    {
      name: "unison-knowledge-crawler",
      script: PYTHON_BIN,
      args: [path.join(REPO_ROOT, "data-ingestion/autonomous_knowledge_agent.py")],
      cwd: REPO_ROOT,
      autorestart: true,
      max_restarts: 50,
      min_uptime: "30s",
      max_memory_restart: "500M",
      env: {
        PYTHONUNBUFFERED: "1",
        KNOWLEDGE_CYCLE_SECONDS: "3600",
        KNOWLEDGE_ARXIV_BATCH: "8",
        KNOWLEDGE_MAX_GAPS: "3",
        UNISON_MCP_WARM_URL: "https://unisonorchestration.com/mcp/v1/search",
        KNOWLEDGE_WARM_AGENT_ID: "UnisonOrchestrationAgent/v1.0-knowledge-warm",
      },
      error_file: path.join(REPO_ROOT, "logs/pm2-knowledge-error.log"),
      out_file: path.join(REPO_ROOT, "logs/pm2-knowledge-out.log"),
      merge_logs: true,
      time: true,
    },
    {
      name: "unison-gtm-swarm",
      script: PYTHON_BIN,
      args: [path.join(REPO_ROOT, "distribution-agents/gtm_swarm_coordinator.py")],
      cwd: REPO_ROOT,
      autorestart: true,
      max_restarts: 50,
      min_uptime: "30s",
      max_memory_restart: "500M",
      env: {
        PYTHONUNBUFFERED: "1",
        GTM_TICK_SECONDS: "43200",
        UNISON_STOREFRONT_URL: "https://unisonorchestration.com",
        UNISON_EDGE_GATEWAY_URL:
          "https://unison-edge-gateway.unisonorchestration.workers.dev",
        MOLTBOOK_TARGET_HANDLE: "hirespark",
        MOLTBOOK_API_KEY: process.env.MOLTBOOK_API_KEY || "",
        MOLTBOOK_POSTING_ENABLED: "true",
        MOLTBOOK_POST_INTERVAL_HOURS: "24",
        MOLTBOOK_SUBMOLT: "general",
      },
      error_file: path.join(REPO_ROOT, "logs/pm2-gtm-error.log"),
      out_file: path.join(REPO_ROOT, "logs/pm2-gtm-out.log"),
      merge_logs: true,
      time: true,
    },
    {
      name: "unison-query-swarm",
      script: path.join(REPO_ROOT, "scripts/pm2-run-query-swarm.sh"),
      interpreter: "/bin/bash",
      args: [
        "--agents",
        "3",
        "--queries-per-agent",
        "5",
        "--continuous",
        "--interval-seconds",
        "1800",
      ],
      cwd: REPO_ROOT,
      autorestart: true,
      max_restarts: 50,
      min_uptime: "30s",
      max_memory_restart: "600M",
      watch: false,
      env: {
        PYTHONUNBUFFERED: "1",
        NODE_ENV: "production",
        UNISON_CLIENT_ATTRIBUTION_CODE: "bc_j56e3k4r",
      },
      error_file: path.join(REPO_ROOT, "logs/pm2-query-swarm-error.log"),
      out_file: path.join(REPO_ROOT, "logs/pm2-query-swarm-out.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
