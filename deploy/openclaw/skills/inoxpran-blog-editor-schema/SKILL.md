# inoxpran-blog-editor-schema

Description: Shared blog content contract. Every agent that produces or reviews blog HTML MUST follow this so the output is compatible with the Inoxpran professional editor (Tiptap) and passes the backend sanitizer without data loss.

## Content contract

- `contentSchemaVersion`: `blog-content-v2`
- `editorType`: `professional`
- Source of truth is **HTML** (not Markdown). The API expects HTML in `contentHtml`.

## Allowed semantic HTML

Only these tags survive the sanitizer. Anything else is stripped.

- Text & structure: `p`, `br`, `strong`, `em`, `u`, `s`, `blockquote`, `hr`
- Headings: `h2`, `h3`, `h4`, `h5`, `h6` (NEVER `h1`)
- Lists: `ul`, `ol`, `li` (task lists: `ul[data-type="taskList"]` with `li[data-type="taskItem"][data-checked]`)
- Code: `pre`, `code`
- Links: `a[href]`
- Images: `figure`, `img`, `figcaption`
- Tables: `table`, `thead`, `tbody`, `tr`, `th`, `td` (`th`/`td` may use `colspan`/`rowspan`)

## Heading hierarchy

- The blog **title is the only H1**; it lives outside `contentHtml`. Never emit `<h1>` inside the article body.
- Body starts at `H2` for main sections (use 3–6 `H2`).
- `H3` for subsections, `H4` for deeper points.
- Do not skip levels (an `H2` must not be followed directly by an `H4`).

## Image node format

Every inline/cover image uses a `figure`. Each image MUST carry a stable `data-image-id`.

```html
<figure
  data-image-id="inline-ab12cd34"
  data-source-type="ai"
  data-review-status="pending_review"
>
  <img
    src="https://…/image.webp"
    alt="Mô tả ảnh có ý nghĩa"
    title="Tiêu đề ảnh"
    width="1200"
    height="675"
    loading="lazy"
    decoding="async"
    data-image-id="inline-ab12cd34"
    data-source-type="ai"
    data-review-status="pending_review"
  />
  <figcaption>Chú thích ảnh ngắn gọn.</figcaption>
</figure>
```

- `data-source-type`: one of `ai`, `pexels`, `upload`, `manual` (legacy `ai_generation` / `licensed_search` also accepted).
- `data-review-status`: agentic images default to `pending_review`; only a human/reviewer sets `approved`/`rejected`/`replaced`.
- `imageId` must match between `figure` and its `img`.
- Image `src` must be an internal `/…` path or an HTTPS URL on a trusted host.

## Table rules

- Semantic only: `table > thead > tr > th` for the header row, `tbody > tr > td` for data.
- Include a header row. Keep tables simple; the frontend makes them horizontally scrollable.
- No inline `style` on table elements.

## Link rules

- Use valid URLs: internal `/path` or `https://…`. No `javascript:` URLs.
- External links get `target="_blank"` and `rel="noopener noreferrer nofollow"` on save — do not fight this.

## Forbidden

- `h1` inside content.
- `script`, `iframe`, `form`, `style` tags, or any `on*` event handler attribute.
- `javascript:` URLs, untrusted external SVG.
- Unsafe inline styles (only `text-align` on blocks and `color` on `span` survive).
- Markdown syntax when HTML is expected.
- Wrapping the whole document in ``` fences.
- Explanations, notes, or raw JSON mixed inside `contentHtml`.

## Editor compatibility

- Content is opened, edited, and re-saved in the Tiptap professional editor; it must round-trip losslessly.
- Use `figure`/`figcaption` for images + captions (never a bare `img` when a caption exists).
- Use semantic tables (they map to the editor's table node).
- Keep paragraphs reasonably short and readable.
- Always pass content through the backend sanitizer before saving (never bypass it).
