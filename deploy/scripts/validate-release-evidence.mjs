#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = "inoxpran-release-evidence-v1";
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#+-]{7,239}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const HOST_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IMAGE_PATTERN =
  /^(?:[A-Za-z0-9._-]+(?::[0-9]+)?\/)?[A-Za-z0-9._/-]+:([A-Za-z0-9][A-Za-z0-9._-]{0,127})@sha256:([a-f0-9]{64})$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MIN_TLS_REMAINING_MS = 14 * DAY_MS;

const REQUIRED_SCANNED_IMAGES = Object.freeze([
  "backend",
  "certbot",
  "frontend",
  "nginx",
  "openclaw",
  "redis",
]);

const PROTECTED_FALSE_FLAGS = Object.freeze([
  "SEO_AGENT_AUTO_PUBLISH",
  "INOXPRAN_SEO_AGENT_AUTO_PUBLISH",
  "AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH",
  "OPENCLAW_BLOG_AUTO_PUBLISH",
  "CONTENT_LEARNING_AUTO_APPLY",
  "OPENCLAW_UPDATE_ENABLED",
]);

const SENSITIVE_KEY_NAMES = new Set([
  "apikey",
  "authorization",
  "connectionstring",
  "cookie",
  "credential",
  "credentials",
  "mongodburi",
  "password",
  "privatekey",
  "redisurl",
  "secret",
  "secrets",
  "token",
]);

const SENSITIVE_VALUE_PATTERNS = Object.freeze([
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:mongodb(?:\+srv)?|redis|rediss):\/\/[^/\s:@]+:[^@\s]+@/i,
  /\b(?:api[_-]?key|authorization|password|private[_-]?key|secret|token)\s*[:=]\s*\S{8,}/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bghp_[A-Za-z0-9]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/i,
]);

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const normalizeKeyName = (value) =>
  String(value || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();

const makeContext = ({
  expectedCommit,
  expectedEnvironment,
  expectedHosts,
  now,
}) => ({
  expectedCommit,
  expectedEnvironment,
  expectedHosts,
  now,
  errors: [],
});

const addError = (context, code, fieldPath) => {
  context.errors.push({ code, path: fieldPath });
};

const inspectForSensitiveMaterial = (context, value, fieldPath = "$") => {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      inspectForSensitiveMaterial(context, item, `${fieldPath}[${index}]`),
    );
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = `${fieldPath}.${key}`;
      if (SENSITIVE_KEY_NAMES.has(normalizeKeyName(key))) {
        addError(context, "SENSITIVE_FIELD_FORBIDDEN", nestedPath);
      }
      inspectForSensitiveMaterial(context, nested, nestedPath);
    }
    return;
  }
  if (
    typeof value === "string" &&
    SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))
  ) {
    addError(context, "SENSITIVE_VALUE_FORBIDDEN", fieldPath);
  }
};

const requireObject = (
  context,
  value,
  fieldPath,
  { required = [], allowed = required } = {},
) => {
  if (!isPlainObject(value)) {
    addError(context, "OBJECT_REQUIRED", fieldPath);
    return null;
  }
  const allowedSet = new Set(allowed);
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!allowedSet.has(key)) {
      addError(context, "UNKNOWN_FIELD", `${fieldPath}.${key}`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      addError(context, "FIELD_REQUIRED", `${fieldPath}.${key}`);
    }
  }
  return value;
};

const requireArray = (context, value, fieldPath) => {
  if (!Array.isArray(value)) {
    addError(context, "ARRAY_REQUIRED", fieldPath);
    return null;
  }
  return value;
};

const requireString = (
  context,
  value,
  fieldPath,
  { pattern, allowedValues } = {},
) => {
  if (typeof value !== "string" || value.length === 0) {
    addError(context, "STRING_REQUIRED", fieldPath);
    return "";
  }
  if (pattern && !pattern.test(value)) {
    addError(context, "STRING_FORMAT_INVALID", fieldPath);
  }
  if (allowedValues && !allowedValues.includes(value)) {
    addError(context, "STRING_VALUE_INVALID", fieldPath);
  }
  return value;
};

const requireInteger = (
  context,
  value,
  fieldPath,
  { minimum = Number.MIN_SAFE_INTEGER, exact } = {},
) => {
  if (!Number.isSafeInteger(value)) {
    addError(context, "INTEGER_REQUIRED", fieldPath);
    return null;
  }
  if (value < minimum) addError(context, "INTEGER_TOO_SMALL", fieldPath);
  if (exact !== undefined && value !== exact) {
    addError(context, "INTEGER_VALUE_INVALID", fieldPath);
  }
  return value;
};

const requireNumber = (context, value, fieldPath, { minimum } = {}) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addError(context, "NUMBER_REQUIRED", fieldPath);
    return null;
  }
  if (minimum !== undefined && value < minimum) {
    addError(context, "NUMBER_TOO_SMALL", fieldPath);
  }
  return value;
};

const requireBoolean = (context, value, fieldPath, expected) => {
  if (typeof value !== "boolean") {
    addError(context, "BOOLEAN_REQUIRED", fieldPath);
    return null;
  }
  if (expected !== undefined && value !== expected) {
    addError(context, expected ? "TRUE_REQUIRED" : "FALSE_REQUIRED", fieldPath);
  }
  return value;
};

const parseTimestamp = (context, value, fieldPath) => {
  const text = requireString(context, value, fieldPath, {
    pattern: ISO_UTC_PATTERN,
  });
  if (!text || !ISO_UTC_PATTERN.test(text)) return null;
  const timestamp = Date.parse(text);
  const normalizedText = text.includes(".")
    ? text
    : text.replace(/Z$/, ".000Z");
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== normalizedText
  ) {
    addError(context, "TIMESTAMP_INVALID", fieldPath);
    return null;
  }
  return timestamp;
};

const requireRecentTimestamp = (
  context,
  value,
  fieldPath,
  { maxAgeMs, referenceTime = context.now } = {},
) => {
  const timestamp = parseTimestamp(context, value, fieldPath);
  if (timestamp === null) return null;
  if (timestamp > referenceTime + MAX_CLOCK_SKEW_MS) {
    addError(context, "TIMESTAMP_IN_FUTURE", fieldPath);
  }
  if (maxAgeMs !== undefined && referenceTime - timestamp > maxAgeMs) {
    addError(context, "EVIDENCE_STALE", fieldPath);
  }
  return timestamp;
};

