#!/usr/bin/env bash
# Run after manual discussion is live. Usage:
#   ./integrations/LANGCHAIN_PR_AFTER_DISCUSSION.sh 38025
set -euo pipefail
DISCUSSION_NUM="${1:?Usage: $0 <DISCUSSION_NUMBER>}"
ROOT="/Volumes/Colby - Ext. 01/Unison Orchestration"
cd "$ROOT"

# Requires fork of langchain-ai/langchain with files copied from integrations/langchain-community-contrib/
gh pr create -R langchain-ai/langchain \
  --title "feat(community/retrievers): add UnisonX402Retriever integration" \
  --body "Connects and provides programmatic data plane closures for upstream integration proposal.

Discussion: https://github.com/langchain-ai/langchain/discussions/${DISCUSSION_NUM}

Fork payload: https://github.com/colbymahon/unison-orchestration/tree/master/integrations/langchain-community-contrib"
