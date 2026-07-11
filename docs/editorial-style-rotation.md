# Editorial Style Rotation

## Goal

Rotate real article structure while keeping the INOXPRAN voice practical, clear, trustworthy, evidence-based, and useful for Vietnamese households.

## Persisted records

`EditorialStyleDefinition` controls whether a family is enabled, its cooldown, optional lock, last use, and use count. `EditorialStyleProfile` is unique per local date and stores opening, heading, paragraph, sentence, evidence, example, CTA, visual, and answer-block modes plus recent forbidden patterns and a fingerprint target.

Multiple articles on one day reuse the daily profile but receive an incremented structural sub-variant. They do not receive a duplicate profile or a complete reusable template.

## Families

The built-in library includes problem-solution, answer-first, checklist-driven, expert-advisory, myth-vs-fact, comparison-led, narrative-case-study, diagnostic-guide, decision-tree, mistakes-to-avoid, step-by-step, buyer-journey, technical-explainer, scenario-based, evidence-first, editorial-magazine, and concise-practical-guide.

## Selection

1. Load the previous 7–14 days.
2. Exclude yesterday's family.
3. Apply each definition's cooldown using `lastUsedAt`.
4. Avoid recent opening, heading, and CTA modes.
5. Honor a locked preference only when it is not yesterday's family.
6. If all candidates are cooling down, choose the least-recently used valid family other than yesterday's.

Environment defaults:

```dotenv
EDITORIAL_STYLE_ROTATION_ENABLED=true
EDITORIAL_STYLE_LOOKBACK_DAYS=14
EDITORIAL_STYLE_DEFAULT_COOLDOWN_DAYS=7
```

## Structural fingerprint

Every generated draft stores:

- H2–H4 level sequence;
- heading modes (question, numbered, action, statement);
- heading and paragraph counts;
- paragraph rhythm;
- list/table/FAQ counts;
- opening mode;
- SHA-256 signature of the structure.

The originality gate compares this fingerprint alongside title, heading, and phrase similarity. Synonym replacement does not pass when hierarchy and rhythm remain too close.

## Admin controls

The Google Intelligence admin page can enable/disable a family, configure cooldown, lock one preference, generate today's profile, inspect recent use, and view related blog fingerprints. It intentionally cannot define a complete repeating article template.

API:

- `GET /v1/api/admin/openclaw/editorial-styles`
- `PATCH /v1/api/admin/openclaw/editorial-styles/:id`
- `POST /v1/api/admin/openclaw/editorial-styles/generate-today`

## Failure behavior

Missing research uses the internal style library and marks research coverage low. Style selection never falls back to yesterday's family. A structural similarity failure returns to strategy/rewrite and blocks automatic publication after bounded retries.