const requireReference = (context, value, fieldPath) =>
  requireString(context, value, fieldPath, { pattern: REFERENCE_PATTERN });

const requireHash = (context, value, fieldPath) => {
  const hash = requireString(context, value, fieldPath, {
    pattern: HASH_PATTERN,
  });
  if (HASH_PATTERN.test(hash) && /^([a-f0-9])\1{63}$/.test(hash)) {
    addError(context, "PLACEHOLDER_HASH_FORBIDDEN", fieldPath);
  }
  return hash;
};

const requireCommit = (context, value, fieldPath) =>
  requireString(context, value, fieldPath, { pattern: COMMIT_PATTERN });

const requireEmptyArray = (context, value, fieldPath) => {
  const array = requireArray(context, value, fieldPath);
  if (array && array.length !== 0)
    addError(context, "EMPTY_ARRAY_REQUIRED", fieldPath);
  return array;
};

const requireStringSet = (context, value, fieldPath, expectedValues) => {
  const array = requireArray(context, value, fieldPath);
  if (!array) return;
  const normalized = [];
  array.forEach((item, index) => {
    if (typeof item !== "string" || item.length === 0) {
      addError(context, "STRING_REQUIRED", `${fieldPath}[${index}]`);
      return;
    }
    normalized.push(item.toLowerCase());
  });
  if (new Set(normalized).size !== normalized.length) {
    addError(context, "DUPLICATE_ARRAY_VALUE", fieldPath);
  }
  const expected = [
    ...new Set(expectedValues.map((item) => item.toLowerCase())),
  ].sort();
  const actual = [...new Set(normalized)].sort();
  if (
    expected.length !== actual.length ||
    expected.some((item, index) => item !== actual[index])
  ) {
    addError(context, "ARRAY_SET_MISMATCH", fieldPath);
  }
};

const requireImageReference = (
  context,
  value,
  fieldPath,
  { expectedAppCommit } = {},
) => {
  const image = requireString(context, value, fieldPath);
  const match = image.match(IMAGE_PATTERN);
  if (!match) {
    if (image) addError(context, "IMAGE_REFERENCE_INVALID", fieldPath);
    return;
  }
  const [, tag, digest] = match;
  if (tag.toLowerCase() === "latest") {
    addError(context, "MUTABLE_IMAGE_TAG_FORBIDDEN", fieldPath);
  }
  if (/^([a-f0-9])\1{63}$/.test(digest)) {
    addError(context, "PLACEHOLDER_IMAGE_DIGEST_FORBIDDEN", fieldPath);
  }
  if (expectedAppCommit && tag !== `git-${expectedAppCommit}`) {
    addError(context, "APP_IMAGE_COMMIT_MISMATCH", fieldPath);
  }
};

const validateSafety = (context, safety) => {
  const required = [
    ...PROTECTED_FALSE_FLAGS,
    "OPENCLAW_NO_AUTO_UPDATE",
    "draftOnly",
    "autoPublish",
    "productionDeploymentAuthorized",
  ];
  const value = requireObject(context, safety, "$.safety", { required });
  if (!value) return;
  for (const flag of PROTECTED_FALSE_FLAGS) {
    requireBoolean(context, value[flag], `$.safety.${flag}`, false);
  }
  const noAutoUpdate = requireString(
    context,
    value.OPENCLAW_NO_AUTO_UPDATE,
    "$.safety.OPENCLAW_NO_AUTO_UPDATE",
  );
  if (noAutoUpdate && noAutoUpdate !== "1") {
    addError(
      context,
      "NO_AUTO_UPDATE_VALUE_INVALID",
      "$.safety.OPENCLAW_NO_AUTO_UPDATE",
    );
  }
  requireBoolean(context, value.draftOnly, "$.safety.draftOnly", true);
  requireBoolean(context, value.autoPublish, "$.safety.autoPublish", false);
  requireBoolean(
    context,
    value.productionDeploymentAuthorized,
    "$.safety.productionDeploymentAuthorized",
    false,
  );
};

const validateTestGate = (context, gate, fieldPath) => {
  const value = requireObject(context, gate, fieldPath, {
    required: ["passed", "total", "failed", "skipped"],
  });
  if (!value) return;
  requireBoolean(context, value.passed, `${fieldPath}.passed`, true);
  requireInteger(context, value.total, `${fieldPath}.total`, { minimum: 1 });
  requireInteger(context, value.failed, `${fieldPath}.failed`, { exact: 0 });
  requireInteger(context, value.skipped, `${fieldPath}.skipped`, { exact: 0 });
};

const validateQualityGates = (context, qualityGates, generatedAt) => {
  const fieldPath = "$.qualityGates";
  const value = requireObject(context, qualityGates, fieldPath, {
    required: [
      "reference",
      "checkedAt",
      "commit",
      "backend",
      "frontend",
      "browser",
      "secretScan",
      "containerScan",
    ],
  });
  if (!value) return;
  requireReference(context, value.reference, `${fieldPath}.reference`);
  requireRecentTimestamp(context, value.checkedAt, `${fieldPath}.checkedAt`, {
    maxAgeMs: DAY_MS,
    referenceTime: generatedAt ?? context.now,
  });
  const commit = requireCommit(context, value.commit, `${fieldPath}.commit`);
  if (commit && commit !== context.expectedCommit) {
    addError(context, "COMMIT_MISMATCH", `${fieldPath}.commit`);
  }
  validateTestGate(context, value.backend, `${fieldPath}.backend`);
  validateTestGate(context, value.frontend, `${fieldPath}.frontend`);
  validateTestGate(context, value.browser, `${fieldPath}.browser`);

  const secretScanPath = `${fieldPath}.secretScan`;
  const secretScan = requireObject(context, value.secretScan, secretScanPath, {
    required: ["passed", "fullHistory", "findings"],
  });
  if (secretScan) {
    requireBoolean(
      context,
      secretScan.passed,
      `${secretScanPath}.passed`,
      true,
    );
    requireBoolean(
      context,
      secretScan.fullHistory,
      `${secretScanPath}.fullHistory`,
      true,
    );
    requireInteger(context, secretScan.findings, `${secretScanPath}.findings`, {
      exact: 0,
    });
  }

  const containerScanPath = `${fieldPath}.containerScan`;
  const containerScan = requireObject(
    context,
    value.containerScan,
    containerScanPath,
    {
      required: ["passed", "high", "critical", "scannedImages"],
    },
  );
  if (containerScan) {
    requireBoolean(
      context,
      containerScan.passed,
      `${containerScanPath}.passed`,
      true,
    );
    requireInteger(context, containerScan.high, `${containerScanPath}.high`, {
      exact: 0,
    });
    requireInteger(
      context,
      containerScan.critical,
      `${containerScanPath}.critical`,
      { exact: 0 },
    );
  }
};

