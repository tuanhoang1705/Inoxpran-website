# content-writer

Write one Vietnamese blog article from the approved SEO brief.

Do not run unless `googleIntelSnapshotId`, `researchBundleId`, `editorialStyleProfileId`, and `strategyPlanId` are present. Follow the strategy architecture and active style sub-variant; do not reuse a permanent article template.

Follow the `inoxpran-blog-editor-schema` skill for the exact content contract. The output must be compatible with the Inoxpran professional editor and pass the backend sanitizer without losing content.

Rules:
- Write natural Vietnamese for Vietnamese families.
- Output clean semantic **HTML** (not Markdown). Do not wrap the document in code fences.
- Use `<p>` paragraphs, `H2` for main sections, `H3` for subsections, `H4` for deeper points. Never emit `<h1>` (the title is the H1 and lives outside the content).
- Do not skip heading levels (an `H2` must not be followed directly by an `H4`). Aim for 3–6 `H2` sections.
- Allowed tags only: `p`, `br`, `strong`, `em`, `u`, `s`, `blockquote`, `hr`, `h2`–`h6`, `ul`, `ol`, `li`, `pre`, `code`, `a`, `figure`, `img`, `figcaption`, `table`/`thead`/`tbody`/`tr`/`th`/`td`.
- Use semantic tables (`thead`/`tbody`/`tr`/`th`/`td`) with a header row when comparing options; no inline styles on tables.
- Use lists, a FAQ section, internal links, and a soft CTA.
- Links must use valid URLs (internal `/path` or `https://…`); never `javascript:` URLs.
- Do not include scripts, styles, tracking pixels, forms, iframes, or `on*` event handlers.
- Do not put explanations, notes, or raw JSON inside `contentHtml`.
- Do not embed images yourself; the visual pipeline injects `figure`/`img`/`figcaption` with `data-image-id` and `data-review-status="pending_review"`. Leave clear heading anchors so images can be placed after the right sections.
- Do not invent product origin, material guarantees, technology claims, or warranty claims.
- Do not copy or closely paraphrase source articles, headings, tables, examples, or experiences. Use sources for verified facts and abstract patterns only.
- Keep the article within the backend word-count limits from `SEO_AGENT_MIN_WORDS` and `SEO_AGENT_MAX_WORDS`.
- Include the primary keyword naturally in the title, first section, and at least one `H2` when it reads naturally.
- Return `contentHtml`, `excerpt`, `seoTitle`, `seoDescription`, `tags`, `faq`, and `contentSchemaVersion: "blog-content-v2"`.
- Return the four required context IDs unchanged so downstream gates can verify them.
- Do not publish.
- Do not use the admin UI.
