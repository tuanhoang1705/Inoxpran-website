# OpenClaw Blog Cron And Telegram Approval

This feature adds persisted blog schedules for the OpenClaw SEO automation and optional Telegram approval for draft publishing.

## Flow

```text
Admin dashboard
  -> create enabled schedule in MongoDB
  -> backend scheduler polls due schedules when OPENCLAW_BLOG_CRON_ENABLED=true
  -> schedule execution calls AutomationSeoBlogService.publishSeoBlog()
  -> SEO_AGENT_AUTO_PUBLISH=false forces draft mode
  -> draft is stored as an agentic blog post
  -> Telegram approval record is created
  -> Telegram bot sends /approve CODE and /reject CODE instructions
  -> Telegram webhook validates secret and allowlist
  -> /approve CODE calls BlogService.publishBlog()
  -> existing agentic image review gate must pass before publish
```

The Telegram webhook never calls AI or OpenClaw. It only handles approval commands for already-created drafts.

## Admin Usage

1. Open `/admin/openclaw`.
2. Check these tiles are `ON` or `set`:
   - `SEO_AGENT_ENABLED`
   - `OPENCLAW_BLOG_CRON_ENABLED`
   - `SEO_AGENT_API_KEY`
   - `SEO_AGENT_HMAC_SECRET`
   - `TELEGRAM_BOT_ENABLED`, if approval messages are wanted.
3. In `Blog schedules`, create a daily, weekly, or interval schedule.
4. Keep `Request publish` off for default draft-only behavior.
5. Use `Run now` to test without waiting for the next scheduled time.
6. Open the generated draft from `Executions`.
7. Approve/reject agentic images in the blog editor.
8. Publish manually, or approve from Telegram with `/approve CODE`.

## Required Environment Variables

```bash
SEO_AGENT_ENABLED=true
SEO_AGENT_AUTO_PUBLISH=false
SEO_AGENT_API_KEY=...
SEO_AGENT_HMAC_SECRET=...

OPENCLAW_BLOG_CRON_ENABLED=true
OPENCLAW_BLOG_CRON_POLL_MS=30000

TELEGRAM_BOT_ENABLED=true
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_CHAT_IDS=...
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_NOTIFY_CHAT_IDS=
TELEGRAM_WEBHOOK_SECRET=...
TELEGRAM_WEBHOOK_URL=https://inoxpran.com/v1/api/integrations/telegram/webhook
TELEGRAM_APPROVAL_TTL_HOURS=72
```

Use either `TELEGRAM_ALLOWED_CHAT_IDS` or `TELEGRAM_ALLOWED_USER_IDS`; without an allowlist, approval commands are rejected.

## Telegram Webhook Setup

Run this on the VPS after setting real values in `.env`:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "content-type: application/json" \
  -d "{
    \"url\":\"$TELEGRAM_WEBHOOK_URL\",
    \"secret_token\":\"$TELEGRAM_WEBHOOK_SECRET\",
    \"allowed_updates\":[\"message\"]
  }"
```

Do not commit the bot token. If a token was pasted into chat or logs, rotate it in BotFather.

## Security Controls

- Scheduler is disabled unless `OPENCLAW_BLOG_CRON_ENABLED=true`.
- SEO automation is disabled unless `SEO_AGENT_ENABLED=true`.
- `SEO_AGENT_AUTO_PUBLISH=false` forces draft mode even when a schedule requests publish.
- Telegram bot is disabled unless `TELEGRAM_BOT_ENABLED=true`.
- Telegram webhook requires `X-Telegram-Bot-Api-Secret-Token`.
- Telegram approve/reject commands require allowed chat or user IDs.
- Duplicate Telegram `update_id` values are stored and ignored.
- Telegram handler does not call AI or OpenClaw.
- Publish still uses `BlogService.publishBlog()`, so agentic images must be approved or replaced first.
- OpenClaw dashboard remains local-only; Nginx keeps `/dashboard/` on `seo-agent.inoxpran.com` forbidden.

## Deployment

1. Add real env values to the VPS `.env`.
2. Rebuild and restart backend:
   ```bash
   docker compose up -d --build backend frontend nginx
   ```
3. Validate config:
   ```bash
   docker compose config
   ```
4. Set the Telegram webhook using the command above.
5. Open `/admin/openclaw`, create a schedule, and run it manually once.

## Rollback

1. Set `OPENCLAW_BLOG_CRON_ENABLED=false`.
2. Set `TELEGRAM_BOT_ENABLED=false`.
3. Restart backend:
   ```bash
   docker compose up -d backend
   ```
4. Delete or disable schedules in `/admin/openclaw`.
5. Remove Telegram webhook if needed:
   ```bash
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"
   ```

## Known Limitations

- The scheduler calls the existing backend automation blog service. Full OpenClaw CLI workflow remains available through the existing dashboard action.
- Telegram cannot send proactive messages unless the target chat has already started the bot.
- `seo-agent.inoxpran.com` certificate coverage must be verified/reissued on the VPS before using that subdomain in production.
- Draft publishing from Telegram will fail until all agentic images pass the existing image review gate.
