#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROMPT_FILE="${ROOT_DIR}/deploy/openclaw/prompts/daily-seo-blog.md"
PROFILE="${OPENCLAW_PROFILE:-inoxpran}"
SESSION_KEY="${OPENCLAW_SESSION_KEY:-agent:seo-orchestrator:daily-manual-test}"
TIMEOUT_SECONDS="${OPENCLAW_AGENT_TIMEOUT_SECONDS:-1800}"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "NOT RUN: openclaw command is unavailable."
  exit 0
fi

if [ ! -f "${PROMPT_FILE}" ]; then
  echo "Missing prompt file: ${PROMPT_FILE}"
  exit 1
fi

export INOXPRAN_SEO_AGENT_AUTO_PUBLISH=false

profile_args=()
if [ -n "${PROFILE}" ]; then
  profile_args=(--profile "${PROFILE}")
fi

echo "Running OpenClaw daily draft workflow with profile '${PROFILE}'..."
openclaw "${profile_args[@]}" agent \
  --agent seo-orchestrator \
  --session-key "${SESSION_KEY}" \
  --message-file "${PROMPT_FILE}" \
  --timeout "${TIMEOUT_SECONDS}"
