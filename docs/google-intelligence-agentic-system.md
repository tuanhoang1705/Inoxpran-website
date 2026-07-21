# Google Intelligence and Compliance System

> Content Operations V3 integration (2026-07-20): Google Intelligence remains the first mandatory gate. The downstream lifecycle is documented in [OpenClaw Content Operations Lifecycle V3](./openclaw-content-operations-lifecycle-v3.md).

## Purpose

Google Intelligence is an independent, persisted compliance workflow. Every Agentic content execution must obtain an acceptable daily snapshot before planning or writing. It does not promise ranking, indexing, or inclusion in Google AI features.

Google Intelligence and Content Operations Intelligence have separate responsibilities. Google Intelligence answers which official guidance and compliance constraints apply today. Only after that snapshot is acceptable may Content Operations inspect site performance, inventory, market demand, products, and aggregated business/customer signals to decide what work is worthwhile. Content Operations reuses `googleIntelSnapshotId`; it must not fetch or reinterpret Google policy as a duplicate workflow.

## Architecture

```text
Persistent schedule / Run Now / content gate
                    |
          Mongo execution idempotency
                    |
 source monitor -> change detector -> policy analysis
                    |
         attribution + reviewer checks
                    |
       one daily snapshot per timezone
                    |
       strict content gate / audited override
```

The implementation reuses the repository's scheduler polling runtime and MongoDB leases. It does not add an in-memory-only scheduler or a second queue system.

## Source hierarchy

Default first-party sources are seeded idempotently:

1. Google Search documentation update RSS feed.
2. Google Search Status Dashboard.
3. Google Search spam policies.
4. Helpful, reliable, people-first content guidance.
5. Google Search Central Blog.
6. AI features and website guidance.
7. Structured-data documentation.
8. Discover guidance.
9. Search Console Help.

Official sources use `google.com` hosts. Third-party sources may be configured, but are always stored as interpretation and cannot override official guidance.

## Safe fetching

The fetch layer enforces HTTPS, canonical URLs, DNS resolution, private/reserved/link-local/metadata IP blocking, no credential-bearing URLs, redirect rejection, robots.txt, bounded retries, timeouts, MIME allowlists, response-size limits, sequential rate limiting, and limited persisted excerpts. Full source articles are not stored.

## Snapshot lifecycle

The snapshot key is `(snapshotDate, timezone)` and is unique. Default timezone is `Asia/Ho_Chi_Minh`.

- `completed_with_changes`: all required sources succeeded and material changes exist.
- `completed_no_change`: checks succeeded and hashes did not materially change.
- `partial`: required sources succeeded, but at least one optional source failed.
- `failed`: no usable result or at least one required source failed.
- `manually_overridden`: an authorized administrator supplied an audited reason.

Every snapshot includes source health, counts, required-source result, verified changes, current rules, recommendations, risks, required actions, content guidance, reviewer outcome, and a content hash.

Snapshot construction is generation-fenced. Each builder owns a private token and monotonically increasing generation; only that owner may advance source baselines, persist detected changes, or finalize the snapshot. A stale or force-rebuild worker cannot overwrite a newer generation. When a completed snapshot exists but its exact run remained `running` because the worker stopped in the narrow post-commit gap, reuse reconciles that run from the snapshot, including bounded source results and change counts.

For changed sources, the monitor retains only a bounded prior excerpt. The detector records whether material was new, updated, or substantially removed, plus limited added/removed terminology and an action status. A standalone “Run Source” health check does not advance the daily comparison baseline, so the next snapshot cannot silently lose a detected change.

`ensureGoogleIntelligenceSnapshotForDate()` is called by the schedule pipeline and the authenticated automation publisher. It reuses a fresh daily snapshot, starts an idempotent run when absent, waits briefly for concurrent work, and blocks when the result is unacceptable.

V3 then calls `ensureContentOperationsSnapshotForDate()` for the same local date/timezone. The second artifact records the Google snapshot relationship, source health/freshness, inventory reference, and candidate inputs. No product planning, Work Order, Unified Brief, research, writer, maintenance revision, or preview decision may bypass this order. A V3 preview may ensure/reuse only the permitted intelligence snapshots; it does not persist a planning run, decision, Work Order, brief, blog, image, publication, or Telegram side effect.

## Strict gate and fallback

