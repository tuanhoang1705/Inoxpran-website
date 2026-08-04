import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  approvalForDigest,
  resolveManualUpdatePolicy,
  reviewedImage,
  validateManualUpdateRequest,
} from "./update-policy.mjs";

const digest = "a".repeat(64);
const image = `ghcr.io/openclaw/openclaw:2026.7.1@sha256:${digest}`;
const releaseCommit = "b".repeat(40);

const validEnv = () => ({
  OPENCLAW_IMAGE: image,
  OPENCLAW_UPDATE_IMAGE: image,
  OPENCLAW_NO_AUTO_UPDATE: "1",
  OPENCLAW_UPDATE_ENABLED: "false",
  OPENCLAW_MANUAL_UPDATE_APPROVAL: approvalForDigest(digest),
  OPENCLAW_UPDATE_RUNTIME_DIR: path.join(
    os.tmpdir(),
    "inoxpran-openclaw-manual-update-runtime",
  ),
  OPENCLAW_UPDATE_BACKUP_DIR: path.join(
    os.tmpdir(),
    "inoxpran-openclaw-manual-update-backups",
  ),
  RELEASE_COMMIT: releaseCommit,
});

const validRequest = (now = Date.now()) => ({
  schemaVersion: 2,
  action: "update-openclaw-manual",
  requestId: randomUUID(),
  requestedAt: new Date(now).toISOString(),
  targetImage: image,
  releaseCommit,
  approval: approvalForDigest(digest),
});

test("accepts one explicitly approved immutable image and release commit", () => {
  const policy = resolveManualUpdatePolicy(validEnv());
  const request = validateManualUpdateRequest(validRequest(), policy);
  assert.equal(policy.image, image);
  assert.equal(request.targetImage, image);
  assert.equal(request.releaseCommit, releaseCommit);
  assert.notEqual(policy.runtimeDir, policy.backupRoot);
});

test("rejects missing, mutable, and placeholder image references", () => {
  assert.throws(() => reviewedImage(""), /explicit version tag/);
  assert.throws(
    () => reviewedImage(`openclaw/openclaw:latest@sha256:${digest}`),
    /mutable latest/,
  );
  assert.throws(
    () => reviewedImage(`openclaw/openclaw:2026.7.1@sha256:${"0".repeat(64)}`),
    /all-zero/,
  );
});

test("keeps automatic updates disabled during the manual flow", () => {
  assert.throws(
    () =>
      resolveManualUpdatePolicy({
        ...validEnv(),
        OPENCLAW_UPDATE_ENABLED: "true",
      }),
    /must remain false/,
  );
  assert.throws(
    () =>
      resolveManualUpdatePolicy({
        ...validEnv(),
        OPENCLAW_NO_AUTO_UPDATE: "0",
      }),
    /must equal 1/,
  );
});

test("binds approval to the exact target digest and Compose image", () => {
  assert.throws(
    () =>
      resolveManualUpdatePolicy({
        ...validEnv(),
        OPENCLAW_MANUAL_UPDATE_APPROVAL: "APPROVE_OPENCLAW_UPDATE_WRONG",
      }),
    /does not acknowledge/,
  );
  assert.throws(
    () =>
      resolveManualUpdatePolicy({
        ...validEnv(),
        OPENCLAW_IMAGE: `ghcr.io/openclaw/openclaw:2026.7.2@sha256:${"c".repeat(64)}`,
      }),
    /must exactly match/,
  );
});

test("requires distinct update state directories outside the checkout", () => {
  assert.throws(
    () =>
      resolveManualUpdatePolicy({
        ...validEnv(),
        OPENCLAW_UPDATE_RUNTIME_DIR: process.cwd(),
      }),
    /outside the repository/,
  );
  const shared = path.join(os.tmpdir(), "inoxpran-openclaw-shared");
  assert.throws(
    () =>
      resolveManualUpdatePolicy({
        ...validEnv(),
        OPENCLAW_UPDATE_RUNTIME_DIR: shared,
        OPENCLAW_UPDATE_BACKUP_DIR: shared,
      }),
    /distinct and non-overlapping/,
  );
});

test("rejects stale requests and requests for another image or commit", () => {
  const now = Date.now();
  const policy = resolveManualUpdatePolicy(validEnv());
  assert.throws(
    () =>
      validateManualUpdateRequest(validRequest(now - 16 * 60 * 1000), policy, {
        now,
      }),
    /Expired/,
  );
  assert.throws(
    () =>
      validateManualUpdateRequest(
        {
          ...validRequest(now),
          targetImage: `ghcr.io/openclaw/openclaw:2026.7.2@sha256:${"c".repeat(64)}`,
        },
        policy,
        { now },
      ),
    /target does not match/,
  );
  assert.throws(
    () =>
      validateManualUpdateRequest(
        { ...validRequest(now), releaseCommit: "d".repeat(40) },
        policy,
        { now },
      ),
    /not bound/,
  );
});
