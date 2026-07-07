# OpenClaw SEO Automation

This feature adds a safe publishing lane for daily Inoxpran SEO blog automation. OpenClaw agents research, position, ideate, write, prepare image briefs, review, draft/publish, and report. The publisher agent can only call the backend automation API, never MongoDB and never the admin UI.

## Architecture

- OpenClaw runs as an internal Docker Compose service.
- Nginx exposes only `https://seo-agent.inoxpran.com/hooks/` to OpenClaw.
- The OpenClaw dashboard is not public. `/` and `/dashboard/` return 403 by default.
- Blog persistence goes through `POST /v1/api/automation/seo-blog/publish`.
- Backend auth requires the normal `x-api-key`, a dedicated `x-seo-agent-key`, a timestamp, and an HMAC SHA256 signature over the raw JSON body.
- Backend defaults to draft-only. Publishing requires `SEO_AGENT_AUTO_PUBLISH=true` and reviewer pass conditions.

Publishing through the backend API is safer than using the admin UI because it keeps validation, sanitization, duplicate slug checks, SEO gates, audit logging, and MongoDB writes in one controlled server-side path.

## Backend Endpoints

- `GET /v1/api/automation/seo-blog/health`
- `POST /v1/api/automation/seo-blog/publish`

Required headers:

- `x-api-key`
- `x-seo-agent-key`
- `x-openclaw-signature`
- `x-openclaw-timestamp`

Publish pass conditions:

- `SEO_AGENT_ENABLED=true`
- `SEO_AGENT_AUTO_PUBLISH=true`
- `review.seoScore >= SEO_AGENT_MIN_SEO_SCORE`
- `review.brandSafety = pass`
- `review.duplicateRisk != high`
- `review.claimRisk != high`
- `review.imageSafety = pass`
- content word count is within `SEO_AGENT_MIN_WORDS` and `SEO_AGENT_MAX_WORDS`

If any publish condition fails, the API creates a draft.

## Agents

- `seo-orchestrator`: coordinates the daily workflow and never publishes directly.
- `market-insight-analyst`: researches audience pains, competitor angles, demand signals, and positioning opportunities.
- `keyword-researcher`: researches topic candidates, keywords, SERP intent notes, content gaps, and internal-link opportunities.
- `content-ideator`: scores daily topic ideas and chooses one recommended article idea.
- `seo-strategist`: creates the SEO brief.
- `content-writer`: writes Vietnamese HTML content and never publishes.
- `image-planner`: creates image prompts, alt text, captions, and fallback image metadata. It does not upload or publish.
- `seo-reviewer`: produces review JSON and pass/fail reasons.
- `publisher`: calls only the backend automation API through `inoxpran-seo-publisher`.
- `qa-agent`: verifies published URLs.
- `reporter`: summarizes the run.

## Skills

ClawHub core skills installed only after `clawhub inspect` and `openclaw skills verify` pass:

- `skill-vetter`
- `ddg-web-search` installs as `ddg-search`
- `firecrawl-api` installs as `firecrawl`
- `market-research` installs as `Market Research`
- `deep-research-agent` installs as `research-agent`
- `content-generation`
- `image-generation` installs as `AI Image Generation`

Local repository skills:

- `inoxpran-brand-voice`
- `inoxpran-search-console`
- `inoxpran-seo-research-brief`
- `inoxpran-positioning`
- `inoxpran-topic-planner`
- `inoxpran-blog-image-brief`
- `inoxpran-seo-review`
- `inoxpran-seo-publisher`

Run:

```bash
bash scripts/openclaw/install-skills.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/openclaw/install-skills.ps1 -VerifyOnly
powershell -ExecutionPolicy Bypass -File scripts/openclaw/install-skills.ps1
```

The script writes `deploy/openclaw/SKILL_INSTALL_REPORT.md`. It skips any skill that fails inspection or verification.

The detailed ClawHub selection and rejected-skill rationale is in `docs/openclaw-clawhub-skill-selection.md`.

## Environment

Required backend variables:

```bash
SEO_AGENT_ENABLED=true
SEO_AGENT_AUTO_PUBLISH=false
SEO_AGENT_API_KEY=replace-with-random-secret
SEO_AGENT_HMAC_SECRET=replace-with-random-secret
SEO_AGENT_ALLOWED_IPS=
SEO_AGENT_DEFAULT_AUTHOR="Inoxpran Editorial Team"
SEO_AGENT_DEFAULT_BLOG_IMAGE=/images/og-image.png
SEO_AGENT_MIN_SEO_SCORE=85
SEO_AGENT_MIN_WORDS=800
SEO_AGENT_MAX_WORDS=1800
```

Required OpenClaw publisher variables:

```bash
INOXPRAN_BACKEND_API_BASE=http://backend:3056/v1/api
INOXPRAN_PUBLIC_SITE_URL=https://inoxpran.com
INOXPRAN_SEO_AGENT_AUTO_PUBLISH=false
INOXPRAN_SEO_AGENT_API_KEY="${SEO_AGENT_API_KEY}"
INOXPRAN_SEO_AGENT_HMAC_SECRET="${SEO_AGENT_HMAC_SECRET}"
API_KEY=existing-backend-api-key
FIRECRAWL_API_KEY=optional-firecrawl-key
```

