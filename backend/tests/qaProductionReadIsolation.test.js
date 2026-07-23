import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { blog } = require("../src/models/blog.model");
const {
  EditorialStyleDefinition,
} = require("../src/models/editorialStyleDefinition.model");
const {
  EditorialStyleProfile,
} = require("../src/models/editorialStyleProfile.model");
const { ResearchBundle } = require("../src/models/researchBundle.model");
const { BlogStrategyPlan } = require("../src/models/blogStrategyPlan.model");
const { ProductSeedPlan } = require("../src/models/productSeedPlan.model");
const {
  ProductSeedExposure,
} = require("../src/models/productSeedExposure.model");
const {
  EditorialProductPlacementPlan,
} = require("../src/models/editorialProductPlacementPlan.model");
const {
  BlogAutomationSchedule,
} = require("../src/models/blogAutomationSchedule.model");
const {
  BlogAutomationExecution,
} = require("../src/models/blogAutomationExecution.model");
const {
  GoogleIntelligenceSnapshot,
} = require("../src/models/googleIntelligenceSnapshot.model");
const {
  GoogleIntelligenceRun,
} = require("../src/models/googleIntelligenceRun.model");
const userModel = require("../src/models/user.model");
const { product } = require("../src/models/product.model");
const { order } = require("../src/models/order");
const {
  AgenticBlogCoreService,
  buildOriginalityCorpusFilter,
} = require("../src/services/agenticBlogCore.service");
const {
  EditorialProductPlacementPlanningService,
} = require("../src/services/editorialProductPlacementPlanning.service");
const {
  ProductSeedPlanningService,
} = require("../src/services/productSeedPlanning.service");
const {
  ProductSeedingAdminService,
} = require("../src/services/productSeedingAdmin.service");
const {
  BlogAutomationScheduleService,
} = require("../src/services/blogAutomationSchedule.service");
const {
  GoogleIntelligenceService,
} = require("../src/services/googleIntelligence.service");
const DashboardMetricsService = require("../src/services/dashboardMetrics.service");

const ID = "507f1f77bcf86cd799439011";
const QA = Object.freeze({
  isQaTest: true,
  qaBatchId: "507f1f77bcf86cd799439101",
  qaCaseId: "507f1f77bcf86cd799439102",
  environment: "local",
  executionMode: "run_now",
  originalTopicSeed: "QA isolation topic",
  normalizedTopicKey: "qa-isolation-topic",
});

const queryOf = (value) => {
  const query = {};
  for (const method of ["sort", "skip", "limit", "select"])
    query[method] = vi.fn(() => query);
  query.lean = vi.fn(async () => value);
  query.then = (resolve, reject) =>
    Promise.resolve(value).then(resolve, reject);
  return query;
};

afterEach(() => vi.restoreAllMocks());

