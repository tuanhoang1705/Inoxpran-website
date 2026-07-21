import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  PerformanceLearningService,
  createMonitoringLeaseHeartbeat,
} = require("../src/services/contentOperations/performanceLearning.service");
const {
  GoogleIntelligenceService,
  createGoogleScheduleLeaseHeartbeat,
} = require("../src/services/googleIntelligence.service");
const {
  GoogleIntelligenceSchedule,
} = require("../src/models/googleIntelligenceSchedule.model");
const {
  ContentWorkOrderService,
} = require("../src/services/contentOperations/workOrder.service");

const objectId = (suffix) => `507f1f77bcf86cd7994392${suffix}`;
const noOpHeartbeat = () => ({
  beat: vi.fn(async () => true),
  stop: vi.fn(async () => {}),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Content monitoring lease ownership", () => {
  it("uses a unique claim token per invocation and guards completion with it", async () => {
    vi.stubEnv("CONTENT_OPERATIONS_ENABLED", "true");
    vi.stubEnv("CONTENT_PERFORMANCE_MONITORING_ENABLED", "true");
    vi.stubEnv("CONTENT_LEARNING_ENABLED", "false");
    const claimOwners = [];
    const terminalFilters = [];
    const TaskModel = {
      findOneAndUpdate: vi.fn(async (_filter, update) => {
        claimOwners.push(update.$set.lockedBy);
        return {
          _id: objectId(String(claimOwners.length).padStart(2, "0")),
          blogId: objectId("10"),
          contentWorkOrderId: objectId("11"),
          window: "7d",
          lockedBy: update.$set.lockedBy,
          claimGeneration: 1,
        };
      }),
      updateOne: vi.fn(async (filter) => {
        terminalFilters.push(filter);
        return { matchedCount: 1, modifiedCount: 1 };
      }),
    };
    const SnapshotModel = {
      findOneAndUpdate: vi.fn(async (_filter, update) => ({
        _id: objectId("20"),
        ...update.$set,
      })),
    };
    const dependencies = {
      TaskModel,
      SnapshotModel,
      collectSources: vi.fn(async () => ({ searchConsole: {}, analytics: {} })),
      heartbeatFactory: noOpHeartbeat,
    };

    await PerformanceLearningService.runDueOnce(
      { workerId: "monitor-a" },
      dependencies,
    );
    await PerformanceLearningService.runDueOnce(
      { workerId: "monitor-a" },
      dependencies,
    );

    expect(claimOwners[0]).toMatch(/^monitor-a:/);
    expect(claimOwners[1]).toMatch(/^monitor-a:/);
    expect(claimOwners[0]).not.toBe(claimOwners[1]);
    expect(terminalFilters[0]).toMatchObject({
      status: "running",
      lockedBy: claimOwners[0],
    });
    expect(terminalFilters[1]).toMatchObject({
      status: "running",
      lockedBy: claimOwners[1],
    });
  });

  it("does not report success after a stale owner loses the terminal compare-and-set", async () => {
    vi.stubEnv("CONTENT_OPERATIONS_ENABLED", "true");
    vi.stubEnv("CONTENT_PERFORMANCE_MONITORING_ENABLED", "true");
    vi.stubEnv("CONTENT_LEARNING_ENABLED", "false");
    const TaskModel = {
      findOneAndUpdate: vi.fn(async (_filter, update) => ({
        _id: objectId("01"),
        blogId: objectId("10"),
        contentWorkOrderId: objectId("11"),
        window: "7d",
        lockedBy: update.$set.lockedBy,
        claimGeneration: 1,
      })),
      updateOne: vi.fn(async () => ({ matchedCount: 0, modifiedCount: 0 })),
    };
    const SnapshotModel = {
      findOneAndUpdate: vi.fn(async (_filter, update) => ({
        _id: objectId("20"),
        ...update.$set,
      })),
    };

    await expect(
      PerformanceLearningService.runDueOnce(
        { workerId: "stale-monitor" },
        {
          TaskModel,
          SnapshotModel,
          collectSources: vi.fn(async () => ({
            searchConsole: {},
            analytics: {},
          })),
          heartbeatFactory: noOpHeartbeat,
        },
      ),
    ).rejects.toThrow("monitoring_task_lease_lost");
    expect(TaskModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        lockedBy: expect.stringMatching(/^stale-monitor:/),
      }),
      expect.any(Object),
    );
  });

  it("stores only a bounded code when monitoring source collection fails", async () => {
    vi.stubEnv("CONTENT_OPERATIONS_ENABLED", "true");
    vi.stubEnv("CONTENT_PERFORMANCE_MONITORING_ENABLED", "true");
    vi.stubEnv("CONTENT_LEARNING_ENABLED", "false");
    const TaskModel = {
      findOneAndUpdate: vi.fn(async (_filter, update) => ({
        _id: objectId("01"),
        blogId: objectId("10"),
        contentWorkOrderId: objectId("11"),
        window: "7d",
        lockedBy: update.$set.lockedBy,
        claimGeneration: 1,
      })),
      updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    };

    await expect(
      PerformanceLearningService.runDueOnce(
        { workerId: "monitor-a" },
        {
          TaskModel,
          collectSources: vi.fn(async () => {
            throw new Error("mongodb://user:password@private.invalid/db");
          }),
          heartbeatFactory: noOpHeartbeat,
        },
      ),
    ).rejects.toThrow();

    const terminal = TaskModel.updateOne.mock.calls.at(-1);
    expect(terminal?.[1]?.$set?.lastError).toBe(
      "PERFORMANCE_MONITORING_FAILED",
    );
    expect(JSON.stringify(terminal)).not.toContain("password");
  });

  it("heartbeats only the running task owned by the current token", async () => {
    const TaskModel = {
      updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    };
    const heartbeat = createMonitoringLeaseHeartbeat({
      TaskModel,
      taskId: objectId("01"),
      ownerToken: "monitor-a:claim-1",
      claimGeneration: 1,
      clock: () => new Date("2026-07-20T10:00:00.000Z"),
      setIntervalFn: vi.fn(() => ({ unref: vi.fn() })),
      clearIntervalFn: vi.fn(),
    });

    expect(await heartbeat.beat()).toBe(true);
    await heartbeat.stop();
    expect(TaskModel.updateOne).toHaveBeenCalledWith(
      {
        _id: objectId("01"),
        status: "running",
        lockedBy: "monitor-a:claim-1",
        claimGeneration: 1,
      },
      { $set: { leaseUntil: expect.any(Date) } },
    );
  });
});

