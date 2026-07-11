# OpenClaw Telegram Blog Approval V2

## Behavior

Telegram approval is a non-AI review and publication path. It reads a saved Blog, creates one idempotent `TelegramBlogApproval`, sends the cover when safe, and publishes through `BlogService` only after an authorized `/approve` command. It never reruns OpenClaw, research, content generation, or image generation.

The admin link is always:

```text
${ADMIN_BASE_URL}/admin/blogs/${blogId}
```

The public slug URL is not used for admin review.

## BotFather setup

1. Create a bot with `@BotFather` and keep the token only in local/VPS environment storage.
2. Start a private chat with the bot.
3. Set `TELEGRAM_BOT_ENABLED=true` and restart in polling mode temporarily.
4. Send `/whoami` to obtain your user and chat IDs.
5. Add those IDs to the allowlists, then restart.
6. Never paste a real token into documentation, source, frontend variables, logs, screenshots, or commits.

## Environment

```dotenv
TELEGRAM_BOT_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_NOTIFY_CHAT_IDS=
TELEGRAM_ALLOWED_CHAT_IDS=
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_WEBHOOK_URL=https://inoxpran.com/v1/api/integrations/telegram/webhook
TELEGRAM_APPROVAL_TTL_HOURS=72
TELEGRAM_MODE=webhook
TELEGRAM_POLL_INTERVAL_MS=1500
TELEGRAM_IMAGE_TIMEOUT_MS=8000
TELEGRAM_IMAGE_MAX_BYTES=5242880
ADMIN_BASE_URL=https://inoxpran.com
```

Production approval is denied when both allowlists are empty. The admin/status APIs expose only configured/missing booleans and mode, never values.

## Commands

- `/start`: bot purpose and help.
- `/help`: command list and AI-isolation notice.
- `/whoami`: caller's own user/chat IDs; safe before allowlisting.
- `/pending`: pending, unexpired approvals and admin links.
- `/approve CODE`: atomically claim and publish the saved draft.
- `/reject CODE`: atomically reject the pending approval.

Duplicate Telegram `update_id` values are ignored. Approvals transition through `pending -> processing -> approved`; a publish error returns the record to pending. Expired and already-processed codes do not publish again.

## Cover image and fallback

Image selection is `coverImage.url`, then `blog_image`. Relative paths use the configured public site base.

Before `sendPhoto`, the backend enforces HTTPS/public DNS, blocks private/reserved/link-local/metadata endpoints, rejects redirects, validates JPEG/PNG/WebP/GIF MIME, downloads with timeout, and enforces the configured byte limit.

Any missing/unsafe/invalid/oversized/timed-out image, or Telegram `sendPhoto` failure, sends one text notification using the same approval record. Stored notification types are `photo`, `text`, `text_fallback`, or `disabled`. Image failure never calls image generation and never fails draft creation.

## Webhook mode

Set `TELEGRAM_MODE=webhook`, create a strong `TELEGRAM_WEBHOOK_SECRET`, and register the public HTTPS URL with Telegram using the same secret token. Requests without `X-Telegram-Bot-Api-Secret-Token` or with a mismatched secret receive 403.

The endpoint is:

```text
POST /v1/api/integrations/telegram/webhook
```

Do not expose this route without TLS at the reverse proxy.

## Polling mode

Set `TELEGRAM_MODE=polling`. Backend startup begins one guarded long-poll loop using `getUpdates`; persisted `TelegramUpdate.updateId` uniqueness protects restarts and duplicate delivery. Do not run polling and webhook delivery for the same bot simultaneously.

Polling is convenient for local/VPS validation. Webhook is recommended when a stable public HTTPS endpoint and secret are available.

## Local test

1. Keep auto-publish false.
2. Use a test bot and test database.
3. Set `ADMIN_BASE_URL=http://localhost:5173`.
4. Run backend and frontend.
5. Create a draft through a mocked/manual safe path.
6. Verify the notification shows the blog ID and `/admin/blogs/:id`.
7. Test `/help`, `/whoami`, unauthorized approval, expiry, photo, and text fallback.

Automated tests mock Telegram HTTP and do not send real messages.

## VPS verification

1. Back up environment values and database.
2. Deploy code without enabling cron or Telegram.
3. Set `ADMIN_BASE_URL` to the actual admin origin.
4. Configure allowlists and either polling or webhook.
5. Start with `TELEGRAM_BOT_ENABLED=true` and blog auto-publish false.
6. Create one test draft, inspect the image/link/caption, reject it, then test one controlled approval.
7. Enable normal scheduling only after audit records and idempotency are confirmed.

## Troubleshooting

- `telegram_disabled`: enabled flag or token missing.
- `no_notify_chat_ids`: notification/allowed chat IDs missing.
- `Unauthorized Telegram account`: caller ID not allowlisted; use `/whoami`.
- `Invalid Telegram webhook secret`: registered and server secrets differ.
- `photo_failed_text_sent`: inspect stored image error; text approval remains valid.
- Admin link wrong: correct `ADMIN_BASE_URL`; trailing slash is normalized.
- Approval expired: create a new draft execution/approval; do not edit expiry in production.

## Rollback

Set `TELEGRAM_BOT_ENABLED=false`, remove the webhook at BotFather/API if applicable, restart the backend, and revert the Telegram feature commit. Drafts remain available in the admin editor. Existing approval records can remain for audit and do not require destructive migration.
