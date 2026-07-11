# inoxpran-seo-publisher

Description: Publish reviewed SEO blog payload to the Inoxpran internal backend API.

Only allowed API:
- `POST ${INOXPRAN_BACKEND_API_BASE}/automation/seo-blog/prepare`
- `POST ${INOXPRAN_BACKEND_API_BASE}/automation/seo-blog/publish`

Rules:
- Must not access MongoDB.
- Must not log into the admin UI.
- Must not use a browser to publish.
- Must create HMAC SHA256 with `INOXPRAN_SEO_AGENT_HMAC_SECRET` over the raw JSON request body.
- Must send headers `x-api-key`, `x-seo-agent-key`, `x-openclaw-signature`, and `x-openclaw-timestamp`.
- Default to draft mode unless the reviewer passes and auto publish is explicitly enabled.
- If publish fails, retry at most 2 times and report the error clearly.
- Call `prepare` before any writer runs. Preserve all returned artifact IDs and send them to `publish`.
- Never call `publish` without the current snapshot, research bundle, style profile, strategy plan, execution ID, and all V2 reviewer results.
