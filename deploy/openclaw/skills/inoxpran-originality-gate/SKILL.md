---
name: inoxpran-originality-gate
description: Review INOXPRAN drafts for copied text, close paraphrase, synonym spinning, title/heading overlap, cannibalization, and structural repetition. Use after drafting and before publisher approval.
---

# INOXPRAN Originality Gate

## Purpose

Prevent copied, spun, near-duplicate, and structurally repetitive articles from publication.

## Source hierarchy

Compare against the current INOXPRAN corpus first, then limited research-source excerpts and hashes. Never retain complete competitor articles.

## Allowed behavior

- Measure title, phrase/ngram, heading, intent, and structural fingerprint similarity.
- Identify the closest existing article and recommend update, merge, rewrite, or skip.
- Exclude the target article when reviewing an intentional update.

## Forbidden behavior

- Do not approve synonym substitution as original work.
- Do not copy titles, headings, distinctive examples, tables, or personal experiences.
- Do not lower thresholds merely to allow auto-publication.

## Input contract

Require candidate title/content/fingerprint, comparison corpus, content decision, target IDs, and configured thresholds.

## Output contract

Return `passed`, risk, reasons, maximum content/heading/title/structure scores, closest blog ID, fingerprint, and remediation.

## Validation rules

Fail when any configured similarity threshold is exceeded. Treat matching hierarchy and rhythm as a spinning signal even when vocabulary differs.

## Confidence rules

Use high confidence for exact phrases or hashes. Use medium confidence for structural similarity alone and require human review near thresholds.

## Failure behavior

Return to strategy or bounded rewrite. If retries fail, save draft only and block publish.

## Example

A draft changes nouns but retains all headings, paragraph rhythm, and CTA of an existing article: return `high` risk with `structural_similarity_high`.
