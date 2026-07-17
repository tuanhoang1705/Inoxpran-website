# OpenClaw Product Relevance and Contextual Seeding Intelligence

> Placement boundary: this layer selects eligible products and safe catalog claims only. It no longer decides section/ranking position, disclosure, CTA placement or product-image placement. Those decisions belong to the independently persisted `EditorialProductPlacementPlan`; see `openclaw-editorial-product-placement-strategy.md`.

## 1. Architecture and workflow

This additive, backend-controlled layer runs: `Google Intelligence strict gate → Product Catalog Snapshot → deterministic relevance/cooldown → Product Seed Plan → existing Agentic Blog Core → product and existing review gates → draft/publish`. Google is the first awaited operation. Required mode can stop before research/writing. OpenClaw never reads MongoDB or product-admin APIs.

## 2. Product Catalog Snapshot

`ProductCatalogIntelligenceService` reads Product and aggregate Inventory stock through narrow projections. `ProductCatalogSnapshot` persists a stable hash, counts, timestamps, TTL, filters, status/error, product references, evidence hashes, completeness, eligibility and rejection codes—not full product documents. A fresh complete/partial snapshot is reused; admin rebuild creates a new one.

## 3. Safe product fields

Agents may receive only product ID/SKU, public name/slug/canonical `/product/...` URL, public status/availability bucket, category (`product_type`), INOXPRAN brand, sanitized short description, verified attributes/features/materials/use cases/compatibility, recent price context, public thumbnail URL, SEO text, completeness/update time and evidence/rejection codes.

Never expose shop/supplier/location/reservations, raw stock calculations, costs/margins/rank, drafts, reviews/customer/order data, storage metadata/private notes, credentials or complete raw documents.

## 4. Product relevance scoring

Central defaults: topic/search intent 30%, user problem 20%, category/features 15%, use case 10%, availability 10%, completeness/claim confidence 5%, seasonality 5%, canonical link opportunity 5%. Controlled VI/EN semantic groups complement lexical matching; agents cannot rewrite numeric results.

Auditable penalties cover out-of-stock, inactive, incomplete, weak semantics, cooldown/overexposure, category mismatch, invalid URL, explicit exclusion and claim risk. A preferred ID still must pass the threshold. Business rank is not an input.

## 5. Modes and intensity

- `off`: no product scan/details/block/link/name/CTA; audit `no_seed` plan only.
- `auto` (default): select only above threshold; otherwise informational `no_seed`.
- `required`: controlled `blocked_no_suitable_product` when none qualifies.

Global `PRODUCT_SEEDING_ENABLED=false` forces `off`.

- `light`: one primary, normally one/two mentions and one moderate CTA/link, no product heading.
- `balanced`: one primary plus up to two supporting items; criteria precede recommendation/comparison.
- `commercial`: explicit commercial intent only; still people-first and never a duplicate PDP.

## 6. Article-type formulas

Trend: verified concern → cause → criteria → disclosed product example → usage advice → soft CTA. Knowledge: concept/technical criteria/use case → optional suitable option. How-to/troubleshooting solves the task first and uses `no_seed` when replacement is unnecessary. Buying/comparison establishes equal criteria first. Owned listicles never make a product “Top 1” without a documented method. Care uses only model-specific facts.

## 7. Product Seed Plan

`ProductSeedPlan` ties brief hash, Google/catalog snapshots and execution to mode/intensity/decision. It stores selected evidence-only products, top/rejected scores, placements, CTA/density limits, risks, reviews, warnings/error codes and override reason. `BlogStrategyPlan` receives plan/catalog IDs, selected IDs, claim evidence, placement/density constraints and the product review plan.

## 8. Agents and local skills

- `product-catalog-analyst`: safe families/facts/gaps/conflicts.
- `product-relevance-matcher`: explains backend scores; no threshold bypass.
- `contextual-seeding-strategist`: no-seed/contextual/product-led placement and CTA.
- `product-claim-verifier`: exact evidence mapping; factual failure cannot be overridden.
- `product-seeding-reviewer`: naturalness, independent value, density, links and disclosure.

The five `inoxpran-product-*`/contextual local skills define allowed/forbidden input, contracts, scoring/claim/placement/density/failure validation and examples. Writer uses only persisted IDs. Publisher receives IDs/reviews only and remains denied shell/browser/process/Mongo/product admin.

## 9. Product claim safety

Allowed claims come from stored name/SKU/attribute/material/function/dimension/power/use-case/URL evidence. Numerical specs must match evidence. Certification, absolute safety, rankings, savings/lifespan, health/bacteria, never-breaks, endorsements, best-selling/users, exclusive technology, experience, hardcoded price and continuous availability are rejected. Conflicting values fail.

