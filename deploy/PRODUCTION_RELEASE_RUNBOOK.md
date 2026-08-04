# Production release runbook

`deploy/scripts/deploy.sh` is intentionally fail-closed until the two blockers
in this runbook are implemented. Running the script without an explicit mode
does nothing and exits with usage information.

## Required non-secret evidence

Supply these values through the deployment environment or deployment control
plane. They are audit references, not credentials:

- `RELEASE_COMMIT`: the full reviewed 40-character Git commit.
- `BACKUP_REFERENCE`: the immutable backup/snapshot identifier created for this
  release.
- `RESTORE_DRILL_REFERENCE`: the ticket, report, or immutable artifact proving
  that the backup class was restored into an isolated environment.
- `RESTORE_DRILL_ACKNOWLEDGEMENT=RESTORE_DRILL_VERIFIED`.
- `RELEASE_EVIDENCE_FILE`: an operator-controlled path outside the checkout to
  the external staging/release evidence manifest.
- `RELEASE_EVIDENCE_SHA256`: the separately retained SHA-256 of that exact
  manifest.
- `SECRET_ROTATION_PROOF_REFERENCE`: the restricted-control-plane reference to
  the validated, reference-only revoke/rotate proof. Never put the proof or any
  credential value in the checkout.
- `SECRET_ROTATION_PROOF_SHA256`: the digest of that non-secret proof export,
  recorded by the release control plane without copying the export into source.
- `DOMAIN`, `WWW_DOMAIN`, `ADMIN_DOMAIN`, and `SEO_AGENT_DOMAIN`: the reviewed
  hostnames that must all be present in the production certificate SAN list.
- `OPENCLAW_DATA_HOST_PATH` and `OPENCLAW_WORKSPACES_HOST_PATH`: distinct
  absolute persistent directories outside the repository checkout. They must
  already exist with the ownership/mode required by the pinned OpenClaw image.

Do not place database credentials, API keys, tokens, private certificate
material, or secret-store values in these references.

Follow `deploy/SECRET_REMEDIATION_RUNBOOK.md`. Current source and full history
are scanned through a metadata-only wrapper; fixtures remain in scope and no
detector is disabled. Validate the external reference-only proof with
`.github/scripts/validate-secret-rotation-proof.mjs` before accepting its
reference as release evidence.

After the staging pipeline has collected every gate below, store its
`inoxpran-release-evidence-v1` manifest in immutable audit storage outside the
checkout and validate it with:

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

The field-level contract is documented in `deploy/RELEASE_EVIDENCE.md`.
Validation is read-only and does not authorize production deployment or
database mutation. The manifest must explicitly retain
`productionDeploymentAuthorized=false`.

Use `deploy/scripts/deploy.sh --preflight` for read-only local validation. An
eventual release invocation must use `--apply-release` and bind
`CONFIRM_RELEASE_DEPLOY` to the exact commit as instructed by the script.
The production checkout itself must not contain checkout-local dotenv files,
local secret backups/traces, the OpenClaw lab, or the gateway-token artifact
listed in the deploy preflight denylist. The check reads only path existence and
never opens their contents.

## Mandatory release order

The production implementation must preserve this order:

1. Validate the reviewed commit, clean worktree, digest-pinned base/runtime
   images, scoped credentials, HTTPS CORS allowlist, and all no-publish/no-update
   invariants. Resolve the two OpenClaw runtime paths, reject relative,
   repository-contained, missing, or overlapping directories, and never inspect
   or copy their contents as part of deploy.
   Generate any release archive with `git archive` from `RELEASE_COMMIT`; never
   archive or recursively copy the working directory.
   Require the read-only CI workflow to pass its image contract and high/critical
   scans for backend, frontend, Redis, nginx/relay, Certbot, and OpenClaw.
   Require the n8n scan only when its automation profile is configured; otherwise
   record it as `expected_disabled`.
2. Validate `BACKUP_REFERENCE` and `RESTORE_DRILL_REFERENCE`. Stop if the backup
   cannot be located or if the isolated restore drill did not pass.
3. Build backend/frontend images tagged `git-<full-commit>`, record their Docker
   content IDs, and reject any candidate whose IDs do not match the reviewed
   release manifest.
4. Run every migration in read-only planning mode against the explicitly named
   target database. Persist and review the plan, before any apply confirmation
   is accepted.
5. Require a release- and database-bound migration confirmation. Apply only the
   reviewed plan, then verify the index manifest and post-migration counts.
6. Issue or renew the certificate with all four configured hostnames:
   `DOMAIN`, `WWW_DOMAIN`, `ADMIN_DOMAIN`, and `SEO_AGENT_DOMAIN`. Read the
   resulting certificate and fail unless every hostname is present in its SAN
   extension. The certbot renewal configuration must retain the same complete
   hostname set.
