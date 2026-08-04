"use strict";

const { createHash } = require("node:crypto");
const mongoose = require("mongoose");
const { isProductionEnv, loadRuntimeEnv } = require("../src/config/runtimeEnv");
const {
  PRODUCTION_INDEX_MANIFEST,
  requirementMatches,
} = require("../src/dbs/productionIndexManifest");

const PLAN_VERSION = "production-index-plan-v1";
const SAFE_DATABASE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;
const SAFE_ENVIRONMENTS = new Set(["staging", "production"]);
const HASH_PATTERN = /^[a-f0-9]{64}$/;

const migrationError = (code) => Object.assign(new Error(code), { code });

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

const stableStringify = (value) => JSON.stringify(canonicalize(value));
const sha256 = (value) =>
  createHash("sha256").update(String(value)).digest("hex");
const compareCanonical = (left, right) => {
  const leftValue = stableStringify(left);
  const rightValue = stableStringify(right);
  if (leftValue === rightValue) return 0;
  return leftValue < rightValue ? -1 : 1;
};

const safeIdentifier = (value, fallbackPrefix = "identifier") => {
  const normalized = String(value || "").trim();
  if (/^[A-Za-z0-9._:$-]{1,180}$/.test(normalized)) return normalized;
  return `${fallbackPrefix}:sha256:${sha256(normalized).slice(0, 16)}`;
};

const keyEntries = (key = {}) =>
  Object.entries(key).map(([field, direction]) => [
    safeIdentifier(field, "field"),
    direction,
  ]);

const requirementIndexName = (requirement = {}) => {
  if (requirement.name) return String(requirement.name);
  return Object.entries(requirement.key || {})
    .map(([field, direction]) => `${field}_${direction}`)
    .join("_");
};

const requirementOptions = (requirement = {}) => {
  const options = { name: requirementIndexName(requirement) };
  if (Object.prototype.hasOwnProperty.call(requirement, "unique")) {
    options.unique = Boolean(requirement.unique);
  }
  if (Object.prototype.hasOwnProperty.call(requirement, "sparse")) {
    options.sparse = Boolean(requirement.sparse);
  }
  if (requirement.partialFilterExpression != null) {
    options.partialFilterExpression = canonicalize(
      requirement.partialFilterExpression,
    );
  }
  return options;
};

const readIndexes = async (collection) => {
  try {
    return await collection.indexes();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound")
      return [];
    throw error;
  }
};

const sanitizedIndexState = (index = {}) => {
  const state = {
    name: safeIdentifier(index.name, "index"),
    key: keyEntries(index.key),
    unique: Boolean(index.unique),
    sparse: Boolean(index.sparse),
    partialFilterExpressionHash:
      index.partialFilterExpression == null
        ? null
        : sha256(stableStringify(index.partialFilterExpression)),
  };
  if (Object.prototype.hasOwnProperty.call(index, "expireAfterSeconds")) {
    const ttl = Number(index.expireAfterSeconds);
    state.expireAfterSeconds = Number.isFinite(ttl) ? ttl : "non_numeric";
  }
  return state;
};

const sortSanitizedIndexes = (indexes = []) =>
  indexes.map(sanitizedIndexState).sort(compareCanonical);

const sameKey = (index = {}, requirement = {}) => {
  const actual = Object.entries(index.key || {});
  const expected = Object.entries(requirement.key || {});
  return (
    actual.length === expected.length &&
    actual.every(
      ([field, direction], offset) =>
        expected[offset]?.[0] === field && expected[offset]?.[1] === direction,
    )
  );
};

const getCollectionName = (entry = {}) => {
  const name = entry?.model?.collection?.collectionName;
  if (!name) throw migrationError("PRODUCTION_INDEX_COLLECTION_NAME_REQUIRED");
  return safeIdentifier(name, "collection");
};

