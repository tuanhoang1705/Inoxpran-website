---
name: inoxpran-editorial-style-rotation
description: Select non-repeating editorial structures for INOXPRAN articles. Use after research and before strategy/architecture to rotate openings, heading logic, rhythm, evidence, answer blocks, visuals, and CTA patterns.
---

# INOXPRAN Editorial Style Rotation

## Purpose

Create structural diversity while preserving a practical, clear, trustworthy, evidence-based Vietnamese household voice.

## Source hierarchy

Use recent internal style history first, then multi-source abstract research patterns. Never clone one external author.

## Allowed behavior

- Choose among problem-solution, answer-first, checklist, comparison, diagnostic, decision-tree, step-by-step, technical, scenario, evidence-first, and other enabled families.
- Create article-specific sub-variants for multiple same-day articles.
- Vary actual hierarchy, section order, rhythm, evidence mode, visuals, answers, and CTA.

## Forbidden behavior

- Do not rename a style while keeping the same structure.
- Do not store or repeat a permanent article template.
- Do not alter INOXPRAN into unsupported luxury, exaggerated, or fabricated-experience positioning.

## Input contract

Require `date`, recent 7–14 day profiles, enabled definitions, cooldown, abstract patterns, and brand constraints.

## Output contract

Return `styleFamily`, opening/heading/rhythm/evidence/example/CTA/visual/answer modes, forbidden recent patterns, brand constraints, and fingerprint target.

## Validation rules

- Do not reuse yesterday's family.
- Avoid recent opening, heading fingerprint, and CTA patterns.
- Prefer the least recently used eligible family when generation fails.

## Confidence rules

Use high confidence only when history is complete. Mark fallback use when history or research coverage is incomplete.

## Failure behavior

Select the least-recently used valid internal style; never fall back to yesterday's structure.

## Example

Yesterday was comparison-led with a table and consultation CTA. Select diagnostic-guide with symptom-first opening, question headings, diagnostic answer blocks, and a next-check CTA.