const validateArtifacts = (context, artifacts) => {
  const fieldPath = "$.artifacts";
  const required = [
    "backend",
    "frontend",
    "redis",
    "nginx",
    "certbot",
    "openclaw",
    "n8n",
  ];
  const value = requireObject(context, artifacts, fieldPath, { required });
  if (!value) return;
  requireImageReference(context, value.backend, `${fieldPath}.backend`, {
    expectedAppCommit: context.expectedCommit,
  });
  requireImageReference(context, value.frontend, `${fieldPath}.frontend`, {
    expectedAppCommit: context.expectedCommit,
  });
  for (const name of ["redis", "nginx", "certbot", "openclaw"]) {
    requireImageReference(context, value[name], `${fieldPath}.${name}`);
  }
  if (value.n8n !== null) {
    requireImageReference(context, value.n8n, `${fieldPath}.n8n`);
  }
  const imageReferences = required
    .map((name) => value[name])
    .filter((imageReference) => typeof imageReference === "string");
  if (new Set(imageReferences).size !== imageReferences.length) {
    addError(context, "DUPLICATE_IMAGE_REFERENCE", fieldPath);
  }
};

const validateBackup = (context, backup, generatedAt) => {
  const fieldPath = "$.backup";
  const value = requireObject(context, backup, fieldPath, {
    required: [
      "reference",
      "sourceEnvironment",
      "contentHash",
      "completedAt",
      "immutable",
      "encrypted",
      "restoreDrill",
    ],
  });
  if (!value) return;
  requireReference(context, value.reference, `${fieldPath}.reference`);
  const sourceEnvironment = requireString(
    context,
    value.sourceEnvironment,
    `${fieldPath}.sourceEnvironment`,
    { allowedValues: ["staging", "production"] },
  );
  if (sourceEnvironment && sourceEnvironment !== context.expectedEnvironment) {
    addError(context, "ENVIRONMENT_MISMATCH", `${fieldPath}.sourceEnvironment`);
  }
  requireHash(context, value.contentHash, `${fieldPath}.contentHash`);
  requireRecentTimestamp(
    context,
    value.completedAt,
    `${fieldPath}.completedAt`,
    {
      maxAgeMs: DAY_MS,
      referenceTime: generatedAt ?? context.now,
    },
  );
  requireBoolean(context, value.immutable, `${fieldPath}.immutable`, true);
  requireBoolean(context, value.encrypted, `${fieldPath}.encrypted`, true);

  const restorePath = `${fieldPath}.restoreDrill`;
  const restore = requireObject(context, value.restoreDrill, restorePath, {
    required: [
      "reference",
      "sourceBackupReference",
      "completedAt",
      "passed",
      "isolatedEnvironment",
      "dataIntegrityVerified",
    ],
  });
  if (!restore) return;
  requireReference(context, restore.reference, `${restorePath}.reference`);
  const sourceBackupReference = requireReference(
    context,
    restore.sourceBackupReference,
    `${restorePath}.sourceBackupReference`,
  );
  if (sourceBackupReference && sourceBackupReference !== value.reference) {
    addError(
      context,
      "BACKUP_REFERENCE_MISMATCH",
      `${restorePath}.sourceBackupReference`,
    );
  }
  requireRecentTimestamp(
    context,
    restore.completedAt,
    `${restorePath}.completedAt`,
    {
      maxAgeMs: 30 * DAY_MS,
      referenceTime: generatedAt ?? context.now,
    },
  );
  requireBoolean(context, restore.passed, `${restorePath}.passed`, true);
  requireBoolean(
    context,
    restore.isolatedEnvironment,
    `${restorePath}.isolatedEnvironment`,
    true,
  );
  requireBoolean(
    context,
    restore.dataIntegrityVerified,
    `${restorePath}.dataIntegrityVerified`,
    true,
  );
};

const validateMigrationPlan = (
  context,
  plan,
  fieldPath,
  generatedAt,
  expectedEnvironment,
) => {
  const value = requireObject(context, plan, fieldPath, {
    required: [
      "reference",
      "completedAt",
      "commit",
      "environment",
      "databaseIdentityHash",
      "planHash",
      "readOnly",
      "passed",
      "blockers",
      "destructiveOperations",
    ],
  });
  if (!value) return null;
  requireReference(context, value.reference, `${fieldPath}.reference`);
  requireRecentTimestamp(
    context,
    value.completedAt,
    `${fieldPath}.completedAt`,
    {
      maxAgeMs: DAY_MS,
      referenceTime: generatedAt ?? context.now,
    },
  );
  const commit = requireCommit(context, value.commit, `${fieldPath}.commit`);
  if (commit && commit !== context.expectedCommit) {
    addError(context, "COMMIT_MISMATCH", `${fieldPath}.commit`);
  }
  const environment = requireString(
    context,
    value.environment,
    `${fieldPath}.environment`,
    { allowedValues: ["staging", "production"] },
  );
  if (environment && environment !== expectedEnvironment) {
    addError(context, "ENVIRONMENT_MISMATCH", `${fieldPath}.environment`);
  }
  requireHash(
    context,
    value.databaseIdentityHash,
    `${fieldPath}.databaseIdentityHash`,
  );
  requireHash(context, value.planHash, `${fieldPath}.planHash`);
  requireBoolean(context, value.readOnly, `${fieldPath}.readOnly`, true);
  requireBoolean(context, value.passed, `${fieldPath}.passed`, true);
  requireEmptyArray(context, value.blockers, `${fieldPath}.blockers`);
  requireInteger(
    context,
    value.destructiveOperations,
    `${fieldPath}.destructiveOperations`,
    { exact: 0 },
  );
  return value;
};

