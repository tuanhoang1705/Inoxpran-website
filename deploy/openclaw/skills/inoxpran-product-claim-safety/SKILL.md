# INOXPRAN Product Claim Safety

## Purpose

Verify every product statement against the evidence persisted in Product Seed Plan.

## Allowed and forbidden input

Allowed: productSeedPlanId, selected IDs, allowedClaims with source keys, forbiddenClaims, sanitized product blocks, catalog conflict flags. Forbidden: external guesses, unstored certifications/prices/availability, reviews, experience, rankings, health claims, or raw product data.

## Input contract

Every claim maps to one planned productId and exact stored evidence. URLs must exactly match the plan.

## Output contract

Return pass, claimSafety, verifiedClaims with sources, rejectedClaims with codes, issues, requiredFixes, and conflict severity.

## Selection, scoring, placement, and density rules

This skill cannot select or reposition products and cannot change relevance/density. It verifies names, model/SKU, material, stored function/dimension/power, evidence-backed use cases, and canonical URL only.

## Claim rules

Reject unsupported “best/number one”, certification, absolute safety, savings/lifespan, medical/bacteria, never-breaks, endorsements, best-selling/users, exclusive technology, origin/history, numerical specs, price, and stock. Conflicting values block the claim.

## Failure behavior and validation

Claim failure blocks auto-publish and cannot be manually overridden. Remove/verify the claim or force draft; never invent replacement evidence.

## Example

Stored `power=12W` passes; `99W`, `ISO certified`, “completely safe”, a hardcoded price, or “always in stock” fails.
