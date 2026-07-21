# OpenClaw Daily Draft + Professional Blog Editor

> Content Operations V3 integration (2026-07-20): Daily Draft is now a control surface for an evidence-led action lifecycle, not a command to force one article per run. See [OpenClaw Content Operations Lifecycle V3](./openclaw-content-operations-lifecycle-v3.md).

## Content Operations integration

The dedicated operations page is `/admin/openclaw/content-operations`. It reuses the existing admin design system and exposes Today, opportunity candidates, Work Orders, the privacy-safe Content Signal Inbox, Content Inventory, monitoring/learning, and the schedule. All labels support VI/EN; source state is shown as available/unavailable/partial rather than replacing missing metrics with zero. Secrets, raw customer messages, PII, unrestricted analytics, and credential values are never rendered.

`/admin/openclaw/daily-draft` retains its existing product-seeding/editorial-placement controls and adds:

- schedule mode: `best_action`, backward-compatible `fixed_brief`, or `maintenance_only`;
- current Google and Content Operations snapshot state;
- selected action, Work Order, target, primary business goal, score, evidence, penalties, and warnings;
- Preview today's best action, Run selected Work Order, Run fixed brief, Maintenance only, and an explicit successful `skip` result.

Preview is non-mutating. It may read/reuse safe daily planning state but must not invoke the writer, create/update a blog or live revision, generate images, publish, send Telegram, or save a schedule unless the administrator explicitly saves it. Product controls appear only after a topic and intent exist. A normal run persists decision -> Work Order -> Unified Brief before product, research, strategy, or writer artifacts.

Schedules persist source requirements, minimum score, allow-skip, draft-only mode, maximum tasks/day, and monitoring windows. The initial production rollout keeps `CONTENT_OPERATIONS_CRON_ENABLED=false`, learning auto-apply off, and SEO auto-publish off; a controlled preview is used for verification before any scheduler enablement.

## Product Integration in Blog Schedules

The Daily Draft Schedule form persists `agentConfig.productSeeding`: enable/mode/intensity, selection maxima, preferred category/product IDs, exclusions, out-of-stock opt-in, threshold and Auto fallback. “Preview suitable products” calls the authenticated admin preview API and shows deterministic score evidence/rejections. Execution history exposes catalog/plan IDs and safe reviewer summaries. Recommendations remain semantic sanitized HTML; product images are not inserted by this feature. See `openclaw-product-seeding-intelligence.md`.

Branch: `feature/openclaw-daily-draft-professional-editor`

This change has two parts: (A) moving the OpenClaw Daily Draft + Blog Schedules into a dedicated child page, and (B) turning the blog editor into a professional editor whose output is compatible with the Agentic pipeline (C) and the public site (D).

## A. Daily Draft page

- New route: `/admin/openclaw/daily-draft` (inherits the `/admin` auth guard).
- The `/admin/openclaw` **"Chạy daily draft" card now navigates** to that page (description: *"Chạy ngay hoặc quản lý lịch tạo bài / Run now or manage blog schedules"*). It no longer starts a blog run on click.
- The child page has: a Back button, header, **Run daily draft now** (confirmation dialog showing publishing mode + effective config + an auto-publish warning; reuses `POST /admin/api/openclaw/runs {action:'daily-draft'}` with loading state and no double-submit), a **system status** panel (SEO agent / Blog cron / Auto-publish / Telegram-with-missing-config / gateway), and the full **Blog Schedules** panel.
- Blog Schedules was extracted into `frontend/src/lib/components/admin/openclaw/BlogSchedulesPanel.svelte` and removed from `/admin/openclaw` (no duplicate UI). It keeps all CRUD + enable/pause + run-now + executions.
- **Two run-now actions are distinct:** default daily draft (`/runs`, no scheduleId) vs. **Run this schedule now** (`/blog-schedules/{id}/run-now`, structured execution).

## B. Professional editor

The editor was already **Tiptap v3**; this extends it (no engine swap).

