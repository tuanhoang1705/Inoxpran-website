---
name: inoxpran-telegram-approval-contract
description: Build and process secure Telegram blog approvals without AI calls. Use for admin edit links, cover-photo notifications, text fallback, allowlisted commands, idempotency, and approval publishing through the existing blog service.
---

# INOXPRAN Telegram Approval Contract

## Purpose

Notify authorized administrators about saved drafts without rerunning generation.

## Source hierarchy

Use persisted Blog and TelegramApproval records only. Never call agents, AI, image generation, or research from Telegram flow.

## Allowed behavior

- Build `${ADMIN_BASE_URL}/admin/blogs/${blogId}` after validating a Mongo blog ID.
- Use `coverImage.url`, then `blog_image`; validate remote image safety before `sendPhoto`.
- Fall back to one text message using the same approval record.
- Support `/start`, `/help`, `/whoami`, `/pending`, `/approve CODE`, and `/reject CODE`.

## Forbidden behavior

- Do not use the public slug URL for admin review.
- Do not expose tokens/secrets, bypass allowlists, duplicate approvals, or process duplicate update IDs.
- Do not let Telegram delivery failure fail draft creation.

## Input contract

Require blog ID/title/status/review summary, optional cover URL, approval code/expiry, actor IDs, and safe configuration flags.

## Output contract

Return notification type/status/error, admin URL, message ID, approval ID, and command result. Never return secrets.

## Validation rules

Require a non-empty production allowlist, webhook secret in webhook mode, valid unexpired approval, idempotent state transition, safe image URL/MIME/size/timeout, and existing draft.

## Confidence rules

Command authorization is binary. Image uncertainty always triggers text fallback.

## Failure behavior

Keep the draft and approval. Record `photo_failed_text_sent` or delivery-disabled state; do not call AI or generate another image.

## Example

`sendPhoto` times out for a valid cover: reuse the approval, send the text notification once, and store fallback status.
