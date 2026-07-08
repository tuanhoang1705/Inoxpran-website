#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENTS_DIR="${ROOT_DIR}/deploy/openclaw/agents"
WORKSPACES_DIR="${ROOT_DIR}/deploy/openclaw/workspaces"
PROFILE="${OPENCLAW_PROFILE:-inoxpran}"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "NOT RUN: openclaw command is unavailable."
  exit 0
fi

if [ ! -d "${AGENTS_DIR}" ]; then
  echo "Missing OpenClaw agents directory: ${AGENTS_DIR}"
  exit 1
fi

mkdir -p "${WORKSPACES_DIR}"

agents_list="$(openclaw --profile "${PROFILE}" agents list 2>&1 || true)"

for agent_file in "${AGENTS_DIR}"/*.md; do
  [ -f "${agent_file}" ] || continue
  agent_id="$(basename "${agent_file}" .md)"
  workspace="${WORKSPACES_DIR}/${agent_id}"
  mkdir -p "${workspace}"

  cat >"${workspace}/BOOTSTRAP.md" <<EOF
# ${agent_id}

This workspace is managed by scripts/openclaw/sync-agents.sh.
Follow AGENTS.md for role, constraints, and handoff rules.

Project: Inoxpran SEO automation.
Default output: create draft-only blog workflow artifacts unless explicitly instructed by the reviewer/publisher policy.
EOF

  {
    echo "# ${agent_id}"
    echo
    cat "${agent_file}"
  } >"${workspace}/AGENTS.md"

  cat >"${workspace}/IDENTITY.md" <<EOF
# IDENTITY.md

- **Name:** ${agent_id}
- **Vibe:** focused SEO operations agent
- **Emoji:**
- **Avatar:**
EOF

  cat >"${workspace}/USER.md" <<EOF
# USER.md

The user owns the Inoxpran website and wants a conservative daily SEO blog automation workflow.
Never expose credentials. Never publish directly unless backend safety gates and reviewer conditions pass.
EOF

  if printf '%s\n' "${agents_list}" | grep -Eq "^[[:space:]]*-[[:space:]]+${agent_id}\\b"; then
    echo "Agent already registered: ${agent_id}"
    continue
  fi

  echo "Registering OpenClaw agent: ${agent_id}"
  openclaw --profile "${PROFILE}" agents add --workspace "${workspace}" --non-interactive "${agent_id}"
done

echo "OpenClaw agent sync complete for profile '${PROFILE}'."
