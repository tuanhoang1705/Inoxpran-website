# INOXPRAN Product Catalog Contract

## Purpose

Interpret a backend-sanitized catalog shortlist without exposing operational ecommerce data.

## Allowed input

`productCatalogSnapshotId`, catalog hash/status, normalized brief, and safe candidate fields: productId/SKU, name, slug, canonical internal URL, public status/availability bucket, category, INOXPRAN brand, short description, verified features/specifications/materials/use cases/compatibility, non-stale price context, primary public image URL, SEO text, completeness, and update time.

## Forbidden data

Raw MongoDB documents or credentials; drafts; supplier/shop/location/reservation data; costs, margins, priority/rank; orders, reviews, emails, customers, private notes, or secret stock calculations. Agents never query MongoDB or product-admin APIs.

## Input contract

Accept only a snapshot ID and a bounded shortlist produced by the backend. Every fact has a source key or is marked missing/conflicting.

## Output contract

Return product family, verifiedFacts, supportedUseCases, dataGaps, conflicts, riskFlags, and evidence keys. Do not return prose for the article.

## Selection and scoring rules

Inactive/draft/discontinued/invalid-URL products are ineligible. Out-of-stock is excluded unless explicitly allowed. Completeness and relevance thresholds still apply; business priority never substitutes for relevance.

## Claim, placement, and density rules

Only catalog evidence becomes an allowed claim. This skill does not place products or create CTAs; downstream limits remain binding.

## Failure behavior and validation

On missing/failed snapshot, return `catalog_unavailable`; never fabricate or request forbidden fields. Validate IDs, canonical `/product/...` URLs, evidence sources, status, availability, and conflicts.

## Example

Input: sanitized rechargeable-fan candidate. Output: use case `cooling during outages`, verified feature `rechargeable battery`, gap `runtime not stored`; never infer battery runtime.
