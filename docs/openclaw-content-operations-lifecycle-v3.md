# OpenClaw Content Operations Lifecycle V3

Date: 2026-07-20
Timezone: `Asia/Ho_Chi_Minh`
Scope: INOXPRAN content planning, drafting, maintenance, publishing readiness, verification, monitoring, and learning.
Canonical document: `docs/openclaw-content-operations-lifecycle-v3.md`.

## 1. Why V3 exists

An article-generation-first system treats a cron event as a reason to publish. That can produce filler, duplicate intent, unnecessary URLs, stale product references, and rewrites that ignore a stronger maintenance opportunity.

V3 treats content as an operational portfolio. Each daily run asks what the highest-value safe action is, including the possibility that no work should be produced. Planning is evidence-led, persisted, reviewable, and draft-first. A schedule controls when the decision is evaluated; it does not force an article.

Core invariants:

- Google Intelligence remains the first mandatory gate.
- Content Operations Intelligence runs after Google and before product analysis, research, or writing.
- `unavailable` is different from a measured zero; missing metrics are never invented.
- Deterministic scores cannot be replaced by an LLM opinion.
- A Content Work Order and complete Unified Content Brief exist before downstream production work.
- `skip` is a successful, auditable result.
- Update, expand, and merge work is revision-safe and preserves the chosen canonical URL.
- High or critical Publish Readiness risk blocks automatic publishing.
- Production stays draft-only until an explicit, reviewed change enables publishing.

## 2. Human-like operating model and macro workflow

```text
Google Intelligence daily snapshot (mandatory strict gate)
  -> Content Operations Daily Snapshot
  -> inventory + performance + market + business/customer signals
  -> candidate generation and deterministic scoring
  -> one of 8 content actions
  -> Content Work Order
  -> Unified Content Brief
  -> product/relevance/placement artifacts when the action needs them
  -> research + intent + style + strategy + architecture + Evidence Map V2
  -> draft, scoped maintenance revision, or controlled skip
  -> existing quality/image/product gates
  -> Publish Readiness
  -> draft/approval/publish
  -> Post-Publish Verification
  -> performance snapshots
  -> learning recommendation for a future work order
```

The ordering is contractual. Google answers, "What Google guidance applies today?" Content Operations answers, "What is happening on the site, in the market, with customers, and inside the business today?" Product relevance answers only after the topic, intent, action, and business goal are known.

## 3. Daily Content Operations Snapshot

`ContentOperationsDailySnapshot` is unique and idempotent for `(snapshotDate, timezone)`. `ensureContentOperationsSnapshotForDate(currentDate)` runs only after `ensureGoogleIntelligenceSnapshotForDate(currentDate)`. A Mongo lease/distributed lock prevents concurrent builders from producing competing daily state. A fresh acceptable snapshot may be reused.

The upstream Google snapshot uses an owner token and monotonically increasing generation as well. Source baselines, changes, source health, and final snapshot state are written only by the current generation. If a worker crashes after committing the snapshot but before terminalizing its run, the next exact-generation caller reconciles the run from that completed snapshot instead of rebuilding it or leaving a false `running` record.

The persisted snapshot records:

- its Google Intelligence snapshot reference;
- status (`complete`, `partial`, or `failed`), checked time, content hash, source freshness, failures, warnings, and risks;
- 7-, 28-, and 90-day website-performance summaries when verified data exists;
- growing/declining pages, high-impression/low-CTR candidates, near-page-one opportunities, decay, and cannibalization candidates;
- inventory counts such as published/draft/stale/orphan articles, missing review dates, weak links, and outdated product references;
- aggregated product, inventory, campaign, sales, customer-support, internal-search, and seasonal signals;
- ranked opportunity inputs, without manufactured metrics.

Optional failures produce a `partial` snapshot when required internal data is still safe to use. A missing or invalid content inventory blocks `best_action`; a fixed brief may continue conservatively, but update/merge work still requires a validated target.

## 4. Data sources, adapters, and fallbacks