const inspectProductionIndexPlan = async ({
  manifest = PRODUCTION_INDEX_MANIFEST,
  environment = process.env.NODE_ENV,
  databaseName = "",
} = {}) => {
  const safeEnvironment = safeIdentifier(
    environment || "unknown",
    "environment",
  );
  const safeDatabase = safeIdentifier(databaseName || "unknown", "database");
  const beforeState = [];
  const operations = [];
  const blockers = [];

  for (const entry of manifest) {
    const collectionName = getCollectionName(entry);
    const indexes = await readIndexes(entry.model.collection);
    beforeState.push({
      collection: collectionName,
      indexes: sortSanitizedIndexes(indexes),
    });

    const managesApiKeys = (entry.requirements || []).some(
      (requirement) => requirement.id === "api_key_unique",
    );
    const legacyTtlIndexes = managesApiKeys
      ? indexes.filter(
          (index) =>
            index?.key?.createdAt === 1 &&
            Object.prototype.hasOwnProperty.call(index, "expireAfterSeconds"),
        )
      : [];
    for (const legacyIndex of legacyTtlIndexes) {
      blockers.push({
        code: "PRODUCTION_INDEX_LEGACY_TTL_REQUIRES_SEPARATE_MIGRATION",
        collection: collectionName,
        index: safeIdentifier(legacyIndex.name, "index"),
      });
    }

    for (const requirement of entry.requirements || []) {
      if (indexes.some((index) => requirementMatches(index, requirement)))
        continue;

      const targetName = requirementIndexName(requirement);
      const nameConflict = indexes.find((index) => index?.name === targetName);
      const keyConflict = indexes.find((index) => sameKey(index, requirement));
      if (nameConflict || keyConflict) {
        blockers.push({
          code: nameConflict
            ? "PRODUCTION_INDEX_NAME_CONFLICT"
            : "PRODUCTION_INDEX_KEY_CONFLICT",
          collection: collectionName,
          requirementId: safeIdentifier(requirement.id, "requirement"),
          existingIndex: safeIdentifier(
            (nameConflict || keyConflict)?.name,
            "index",
          ),
          targetIndex: safeIdentifier(targetName, "index"),
        });
        continue;
      }

      operations.push({
        type: "create_index",
        collection: collectionName,
        requirementId: safeIdentifier(requirement.id, "requirement"),
        key: keyEntries(requirement.key),
        options: requirementOptions(requirement),
      });
    }
  }

  beforeState.sort(compareCanonical);
  operations.sort(compareCanonical);
  blockers.sort(compareCanonical);

  const plan = {
    version: PLAN_VERSION,
    environment: safeEnvironment,
    database: safeDatabase,
    beforeState,
    operations,
    blockers,
    summary: {
      collections: beforeState.length,
      existingIndexes: beforeState.reduce(
        (total, entry) => total + entry.indexes.length,
        0,
      ),
      creates: operations.length,
      blockers: blockers.length,
    },
  };
  return { ...plan, planHash: sha256(stableStringify(plan)) };
};

const parseArguments = (argv = process.argv.slice(2)) => {
  const mode = {
    apply: false,
    expectedEnvironment: "",
    expectedDatabase: "",
    confirmPlan: "",
  };
  const seen = new Set();
  for (let offset = 0; offset < argv.length; offset += 1) {
    const argument = argv[offset];
    if (argument === "--apply") {
      if (seen.has(argument))
        throw migrationError("PRODUCTION_INDEX_ARGUMENT_DUPLICATE");
      seen.add(argument);
      mode.apply = true;
      continue;
    }
    if (
      [
        "--expected-environment",
        "--expected-database",
        "--confirm-plan",
      ].includes(argument)
    ) {
      if (seen.has(argument))
        throw migrationError("PRODUCTION_INDEX_ARGUMENT_DUPLICATE");
      seen.add(argument);
      const value = String(argv[offset + 1] || "").trim();
      if (!value || value.startsWith("--")) {
        throw migrationError("PRODUCTION_INDEX_ARGUMENT_VALUE_REQUIRED");
      }
      offset += 1;
      if (argument === "--expected-environment")
        mode.expectedEnvironment = value;
      if (argument === "--expected-database") mode.expectedDatabase = value;
      if (argument === "--confirm-plan") mode.confirmPlan = value.toLowerCase();
      continue;
    }
    throw migrationError("PRODUCTION_INDEX_ARGUMENT_UNSUPPORTED");
  }
  if (
    !mode.apply &&
    (mode.expectedEnvironment || mode.expectedDatabase || mode.confirmPlan)
  ) {
    throw migrationError("PRODUCTION_INDEX_APPLY_FLAG_REQUIRED");
  }
  if (mode.apply) {
    if (!SAFE_ENVIRONMENTS.has(mode.expectedEnvironment)) {
      throw migrationError("PRODUCTION_INDEX_EXPECTED_ENVIRONMENT_REQUIRED");
    }
    if (!SAFE_DATABASE_NAME.test(mode.expectedDatabase)) {
      throw migrationError("PRODUCTION_INDEX_EXPECTED_DATABASE_REQUIRED");
    }
    if (!HASH_PATTERN.test(mode.confirmPlan)) {
      throw migrationError("PRODUCTION_INDEX_PLAN_CONFIRMATION_REQUIRED");
    }
  }
  return Object.freeze(mode);
};

