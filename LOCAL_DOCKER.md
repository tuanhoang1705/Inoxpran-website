# Local Docker Run

This stack is local-only. It does not start `nginx` or `certbot`.

## Services

- Frontend: `http://localhost:4173`
- Backend API: `http://localhost:3056/v1/api`
- Redis: `localhost:6379`
- optional `n8n`: `http://localhost:5678`

## Root `.env`

Set these before starting:

```env
MONGODB_URI=...
PUBLIC_API_KEY=...
USER_API_KEY=...
ADMIN_BFF_API_KEY=...
OPENCLAW_INTERNAL_API_KEY=...
OPENAI_API_KEY=...
OPENAI_WRITER_MODEL=...
OPENAI_IDEATION_MODEL=...
OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS=...
OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL=...
# Optional. Enabling Firecrawl also requires FIRECRAWL_API_KEY.
OPENCLAW_MARKET_SEARCH_PROVIDER=disabled
N8N_IMAGE=<reviewed version and sha256 digest>
N8N_ENCRYPTION_KEY=...
N8N_DATA_HOST_PATH=<absolute external data directory>
N8N_BLOCK_ENV_ACCESS_IN_NODE=true
```

The host OpenClaw gateway must be version 2026.6.11 and must return canonical
`provider_model` metadata. Stop the gateway before applying the repository-owned
patch; dry-run first, then apply and restart it. Never point the patcher at an
unreviewed version or use it to mutate a running production container:

```powershell
node deploy/openclaw/patches/patch-openresponses-provider-model.mjs --dry-run --package-root "<OpenClaw package root>"
node deploy/openclaw/patches/patch-openresponses-provider-model.mjs --apply --package-root "<OpenClaw package root>"
node deploy/openclaw/patches/patch-openresponses-provider-model.mjs --verify-patched --package-root "<OpenClaw package root>"
```

The backend fails closed with `OPENCLAW_AGENT_RESOLVED_MODEL_MISSING` if the
gateway remains unpatched; setting only the expected-model environment variable
does not bypass this gate.

Use four distinct values for the scoped API keys. The local Compose file
overrides legacy `API_KEY` to an empty value; do not restore the shared key.

The local Compose file overrides Redis to `redis:6379` inside its private
network and waits for the Redis healthcheck. That hostname is valid only for
containers in this Compose project.

When running `npm run dev` directly from `backend/`, the runtime reads only the
repository-root `.env`. Keep `REDIS_ENABLED=false` if no host-accessible Redis
is running. To use a local Redis published by Compose, set
`REDIS_ENABLED=true`, `REDIS_HOST=127.0.0.1`, and `REDIS_PORT` to the published
host port. Supply any password, TLS CA, or hosted-provider URL through the
local secret file; never paste those values into logs or chat.

## Start

```bash
docker compose -f docker-compose.local.yml up --build -d
```

The default command keeps n8n disabled. Start the hardened automation profile
only after supplying its reviewed image, an encryption key of at least 32
characters, and an external data directory:

```bash
docker compose -f docker-compose.local.yml --profile automation up --build -d
```

## Stop

```bash
docker compose -f docker-compose.local.yml down
```

## Logs

```bash
docker compose -f docker-compose.local.yml logs -f frontend
docker compose -f docker-compose.local.yml logs -f backend
docker compose -f docker-compose.local.yml logs -f n8n
```

## Quick verification

```bash
curl http://localhost:4173
```

## Chatbox smoke test

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:4173/api/chat/message" `
  -ContentType "application/json" `
  -Body (@{
    text = "Toi can tu van noi inox"
    locale = "vi"
    sourcePath = "/shop"
    history = @()
  } | ConvertTo-Json)
```

Expected:

- `ok = true`
- a non-empty `reply`
