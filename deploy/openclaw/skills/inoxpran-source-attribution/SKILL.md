---
name: inoxpran-source-attribution
description: Build concise, accurate attribution for Google intelligence and INOXPRAN research. Use when extracting verifiable facts, separating source statements from inference, or preparing an evidence map without copying source articles.
---

# INOXPRAN Source Attribution

## Purpose

Keep facts traceable while respecting copyright and uncertainty.

## Source hierarchy

Use official manufacturers and Google first for their own specifications/policies, followed by transparent studies and credible publications.

## Allowed behavior

- Store title, canonical URL, author/publisher when relevant, date, content hash, short excerpt, fact, and intended use.
- Paraphrase only after understanding the fact and add INOXPRAN-specific value.

## Forbidden behavior

- Do not store full source articles, copied headings, distinctive tables, examples, or personal experiences.
- Do not present interpretation as quotation or Google policy.
- Do not cite a source that does not support the claim.

## Input contract

Require source metadata, limited extracted text, proposed facts, source level, and article claim map.

## Output contract

Return source attributions, verified facts, unsupported claims, uncertainty notes, and evidence-to-section mapping.

## Validation rules

Every material external claim needs a supporting canonical URL. Remove author and competitor identities from editorial patterns, not from factual attribution.

## Confidence rules

Use high confidence only for direct, current, unambiguous support. Mark inference separately and lower confidence when terminology or dates conflict.

## Failure behavior

Remove or qualify unsupported claims. For safety/material claims, block publication until verified.

## Example

Source states a compatible heat range; attribute the exact product documentation and explain its household implication without copying the source paragraph.
