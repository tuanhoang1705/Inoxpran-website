#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required." >&2
  exit 1
fi

read_env_var() {
  local key="$1"
  [ -f .env ] || return 0

  python3 - "$key" <<'PY'
import sys
from pathlib import Path

key = sys.argv[1]
try:
    lines = Path(".env").read_text(encoding="utf-8-sig").splitlines()
except FileNotFoundError:
    raise SystemExit(0)

for raw in lines:
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    name, value = line.split("=", 1)
    if name.strip() != key:
        continue
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1]
    print(value)
    break
PY
}

DOMAIN="${DOMAIN:-$(read_env_var DOMAIN)}"
DOMAIN="${DOMAIN:-inoxpran.com}"
WWW_DOMAIN="${WWW_DOMAIN:-$(read_env_var WWW_DOMAIN)}"
WWW_DOMAIN="${WWW_DOMAIN:-www.inoxpran.com}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-$(read_env_var ADMIN_DOMAIN)}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.${DOMAIN}}"
EMAIL="${LETSENCRYPT_EMAIL:-$(read_env_var LETSENCRYPT_EMAIL)}"
CERT_DIR="deploy/nginx/ssl/live/${DOMAIN}"

mkdir -p deploy/nginx/ssl deploy/nginx/www

install_nginx_config() {
  local source="$1"
  local target="deploy/nginx/default.conf"
  if [ -f "$target" ]; then
    cat "$source" > "$target"
  else
    cp "$source" "$target"
  fi
}

has_certificate_file() {
  docker compose run --rm --no-deps --entrypoint sh certbot -c \
    "test -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
}

certificate_covers_domains() {
  docker compose run --rm --no-deps --entrypoint sh certbot -c \
    "test -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem &&
     openssl x509 -in /etc/letsencrypt/live/${DOMAIN}/fullchain.pem -noout -text |
       grep -q 'DNS:${DOMAIN}' &&
     openssl x509 -in /etc/letsencrypt/live/${DOMAIN}/fullchain.pem -noout -text |
       grep -q 'DNS:${WWW_DOMAIN}' &&
     openssl x509 -in /etc/letsencrypt/live/${DOMAIN}/fullchain.pem -noout -text |
       grep -q 'DNS:${ADMIN_DOMAIN}'"
}

if ! certificate_covers_domains; then
  if [ -z "$EMAIL" ]; then
    echo "Set LETSENCRYPT_EMAIL in .env or env before first deploy." >&2
    exit 1
  fi

  if has_certificate_file; then
    install_nginx_config deploy/nginx/https.conf
  else
    install_nginx_config deploy/nginx/http.conf
  fi
  docker compose up -d --force-recreate nginx
  docker exec app_nginx nginx -s reload >/dev/null 2>&1 || docker compose restart nginx

  docker compose run --rm --entrypoint certbot certbot certonly --webroot \
    -w /var/www/certbot \
    --cert-name "$DOMAIN" --expand \
    -d "$DOMAIN" -d "$WWW_DOMAIN" -d "$ADMIN_DOMAIN" \
    --email "$EMAIL" --agree-tos --no-eff-email --non-interactive
fi

install_nginx_config deploy/nginx/https.conf
docker compose up -d --build
docker compose up -d --force-recreate nginx

# `docker compose up` does not reload nginx when only a bind-mounted config file changes.
# Force a reload (or restart as fallback) so nginx starts listening on 443 with https.conf.
docker exec app_nginx nginx -s reload >/dev/null 2>&1 || docker compose restart nginx