| Source | Trust and use | Safe fallback |
| --- | --- | --- |
| Google Intelligence | Mandatory daily policy/compliance gate; V3 reuses it and does not duplicate Google-source fetching. | Strict failure blocks the lifecycle. |
| Search Console | Verified, credential-backed, read-only adapter. Reads bounded query/page clicks, impressions, CTR, average position, date, device, and useful country dimensions for 7/28/90-day comparisons. Average position is not an exact rank. | Persist `configured=false`, `status=unavailable`, `fallback=true`; continue without fabricated values. |
| Aggregate analytics | Optional read-only page-level views, sessions/users, engagement, landing-page performance, product-link events, and conversion-assist events. | Mark unavailable and continue; do not persist user-level analytics. |
| Trends/market demand | Optional configured provider with source, checked time, range, confidence, and observed/inferred/verified classification. | Make no trend claim when unavailable; one article or social mention is not verified demand. |
| Product and inventory | Existing safe projections and deltas: activation, stock state, specification, URL, and suitability changes. | Existing product mode (`off`, `auto`, `required`) governs downstream behavior. Never expose cost, margin, supplier, reservation, customer, or raw stock calculations. |
| Content Signal Inbox | Aggregated manual/system signals from sales, support, product, inventory, campaign, manual input, or internal search. | Expire or dismiss safely; never accept raw customer conversation or PII. |
| Content Inventory | Bounded article metadata, hashes, headings, entities, links, fingerprints, relevant excerpts, review/indexability/freshness state. | Do not send the complete corpus to an LLM. Block unsafe target-changing actions if inventory cannot validate them. |

### Content Signal privacy contract

`ContentSignal` stores a summarized title/question/pain point/objection, related product/category references, priority, confidence, status, validity/expiry, bounded evidence, and actor/audit metadata. It must reject customer names, phone numbers, email addresses, order IDs, private chat bodies, personal health information, and unnecessary personal data.

### Content Inventory contract

`ContentInventorySnapshot` and bounded inventory items support duplicate-intent, cannibalization, stale/thin content, missing-section, orphan-link, broken-link, outdated evidence/product, inactive/out-of-stock product, and missing-review-date detection. Full raw article bodies are not a planning payload.

Each inventory rebuild acquires a bounded owner token with heartbeat and a monotonically increasing build generation. Item upserts and pruning are generation-fenced, and finalization is an owner compare-and-set, so a stale force-rebuild worker cannot overwrite or delete a newer inventory. Source/storage failures persist only bounded error codes; provider messages, URLs, credentials, and connection strings are never stored.

## 5. Eight supported actions

| Action | Meaning and production behavior |
| --- | --- |
| `new` | A distinct topic or intent requires a new canonical URL. |
| `update` | Existing intent is correct but facts or information are outdated; preserve blog identity and URL. |
| `expand` | Existing content is valid but lacks material questions, entities, evidence, sections, or use cases; preserve useful sections and URL. |
| `merge` | Overlapping pages compete for the same intent; plan one primary target, retained/reworked material, source URLs, and optional redirect recommendations. Never auto-delete or redirect. |
| `metadata_refresh` | The body substantially satisfies intent but title/meta/OG/snippet positioning needs evidence-backed improvement. Avoid body churn. |
| `internal_link_maintenance` | Improve the content graph using valid, moderate anchors and auditable additions/removals. |
| `content_maintenance` | Repair links/media/structured data, refresh evidence/review dates, or correct outdated product references. |
| `skip` | No sufficiently valuable and safe action exists. Finish successfully without product analysis, writer, image pipeline, blog creation, publisher, or Telegram. |

Metadata, internal-link, and maintenance work uses a scoped maintenance task/revision and does not invoke the full writer unless the planned change truly needs one.

## 6. Auditable opportunity scoring

The default positive score is a centralized weighted sum:

| Factor | Default weight |
| --- | ---: |
| User/search demand | 0.20 |
| Content gap | 0.15 |
| Existing performance opportunity | 0.15 |
| Business alignment | 0.15 |
| Freshness/maintenance urgency | 0.10 |
| Customer-question frequency | 0.10 |
| Product/campaign relevance | 0.05 |
| Evidence availability | 0.05 |
| Internal-link opportunity | 0.05 |

The persisted decision records every factor, positive evidence, penalty, missing/required data, risks, rejected alternatives, total score, and recommendation. Penalties cover cannibalization, weak evidence, duplicate intent, low user/business value, product conflicts, unsupported trends, recent similar publication/category overexposure, legal/claim risk, and effort beyond daily capacity.

Business priority or product availability alone cannot force content. Cron frequency cannot force a decision. Below-threshold or unsafe candidates resolve to `skip` when skip is allowed.

## 7. Work Order, Unified Brief, and business goals