describe("Google Intelligence schedule lease ownership", () => {
  it("uses a unique owner token even when the scheduler worker id is reused", async () => {
    vi.stubEnv("GOOGLE_INTELLIGENCE_ENABLED", "true");
    vi.spyOn(
      GoogleIntelligenceService,
      "getOrCreateSchedule",
    ).mockResolvedValue({});
    const owners = [];
    vi.spyOn(GoogleIntelligenceSchedule, "findOneAndUpdate").mockImplementation(
      (_filter, update) => ({
        lean: vi.fn(async () => {
          owners.push(update.$set.lockedBy);
          return { _id: objectId("30"), lockedBy: update.$set.lockedBy };
        }),
      }),
    );

    await GoogleIntelligenceService.claimDueSchedule({ workerId: "google-a" });
    await GoogleIntelligenceService.claimDueSchedule({ workerId: "google-a" });

    expect(owners[0]).toMatch(/^google-a:/);
    expect(owners[1]).toMatch(/^google-a:/);
    expect(owners[0]).not.toBe(owners[1]);
  });

  it("guards successful and failed terminal schedule writes with the claim token", async () => {
    const now = new Date("2026-07-20T10:00:00.000Z");
    const schedule = {
      _id: objectId("30"),
      lockedBy: "google-a:claim-1",
      timezone: "Asia/Ho_Chi_Minh",
      scheduleType: "interval",
      interval: { value: 24, unit: "hours" },
      nextRunAt: now,
    };
    vi.spyOn(GoogleIntelligenceService, "claimDueSchedule").mockResolvedValue(
      schedule,
    );
    vi.spyOn(GoogleIntelligenceService, "executeWorkflow").mockResolvedValue({
      snapshot: { status: "completed_no_change" },
    });
    const ScheduleModel = {
      updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    };

    await GoogleIntelligenceService.runDueOnce(
      { workerId: "google-a", now },
      { ScheduleModel, heartbeatFactory: noOpHeartbeat },
    );

    expect(ScheduleModel.updateOne).toHaveBeenCalledWith(
      { _id: schedule._id, lockedBy: schedule.lockedBy },
      expect.objectContaining({
        $set: expect.objectContaining({
          lastRunStatus: "completed_no_change",
          lockedBy: "",
        }),
      }),
    );
  });

  it("stores only a bounded code when the Google schedule workflow fails", async () => {
    const now = new Date("2026-07-20T10:00:00.000Z");
    const schedule = {
      _id: objectId("30"),
      lockedBy: "google-a:claim-secret-safe",
      timezone: "Asia/Ho_Chi_Minh",
      scheduleType: "interval",
      interval: { value: 24, unit: "hours" },
      nextRunAt: now,
    };
    vi.spyOn(GoogleIntelligenceService, "claimDueSchedule").mockResolvedValue(
      schedule,
    );
    vi.spyOn(GoogleIntelligenceService, "executeWorkflow").mockRejectedValue(
      new Error("https://google.invalid/feed?token=secret-value"),
    );
    const ScheduleModel = {
      updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    };

    await expect(
      GoogleIntelligenceService.runDueOnce(
        { workerId: "google-a", now },
        { ScheduleModel, heartbeatFactory: noOpHeartbeat },
      ),
    ).rejects.toThrow();

    const terminal = ScheduleModel.updateOne.mock.calls.at(-1);
    expect(terminal?.[0]).toMatchObject({
      _id: schedule._id,
      lockedBy: schedule.lockedBy,
    });
    expect(terminal?.[1]?.$set?.lastError).toBe(
      "GOOGLE_INTELLIGENCE_SCHEDULE_FAILED",
    );
    expect(JSON.stringify(terminal)).not.toContain("secret-value");
  });

  it("heartbeats only the schedule owned by the current token", async () => {
    const ScheduleModel = {
      updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    };
    const heartbeat = createGoogleScheduleLeaseHeartbeat({
      ScheduleModel,
      scheduleId: objectId("30"),
      ownerToken: "google-a:claim-1",
      clock: () => new Date("2026-07-20T10:00:00.000Z"),
      setIntervalFn: vi.fn(() => ({ unref: vi.fn() })),
      clearIntervalFn: vi.fn(),
    });

    expect(await heartbeat.beat()).toBe(true);
    await heartbeat.stop();
    expect(ScheduleModel.updateOne).toHaveBeenCalledWith(
      { _id: objectId("30"), lockedBy: "google-a:claim-1" },
      { $set: { leaseUntil: expect.any(Date) } },
    );
  });
});

