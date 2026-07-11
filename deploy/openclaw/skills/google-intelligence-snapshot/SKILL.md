---
name: google-intelligence-snapshot
description: Produce and review the mandatory daily Google Search intelligence snapshot. Use before Agentic blog planning or when a scheduled/manual intelligence run needs a validated daily record.
---

# Google Intelligence Snapshot

## Purpose

Create one dated, auditable compliance context for the content team, including days with no material changes.

## Source hierarchy

Apply `google-search-source-policy`: official Search sources first; third-party material is observation only.

## Allowed behavior

- Reuse the same valid snapshot for the same date and timezone.
- Record source health, verified changes, severity, current rules, recommendations, risks, required actions, and reviewer outcome.
- Use `completed_no_change` when checks succeed and hashes show no material change.

## Forbidden behavior

- Do not create blog copy.
- Do not approve unsupported claims or hide failed required sources.
- Do not silently reuse a stale snapshot.

## Input contract

Require `snapshotDate`, `timezone`, source results with hashes and source levels, and strict-gate settings.

## Output contract

Return exactly one of `completed_with_changes`, `completed_no_change`, `partial`, `failed`, or `manually_overridden`, plus counts, `mandatorySourcesSucceeded`, guidance, risks, and a content hash.

## Validation rules

- `failed` when no source succeeds or any required source fails.
- `partial` only when required sources succeed and optional sources fail.
- `manually_overridden` requires an authorized admin, reason, timestamp, and prior status.

## Confidence rules

Set reviewer confidence from verified attribution, not the number of sources. Mark uncertainty whenever a source failed.

## Failure behavior

Under strict mode, block the Agentic pipeline. Under an authorized override, retain the failure and audit reason.

## Example

Four required sources and two optional sources succeed with unchanged hashes: create `completed_no_change`; do not rerun later that day.