`ContentWorkOrder` is the approved operational decision. It references the Google and Content Operations snapshots and selected decision, then records status, action, topic, target/merge sources, business goal, audience, funnel stage, intent, user problems/questions, score evidence, required sources/evidence, product policy, target date, owner/reviewer, success metrics, risks, warnings, reasons, and overrides.

Production claims use a unique ownership token. Execution binding, heartbeat renewal, artifact attachment, and terminal transitions are compare-and-set against that token; legacy unclaimed flows remain isolated and cannot write through an active claim.

Valid primary goals include organic traffic, customer education, product education, conversion assist, campaign support, sales enablement, customer-support reduction, topical authority, seasonal demand, content maintenance, and internal-link improvement. "Publish one article" is not a business goal. Every order has one primary goal and measurable success criteria.

`UnifiedContentBrief` translates the work order into a production contract: working title/language, audience/intent/questions, type/role/angle, terms/entities, gaps and existing-content references, target URL, link candidates, product rules, facts/forbidden claims/evidence, style/placement constraints, image/CTA/schema plans, success metrics, publish target, and reviews. The writer cannot accept only a topic and keyword; an incomplete brief blocks writing.

Every downstream Product Seed Plan, Editorial Product Placement Plan, Research Bundle, Blog Strategy Plan, architecture/evidence artifact, revision, and execution references `contentWorkOrderId` and the appropriate brief/version.

## 8. Evidence Map V2

Each material claim has an evidence key and one classification:

- `verified`: may be stated directly within source limits;
- `inferred`: must use explicit, cautious qualification;
- `unknown`: cannot be presented as fact;
- `conflicting`: blocks the claim.

Records include source type/URL or internal reference, checked time, confidence, allowed usage, required qualification, and `usable|restricted|blocked` status. Product specifications remain bound to the matching product snapshot. Ranking/bestseller claims retain the existing strict evidence and methodology requirements. Evidence artifacts store bounded extracts and references, not complete third-party works.

## 9. Revision-safe maintenance

- Update preserves the existing ID/canonical and records changed facts/sections while retaining approved content where possible.
- Expand adds only verified gaps, preserves useful sections, and reruns originality and quality gates over the combined document.
- Merge designates one primary URL and creates a retain/rewrite/remove plan for source material. Source blogs are not deleted and redirects are recommendations until repository support and a human-reviewed operation exist.
- Metadata refresh scopes mutation to metadata fields and preserves canonical.
- Internal-link maintenance records exact links added/removed and rejects manipulative anchors.

Changes to a live article are staged as an auditable revision. Preparing a draft must not unpublish the current version, reset its performance metrics, or overwrite the approved body. Applying/publishing a revision is a separate validated action.

## 10. Product layer in V3

Product Catalog Snapshot, deterministic relevance, Product Seed Plan, and Editorial Product Placement Plan run only after the Work Order and Unified Brief establish the action, topic, intent, business goal, and target. They are applicable to `new`, `update`, `expand`, and `merge` when product context is relevant. Maintenance actions use only the minimum required product checks. `skip` bypasses the layer.

Existing product safety remains intact: safe projections, claim evidence, cooldown, no-seed behavior, placement/naturalness review, disclosures, and the `off|auto|required` policy. Product data can support a user need; it cannot create one by itself.

## 11. Publish Readiness and post-publish lifecycle

`ContentPublishReadinessReport` is an additional final gate, not a replacement for existing reviews. It checks title/intent, slug, renderer H1/body hierarchy, metadata, canonical/indexability, internal/product/evidence links, images and alt text, product/disclosure claims, structured data, semantic HTML/mobile safety, sanitizer/security rules, revision targets, and requested draft/publish mode. The writer receives a bounded Evidence Map contract and must return an exact claim-to-evidence manifest. Readiness independently rejects missing manifests, excerpts absent from the final HTML, unrelated evidence, unqualified inferred claims, blocked evidence, and detected material claims without a mapping. It produces a risk level, category results, required fixes, and `publish|draft|rewrite|maintenance` recommendation. High or critical risk blocks auto-publish; a critical failure cannot be overridden.

After publication, `PostPublishVerification` performs one bounded technical check for expected HTTP status, canonical, title/meta, indexability, rendered content, cover/inline images, links, structured data, mobile-safe markup, encoding/i18n output, server errors, and approved revision identity. It does not request indexing unless explicitly configured, hammer the URL, or interpret immediate search absence as failure. Failure preserves the publication record and creates a visible maintenance alert.

