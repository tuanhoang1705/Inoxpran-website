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
DOMAIN=inoxpran.com
WWW_DOMAIN=www.inoxpran.com
ADMIN_DOMAIN=admin.inoxpran.com
SEO_AGENT_DOMAIN=seo-agent.inoxpran.com

APP_BASE_URL=https://inoxpran.com
API_BASE_URL=http://backend:3056/v1/api
ADMIN_BASE_URL=https://admin.inoxpran.com
PUBLIC_WEB_BASE=https://inoxpran.com
PUBLIC_SITE_URL=https://inoxpran.com

MONGODB_URI=...
PUBLIC_API_KEY=...
USER_API_KEY=...
ADMIN_BFF_API_KEY=...
OPENCLAW_INTERNAL_API_KEY=...
REDIS_PASSWORD=...
REDIS_TLS_CERT_DIR=/etc/inoxpran/secrets/redis
CORS_ORIGIN=https://inoxpran.com,https://www.inoxpran.com,https://admin.inoxpran.com
JWT_SECRET=...
OPENAI_API_KEY=...
OPENAI_WRITER_MODEL=...
OPENAI_IDEATION_MODEL=...
OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS=...
OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL=...
# Keep disabled unless query-directed evidence search is intentionally enabled.
OPENCLAW_MARKET_SEARCH_PROVIDER=disabled
# Required only when OPENCLAW_MARKET_SEARCH_PROVIDER=firecrawl.
FIRECRAWL_API_KEY=...
SEO_AGENT_API_KEY=...
SEO_AGENT_HMAC_SECRET=...
CONTENT_OPERATIONS_AUDIT_HMAC_SECRET=...
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_NO_AUTO_UPDATE=1
# Absolute npm package path inside OPENCLAW_IMAGE, for example the path that
# contains OpenClaw's package.json and dist/ directory.
OPENCLAW_PACKAGE_ROOT=/reviewed/path/to/node_modules/openclaw
# Persistent OpenClaw runtime paths must be outside this Git checkout.
OPENCLAW_DATA_HOST_PATH=/var/lib/inoxpran/openclaw/data
OPENCLAW_WORKSPACES_HOST_PATH=/var/lib/inoxpran/openclaw/workspaces
NINE_ROUTER_DATA_HOST_PATH=/var/lib/inoxpran/9router
NINE_ROUTER_API_KEY=...
NINE_ROUTER_JWT_SECRET=...
NINE_ROUTER_INITIAL_PASSWORD=...
NINE_ROUTER_API_KEY_SECRET=...
NINE_ROUTER_MACHINE_ID_SALT=...
GOOGLE_APPLICATION_CREDENTIALS_HOST_PATH=/etc/inoxpran/secrets/firebase-service-account.json
NODE_RUNTIME_IMAGE=node:<reviewed-version>@sha256:<reviewed-64-hex-digest>
REDIS_IMAGE=redis:<reviewed-version>@sha256:<reviewed-64-hex-digest>
NGINX_IMAGE=nginx:<reviewed-version>@sha256:<reviewed-64-hex-digest>
CERTBOT_IMAGE=certbot/certbot:<reviewed-version>@sha256:<reviewed-64-hex-digest>
N8N_IMAGE=n8nio/n8n:<reviewed-version>@sha256:<reviewed-64-hex-digest>
OPENCLAW_IMAGE=<reviewed-registry>/<reviewed-openclaw-image>:<reviewed-version>@sha256:<reviewed-64-hex-digest>
NINE_ROUTER_IMAGE=decolua/9router:<reviewed-version>@sha256:<reviewed-64-hex-digest>

N8N_HOST=n8n.inoxpran.com
N8N_PROTOCOL=https
N8N_WEBHOOK_URL=https://n8n.inoxpran.com/
N8N_ENCRYPTION_KEY=...
N8N_DATA_HOST_PATH=/var/lib/inoxpran/n8n
COMPOSE_PROFILES=automation