const validateMigration = (context, migration, generatedAt) => {
  const fieldPath = "$.migration";
  const value = requireObject(context, migration, fieldPath, {
    required: ["targetDryRun", "stagingApply", "productionApplyAuthorized"],
  });
  if (!value) return;
  const targetDryRun = validateMigrationPlan(
    context,
    value.targetDryRun,
    `${fieldPath}.targetDryRun`,
    generatedAt,
    context.expectedEnvironment,
  );

  const applyPath = `${fieldPath}.stagingApply`;
  const apply = requireObject(context, value.stagingApply, applyPath, {
    required: [
      "reference",
      "completedAt",
      "commit",
      "environment",
      "databaseIdentityHash",
      "planHash",
      "confirmedPlanHash",
      "explicitConfirmation",
      "isolatedDatabase",
      "applied",
      "verificationPassed",
    ],
  });
  if (apply) {
    requireReference(context, apply.reference, `${applyPath}.reference`);
    requireRecentTimestamp(
      context,
      apply.completedAt,
      `${applyPath}.completedAt`,
      {
        maxAgeMs: DAY_MS,
        referenceTime: generatedAt ?? context.now,
      },
    );
    const commit = requireCommit(context, apply.commit, `${applyPath}.commit`);
    if (commit && commit !== context.expectedCommit) {
      addError(context, "COMMIT_MISMATCH", `${applyPath}.commit`);
    }
    const environment = requireString(
      context,
      apply.environment,
      `${applyPath}.environment`,
      { allowedValues: ["staging"] },
    );
    if (environment && environment !== "staging") {
      addError(
        context,
        "STAGING_ENVIRONMENT_REQUIRED",
        `${applyPath}.environment`,
      );
    }
    requireHash(
      context,
      apply.databaseIdentityHash,
      `${applyPath}.databaseIdentityHash`,
    );
    const planHash = requireHash(
      context,
      apply.planHash,
      `${applyPath}.planHash`,
    );
    const confirmedPlanHash = requireHash(
      context,
      apply.confirmedPlanHash,
      `${applyPath}.confirmedPlanHash`,
    );
    if (planHash && confirmedPlanHash && planHash !== confirmedPlanHash) {
      addError(
        context,
        "MIGRATION_PLAN_CONFIRMATION_MISMATCH",
        `${applyPath}.confirmedPlanHash`,
      );
    }
    if (
      context.expectedEnvironment === "staging" &&
      targetDryRun?.planHash &&
      planHash &&
      targetDryRun.planHash !== planHash
    ) {
      addError(context, "MIGRATION_PLAN_MISMATCH", `${applyPath}.planHash`);
    }
    requireBoolean(
      context,
      apply.explicitConfirmation,
      `${applyPath}.explicitConfirmation`,
      true,
    );
    requireBoolean(
      context,
      apply.isolatedDatabase,
      `${applyPath}.isolatedDatabase`,
      true,
    );
    requireBoolean(context, apply.applied, `${applyPath}.applied`, true);
    requireBoolean(
      context,
      apply.verificationPassed,
      `${applyPath}.verificationPassed`,
      true,
    );
  }
  requireBoolean(
    context,
    value.productionApplyAuthorized,
    `${fieldPath}.productionApplyAuthorized`,
    false,
  );
};

const validateMongoIndexes = (context, indexes, migration, generatedAt) => {
  const fieldPath = "$.mongoIndexes";
  const value = requireObject(context, indexes, fieldPath, {
    required: [
      "reference",
      "checkedAt",
      "environment",
      "databaseIdentityHash",
      "manifestHash",
      "passed",
      "autoIndexDisabled",
      "requiredIndexes",
      "verifiedIndexes",
      "missing",
      "conflicts",
      "legacyTtlIndexes",
    ],
  });
  if (!value) return;
  requireReference(context, value.reference, `${fieldPath}.reference`);
  requireRecentTimestamp(context, value.checkedAt, `${fieldPath}.checkedAt`, {
    maxAgeMs: DAY_MS,
    referenceTime: generatedAt ?? context.now,
  });
  const environment = requireString(
    context,
    value.environment,
    `${fieldPath}.environment`,
    { allowedValues: ["staging"] },
  );
  if (environment && environment !== "staging") {
    addError(
      context,
      "STAGING_ENVIRONMENT_REQUIRED",
      `${fieldPath}.environment`,
    );
  }
  const databaseIdentityHash = requireHash(
    context,
    value.databaseIdentityHash,
    `${fieldPath}.databaseIdentityHash`,
  );
  if (
    databaseIdentityHash &&
    migration?.stagingApply?.databaseIdentityHash &&
    databaseIdentityHash !== migration.stagingApply.databaseIdentityHash
  ) {
    addError(
      context,
      "DATABASE_IDENTITY_MISMATCH",
      `${fieldPath}.databaseIdentityHash`,
    );
  }
  requireHash(context, value.manifestHash, `${fieldPath}.manifestHash`);
  requireBoolean(context, value.passed, `${fieldPath}.passed`, true);
  requireBoolean(
    context,
    value.autoIndexDisabled,
    `${fieldPath}.autoIndexDisabled`,
    true,
  );
  const requiredIndexes = requireInteger(
    context,
    value.requiredIndexes,
    `${fieldPath}.requiredIndexes`,
    { minimum: 1 },
  );
  const verifiedIndexes = requireInteger(
    context,
    value.verifiedIndexes,
    `${fieldPath}.verifiedIndexes`,
    { minimum: 1 },
  );
  if (
    requiredIndexes !== null &&
    verifiedIndexes !== null &&
    requiredIndexes !== verifiedIndexes
  ) {
    addError(context, "INDEX_COUNT_MISMATCH", `${fieldPath}.verifiedIndexes`);
  }
  requireEmptyArray(context, value.missing, `${fieldPath}.missing`);
  requireEmptyArray(context, value.conflicts, `${fieldPath}.conflicts`);
  requireEmptyArray(
    context,
    value.legacyTtlIndexes,
    `${fieldPath}.legacyTtlIndexes`,
  );
};

