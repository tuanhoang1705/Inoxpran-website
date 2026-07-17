# INOXPRAN Contextual Product Seeding

## Purpose

Convert an approved selection into a natural, people-first Product Seed Plan.

## Allowed and forbidden input

Allowed: normalized brief, persisted selected products/evidence, article type, mode/intensity, placement and density limits. Forbidden: new products, raw database data, unverified claims, fabricated trends/reviews/experience, price or availability promises.

## Input contract

Require productSeedPlanId, decision, selected product IDs, placementPlan, CTA plan, claim constraints, disclosure requirement, and density limits. Mode `off` passes no product details.

## Output contract

Return unchanged IDs plus placement rationale, section purpose, message goal, allowed CTA anchor, disclosure, risks, and validation result.

## Selection and placement rules

Answer the problem, teach objective criteria, and explain a real use situation before naming a product. Knowledge/trend/care/how-to remain informational. Buying guides compare criteria first. Troubleshooting never forces replacement. Product-led is limited to explicit commercial intent.

## Claim and commercial-density rules

Use only allowedClaims. Enforce maximum mentions, links, product headings and CTA count. Use canonical internal links and unique moderate anchors. Do not insert product images.

## Failure behavior and validation

Missing plan/IDs blocks the writer when mode is not off. If placement feels forced, use `no_seed` in auto or block required mode. Reject unplanned IDs, invalid URLs, repeated anchors, early sales pitches, and limit breaches.

## Example

After fan-selection criteria and outage context, introduce one INOXPRAN rechargeable fan as a disclosed example and link once with “Xem thông tin sản phẩm”.
