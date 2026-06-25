# Daily Inoxpran SEO Blog Workflow

Run the daily Inoxpran SEO blog workflow.

Rules:
1. Do not publish directly unless `SEO_AGENT_AUTO_PUBLISH=true`.
2. Do not use the admin UI.
3. Do not write directly to MongoDB.
4. Do not invent product claims.
5. Use Vietnamese by default.
6. Prefer useful evergreen SEO topics:
   - how to choose inox 304 cookware
   - how to clean stainless steel pots
   - induction-compatible stainless cookware
   - inox 304 vs inox 201
   - why stainless steel pans may stick
   - how to maintain cookware
   - common mistakes when using stainless cookware
   - practical homeware buying tips for Vietnamese families
7. Avoid duplicate topics from the existing sitemap and blog list.
8. Output all intermediate artifacts: research JSON, SEO brief JSON, content HTML, review JSON, publish result JSON, and QA report JSON.

Workflow:
1. Ask `keyword-researcher` to produce 3 topic candidates.
2. Ask `seo-strategist` to choose 1 topic and create the brief.
3. Ask `content-writer` to write the article.
4. Ask `seo-reviewer` to review it.
5. If review passes, ask `publisher` to publish only when auto publish is enabled. Otherwise ask `publisher` to create draft only.
6. Ask `qa-agent` to verify the resulting URL if publishing happened.
7. Ask `reporter` to summarize.

Final report in Vietnamese:
- Topic
- Primary keyword
- URL or draft ID
- SEO score
- Publish or draft status
- Reason for not publishing, if any
- QA checklist
- Manual review tasks