const validateCanary = (context, canary, indexes, generatedAt) => {
  const fieldPath = "$.canary";
  const value = requireObject(context, canary, fieldPath, {
    required: [
      "reference",
      "completedAt",
      "environment",
      "databaseIdentityHash",
      "isolatedDatabase",
      "draftOnly",
      "autoPublish",
      "sequence",
      "result",
      "topic",
      "publishedPostsDelta",
      "publicPostCreated",
      "safetyGatePassed",
    ],
  });
  if (!value) return;
  requireReference(context, value.reference, `${fieldPath}.reference`);
  requireRecentTimestamp(
    context,
    value.completedAt,
    `${fieldPath}.completedAt`,
    {
      maxAgeMs: DAY_MS,
      referenceTime: generatedAt ?? context.now,
    },
  );
  const environment = requireString(
    context,
    value.environment,
    `${fieldPath}.environment`,
    { allowedValues: ["staging"] },
  );
  if (environment && environment !== "staging") {
    addError(
      context,
      "STAGING_ENVIRONMENT_REQUIRED",
      `${fieldPath}.environment`,
    );
  }
  const databaseIdentityHash = requireHash(
    context,
    value.databaseIdentityHash,
    `${fieldPath}.databaseIdentityHash`,
  );
  if (
    databaseIdentityHash &&
    indexes?.databaseIdentityHash &&
    databaseIdentityHash !== indexes.databaseIdentityHash
  ) {
    addError(
      context,
      "DATABASE_IDENTITY_MISMATCH",
      `${fieldPath}.databaseIdentityHash`,
    );
  }
  requireBoolean(
    context,
    value.isolatedDatabase,
    `${fieldPath}.isolatedDatabase`,
    true,
  );
  requireBoolean(context, value.draftOnly, `${fieldPath}.draftOnly`, true);
  requireBoolean(context, value.autoPublish, `${fieldPath}.autoPublish`, false);
  const result = requireString(context, value.result, `${fieldPath}.result`, {
    allowedValues: ["completed", "no_change"],
  });
  const sequence = requireArray(
    context,
    value.sequence,
    `${fieldPath}.sequence`,
  );
  if (sequence) {
    const expectedSequence = ["queued", "running", result];
    if (
      sequence.length !== expectedSequence.length ||
      sequence.some((item, index) => item !== expectedSequence[index])
    ) {
      addError(context, "CANARY_SEQUENCE_INVALID", `${fieldPath}.sequence`);
    }
  }

  const topicPath = `${fieldPath}.topic`;
  const topic = requireObject(context, value.topic, topicPath, {
    required: [
      "opportunityScore",
      "noveltyScore",
      "persistedEvidenceCount",
      "scoreHash",
      "rubricVersion",
      "corpusVersion",
    ],
  });
  if (topic) {
    requireNumber(
      context,
      topic.opportunityScore,
      `${topicPath}.opportunityScore`,
      {
        minimum: 82,
      },
    );
    requireNumber(context, topic.noveltyScore, `${topicPath}.noveltyScore`, {
      minimum: 48,
    });
    requireInteger(
      context,
      topic.persistedEvidenceCount,
      `${topicPath}.persistedEvidenceCount`,
      { minimum: 1 },
    );
    requireHash(context, topic.scoreHash, `${topicPath}.scoreHash`);
    requireString(context, topic.rubricVersion, `${topicPath}.rubricVersion`, {
      pattern: IDENTIFIER_PATTERN,
    });
    requireString(context, topic.corpusVersion, `${topicPath}.corpusVersion`, {
      pattern: IDENTIFIER_PATTERN,
    });
  }
  requireInteger(
    context,
    value.publishedPostsDelta,
    `${fieldPath}.publishedPostsDelta`,
    { exact: 0 },
  );
  requireBoolean(
    context,
    value.publicPostCreated,
    `${fieldPath}.publicPostCreated`,
    false,
  );
  requireBoolean(
    context,
    value.safetyGatePassed,
    `${fieldPath}.safetyGatePassed`,
    true,
  );
};

const validateTls = (context, tls, generatedAt) => {
  const fieldPath = "$.tls";
  const value = requireObject(context, tls, fieldPath, {
    required: [
      "reference",
      "checkedAt",
      "httpsOnly",
      "chainValid",
      "sanVerified",
      "notBefore",
      "notAfter",
      "expectedHosts",
      "sans",
    ],
  });
  if (!value) return;
  requireReference(context, value.reference, `${fieldPath}.reference`);
  const checkedAt = requireRecentTimestamp(
    context,
    value.checkedAt,
    `${fieldPath}.checkedAt`,
    {
      maxAgeMs: DAY_MS,
      referenceTime: generatedAt ?? context.now,
    },
  );
  requireBoolean(context, value.httpsOnly, `${fieldPath}.httpsOnly`, true);
  requireBoolean(context, value.chainValid, `${fieldPath}.chainValid`, true);
  requireBoolean(context, value.sanVerified, `${fieldPath}.sanVerified`, true);
  const notBefore = parseTimestamp(
    context,
    value.notBefore,
    `${fieldPath}.notBefore`,
  );
  const notAfter = parseTimestamp(
    context,
    value.notAfter,
    `${fieldPath}.notAfter`,
  );
  if (checkedAt !== null && notBefore !== null && notBefore > checkedAt) {
    addError(context, "CERTIFICATE_NOT_YET_VALID", `${fieldPath}.notBefore`);
  }
  if (
    checkedAt !== null &&
    notAfter !== null &&
    notAfter - checkedAt < MIN_TLS_REMAINING_MS
  ) {
    addError(context, "CERTIFICATE_EXPIRY_TOO_CLOSE", `${fieldPath}.notAfter`);
  }

  const expectedHosts = requireArray(
    context,
    value.expectedHosts,
    `${fieldPath}.expectedHosts`,
  );
  if (expectedHosts) {
    expectedHosts.forEach((host, index) => {
      requireString(
        context,
        typeof host === "string" ? host.toLowerCase() : host,
        `${fieldPath}.expectedHosts[${index}]`,
        { pattern: HOST_PATTERN },
      );
    });
    requireStringSet(
      context,
      expectedHosts,
      `${fieldPath}.expectedHosts`,
      context.expectedHosts,
    );
  }
  const sans = requireArray(context, value.sans, `${fieldPath}.sans`);
  if (sans) {
    const normalizedSans = sans.map((host, index) => {
      const normalized = typeof host === "string" ? host.toLowerCase() : host;
      requireString(context, normalized, `${fieldPath}.sans[${index}]`, {
        pattern: HOST_PATTERN,
      });
      return normalized;
    });
    if (new Set(normalizedSans).size !== normalizedSans.length) {
      addError(context, "DUPLICATE_ARRAY_VALUE", `${fieldPath}.sans`);
    }
    const sanSet = new Set(normalizedSans);
    context.expectedHosts.forEach((host) => {
      if (!sanSet.has(host)) {
        addError(context, "CERTIFICATE_SAN_MISSING", `${fieldPath}.sans`);
      }
    });
  }
};