const assertApplyIdentity = ({
  expectedEnvironment,
  expectedDatabase,
  actualEnvironment,
  actualDatabase,
} = {}) => {
  if (expectedEnvironment !== actualEnvironment) {
    throw migrationError("PRODUCTION_INDEX_ENVIRONMENT_MISMATCH");
  }
  if (expectedDatabase !== actualDatabase) {
    throw migrationError("PRODUCTION_INDEX_DATABASE_MISMATCH");
  }
  return true;
};

const findManifestEntry = (manifest, collectionName) =>
  manifest.find((entry) => getCollectionName(entry) === collectionName);

const applyProductionIndexPlan = async ({
  manifest = PRODUCTION_INDEX_MANIFEST,
  environment = process.env.NODE_ENV,
  databaseName = "",
  confirmPlan = "",
} = {}) => {
  const inspected = await inspectProductionIndexPlan({
    manifest,
    environment,
    databaseName,
  });
  if (
    !HASH_PATTERN.test(String(confirmPlan)) ||
    inspected.planHash !== confirmPlan
  ) {
    throw migrationError("PRODUCTION_INDEX_PLAN_MISMATCH");
  }
  if (inspected.blockers.length) {
    throw migrationError("PRODUCTION_INDEX_PLAN_BLOCKED");
  }

  let created = 0;
  for (const operation of inspected.operations) {
    const entry = findManifestEntry(manifest, operation.collection);
    if (!entry) throw migrationError("PRODUCTION_INDEX_MANIFEST_ENTRY_MISSING");
    try {
      await entry.model.collection.createIndex(
        Object.fromEntries(operation.key),
        { ...operation.options },
      );
      created += 1;
    } catch (error) {
      if (error?.code === 11000 || error?.code === 11001) {
        throw migrationError("PRODUCTION_INDEX_UNIQUE_CONFLICT");
      }
      throw migrationError("PRODUCTION_INDEX_CREATE_FAILED");
    }
  }

  const after = await inspectProductionIndexPlan({
    manifest,
    environment,
    databaseName,
  });
  if (after.blockers.length || after.operations.length) {
    throw migrationError("PRODUCTION_INDEX_AFTER_STATE_INVALID");
  }
  return {
    applied: true,
    confirmedPlanHash: inspected.planHash,
    created,
    beforeState: inspected.beforeState,
    afterState: after.beforeState,
    afterPlanHash: after.planHash,
  };
};

const run = async ({
  argv = process.argv.slice(2),
  env = process.env,
  connect = mongoose.connect.bind(mongoose),
  disconnect = mongoose.disconnect.bind(mongoose),
  manifest = PRODUCTION_INDEX_MANIFEST,
} = {}) => {
  const mode = parseArguments(argv);
  const uri = String(env.MONGODB_URI || "").trim();
  if (!uri) throw migrationError("MONGODB_URI_REQUIRED");

  await connect(uri, {
    autoIndex: false,
    autoCreate: false,
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 15000,
  });
  try {
    const actualEnvironment = String(env.NODE_ENV || "").trim();
    const actualDatabase = String(mongoose.connection.name || "").trim();
    if (mode.apply) {
      assertApplyIdentity({
        expectedEnvironment: mode.expectedEnvironment,
        expectedDatabase: mode.expectedDatabase,
        actualEnvironment,
        actualDatabase,
      });
      return await applyProductionIndexPlan({
        manifest,
        environment: actualEnvironment,
        databaseName: actualDatabase,
        confirmPlan: mode.confirmPlan,
      });
    }
    return {
      dryRun: true,
      applied: false,
      ...(await inspectProductionIndexPlan({
        manifest,
        environment: actualEnvironment,
        databaseName: actualDatabase,
      })),
    };
  } finally {
    await disconnect().catch(() => undefined);
  }
};

const main = async () => {
  try {
    const envLoad = loadRuntimeEnv();
    if (envLoad.loaded && isProductionEnv()) {
      throw migrationError("PRODUCTION_INDEX_PROCESS_ENV_REQUIRED");
    }
    const result = await run();
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        code: String(error?.code || "PRODUCTION_INDEX_MIGRATION_FAILED").slice(
          0,
          120,
        ),
      }),
    );
    process.exitCode = 1;
  }
};

if (require.main === module) main();

module.exports = {
  HASH_PATTERN,
  PLAN_VERSION,
  SAFE_DATABASE_NAME,
  SAFE_ENVIRONMENTS,
  applyProductionIndexPlan,
  assertApplyIdentity,
  canonicalize,
  compareCanonical,
  inspectProductionIndexPlan,
  migrationError,
  parseArguments,
  requirementIndexName,
  requirementOptions,
  run,
  safeIdentifier,
  sanitizedIndexState,
  sha256,
  stableStringify,
};
