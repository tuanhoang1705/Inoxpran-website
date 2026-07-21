import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  PerformanceLearningService,
  buildMonitoringTasks,
  buildPerformanceSnapshot,
  collectMonitoringSources,
  deriveLearningRecommendation,
} = require("../src/services/contentOperations/performanceLearning.service");
const { blog } = require("../src/models/blog.model");
const {
  ContentInventoryItem,
} = require("../src/models/contentInventoryItem.model");
const {
  PostPublishVerification,
} = require("../src/models/postPublishVerification.model");

const objectId = (suffix) => `507f1f77bcf86cd7994392${suffix}`;

const createRunDueHarness = ({
  initialGeneration = 0,
  extraSnapshots = [],
} = {}) => {
  const events = [];
  const taskState = {
    _id: objectId("03"),
    blogId: objectId("01"),
    contentWorkOrderId: objectId("02"),
    window: "30d",
    dueAt: new Date("2026-07-20T00:00:00.000Z"),
    status: "pending",
    lockedBy: "",
    claimGeneration: initialGeneration,
    performanceSnapshotId: null,
  };
  let snapshotState = null;
  const TaskModel = {
    findOneAndUpdate: vi.fn(async (_filter, update) => {
      taskState.status = update.$set.status;
      taskState.lockedBy = update.$set.lockedBy;
      taskState.claimGeneration += update.$inc.claimGeneration;
      return { ...taskState };
    }),
    updateOne: vi.fn(async (filter, update) => {
      const owned =
        filter.status === taskState.status &&
        filter.lockedBy === taskState.lockedBy &&
        filter.claimGeneration === taskState.claimGeneration;
      if (!owned) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set?.status === "complete") events.push("terminal");
      if (update.$set?.status === "failed") events.push("failed");
      Object.assign(taskState, update.$set || {});
      taskState.attemptCount =
        Number(taskState.attemptCount || 0) +
        Number(update.$inc?.attemptCount || 0);
      return { matchedCount: 1, modifiedCount: 1 };
    }),
    find: vi.fn(() => ({
      select: vi.fn(() => ({
        lean: vi.fn(async () =>
          taskState.status === "complete" ? [{ ...taskState }] : [],
        ),
      })),
    })),
  };
  const SnapshotModel = {
    findOneAndUpdate: vi.fn(async (_filter, update) => {
      snapshotState = { _id: objectId("04"), ...update.$set };
      return { ...snapshotState };
    }),
    find: vi.fn(() => ({
      sort: vi.fn(() => ({
        lean: vi.fn(async () => [
          ...(snapshotState ? [{ ...snapshotState }] : []),
          ...extraSnapshots,
        ]),
      })),
    })),
  };
  return { events, taskState, TaskModel, SnapshotModel };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Content monitoring and performance snapshots", () => {
  it("builds deterministic idempotency windows including immediate", () => {
    const publishedAt = new Date("2026-07-20T00:00:00.000Z");
    const tasks = buildMonitoringTasks({
      blogId: objectId("01"),
      contentWorkOrderId: objectId("02"),
      publishedAt,
      windows: ["immediate", "1d", "7d", "14d", "30d", "90d"],
    });
    expect(tasks.map((task) => task.window)).toEqual([
      "immediate",
      "1d",
      "7d",
      "14d",
      "30d",
      "90d",
    ]);
    expect(tasks[0].dueAt.toISOString()).toBe(publishedAt.toISOString());
    expect(tasks[1].dueAt.toISOString()).toBe("2026-07-21T00:00:00.000Z");
  });

  it("never turns unavailable metrics into zero and preserves observed zero", () => {
    const task = {
      _id: objectId("03"),
      blogId: objectId("01"),
      contentWorkOrderId: objectId("02"),
      window: "7d",
      lockedBy: "monitor-a:claim-1",
      claimGeneration: 1,
    };
    const unavailable = buildPerformanceSnapshot({
      task,
      sources: {
        searchConsole: { configured: false, clicks: 99 },
        analytics: { configured: false, views: 99 },
      },
    });
    expect(unavailable.searchConsole.clicks).toBeNull();
    expect(unavailable.analytics.views).toBeNull();
    const observedZero = buildPerformanceSnapshot({
      task,
      sources: {
        searchConsole: { configured: true, clicks: 0, impressions: 0 },
        analytics: { configured: true, views: 0 },
      },
    });
    expect(observedZero.searchConsole.clicks).toBe(0);
    expect(observedZero.analytics.views).toBe(0);
  });

  it("uses upsert keys so concurrent/repeated scheduling does not duplicate windows", async () => {
    const seen = new Map();
    const TaskModel = {
      findOneAndUpdate: vi.fn(async (query, update) => {
        const key = `${query.blogId}:${query.contentWorkOrderId}:${query.window}`;
        if (!seen.has(key)) seen.set(key, update.$setOnInsert);
        return seen.get(key);
      }),
    };
    const input = {
      blogId: objectId("01"),
      contentWorkOrderId: objectId("02"),
      windows: ["1d", "7d"],
    };
    await PerformanceLearningService.scheduleMonitoring(input, { TaskModel });
    await PerformanceLearningService.scheduleMonitoring(input, { TaskModel });
    expect(seen.size).toBe(2);
    expect(TaskModel.findOneAndUpdate).toHaveBeenCalledTimes(4);
  });

  it("scopes technical verification to the work order and current revision hash", async () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    const currentBlog = {
      _id: objectId("01"),
      blog_slug: "noi-inox",
      canonicalUrl: "https://inoxpran.com/blog/noi-inox",
      contentRevisionHash: "revision-hash-1",
      isPublished: true,
      isDraft: false,
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
      updatedAt: new Date("2026-07-10T12:00:00.000Z"),
    };
    vi.spyOn(blog, "findById").mockReturnValue({
      select: vi.fn(() => ({ lean: vi.fn(async () => currentBlog) })),
    });
    const verificationLean = vi.fn(async () => ({
      _id: objectId("03"),
      pass: true,
      status: "passed",
      checkedAt: now,
    }));
    const verificationFind = vi
      .spyOn(PostPublishVerification, "findOne")
      .mockReturnValue({
        sort: vi.fn(() => ({ lean: verificationLean })),
      });
    vi.spyOn(ContentInventoryItem, "findOne").mockReturnValue({
      sort: vi.fn(() => ({ lean: vi.fn(async () => null) })),
    });

    const sources = await collectMonitoringSources({
      task: {
        blogId: objectId("01"),
        contentWorkOrderId: objectId("02"),
        window: "7d",
      },
      config: {
        searchConsole: { enabled: false, windows: [7] },
        aggregateAnalytics: { enabled: false, windows: [7] },
      },
      now,
    });

    expect(verificationFind).toHaveBeenCalledWith({
      blogId: objectId("01"),
      contentWorkOrderId: objectId("02"),
      expectedRevisionHash: "revision-hash-1",
    });
    expect(sources.technical).toMatchObject({ pass: true, status: "passed" });
    expect(sources.contentState.daysSinceMetadataChange).toBe(10);
  });

  it("rejects a stale snapshot generation without overwriting the newer capture", async () => {
    const state = {
      _id: objectId("04"),
      monitoringTaskId: objectId("03"),
      monitoringClaimToken: "monitor-b:new",
      monitoringClaimGeneration: 2,
      contentHash: "newer-hash",
    };
    const SnapshotModel = {
      findOneAndUpdate: vi.fn(async (_filter, update) => {
        const candidate = update.$set;
        const canWrite =
          state.monitoringClaimGeneration <
            candidate.monitoringClaimGeneration ||
          (state.monitoringClaimGeneration ===
            candidate.monitoringClaimGeneration &&
            state.monitoringClaimToken === candidate.monitoringClaimToken);
        if (!canWrite) {
          const duplicate = new Error("duplicate monitoringTaskId");
          duplicate.code = 11000;
          throw duplicate;
        }
        Object.assign(state, candidate);
        return { ...state };
      }),
    };
    const TaskModel = { updateOne: vi.fn() };

    await expect(
      PerformanceLearningService.recordPerformance(
        {
          task: {
            _id: objectId("03"),
            blogId: objectId("01"),
            contentWorkOrderId: objectId("02"),
            window: "7d",
            lockedBy: "monitor-a:stale",
            claimGeneration: 1,
          },
          sources: { searchConsole: {}, analytics: {} },
        },
        {
          SnapshotModel,
          TaskModel,
          claimToken: "monitor-a:stale",
          completeTask: false,
        },
      ),
    ).rejects.toThrow("monitoring_task_lease_lost");

    expect(state).toMatchObject({
      monitoringClaimToken: "monitor-b:new",
      monitoringClaimGeneration: 2,
      contentHash: "newer-hash",
    });
    expect(TaskModel.updateOne).not.toHaveBeenCalled();
  });

  it("allows a newer generation to replace an abandoned snapshot and completes only its task claim", async () => {
    const state = {
      _id: objectId("04"),
      monitoringTaskId: objectId("03"),
      monitoringClaimToken: "monitor-a:old",
      monitoringClaimGeneration: 1,
    };
    const SnapshotModel = {
      findOneAndUpdate: vi.fn(async (_filter, update) => {
        Object.assign(state, update.$set);
        return { ...state };
      }),
    };
    const TaskModel = {
      updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    };

    const snapshot = await PerformanceLearningService.recordPerformance(
      {
        task: {
          _id: objectId("03"),
          blogId: objectId("01"),
          contentWorkOrderId: objectId("02"),
          window: "7d",
          lockedBy: "monitor-b:new",
          claimGeneration: 2,
        },
        sources: { searchConsole: {}, analytics: {} },
      },
      { SnapshotModel, TaskModel, claimToken: "monitor-b:new" },
    );

    expect(snapshot).toMatchObject({
      monitoringClaimToken: "monitor-b:new",
      monitoringClaimGeneration: 2,
    });
    expect(TaskModel.updateOne).toHaveBeenCalledWith(
      {
        _id: objectId("03"),
        status: "running",
        lockedBy: "monitor-b:new",
        claimGeneration: 2,
      },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "complete" }),
      }),
    );
  });
});