describe("QA/production generation isolation", () => {
  it("builds production-only and exact-case originality corpus filters", () => {
    expect(
      buildOriginalityCorpusFilter({ targetIds: new Set(["one", "two"]) }),
    ).toEqual({
      _id: { $nin: ["one", "two"] },
      isQaTest: { $ne: true },
    });
    expect(
      buildOriginalityCorpusFilter({ targetIds: ["one"], qaContext: QA }),
    ).toEqual({
      _id: { $nin: ["one"] },
      isQaTest: true,
      qaBatchId: QA.qaBatchId,
      qaCaseId: QA.qaCaseId,
    });
    expect(() =>
      buildOriginalityCorpusFilter({ qaContext: { isQaTest: true } }),
    ).toThrow(
      expect.objectContaining({ code: "TRUSTED_QA_PROVENANCE_INVALID" }),
    );
  });

  it("selects style profiles from production or the exact trusted QA case only", async () => {
    vi.spyOn(AgenticBlogCoreService, "seedStyleLibrary").mockResolvedValue();
    const findOne = vi
      .spyOn(EditorialStyleProfile, "findOne")
      .mockReturnValue(queryOf({ _id: ID, articleVariants: [] }));
    vi.spyOn(EditorialStyleProfile, "findByIdAndUpdate").mockReturnValue(
      queryOf({ _id: ID, articleVariants: [] }),
    );

    await AgenticBlogCoreService.chooseStyleProfile({
      now: new Date("2026-07-23T04:00:00.000Z"),
    });
    expect(findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isQaTest: { $ne: true },
      }),
    );

    await AgenticBlogCoreService.chooseStyleProfile({
      now: new Date("2026-07-23T04:00:00.000Z"),
      qaContext: QA,
    });
    expect(findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isQaTest: true,
        qaBatchId: QA.qaBatchId,
        qaCaseId: QA.qaCaseId,
      }),
    );
  });

  it("filters the style-rotation lookback corpus with the same exact scope", async () => {
    vi.spyOn(AgenticBlogCoreService, "seedStyleLibrary").mockResolvedValue();
    vi.spyOn(EditorialStyleProfile, "findOne").mockReturnValue(queryOf(null));
    const profileFind = vi
      .spyOn(EditorialStyleProfile, "find")
      .mockReturnValue(queryOf([]));
    vi.spyOn(EditorialStyleDefinition, "find").mockReturnValue(
      queryOf([
        {
          _id: ID,
          styleFamily: "problem-solution",
          enabled: true,
          locked: false,
          cooldownDays: 7,
        },
      ]),
    );
    vi.spyOn(EditorialStyleDefinition, "updateOne").mockResolvedValue({
      matchedCount: 1,
    });
    vi.spyOn(EditorialStyleProfile, "create").mockImplementation(
      async (document) => ({
        ...document,
        _id: ID,
        toObject: () => ({ ...document, _id: ID }),
      }),
    );

    await AgenticBlogCoreService.chooseStyleProfile({
      now: new Date("2026-07-23T04:00:00.000Z"),
    });
    expect(profileFind).toHaveBeenLastCalledWith(
      expect.objectContaining({ isQaTest: { $ne: true } }),
    );

    await AgenticBlogCoreService.chooseStyleProfile({
      now: new Date("2026-07-23T04:00:00.000Z"),
      qaContext: QA,
    });
    expect(profileFind).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isQaTest: true,
        qaBatchId: QA.qaBatchId,
        qaCaseId: QA.qaCaseId,
      }),
    );
  });

  it("isolates recent editorial placement rotation by provenance scope", async () => {
    const find = vi
      .spyOn(EditorialProductPlacementPlan, "find")
      .mockReturnValue(queryOf([]));
    const productSeedPlan = {
      _id: ID,
      decision: "no_seed",
      primaryProduct: null,
      supportingProducts: [],
    };

    await EditorialProductPlacementPlanningService.createPlan({
      brief: { topic: "Production topic" },
      productSeedPlan,
      persist: false,
    });
    expect(find).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isQaTest: { $ne: true },
      }),
    );

    await EditorialProductPlacementPlanningService.createPlan({
      brief: { topic: "QA topic", qaContext: QA },
      productSeedPlan,
      persist: false,
    });
    expect(find).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isQaTest: true,
        qaBatchId: QA.qaBatchId,
        qaCaseId: QA.qaCaseId,
      }),
    );
  });
});

