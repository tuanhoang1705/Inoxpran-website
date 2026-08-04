#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  deploy/scripts/deploy.sh --preflight
  deploy/scripts/deploy.sh --apply-release

--preflight validates the release inputs without changing containers, data,
certificates, nginx configuration, or traffic.

--apply-release is intentionally fail-closed while docker-compose.yml has a
single backend/frontend slot and no verified atomic traffic-switch path. See
deploy/PRODUCTION_RELEASE_RUNBOOK.md.
EOF
}

MODE="${1-}"
case "$MODE" in
  --preflight|--apply-release) ;;
  *)
    usage
    exit 2
    ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

for forbidden_checkout_artifact in \
  .env \
  backend/.env \
  frontend/.env \
  .local-secret-backups \
  .tmp-chrome-trace \
  deploy/openclaw-lab \
  deploy/openclaw/data/.gateway-token
do
  if [ -e "$forbidden_checkout_artifact" ] || [ -L "$forbidden_checkout_artifact" ]; then
    echo "LOCAL_SENSITIVE_ARTIFACT_PRESENT:$forbidden_checkout_artifact" >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required." >&2
  exit 1
fi

config_value() {
  local key="$1"
  printf '%s' "${!key-}"
}

require_config() {
  local key="$1"
  if [ -z "$(config_value "$key")" ]; then
    echo "Missing required deployment configuration: $key" >&2
    return 1
  fi
}

is_true() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

looks_like_placeholder() {
  case "${1,,}" in
    *change-this*|*change_this*|*replace-me*|*replace_me*|*example-secret*|*example_token*|*your-secret*|*your_token*) return 0 ;;
    *) return 1 ;;
  esac
}

validate_hostname() {
  local key="$1"
  local value
  value="${2,,}"
  if [ "${#value}" -gt 253 ] ||
     [[ ! "$value" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
    echo "$key must be an explicit valid DNS hostname without a scheme, port, path, or wildcard." >&2
    exit 1
  fi
}

for required_key in \
  MONGODB_URI \
  REDIS_PASSWORD \
  CORS_ORIGIN \
  APP_BASE_URL \
  API_BASE_URL \
  PUBLIC_SITE_URL \
  ADMIN_BASE_URL \
  DOMAIN \
  WWW_DOMAIN \
  ADMIN_DOMAIN \
  SEO_AGENT_DOMAIN \
  NODE_RUNTIME_IMAGE \
  REDIS_IMAGE \
  NGINX_IMAGE \
  CERTBOT_IMAGE \
  OPENCLAW_IMAGE \
  NINE_ROUTER_IMAGE \
  NINE_ROUTER_DATA_HOST_PATH \
  NINE_ROUTER_API_KEY \
  NINE_ROUTER_JWT_SECRET \
  NINE_ROUTER_INITIAL_PASSWORD \
  NINE_ROUTER_API_KEY_SECRET \
  NINE_ROUTER_MACHINE_ID_SALT \
  OPENCLAW_PACKAGE_ROOT \
  OPENCLAW_GATEWAY_TOKEN \
  OPENCLAW_NO_AUTO_UPDATE \
  OPENAI_API_KEY \
  OPENAI_WRITER_MODEL \
  OPENAI_IDEATION_MODEL \
  OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS \
  OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL \
  SEO_AGENT_API_KEY \
  SEO_AGENT_HMAC_SECRET \
  CONTENT_OPERATIONS_AUDIT_HMAC_SECRET \
  PUBLIC_API_KEY \
  USER_API_KEY \
  ADMIN_BFF_API_KEY \
  OPENCLAW_INTERNAL_API_KEY \
  JWT_SECRET \
  REDIS_TLS_CERT_DIR \
  GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH \
  OPENCLAW_DATA_HOST_PATH \
  OPENCLAW_WORKSPACES_HOST_PATH \
  RELEASE_COMMIT \
  BACKUP_REFERENCE \
  RESTORE_DRILL_REFERENCE \
  RESTORE_DRILL_ACKNOWLEDGEMENT \
  SECRET_ROTATION_PROOF_REFERENCE \
  SECRET_ROTATION_PROOF_SHA256
do
  require_config "$required_key"
done

if [ "$(config_value OPENCLAW_NO_AUTO_UPDATE)" != "1" ]; then
  echo "Safety invariant rejected: OPENCLAW_NO_AUTO_UPDATE must equal 1 during deploy." >&2
  exit 1
fi

for model_key in \
  OPENAI_WRITER_MODEL \
  OPENAI_IDEATION_MODEL \
  OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL
do
  model_value="$(config_value "$model_key")"
  if [[ ! "$model_value" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$ ]]; then
    echo "$model_key must be an explicit valid model identifier." >&2
    exit 1
  fi
done

allowed_models="$(config_value OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS)"
if [[ ! "$allowed_models" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}(,[A-Za-z0-9][A-Za-z0-9._:/-]{0,199})*$ ]]; then
  echo "OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS must be a comma-separated model allowlist without empty entries." >&2
  exit 1
fi

expected_resolved_model="$(config_value OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL)"
case ",$allowed_models," in
  *",$expected_resolved_model,"*) ;;
  *)
    echo "OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL must be present in OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS." >&2
    exit 1
    ;;
