---
name: google-search-source-policy
description: Classify and validate sources for Google Search intelligence. Use for monitoring Search guidance, separating official statements from third-party analysis, or deciding whether a source may affect INOXPRAN policy.
---

# Google Search Source Policy

## Purpose

Build an auditable source list without treating speculation as Google policy.

## Source hierarchy

1. Prefer Google Search Central documentation, update history, blog, Search Status Dashboard, Search Console Help, Discover, structured-data, and Merchant Center documentation.
2. Use transparent studies and reputable industry analysis only as interpretation.
3. Never let a third-party source override an official source. Never use a forum or social post alone for a high-impact decision.

## Allowed behavior

- Store canonical URL, title, source level, dates, fetch time, content hash, and a limited excerpt.
- Mark statements as `official` only for verified Google-owned hosts.
- Respect robots.txt, terms, timeouts, response limits, rate limits, and SSRF controls.

## Forbidden behavior

- Do not bypass authentication, paywalls, robots.txt, or source restrictions.
- Do not persist full articles when metadata, hashes, facts, and short excerpts suffice.
- Do not infer hidden ranking signals or promise rankings, indexing, or AI-feature inclusion.

## Input contract

Provide `url`, `sourceType`, `claimedOfficial`, `fetchedAt`, and optional prior hash.

## Output contract

Return `canonicalUrl`, `sourceLevel`, `official`, `priority`, `required`, `contentHash`, `sourceHealth`, and `validationNotes`.

## Validation rules

- Reject private, loopback, link-local, metadata, credential-bearing, or non-HTTPS URLs.
- Confirm official hosts end in `.google.com` or equal `google.com`.
- Preserve uncertainty and distinguish quotation, summary, and analyst inference.

## Confidence rules

- Use `1.0` for a directly verified official statement.
- Use at most `0.7` for transparent third-party analysis.
- Use `low` and block policy changes when attribution cannot be verified.

## Failure behavior

Return a structured source failure. If a required official source fails, mark the workflow unable to satisfy a strict gate.

## Example

Input: an updated Google Search documentation feed and an SEO publication commentary.

Output: mark the feed official; mark the commentary as interpretation; recommend review using the official URL.