describe("normal admin read isolation", () => {
  it("hides QA styles, research bundles and strategies", async () => {
    vi.spyOn(AgenticBlogCoreService, "seedStyleLibrary").mockResolvedValue();
    vi.spyOn(EditorialStyleDefinition, "find").mockReturnValue(queryOf([]));
    const profileFind = vi
      .spyOn(EditorialStyleProfile, "find")
      .mockReturnValue(queryOf([]));
    await AgenticBlogCoreService.listStyles();
    expect(profileFind).toHaveBeenCalledWith({ isQaTest: { $ne: true } });

    const researchFind = vi
      .spyOn(ResearchBundle, "findOne")
      .mockReturnValue(queryOf(null));
    await expect(
      AgenticBlogCoreService.getResearchBundle({ bundleId: ID }),
    ).rejects.toThrow("not found");
    expect(researchFind).toHaveBeenCalledWith({
      _id: ID,
      isQaTest: { $ne: true },
    });

    const strategyFind = vi
      .spyOn(BlogStrategyPlan, "findOne")
      .mockReturnValue(queryOf(null));
    await expect(
      AgenticBlogCoreService.getStrategy({ strategyId: ID }),
    ).rejects.toThrow("not found");
    expect(strategyFind).toHaveBeenCalledWith({
      _id: ID,
      isQaTest: { $ne: true },
    });
  });

  it("hides QA product and placement plans and strips QA trust keys from preview input", async () => {
    const productFind = vi
      .spyOn(ProductSeedPlan, "find")
      .mockReturnValue(queryOf([]));
    vi.spyOn(ProductSeedPlan, "countDocuments").mockResolvedValue(0);
    await ProductSeedingAdminService.listPlans();
    expect(productFind).toHaveBeenCalledWith({ isQaTest: { $ne: true } });

    const productGet = vi
      .spyOn(ProductSeedPlan, "findOne")
      .mockReturnValue(queryOf(null));
    await expect(
      ProductSeedingAdminService.getPlan({ planId: ID }),
    ).rejects.toThrow("not found");
    expect(productGet).toHaveBeenCalledWith({
      _id: ID,
      isQaTest: { $ne: true },
    });

    const placementFind = vi
      .spyOn(EditorialProductPlacementPlan, "find")
      .mockReturnValue(queryOf([]));
    vi.spyOn(EditorialProductPlacementPlan, "countDocuments").mockResolvedValue(
      0,
    );
    await ProductSeedingAdminService.listPlacementPlans();
    expect(placementFind).toHaveBeenCalledWith({ isQaTest: { $ne: true } });

    const placementGet = vi
      .spyOn(EditorialProductPlacementPlan, "findOne")
      .mockReturnValue(queryOf(null));
    await expect(
      ProductSeedingAdminService.getPlacementPlan({ planId: ID }),
    ).rejects.toThrow("not found");
    expect(placementGet).toHaveBeenCalledWith({
      _id: ID,
      isQaTest: { $ne: true },
    });

    const exposureFind = vi
      .spyOn(ProductSeedExposure, "find")
      .mockReturnValue(queryOf([]));
    vi.spyOn(ProductSeedExposure, "countDocuments").mockResolvedValue(0);
    await ProductSeedingAdminService.listExposures();
    expect(exposureFind).toHaveBeenCalledWith({ isQaTest: { $ne: true } });

    const createSeed = vi
      .spyOn(ProductSeedPlanningService, "createPlan")
      .mockResolvedValue({
        mode: "off",
        intensity: "light",
        decision: "no_seed",
      });
    vi.spyOn(
      EditorialProductPlacementPlanningService,
      "createPlan",
    ).mockResolvedValue({
      placementSequence: [],
      warnings: [],
    });
    await ProductSeedingAdminService.preview({
      payload: { topic: "Preview", ...QA, qaContext: QA },
    });
    expect(createSeed.mock.calls[0][0].brief).not.toEqual(
      expect.objectContaining({
        isQaTest: true,
      }),
    );
    expect(createSeed.mock.calls[0][0].brief).not.toHaveProperty("qaContext");
    expect(createSeed.mock.calls[0][0].brief).not.toHaveProperty("qaBatchId");
  });

  it("hides QA schedules and execution history from normal schedule APIs", async () => {
    const scheduleFind = vi
      .spyOn(BlogAutomationSchedule, "find")
      .mockReturnValue(queryOf([]));
    const scheduleCount = vi
      .spyOn(BlogAutomationSchedule, "countDocuments")
      .mockResolvedValue(0);
    await BlogAutomationScheduleService.listSchedules();
    expect(scheduleFind).toHaveBeenCalledWith({ isQaTest: { $ne: true } });
    expect(scheduleCount).toHaveBeenCalledWith({ isQaTest: { $ne: true } });

    const scheduleGet = vi
      .spyOn(BlogAutomationSchedule, "findOne")
      .mockReturnValue(queryOf(null));
    await expect(
      BlogAutomationScheduleService.getSchedule({ scheduleId: ID }),
    ).rejects.toThrow("not found");
    expect(scheduleGet).toHaveBeenCalledWith(
      expect.objectContaining({ isQaTest: { $ne: true } }),
    );

    const executionFind = vi
      .spyOn(BlogAutomationExecution, "find")
      .mockReturnValue(queryOf([]));
    await BlogAutomationScheduleService.listExecutions({ scheduleId: ID });
    expect(executionFind).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: expect.anything(),
        isQaTest: { $ne: true },
      }),
    );
  });

  it("hides QA Google snapshots from get, override and related-blog reads", async () => {
    const snapshotFind = vi
      .spyOn(GoogleIntelligenceSnapshot, "findOne")
      .mockReturnValue(queryOf(null));
    await expect(
      GoogleIntelligenceService.getSnapshot({ snapshotId: ID }),
    ).rejects.toThrow("not found");
    expect(snapshotFind).toHaveBeenLastCalledWith(
      expect.objectContaining({ isQaTest: { $ne: true } }),
    );

    await expect(
      GoogleIntelligenceService.overrideSnapshot({
        snapshotId: ID,
        adminId: ID,
        reason: "A sufficiently detailed override reason",
      }),
    ).rejects.toThrow("not found");
    expect(snapshotFind).toHaveBeenLastCalledWith(
      expect.objectContaining({ isQaTest: { $ne: true } }),
    );

    const blogFind = vi.spyOn(blog, "find").mockReturnValue(queryOf([]));
    await GoogleIntelligenceService.listRelatedBlogs();
    expect(blogFind).toHaveBeenCalledWith(
      expect.objectContaining({ isQaTest: { $ne: true } }),
    );
  });
});

describe("dashboard isolation", () => {
  it("starts the production blog aggregate with a QA exclusion match", async () => {
    vi.spyOn(userModel, "aggregate").mockResolvedValue([]);
    vi.spyOn(userModel, "countDocuments").mockResolvedValue(0);
    vi.spyOn(product, "aggregate").mockResolvedValue([]);
    const blogAggregate = vi.spyOn(blog, "aggregate").mockResolvedValue([]);
    vi.spyOn(order, "aggregate").mockResolvedValue([]);
    vi.spyOn(
      DashboardMetricsService,
      "getOrderWindowMetrics",
    ).mockResolvedValue({});

    await DashboardMetricsService.getBusinessMetrics({
      now: new Date("2026-07-23T00:00:00.000Z"),
    });
    expect(blogAggregate.mock.calls[0][0][0]).toEqual({
      $match: { isQaTest: { $ne: true } },
    });
  });
});