const validateSmoke = (context, smoke, indexes, generatedAt) => {
  const fieldPath = "$.smoke";
  const value = requireObject(context, smoke, fieldPath, {
    required: [
      "reference",
      "checkedAt",
      "environment",
      "databaseIdentityHash",
      "candidateSlotIsolated",
      "liveTrafficUnaffected",
      "backendLive",
      "backendReady",
      "frontendHealth",
      "publicHttps",
      "requestCorrelationVerified",
      "sanitized502Verified",
      "sanitized504Verified",
      "oneClickOnePostVerified",
      "pollingReadOnlyVerified",
      "noPublishedPostCreated",
    ],
  });
  if (!value) return;
  requireReference(context, value.reference, `${fieldPath}.reference`);
  requireRecentTimestamp(context, value.checkedAt, `${fieldPath}.checkedAt`, {
    maxAgeMs: DAY_MS,
    referenceTime: generatedAt ?? context.now,
  });
  const environment = requireString(
    context,
    value.environment,
    `${fieldPath}.environment`,
    { allowedValues: ["staging"] },
  );
  if (environment && environment !== "staging") {
    addError(
      context,
      "STAGING_ENVIRONMENT_REQUIRED",
      `${fieldPath}.environment`,
    );
  }
  const databaseIdentityHash = requireHash(
    context,
    value.databaseIdentityHash,
    `${fieldPath}.databaseIdentityHash`,
  );
  if (
    databaseIdentityHash &&
    indexes?.databaseIdentityHash &&
    databaseIdentityHash !== indexes.databaseIdentityHash
  ) {
    addError(
      context,
      "DATABASE_IDENTITY_MISMATCH",
      `${fieldPath}.databaseIdentityHash`,
    );
  }
  requireBoolean(
    context,
    value.candidateSlotIsolated,
    `${fieldPath}.candidateSlotIsolated`,
    true,
  );
  requireBoolean(
    context,
    value.liveTrafficUnaffected,
    `${fieldPath}.liveTrafficUnaffected`,
    true,
  );
  for (const endpoint of [
    "backendLive",
    "backendReady",
    "frontendHealth",
    "publicHttps",
  ]) {
    const endpointPath = `${fieldPath}.${endpoint}`;
    const result = requireObject(context, value[endpoint], endpointPath, {
      required: ["passed", "status"],
    });
    if (!result) continue;
    requireBoolean(context, result.passed, `${endpointPath}.passed`, true);
    requireInteger(context, result.status, `${endpointPath}.status`, {
      exact: 200,
    });
  }
  for (const check of [
    "requestCorrelationVerified",
    "sanitized502Verified",
    "sanitized504Verified",
    "oneClickOnePostVerified",
    "pollingReadOnlyVerified",
    "noPublishedPostCreated",
  ]) {
    requireBoolean(context, value[check], `${fieldPath}.${check}`, true);
  }
};

const validateRollback = (context, rollback, generatedAt) => {
  const fieldPath = "$.rollback";
  const value = requireObject(context, rollback, fieldPath, {
    required: [
      "reference",
      "testedAt",
      "isolatedEnvironment",
      "simulationOnly",
      "passed",
      "trafficSwitchReversible",
      "previousSlotReady",
      "readinessRestored",
      "smokeRestored",
      "liveTrafficUnaffected",
      "dataLossObserved",
      "destructiveDatabaseRollbackAttempted",
      "databaseRecoveryMode",
    ],
  });
  if (!value) return;
  requireReference(context, value.reference, `${fieldPath}.reference`);
  requireRecentTimestamp(context, value.testedAt, `${fieldPath}.testedAt`, {
    maxAgeMs: 30 * DAY_MS,
    referenceTime: generatedAt ?? context.now,
  });
  for (const check of [
    "isolatedEnvironment",
    "simulationOnly",
    "passed",
    "trafficSwitchReversible",
    "previousSlotReady",
    "readinessRestored",
    "smokeRestored",
    "liveTrafficUnaffected",
  ]) {
    requireBoolean(context, value[check], `${fieldPath}.${check}`, true);
  }
  requireBoolean(
    context,
    value.dataLossObserved,
    `${fieldPath}.dataLossObserved`,
    false,
  );
  requireBoolean(
    context,
    value.destructiveDatabaseRollbackAttempted,
    `${fieldPath}.destructiveDatabaseRollbackAttempted`,
    false,
  );
  requireString(
    context,
    value.databaseRecoveryMode,
    `${fieldPath}.databaseRecoveryMode`,
    { allowedValues: ["forward_fix_or_validated_restore"] },
  );
};