With `GOOGLE_INTELLIGENCE_STRICT_GATE=true`, a failed required source, stale snapshot, unsupported status, or missing snapshot blocks Agentic generation. `GOOGLE_INTELLIGENCE_ALLOW_LAST_SUCCESSFUL=true` permits a configured fresh prior snapshot only when the current daily workflow is unavailable and the age rule still passes.

Manual overrides require `google_intelligence.override_gate`, a valid administrator, and a reason of at least ten characters. The previous status and reason remain in `AdminAuditLogs`.

## Scheduling

The singleton `GoogleIntelligenceSchedule` persists:

- enabled/paused state;
- timezone;
- daily times or interval;
- source groups;
- strict gate;
- prior-success fallback;
- maximum snapshot age;
- source timeout;
- retry count/delay;
- last/next run, error, and Mongo lease.

Set `GOOGLE_INTELLIGENCE_ENABLED=true` on every worker instance that may claim the schedule. Blog executions still call the gate if the scheduled run has not occurred.

## Permissions

- `google_intelligence.view`
- `google_intelligence.run`
- `google_intelligence.manage_sources`
- `google_intelligence.manage_schedule`
- `google_intelligence.override_gate`
- `editorial_style.view`
- `editorial_style.manage`

Existing `ADMIN` and `SUPER_ADMIN` roles remain a backward-compatible fallback. New restricted administrators should receive explicit scopes.

## Admin API

All endpoints are below `/v1/api/admin/openclaw` and require admin authentication:

- `GET /google-intelligence/status`
- `GET /google-intelligence/snapshots`
- `GET /google-intelligence/snapshots/:id`
- `POST /google-intelligence/run-now`
- `GET|POST /google-intelligence/sources`
- `PATCH /google-intelligence/sources/:id`
- `POST /google-intelligence/sources/:id/run-now`
- `GET|PATCH /google-intelligence/schedule`
- `POST /google-intelligence/schedule/enable|disable`
- `POST /google-intelligence/snapshots/:id/override`
- `GET /google-intelligence/executions`
- `GET /google-intelligence/related-blogs`

The UI is `/admin/openclaw/google-intelligence` and shows only safe configuration booleans, never tokens or secrets.

## Environment

Use `.env.example` as the source of names. Do not commit credentials.

```dotenv
GOOGLE_INTELLIGENCE_ENABLED=true
GOOGLE_INTELLIGENCE_TIMEZONE=Asia/Ho_Chi_Minh
GOOGLE_INTELLIGENCE_DAILY_TIME=05:30
GOOGLE_INTELLIGENCE_STRICT_GATE=true
GOOGLE_INTELLIGENCE_MAX_SNAPSHOT_AGE_HOURS=24
GOOGLE_INTELLIGENCE_ALLOW_LAST_SUCCESSFUL=false
GOOGLE_INTELLIGENCE_RETRY_COUNT=2
GOOGLE_INTELLIGENCE_SOURCE_TIMEOUT_MS=15000
```

## Failure recovery

1. Inspect source health and the execution error.
2. Retry only the failed source from the admin console.
3. Run the full workflow again to rebuild today's snapshot.
4. Use override only when an authorized editor has independently verified the risk and records a reason.
5. Keep Agentic publishing disabled if required official guidance cannot be verified.

## Deployment and rollback

Deploy code normally, set environment values, restart backend workers, open the admin page, verify sources, and use Run Now before enabling the blog schedule. No destructive migration is required; Mongoose creates additive collections/indexes.

To roll back, disable both Google Intelligence and blog cron, revert the feature commits, and restart backend/frontend. New collections can remain unused; do not delete them during an emergency rollback.

## Content Operations V3 operating note

The Content Operations cron is independent of the Google Intelligence schedule. Initial rollout keeps `CONTENT_OPERATIONS_CRON_ENABLED=false`, `CONTENT_LEARNING_AUTO_APPLY=false`, and `SEO_AGENT_AUTO_PUBLISH=false`; operators first verify a Google-first controlled snapshot and non-mutating preview. If the Google schedule shows no successful daily run or a stale next-run time, repair and verify that gate before enabling Content Operations scheduling.

Search Console is not part of the mandatory Google-policy fetch. Its V3 adapter is optional, read-only, and credential-backed; unavailable Search Console produces an explicit unavailable state rather than fabricated metrics. Google/service-account credentials are mounted read-only at runtime, excluded from image build context, and never returned by status APIs or the admin UI.
