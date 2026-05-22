# Deploy Checklist (Vietnix VPS)

This project now deploys the storefront chat through OpenAI only.

## Production stack

- website frontend
- backend API
- Redis
- optional `n8n`

## Required env

```env
LETSENCRYPT_EMAIL=you@example.com

APP_BASE_URL=https://inoxpran.com
PUBLIC_WEB_BASE=https://inoxpran.com
PUBLIC_SITE_URL=https://inoxpran.com

MONGODB_URI=...
API_KEY=...
OPENAI_API_KEY=...

N8N_HOST=n8n.inoxpran.com
N8N_PROTOCOL=https
N8N_WEBHOOK_URL=https://n8n.inoxpran.com/
N8N_ENCRYPTION_KEY=...
N8N_BLOCK_ENV_ACCESS_IN_NODE=false

GHTK_BASE_URL=https://services.giaohangtietkiem.vn
GHTK_API_TOKEN=...
GHTK_CLIENT_SOURCE=...
GHTK_PICK_ADDRESS_ID=
GHTK_PICK_ADDRESS=...
GHTK_PICK_PROVINCE=...
GHTK_PICK_DISTRICT=...
GHTK_PICK_WARD=...
GHTK_PICK_STREET=...
```

## Deploy

```bash
cd /var/www/project/Inoxpran-Website
git pull origin master
cp .env.example .env
nano .env
docker compose config >/tmp/inoxpran-compose.rendered.yml
chmod +x deploy/scripts/deploy.sh
./deploy/scripts/deploy.sh
```

## Verify

```bash
docker compose ps
curl -I https://inoxpran.com
```

Expected core services:
- `app_nginx`
- `app_frontend`
- `app_backend`
- `app_redis`

If `n8n` is enabled, it should also appear as `app_n8n`.

## Chatbox smoke test

The website chatbox now calls OpenAI directly through the frontend server.

```bash
curl -X POST https://inoxpran.com/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{"text":"Toi can tu van noi inox cho gia dinh 4 nguoi","locale":"vi","sourcePath":"/shop","history":[]}'
```

Expected:
- HTTP `200`
- JSON with `"ok": true`
- a non-empty `"reply"`
