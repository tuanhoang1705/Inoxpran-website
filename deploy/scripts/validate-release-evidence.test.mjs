import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateReleaseEvidence } from "./validate-release-evidence.mjs";

const COMMIT = "a".repeat(40);
const NOW = new Date("2026-07-29T12:00:00.000Z");
const HOSTS = [
  "inoxpran.example",
  "www.inoxpran.example",
  "admin.inoxpran.example",
  "seo-agent.inoxpran.example",
];

const hash = (label) =>
  createHash("sha256")
    .update(`release-evidence-fixture:${label}`)
    .digest("hex");
const image = (name, tag, digestCharacter) =>
  `registry.example/inoxpran/${name}:${tag}@sha256:${hash(digestCharacter)}`;

const validManifest = () => ({
  schemaVersion: "inoxpran-release-evidence-v1",
  release: {
    releaseId: `release-prod-${COMMIT.slice(0, 12)}`,
    commit: COMMIT,
    targetEnvironment: "production",
    generatedAt: "2026-07-29T11:55:00.000Z",
  },
  safety: {
    SEO_AGENT_AUTO_PUBLISH: false,
    INOXPRAN_SEO_AGENT_AUTO_PUBLISH: false,
    AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH: false,
    OPENCLAW_BLOG_AUTO_PUBLISH: false,
    CONTENT_LEARNING_AUTO_APPLY: false,
    OPENCLAW_UPDATE_ENABLED: false,
    OPENCLAW_NO_AUTO_UPDATE: "1",
    draftOnly: true,
    autoPublish: false,
    productionDeploymentAuthorized: false,
  },
  qualityGates: {
    reference: "ci-run:987654321",
    checkedAt: "2026-07-29T11:30:00.000Z",
    commit: COMMIT,
    backend: { passed: true, total: 873, failed: 0, skipped: 0 },
    frontend: { passed: true, total: 131, failed: 0, skipped: 0 },
    browser: { passed: true, total: 11, failed: 0, skipped: 0 },
    secretScan: { passed: true, fullHistory: true, findings: 0 },
    containerScan: {
      passed: true,
      high: 0,
      critical: 0,
      scannedImages: [
        "backend",
        "frontend",
        "redis",
        "nginx",
        "certbot",
        "openclaw",
      ],
    },
  },
  artifacts: {
    backend: image("backend", `git-${COMMIT}`, "1"),
    frontend: image("frontend", `git-${COMMIT}`, "2"),
    redis: image("redis", "7.4.2", "3"),
    nginx: image("nginx", "1.28.0", "4"),
    certbot: image("certbot", "4.1.1", "5"),
    openclaw: image("openclaw", "2026.7.29", "6"),
    n8n: null,
  },
  backup: {
    reference: "backup:prod:20260729T100000Z",
    sourceEnvironment: "production",
    contentHash: hash("7"),
    completedAt: "2026-07-29T10:00:00.000Z",
    immutable: true,
    encrypted: true,
    restoreDrill: {
      reference: "restore-drill:20260720:isolated",
      sourceBackupReference: "backup:prod:20260729T100000Z",
      completedAt: "2026-07-20T10:00:00.000Z",
      passed: true,
      isolatedEnvironment: true,
      dataIntegrityVerified: true,
    },
  },
  migration: {
    targetDryRun: {
      reference: "migration-plan:prod:20260729",
      completedAt: "2026-07-29T10:30:00.000Z",
      commit: COMMIT,
      environment: "production",
      databaseIdentityHash: hash("8"),
      planHash: hash("9"),
      readOnly: true,
      passed: true,
      blockers: [],
      destructiveOperations: 0,
    },
    stagingApply: {
      reference: "migration-apply:staging:20260729",
      completedAt: "2026-07-29T10:40:00.000Z",
      commit: COMMIT,
      environment: "staging",
      databaseIdentityHash: hash("b"),
      planHash: hash("c"),
      confirmedPlanHash: hash("c"),
      explicitConfirmation: true,
      isolatedDatabase: true,
      applied: true,
      verificationPassed: true,
    },
    productionApplyAuthorized: false,
  },
  mongoIndexes: {
    reference: "mongo-indexes:staging:20260729",
    checkedAt: "2026-07-29T10:45:00.000Z",
    environment: "staging",
    databaseIdentityHash: hash("b"),
    manifestHash: hash("d"),
    passed: true,
    autoIndexDisabled: true,
    requiredIndexes: 10,
    verifiedIndexes: 10,
    missing: [],
    conflicts: [],
    legacyTtlIndexes: [],
  },
  canary: {
    reference: "canary:staging:20260729",
    completedAt: "2026-07-29T11:00:00.000Z",
    environment: "staging",
    databaseIdentityHash: hash("b"),
    isolatedDatabase: true,
    draftOnly: true,
    autoPublish: false,
    sequence: ["queued", "running", "completed"],
    result: "completed",
    topic: {
      opportunityScore: 82,
      noveltyScore: 48,
      persistedEvidenceCount: 3,
      scoreHash: hash("e"),
      rubricVersion: "roadmap-rubric-v2",
      corpusVersion: "corpus-2026-07-29",
    },
    publishedPostsDelta: 0,
    publicPostCreated: false,
    safetyGatePassed: true,
  },
  tls: {
    reference: "tls-check:production:20260729",
    checkedAt: "2026-07-29T11:10:00.000Z",
    httpsOnly: true,
    chainValid: true,
    sanVerified: true,
    notBefore: "2026-07-01T00:00:00.000Z",
    notAfter: "2026-09-01T00:00:00.000Z",
    expectedHosts: [...HOSTS],
    sans: [...HOSTS],
  },
  smoke: {
    reference: "smoke:staging:20260729",
    checkedAt: "2026-07-29T11:20:00.000Z",
    environment: "staging",
    databaseIdentityHash: hash("b"),
    candidateSlotIsolated: true,
    liveTrafficUnaffected: true,
    backendLive: { passed: true, status: 200 },
    backendReady: { passed: true, status: 200 },
    frontendHealth: { passed: true, status: 200 },
    publicHttps: { passed: true, status: 200 },
    requestCorrelationVerified: true,
    sanitized502Verified: true,
    sanitized504Verified: true,
    oneClickOnePostVerified: true,
    pollingReadOnlyVerified: true,
    noPublishedPostCreated: true,
  },
  rollback: {
    reference: "rollback-drill:staging:20260720",
    testedAt: "2026-07-20T12:00:00.000Z",
    isolatedEnvironment: true,
    simulationOnly: true,
    passed: true,
    trafficSwitchReversible: true,
    previousSlotReady: true,
    readinessRestored: true,
    smokeRestored: true,
    liveTrafficUnaffected: true,
    dataLossObserved: false,
    destructiveDatabaseRollbackAttempted: false,
    databaseRecoveryMode: "forward_fix_or_validated_restore",
  },
  capabilities: {
    n8n: {
      status: "expected_disabled",
    },
  },
});

