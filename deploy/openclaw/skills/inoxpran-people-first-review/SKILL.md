---
name: inoxpran-people-first-review
description: Review INOXPRAN content for usefulness, intent satisfaction, completeness, keyword stuffing, doorway/scaled-content patterns, and other spam risks. Use after SEO review and before publisher gating.
---

# INOXPRAN People-First Review

## Purpose

Confirm the draft helps Vietnamese households independently of search traffic.

## Source hierarchy

Apply the current validated Google Intelligence snapshot, then INOXPRAN audience and brand constraints. Third-party advice cannot override official policy.

## Allowed behavior

- Check whether the primary question is answered, tradeoffs and limits are clear, and readers can act without another search.
- Measure keyword density, repetition, section coverage, unsupported urgency, and scaled-content signals.

## Forbidden behavior

- Do not create pages only to increase URL count.
- Do not permit keyword stuffing, doorway pages, cloaking, site reputation abuse, or fabricated experience.
- Do not claim guaranteed ranking, indexing, or AI Overview inclusion.

## Input contract

Require draft HTML, strategy, audience, primary keyword, Google snapshot, originality result, and factuality result.

## Output contract

Return `peopleFirst`, `spamRisk`, reasons, keyword density, unique-content ratio, question coverage, and remediation.

## Validation rules

Fail high spam risk, obvious repetition, missing user outcome, or conflict with current snapshot guidance.

## Confidence rules

Use deterministic metrics as evidence, not as the sole judgment. Mark uncertainty for incomplete source or audience context.

## Failure behavior

Block auto-publish. Permit a draft only with explicit reviewer tasks; never bypass the gate.

## Example

An 800-word draft repeats the keyword every sentence and adds no decision support: return `peopleFirst=needs_review`, `spamRisk=high`.
