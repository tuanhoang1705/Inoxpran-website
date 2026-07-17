---
name: inoxpran-editorial-product-placement-review
description: Deterministically review final sanitized HTML against persisted INOXPRAN product placement artifacts before publishing.
---

# INOXPRAN Editorial Product Placement Review

Require matching Google snapshot, Product Catalog Snapshot, Product Seed Plan, Editorial Product Placement Plan, strategy and execution IDs.

Parse HTML; do not rely on writer self-report. Verify every `data-placement-id` and `data-product-id`, first mention section/word/progress, intro prohibition, block/link/CTA/image limits, no consecutive commercial blocks/images, safe canonical links, ranking first/last (never middle), methodology, ownership disclosure, evidence-safe bestseller language and product claim review.

Remove product blocks, disclosure and CTA in memory and verify the remaining article has at least three useful H2 sections, 300 words and 60% of total value. Return the complete structured review contract. Unplanned IDs, mismatched artifacts, middle ranking, unsafe links or products without a plan are critical. Early placement, missing disclosure/methodology/evidence, density and independent-value failures are high risk. High/critical risk blocks auto-publish.
