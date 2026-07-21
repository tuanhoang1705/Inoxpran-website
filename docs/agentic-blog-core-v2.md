# Agentic Blog Core V2

> V3 lifecycle note (2026-07-20): the Content Operations planning contract below supersedes the older product-first execution order. The detailed architecture, API, security, deployment, and rollback contract is in [OpenClaw Content Operations Lifecycle V3](./openclaw-content-operations-lifecycle-v3.md).

## Editorial product placement artifact

The V3 order is Google Intelligence → Content Operations Daily Snapshot → opportunity/action decision → Content Work Order → Unified Content Brief → catalog/relevance → Product Seed Plan → Editorial Product Placement Plan → research/style → Blog Strategy → Content Architecture/Evidence Map → writer or scoped revision → deterministic reviews → Publish Readiness → publisher → technical verification/monitoring/learning. When product mode is enabled, catalog, seed and placement IDs must match the execution, Work Order, brief, and strategy. The writer cannot choose placement; the backend materializes and revalidates the persisted contract. See `openclaw-editorial-product-placement-strategy.md`.

## Execution order

1. Daily Google Intelligence gate.
2. Idempotent Content Operations and Content Inventory snapshots.
3. Generate, score, and persist opportunity candidates and the selected eight-action decision.
4. Persist the Content Work Order, then a complete Unified Content Brief.
5. For eligible article actions, build Product Catalog, Product Seed, and Editorial Product Placement artifacts.
6. Industry research, search-intent analysis, editorial style, Blog Strategy, architecture, and Evidence Map V2.
7. Generate a new draft or stage an action-scoped revision. Maintenance actions avoid the full writer when possible; `skip` stops successfully.
8. Run existing product, image, fact, originality, structural, SEO/AEO/GEO, people-first, spam, and brand gates.
9. Persist and pass the additional Publish Readiness gate.
10. Draft, approve, or publish according to the safe flags and planned action.
11. After publication, verify the public result and schedule performance/learning windows.

The writer is rejected unless it receives matching `contentWorkOrderId`, `unifiedContentBriefId`, `googleIntelSnapshotId`, `researchBundleId`, `editorialStyleProfileId`, and `strategyPlanId`. When product mode is not `off`, it also requires matching catalog, seed, and placement artifacts. The publisher additionally requires the lifecycle snapshot/action/target relationship, `agenticExecutionId`, a passing Publish Readiness Report, and passing server-recomputed product claim/seeding reviews. See `openclaw-product-seeding-intelligence.md`.

## External OpenClaw contract

The HMAC-authenticated workflow calls:

1. `POST /v1/api/automation/seo-blog/prepare` before writing.
2. Preserve the returned Content Operations snapshot, inventory, decision, Work Order, Unified Brief, Google, product, research, style, strategy, and execution IDs.
3. Stop when the returned decision is `skip`.
4. Send the IDs, planned action/target, Publish Readiness reference, and all V2 reviewer results to `POST /v1/api/automation/seo-blog/publish`.

`prepare` creates an auditable external execution. Schedule executions use the same artifacts and store all agent steps.

## Topic decisions

The opportunity researcher compares topic/title/tag intent with existing INOXPRAN posts:

- `new`: no materially overlapping article or a distinct intent requires a new URL.
- `update`: a close, outdated article should retain its identity and URL through a staged revision.
- `expand`: a valid article retains its URL while verified missing coverage is added.
- `merge`: overlapping articles produce a primary-target merge plan; source deletion/redirect is never automatic.
- `metadata_refresh`: evidence supports a metadata-only improvement.
- `internal_link_maintenance`: auditable link-graph improvements are the best action.
- `content_maintenance`: repair product/evidence/link/media/schema/review-date state without unnecessary full generation.
- `skip`: no candidate clears value and safety thresholds; the execution succeeds without production side effects.

Update/expand/merge/maintenance work stages an auditable revision against the target rather than overwriting or unpublishing a live Blog during preparation. Skip creates no article and invokes no product, writer, image, publisher, or Telegram step.

