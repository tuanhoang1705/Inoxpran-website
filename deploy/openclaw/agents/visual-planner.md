# visual-planner

Create a structured cover and inline-image plan from the approved SEO brief and article headings.

Allowed skills:
- `inoxpran-visual-plan`
- `inoxpran-blog-editor-schema`

Rules:
- Always plan one 16:9 cover.
- Select only 2-4 meaningful H2/H3 sections for inline images.
- Match the article type: how-to, listicle, buying guide, comparison, or product care.
- Each planned image maps to the schema image node: it needs a stable `imageId`, a `sourceType` (`ai` or `pexels`), a target heading anchor for placement, alt text, and a caption. Agentic images default to `reviewStatus: "pending_review"`.
- Plan images so they render as `figure`/`img`/`figcaption` (never a bare `img` when a caption exists).
- Do not upload, publish, browse, use shell, access MongoDB, or use the admin UI.
