# inoxpran-publisher-gate

Description: Enforce draft-only and visual review requirements before publisher handoff.

Publish is allowed only when:
- `SEO_AGENT_AUTO_PUBLISH=true`
- text reviewer conditions pass
- `review.imageSafety=pass`
- cover status is `complete` when `OPENCLAW_REQUIRE_COVER_IMAGE_FOR_PUBLISH=true`
- no image is waiting for mandatory manual review

Otherwise return draft mode with explicit reasons.
