# INOXPRAN Product Seeding Review

## Purpose

Audit the finished draft for relevance, naturalness, people-first value, factual safety and commercial restraint.

## Allowed and forbidden input

Allowed: sanitized draft, persisted plan/snapshot IDs, reviewer results, selected/rejected audit summaries, limits, and aggregate exposure. Forbidden: product-admin access, MongoDB/browser/shell, raw inventory, private product/customer/business data, or permission to modify products.

## Input contract

Require plan decision, planned IDs/URLs, claim-review result, placement/CTA/density constraints and semantic product blocks.

## Output contract

Return pass, naturalnessScore, relevanceScore, commercialPressure (`low|medium|high`), claimSafety, linkSafety, issues, requiredFixes, publishRecommendation (`publish|draft|rewrite|remove_product`), and metrics.

## Selection, scoring, claim and placement rules

No unplanned IDs. Objective information precedes product context. Ownership is disclosed. Claim review must pass. Canonical product links use distinct moderate anchors. Knowledge/trend/light/balanced articles retain substantial value after product blocks are removed.

## Commercial-density rules

Enforce plan limits for mentions, links, headings and CTAs; reject repeated anchors, title/heading stuffing, sales-pitch openings and landing-page pressure.

## Failure behavior and validation

Allow a bounded rewrite or product removal; persistent failure/high pressure forces draft and blocks auto-publish. Mode off rejects every product block.

## Example

Pass: one disclosed block after criteria, one canonical link, supported facts. Fail: product in opening, repeated product headings/CTAs, unsupported claims, or article unusable without the block.
