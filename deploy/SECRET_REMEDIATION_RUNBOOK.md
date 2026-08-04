# Secret remediation runbook

This procedure is fail-closed. It never authorizes printing a credential,
posting one in chat, deleting operator files, weakening a detector, or rewriting
shared Git history automatically.

## Metadata-only scans

CI downloads the checksum-pinned Gitleaks release and invokes
`.github/scripts/secret-scan-metadata.mjs`. The wrapper suppresses all native
scanner output, uses a custom report template that contains only rule ID, file
identity, and commit identity, deletes that temporary report, and prints only:

- total finding, affected-file, and affected-commit counts;
- counts by detector rule;
- counts classified as production source, test fixture, repository tooling,
  generated artifact, or local ignored artifact.

It never emits a matched line, secret, author, email, commit message, file path,
or fingerprint. A fixture classification is diagnostic only: tracked fixtures
are scanned and are not exempt from the gate.

Use the exact binary and checksum pinned in `.github/workflows/ci.yml`:

```text
node .github/scripts/secret-scan-metadata.mjs \
  --gitleaks <verified-gitleaks-binary> \
  --scope current \
  --fail-on-findings

node .github/scripts/secret-scan-metadata.mjs \
  --gitleaks <verified-gitleaks-binary> \
  --scope history \
  --fail-on-findings
```

`current` scans tracked files plus non-ignored untracked files in an isolated
temporary snapshot. `history` scans all fetched Git history. Both gates require
zero findings.

For remediation triage, `current` also accepts a repository-relative
`--path-prefix`. It still emits counts only and is not used by CI. A filtered
pass never replaces the unfiltered current-source gate. The optional
`--location-metadata` adds only detector rule, classification, and line ranges;
it still omits file paths and all matched content.

On an operator-controlled workstation, `--scope local-ignored` inspects only
the same checkout-local sensitive targets denied by the deploy preflight. Its
output is still counts-only. This diagnostic does not make those files
production-safe: their presence in a production checkout remains a blocker even
when the finding count is zero.

## Revoke and rotate

For every credential class associated with a finding:

1. Open a restricted security incident; record references, never values.
2. Identify provider, scope, callers, and environment from the provider/secret
   store audit plane. Do not copy the old value into a ticket or report.
3. Revoke or disable the exposed credential first. For signing/encryption keys
   that require overlap, follow the provider-supported dual-key migration and
   record the bounded overlap.
4. Create a least-privilege replacement in the deployment secret store.
   Separate public, user, admin-BFF, and OpenClaw internal callers.
5. Restart or roll the authorized caller through the normal change process.
   Verify scope, expected success, expected authorization failure outside scope,
   and log redaction.
6. Record provider revocation, secret-store version, verification, and reviewer
   references. Never record a value, prefix/suffix, hash of the credential,
   authorization header, provider response body, or private-key material.
7. Only after the old credential is proven dead may security owners choose a
   reviewed shared-history cleanup procedure. This repository performs no
   automatic history rewrite.

Do not seed a replacement into source, dotenv files, CI YAML, test fixtures, or
chat. CI/CD receives values only from the approved secret store.

## Proof record

Keep the completed proof in the restricted security control plane, outside the
repository checkout. The non-secret structure is defined by
`deploy/security/secret-rotation-proof.schema.json`. Validate an exported
reference-only record before attaching its immutable reference to release
evidence:

```text
node .github/scripts/validate-secret-rotation-proof.mjs \
  <reference-only-proof.json>
```

The validator rejects extra fields, common embedded-secret forms, unsafe
references, placeholder commits, and invalid timestamps. Success output contains
counts only. Validation complements Gitleaks; it does not replace provider-side
revocation evidence or human security review.

## Release decision

Production remains blocked unless all of the following are true:

- current source scan is zero;
- full-history scan is zero, or a documented security-owner exception exists
  only after every affected old credential is proven revoked;
- checkout-local sensitive targets are absent from the production checkout;
- the reference-only proof validates and points to immutable provider,
  secret-store, scope-test, and reviewer evidence;
- the reviewed release commit passes the normal CI and staging gates.

Detector allowlists, baseline suppression, rule disablement, and fixture
exemptions require a separate security-reviewed change. They must never be used
merely to make a failing release green.
