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
API_KEY=...
OPENAI_API_KEY=...
N8N_ENCRYPTION_KEY=...
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

## Start

```bash
docker compose -f docker-compose.local.yml up --build -d
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
