#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROMPT_FILE="${ROOT_DIR}/deploy/openclaw/prompts/daily-seo-blog.md"
CRON_NAME="Daily Inoxpran SEO Blog"
CRON_SCHEDULE="30 8 * * *"
CRON_TZ="Asia/Ho_Chi_Minh"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "NOT RUN: openclaw command is unavailable. Run this script on the VPS after installing OpenClaw."
  exit 0
fi

if [ ! -f "${PROMPT_FILE}" ]; then
  echo "Missing prompt file: ${PROMPT_FILE}"
  exit 1
fi

echo "Creating OpenClaw cron: ${CRON_NAME}"
echo "Schedule: ${CRON_SCHEDULE} (${CRON_TZ})"
echo "Default publishing behavior is controlled by SEO_AGENT_AUTO_PUBLISH=false/true on the backend."

if openclaw cron create "${CRON_SCHEDULE}" \
  --tz "${CRON_TZ}" \
  --session isolated \
  --agent seo-orchestrator \
  --name "${CRON_NAME}" \
  --message-file "${PROMPT_FILE}"; then
  echo "Cron created with --message-file."
  exit 0
fi

echo "OpenClaw cron create with --message-file failed; trying --message fallback."
MESSAGE="$(cat "${PROMPT_FILE}")"
openclaw cron create "${CRON_SCHEDULE}" \
  --tz "${CRON_TZ}" \
  --session isolated \
  --agent seo-orchestrator \
  --name "${CRON_NAME}" \
  --message "${MESSAGE}"

echo "Cron created with --message fallback."