const validateN8n = (context, n8n, artifacts, qualityGates) => {
  const fieldPath = "$.capabilities.n8n";
  const base = requireObject(context, n8n, fieldPath, {
    required: ["status"],
    allowed: [
      "status",
      "externalDataDirectoryConfigured",
      "dataOutsideCheckout",
      "encryptionKeyConfigured",
      "backupReference",
      "restoreDrillReference",
      "imageScanPassed",
      "httpsSmokePassed",
    ],
  });
  if (!base) return;
  const status = requireString(context, base.status, `${fieldPath}.status`, {
    allowedValues: ["expected_disabled", "enabled"],
  });
  if (status === "expected_disabled") {
    if (Object.keys(base).length !== 1) {
      addError(context, "DISABLED_CAPABILITY_EVIDENCE_FORBIDDEN", fieldPath);
    }
    if (artifacts?.n8n !== null) {
      addError(
        context,
        "DISABLED_CAPABILITY_IMAGE_FORBIDDEN",
        "$.artifacts.n8n",
      );
    }
    return;
  }
  if (status !== "enabled") return;
  for (const field of [
    "externalDataDirectoryConfigured",
    "dataOutsideCheckout",
    "encryptionKeyConfigured",
    "backupReference",
    "restoreDrillReference",
    "imageScanPassed",
    "httpsSmokePassed",
  ]) {
    if (!Object.prototype.hasOwnProperty.call(base, field)) {
      addError(context, "FIELD_REQUIRED", `${fieldPath}.${field}`);
    }
  }
  for (const check of [
    "externalDataDirectoryConfigured",
    "dataOutsideCheckout",
    "encryptionKeyConfigured",
    "imageScanPassed",
    "httpsSmokePassed",
  ]) {
    requireBoolean(context, base[check], `${fieldPath}.${check}`, true);
  }
  requireReference(
    context,
    base.backupReference,
    `${fieldPath}.backupReference`,
  );
  requireReference(
    context,
    base.restoreDrillReference,
    `${fieldPath}.restoreDrillReference`,
  );
  if (artifacts?.n8n === null || artifacts?.n8n === undefined) {
    addError(context, "ENABLED_CAPABILITY_IMAGE_REQUIRED", "$.artifacts.n8n");
  }
  const scannedImages = qualityGates?.containerScan?.scannedImages;
  if (!Array.isArray(scannedImages) || !scannedImages.includes("n8n")) {
    addError(
      context,
      "ENABLED_CAPABILITY_SCAN_REQUIRED",
      "$.qualityGates.containerScan.scannedImages",
    );
  }
};

export const validateReleaseEvidence = (
  manifest,
  { expectedCommit, expectedEnvironment, expectedHosts, now = new Date() } = {},
) => {
  const normalizedCommit = String(expectedCommit || "")
    .trim()
    .toLowerCase();
  const normalizedEnvironment = String(expectedEnvironment || "")
    .trim()
    .toLowerCase();
  const normalizedHosts = Array.isArray(expectedHosts)
    ? expectedHosts.map((host) =>
        String(host || "")
          .trim()
          .toLowerCase(),
      )
    : [];
  const nowTimestamp = now instanceof Date ? now.getTime() : Number.NaN;
  const context = makeContext({
    expectedCommit: normalizedCommit,
    expectedEnvironment: normalizedEnvironment,
    expectedHosts: normalizedHosts,
    now: nowTimestamp,
  });

  if (!COMMIT_PATTERN.test(normalizedCommit)) {
    addError(context, "EXPECTED_COMMIT_INVALID", "$cli.expectedCommit");
  }
  if (!["staging", "production"].includes(normalizedEnvironment)) {
    addError(
      context,
      "EXPECTED_ENVIRONMENT_INVALID",
      "$cli.expectedEnvironment",
    );
  }
  if (
    normalizedHosts.length !== 4 ||
    normalizedHosts.some((host) => !HOST_PATTERN.test(host)) ||
    new Set(normalizedHosts).size !== normalizedHosts.length
  ) {
    addError(context, "EXPECTED_HOSTS_INVALID", "$cli.expectedHosts");
  }
  if (!Number.isFinite(nowTimestamp)) {
    addError(context, "CURRENT_TIME_INVALID", "$cli.now");
  }

  inspectForSensitiveMaterial(context, manifest);
  const root = requireObject(context, manifest, "$", {
    required: [
      "schemaVersion",
      "release",
      "safety",
      "qualityGates",
      "artifacts",
      "backup",
      "migration",
      "mongoIndexes",
      "canary",
      "tls",
      "smoke",
      "rollback",
      "capabilities",
    ],
  });
  if (!root) {
    return { valid: false, errors: context.errors };
  }

  const schemaVersion = requireString(
    context,
    root.schemaVersion,
    "$.schemaVersion",
  );
  if (schemaVersion && schemaVersion !== SCHEMA_VERSION) {
    addError(context, "SCHEMA_VERSION_UNSUPPORTED", "$.schemaVersion");
  }

  const release = requireObject(context, root.release, "$.release", {
    required: ["releaseId", "commit", "targetEnvironment", "generatedAt"],
  });
  let generatedAt = null;
  if (release) {
    requireString(context, release.releaseId, "$.release.releaseId", {
      pattern: REFERENCE_PATTERN,
    });
    const commit = requireCommit(context, release.commit, "$.release.commit");
    if (commit && commit !== normalizedCommit) {
      addError(context, "COMMIT_MISMATCH", "$.release.commit");
    }
    const targetEnvironment = requireString(
      context,
      release.targetEnvironment,
      "$.release.targetEnvironment",
      { allowedValues: ["staging", "production"] },
    );
    if (targetEnvironment && targetEnvironment !== normalizedEnvironment) {
      addError(context, "ENVIRONMENT_MISMATCH", "$.release.targetEnvironment");
    }
    generatedAt = requireRecentTimestamp(
      context,
      release.generatedAt,
      "$.release.generatedAt",
      { maxAgeMs: DAY_MS },
    );
  }

  validateSafety(context, root.safety);
  validateQualityGates(context, root.qualityGates, generatedAt);
  validateArtifacts(context, root.artifacts);
  validateBackup(context, root.backup, generatedAt);
  validateMigration(context, root.migration, generatedAt);
  validateMongoIndexes(context, root.mongoIndexes, root.migration, generatedAt);
  validateCanary(context, root.canary, root.mongoIndexes, generatedAt);
  validateTls(context, root.tls, generatedAt);
  validateSmoke(context, root.smoke, root.mongoIndexes, generatedAt);
  validateRollback(context, root.rollback, generatedAt);

  const capabilities = requireObject(
    context,
    root.capabilities,
    "$.capabilities",
    { required: ["n8n"] },
  );
  if (capabilities) {
    validateN8n(context, capabilities.n8n, root.artifacts, root.qualityGates);
  }

  const n8nEnabled = capabilities?.n8n?.status === "enabled";
  const expectedImages = n8nEnabled
    ? [...REQUIRED_SCANNED_IMAGES, "n8n"]
    : REQUIRED_SCANNED_IMAGES;
  requireStringSet(
    context,
    root.qualityGates?.containerScan?.scannedImages,
    "$.qualityGates.containerScan.scannedImages",
    expectedImages,
  );

  return {
    valid: context.errors.length === 0,
    errors: context.errors,
    summary: {
      schemaVersion: SCHEMA_VERSION,
      commit: normalizedCommit,
      targetEnvironment: normalizedEnvironment,
      expectedHostCount: normalizedHosts.length,
      n8n: n8nEnabled ? "enabled" : "expected_disabled",
    },
  };
};

