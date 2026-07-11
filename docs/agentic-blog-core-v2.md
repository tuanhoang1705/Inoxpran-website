# Agentic Blog Core V2

## Execution order

1. Daily Google Intelligence gate.
2. Topic opportunity research.
3. `new`, `update`, `merge`, or `skip` decision.
4. Industry content research.
5. Search-intent analysis.
6. Daily editorial style and same-day sub-variant.
7. Persisted Blog Strategy Plan.
8. Content architecture and evidence map.
9. Original draft generation.
10. Existing image pipeline.
11. Fact review.
12. Originality and structural review.
13. SEO/AEO/GEO review.
14. People-first and spam-risk review.
15. Brand voice review.
16. Publisher gate.

The writer is rejected unless it receives `googleIntelSnapshotId`, `researchBundleId`, `editorialStyleProfileId`, and `strategyPlanId`. The publisher additionally requires snapshot date/status and `agenticExecutionId`.

## External OpenClaw contract

The HMAC-authenticated workflow calls:

1. `POST /v1/api/automation/seo-blog/prepare` before writing.
2. Preserve the returned snapshot, research, style, strategy, and execution IDs.
3. Stop when the returned decision is `skip`.
4. Send the IDs and all V2 reviewer results to `POST /v1/api/automation/seo-blog/publish`.

`prepare` creates an auditable external execution. Schedule executions use the same artifacts and store all agent steps.

## Topic decisions

The opportunity researcher compares topic/title/tag intent with existing INOXPRAN posts:

- `new`: no materially overlapping article or a distinct intent.
- `update`: a close, outdated article should retain its URL.
- `merge`: multiple overlapping articles should be consolidated into a primary target.
- `skip`: a recent article already satisfies the intent.

Update/merge writes through the existing blog model and target ID instead of creating a new URL. Skip creates no article.

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

Search Console signals are read-only and optional. Configure an existing repository integration/property; when absent, the Research Bundle stores `configured=false`, `fallback=true`, and never invents clicks, impressions, positions, decay, or opportunities.

## Blog and execution data

Agentic blogs store snapshot ID/date/status, research bundle ID, style profile ID, strategy plan ID, execution ID, decision, structural fingerprint, and all reviewer decisions. `BlogAutomationExecution` stores correlation ID, ordered steps, reviewer decisions, publisher decision, errors, image status, and Telegram notification status/type.

## Failure policy

- Google gate failure: block.
- Research failure: internal patterns, low coverage, conservative claims.
- Style failure: least-recent valid style, never yesterday.
- Originality/fact/spam failure: draft only or block; never bypass.
- Image failure: existing image gate decides draft/publish.
- Telegram failure: keep saved draft and approval.
