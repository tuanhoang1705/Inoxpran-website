#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_FILE="${ROOT_DIR}/deploy/openclaw/SKILL_INSTALL_REPORT.md"
FORCE_SKILL_INSTALL="${FORCE_SKILL_INSTALL:-false}"
VERIFY_ONLY="${VERIFY_ONLY:-false}"
OPENCLAW_PROFILE="${OPENCLAW_PROFILE:-inoxpran}"

# Core skills selected from ClawHub for the daily blog multi-agent workflow.
# Each must pass `openclaw skills verify` before install.
SKILLS=(
  "skill-vetter"
  "ddg-web-search"
  "firecrawl-api"
  "market-research"
  "deep-research-agent"
  "content-generation"
  "image-generation"
  "google-search-console-seo"
  "sharpagent-content-safety"
)

mkdir -p "$(dirname "${REPORT_FILE}")"

{
  echo "# ClawHub Skill Install Report"
  echo
  echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "Procedure: inspect each slug, verify it, then install only verified skills."
  echo
  echo "VERIFY_ONLY: ${VERIFY_ONLY}"
  echo "FORCE_SKILL_INSTALL: ${FORCE_SKILL_INSTALL}"
  echo "OPENCLAW_PROFILE: ${OPENCLAW_PROFILE}"
  echo
  echo "## Core skills"
  echo
  for skill in "${SKILLS[@]}"; do
    echo "- \`${skill}\`"
  done
  echo
  echo "## Not installed automatically"
  echo
  echo "- \`keyword-research\`: verify failed because security/card was pending."
  echo "- \`serp-analysis\`: verify failed because security/card was pending."
  echo "- \`content-gap-analysis\`: verify failed because security/card was pending."
  echo "- \`openclaw-seo-content-engine\`: verify failed; scanner flagged live Chrome and hard-coded local API-key path."
  echo "- \`blog-writing\`: verify failed; scanner flagged shell/full-security subagent requests."
  echo "- \`citedy-seo-agent\`: verify failed; scanner flagged broad credit spending, public publishing, deletes, and recurring automation."
  echo "- \`multi-search-engine\`: verify failed; scanner flagged third-party query/privacy risk."
  echo "- \`skillscan\`: verify failed; scanner flagged upload/telemetry/self-update behavior."
  echo "- \`nano-banana-pro\`: slug is ambiguous across multiple owners; choose and vet one manually before use."
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

inspect_out="$(mktemp)"
verify_out="$(mktemp)"
install_out="$(mktemp)"
trap 'rm -f "${inspect_out}" "${verify_out}" "${install_out}"' EXIT

openclaw_prefix=()
if [ -n "${OPENCLAW_PROFILE}" ]; then
  openclaw_prefix=(--profile "${OPENCLAW_PROFILE}")
fi

for skill in "${SKILLS[@]}"; do
  echo "Inspecting ${skill}..."
  {
    echo "## ${skill}"
    echo
  } >> "${REPORT_FILE}"

  if ! clawhub inspect "${skill}" >"${inspect_out}" 2>&1; then
    {
      echo "SKIP: inspect failed"
      echo
      sed 's/^/    /' "${inspect_out}"
      echo
    } >> "${REPORT_FILE}"
    continue
  fi

  if ! openclaw "${openclaw_prefix[@]}" skills verify "${skill}" >"${verify_out}" 2>&1; then
    {
      echo "SKIP: verify failed"
      echo
      sed 's/^/    /' "${verify_out}"
      echo
    } >> "${REPORT_FILE}"
    continue
  fi

  if [ "${VERIFY_ONLY}" = "true" ]; then
    {
      echo "VERIFIED: ${skill}"
      echo
    } >> "${REPORT_FILE}"
    continue
  fi

  install_args=("${openclaw_prefix[@]}" "skills" "install" "${skill}" "--global")
  if [ "${FORCE_SKILL_INSTALL}" = "true" ]; then
    install_args+=("--force")
  fi

  if openclaw "${install_args[@]}" >"${install_out}" 2>&1; then
    {
      echo "INSTALLED: ${skill}"
      echo
    } >> "${REPORT_FILE}"
  elif grep -qi "Skill already exists" "${install_out}"; then
    {
      echo "ALREADY INSTALLED: ${skill}"
      echo
      sed 's/^/    /' "${install_out}"
      echo
    } >> "${REPORT_FILE}"
  else
    {
      echo "SKIP: install failed"
      echo
      sed 's/^/    /' "${install_out}"
      echo
    } >> "${REPORT_FILE}"
  fi
done

echo "Skill installation report written to ${REPORT_FILE}"
