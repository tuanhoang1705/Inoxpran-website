#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_FILE="${ROOT_DIR}/deploy/openclaw/SKILL_INSTALL_REPORT.md"
FORCE_SKILL_INSTALL="${FORCE_SKILL_INSTALL:-false}"

SKILLS=(
  "global-search"
  "firecrawl-api"
  "sovereign-content-scraper"
  "ghost-blog-writer"
  "contentforge-api"
  "free-text-generator"
  "rankforge-api"
  "claim-verifier"
  "openclaw-prompt-shield"
  "skylv-secret-detector"
  "page-agent-browser"
  "remote-browser"
  "n8n-pilot"
)

mkdir -p "$(dirname "${REPORT_FILE}")"

{
  echo "# ClawHub Skill Install Report"
  echo
  echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "Procedure: inspect each slug, verify it, then install only verified skills."
  echo
} > "${REPORT_FILE}"

missing_commands=()
for command_name in clawhub openclaw; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    missing_commands+=("${command_name}")
  fi
done

if [ "${#missing_commands[@]}" -gt 0 ]; then
  {
    echo "## Result"
    echo
    echo "NOT RUN: required command(s) unavailable: ${missing_commands[*]}"
    echo
    echo "Run this script on the VPS after installing OpenClaw and ClawHub CLI."
  } >> "${REPORT_FILE}"
  echo "OpenClaw skill installation not run; missing command(s): ${missing_commands[*]}"
  echo "Report written to ${REPORT_FILE}"
  exit 0
fi

for skill in "${SKILLS[@]}"; do
  echo "Inspecting ${skill}..."
  {
    echo "## ${skill}"
    echo
  } >> "${REPORT_FILE}"

  if ! clawhub inspect "${skill}" >/tmp/openclaw-skill-inspect.out 2>&1; then
    {
      echo "SKIP: inspect failed"
      echo
      sed 's/^/    /' /tmp/openclaw-skill-inspect.out
      echo
    } >> "${REPORT_FILE}"
    continue
  fi

  if ! openclaw skills verify "${skill}" >/tmp/openclaw-skill-verify.out 2>&1; then
    {
      echo "SKIP: verify failed"
      echo
      sed 's/^/    /' /tmp/openclaw-skill-verify.out
      echo
    } >> "${REPORT_FILE}"
    continue
  fi

  install_args=("skills" "install" "${skill}" "--global")
  if [ "${FORCE_SKILL_INSTALL}" = "true" ]; then
    install_args+=("--force")
  fi

  if openclaw "${install_args[@]}" >/tmp/openclaw-skill-install.out 2>&1; then
    {
      echo "INSTALLED: ${skill}"
      echo
    } >> "${REPORT_FILE}"
  else
    {
      echo "SKIP: install failed"
      echo
      sed 's/^/    /' /tmp/openclaw-skill-install.out
      echo
    } >> "${REPORT_FILE}"
  fi
done

rm -f /tmp/openclaw-skill-inspect.out /tmp/openclaw-skill-verify.out /tmp/openclaw-skill-install.out
echo "Skill installation report written to ${REPORT_FILE}"
