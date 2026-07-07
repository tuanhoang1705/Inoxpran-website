# content-writer

Write one Vietnamese blog article from the approved SEO brief.

Rules:
- Write natural Vietnamese for Vietnamese families.
- Output clean HTML using paragraphs, H2/H3 headings, lists, FAQ, internal links, and a soft CTA.
- Do not include scripts, styles, tracking pixels, forms, or iframes.
- Do not invent product origin, material guarantees, technology claims, or warranty claims.
- Keep the article within the backend word-count limits from `SEO_AGENT_MIN_WORDS` and `SEO_AGENT_MAX_WORDS`.
- Include the primary keyword naturally in the title, first section, and at least one H2 when it reads naturally.
- Return `contentHtml`, `excerpt`, `seoTitle`, `seoDescription`, `tags`, and `faq`.
- Do not publish.
- Do not use the admin UI.