Keep `.env`, `.htpasswd`, service account JSON, runtime OpenClaw data, and generated secret-bearing reports out of git.

## Cron

Create the daily 08:30 Asia/Ho_Chi_Minh cron manually:

```bash
bash scripts/openclaw/create-daily-cron.sh
```

For the first 14 days keep `SEO_AGENT_AUTO_PUBLISH=false`. The workflow will create drafts and reports only. Enable publishing later by setting `SEO_AGENT_AUTO_PUBLISH=true` in the backend environment and restarting the backend.

## Smoke Test

The smoke test creates a timestamped test draft by default:

```bash
export API_KEY="existing-backend-api-key"
export SEO_AGENT_API_KEY="automation-key"
export SEO_AGENT_HMAC_SECRET="automation-hmac-secret"
bash scripts/openclaw/smoke-test-publish.sh
```

Windows PowerShell:

```powershell
$env:API_KEY="existing-backend-api-key"
$env:SEO_AGENT_API_KEY="automation-key"
$env:SEO_AGENT_HMAC_SECRET="automation-hmac-secret"
powershell -ExecutionPolicy Bypass -File scripts/openclaw/smoke-test-publish.ps1
```

The backend must also have `SEO_AGENT_ENABLED=true`. Do not run this against production unless you accept a test draft being created.

## Manual OpenClaw Workflow Test

Start OpenClaw with the local project profile first:

```powershell
openclaw --profile inoxpran gateway run --auth token --bind loopback --port 18789
```

In another PowerShell window, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/openclaw/run-daily-draft.ps1
```

This sends `deploy/openclaw/prompts/daily-seo-blog.md` to `seo-orchestrator` through OpenClaw and keeps the OpenClaw-side publishing flag draft-only. The backend still enforces final draft/publish behavior through `SEO_AGENT_AUTO_PUBLISH`.

## Docker Compose

Deploy with:

```bash
docker compose config
docker compose up -d backend openclaw nginx
```

`docker-compose.yml` includes `openclaw/openclaw:latest` with a TODO because the official OpenClaw deployment image must be verified on the VPS. Replace the image if actual OpenClaw docs specify another image.

The OpenClaw service intentionally does not use `env_file`. Compose can read root `.env` for variable substitution, but the container only receives the explicit environment variables it needs. This avoids passing MongoDB, OpenAI, Telegram, or unrelated service credentials into the automation runtime.

Runtime directories are ignored:

- `deploy/openclaw/data/`
- `deploy/openclaw/workspaces/`
- `deploy/openclaw/reports/`

## Nginx And Certificate

Nginx adds:

- HTTP redirect for `seo-agent.inoxpran.com`
- HTTPS block for `seo-agent.inoxpran.com`
- `X-Robots-Tag: noindex, nofollow, noarchive`
- `/hooks/` proxy to `openclaw:18789`
- default 403 for dashboard and all other paths

The current certificate path is reused, but certificate SAN coverage for `seo-agent.inoxpran.com` is not verified. Reissue the certificate before production enablement:

```bash
certbot certonly --webroot -w /var/www/certbot \
  -d inoxpran.com \
  -d www.inoxpran.com \
  -d admin.inoxpran.com \
  -d seo-agent.inoxpran.com
```

If OpenClaw uses a port other than `18789`, update `deploy/nginx/default.conf`.

## Security Checklist

- `SEO_AGENT_ENABLED=false` disables the automation API.
- `SEO_AGENT_AUTO_PUBLISH=false` forces draft mode even when the request asks to publish.
- HMAC uses the raw request body and timing-safe comparison.
- Timestamp tolerance is 5 minutes.
- Optional IP allowlist is supported through `SEO_AGENT_ALLOWED_IPS`.
- Publisher agent has no browser, shell, MongoDB, or admin UI access in config.
- Agents cannot publish unless reviewer pass conditions are satisfied.
- Backend publish gate rejects publishing when `review.imageSafety` is not `pass`.
- Content is sanitized. Scripts, styles, inline event handlers, unsafe links, and untrusted images are removed.

## Rollback

1. Set `SEO_AGENT_ENABLED=false`.
2. Set `SEO_AGENT_AUTO_PUBLISH=false`.
3. Remove or disable the OpenClaw cron.
4. Stop OpenClaw:

```bash
docker compose stop openclaw
```

5. Reload Nginx after removing or disabling the `seo-agent.inoxpran.com` block if needed.
6. Keep existing blog drafts for review or delete them through the normal admin workflow.

## Known Limitations

- OpenClaw image and config schema must be verified on the VPS.
- ClawHub skill availability is unknown until `install-skills.sh` runs with both CLIs installed.
- Some relevant ClawHub SEO skills were not installed because `openclaw skills verify` returned fail/pending on 2026-07-07. Re-verify before reconsidering them.
- Search Console is a local placeholder skill until a verified integration exists.
- Actual image file generation/upload is provider-dependent. Core behavior creates a safe image brief and uses `SEO_AGENT_DEFAULT_BLOG_IMAGE` unless a verified image provider returns an image URL.
- Nginx certificate coverage for `seo-agent.inoxpran.com` must be reissued and verified manually.
- Smoke test requires a running backend and safe non-production env values.