Monitoring tasks capture immediate and configured `1d`, `7d`, `14d`, `30d`, and `90d` windows. Every claim atomically advances a generation; snapshot writes and task completion are fenced by both the private claim token and generation, so a reclaimed stale worker cannot overwrite the newer capture or mark it complete. Task completion commits before learning starts, and learning reads only snapshots whose ID and generation match a completed task. A later learning failure is isolated and audited without rolling back the authoritative performance capture. `ContentPerformanceSnapshot` keeps Search Console and analytics `configured` state beside nullable aggregate metrics, plus technical/content/product state. Unavailable values remain `null`, not zero.

`ContentLearningRecord` can recommend keep, expand, update, metadata refresh, internal-link work, product-reference replacement, merge, monitor longer, or no action. It enforces minimum age/sample thresholds, never unpublishes/deletes/merges/rewords facts automatically, and never rewrites deterministic weights. High-impact recommendations create one deduplicated `planned` Work Order tied to the prior snapshot/decision evidence; they never run it automatically. `CONTENT_LEARNING_AUTO_APPLY=false` is the safe default.

## 12. Admin UI and schedule modes

The operations page is `/admin/openclaw/content-operations` and reuses the existing admin design system with VI/EN labels. It covers Today, candidates, Work Orders, the signal inbox, inventory, monitoring/learning, and schedule controls. It displays source freshness/availability, artifact IDs, selection/rejection reasons, scores, penalties, warnings, current pipeline step, and next review dates without secrets or raw PII.

The existing `/admin/openclaw/daily-draft` page gains snapshot/action/work-order/business-goal context and explicit commands for Preview today's best action, Run selected Work Order, Run fixed brief, Maintenance only, and `skip`. Preview may ensure or reuse today's Google-first intelligence snapshots, but it does not persist a planning run, opportunity decision, Work Order, Unified Brief, writer/blog/image/Telegram/publisher artifact, or implicit schedule save.

Schedule modes:

- `best_action`: choose the highest-value safe daily action;
- `fixed_brief`: preserve backward-compatible scheduled topic/brief behavior;
- `maintenance_only`: permit update, expand, merge, metadata, internal-link, or maintenance actions only.

Schedules also persist source requirements, minimum score, allow-skip, draft-only, maximum tasks/day, and monitoring windows. Existing schedules without a mode are treated compatibly as fixed-brief schedules.

Each due slot has a deterministic execution key, but a live `running` execution is never recovered while its lease is valid. The scheduler and planning run heartbeat independent owner tokens, checkpoint ownership between persistence phases, guard terminal writes, and remove only artifacts proven to have been created by a stale planning run.

## 13. API contracts

Authenticated admin routes follow repository conventions:

```text
GET  /v1/api/admin/openclaw/content-operations/status
POST /v1/api/admin/openclaw/content-operations/run-now
GET  /v1/api/admin/openclaw/content-operations/snapshots
GET  /v1/api/admin/openclaw/content-operations/snapshots/:id
GET  /v1/api/admin/openclaw/content-opportunities
POST /v1/api/admin/openclaw/content-opportunities/preview
POST /v1/api/admin/openclaw/content-opportunities/:id/accept
POST /v1/api/admin/openclaw/content-opportunities/:id/dismiss
GET|POST /v1/api/admin/openclaw/content-work-orders
GET|PATCH /v1/api/admin/openclaw/content-work-orders/:id
GET|POST /v1/api/admin/openclaw/content-signals
PATCH /v1/api/admin/openclaw/content-signals/:id
GET  /v1/api/admin/openclaw/content-inventory
POST /v1/api/admin/openclaw/content-inventory/rebuild
GET  /v1/api/admin/openclaw/content-performance/:blogId
GET  /v1/api/admin/openclaw/content-learning/:blogId
GET|PATCH /v1/api/admin/openclaw/content-operations/schedule
POST /v1/api/admin/openclaw/content-operations/schedule/enable
POST /v1/api/admin/openclaw/content-operations/schedule/disable
```

All list routes require bounded pagination. Inputs are validated and return controlled 400/403/404/409 responses. Production error payloads never include stack traces, secrets, unrestricted analytics payloads, or customer data.

The HMAC-authenticated `POST /v1/api/automation/seo-blog/prepare` preserves prior V2 artifact IDs and adds Content Operations snapshot, inventory snapshot, decision, Work Order, Unified Brief, action/reason/target/merge sources/business goal/score. A `skip` response is successful and terminates before writer/blog creation. A maintenance response is scoped and does not require a full article unless planned.