const validate = (manifest, overrides = {}) =>
  validateReleaseEvidence(manifest, {
    expectedCommit: COMMIT,
    expectedEnvironment: "production",
    expectedHosts: HOSTS,
    now: NOW,
    ...overrides,
  });

const errorCodes = (result) =>
  new Set(result.errors.map((error) => error.code));

test("accepts complete, commit-bound, draft-only release evidence", () => {
  const result = validate(validManifest());
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.summary, {
    schemaVersion: "inoxpran-release-evidence-v1",
    commit: COMMIT,
    targetEnvironment: "production",
    expectedHostCount: 4,
    n8n: "expected_disabled",
  });
});

test("fails closed when a publish/update invariant is weakened", () => {
  const manifest = validManifest();
  manifest.safety.OPENCLAW_BLOG_AUTO_PUBLISH = true;
  manifest.safety.OPENCLAW_NO_AUTO_UPDATE = "0";
  manifest.canary.draftOnly = false;
  manifest.canary.autoPublish = true;
  manifest.canary.publishedPostsDelta = 1;
  manifest.canary.publicPostCreated = true;

  const result = validate(manifest);
  assert.equal(result.valid, false);
  assert(errorCodes(result).has("FALSE_REQUIRED"));
  assert(errorCodes(result).has("NO_AUTO_UPDATE_VALUE_INVALID"));
  assert(errorCodes(result).has("TRUE_REQUIRED"));
  assert(errorCodes(result).has("INTEGER_VALUE_INVALID"));
});