## Industry research and copyright controls

Configure safe research URLs with `INDUSTRY_RESEARCH_SOURCE_URLS`. The workflow uses up to `INDUSTRY_RESEARCH_MAX_SOURCES`, targets three or more when available, and stores only canonical URL, title, fetch time, hash, source type, attribution, and abstract patterns.

It does not store complete articles, source headings, author identity in patterns, competitor identity in patterns, distinctive examples/tables, or close paraphrases. One usable source cannot control style; the internal library is mandatory and coverage becomes low.

```dotenv
INDUSTRY_RESEARCH_ENABLED=true
INDUSTRY_RESEARCH_MAX_SOURCES=8
INDUSTRY_RESEARCH_LOOKBACK_DAYS=90
```

## Strategy and architecture

`BlogStrategyPlan` combines the snapshot, opportunity, intent, research, brand voice, internal links, and style. It stores audience, user problems, gap, questions, article type, evidence requirements, images, structured-data candidate, risks, success criteria, target IDs, architecture, and reviewer plan.

Architecture includes semantic H2–H4 outline, evidence keys, answer blocks, image anchors, internal links, CTA constraints, and fingerprint target. It changes actual layout between comparison, diagnostic, checklist, decision-tree, and other families.

## Quality gates

Fact review blocks unsupported certifications, statistics, testing, experts, safety claims, ranking promises, and absolute outcomes.

Originality review compares title, 7-token phrases, headings, intent, and structural fingerprint. Thresholds are configurable:

The local scheduled writer applies the persisted same-day sub-variant to paragraph selection, supporting headings, FAQ composition, tables, and CTA mode. When a candidate fails originality, it tries at most three structural variants, records the attempt count, and remains blocked after the bounded retries are exhausted.

```dotenv
CONTENT_ORIGINALITY_GATE_ENABLED=true
CONTENT_SIMILARITY_THRESHOLD=0.82
CONTENT_HEADING_SIMILARITY_THRESHOLD=0.72
CONTENT_STRUCTURAL_SIMILARITY_THRESHOLD=0.78
```

SEO/AEO/GEO review checks semantic hierarchy, answer blocks, metadata, source constraints, and supported structured-data candidates. “Generative-search ready” means normal useful, crawlable, attributable content; it is not a promise of inclusion.

People-first/spam review checks task completion, question coverage, keyword density, unique-content ratio, repetition, doorway/scaled-content language, and manipulation. High risk always blocks auto-publish.

Brand review rejects unsupported luxury positioning, exaggeration, fake experience, fake experts, fabricated tests, and fake certification.

## Search Console

Search Console signals are read-only and optional. When a verified credential-backed property is configured, the Content Operations adapter reads bounded aggregate 7/28/90-day comparisons. When absent, artifacts store `configured=false`, `status=unavailable`, `fallback=true`, and never invent clicks, impressions, positions, decay, or opportunities.

## Blog and execution data

Agentic blogs store snapshot ID/date/status, research bundle ID, style profile ID, strategy plan ID, execution ID, decision, structural fingerprint, and all reviewer decisions. `BlogAutomationExecution` stores correlation ID, ordered steps, reviewer decisions, publisher decision, errors, image status, and Telegram notification status/type.

## Failure policy

- Google gate failure: block.
- Content inventory failure: block `best_action`; never target update/merge without validated inventory.
- No valuable safe opportunity: controlled `skip`, not filler.
- Missing Work Order or incomplete Unified Brief: block writer.
- Research failure: internal patterns, low coverage, conservative claims.
- Style failure: least-recent valid style, never yesterday.
- Originality/fact/spam failure: draft only or block; never bypass.
- Image failure: existing image gate decides draft/publish.
- Telegram failure: keep saved draft and approval.

Publish preparation for a live URL must never change its published flag or reset metrics. Learning and monitoring failures are warnings after publication and cannot change deterministic weights or approved content automatically.
