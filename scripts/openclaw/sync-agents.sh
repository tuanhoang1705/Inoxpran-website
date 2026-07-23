#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENTS_DIR="${ROOT_DIR}/deploy/openclaw/agents"
WORKSPACES_DIR="${ROOT_DIR}/deploy/openclaw/workspaces"
PROFILE="${OPENCLAW_PROFILE:-inoxpran}"

run_openclaw() {
  if command -v openclaw >/dev/null 2>&1; then
    openclaw "$@"
    return
  fi

  if command -v docker >/dev/null 2>&1 && docker inspect app_openclaw >/dev/null 2>&1; then
    docker exec app_openclaw openclaw "$@"
    return
  fi

  echo "OpenClaw CLI is unavailable on the host and app_openclaw is not running." >&2
  return 127
}

if [ ! -d "${AGENTS_DIR}" ]; then
  echo "Missing OpenClaw agents directory: ${AGENTS_DIR}"
  exit 1
fi

mkdir -p "${WORKSPACES_DIR}"

if ! agents_list="$(run_openclaw --profile "${PROFILE}" agents list 2>&1)"; then
  printf '%s\n' "${agents_list}" >&2
  echo "Unable to list OpenClaw agents for profile '${PROFILE}'." >&2
  exit 1
fi

for agent_file in "${AGENTS_DIR}"/*.md; do
  [ -f "${agent_file}" ] || continue
  agent_id="$(basename "${agent_file}" .md)"
  workspace="${WORKSPACES_DIR}/${agent_id}"
  mkdir -p "${workspace}"

  if [ "${agent_id}" = "senior-blog-acceptance-auditor" ]; then
    for required_file in BOOTSTRAP.md AGENTS.md IDENTITY.md USER.md; do
      if [ ! -f "${workspace}/${required_file}" ]; then
        echo "Missing repository-managed Senior Auditor workspace file: ${workspace}/${required_file}" >&2
        exit 1
      fi
    done
    echo "Preserving repository-managed read-only Senior Auditor workspace."
  else
    cat >"${workspace}/BOOTSTRAP.md" <<EOF
# ${agent_id}

This workspace is managed by scripts/openclaw/sync-agents.sh.
Follow AGENTS.md for role, constraints, and handoff rules.

Project: Inoxpran SEO automation.
Default output: follow AGENTS.md exactly and never perform publication or another external side effect unless the role policy explicitly permits it.
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
  fi

  if printf '%s\n' "${agents_list}" | grep -Eq "^[[:space:]]*-[[:space:]]+${agent_id}([[:space:]]|$)"; then
    echo "Agent already registered: ${agent_id}"
    continue
  fi

  echo "Registering OpenClaw agent: ${agent_id}"
  run_openclaw --profile "${PROFILE}" agents add --workspace "${workspace}" --non-interactive "${agent_id}"
done

echo "OpenClaw agent sync complete for profile '${PROFILE}'."
