# Daily Inoxpran SEO Blog Workflow

Run the daily Inoxpran SEO blog workflow.

Rules:
1. Default to draft-only.
2. Do not publish directly unless `SEO_AGENT_AUTO_PUBLISH=true` and the reviewer pass conditions are satisfied.
3. Do not use the admin UI.
4. Do not write directly to MongoDB.
5. Do not invent product claims.
6. Use Vietnamese by default.
7. Prefer useful evergreen SEO topics:
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

Workflow:
1. Ask `market-insight-analyst` to produce `positioning.json` with audience pains, competitor angles, source notes, and positioning opportunities.
2. Ask `keyword-researcher` to produce `research.json` with 3 topic candidates, primary/secondary keywords, SERP intent notes, content gaps, and internal-link suggestions.
3. Ask `content-ideator` to score ideas and choose one daily topic in `topicIdeas.json`.
4. Ask `seo-strategist` to create `seoBrief.json` with title, slug, excerpt, meta fields, category, tags, outline, FAQ, internal links, claim constraints, and image needs.
5. Ask `content-writer` to write a clean Vietnamese HTML article from the approved brief.
6. Ask `image-planner` to create `imageBrief.json` with prompt, alt text, caption, filename slug, safe fallback image URL, and provider notes. Use `prompt_only` unless a verified image provider is configured.
7. Ask `seo-reviewer` to review the complete package: brief, HTML, image brief, source notes, and metadata.
8. If review passes, ask `publisher` to publish only when auto publish is enabled. Otherwise ask `publisher` to create draft only.
9. Ask `qa-agent` to verify the resulting URL only if publishing happened. For drafts, verify the API response shape and report manual admin review tasks.
10. Ask `reporter` to summarize the run.

Reviewer pass conditions:
- `seoScore >= 85`
- `brandSafety = pass`
- `duplicateRisk != high`
- `claimRisk != high`
- `imageSafety = pass`

Publisher payload requirements:
- `mode`: `draft` unless auto publish is explicitly enabled and reviewer passes.
- `source`: `openclaw-daily-seo`
- `title`, `slug`, `excerpt`, `contentHtml`, `seoTitle`, `seoDescription`, `categoryKey`
- `primaryKeyword`, `secondaryKeywords`, `tags`, `internalLinks`, `faq`
- `imageUrl`: generated/uploaded URL if available, otherwise image brief fallback URL.
- `review`: include `seoScore`, `brandSafety`, `duplicateRisk`, `claimRisk`, and `imageSafety`.
- `metadata`: include agent run ID, source notes, positioning summary, topic score, and image brief.

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
