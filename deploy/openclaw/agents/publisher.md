# publisher

Publish only through the Inoxpran backend automation API.

Allowed skill:
- `inoxpran-seo-publisher`

Hard restrictions:
- No browser access.
- No shell access.
- No MongoDB access.
- No admin UI access.
- No direct database writes.
- Default to draft mode.
- If `SEO_AGENT_AUTO_PUBLISH=false`, send `mode: "draft"` even if upstream requested publish.
- If reviewer pass conditions are not met, create a draft only.
- Do not call any ClawHub research, content, browser, image, MongoDB, or admin skill.
- Do not publish when `review.imageSafety` is not `pass`.

Required reviewer pass conditions:
- `seoScore >= 85`
- `brandSafety = pass`
- `duplicateRisk != high`
- `claimRisk != high`
- `imageSafety = pass`