esac

market_search_provider="${OPENCLAW_MARKET_SEARCH_PROVIDER:-disabled}"
market_search_provider="${market_search_provider,,}"
case "$market_search_provider" in
  disabled) ;;
  firecrawl) require_config FIRECRAWL_API_KEY ;;
  *)
    echo "OPENCLAW_MARKET_SEARCH_PROVIDER must equal disabled or firecrawl." >&2
    exit 1
    ;;
esac

for legacy_key in \
  API_KEY \
  ADMIN_API_KEY \
  INTERNAL_API_KEY \
  FRONTEND_API_KEY \
  OPENCLAW_BACKEND_API_KEY
do
  if [ -n "$(config_value "$legacy_key")" ]; then
    echo "Legacy deployment key $legacy_key is rejected; rotate to the documented caller-scoped keys." >&2
    exit 1
  fi
done

for protected_flag in \
  SEO_AGENT_AUTO_PUBLISH \
  INOXPRAN_SEO_AGENT_AUTO_PUBLISH \
  AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH \
  OPENCLAW_BLOG_AUTO_PUBLISH \
  CONTENT_LEARNING_AUTO_APPLY \
  OPENCLAW_UPDATE_ENABLED
do
  if is_true "$(config_value "$protected_flag")"; then
    echo "Safety invariant rejected: $protected_flag must remain false during deploy." >&2
    exit 1
  fi
done

for secret_key in \
  REDIS_PASSWORD \
  OPENCLAW_GATEWAY_TOKEN \
  OPENAI_API_KEY \
  SEO_AGENT_API_KEY \
  SEO_AGENT_HMAC_SECRET \
  CONTENT_OPERATIONS_AUDIT_HMAC_SECRET \
  FIRECRAWL_API_KEY \
  JWT_SECRET \
  PUBLIC_API_KEY \
  USER_API_KEY \
  ADMIN_BFF_API_KEY \
  OPENCLAW_INTERNAL_API_KEY \
  NINE_ROUTER_API_KEY \
  NINE_ROUTER_JWT_SECRET \
  NINE_ROUTER_INITIAL_PASSWORD \
  NINE_ROUTER_API_KEY_SECRET \
  NINE_ROUTER_MACHINE_ID_SALT
do
  secret_value="$(config_value "$secret_key")"
  if [ -n "$secret_value" ] && looks_like_placeholder "$secret_value"; then
    echo "Unsafe placeholder rejected for $secret_key." >&2
    exit 1
  fi
  if [[ "$secret_value" == *$'\n'* || "$secret_value" == *$'\r'* ]]; then
    echo "$secret_key must not contain line-break control characters." >&2
    exit 1
  fi
done