describe("Conservative content learning", () => {
  it("monitors longer without minimum time/sample thresholds", () => {
    const result = deriveLearningRecommendation({
      snapshots: [
        {
          window: "7d",
          searchConsole: { configured: false, impressions: null },
        },
      ],
    });
    expect(result.recommendation).toBe("monitor_longer");
    expect(result.minimumThresholdsMet).toBe(false);
  });

  it("defaults the minimum learning age to fourteen days", () => {
    const sevenDay = deriveLearningRecommendation({
      snapshots: [
        {
          window: "7d",
          searchConsole: { configured: true, impressions: 1000, ctr: 0.04 },
        },
      ],
    });
    const fourteenDay = deriveLearningRecommendation({
      snapshots: [
        {
          window: "14d",
          searchConsole: { configured: true, impressions: 1000, ctr: 0.04 },
        },
      ],
    });
    expect(sevenDay.recommendation).toBe("monitor_longer");
    expect(fourteenDay.recommendation).toBe("keep");
  });

  it("avoids title churn and recommends metadata refresh only after sustained evidence", () => {
    const snapshots = [
      {
        window: "30d",
        searchConsole: { configured: true, impressions: 1000, ctr: 0.01 },
        contentState: {},
      },
    ];
    expect(
      deriveLearningRecommendation({ snapshots, daysSinceMetadataChange: 5 })
        .recommendation,
    ).toBe("keep");
    const mature = deriveLearningRecommendation({
      snapshots,
      daysSinceMetadataChange: 45,
    });
    expect(mature.recommendation).toBe("metadata_refresh");
    expect(mature.requiresNewWorkOrder).toBe(true);
  });

  it("creates auditable recommendations but never auto-applies them", async () => {
    let inserted = null;
    const LearningModel = {
      findOneAndUpdate: vi.fn(async (query, update) => {
        inserted = update.$setOnInsert;
        return inserted;
      }),
    };
    const record = await PerformanceLearningService.createLearningRecord(
      {
        blogId: objectId("01"),
        contentWorkOrderId: objectId("02"),
        snapshots: [
          {
            _id: objectId("04"),
            window: "30d",
            searchConsole: { configured: true, impressions: 500, ctr: 0.04 },
            contentState: { missingSections: ["FAQ"] },
          },
        ],
      },
      { LearningModel },
    );
    expect(record.recommendation).toBe("expand");
    expect(record.autoApplied).toBe(false);
    expect(record.status).toBe("proposed");
    expect(record.requiresNewWorkOrder).toBe(true);
  });

  it("passes measured metadata age and the conservative default into learning", async () => {
    const previousOperationsEnabled = process.env.CONTENT_OPERATIONS_ENABLED;
    const previousMonitoringEnabled =
      process.env.CONTENT_PERFORMANCE_MONITORING_ENABLED;
    const previousLearningEnabled = process.env.CONTENT_LEARNING_ENABLED;
    const previousMinimumAge = process.env.CONTENT_LEARNING_MIN_AGE_DAYS;
    process.env.CONTENT_OPERATIONS_ENABLED = "true";
    process.env.CONTENT_PERFORMANCE_MONITORING_ENABLED = "true";
    process.env.CONTENT_LEARNING_ENABLED = "true";
    delete process.env.CONTENT_LEARNING_MIN_AGE_DAYS;
    const now = new Date("2026-07-20T12:00:00.000Z");
    const task = {
      _id: objectId("03"),
      blogId: objectId("01"),
      contentWorkOrderId: objectId("02"),
      window: "30d",
      lockedBy: "content-performance-worker:claim-1",
      claimGeneration: 1,
    };
    let completedTask = null;
    const TaskModel = {
      findOneAndUpdate: vi.fn(async (_filter, update) => ({
        ...task,
        lockedBy: update.$set.lockedBy,
        claimGeneration: 1,
      })),
      updateOne: vi.fn(async (filter, update) => {
        if (update.$set?.status === "complete") {
          completedTask = {
            ...task,
            status: "complete",
            claimGeneration: filter.claimGeneration,
            performanceSnapshotId: update.$set.performanceSnapshotId,
          };
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }),
      find: vi.fn(() => ({
        select: vi.fn(() => ({
          lean: vi.fn(async () => (completedTask ? [completedTask] : [])),
        })),
      })),
    };
    const snapshots = [
      {
        _id: objectId("04"),
        measuredAt: now,
        window: "30d",
        monitoringTaskId: objectId("03"),
        monitoringClaimGeneration: 1,
        searchConsole: { configured: true, impressions: 1000, ctr: 0.01 },
        contentState: { daysSinceMetadataChange: 21 },
      },
    ];
    const SnapshotModel = {
      find: vi.fn(() => ({
        sort: vi.fn(() => ({ lean: vi.fn(async () => snapshots) })),
      })),
    };
    vi.spyOn(PerformanceLearningService, "recordPerformance").mockResolvedValue(
      snapshots[0],
    );
    const learningSpy = vi
      .spyOn(PerformanceLearningService, "createLearningRecord")
      .mockImplementation(async (input) => input);

    try {
      await PerformanceLearningService.runDueOnce(
        { now },
        {
          TaskModel,
          SnapshotModel,
          LearningModel: {},
          collectSources: vi.fn(async () => ({
            searchConsole: {},
            analytics: {},
          })),
        },
      );

      expect(learningSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          minimumDays: 14,
          daysSinceMetadataChange: 21,
        }),
        { LearningModel: {} },
      );
    } finally {
      if (previousOperationsEnabled === undefined)
        delete process.env.CONTENT_OPERATIONS_ENABLED;
      else process.env.CONTENT_OPERATIONS_ENABLED = previousOperationsEnabled;
      if (previousMonitoringEnabled === undefined)
        delete process.env.CONTENT_PERFORMANCE_MONITORING_ENABLED;
      else
        process.env.CONTENT_PERFORMANCE_MONITORING_ENABLED =
          previousMonitoringEnabled;
      if (previousLearningEnabled === undefined)
        delete process.env.CONTENT_LEARNING_ENABLED;
      else process.env.CONTENT_LEARNING_ENABLED = previousLearningEnabled;
      if (previousMinimumAge === undefined)
        delete process.env.CONTENT_LEARNING_MIN_AGE_DAYS;
      else process.env.CONTENT_LEARNING_MIN_AGE_DAYS = previousMinimumAge;
    }
  });

  it("atomically increments the claim and commits the terminal task before learning from only completed generations", async () => {
    vi.stubEnv("CONTENT_OPERATIONS_ENABLED", "true");
    vi.stubEnv("CONTENT_PERFORMANCE_MONITORING_ENABLED", "true");
    vi.stubEnv("CONTENT_LEARNING_ENABLED", "true");
    const staleSnapshot = {
      _id: objectId("05"),
      blogId: objectId("01"),
      contentWorkOrderId: objectId("02"),
      monitoringTaskId: objectId("03"),
      monitoringClaimGeneration: 4,
      measuredAt: new Date("2026-07-19T12:00:00.000Z"),
      window: "30d",
    };
    const harness = createRunDueHarness({
      initialGeneration: 4,
      extraSnapshots: [staleSnapshot],
    });
    const learningSpy = vi
      .spyOn(PerformanceLearningService, "createLearningRecord")
      .mockImplementation(async (input) => {
        harness.events.push("learning");
        return { ...input, requiresNewWorkOrder: false };
      });

    await PerformanceLearningService.runDueOnce(
      {
        workerId: "monitor-generation",
        now: new Date("2026-07-20T12:00:00.000Z"),
      },
      {
        TaskModel: harness.TaskModel,
        SnapshotModel: harness.SnapshotModel,
        LearningModel: {},
        collectSources: vi.fn(async () => ({
          searchConsole: { configured: true, impressions: 500, ctr: 0.04 },
          analytics: {},
        })),
        heartbeatFactory: () => ({
          beat: vi.fn(async () => true),
          stop: vi.fn(async () => {}),
        }),
      },
    );

    expect(harness.TaskModel.findOneAndUpdate.mock.calls[0][1]).toMatchObject({
      $inc: { claimGeneration: 1 },
    });
    expect(harness.events).toEqual(["terminal", "learning"]);
    expect(harness.taskState).toMatchObject({
      status: "complete",
      claimGeneration: 5,
      performanceSnapshotId: objectId("04"),
    });
    expect(learningSpy.mock.calls[0][0].snapshots).toEqual([
      expect.objectContaining({
        _id: objectId("04"),
        monitoringClaimGeneration: 5,
      }),
    ]);
  });

  it("isolates learning failures after a successful performance commit", async () => {
    vi.stubEnv("CONTENT_OPERATIONS_ENABLED", "true");
    vi.stubEnv("CONTENT_PERFORMANCE_MONITORING_ENABLED", "true");
    vi.stubEnv("CONTENT_LEARNING_ENABLED", "true");
    const harness = createRunDueHarness();
    vi.spyOn(
      PerformanceLearningService,
      "createLearningRecord",
    ).mockRejectedValue(
      new Error("mongodb://user:password@private.invalid/db"),
    );
    const auditWriter = vi.fn(async () => ({}));

    const result = await PerformanceLearningService.runDueOnce(
      {
        workerId: "monitor-learning",
        now: new Date("2026-07-20T12:00:00.000Z"),
      },
      {
        TaskModel: harness.TaskModel,
        SnapshotModel: harness.SnapshotModel,
        LearningModel: {},
        collectSources: vi.fn(async () => ({
          searchConsole: {},
          analytics: {},
        })),
        heartbeatFactory: () => ({
          beat: vi.fn(async () => true),
          stop: vi.fn(async () => {}),
        }),
        auditWriter,
      },
    );

    expect(result).toMatchObject({
      learning: null,
      learningWorkOrder: null,
      learningError: "CONTENT_LEARNING_FAILED",
    });
    expect(harness.taskState.status).toBe("complete");
    expect(harness.events).toEqual(["terminal"]);
    expect(
      harness.TaskModel.updateOne.mock.calls.some(
        ([, update]) => update.$set?.status === "failed",
      ),
    ).toBe(false);
    expect(auditWriter).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "content_learning_failed",
        metadata: expect.objectContaining({
          errorCode: "CONTENT_LEARNING_FAILED",
          claimGeneration: 1,
        }),
      }),
    );
    expect(JSON.stringify(auditWriter.mock.calls)).not.toContain("password");
  });

  it("does no monitoring work unless both top-level operations and monitoring are explicitly enabled", async () => {
    const previousOperationsEnabled = process.env.CONTENT_OPERATIONS_ENABLED;
    const previousMonitoringEnabled =
      process.env.CONTENT_PERFORMANCE_MONITORING_ENABLED;
    delete process.env.CONTENT_OPERATIONS_ENABLED;
    process.env.CONTENT_PERFORMANCE_MONITORING_ENABLED = "true";
    const TaskModel = { findOneAndUpdate: vi.fn() };
    try {
      expect(
        await PerformanceLearningService.runDueOnce({}, { TaskModel }),
      ).toBeNull();
      expect(TaskModel.findOneAndUpdate).not.toHaveBeenCalled();
    } finally {
      if (previousOperationsEnabled === undefined)
        delete process.env.CONTENT_OPERATIONS_ENABLED;
      else process.env.CONTENT_OPERATIONS_ENABLED = previousOperationsEnabled;
      if (previousMonitoringEnabled === undefined)
        delete process.env.CONTENT_PERFORMANCE_MONITORING_ENABLED;
      else
        process.env.CONTENT_PERFORMANCE_MONITORING_ENABLED =
          previousMonitoringEnabled;
    }
  });

  it("creates exactly one deduplicated planned Work Order for a high-impact learning record", async () => {
    const sourceWorkOrder = {
      _id: objectId("02"),
      contentOperationsSnapshotId: objectId("10"),
      googleIntelSnapshotId: objectId("11"),
      topic: "Existing article follow-up",
      targetAudience: ["households"],
      primarySearchIntent: "informational",
    };
    let decisionInsertCount = 0;
    let workOrderInsertCount = 0;
    let persistedDecision = null;
    let persistedWorkOrder = null;
    const DecisionModel = {
      findOneAndUpdate: vi.fn(async (_query, update) => {
        if (!persistedDecision) {
          decisionInsertCount += 1;
          persistedDecision = { _id: objectId("12"), ...update.$setOnInsert };
        }
        return persistedDecision;
      }),
    };
    const WorkOrderModel = {
      findById: vi.fn((id) => ({
        lean: vi.fn(async () =>
          String(id) === objectId("13") ? persistedWorkOrder : sourceWorkOrder,
        ),
      })),
      findOneAndUpdate: vi.fn(async (_query, update) => {
        if (!persistedWorkOrder) {
          workOrderInsertCount += 1;
          persistedWorkOrder = { _id: objectId("13"), ...update.$setOnInsert };
        }
        return persistedWorkOrder;
      }),
    };
    const learning = {
      _id: objectId("14"),
      blogId: objectId("01"),
      contentWorkOrderId: objectId("02"),
      recommendation: "update",
      confidence: 0.9,
      reasons: ["technical_failure"],
      evidence: [{ id: objectId("04"), window: "30d" }],
      requiresNewWorkOrder: true,
      status: "proposed",
    };
    let persistedLearning = {
      ...learning,
      generatedWorkOrderId: null,
      leaseUntil: null,
      lockedBy: "",
    };
    const LearningModel = {
      findOneAndUpdate: vi.fn(async (_query, update) => {
        if (
          persistedLearning.generatedWorkOrderId ||
          persistedLearning.lockedBy
        )
          return null;
        persistedLearning = { ...persistedLearning, ...update.$set };
        return persistedLearning;
      }),
      findById: vi.fn(() => ({ lean: vi.fn(async () => persistedLearning) })),
      updateOne: vi.fn(async (query, update) => {
        if (query.lockedBy && query.lockedBy !== persistedLearning.lockedBy) {
          return { matchedCount: 0, modifiedCount: 0 };
        }
        persistedLearning = { ...persistedLearning, ...update.$set };
        return { matchedCount: 1, modifiedCount: 1 };
      }),
    };
    const dependencies = {
      DecisionModel,
      WorkOrderModel,
      LearningModel,
      auditWriter: vi.fn(async () => ({})),
    };
    const first = await PerformanceLearningService.createLearningWorkOrder(
      {
        learning,
        sourceWorkOrderId: objectId("02"),
        latestSnapshot: { blogId: objectId("01") },
      },
      dependencies,
    );
    const second = await PerformanceLearningService.createLearningWorkOrder(
      {
        learning,
        sourceWorkOrderId: objectId("02"),
        latestSnapshot: { blogId: objectId("01") },
      },
      dependencies,
    );
    expect(String(first._id)).toBe(String(second._id));
    expect(decisionInsertCount).toBe(1);
    expect(workOrderInsertCount).toBe(1);
    expect(first).toMatchObject({
      decision: "update",
      status: "planned",
      targetBlogId: objectId("01"),
    });
    expect(first.metadata).toMatchObject({ source: "content_learning" });
    const claimToken =
      LearningModel.findOneAndUpdate.mock.calls[0][1].$set.lockedBy;
    expect(claimToken).toMatch(/^content-learning:/);
    expect(LearningModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      _id: objectId("14"),
      generatedWorkOrderId: null,
      status: { $in: ["proposed", "converted"] },
    });
    expect(LearningModel.updateOne).toHaveBeenCalledWith(
      {
        _id: objectId("14"),
        lockedBy: claimToken,
        status: { $in: ["proposed", "converted"] },
      },
      {
        $set: expect.objectContaining({
          status: "converted",
          generatedWorkOrderId: objectId("13"),
          lockedBy: "",
        }),
      },
    );
  });
});
