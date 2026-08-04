# OpenClaw manual updater

This directory is not part of the production Compose stack. The backend has no
writable update queue mount, and `OPENCLAW_UPDATE_ENABLED` must remain `false`.
The updater may only be used as a separately reviewed, short-lived operator
tool.

## Required audit inputs

Configure these values through the operator environment or secret/config store,
not in a tracked `.env` file:

- `OPENCLAW_IMAGE` and `OPENCLAW_UPDATE_IMAGE`: the same explicit version tag
  plus non-zero `@sha256:` digest;
- `OPENCLAW_NO_AUTO_UPDATE=1`;
- `OPENCLAW_UPDATE_ENABLED=false`;
- `RELEASE_COMMIT`: the reviewed 40-character Git commit;
- `OPENCLAW_UPDATE_RUNTIME_DIR`: an external directory outside the checkout;
- `OPENCLAW_UPDATE_BACKUP_DIR`: a separate external directory outside the
  checkout;
- `OPENCLAW_MANUAL_UPDATE_APPROVAL`: the value printed by an operator-side call
  to `approvalForDigest()` for the reviewed digest.

The processing request is schema version 2:

```json
{
  "schemaVersion": 2,
  "action": "update-openclaw-manual",
  "requestId": "<uuid-v4>",
  "requestedAt": "<current ISO-8601 timestamp>",
  "targetImage": "<same reviewed image reference>",
  "releaseCommit": "<same reviewed release commit>",
  "approval": "<digest-bound approval>"
}
```

The worker accepts only
`$OPENCLAW_UPDATE_RUNTIME_DIR/processing.json`, rejects requests older than
15 minutes, and removes `.env` from its backup set. Rollback recreates the
OpenClaw service from the locally tagged previous image rather than retagging a
mutable or digest-qualified target.

Before any manual run, verify the backup/restore evidence, container scan,
Gateway health check, Nginx route check and rollback owner in the release
evidence manifest. Never leave a Docker socket mounted after the one-time
operator task.

Run the policy tests without Docker:

```sh
node --test deploy/openclaw/updater/update-policy.test.mjs
```
