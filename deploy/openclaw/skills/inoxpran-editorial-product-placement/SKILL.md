---
name: inoxpran-editorial-product-placement
description: Plan independent, people-first editorial placement for already selected INOXPRAN products. Use after Product Seed Plan and before blog strategy, architecture or writing.
---

# INOXPRAN Editorial Product Placement

## Boundary

Product Seed Plan selects products. Editorial Product Placement Plan independently chooses whether, where and how selected products may appear. Never add or replace a product.

## Styles

Use only: `ranked-list-owned-first`, `ranked-list-owned-last`, `criteria-first-recommendation`, `problem-solution-late-reveal`, `knowledge-soft-endcap`, `comparison-matrix-contextual`, `scenario-product-matching`, `editorial-pick-disclosed`, `inline-contextual-example`, `product-led-editorial`, or `no-product`.

## Contract

Return the unchanged product/snapshot IDs, placement style, first mention thresholds, placement sequence and IDs, owned-product position, ranking methodology, density, visual metadata, disclosure, CTA, forbidden patterns, review rules, rejected alternatives, reason and warnings. Ranking permits owned product first or last only. Default thresholds are two completed sections, 350 words and 35% progress; knowledge is at least three sections/60%, trend two/45%, buying guides two/35%, troubleshooting two/50%, and product-led one/10%.

Every architecture section declares `sectionKey`, `purpose`, `productPlacementAllowed`, `allowedProductIds`, `commercialRole`, and `mustPrecedeProduct`. The writer cannot change this contract. Product visuals are metadata only; the informational cover/first image remains editorial and product images cannot be consecutive.

## Failure

Missing IDs, unselected products, middle ranking, early mention, hidden ownership, excessive density or unsupported ranking language blocks publish. `no-product` is valid.