## 10. Naturalness review

Product blocks must follow objective context, disclose INOXPRAN, match plan URLs, use unique moderate anchors and obey mention/link/heading/CTA limits. Light/balanced content must retain substantial value after blocks are removed. Early sales pitches, repeated headings/anchors, invalid links or high pressure block auto-publish. Recommendations use safe semantic `section[data-block-type=product-recommendation][data-product-id]` and `a[data-link-type=product]` attributes.

## 11. Schedule configuration and Admin UI

`agentConfig.productSeeding` persists enabled, mode, intensity, primary/supporting maxima, preferred category/product IDs, exclusions, out-of-stock opt-in, threshold and informational fallback. CRUD/Run Now use this object; global config caps maxima.

Daily Draft adds a bilingual Product Integration fieldset and Preview Matching results (decision, candidate breakdown, selections/rejections/warnings). Execution details show mode/decision, catalog/plan IDs, selected/rejected candidates, placements, claim review, naturalness/pressure and counts without redesigning the page.

## 12. Prepare/publish contracts

HMAC-authenticated `prepare` keeps existing IDs and adds `productCatalogSnapshotId`, `productSeedPlanId`, plus safe mode/intensity/decision/selected evidence/placement/claim/density summaries.

`publish` requires product IDs/reviews when mode is not off. It loads execution/plan, checks all relationships, rejects unplanned IDs, recomputes product reviews server-side and blocks publish on failure/high pressure. It writes `ProductSeedExposure` after save. Off mode rejects product blocks. Existing image behavior is unchanged.

## 13. Backend API and permissions

Authenticated APIs:

- `GET|PATCH /v1/api/admin/openclaw/product-seeding/config`
- `POST /v1/api/admin/openclaw/product-seeding/preview`
- `GET /v1/api/admin/openclaw/product-seeding/plans[/:id]`
- `GET /v1/api/admin/openclaw/product-seeding/exposures`
- `GET /v1/api/admin/openclaw/product-catalog/status`
- `POST /v1/api/admin/openclaw/product-catalog/rebuild`

Scopes: `product_seeding.view|preview|manage|override`, `product_catalog_snapshot.view|rebuild`; ADMIN/SUPER_ADMIN remain fallbacks. Config changes require a reason and audit entry. No product-claim override endpoint exists.

## 14. Exposure cooldown and audit

`ProductSeedExposure` records product/blog/execution/article type, placement types/fingerprint, mention/link counts, CTA and publication time. Planning aggregates 7/30/90-day use, days since last inclusion and repeated CTA/placement evidence. Executions persist safe candidate scores/rejections, placement, review and warning summaries.

## 15. Environment variables

See `.env.example` for `PRODUCT_SEEDING_*`, `PRODUCT_SEED_*`, and `PRODUCT_CATALOG_*`. `productSeeding.config.js` parses/clamps centrally. Optional SiteSetting config is merged under environment guardrails.

## 16. Tests and local procedure

```bash
cd backend && npm install && npm test
cd frontend && npm install && npm run build
docker compose config
git diff --check
```

Tests cover catalog safety/hash/eligibility, scores/penalties/modes/cooldown, pipeline order, semantic HTML, plan-only writer, claims, naturalness, prepare/publish IDs, sanitizer, RBAC and regressions. Keep image providers, Telegram and cron disabled in tests.

## 17. VPS deployment notes

Record the previous commit, pull the reviewed commit, keep secrets only in VPS `.env`, validate Compose, rebuild backend/frontend/OpenClaw, and smoke-test health/admin/public routes. New collections/additive optional fields are lazy; no destructive migration is required. Do not trigger Run Now or publish for deployment validation.

## 18. Rollback

Set `PRODUCT_SEEDING_ENABLED=false` and restart backend for immediate functional rollback. For code rollback, redeploy the previous commit and rebuild affected services. Optional fields/collections may remain; do not delete audit artifacts. Manual/legacy blogs need no migration.

## 19. Known limitations

This repository has no separate Category/Brand/Variant collections, explicit discontinued/SKU/SEO fields, or attribute verification metadata. `product_type` is category and brand is INOXPRAN. Owner-stored scalar attributes are evidence with completeness/conflict guards. Scoring is deterministic lexical/controlled-semantic; no embedding provider is called. Generated prose never inserts price/stock claims.

## 20. Future product-image integration

Plans can later carry visual hints, but this phase neither generates renders nor injects product images. A future project must verify identity/assets, preserve pixels, add separate review/license contracts and keep the current image gate isolated.
