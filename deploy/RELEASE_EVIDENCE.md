# Release evidence contract

`deploy/scripts/validate-release-evidence.mjs` is a read-only, fail-closed
validator for evidence produced by a separate staging/release pipeline. It
does not connect to MongoDB, call an API, inspect a secret store, build an
image, change a certificate, switch traffic, publish content, or deploy.

The validator checks the structure and internal consistency of evidence. It
does not prove that an operator or external system told the truth. Evidence
references and the manifest itself must therefore come from reviewed,
access-controlled CI/audit storage with retention and immutability controls.
No operator-consumable passing JSON manifest is committed to this repository;
the in-memory positive test fixture is not an audit artifact.

## Invocation

Keep the manifest outside the Git checkout and supply only non-secret expected
values:

```bash
node deploy/scripts/validate-release-evidence.mjs \
  --manifest "$RELEASE_EVIDENCE_FILE" \
  --expected-manifest-sha256 "$RELEASE_EVIDENCE_SHA256" \
  --expected-commit "$RELEASE_COMMIT" \
  --expected-environment production \
  --expected-host "$DOMAIN" \
  --expected-host "$WWW_DOMAIN" \
  --expected-host "$ADMIN_DOMAIN" \
  --expected-host "$SEO_AGENT_DOMAIN"
```

Exactly four unique `--expected-host` values are required for the public,
`www`, admin, and SEO-agent names. The manifest must be a regular, non-symlink
JSON file no larger than 512 KiB.
Its SHA-256 must exactly match the separately retained control-plane digest.
The validator deliberately rejects manifests inside the repository. It never
prints evidence values: success output contains only schema, environment,
short commit, host count, and n8n state; errors contain only an allowlisted
code and JSON field path.

The command exits zero only for
`schemaVersion=inoxpran-release-evidence-v1`. Unknown fields, missing fields,
duplicate host/image entries, malformed identifiers, secret-named fields, and
secret-shaped values fail validation.

## Evidence groups

Every group is mandatory:

- `release`: immutable release ID, exact 40-character commit, target
  environment, and manifest generation time. The manifest expires after 24
  hours.
- `safety`: all six no-publish/no-apply/no-update flags are `false`;
  `OPENCLAW_NO_AUTO_UPDATE` is exactly `"1"`; `draftOnly=true`,
  `autoPublish=false`, and `productionDeploymentAuthorized=false`.
- `qualityGates`: commit-bound backend, frontend, and browser results with no
  failed or skipped tests; full-history secret scan with zero findings; and
  image scans with zero high/critical findings.
- `artifacts`: backend/frontend images tagged `git-<full-commit>` plus reviewed
  Redis, nginx, Certbot, and OpenClaw images. Every image has a non-`latest`
  version and a non-zero immutable SHA-256 digest.
- `backup`: an immutable encrypted backup from the target environment, its
  SHA-256 content identity, and a successful data-integrity restore drill in
  an isolated environment. Backup evidence is at most 24 hours old; a restore
  drill is at most 30 days old.
- `migration`: a read-only target dry-run bound to commit, environment,
  database identity and deterministic `planHash`; no blocker or destructive
  operation; and a separately confirmed apply against an isolated staging
  database. `productionApplyAuthorized` remains false. This manifest cannot
  authorize or invoke an apply.
- `mongoIndexes`: post-staging-apply verification against the same hashed
  database identity, with `autoIndex` disabled, every required index verified,
  and no missing, conflicting, or legacy TTL index.
- `canary`: an isolated staging run with `draftOnly=true`,
  `autoPublish=false`, exact `queued -> running -> completed|no_change`
  lifecycle, no published delta, and no public post. The selected persisted
  topic must retain evidence and meet the unchanged 82 opportunity / 48
  novelty thresholds.
- `tls`: recent HTTPS chain validation and explicit SAN verification. The SAN
  set must contain every `--expected-host`; wildcard inference is not accepted,
  and the certificate must have at least 14 days remaining.
- `smoke`: isolated staging candidate health/readiness/HTTPS checks plus
  correlation ID, sanitized 502/504, one-click/one-POST, read-only polling, and
  no-publish evidence, all bound to the staging database identity.
- `rollback`: an isolated simulation showing reversible routing, previous-slot
  readiness, restored readiness/smoke, no live-traffic impact, no data loss,
  and no guessed destructive database rollback. Database recovery stays
  `forward_fix_or_validated_restore`.

Times must be canonical UTC ISO-8601 values. Release, quality, backup,
migration, index, canary, TLS, and smoke evidence is limited to 24 hours.
Restore and rollback drills are limited to 30 days. A five-minute future clock
skew is tolerated; larger future timestamps fail.

## Conditional n8n evidence

`capabilities.n8n.status=expected_disabled` is neutral. In that state the n8n
artifact must be `null`, n8n must not appear in the scanned-image set, and no
fabricated readiness fields are accepted.

When `status=enabled`, all of the following become mandatory:

- a reviewed digest-pinned n8n image included in the zero-high/critical scan;
- external persistent data storage outside the checkout;
- an encryption key reported as configured without including its value;
- non-secret backup and isolated restore-drill references;
- a passing HTTPS smoke result.

These checks do not replace the supported n8n credential backup/migration
procedure. Keep n8n `expected_disabled` until the external storage, backup,
restore, ingress, and smoke evidence really exists.

## CI contract tests

CI runs:

```bash
node --test deploy/scripts/validate-release-evidence.test.mjs
```

The tests cover a complete manifest and negative cases for weakened publish
flags, stale/missing SAN evidence, scores below 82/48, migration/index/database
identity mismatches, n8n without external-data evidence, secret-shaped input,
mutable/placeholder images, a mismatched manifest digest, non-zero findings,
and unsafe manifest paths.
They validate the validator only; they are not release evidence and cannot
unblock production.
