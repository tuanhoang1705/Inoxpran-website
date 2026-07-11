# Google Intelligence and Compliance System

## Purpose

Google Intelligence is an independent, persisted compliance workflow. Every Agentic content execution must obtain an acceptable daily snapshot before planning or writing. It does not promise ranking, indexing, or inclusion in Google AI features.

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

For changed sources, the monitor retains only a bounded prior excerpt. The detector records whether material was new, updated, or substantially removed, plus limited added/removed terminology and an action status. A standalone “Run Source” health check does not advance the daily comparison baseline, so the next snapshot cannot silently lose a detected change.

`ensureGoogleIntelligenceSnapshotForDate()` is called by the schedule pipeline and the authenticated automation publisher. It reuses a fresh daily snapshot, starts an idempotent run when absent, waits briefly for concurrent work, and blocks when the result is unacceptable.

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