# Non-secret, release-bound audit evidence (never put credentials here)
RELEASE_COMMIT=<reviewed-40-character-commit>
BACKUP_REFERENCE=<immutable-backup-reference>
RESTORE_DRILL_REFERENCE=<isolated-restore-evidence>
RESTORE_DRILL_ACKNOWLEDGEMENT=RESTORE_DRILL_VERIFIED
SECRET_ROTATION_PROOF_REFERENCE=<restricted-control-plane-reference>
SECRET_ROTATION_PROOF_SHA256=<sha256-of-reference-only-proof-export>
```

## Feature-conditional configuration

Provision only the feature groups that are enabled. Store secret values in the
deployment secret store; the names below intentionally contain no values.

- Customer support chat: `OPENAI_CHAT_MODEL` (optional; `OPENAI_API_KEY` is already required above).
- GHTK shipping: `GHTK_BASE_URL`, `GHTK_API_TOKEN`, `GHTK_CLIENT_SOURCE`,
  `GHTK_PICK_ADDRESS_ID`, `GHTK_PICK_ADDRESS`, `GHTK_PICK_PROVINCE`,
  `GHTK_PICK_DISTRICT`, `GHTK_PICK_WARD`, `GHTK_PICK_STREET`.
- SMTP mail: `SMTP_SERVICE`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
  `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_FROM_NAME`.
- Image/search providers: `IMAGE_SEARCH_PROVIDER`, `IMAGE_SEARCH_API_KEY`,
  `BING_IMAGE_SEARCH_ENDPOINT`, `AI_IMAGE_PROVIDER`, `AI_IMAGE_API_KEY`,
  `AI_IMAGE_MODEL`, `AI_IMAGE_QUALITY`, `AI_IMAGE_REPLICATE_MODEL`.
- Telegram approvals: `TELEGRAM_BOT_ENABLED`, `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_NOTIFY_CHAT_IDS`, `TELEGRAM_ALLOWED_CHAT_IDS`,
  `TELEGRAM_ALLOWED_USER_IDS`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_MODE`.
- Web Push: `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`,
  `WEB_PUSH_SUBJECT`, `WEB_PUSH_MAX_SUBSCRIPTIONS_PER_ADMIN`,
  `WEB_PUSH_TTL_SECONDS`.

## Release preparation

```bash
cd /var/www/project/Inoxpran-Website
git pull origin master
# Inject process environment and read-only file mounts from the deployment
# secret store. Production must not create or read checkout-local dotenv files.
docker compose config >/tmp/inoxpran-compose.rendered.yml
chmod +x deploy/scripts/deploy.sh
./deploy/scripts/deploy.sh --preflight
```

`--preflight` is read-only. `--apply-release` remains deliberately blocked with
`SAFE_RELEASE_TOPOLOGY_REQUIRED` until the blue/green candidate slot and exact
certificate-SAN verification described in
`deploy/PRODUCTION_RELEASE_RUNBOOK.md` are implemented. Do not bypass that gate
with a direct `docker compose up` on production.

Plan production indexes separately with
`npm run migrate:production-indexes:plan` from `backend/`. The plan is dry-run
by default and emits a deterministic `planHash`; apply requires the exact
environment, database name, and reviewed hash. It creates only missing manifest
indexes and never drops an index. A duplicate-key conflict, legacy TTL index,
or missing startup index stops the release, and the production web process
never enables Mongoose auto-indexing.

`REDIS_TLS_CERT_DIR` must be provisioned on the host by the secret/certificate
store and contain readable `ca.crt`, `server.crt`, and `server.key`. The server
certificate must validate for the Compose service name `redis`. Do not paste the
private key into chat, tickets, source control, or CI logs.

Provision `OPENCLAW_DATA_HOST_PATH` and `OPENCLAW_WORKSPACES_HOST_PATH` as
distinct readable/writable absolute directories outside the repository before
preflight. The deploy gate resolves symlinks and rejects the checkout, relative
paths, missing directories, and overlapping data/workspace trees. The
repository-relative values in `.env.example` are local-development defaults
only. Never mount `deploy/openclaw-lab`, ignored runtime data, or ignored
workspaces into production, and never copy their contents into tracked files.

Provision `NINE_ROUTER_DATA_HOST_PATH` as a third distinct readable/writable
absolute directory outside the checkout, owned for container UID/GID
`1000:1000`. Configure `NINE_ROUTER_API_KEY`, `NINE_ROUTER_JWT_SECRET`,
`NINE_ROUTER_INITIAL_PASSWORD`, `NINE_ROUTER_API_KEY_SECRET`, and
`NINE_ROUTER_MACHINE_ID_SALT` as five distinct non-placeholder values of at
least 32 characters. The 9router port is not published; only OpenClaw shares its
dedicated non-internal bridge network.

Before the first production start or any restore into an empty 9router data
directory, import a reviewed database seed containing the intended active
provider connections, `settings.requireApiKey=true`, and exactly one active API
key equal to `NINE_ROUTER_API_KEY`. The environment variable does not register
that key in 9router by itself. Keep the seed and SQLite files mode `0600` under
the container data owner. Gate the release with three private-network probes:
an unauthenticated and an invalid-key `/v1/responses` request must return `401`,
an authenticated model request must complete, and the OpenClaw response must
report the exact reviewed `provider_model`.

Production preflight checks only for existence, never contents, and rejects
checkout-local `.env`, `backend/.env`, `frontend/.env`,
`.local-secret-backups/`, `.tmp-chrome-trace/`, `deploy/openclaw-lab/`, and
`deploy/openclaw/data/.gateway-token`. Remove such artifacts from the production
checkout through the operator's approved secure-storage procedure; the deploy
script never deletes or moves them.

