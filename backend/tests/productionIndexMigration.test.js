import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  applyProductionIndexPlan,
  assertApplyIdentity,
  inspectProductionIndexPlan,
  parseArguments,
} = require("../scripts/ensure-production-indexes");

const createFixture = ({
  indexes = [],
  requirement = {},
  createError = null,
} = {}) => {
  let currentIndexes = structuredClone(indexes);
  const dropIndex = vi.fn();
  const createIndex = vi.fn(async (key, options) => {
    if (createError) throw createError;
    currentIndexes.push({
      name: options.name,
      key: structuredClone(key),
      ...structuredClone(options),
    });
    return options.name;
  });
  const collection = {
    collectionName: "SafetyRecords",
    indexes: vi.fn(async () => structuredClone(currentIndexes)),
    createIndex,
    dropIndex,
  };
  const manifest = [
    {
      model: { collection },
      requirements: [
        {
          id: "safety_key_unique",
          name: "safety_key_unique",
          key: { safetyKey: 1 },
          unique: true,
          sparse: false,
          partialFilterExpression: null,
          ...requirement,
        },
      ],
    },
  ];
  return { collection, createIndex, dropIndex, manifest };
};

describe("production index migration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("is a deterministic, sanitized dry-run by default", async () => {
    const fixture = createFixture({
      indexes: [
        {
          name: "sensitive_filter",
          key: { existing: 1 },
          partialFilterExpression: { tenant: "must-not-leak" },
        },
      ],
    });

    expect(parseArguments([])).toEqual({
      apply: false,
      expectedEnvironment: "",
      expectedDatabase: "",
      confirmPlan: "",
    });
    const first = await inspectProductionIndexPlan({
      manifest: fixture.manifest,
      environment: "production",
      databaseName: "inoxpran",
    });
    const second = await inspectProductionIndexPlan({
      manifest: fixture.manifest,
      environment: "production",
      databaseName: "inoxpran",
    });

    expect(first.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.planHash).toBe(first.planHash);
    expect(first.summary).toMatchObject({ creates: 1, blockers: 0 });
    expect(JSON.stringify(first)).not.toContain("must-not-leak");
    expect(fixture.createIndex).not.toHaveBeenCalled();
    expect(fixture.dropIndex).not.toHaveBeenCalled();
  });

  it("rejects a mismatched plan confirmation before creating anything", async () => {
    const fixture = createFixture();
    await expect(
      applyProductionIndexPlan({
        manifest: fixture.manifest,
        environment: "production",
        databaseName: "inoxpran",
        confirmPlan: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_INDEX_PLAN_MISMATCH" });
    expect(fixture.createIndex).not.toHaveBeenCalled();
    expect(fixture.dropIndex).not.toHaveBeenCalled();
  });

  it("creates only the reviewed additive index and verifies the after-state", async () => {
    const fixture = createFixture();
    const plan = await inspectProductionIndexPlan({
      manifest: fixture.manifest,
      environment: "production",
      databaseName: "inoxpran",
    });
    const result = await applyProductionIndexPlan({
      manifest: fixture.manifest,
      environment: "production",
      databaseName: "inoxpran",
      confirmPlan: plan.planHash,
    });

    expect(result).toMatchObject({
      applied: true,
      created: 1,
      confirmedPlanHash: plan.planHash,
    });
    expect(fixture.createIndex).toHaveBeenCalledTimes(1);
    expect(fixture.createIndex).toHaveBeenCalledWith(
      { safetyKey: 1 },
      {
        name: "safety_key_unique",
        unique: true,
        sparse: false,
      },
    );
    expect(fixture.dropIndex).not.toHaveBeenCalled();
  });

  it("is idempotent when the required index already exists", async () => {
    const fixture = createFixture({
      indexes: [
        {
          name: "safety_key_unique",
          key: { safetyKey: 1 },
          unique: true,
          sparse: false,
        },
      ],
    });
    const plan = await inspectProductionIndexPlan({
      manifest: fixture.manifest,
      environment: "staging",
      databaseName: "inoxpran_staging",
    });
    const result = await applyProductionIndexPlan({
      manifest: fixture.manifest,
      environment: "staging",
      databaseName: "inoxpran_staging",
      confirmPlan: plan.planHash,
    });

    expect(plan.summary.creates).toBe(0);
    expect(result.created).toBe(0);
    expect(fixture.createIndex).not.toHaveBeenCalled();
    expect(fixture.dropIndex).not.toHaveBeenCalled();
  });

  it("blocks conflicting index state and never drops the conflict", async () => {
    const fixture = createFixture({
      indexes: [
        {
          name: "safety_key_unique",
          key: { safetyKey: 1 },
          unique: false,
        },
      ],
    });
    const plan = await inspectProductionIndexPlan({
      manifest: fixture.manifest,
      environment: "production",
      databaseName: "inoxpran",
    });
    expect(plan.blockers).toEqual([
      expect.objectContaining({ code: "PRODUCTION_INDEX_NAME_CONFLICT" }),
    ]);
    await expect(
      applyProductionIndexPlan({
        manifest: fixture.manifest,
        environment: "production",
        databaseName: "inoxpran",
        confirmPlan: plan.planHash,
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_INDEX_PLAN_BLOCKED" });
    expect(fixture.createIndex).not.toHaveBeenCalled();
    expect(fixture.dropIndex).not.toHaveBeenCalled();
  });

  it("reports the legacy API-key TTL as a separate non-dropping blocker", async () => {
    const fixture = createFixture({
      indexes: [
        {
          name: "createdAt_1",
          key: { createdAt: 1 },
          expireAfterSeconds: 3600,
        },
      ],
      requirement: { id: "api_key_unique" },
    });
    const plan = await inspectProductionIndexPlan({
      manifest: fixture.manifest,
      environment: "production",
      databaseName: "inoxpran",
    });

    expect(plan.blockers).toContainEqual(
      expect.objectContaining({
        code: "PRODUCTION_INDEX_LEGACY_TTL_REQUIRES_SEPARATE_MIGRATION",
      }),
    );
    expect(fixture.dropIndex).not.toHaveBeenCalled();
  });

  it("sanitizes a unique creation conflict without attempting a rollback drop", async () => {
    const fixture = createFixture({
      createError: { code: 11000, message: "duplicate secret data" },
    });
    const plan = await inspectProductionIndexPlan({
      manifest: fixture.manifest,
      environment: "production",
      databaseName: "inoxpran",
    });
    await expect(
      applyProductionIndexPlan({
        manifest: fixture.manifest,
        environment: "production",
        databaseName: "inoxpran",
        confirmPlan: plan.planHash,
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_INDEX_UNIQUE_CONFLICT" });
    expect(fixture.dropIndex).not.toHaveBeenCalled();
  });

  it("sanitizes an unexpected index creation failure", async () => {
    const fixture = createFixture({
      createError: new Error("provider detail must not escape"),
    });
    const plan = await inspectProductionIndexPlan({
      manifest: fixture.manifest,
      environment: "production",
      databaseName: "inoxpran",
    });
    await expect(
      applyProductionIndexPlan({
        manifest: fixture.manifest,
        environment: "production",
        databaseName: "inoxpran",
        confirmPlan: plan.planHash,
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_INDEX_CREATE_FAILED" });
    expect(fixture.dropIndex).not.toHaveBeenCalled();
  });

  it("requires exact environment and database identities for apply mode", () => {
    const hash = "a".repeat(64);
    expect(
      parseArguments([
        "--apply",
        "--expected-environment",
        "production",
        "--expected-database",
        "inoxpran",
        "--confirm-plan",
        hash,
      ]),
    ).toMatchObject({
      apply: true,
      expectedEnvironment: "production",
      expectedDatabase: "inoxpran",
      confirmPlan: hash,
    });
    expect(() =>
      assertApplyIdentity({
        expectedEnvironment: "production",
        expectedDatabase: "inoxpran",
        actualEnvironment: "production",
        actualDatabase: "other",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PRODUCTION_INDEX_DATABASE_MISMATCH" }),
    );
  });
});