Publish validation requires matching lifecycle, Google, product/placement, research, style, and strategy artifacts; a passing Readiness Report; the planned action; and exact target IDs. Update/expand cannot create a new URL unless explicitly planned. Existing raw-body HMAC/timestamp/API-key controls remain mandatory and use timing-safe verification; credentials are never returned or logged.

## 14. RBAC, audit, and observability

Scopes:

```text
content_operations.view
content_operations.run
content_operations.manage_schedule
content_operations.override_decision
content_signal.view
content_signal.manage
content_inventory.view
content_inventory.rebuild
content_work_order.view
content_work_order.manage
content_work_order.approve
content_performance.view
content_learning.view
content_learning.manage
```

`ADMIN`/`SUPER_ADMIN` fallback follows existing repository conventions. Overrides require explicit permission, a reason, and an audit record. No override bypasses Google strict failure, security validation, factual/product claim failure, image-review gate, or critical Readiness failure.

An execution records correlation ID, all snapshot/decision/work-order/brief/downstream artifact IDs, candidate and rejected decisions, steps/times, source health/freshness, warnings/errors, reviewer decisions, override reason, readiness, final publisher result, verification, monitoring tasks, and learning recommendations. Audit request metadata is bounded; if an IP fingerprint is retained, it is HMAC-derived rather than storing the raw IP. Never log credentials, raw customer messages/PII, user-level analytics, full copyrighted sources, or private product/inventory fields.

## 15. Environment and safe defaults

The authoritative names are in `.env.example`; configuration is parsed and clamped centrally. Representative rollout settings:

```dotenv
CONTENT_OPERATIONS_ENABLED=true
CONTENT_OPERATIONS_TIMEZONE=Asia/Ho_Chi_Minh
CONTENT_OPERATIONS_CRON_ENABLED=false
CONTENT_OPERATIONS_DAILY_TIME=06:30
CONTENT_OPERATIONS_SNAPSHOT_TTL_HOURS=24
CONTENT_OPERATIONS_MAX_ACTIONS_PER_DAY=1
CONTENT_OPERATIONS_MIN_OPPORTUNITY_SCORE=0.65
CONTENT_OPERATIONS_ALLOW_SKIP=true

CONTENT_INVENTORY_ENABLED=true
CONTENT_INVENTORY_SNAPSHOT_TTL_HOURS=24
CONTENT_INVENTORY_STALE_DAYS=180
CONTENT_INVENTORY_REVIEW_DAYS=90
CONTENT_SIGNALS_ENABLED=true
CONTENT_SIGNAL_DEFAULT_TTL_DAYS=90
CONTENT_SIGNAL_MAX_LENGTH=2000

SEARCH_CONSOLE_ENABLED=false
CONTENT_ANALYTICS_ENABLED=false
CONTENT_TRENDS_ENABLED=false
CONTENT_TRENDS_PROVIDER=disabled

CONTENT_PUBLISH_READINESS_ENABLED=true
CONTENT_POST_PUBLISH_VERIFY_ENABLED=true
CONTENT_PERFORMANCE_MONITORING_ENABLED=true
CONTENT_MONITOR_WINDOWS=1d,7d,14d,30d,90d
CONTENT_LEARNING_ENABLED=true
CONTENT_LEARNING_AUTO_APPLY=false
SEO_AGENT_ENABLED=false
SEO_AGENT_AUTO_PUBLISH=false
OPENCLAW_BLOG_CRON_ENABLED=false
OPENCLAW_IMAGE_PIPELINE_ENABLED=false
TELEGRAM_BOT_ENABLED=false
```

The nine `CONTENT_ACTION_WEIGHT_*` values are the weights in section 6. Code, Compose defaults, and `.env.example` fail closed for monitoring and learning; the reviewed production rollout explicitly sets those two flags to true only while the top-level Content Operations flag is true. During initial production verification, keep the V3 and legacy Blog crons, SEO writer endpoint, image pipeline, Telegram bot, learning auto-apply, and SEO auto-publish off. These controls are independent: draft-only does not by itself disable the writer, image generation, Telegram approval, or an already persisted schedule. Google/Search Console service-account JSON is mounted read-only at runtime and excluded from image build context; never commit or print it.