Build any release archive from the reviewed commit with `git archive
"$RELEASE_COMMIT"`, writing it to an operator-controlled directory outside the
checkout. Never create a production artifact by recursively copying or archiving
the working directory, because ignored local runtime material is not part of the
reviewed Git commit.

When `COMPOSE_PROFILES` does not contain `automation`, n8n is
`expected_disabled` and does not block readiness. When enabled, preflight
requires a non-localhost production `N8N_HOST`, `N8N_PROTOCOL=https`, an
absolute root `N8N_WEBHOOK_URL` matching that host, and a non-placeholder
`N8N_ENCRYPTION_KEY` of at least 32 characters. `N8N_DATA_HOST_PATH` must resolve
to a dedicated readable/writable directory outside the checkout and must not
overlap either OpenClaw runtime tree or the 9router data directory. The n8n
container root filesystem remains read-only, with only its data mount and
bounded temporary filesystems writable.
Compose does not currently add an n8n public nginx route; keep the profile
disabled unless a reviewed ingress exists, and require an HTTPS webhook/health
smoke test through that ingress before release.

All core image variables are mandatory. Each reviewed reference must include
both an explicit non-`latest` version tag and an immutable `@sha256:` digest;
the production deploy rejects missing, mutable, and all-zero placeholder
references. Compose does not publish images.

The CI repository variables `REDIS_IMAGE`, `NGINX_IMAGE`, `CERTBOT_IMAGE`,
`OPENCLAW_IMAGE`, and `NINE_ROUTER_IMAGE` must contain the same reviewed
references. CI renders Compose,
checks that every service resolves to the exact supplied digest, and scans the
application images plus every third-party runtime image at the high/critical
gate. `N8N_IMAGE` is optional while the automation profile is intentionally
disabled. Once configured, CI also renders the automation profile and scans
that exact n8n digest; production preflight requires it whenever
`COMPOSE_PROFILES` contains `automation`.

The writer and ideation model IDs are independent, explicit settings. OpenClaw
expands `OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL` into
`agents.defaults.model.primary`; `fallbacks` is an empty list. The backend
requires that same canonical ID in `OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS` and
rejects every response that omits `provider_model` or reports another model.
There is no legacy shared-model or operator-attested response fallback.

OpenClaw 2026.6.11 does not expose `result.meta.agentMeta` through its stock
non-stream `/v1/responses` envelope. Build the reviewed immutable
`OPENCLAW_IMAGE` with the repository patcher below, then pin the resulting image
digest. The patcher defaults to dry-run and rejects version, source hash, output
hash, or anchor drift before writing:

```bash
node deploy/openclaw/patches/patch-openresponses-provider-model.mjs \
  --dry-run --package-root /path/to/node_modules/openclaw
node deploy/openclaw/patches/patch-openresponses-provider-model.mjs \
  --apply --package-root /path/to/node_modules/openclaw
node deploy/openclaw/patches/patch-openresponses-provider-model.mjs \
  --verify-patched --package-root /path/to/node_modules/openclaw
```

Apply it during the immutable image build, not by mutating a running production
container. `deploy.sh --preflight` starts the pinned image with no network and a
read-only filesystem, mounts only the verifier, and requires `--verify-patched`
to pass at `OPENCLAW_PACKAGE_ROOT` before release. Patcher output contains only
status codes, version, patch ID, and file hash; it never prints configuration or
provider credentials.

Query-directed market evidence search is opt-in. Leave
`OPENCLAW_MARKET_SEARCH_PROVIDER=disabled` to make no search-provider calls. If
it is set to `firecrawl`, production preflight and backend startup both require
`FIRECRAWL_API_KEY` from the deployment secret store.

## OpenClaw updates

There is no Docker-socket updater service in the production stack. To update
OpenClaw, review a new immutable digest, change `OPENCLAW_IMAGE` in the deployment
secret store, and run the normal deploy script. This is manual, audited, health
checked, and rollback-capable. Package self-update and application auto-update
remain disabled.

## Verify

```bash
docker compose ps
curl -I https://inoxpran.com
curl -I https://admin.inoxpran.com
curl https://admin.inoxpran.com/robots.txt
```

Expected core services:

- `app_nginx`
- `app_frontend`
- `app_backend`
- `app_redis`

If `n8n` is enabled, it should also appear as `app_n8n`.

## Required credential rotation

An old REST/Postman example previously contained a literal API key and test
login. The tracked file now uses environment placeholders, but removing the
literal from the current tree does not revoke it or erase git history.

Before production deploy, operators must revoke and replace that API key,
invalidate the example login/password if it ever existed, review access logs,
and provision the replacements through the secret store. Do not paste the new
values into issues, commits, CI variables visible to forks, or chat. Git history
rewriting is a separate coordinated incident-response action and is not
performed by the deploy script.

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
