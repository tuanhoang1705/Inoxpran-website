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

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

DOMAIN="${DOMAIN:-inoxpran.com}"
WWW_DOMAIN="${WWW_DOMAIN:-www.inoxpran.com}"
EMAIL="${LETSENCRYPT_EMAIL:-}"
CERT_DIR="deploy/nginx/ssl/live/${DOMAIN}"

mkdir -p deploy/nginx/ssl deploy/nginx/www

has_certificate() {
  docker compose run --rm --no-deps --entrypoint sh certbot -c \
    "test -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
}

if ! has_certificate; then
  if [ -z "$EMAIL" ]; then
    echo "Set LETSENCRYPT_EMAIL in .env or env before first deploy." >&2
    exit 1
  fi

  cp deploy/nginx/http.conf deploy/nginx/default.conf
  docker compose up -d nginx

  docker compose run --rm certbot certonly --webroot \
    -w /var/www/certbot \
    -d "$DOMAIN" -d "$WWW_DOMAIN" \
    --email "$EMAIL" --agree-tos --no-eff-email
fi

cp deploy/nginx/https.conf deploy/nginx/default.conf
docker compose up -d --build

# `docker compose up` does not reload nginx when only a bind-mounted config file changes.
# Force a reload (or restart as fallback) so nginx starts listening on 443 with https.conf.
docker exec app_nginx nginx -s reload >/dev/null 2>&1 || docker compose restart nginx
