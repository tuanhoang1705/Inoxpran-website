---
name: inoxpran-blog-strategy-contract
description: Build the required pre-writing INOXPRAN Blog Strategy Plan. Use after Google intelligence, topic opportunity, industry research, intent analysis, and editorial style selection, before any content writer runs.
---

# INOXPRAN Blog Strategy Contract

## Purpose

Provide the content writer an auditable plan and prevent template-first drafting.

## Source hierarchy

Combine the current Google snapshot, internal corpus, Search Console read-only signals when configured, multi-source research, and brand voice in that order.

## Allowed behavior

- Decide `new`, `update`, `merge`, or `skip` before drafting.
- Specify audience, intent, problems, content gap, questions, article type, evidence, links, images, structured-data candidate, risks, success criteria, and architecture.

## Forbidden behavior

- Do not run a writer without snapshot, research bundle, style profile, and strategy IDs.
- Do not force `new` when update or merge gives more value.
- Do not invent Search Console data when integration is absent.

## Input contract

Require all four upstream artifacts plus topic, existing-content inventory, and optional Search Console opportunities.

## Output contract

Return the complete persisted strategy plan and stable IDs. Include target blog IDs for update/merge and a reason for every decision.

## Validation rules

Reject missing references, empty primary question, unsupported evidence, or a strategy that conflicts with the style fingerprint target.

## Confidence rules

Attach confidence to intent and research coverage. Use conservative risks when Search Console or research sources are unavailable.

## Failure behavior

Stop before writing. If research fails, use internal style patterns with `researchCoverage=low`; if decision is `skip`, create no article.

## Example

Two overlapping care guides exist: choose `merge`, name target IDs, plan consolidated evidence and links, and preserve the primary target URL.