describe("Content Work Order lease ownership", () => {
  it("creates unique claim tokens and offers owner-guarded renew and terminal transitions", async () => {
    const claims = [];
    const WorkOrderModel = {
      findOneAndUpdate: vi.fn(async (filter, update) => {
        if (filter.status === "drafting")
          return { _id: objectId("40"), ...update.$set };
        claims.push(update.$set["metadata.activeClaimToken"]);
        return {
          _id: objectId("40"),
          metadata: {
            activeClaimToken: update.$set["metadata.activeClaimToken"],
          },
        };
      }),
      updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    };

    await ContentWorkOrderService.claimForProduction({
      workOrderId: objectId("40"),
      workerId: "writer-a",
      WorkOrderModel,
    });
    await ContentWorkOrderService.claimForProduction({
      workOrderId: objectId("40"),
      workerId: "writer-a",
      WorkOrderModel,
    });
    expect(claims[0]).toMatch(/^writer-a:/);
    expect(claims[1]).toMatch(/^writer-a:/);
    expect(claims[0]).not.toBe(claims[1]);

    expect(
      await ContentWorkOrderService.renewProductionClaim({
        workOrderId: objectId("40"),
        claimToken: claims[0],
        WorkOrderModel,
      }),
    ).toBe(true);
    expect(WorkOrderModel.updateOne).toHaveBeenCalledWith(
      {
        _id: objectId("40"),
        status: "drafting",
        "metadata.activeClaimToken": claims[0],
      },
      { $set: { lockedAt: expect.any(Date) } },
    );

    await ContentWorkOrderService.transitionClaimed({
      workOrderId: objectId("40"),
      claimToken: claims[0],
      status: "reviewing",
      WorkOrderModel,
    });
    expect(WorkOrderModel.findOneAndUpdate).toHaveBeenLastCalledWith(
      {
        _id: objectId("40"),
        status: "drafting",
        "metadata.activeClaimToken": claims[0],
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "reviewing",
          "metadata.activeClaimToken": "",
        }),
      }),
      { new: true, runValidators: true },
    );
  });

  it("fails closed for tokenless or stale execution writes after a claimed Work Order is reclaimed", async () => {
    const state = {
      _id: objectId("40"),
      status: "drafting",
      lockedAt: new Date("2026-07-20T09:00:00.000Z"),
      metadata: {
        activeClaimToken: "writer-b:current",
        activePlanningCorrelationId: "planning-1",
        activeExecutionId: objectId("41"),
      },
      artifactIds: {},
    };
    const matches = (filter) => {
      if (String(filter._id) !== String(state._id)) return false;
      if (typeof filter.status === "string" && filter.status !== state.status)
        return false;
      if (
        filter["metadata.activePlanningCorrelationId"] !== undefined &&
        filter["metadata.activePlanningCorrelationId"] !==
          state.metadata.activePlanningCorrelationId
      )
        return false;
      if (
        filter["metadata.activeClaimToken"] !== undefined &&
        filter["metadata.activeClaimToken"] !== state.metadata.activeClaimToken
      )
        return false;
      if (filter.$or) {
        const isUnclaimed = !state.metadata.activeClaimToken;
        if (!isUnclaimed) return false;
      }
      return true;
    };
    const applySet = (set = {}) => {
      for (const [key, value] of Object.entries(set)) {
        if (key === "metadata.activeClaimToken")
          state.metadata.activeClaimToken = value;
        else if (key === "metadata.activeExecutionId")
          state.metadata.activeExecutionId = value;
        else if (key.startsWith("artifactIds."))
          state.artifactIds[key.slice("artifactIds.".length)] = value;
        else state[key] = value;
      }
      return structuredClone(state);
    };
    const WorkOrderModel = {
      findOneAndUpdate: vi.fn(async (filter, update) =>
        matches(filter) ? applySet(update.$set) : null,
      ),
    };

    await expect(
      ContentWorkOrderService.bindExecution({
        workOrderId: state._id,
        planningCorrelationId: "planning-1",
        executionId: objectId("42"),
        WorkOrderModel,
      }),
    ).resolves.toBeNull();
    await expect(
      ContentWorkOrderService.bindExecution({
        workOrderId: state._id,
        planningCorrelationId: "planning-1",
        executionId: objectId("42"),
        claimToken: "writer-a:stale",
        WorkOrderModel,
      }),
    ).resolves.toBeNull();
    await expect(
      ContentWorkOrderService.attachArtifact({
        workOrderId: state._id,
        artifactType: "strategyPlanId",
        artifactId: objectId("43"),
        claimToken: "writer-a:stale",
        WorkOrderModel,
      }),
    ).resolves.toBeNull();
    await expect(
      ContentWorkOrderService.transitionClaimed({
        workOrderId: state._id,
        claimToken: "writer-a:stale",
        status: "completed",
        WorkOrderModel,
      }),
    ).resolves.toBeNull();

    expect(state.metadata.activeExecutionId).toBe(objectId("41"));
    expect(state.artifactIds).toEqual({});
    expect(state.status).toBe("drafting");

    const transitioned = await ContentWorkOrderService.transitionClaimed({
      workOrderId: state._id,
      claimToken: "writer-b:current",
      status: "reviewing",
      updates: { "artifactIds.publishReadinessReportId": objectId("44") },
      WorkOrderModel,
    });
    expect(transitioned).toMatchObject({
      status: "reviewing",
      metadata: { activeClaimToken: "" },
      artifactIds: { publishReadinessReportId: objectId("44") },
    });
  });

  it("keeps legacy unclaimed writes compatible without allowing them onto an active claim", async () => {
    const calls = [];
    const WorkOrderModel = {
      findOneAndUpdate: vi.fn(async (filter, update) => {
        calls.push({ filter, update });
        return {
          _id: objectId("40"),
          status: update.$set.status || "drafting",
        };
      }),
    };

    await ContentWorkOrderService.bindExecution({
      workOrderId: objectId("40"),
      planningCorrelationId: "legacy-plan",
      executionId: objectId("41"),
      WorkOrderModel,
    });
    await ContentWorkOrderService.attachArtifact({
      workOrderId: objectId("40"),
      artifactType: "strategyPlanId",
      artifactId: objectId("42"),
      WorkOrderModel,
    });
    await ContentWorkOrderService.transitionUnclaimed({
      workOrderId: objectId("40"),
      status: "reviewing",
      WorkOrderModel,
    });

    for (const { filter } of calls) {
      expect(filter.$or).toEqual([
        { "metadata.activeClaimToken": { $exists: false } },
        { "metadata.activeClaimToken": { $in: [null, ""] } },
      ]);
    }
  });

  it("fences late success and failure writes when an execution claim is replaced", async () => {
    const workOrderId = objectId("50");
    const executionId = objectId("51");
    const state = {
      _id: executionId,
      contentWorkOrderId: workOrderId,
      status: "running",
      completedAt: null,
      metadata: { contentWorkOrderClaimToken: "writer-b:current" },
    };
    const ExecutionModel = {
      updateOne: vi.fn(async (filter, update) => {
        const matched =
          String(filter._id) === String(state._id) &&
          String(filter.contentWorkOrderId) ===
            String(state.contentWorkOrderId) &&
          filter.status === state.status &&
          filter["metadata.contentWorkOrderClaimToken"] ===
            state.metadata.contentWorkOrderClaimToken;
        if (!matched) return { matchedCount: 0, modifiedCount: 0 };
        for (const [key, value] of Object.entries(update.$set || {})) {
          if (key === "metadata.contentWorkOrderClaimToken") {
            state.metadata.contentWorkOrderClaimToken = value;
          } else {
            state[key] = value;
          }
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }),
    };

    await expect(
      ContentWorkOrderService.transitionExecutionClaimed({
        executionId,
        workOrderId,
        claimToken: "writer-a:stale",
        status: "failed",
        ExecutionModel,
      }),
    ).resolves.toBe(false);
    await expect(
      ContentWorkOrderService.transitionExecutionClaimed({
        executionId,
        workOrderId,
        claimToken: "writer-b:current",
        status: "draft_created",
        ExecutionModel,
      }),
    ).resolves.toBe(true);
    await expect(
      ContentWorkOrderService.transitionExecutionClaimed({
        executionId,
        workOrderId,
        claimToken: "writer-a:stale",
        status: "failed",
        ExecutionModel,
      }),
    ).resolves.toBe(false);

    expect(state).toMatchObject({
      status: "draft_created",
      completedAt: expect.any(Date),
      metadata: { contentWorkOrderClaimToken: "" },
    });
  });

  it("binds the active Work Order claim into the execution without allowing replacement", async () => {
    const workOrderId = objectId("53");
    const executionId = objectId("54");
    const state = {
      contentWorkOrderId: null,
      status: "running",
      metadata: { contentWorkOrderClaimToken: "" },
    };
    const ExecutionModel = {
      updateOne: vi.fn(async (filter, update) => {
        const [workOrderClause, tokenClause] = filter.$and;
        const workOrderMatches = workOrderClause.$or.some(
          (entry) =>
            Object.prototype.hasOwnProperty.call(entry, "contentWorkOrderId") &&
            (entry.contentWorkOrderId === state.contentWorkOrderId ||
              String(entry.contentWorkOrderId || "") ===
                String(state.contentWorkOrderId || "")),
        );
        const tokenMatches = tokenClause.$or.some((entry) => {
          const condition = entry["metadata.contentWorkOrderClaimToken"];
          if (typeof condition === "string") {
            return condition === state.metadata.contentWorkOrderClaimToken;
          }
          if (condition?.$exists === false) return false;
          return condition?.$in?.includes(
            state.metadata.contentWorkOrderClaimToken,
          );
        });
        if (!workOrderMatches || !tokenMatches)
          return { matchedCount: 0, modifiedCount: 0 };
        state.contentWorkOrderId = update.$set.contentWorkOrderId;
        state.metadata.contentWorkOrderClaimToken =
          update.$set["metadata.contentWorkOrderClaimToken"];
        return { matchedCount: 1, modifiedCount: 1 };
      }),
    };

    await expect(
      ContentWorkOrderService.bindExecutionClaim({
        executionId,
        workOrderId,
        claimToken: "writer-a:claim",
        ExecutionModel,
      }),
    ).resolves.toBe(true);
    await expect(
      ContentWorkOrderService.bindExecutionClaim({
        executionId,
        workOrderId,
        claimToken: "writer-b:claim",
        ExecutionModel,
      }),
    ).resolves.toBe(false);
    await expect(
      ContentWorkOrderService.bindExecutionClaim({
        executionId,
        workOrderId,
        claimToken: "writer-a:claim",
        ExecutionModel,
      }),
    ).resolves.toBe(true);

    expect(state).toEqual({
      contentWorkOrderId: workOrderId,
      status: "running",
      metadata: { contentWorkOrderClaimToken: "writer-a:claim" },
    });
  });

  it("keeps tokenless execution completion only for an explicitly unclaimed legacy run", async () => {
    const calls = [];
    const ExecutionModel = {
      updateOne: vi.fn(async (filter) => {
        calls.push(filter);
        const explicitlyUnclaimed = filter.$or?.some(
          (entry) =>
            entry["metadata.contentWorkOrderClaimToken"]?.$exists === false,
        );
        return explicitlyUnclaimed
          ? { matchedCount: 1, modifiedCount: 1 }
          : { matchedCount: 0, modifiedCount: 0 };
      }),
    };

    await expect(
      ContentWorkOrderService.transitionExecutionUnclaimed({
        executionId: objectId("52"),
        status: "draft_created",
        ExecutionModel,
      }),
    ).resolves.toBe(true);

    expect(calls[0]).toEqual({
      _id: objectId("52"),
      status: { $in: ["running"] },
      $or: [
        { "metadata.contentWorkOrderClaimToken": { $exists: false } },
        {
          "metadata.contentWorkOrderClaimToken": { $in: [null, ""] },
        },
      ],
    });
  });

  it("fails closed when a database adapter omits ownership match counts", async () => {
    const ExecutionModel = {
      updateOne: vi.fn(async () => ({ acknowledged: true })),
    };
    const WorkOrderModel = {
      updateOne: vi.fn(async () => ({ acknowledged: true })),
    };

    await expect(
      ContentWorkOrderService.transitionExecutionClaimed({
        executionId: objectId("55"),
        workOrderId: objectId("56"),
        claimToken: "writer:claim",
        status: "failed",
        ExecutionModel,
      }),
    ).resolves.toBe(false);
    await expect(
      ContentWorkOrderService.renewProductionClaim({
        workOrderId: objectId("56"),
        claimToken: "writer:claim",
        WorkOrderModel,
      }),
    ).resolves.toBe(false);
  });
});