- `frontend/src/lib/components/RichTextEditor.svelte` — full toolbar: undo/redo, heading dropdown (P/H2–H6), bold/italic/underline/strike/inline-code, bullet/ordered/task lists, align L/C/R/justify, blockquote/code-block/HR, link (new-tab + remove), image, table (+ contextual row/col ops), color, clear, **preview + fullscreen**. Plus an **SEO stats bar** (words, characters, reading time, headings, no-H2 & bad-hierarchy warnings). Bilingual (vi/en) labels.
- Extensions added: `@tiptap/extension-table` (+ row/header/cell), `@tiptap/extension-task-list`/`task-item` (pinned to 3.15.3 to match core).
- `frontend/src/lib/editor/figureNode.js` — custom **Figure node** preserving `<figure><img><figcaption>` + metadata (imageId, sourceType, reviewStatus, width/height) with editable inline captions.
- `frontend/src/lib/editor/blogContentAdapter.js` — shared adapter: `normalizeLegacyBlogContent` (adds stable `imageId` + lazy/async, **only when missing** — never rewrites content just because it was opened), `computeContentStats`, `buildImageId`, `CONTENT_SCHEMA_VERSION = "blog-content-v2"`.
- **Hydration fix (blank-editor root cause):** the sync `$effect` now reads `value` + `ready` first, so async content that arrives after mount is applied instead of leaving the editor blank.
- Agentic image review (approve/reject/edit bubble), image upload/drop/paste, and manual-vs-agentic behavior are preserved. Manual posts do not show agentic controls.
- **Document outline** (`TOC` popover): lists H2–H4, click scrolls to the heading; updates as headings change.
- **Image alt/title dialog** (`ℹ`, enabled when an image/figure is selected) plus inline figure caption editing.
- **Autosave** (existing posts only): debounced 2.5s, content-only, dirty-state aware, with `Unsaved / Saving… / Saved / Save failed` status in the stats bar. Backed by a new JSON endpoint `frontend/src/routes/admin/api/blogs/[postId]/+server.js` (PATCH) that forwards a partial content update to the backend — no duplicate records, never fires before hydration or when unchanged.

## Sanitizer (security source of truth)

Both paths were widened (security model intact — hosts/links unchanged):

- `backend/src/services/blog.service.js` (manual editor): now allows `table/thead/tbody/tr/th/td`, `pre`, `code`, `hr`, image `data-source-type`/`data-review-status`, and task-list `data-type`/`data-checked`.
- `backend/src/utils/seoBlogSanitizer.js` (agentic ingest): adds `br/u/s/h5/h6/pre/code/hr` + the same image/table/task-list attributes.
- Still blocked: `script`, `iframe`, `form`, `style` tags, `on*` handlers, `javascript:` URLs.

## C. Agent contract

- New skill `deploy/openclaw/skills/inoxpran-blog-editor-schema/SKILL.md` documents the content contract: allowed semantic HTML, heading hierarchy (no H1 in body, no skipped levels), the `figure`/`img`/`figcaption` image node with `data-image-id` + `data-review-status="pending_review"`, table rules, link rules, and forbidden HTML.
- Updated `content-writer`, `seo-reviewer` (adds a `semanticHtml` gate), and `visual-planner` agents; the `daily-seo-blog` prompt references the schema, adds `semanticHtml=pass` to reviewer pass conditions, and adds `contentSchemaVersion: blog-content-v2` / `editorType: professional` to the publisher payload.
- Registered the skill in `deploy/openclaw/openclaw.json5` (global allowlist + seo-orchestrator/content-writer/visual-planner/seo-reviewer). Backend ingest ignores the extra `contentSchemaVersion`/`editorType` fields (no rejection).

## D. Public rendering

- `frontend/src/lib/components/RichTextDisplay.svelte` now styles `figure`/`figcaption` and task lists, and wraps `<table>` in a horizontally scrollable container (`.rtd-table-scroll`) so wide tables never force the page to scroll sideways on mobile.

## Verification performed

- `frontend`: `npm run build` ✓ (green after each step).
- `backend`: `npx vitest run` ✓ **74/74** tests pass (sanitizer, image pipeline, agentic review, schedules, telegram).
- Routes: `/admin/openclaw` and `/admin/openclaw/daily-draft` return 303 (auth guard); blog editor routes 303; backend healthy (403, not 500).
- `openclaw.json5` validated with the JSON5 parser (18 agents, schema skill registered in 4 agents).

## Local testing

```
cd backend  && npx vitest run
cd frontend && npm run build
```
Then log in to `/admin`, open an existing blog post, confirm content loads (not blank), exercise headings/tables/lists/links/images/preview/fullscreen, save, reopen, and confirm no content loss. Open `/admin/openclaw/daily-draft` to test run-now + schedules.

## Deferred / known limitations

- Editor: slash-command Add-Block, and richer image metadata fields (author/license/prompt/model live in `contentImages`, not inline attrs — the dialog covers alt/title + caption).
- Backend does not yet persist `contentSchemaVersion`/`editorType` (optional metadata; HTML remains source of truth).
- `RichTextEditor` is shared with the product editor; the product sanitizer would strip the new table/code output there unless widened too.
- Autosave saves content only (not title/excerpt/meta); the manual **Update** button remains the full save.
- Automated e2e/regression suites (G/H) not added in this phase; verification was build + backend unit tests + route checks + manual steps above.

## Rollback

- The work is isolated on the branch. To revert the editor only, restore `frontend/src/lib/components/RichTextEditor.svelte` and remove `frontend/src/lib/editor/*`; the sanitizer widening is backward-compatible and safe to keep. To revert the Daily Draft move, restore `frontend/src/routes/admin/openclaw/+page.svelte` and delete `frontend/src/routes/admin/openclaw/daily-draft/` + `BlogSchedulesPanel.svelte`.
