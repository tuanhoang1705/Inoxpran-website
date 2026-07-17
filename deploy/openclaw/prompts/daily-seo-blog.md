# Daily Inoxpran SEO Blog Workflow

Run the daily Inoxpran SEO blog workflow.

Rules:
0. Before any research or writing, call the authenticated `POST /automation/seo-blog/prepare` endpoint with the topic and product-seeding configuration. Stop if Google Intelligence or required product integration is blocked. Preserve all returned Google, product catalog/seed plan, research, style, strategy, and execution IDs unchanged.
1. Google Intelligence always runs first. Product catalog/relevance/seed planning runs second. Never query MongoDB/product-admin endpoints or select a product outside the persisted plan.
2. Default to draft-only.
3. Do not publish directly unless `SEO_AGENT_AUTO_PUBLISH=true` and the reviewer pass conditions are satisfied.
4. Do not use the admin UI.
5. Do not write directly to MongoDB.
6. Do not invent product claims.
7. Use Vietnamese by default.
8. Prefer useful evergreen SEO topics:
   - how to choose inox 304 cookware
   - how to clean stainless steel pots
   - induction-compatible stainless cookware
   - inox 304 vs inox 201
   - why stainless steel pans may stick
   - how to maintain cookware
   - common mistakes when using stainless cookware
   - practical homeware buying tips for Vietnamese families
8. Avoid duplicate topics from the existing sitemap and blog list.
9. Output all intermediate artifacts: `research.json`, `positioning.json`, `topicIdeas.json`, `seoBrief.json`, `contentHtml`, `imageBrief.json`, `review.json`, `publishResult.json`, and `qaReport.json`.
10. All blog HTML MUST follow the `inoxpran-blog-editor-schema` content contract (semantic HTML only, no `<h1>` in content, `H2`→`H3`→`H4` hierarchy with no skipped levels, `figure`/`img`/`figcaption` images with `data-image-id` and `data-review-status="pending_review"`, semantic tables, HTML not Markdown, no code fences) so it round-trips losslessly through the professional editor.

Workflow:
1. Ask `google-intelligence-gatekeeper` to validate the prepared daily snapshot.
2. Ask `topic-opportunity-researcher` for exactly `new`, `update`, `merge`, or `skip`; stop on `skip`.
3. Ask `industry-content-researcher` and `search-intent-analyst` to build multi-source abstract research and intent.
4. Ask `editorial-style-planner` for the daily profile and article sub-variant.
5. Ask `content-strategist` and `content-architect` to validate the persisted strategy and architecture.
6. Ask `content-writer` to write semantic Vietnamese HTML only after all four context IDs exist.
7. Ask the visual/image agents to plan, source/generate, annotate, and review images.
8. Ask `fact-checker`, `originality-reviewer`, `seo-reviewer`, `seo-aeo-geo-strategist`, `spam-risk-reviewer`, and `brand-voice-reviewer` to review the complete draft.
9. Ask `publisher-gatekeeper` to enforce every text, compliance, and image gate.
10. Ask `publisher` to call the publish endpoint only with the four context IDs and all reviewer results. Default to draft.
11. Ask `qa-agent` to verify published URLs or draft API shape, then ask `reporter` to summarize.

Reviewer pass conditions:
- `seoScore >= 85`
- `brandSafety = pass`
- `duplicateRisk != high`
- `claimRisk != high`
- `imageSafety = pass`
- `semanticHtml = pass`

Publisher payload requirements:
- `mode`: `draft` unless auto publish is explicitly enabled and reviewer passes.
- `source`: `openclaw-daily-seo`
- `title`, `slug`, `excerpt`, `contentHtml`, `seoTitle`, `seoDescription`, `categoryKey`
- `contentSchemaVersion`: `blog-content-v2` and `editorType`: `professional`
- `primaryKeyword`, `secondaryKeywords`, `tags`, `internalLinks`, `faq`
- `imageUrl`: generated/uploaded URL if available, otherwise `/og-image.png`.
- `articleType`, `outline`, and visual-plan metadata when available.
- `review`: include `seoScore`, `brandSafety`, `duplicateRisk`, `claimRisk`, and `imageSafety`.
- `metadata`: include agent run ID, source notes, positioning summary, topic score, and image brief.
- Required context: `googleIntelSnapshotId`, `googleIntelSnapshotDate`, `googleIntelStatus`, `researchBundleId`, `editorialStyleProfileId`, `strategyPlanId`, and `agenticExecutionId`.
- Required review additions: `factuality`, `originality`, `peopleFirst`, `spamRisk`, and `seoAeoGeo`.

Final report in Vietnamese:
- Topic
- Primary keyword
- Draft ID or URL
- SEO score
- Publish or draft status
- Reason for not publishing, if any
- Image mode and fallback image URL
- QA checklist
- Manual review tasks
