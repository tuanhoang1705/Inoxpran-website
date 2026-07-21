# Daily Inoxpran Content Operations and SEO Workflow

Run one auditable daily Content Operations lifecycle. This workflow is draft-only.

## Non-negotiable rules

1. Call the authenticated Inoxpran prepare API once. Let the backend persist and return every artifact; never query MongoDB, product-admin APIs, analytics credentials, or the admin UI.
2. Enforce this order: Google Intelligence -> Content Operations Snapshot -> opportunity candidates -> selected action -> Content Work Order -> Unified Content Brief -> applicable product/research/production work.
3. Preserve every returned ID, action, target, revision, status, content hash, and source-health value unchanged.
4. Support exactly `new`, `update`, `expand`, `merge`, `metadata_refresh`, `internal_link_maintenance`, `content_maintenance`, and `skip`.
5. Treat `skip` as a successful daily outcome. On skip, do not call product, research, writer, image, readiness, or publisher agents; ask only `reporter` for the safe-skip report.
6. For metadata, link, or content maintenance, create only the scoped maintenance draft/task. Do not invoke the full writer or image pipeline unless the persisted brief explicitly requires body or media work.
7. For update/expand/merge, preserve blog identity and canonical, stage a revision, and keep audit history. Never create a duplicate URL, delete merge sources, or perform redirects automatically.
8. Never fabricate metrics, trends, customer frequency, facts, experience, products, rankings, links, or artifact IDs. `Unavailable` is not zero.
9. Never pass credentials, customer PII, raw support/sales messages, user-level analytics, private stock, costs, margins, suppliers, reservations, or full copyrighted sources to an agent.
10. Always send `mode: draft`. Do not publish from this daily workflow, even when a reviewer passes.

## Required lifecycle

### Step 0 - Google Intelligence

Ask `google-intelligence-gatekeeper` to validate the matching daily Google Intelligence Snapshot. Stop safely on a mandatory strict failure.

### Step 1 - Content Operations Snapshot

Ask `content-operations-orchestrator` to require or reuse one fresh snapshot for the local date in `Asia/Ho_Chi_Minh`. It may route aggregate inputs to:

- `site-performance-analyst`
- `content-inventory-auditor`
- `customer-insight-synthesizer`

Every optional source must include configured/available status, freshness, checked time, and a safe failure code. Do not invent missing values.

### Steps 2-3 - Candidates and action

Ask `topic-opportunity-researcher` for evidence-backed candidates across all eight actions. Ask `content-opportunity-prioritizer` to apply backend-provided deterministic factors, weights, penalties, capacity, and threshold. Require score breakdown, risks, missing data, decision reason, and rejected alternatives.

If the selected action is `skip`, stop production and report success.

### Step 4 - Content Work Order

Ask `content-work-order-manager` to validate the persisted work order. Require one real business goal, measurable success metrics, action-specific target IDs, source/evidence requirements, and audit lineage.

### Step 5 - Unified Content Brief

Ask `unified-brief-planner` to validate the complete persisted brief. A topic and keyword alone are insufficient. Require goals, audience, funnel, intent/questions, content role/angle, gaps/entities, safe link candidates, evidence and forbidden claims, product/style/image/CTA constraints, publish target, and reviews.

No product analysis, research, strategy, writer, or image agent may run before both `contentWorkOrderId` and `unifiedContentBriefId` exist and match.

### Step 6 - Product planning when relevant

For `new`, `update`, `expand`, or `merge`, run the safe product catalog snapshot, relevance scoring, Product Seed Plan, and Editorial Product Placement Plan only when the brief permits product integration. Never select a product outside the persisted plan. Stop product work on `blocked_no_suitable_product` without inventing a fallback.

### Steps 7-10 - Research and strategy

1. Ask `industry-content-researcher` for source-attributed abstract research.
2. Ask `search-intent-analyst` for intent and audience analysis from the work order and brief.
3. Ask `editorial-style-planner` for the daily profile and sub-variant.
4. Ask `content-strategist` to validate the persisted action-specific strategy.

### Step 11 - Architecture and Evidence Map V2

Ask `content-architect` for semantic architecture and a persisted evidence map. Every material claim must be `verified`, `inferred`, `unknown`, or `conflicting`. Qualify inferred claims, omit unknown facts, and block conflicting claims. Tie product claims to the exact product snapshot.

### Step 12 - Draft or revision

Ask `content-writer` only for a full-draft action that requires body content. Require matching Google, Content Operations, decision, work-order, brief, research, style, strategy, evidence-map, execution, target/revision, and relevant product IDs.

Content must follow `inoxpran-blog-editor-schema`: semantic HTML, no body H1, H2-H4 without skipped levels, safe tags/URLs, semantic tables, no scripts/styles/forms/iframes/handlers, and no Markdown fence.

### Steps 13-15 - Product, image, and quality reviews

- Run existing product claim, seeding, and placement reviews when product integration is relevant.
- Run `visual-planner` and existing image agents only when the brief requires images. All agentic images remain pending until the existing image gate passes.
- Ask `fact-checker`, `originality-reviewer`, `seo-reviewer`, `seo-aeo-geo-reviewer`, `spam-risk-reviewer`, and `brand-voice-reviewer` to review the final combined draft/revision and matching content hash.

### Step 16 - CMS and publish readiness

Ask `publish-readiness-reviewer` for a persisted readiness report. Require technical, SEO, content, image, link, structured-data, product, mode, target/revision, and renderer checks. High or critical risk blocks publication. This gate never replaces an earlier review.

### Step 17 - Draft handoff

Ask `publisher-gatekeeper` to validate the complete artifact chain and readiness report. Ask `publisher` to call the backend only with `mode: draft`. Do not publish.

### Steps 18-20 - Verification, monitoring, and learning

For a draft, ask `qa-agent` to verify the draft API shape and artifact lineage. Run post-publish verification only after a separate, real publication exists.

After a real publication:

1. Ask `post-publish-verifier` for bounded technical verification and maintenance alerts.
2. Ask `content-performance-analyst` to summarize configured aggregate monitoring windows.
3. Ask `content-learning-analyst` for an auditable recommendation after minimum time/sample thresholds.

Learning may recommend future work but must not mutate content, schedules, canonical URLs, publication state, products, facts, or deterministic scoring weights.

## Required artifacts

Preserve or explicitly mark not applicable:

- `googleIntelSnapshotId`
- `contentOperationsSnapshotId`
- `contentInventorySnapshotId`
- `contentOpportunityDecisionId`
- `contentWorkOrderId`
- `unifiedContentBriefId`
- relevant product catalog, seed, and placement IDs
- `researchBundleId`
- `editorialStyleProfileId`
- `strategyPlanId`
- `evidenceMapId`
- `agenticExecutionId`
- target blog, merge-source, and revision IDs
- reviewer results and `contentPublishReadinessReportId`
- draft result, QA report, and any later verification/monitoring/learning IDs

## Draft payload

Send only the backend-approved fields, including `mode: draft`, `source: openclaw-daily-seo`, content/SEO metadata, semantic HTML, safe links, FAQ, image metadata when approved, review results, all required artifact IDs, action/targets/revision, and content hash. Use the configured fallback cover only when the backend allows it for a draft.

## Final report

Ask `reporter` to return a concise Vietnamese report containing snapshot/source health, action and reason, score/rejected alternatives, work-order/brief IDs, topic/intent/business goal, expected metric, target/revision, draft ID, readiness result, reason for not publishing, QA, next monitoring/review date, and manual tasks. Never include secrets or private source data.
