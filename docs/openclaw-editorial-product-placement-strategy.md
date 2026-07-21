# OpenClaw editorial product-placement strategy

> Content Operations V3 integration (2026-07-20): placement is planned only after a selected action, Content Work Order, and Unified Content Brief exist. See [OpenClaw Content Operations Lifecycle V3](./openclaw-content-operations-lifecycle-v3.md).

## Why this layer exists

Content-action selection, product relevance, and editorial placement are separate decisions. The Work Order and Unified Brief first establish the user need, action, target, intent, and business goal. `ProductSeedPlan` then selects catalog-verified products. `EditorialProductPlacementPlan` is persisted immediately afterward and decides whether, where and how those already selected products may appear. Blog Strategy, Content Architecture, writer, visual planner, reviewers and publisher all reference the Work Order, brief, and placement artifact IDs.

This removes the former post-draft behavior that mechanically inserted every product before the second H2. The writer is not allowed to invent product placement, rankings, links, CTAs, disclosures or product images.

## Persisted contract

`EditorialProductPlacementPlans` links the Google snapshot, Product Catalog Snapshot, Product Seed Plan, Blog Strategy Plan, execution and final blog. It stores decision/style, effective topic and ranking evidence review, first-mention thresholds, placement/product/section IDs, commercial roles, owned-product rank position, methodology, density, visual metadata, disclosure, CTA, rejected alternatives and warnings.

`ProductPlacementStyleDefinitions` stores enabled definitions and usage/cooldown state. `ProductSeedExposures` records style, rank position, first-mention progress and block/image counts for rotation.

The placement artifact additionally references `contentWorkOrderId` and `unifiedContentBriefId`. It is created for `new`, `update`, `expand`, or `merge` only when product integration is relevant. `skip` never creates it. Metadata/internal-link/content maintenance performs only the bounded product-reference validation required by the Work Order and does not force commercial placement.

## Styles and ranking

Supported styles are `ranked-list-owned-first`, `ranked-list-owned-last`, `criteria-first-recommendation`, `problem-solution-late-reveal`, `knowledge-soft-endcap`, `comparison-matrix-contextual`, `scenario-product-matching`, `editorial-pick-disclosed`, `inline-contextual-example`, `product-led-editorial`, and `no-product`. `auto` selects from article type, role and intent, then applies cooldown and rank-position rotation.

Ranked content may place the owned product only first or last. Auto alternates recent positions. Methodology and ownership disclosure must precede the ranked product context.

## Evidence-safe ranking

Sales-rank phrases such as `bán chạy`, `bán chạy nhất`, `best seller`, `best-selling` and `top-selling` require evidence. Internal evidence requires source, bounded date range, checked timestamp, methodology and scope. External evidence requires HTTPS source, title, publication date, checked timestamp, methodology and scope. Relevance, catalog order, inventory, ratings and model confidence are never sales evidence.

Without complete evidence, the planner rewrites the topic to neutral fit/criteria language before research and strategy; it never fabricates rank.

## Architecture and writer boundary

Every section declares `sectionKey`, `purpose`, `productPlacementAllowed`, `allowedProductIds`, `commercialRole`, and `mustPrecedeProduct`. Default first mention is after two completed sections, 350 words and 35% progress. Knowledge uses at least three/60%, trend two/45%, buying guide two/35%, troubleshooting two/50%, and product-led one/10%.

The writer receives Product Seed Plan, Editorial Product Placement Plan, Strategy and Architecture, but writes independent editorial content only. The backend materializes exact placement IDs. The first informational visual remains editorial; the image pipeline receives placement metadata without changing providers or generating product images.

## Deterministic review and publish gate

The reviewer parses sanitized HTML and recalculates first mention, ID integrity, block/link/CTA/image counts, consecutive commercial blocks/images, rank first/last/middle, methodology, disclosure, evidence, claims and independent value. After commercial blocks/disclosure/CTA are removed, the article must retain at least three useful H2 sections, 300 words and 60% of total value.

Unplanned IDs, artifact mismatch, middle rank, unsafe links or a product without a plan are critical. Early placement, missing disclosure/methodology/evidence, excessive density and weak independent value are high risk. High/critical risk forces draft and blocks auto-publish.

## Schedule preview and runtime

Schedules expose placement style, ranking first/last/auto, first-mention section/word/percentage, product-image placement and disclosure. Preview returns an Editorial Outline without invoking writer, saving a schedule, creating a blog, generating an image or publishing. Runtime variables and safe defaults are in `.env.example`.

Under V3, product controls are shown only after the preview or selected Work Order has a topic and intent. The preview also remains Telegram-free and records no product exposure. Publish validation reloads the Work Order, brief, seed, placement, action, and target relationships and requires the additional Publish Readiness gate; high/critical placement or readiness risk remains draft/blocking.