7. Start Redis and other required dependencies. Start the candidate backend and
   frontend in a separate slot that is not referenced by live nginx.
8. Wait for candidate backend `/health/ready` and frontend `/healthz`. Run direct
   candidate smoke tests, including sanitized failure envelopes and draft-only
   blog/OpenClaw invariants.
9. Validate the candidate nginx configuration with `nginx -t`. Confirm the
   loaded certificate covers `SEO_AGENT_DOMAIN` as well as the public/admin
   names. Atomically
   switch traffic only after every prior gate passes, then run public HTTPS
   smoke tests.
10. Validate and retain the external release-evidence manifest, record the
    final release manifest, and keep the previous slot available through the
    observation window. A structurally valid evidence file does not replace
    provenance review or the immutable CI/audit records referenced by it.

Any failed gate must leave live traffic on the previous slot. If a failure
occurs after the traffic switch, restore the previous nginx routing atomically,
verify readiness and public smoke, and report the failed gate plus
`errorCode`/`requestId`. Database rollback must use a reviewed forward fix or the
validated backup/restore procedure; the deploy script must never guess at a
destructive database rollback.

## Current blockers

### Single-slot Compose topology

`docker-compose.yml` fixes `container_name` for `app_backend`, `app_frontend`,
and `app_nginx`. A normal `docker compose up` replaces the services used by live
nginx, so candidate readiness cannot be proven before traffic is affected.

Before enabling `--apply-release`, add reviewed blue/green services or a
separate candidate Compose project with unique container names and network
aliases. Nginx must route to an explicit active slot, and the traffic switch
must be atomic and reversible. An acknowledgement of downtime is not equivalent
to this safety property and must not bypass the gate.

### Production-index dry-run

`npm run migrate:production-indexes:plan` is read-only by default. It emits a
sanitized deterministic before-state, additive create plan, blockers, and
`planHash`. Review and retain that output with the release evidence.

Applying requires all strict arguments:

```text
npm run migrate:production-indexes -- --apply \
  --expected-environment <staging-or-production> \
  --expected-database <exact-database-name> \
  --confirm-plan <exact-reviewed-planHash>
```

The apply path reconnects, rebuilds the plan, and rejects a changed state or
identity before mutation. It creates only missing manifest indexes, never drops
an index, and verifies the after-state. A legacy TTL index, name/key conflict,
or uniqueness failure remains a blocker requiring a separate reviewed
migration; it is never “fixed” by an automatic drop.

The topic-roadmap and novelty backfills already default to dry-run and require
explicit apply/database confirmations. They must remain fail-closed. Their
apply paths can invoke paid providers, so an operator must review the dry-run
statistics and authorize that cost separately.

### Certificate SAN orchestration

The release path is disabled before certificate mutation. When the blue/green
path is implemented, certbot issuance/renewal must take the four configured
hostnames as explicit `-d` arguments. Before nginx validation or a traffic
switch, inspect the resulting certificate and require an exact successful
hostname check for each configured name, including `SEO_AGENT_DOMAIN`.
Hostname-format validation by itself is not certificate verification.

### Conditional n8n readiness

Without the `automation` Compose profile, n8n is `expected_disabled` and
neutral. With the profile enabled, preflight requires a production hostname,
HTTPS protocol, a matching absolute HTTPS root webhook URL, and the mandatory
encryption key. The current Compose stack does not itself publish an n8n nginx
route. A separately reviewed ingress and an external HTTPS webhook/health smoke
must pass before n8n can be considered ready; otherwise keep the profile off.
Release evidence also requires external persistent data outside the checkout,
non-secret backup and isolated restore-drill references, and a zero
high/critical scan of the exact n8n image. Only the boolean fact that the
encryption key is configured is recorded; its value must never enter the
manifest.

## Invariants

Production release tooling must never turn on:

- `SEO_AGENT_AUTO_PUBLISH`
- `INOXPRAN_SEO_AGENT_AUTO_PUBLISH`
- `AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH`
- `OPENCLAW_BLOG_AUTO_PUBLISH`
- `CONTENT_LEARNING_AUTO_APPLY`
- `OPENCLAW_UPDATE_ENABLED`

It must continue to enforce `OPENCLAW_NO_AUTO_UPDATE=1`, `draftOnly=true`, and
`autoPublish=false`. This runbook does not authorize production deployment,
secret access, database mutation, certificate changes, or traffic switching.
Repository-relative OpenClaw data/workspace mounts are local-development
fallbacks only; production must use the external host paths above.
