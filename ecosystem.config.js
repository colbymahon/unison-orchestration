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

const CLIENT_AGENT_PYTHON = path.join(
  REPO_ROOT,
  "client-agent/venv/bin/python3"
);
const SETTLEMENT_PYTHON = fs.existsSync(CLIENT_AGENT_PYTHON)
  ? CLIENT_AGENT_PYTHON
  : PYTHON_BIN;

/** Shared crash-recovery policy — exponential backoff, high restart ceiling. */
const RESILIENCE = {
  autorestart: true,
  max_restarts: 200,
  min_uptime: "15s",
  restart_delay: 4000,
  exp_backoff_restart_delay: 2000,
  kill_timeout: 8000,
};

module.exports = {
  apps: [
    {
      name: "unison-knowledge-crawler",
      script: PYTHON_BIN,
      args: [path.join(REPO_ROOT, "data-ingestion/autonomous_knowledge_agent.py")],
      cwd: REPO_ROOT,
      ...RESILIENCE,
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
      name: "unison-sales-swarm-commander",
      script: PYTHON_BIN,
      args: [
        path.join(
          REPO_ROOT,
          "platform-services/gtm-swarm/src/sales_swarm_commander.py"
        ),
      ],
      cwd: path.join(REPO_ROOT, "platform-services/gtm-swarm/src"),
      ...RESILIENCE,
      max_memory_restart: "400M",
      watch: false,
      env: {
        PYTHONUNBUFFERED: "1",
        SALES_TICK_SECONDS: "3600",
        SALES_WORKER_POOL: "3",
        UNISON_STOREFRONT_URL: "https://unisonorchestration.com",
        UNISON_EDGE_GATEWAY_URL:
          "https://unison-edge-gateway.unisonorchestration.workers.dev",
        GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
        SMITHERY_API_KEY: process.env.SMITHERY_API_KEY || "",
      },
      error_file: path.join(REPO_ROOT, "logs/pm2-sales-swarm-error.log"),
      out_file: path.join(REPO_ROOT, "logs/pm2-sales-swarm-out.log"),
      merge_logs: true,
      time: true,
    },
    {
      name: "unison-gtm-swarm",
      script: PYTHON_BIN,
      args: [path.join(REPO_ROOT, "distribution-agents/gtm_swarm_coordinator.py")],
      cwd: REPO_ROOT,
      ...RESILIENCE,
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
      ...RESILIENCE,
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
    {
      name: "unison-402-daemon",
      script: SETTLEMENT_PYTHON,
      args: [
        path.join(
          REPO_ROOT,
          "platform-services/gtm-swarm/src/settlement_daemon.py"
        ),
      ],
      cwd: REPO_ROOT,
      ...RESILIENCE,
      max_memory_restart: "400M",
      env: {
        PYTHONUNBUFFERED: "1",
        BASE_CHAIN_ID: "8453",
        USDC_CONTRACT_ADDRESS:
          process.env.USDC_CONTRACT_ADDRESS ||
          "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        PAYMENT_DEST:
          process.env.PAYMENT_DEST ||
          "0xE37BEA19c284eebc561735588e773C097115668B",
        CF_FREE_TIER_NAMESPACE_ID: "91fdd2e791234210906e25b8dd90ba96",
        SETTLEMENT_POLL_SECONDS: "12",
        SETTLEMENT_MIN_PAYMENT_USDC: "0.005",
        SETTLEMENT_QUERY_PRICE_USDC: "0.005",
        SETTLEMENT_CREDIT_MODE: "decrement",
        BASE_RPC_URL: process.env.BASE_RPC_URL || "",
        CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || "",
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || "",
      },
      error_file: path.join(REPO_ROOT, "logs/pm2-402-daemon-error.log"),
      out_file: path.join(REPO_ROOT, "logs/pm2-402-daemon-out.log"),
      merge_logs: true,
      time: true,
    },
    {
      name: "unison-creator-api",
      script: PYTHON_BIN,
      args: [
        path.join(
          REPO_ROOT,
          "platform-services/gtm-swarm/src/creator_api.py"
        ),
      ],
      cwd: path.join(REPO_ROOT, "platform-services/gtm-swarm/src"),
      ...RESILIENCE,
      min_uptime: "8s",
      max_memory_restart: "300M",
      env: {
        PYTHONUNBUFFERED: "1",
        CREATOR_API_HOST: "127.0.0.1",
        CREATOR_API_PORT: "8742",
        CF_FREE_TIER_NAMESPACE_ID: "91fdd2e791234210906e25b8dd90ba96",
        CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || "",
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || "",
      },
      error_file: path.join(REPO_ROOT, "logs/pm2-creator-api-error.log"),
      out_file: path.join(REPO_ROOT, "logs/pm2-creator-api-out.log"),
      merge_logs: true,
      time: true,
    },
    {
      name: "unison-creator-bridge",
      script: path.join(REPO_ROOT, "scripts/run-creator-bridge.sh"),
      interpreter: "/bin/bash",
      cwd: REPO_ROOT,
      ...RESILIENCE,
      max_memory_restart: "120M",
      min_uptime: "10s",
      env: {
        TUNNEL_LOGLEVEL: "info",
      },
      error_file: path.join(REPO_ROOT, "logs/pm2-creator-bridge-error.log"),
      out_file: path.join(REPO_ROOT, "logs/pm2-creator-bridge-out.log"),
      merge_logs: true,
      time: true,
    },
    {
      name: "unison-platform-watchdog",
      script: path.join(REPO_ROOT, "scripts/platform-watchdog-loop.sh"),
      interpreter: "/bin/bash",
      cwd: REPO_ROOT,
      ...RESILIENCE,
      max_memory_restart: "80M",
      env: {
        WATCHDOG_INTERVAL_SECONDS: "120",
      },
      error_file: path.join(REPO_ROOT, "logs/pm2-watchdog-error.log"),
      out_file: path.join(REPO_ROOT, "logs/pm2-watchdog-out.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
