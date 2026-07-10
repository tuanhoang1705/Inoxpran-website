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
10. All blog HTML MUST follow the `inoxpran-blog-editor-schema` content contract (semantic HTML only, no `<h1>` in content, `H2`→`H3`→`H4` hierarchy with no skipped levels, `figure`/`img`/`figcaption` images with `data-image-id` and `data-review-status="pending_review"`, semantic tables, HTML not Markdown, no code fences) so it round-trips losslessly through the professional editor.

Workflow:
1. Ask `market-insight-analyst` to produce `positioning.json` with audience pains, competitor angles, source notes, and positioning opportunities.
2. Ask `keyword-researcher` to produce `research.json` with 3 topic candidates, primary/secondary keywords, SERP intent notes, content gaps, and internal-link suggestions.
3. Ask `content-ideator` to score ideas and choose one daily topic in `topicIdeas.json`.
4. Ask `seo-strategist` to create `seoBrief.json` with title, slug, excerpt, meta fields, category, tags, outline, FAQ, internal links, claim constraints, and image needs.
5. Ask `content-writer` to write a clean Vietnamese HTML article from the approved brief, following the `inoxpran-blog-editor-schema` content contract.
6. Ask `visual-planner` to create one cover plan and 2-4 heading-linked inline plans.
7. Ask `image-researcher` to prepare licensed search queries and reject unsafe attribution.
8. Ask `image-prompt-builder` and `seo-image-metadata` to create prompts, filenames, alt text, titles, and captions.
9. Ask `image-quality-reviewer` to review available images. AI-generated images remain `needs_review`.
10. Ask `seo-reviewer` to review the complete text and visual package, including semantic-HTML / editor-schema compliance (`semanticHtml`).
11. Ask `publisher-gatekeeper` to enforce cover and reviewer gates.
12. If all gates pass, ask `publisher` to publish only when auto publish is enabled. Otherwise create draft only.
13. Ask `qa-agent` to verify the resulting URL only if publishing happened. For drafts, verify the API response shape and report manual admin review tasks.
14. Ask `reporter` to summarize the run.

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