const parseCliArguments = (argv) => {
  const parsed = {
    manifest: "",
    expectedManifestSha256: "",
    expectedCommit: "",
    expectedEnvironment: "",
    expectedHosts: [],
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      ![
        "--manifest",
        "--expected-manifest-sha256",
        "--expected-commit",
        "--expected-environment",
        "--expected-host",
      ].includes(argument)
    ) {
      throw Object.assign(new Error("unsupported argument"), {
        code: "CLI_ARGUMENT_UNSUPPORTED",
      });
    }
    if (argument !== "--expected-host" && seen.has(argument)) {
      throw Object.assign(new Error("duplicate argument"), {
        code: "CLI_ARGUMENT_DUPLICATE",
      });
    }
    seen.add(argument);
    const value = String(argv[index + 1] || "").trim();
    if (!value || value.startsWith("--")) {
      throw Object.assign(new Error("argument value required"), {
        code: "CLI_ARGUMENT_VALUE_REQUIRED",
      });
    }
    index += 1;
    if (argument === "--manifest") parsed.manifest = value;
    if (argument === "--expected-manifest-sha256")
      parsed.expectedManifestSha256 = value.toLowerCase();
    if (argument === "--expected-commit") parsed.expectedCommit = value;
    if (argument === "--expected-environment")
      parsed.expectedEnvironment = value;
    if (argument === "--expected-host") parsed.expectedHosts.push(value);
  }
  for (const key of [
    "manifest",
    "expectedManifestSha256",
    "expectedCommit",
    "expectedEnvironment",
  ]) {
    if (!parsed[key]) {
      throw Object.assign(new Error("required argument missing"), {
        code: "CLI_ARGUMENT_REQUIRED",
      });
    }
  }
  if (!COMMIT_PATTERN.test(parsed.expectedCommit.toLowerCase())) {
    throw Object.assign(new Error("expected commit invalid"), {
      code: "CLI_EXPECTED_COMMIT_INVALID",
    });
  }
  if (
    !["staging", "production"].includes(
      parsed.expectedEnvironment.toLowerCase(),
    )
  ) {
    throw Object.assign(new Error("expected environment invalid"), {
      code: "CLI_EXPECTED_ENVIRONMENT_INVALID",
    });
  }
  if (
    parsed.expectedHosts.length !== 4 ||
    parsed.expectedHosts.some(
      (host) => !HOST_PATTERN.test(String(host).toLowerCase()),
    ) ||
    new Set(parsed.expectedHosts.map((host) => String(host).toLowerCase()))
      .size !== 4
  ) {
    throw Object.assign(new Error("four unique expected hosts required"), {
      code: "CLI_EXPECTED_HOSTS_INVALID",
    });
  }
  if (
    !HASH_PATTERN.test(parsed.expectedManifestSha256) ||
    /^([a-f0-9])\1{63}$/.test(parsed.expectedManifestSha256)
  ) {
    throw Object.assign(new Error("expected manifest digest invalid"), {
      code: "CLI_EXPECTED_MANIFEST_SHA256_INVALID",
    });
  }
  return parsed;
};

const isPathInside = (candidate, parent) => {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};

const readManifest = (manifestPath) => {
  const absolutePath = path.resolve(manifestPath);
  const checkoutRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  if (isPathInside(absolutePath, checkoutRoot)) {
    throw Object.assign(new Error("manifest must stay outside checkout"), {
      code: "MANIFEST_INSIDE_CHECKOUT_FORBIDDEN",
    });
  }
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw Object.assign(new Error("manifest must be a regular file"), {
      code: "MANIFEST_REGULAR_FILE_REQUIRED",
    });
  }
  if (stat.size < 2 || stat.size > MAX_MANIFEST_BYTES) {
    throw Object.assign(new Error("manifest size invalid"), {
      code: "MANIFEST_SIZE_INVALID",
    });
  }
  const sourceBuffer = fs.readFileSync(absolutePath);
  const contentHash = createHash("sha256").update(sourceBuffer).digest("hex");
  const source = sourceBuffer.toString("utf8");
  try {
    return { manifest: JSON.parse(source), contentHash };
  } catch {
    throw Object.assign(new Error("manifest JSON invalid"), {
      code: "MANIFEST_JSON_INVALID",
    });
  }
};

const runCli = () => {
  try {
    const cli = parseCliArguments(process.argv.slice(2));
    const { manifest, contentHash } = readManifest(cli.manifest);
    if (contentHash !== cli.expectedManifestSha256) {
      throw Object.assign(new Error("manifest digest mismatch"), {
        code: "MANIFEST_SHA256_MISMATCH",
      });
    }
    const result = validateReleaseEvidence(manifest, cli);
    if (!result.valid) {
      process.stderr.write("RELEASE_EVIDENCE_INVALID\n");
      result.errors.forEach((error) => {
        process.stderr.write(`[${error.code}] ${error.path}\n`);
      });
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `RELEASE_EVIDENCE_VALID schema=${result.summary.schemaVersion} environment=${result.summary.targetEnvironment} commit=${result.summary.commit.slice(0, 12)} hosts=${result.summary.expectedHostCount} n8n=${result.summary.n8n}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `RELEASE_EVIDENCE_VALIDATOR_FAILED code=${String(error?.code || "VALIDATOR_FAILED").replace(/[^A-Z0-9_]/g, "")}\n`,
    );
    process.exitCode = 1;
  }
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) runCli();