test("rejects stale or incomplete TLS/SAN evidence", () => {
  const manifest = validManifest();
  manifest.tls.checkedAt = "2026-07-20T11:10:00.000Z";
  manifest.tls.notAfter = "2026-08-01T00:00:00.000Z";
  manifest.tls.sans = HOSTS.slice(0, 3);

  const result = validate(manifest);
  assert.equal(result.valid, false);
  assert(errorCodes(result).has("EVIDENCE_STALE"));
  assert(errorCodes(result).has("CERTIFICATE_EXPIRY_TOO_CLOSE"));
  assert(errorCodes(result).has("CERTIFICATE_SAN_MISSING"));
});

test("rejects unreachable or unsafe canary evidence", () => {
  const manifest = validManifest();
  manifest.canary.sequence = ["queued", "completed"];
  manifest.canary.topic.opportunityScore = 81.99;
  manifest.canary.topic.noveltyScore = 47.99;
  manifest.canary.topic.persistedEvidenceCount = 0;

  const result = validate(manifest);
  assert.equal(result.valid, false);
  assert(errorCodes(result).has("CANARY_SEQUENCE_INVALID"));
  assert(errorCodes(result).has("NUMBER_TOO_SMALL"));
  assert(errorCodes(result).has("INTEGER_TOO_SMALL"));
});

test("binds migration confirmation, indexes, canary and smoke to one staging database", () => {
  const manifest = validManifest();
  manifest.migration.stagingApply.confirmedPlanHash = hash("f");
  manifest.mongoIndexes.verifiedIndexes = 9;
  manifest.canary.databaseIdentityHash = hash("0");
  manifest.smoke.databaseIdentityHash = hash("1");

  const result = validate(manifest);
  assert.equal(result.valid, false);
  assert(errorCodes(result).has("MIGRATION_PLAN_CONFIRMATION_MISMATCH"));
  assert(errorCodes(result).has("INDEX_COUNT_MISMATCH"));
  assert(errorCodes(result).has("DATABASE_IDENTITY_MISMATCH"));
});

test("keeps disabled n8n neutral and requires all external-data evidence when enabled", () => {
  const enabled = validManifest();
  enabled.artifacts.n8n = image("n8n", "2.1.0", "f");
  enabled.qualityGates.containerScan.scannedImages.push("n8n");
  enabled.capabilities.n8n = {
    status: "enabled",
    externalDataDirectoryConfigured: true,
    dataOutsideCheckout: true,
    encryptionKeyConfigured: true,
    backupReference: "n8n-backup:20260729",
    restoreDrillReference: "n8n-restore:20260720",
    imageScanPassed: true,
    httpsSmokePassed: true,
  };
  assert.equal(validate(enabled).valid, true);

  enabled.capabilities.n8n.dataOutsideCheckout = false;
  enabled.capabilities.n8n.restoreDrillReference = "";
  enabled.qualityGates.containerScan.scannedImages =
    enabled.qualityGates.containerScan.scannedImages.filter(
      (imageName) => imageName !== "n8n",
    );
  const result = validate(enabled);
  assert.equal(result.valid, false);
  assert(errorCodes(result).has("TRUE_REQUIRED"));
  assert(errorCodes(result).has("STRING_REQUIRED"));
  assert(errorCodes(result).has("ENABLED_CAPABILITY_SCAN_REQUIRED"));
  assert(errorCodes(result).has("ARRAY_SET_MISMATCH"));
});

