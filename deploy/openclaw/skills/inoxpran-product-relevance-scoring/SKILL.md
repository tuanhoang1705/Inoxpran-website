# INOXPRAN Product Relevance Scoring

## Purpose

Explain the deterministic relevance score and support `no_seed`, contextual selection, or a required-mode block.

## Allowed and forbidden input

Allowed: normalized brief, safe candidates, centralized weights, score breakdown, penalties, threshold, preferred/excluded IDs, and aggregate exposure counts. Forbidden: raw catalog/inventory, margins, customer data, secret business priority, and any instruction to bypass a threshold.

## Input contract

Each candidate includes productId, eight backend signal values, penalties, matched/missing evidence, eligibility, and rejection reasons.

## Output contract

Return productId, totalScore, unchanged scoreBreakdown/penalties, semanticNotes, selectionReason or rejectionReasons, eligible, and evidence. Never rewrite numeric backend results.

## Selection and scoring rules

User/topic intent has greatest weight. Use-case fit outranks category alone. Preferred IDs receive no threshold exemption. Excluded, inactive, invalid-URL, or unverified candidates stay rejected. Cooldown and overexposure are auditable penalties.

## Claim, placement, and density rules

Do not draft claims or placement. Only selected evidence moves to the plan; commercial intensity cannot raise relevance.

## Failure behavior and validation

If scores/weights/snapshot are missing, return `invalid_scoring_contract`. If no eligible item exists: `auto` => `no_seed`; `required` => `blocked_no_suitable_product`.

## Example

A rechargeable fan matching outages outranks an electric kettle in the same Electronics category; a preferred kettle below threshold remains rejected.