## 16. Retention and privacy

- Daily snapshots, decisions, Work Orders, revisions, readiness/verifications, monitoring, learning, and audit records are operational evidence. Rollback does not delete them automatically.
- Signals carry `expiresAt`; the default operational TTL is 90 days. Expiry changes eligibility, while deletion/archival follows an explicit organizational retention policy.
- Source excerpts and research abstractions are bounded. Do not store full third-party articles or send the complete content corpus to an LLM.
- Analytics and Search Console are aggregate/read-only. Persist only dimensions and metrics needed for the lifecycle.
- Secrets stay in the VPS environment or read-only runtime secret mount. UI/API/log output exposes configuration state, not values.
- Existing drafts are retained through rollback. No destructive migration, collection purge, or automatic content deletion is part of V3.

Before adopting a destructive retention policy, export required audit evidence and obtain owner approval. Database TTL deletion must not be inferred merely from a signal expiry date.

## 17. Failure policy

| Failure | Required behavior |
| --- | --- |
| Google strict gate | Block all V3 work. |
| Optional source | Mark partial/unavailable and continue only when mandatory internal data is valid. |
| Inventory unavailable | Block `best_action`; fixed brief is conservative; never target update/merge blindly. |
| No valuable candidate | Controlled `skip`, no filler. |
| Missing Work Order/incomplete Brief | Block writer. |
| Product layer | Preserve existing `off|auto|required` outcome. |
| Monitoring source unavailable | Leave task pending and metrics null; do not infer failure. |
| Learning failure | Store warning; do not affect publication or weights. |

## 18. Local verification

Use the repository package manager/lockfiles and keep provider, Telegram, cron, and publishing effects disabled during tests.

```powershell
Set-Location backend
npm.cmd test
Set-Location ../frontend
npm.cmd run build
Set-Location ..
docker compose config --quiet
git diff --check
```

Required coverage includes date/timezone idempotency and leases, unavailable-vs-zero adapters, safe signal validation, inventory projections, all eight decisions/scores/penalties/skip, artifact ordering and relationship validation, revision URL preservation, maintenance scope, readiness blocking, post-publish checks, monitoring nullability, learning thresholds/no auto-apply, RBAC/audit/HMAC/PII rejection, preview non-mutation, and backward-compatible fixed schedules.

## 19. VPS deployment and controlled verification

1. Record local and VPS branch/SHA/status and remote parity. Confirm the active Compose project/path and affected containers.
2. Record safe flags and schedule state without printing environment values or secret-expanded Compose output.
3. Back up the current commit reference, Compose file, and VPS `.env` with restrictive permissions, and preserve/tag the current backend, frontend, and OpenClaw image IDs for emergency rollback. Use an existing approved database backup mechanism if one exists; do not improvise a destructive migration.
4. Before restarting any service, pause persisted legacy Blog, Google Intelligence, Content Operations, and relevant n8n/OpenClaw schedule triggers. Explicitly set `OPENCLAW_BLOG_CRON_ENABLED=false`, `CONTENT_OPERATIONS_CRON_ENABLED=false`, `SEO_AGENT_ENABLED=false`, `SEO_AGENT_AUTO_PUBLISH=false`, `OPENCLAW_IMAGE_PIPELINE_ENABLED=false`, `TELEGRAM_BOT_ENABLED=false`, `CONTENT_LEARNING_AUTO_APPLY=false`, and temporarily set performance monitoring and learning off. Require zero running executions/runs/monitoring tasks and no live leases. Enabling performance monitoring starts the shared scheduler loop, so environment flags and persisted schedule state must both be quiescent.
5. Deploy the exact reviewed and tested commit. Do not patch production source files directly.
6. Validate with `docker compose config --quiet`, confirm the external credential bind source is a non-empty readable regular file, and build only backend and frontend. Run `scripts/openclaw/sync-agents.sh`, assert the expected workspace `AGENTS.md` files exist, and force-recreate OpenClaw with the already-cached image (`--pull never`). Check service/Nginx/Mongo/Redis health without revealing credentials; do not restart unrelated n8n, relay, updater, certificate, Redis, MongoDB, or Nginx services.
7. Run one controlled Google-first snapshot and read-only preview. Confirm snapshot reuse, eight-action candidate evidence or a valid skip, empty planning artifact IDs (`run`, decision, Work Order, and Unified Brief), and zero writer/blog/image/Telegram/publish effects. Validate Work Order/Brief ordering in local tests, not by creating production article artifacts.
8. Verify authenticated admin routes and UI in VI/EN, public-site regressions, logs, source freshness, and audit entries.
9. After recording unchanged prohibited-artifact counts, require zero due monitoring tasks, enable performance monitoring and learning with auto-apply still off, and recreate only backend once more. Keep all production/writer/image/Telegram schedules disabled and automatic publishing off until separate approval.