test("rejects secret-like fields and never returns their values", () => {
  const manifest = validManifest();
  const sensitiveCanary = [
    "token",
    ["release", "evidence", "canary", "value"].join("-"),
  ].join("=");
  manifest.credentials = {
    token: sensitiveCanary,
  };

  const result = validate(manifest);
  assert.equal(result.valid, false);
  assert(errorCodes(result).has("SENSITIVE_FIELD_FORBIDDEN"));
  assert(errorCodes(result).has("SENSITIVE_VALUE_FORBIDDEN"));
  assert(errorCodes(result).has("UNKNOWN_FIELD"));
  assert.equal(JSON.stringify(result).includes(sensitiveCanary), false);
});

test("rejects commit mismatch, mutable images, placeholder digests and non-zero findings", () => {
  const manifest = validManifest();
  manifest.release.commit = "b".repeat(40);
  manifest.artifacts.redis = `registry.example/inoxpran/redis:latest@sha256:${hash("3")}`;
  manifest.artifacts.openclaw = `registry.example/inoxpran/openclaw:2026.7.29@sha256:${"0".repeat(64)}`;
  manifest.artifacts.certbot = manifest.artifacts.nginx;
  manifest.qualityGates.secretScan.findings = 1;
  manifest.qualityGates.containerScan.high = 1;

  const result = validate(manifest);
  assert.equal(result.valid, false);
  assert(errorCodes(result).has("COMMIT_MISMATCH"));
  assert(errorCodes(result).has("MUTABLE_IMAGE_TAG_FORBIDDEN"));
  assert(errorCodes(result).has("PLACEHOLDER_IMAGE_DIGEST_FORBIDDEN"));
  assert(errorCodes(result).has("DUPLICATE_IMAGE_REFERENCE"));
  assert(errorCodes(result).has("INTEGER_VALUE_INVALID"));
});

test("CLI reads only an external regular manifest and emits a sanitized summary", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "inoxpran-release-evidence-"),
  );
  try {
    const manifestPath = path.join(temporaryDirectory, "evidence.json");
    const manifestSource = JSON.stringify(validManifest());
    fs.writeFileSync(manifestPath, manifestSource, {
      encoding: "utf8",
      mode: 0o600,
    });
    const manifestSha256 = createHash("sha256")
      .update(manifestSource)
      .digest("hex");
    const scriptPath = fileURLToPath(
      new URL("./validate-release-evidence.mjs", import.meta.url),
    );
    const argumentsList = [
      scriptPath,
      "--manifest",
      manifestPath,
      "--expected-manifest-sha256",
      manifestSha256,
      "--expected-commit",
      COMMIT,
      "--expected-environment",
      "production",
      ...HOSTS.flatMap((host) => ["--expected-host", host]),
    ];
    const result = spawnSync(process.execPath, argumentsList, {
      encoding: "utf8",
      env: {},
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^RELEASE_EVIDENCE_VALID /);
    assert.equal(result.stdout.includes("backup:prod"), false);
    assert.equal(result.stderr, "");

    const digestArgumentIndex = argumentsList.indexOf(
      "--expected-manifest-sha256",
    );
    const mismatchedArguments = [...argumentsList];
    mismatchedArguments[digestArgumentIndex + 1] = hash("0");
    const mismatch = spawnSync(process.execPath, mismatchedArguments, {
      encoding: "utf8",
      env: {},
      timeout: 10_000,
    });
    assert.equal(mismatch.status, 1);
    assert.equal(mismatch.stdout, "");
    assert.equal(
      mismatch.stderr,
      "RELEASE_EVIDENCE_VALIDATOR_FAILED code=MANIFEST_SHA256_MISMATCH\n",
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("CLI rejects a manifest inside the repository before reading it", () => {
  const scriptPath = fileURLToPath(
    new URL("./validate-release-evidence.mjs", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--manifest",
      fileURLToPath(import.meta.url),
      "--expected-manifest-sha256",
      hash("f"),
      "--expected-commit",
      COMMIT,
      "--expected-environment",
      "production",
      ...HOSTS.flatMap((host) => ["--expected-host", host]),
    ],
    {
      encoding: "utf8",
      env: {},
      timeout: 10_000,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "RELEASE_EVIDENCE_VALIDATOR_FAILED code=MANIFEST_INSIDE_CHECKOUT_FORBIDDEN\n",
  );
});