nine_router_secret_names=(
  NINE_ROUTER_API_KEY
  NINE_ROUTER_JWT_SECRET
  NINE_ROUTER_INITIAL_PASSWORD
  NINE_ROUTER_API_KEY_SECRET
  NINE_ROUTER_MACHINE_ID_SALT
)
for ((i = 0; i < ${#nine_router_secret_names[@]}; i++)); do
  for ((j = i + 1; j < ${#nine_router_secret_names[@]}; j++)); do
    left_key="${nine_router_secret_names[$i]}"
    right_key="${nine_router_secret_names[$j]}"
    if [ "$(config_value "$left_key")" = "$(config_value "$right_key")" ]; then
      echo "9router secrets must be distinct: $left_key and $right_key collide." >&2
      exit 1
    fi
  done
done

redis_password="$(config_value REDIS_PASSWORD)"
if [ "${#redis_password}" -lt 24 ]; then
  echo "REDIS_PASSWORD must contain at least 24 characters." >&2
  exit 1
fi

for strong_secret in \
  JWT_SECRET \
  OPENCLAW_GATEWAY_TOKEN \
  SEO_AGENT_API_KEY \
  SEO_AGENT_HMAC_SECRET \
  CONTENT_OPERATIONS_AUDIT_HMAC_SECRET \
  PUBLIC_API_KEY \
  USER_API_KEY \
  ADMIN_BFF_API_KEY \
  OPENCLAW_INTERNAL_API_KEY \
  NINE_ROUTER_API_KEY \
  NINE_ROUTER_JWT_SECRET \
  NINE_ROUTER_INITIAL_PASSWORD \
  NINE_ROUTER_API_KEY_SECRET \
  NINE_ROUTER_MACHINE_ID_SALT
do
  strong_secret_value="$(config_value "$strong_secret")"
  if [ "${#strong_secret_value}" -lt 32 ]; then
    echo "$strong_secret must contain at least 32 characters." >&2
    exit 1
  fi
done

scoped_api_key_names=(
  PUBLIC_API_KEY
  USER_API_KEY
  ADMIN_BFF_API_KEY
  OPENCLAW_INTERNAL_API_KEY
)
for ((i = 0; i < ${#scoped_api_key_names[@]}; i++)); do
  for ((j = i + 1; j < ${#scoped_api_key_names[@]}; j++)); do
    left_key="${scoped_api_key_names[$i]}"
    right_key="${scoped_api_key_names[$j]}"
    if [ "$(config_value "$left_key")" = "$(config_value "$right_key")" ]; then
      echo "Caller-scoped API keys must be distinct: $left_key and $right_key collide." >&2
      exit 1
    fi
  done
done

redis_tls_cert_dir="$(config_value REDIS_TLS_CERT_DIR)"
for redis_tls_file in ca.crt server.crt server.key; do
  if [ ! -r "$redis_tls_cert_dir/$redis_tls_file" ]; then
    echo "REDIS_TLS_CERT_DIR must contain readable $redis_tls_file." >&2
    exit 1
  fi
done

for image_key in \
  NODE_RUNTIME_IMAGE \
  REDIS_IMAGE \
  NGINX_IMAGE \
  CERTBOT_IMAGE \
  OPENCLAW_IMAGE \
  NINE_ROUTER_IMAGE
do
  image_value="$(config_value "$image_key")"
  if [[ ! "$image_value" =~ ^[^[:space:]@]+:[^[:space:]@/]+@sha256:[a-fA-F0-9]{64}$ ]]; then
    echo "$image_key must include a reviewed version tag and immutable sha256 digest." >&2
    exit 1
  fi
  image_tag="${image_value%@sha256:*}"
  image_tag="${image_tag##*:}"
  if [ "${image_tag,,}" = "latest" ]; then
    echo "$image_key must not use the mutable latest tag." >&2
    exit 1
  fi
  image_digest="${image_value##*@sha256:}"
  if [[ "$image_digest" =~ ^0{64}$ ]]; then
    echo "$image_key must not use the all-zero placeholder digest." >&2
    exit 1
  fi
done

openclaw_package_root="$(config_value OPENCLAW_PACKAGE_ROOT)"
if [[ ! "$openclaw_package_root" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
   [[ "$openclaw_package_root" == *"//"* ]] ||
   [[ "$openclaw_package_root" == *"/./"* ]] ||
   [[ "$openclaw_package_root" == */. ]] ||
   [[ "$openclaw_package_root" == *"/../"* ]] ||
   [[ "$openclaw_package_root" == */.. ]] ||
   [ "$openclaw_package_root" = "/" ]; then
  echo "OPENCLAW_PACKAGE_ROOT must be a safe absolute package path inside the reviewed OpenClaw image." >&2
  exit 1
fi

openclaw_patch_script="$ROOT_DIR/deploy/openclaw/patches/patch-openresponses-provider-model.mjs"
if [ ! -r "$openclaw_patch_script" ]; then
  echo "The reviewed OpenClaw provider-model patch verifier is missing." >&2
  exit 1
fi
if ! docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --entrypoint node \
  --mount "type=bind,src=$openclaw_patch_script,dst=/tmp/inoxpran-openclaw-patch.mjs,readonly" \
  "$(config_value OPENCLAW_IMAGE)" \
  /tmp/inoxpran-openclaw-patch.mjs \
  --verify-patched \
  --package-root "$openclaw_package_root" >/dev/null; then
  echo "OPENCLAW_IMAGE is not the reviewed 2026.6.11 provider-model-metadata build." >&2
  exit 1
fi

credentials_path="$(config_value GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH)"
if [ ! -f "$credentials_path" ]; then
  echo "GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH must point to a readable service-account file on the host." >&2
  exit 1
fi

resolve_external_runtime_directory() {
  local key="$1"
  local candidate
  local resolved
  local checkout_root
  candidate="$(config_value "$key")"
  if [[ ! "$candidate" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
     [[ "$candidate" == *"//"* ]] ||
     [[ "$candidate" == *"/./"* ]] ||
     [[ "$candidate" == */. ]] ||
     [[ "$candidate" == *"/../"* ]] ||
     [[ "$candidate" == */.. ]] ||
     [ "$candidate" = "/" ]; then
    echo "$key must be an explicit absolute host directory with a safe normalized path." >&2
    exit 1
  fi
  if [ ! -d "$candidate" ] || [ ! -r "$candidate" ] || [ ! -w "$candidate" ]; then
    echo "$key must reference an existing readable and writable host directory." >&2
    exit 1
  fi
  resolved="$(cd -- "$candidate" 2>/dev/null && pwd -P)" || {
    echo "$key could not be resolved safely." >&2
    exit 1
  }
  checkout_root="$(pwd -P)"
  if [ "$candidate" = "$checkout_root" ] ||
     [[ "$candidate" == "$checkout_root/"* ]] ||
     [ "$resolved" = "$checkout_root" ] ||
     [[ "$resolved" == "$checkout_root/"* ]]; then
    echo "$key must remain outside the repository checkout." >&2
    exit 1
  fi
  printf '%s' "$resolved"
}

openclaw_data_host_path="$(resolve_external_runtime_directory OPENCLAW_DATA_HOST_PATH)"
openclaw_workspaces_host_path="$(resolve_external_runtime_directory OPENCLAW_WORKSPACES_HOST_PATH)"
nine_router_data_host_path="$(resolve_external_runtime_directory NINE_ROUTER_DATA_HOST_PATH)"
if [ "$openclaw_data_host_path" = "$openclaw_workspaces_host_path" ] ||
   [[ "$openclaw_data_host_path" == "$openclaw_workspaces_host_path/"* ]] ||
   [[ "$openclaw_workspaces_host_path" == "$openclaw_data_host_path/"* ]]; then
  echo "OpenClaw data and workspace host directories must be distinct and non-overlapping." >&2
  exit 1
fi
for openclaw_runtime_path in "$openclaw_data_host_path" "$openclaw_workspaces_host_path"; do
  if [ "$nine_router_data_host_path" = "$openclaw_runtime_path" ] ||
     [[ "$nine_router_data_host_path" == "$openclaw_runtime_path/"* ]] ||
     [[ "$openclaw_runtime_path" == "$nine_router_data_host_path/"* ]]; then
    echo "9router data and OpenClaw runtime directories must be distinct and non-overlapping." >&2
    exit 1
  fi
done

if ! docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --user 1000:1000 \
  --entrypoint sh \
  --mount "type=bind,src=$nine_router_data_host_path,dst=/app/data" \
  "$(config_value NINE_ROUTER_IMAGE)" \
  -ec 'test -r /app/data && test -w /app/data'; then
  echo "NINE_ROUTER_DATA_HOST_PATH must be readable and writable by container UID/GID 1000:1000." >&2
  exit 1
fi

if ! docker run --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --user 999:1000 \
  --entrypoint sh \
  --mount "type=bind,src=$redis_tls_cert_dir,dst=/run/secrets/redis,readonly" \
  "$(config_value REDIS_IMAGE)" \
  -ec 'test -r /run/secrets/redis/ca.crt && test -r /run/secrets/redis/server.crt && test -r /run/secrets/redis/server.key'; then
  echo "REDIS_TLS_CERT_DIR must be traversable and readable by container UID/GID 999:1000." >&2
  exit 1
fi

compose_profiles="$(config_value COMPOSE_PROFILES)"
if [[ ",$compose_profiles," == *,automation,* ]]; then
  require_config N8N_IMAGE
  require_config N8N_ENCRYPTION_KEY
  require_config N8N_HOST
  require_config N8N_PROTOCOL
  require_config N8N_WEBHOOK_URL
  require_config N8N_DATA_HOST_PATH
  n8n_data_host_path="$(resolve_external_runtime_directory N8N_DATA_HOST_PATH)"
  for runtime_data_path in "$openclaw_data_host_path" "$openclaw_workspaces_host_path" "$nine_router_data_host_path"; do
    if [ "$n8n_data_host_path" = "$runtime_data_path" ] ||
       [[ "$n8n_data_host_path" == "$runtime_data_path/"* ]] ||
       [[ "$runtime_data_path" == "$n8n_data_host_path/"* ]]; then
      echo "N8N data and other runtime directories must be distinct and non-overlapping." >&2
      exit 1
    fi
  done
  n8n_image="$(config_value N8N_IMAGE)"
  if [[ ! "$n8n_image" =~ ^[^[:space:]@]+:[^[:space:]@/]+@sha256:[a-fA-F0-9]{64}$ ]]; then
    echo "N8N_IMAGE must include a reviewed version tag and immutable sha256 digest when automation is enabled." >&2
    exit 1
  fi
  n8n_image_tag="${n8n_image%@sha256:*}"
  n8n_image_tag="${n8n_image_tag##*:}"
  if [ "${n8n_image_tag,,}" = "latest" ]; then
    echo "N8N_IMAGE must not use the mutable latest tag." >&2
    exit 1
  fi
  n8n_image_digest="${n8n_image##*@sha256:}"
  if [[ "$n8n_image_digest" =~ ^0{64}$ ]]; then
    echo "N8N_IMAGE must not use the all-zero placeholder digest when automation is enabled." >&2
    exit 1
  fi
  n8n_key="$(config_value N8N_ENCRYPTION_KEY)"
  if [ "${#n8n_key}" -lt 32 ] || looks_like_placeholder "$n8n_key"; then
    echo "N8N_ENCRYPTION_KEY must be a non-placeholder value of at least 32 characters." >&2
    exit 1
  fi
  n8n_host="${N8N_HOST,,}"
  validate_hostname N8N_HOST "$n8n_host"
  if [ "$n8n_host" = "localhost" ] ||
     [[ "$n8n_host" == *.localhost ]] ||
     [[ "$n8n_host" == *.local ]] ||
     [[ "$n8n_host" == *.internal ]]; then
    echo "N8N_HOST must be a reviewed production hostname when the automation profile is enabled." >&2
    exit 1
  fi
  if [ "$(config_value N8N_PROTOCOL)" != "https" ]; then
    echo "N8N_PROTOCOL must equal https when the automation profile is enabled." >&2
    exit 1
  fi
  n8n_webhook_url="$(config_value N8N_WEBHOOK_URL)"
  if [ "$n8n_webhook_url" != "https://$n8n_host" ] &&
     [ "$n8n_webhook_url" != "https://$n8n_host/" ]; then
    echo "N8N_WEBHOOK_URL must be an absolute HTTPS root URL matching N8N_HOST." >&2
    exit 1
  fi
fi

docker compose config --quiet

domain="$(config_value DOMAIN)"
www_domain="$(config_value WWW_DOMAIN)"
admin_domain="$(config_value ADMIN_DOMAIN)"
seo_agent_domain="$(config_value SEO_AGENT_DOMAIN)"
validate_hostname DOMAIN "$domain"
validate_hostname WWW_DOMAIN "$www_domain"
validate_hostname ADMIN_DOMAIN "$admin_domain"
validate_hostname SEO_AGENT_DOMAIN "$seo_agent_domain"
if [ "${www_domain,,}" != "www.${domain,,}" ] ||
   [ "${admin_domain,,}" != "admin.${domain,,}" ] ||
   [ "${seo_agent_domain,,}" != "seo-agent.${domain,,}" ]; then
  echo "WWW_DOMAIN, ADMIN_DOMAIN, and SEO_AGENT_DOMAIN must be the reviewed service hostnames below DOMAIN." >&2
  exit 1
fi

validate_audit_reference() {
  local key="$1"
  local value
  value="$(config_value "$key")"
  if [ "${#value}" -lt 8 ] || [ "${#value}" -gt 240 ] || looks_like_placeholder "$value"; then
    echo "$key must be a non-placeholder audit reference between 8 and 240 characters." >&2
    exit 1
  fi
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "$key must be a single-line audit reference." >&2
    exit 1
  fi
}

validate_audit_reference BACKUP_REFERENCE
validate_audit_reference RESTORE_DRILL_REFERENCE
validate_audit_reference SECRET_ROTATION_PROOF_REFERENCE

secret_rotation_proof_sha256="$(config_value SECRET_ROTATION_PROOF_SHA256)"
if [[ ! "$secret_rotation_proof_sha256" =~ ^[a-fA-F0-9]{64}$ ]] ||
   [[ "$secret_rotation_proof_sha256" =~ ^0{64}$ ]]; then
  echo "SECRET_ROTATION_PROOF_SHA256 must be a non-placeholder SHA-256 digest of the reference-only proof export." >&2
  exit 1
fi

if [ "$(config_value RESTORE_DRILL_ACKNOWLEDGEMENT)" != "RESTORE_DRILL_VERIFIED" ]; then
  echo "RESTORE_DRILL_ACKNOWLEDGEMENT must equal RESTORE_DRILL_VERIFIED." >&2
  exit 1
fi

release_commit="$(config_value RELEASE_COMMIT)"
if [[ ! "$release_commit" =~ ^[a-fA-F0-9]{40}$ ]]; then
  echo "RELEASE_COMMIT must be the full 40-character reviewed Git commit." >&2
  exit 1
fi
release_commit="${release_commit,,}"
current_commit="$(git rev-parse HEAD)"
if [ "$current_commit" != "$release_commit" ]; then
  echo "RELEASE_COMMIT does not match the checked-out commit." >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "Production release builds require a clean, reviewed Git worktree." >&2
  exit 1
fi

expected_release="git-${release_commit}"
configured_release="$(config_value APP_RELEASE)"
if [ -n "$configured_release" ] && [ "$configured_release" != "$expected_release" ]; then
  echo "APP_RELEASE must equal $expected_release so image tags are bound to RELEASE_COMMIT." >&2
  exit 1
fi

if [ "$MODE" = "--apply-release" ]; then
  expected_confirmation="DEPLOY_RELEASE_${release_commit}"
  if [ "$(config_value CONFIRM_RELEASE_DEPLOY)" != "$expected_confirmation" ]; then
    echo "CONFIRM_RELEASE_DEPLOY must explicitly acknowledge this exact release commit." >&2
    exit 1
  fi
fi

cat >&2 <<EOF
SAFE_RELEASE_TOPOLOGY_REQUIRED

Preflight validated:
  - Compose configuration and mandatory safety invariants
  - external, writable, non-overlapping OpenClaw and 9router runtime directories outside the checkout
  - public/admin/SEO-agent hostname contract for certificate SAN coverage
  - explicit backup reference and restore-drill acknowledgement
  - exact immutable release commit and clean worktree

Release remains blocked before any build, migration, container replacement,
certificate mutation, nginx reload, or traffic change:
  1. docker-compose.yml defines fixed single-slot app_backend, app_frontend,
     and app_nginx containers. Replacing backend/frontend would affect the
     live nginx upstream before candidate readiness and smoke gates pass.
  2. the future traffic-switch path must issue/renew and then verify a
     certificate containing DOMAIN, WWW_DOMAIN, ADMIN_DOMAIN, and
     SEO_AGENT_DOMAIN. Hostname validation alone is not SAN verification.

The required candidate-slot and migration-plan contract is documented in:
  deploy/PRODUCTION_RELEASE_RUNBOOK.md

No deployment was performed.
EOF
exit 1