## 20. Rollback

Functional rollback: set `CONTENT_OPERATIONS_ENABLED=false`, `CONTENT_OPERATIONS_CRON_ENABLED=false`, `CONTENT_PERFORMANCE_MONITORING_ENABLED=false`, and `CONTENT_LEARNING_ENABLED=false`; keep `CONTENT_LEARNING_AUTO_APPLY=false`, `SEO_AGENT_ENABLED=false`, `SEO_AGENT_AUTO_PUBLISH=false`, `OPENCLAW_BLOG_CRON_ENABLED=false`, `OPENCLAW_IMAGE_PIPELINE_ENABLED=false`, and `TELEGRAM_BOT_ENABLED=false`, then restart only affected services.

Code rollback: first force every side-effect flag off and keep persisted schedules paused. Deploy the previously recorded commit and reuse the preserved pre-rollout images rather than rebuilding the baseline; restoring an old `.env` or rebuilding an old backend can re-enable legacy writers or reintroduce excluded credential files. Re-sync the matching OpenClaw workspaces, recreate OpenClaw with `--pull never`, and verify health/admin/public routes. Do not automatically restore prior enabled schedule states. Additive optional fields and collections may remain for audit; do not delete snapshots, Work Orders, signals, revisions, performance data, audit logs, or existing drafts.

## 21. Preflight baseline and known limitations

The following observations describe the 2026-07-20 pre-change baseline and are not a claim that post-deployment verification has completed:

- Local and active VPS repositories were clean and aligned at `61b3255317ca2d762992ad6cef447188f084819f`; the active VPS Compose path was `/var/www/project/Inoxpran-Website`.
- Backend, frontend, OpenClaw, Nginx, Redis, MongoDB, n8n, Telegram relay, updater, and certificate services were present; OpenClaw, Redis, MongoDB connectivity, frontend, and Nginx checks were responsive. The backend health route returned an authenticated `403`, which demonstrates a responding protected route rather than a public health result.
- Production auto-publish was off. The enabled Blog schedule was draft-only with no running execution. Its existing daily run time must not be confused with the independent V3 cron.
- The Google schedule was enabled/strict but showed no prior run and a stale/past next-run value; resolve and verify this mandatory gate before enabling V3 scheduling.
- Search Console was still placeholder/optional in the baseline, so a credential-backed verified read-only adapter and an explicit unavailable state were required.
- The baseline pipeline was Google -> product -> opportunity/research. V3 moves decision, Work Order, and Brief ahead of product work.
- The baseline update path could write draft state directly onto a live Blog and reset publication/performance state. V3 requires staged revisions.
- Production stack traces and service-account JSON in an image build context were identified as disclosure risks. Production error responses must be generic, and credentials must be excluded from the image and mounted read-only.
- No destructive schema migration is required. Mongo indexes/collections are additive and may be created lazily.
- Search Console, analytics, and trend quality remains limited by verified external configuration and data availability. Learning recommendations are conservative when sample thresholds are not met.
- Redirect execution for merge remains recommendation-only unless the repository gains a validated, reviewed redirect mechanism.

## 22. Verification handoff checklist

- Google snapshot is acceptable before every Content Operations snapshot.
- One reusable daily Content Operations snapshot exists per local date/timezone.
- Inventory and every optional adapter expose health/freshness and distinguish unavailable from zero.
- All eight actions are representable, and `skip` creates no production side effects.
- Decision -> Work Order -> Unified Brief precedes product/research/writer artifacts.
- Revision actions preserve URL and live publication state until explicitly applied.
- Readiness, HMAC, RBAC, audit, sanitizer, product/image/fact gates all remain enforced.
- Preview persists no planning or production artifact; it may only ensure/reuse the permitted daily intelligence snapshot. Deployment validation sends no Telegram and creates no decision, Work Order, brief, blog, or image.
- Monitoring keeps unavailable metrics null; learning does not auto-apply.
- Exact local-tested and VPS-deployed commit SHAs match, with no secret exposed.
