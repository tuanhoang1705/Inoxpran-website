import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Module } = require("node:module");

const ORIGINAL_ENV = { ...process.env };
const SCHEDULE_ID = "507f1f77bcf86cd799439181";
const RUN_ID = "507f1f77bcf86cd799439182";

const scheduleMock = {
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn(),
};
const runMock = {
  findOne: vi.fn(),
  countDocuments: vi.fn(),
  updateOne: vi.fn(),
};
const planMock = vi.fn();
const compensateMock = vi.fn();

const installMock = (modulePath, exports) => {
  const resolvedPath = require.resolve(modulePath);
  const mockModule = new Module(resolvedPath);
  mockModule.exports = exports;
  require.cache[resolvedPath] = mockModule;
};

installMock("../src/models/contentOperationsSchedule.model", {
  ContentOperationsSchedule: scheduleMock,
});
installMock("../src/models/contentOperationsRun.model", {
  ContentOperationsRun: runMock,
});
installMock(
  "../src/services/contentOperations/contentOperationsPlanning.service",
  {
    ContentOperationsPlanningService: class ContentOperationsPlanningService {
      plan(input) {
        return planMock(input);
      }

      compensateRun(input) {
        return compensateMock(input);
      }
    },
  },
);

delete require.cache[
  require.resolve("../src/services/contentOperations/contentOperationsSchedule.service")
];
const {
  ContentOperationsScheduleService,
  buildContentOperationsRealTaskCountQuery,
  getContentOperationsScheduleDayBounds,
} = require("../src/services/contentOperations/contentOperationsSchedule.service");

const baseSchedule = (overrides = {}) => ({
  _id: SCHEDULE_ID,
  singletonKey: "default",
  enabled: true,
  name: "Content Operations daily plan",
  scheduleType: "daily",
  timezone: "Asia/Ho_Chi_Minh",
  daily: { times: ["06:30"] },
  interval: { value: 24, unit: "hours" },
  mode: "fixed_brief",
  topic: "Cách chọn nồi inox an toàn",
  primaryKeyword: "nồi inox an toàn",
  sourceRequirements: ["content_inventory"],
  minimumOpportunityScore: 0.65,
  allowSkip: true,
  maximumTasksPerDay: 1,
  nextRunAt: new Date("2026-07-19T23:30:00.000Z"),
  ...overrides,
});

const leanResult = (value) => ({ lean: vi.fn().mockResolvedValue(value) });

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    CONTENT_OPERATIONS_ENABLED: "true",
    CONTENT_OPERATIONS_CRON_ENABLED: "true",
    CONTENT_OPERATIONS_LEASE_MS: "30000",
  };
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-20T12:00:00.000Z"));
  scheduleMock.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  runMock.findOne.mockReturnValue(leanResult(null));
  runMock.countDocuments.mockResolvedValue(0);
  runMock.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  compensateMock.mockResolvedValue(true);
  planMock.mockResolvedValue({
    runId: RUN_ID,
    skipped: false,
    blocked: false,
    contentWorkOrderId: "507f1f77bcf86cd799439183",
    missingRequiredSources: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("ContentOperationsScheduleService concurrency and recovery", () => {
  it("uses the schedule local calendar day and counts only real non-skip planning tasks", () => {
    const schedule = baseSchedule();
    const now = new Date("2026-07-20T18:00:00.000Z"); // 01:00 on July 21 in Ho Chi Minh City
    const bounds = getContentOperationsScheduleDayBounds({ schedule, now });
    const query = buildContentOperationsRealTaskCountQuery({ schedule, now });

    expect(bounds.start.toISOString()).toBe("2026-07-20T17:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-07-21T17:00:00.000Z");
    expect(query.createdAt).toEqual({ $gte: bounds.start, $lt: bounds.end });
    expect(query.selectedDecision).toEqual({
      $exists: true,
      $nin: ["", "skip", null],
    });
    expect(query.contentWorkOrderId).toEqual({ $ne: null });
    expect(query.status.$in).not.toContain("skipped");
  });

  it("claims with a unique ownership token, forwards fixed-brief input and uses a due-slot execution key", async () => {
    const lockOwners = [];
    scheduleMock.findOneAndUpdate.mockImplementation((_filter, update) => {
      lockOwners.push(update.$set.lockedBy);
      return leanResult(baseSchedule({ lockedBy: update.$set.lockedBy }));
    });

    const first = await ContentOperationsScheduleService.runDueOnce({
      workerId: "worker-a",
      now: new Date(),
    });
    const second = await ContentOperationsScheduleService.runDueOnce({
      workerId: "worker-a",
      now: new Date(),
    });

    expect(first.status).toBe("planned");
    expect(lockOwners[0]).toMatch(/^worker-a:/);
    expect(lockOwners[1]).toMatch(/^worker-a:/);
    expect(lockOwners[0]).not.toBe(lockOwners[1]);
    const firstPlan = planMock.mock.calls[0][0];
    expect(firstPlan).toMatchObject({
      trigger: "scheduled",
      executionKey: `content-operations-schedule:${SCHEDULE_ID}:2026-07-19T23:30:00.000Z`,
      input: {
        mode: "fixed_brief",
        topic: "Cách chọn nồi inox an toàn",
        primaryKeyword: "nồi inox an toàn",
        draftOnly: true,
      },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("guards heartbeat and completion writes with the exact lease owner", async () => {
    let resolvePlan;
    planMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePlan = resolve;
        }),
    );
    let claimedOwner = "";
    scheduleMock.findOneAndUpdate.mockImplementation((_filter, update) => {
      claimedOwner = update.$set.lockedBy;
      return leanResult(baseSchedule({ lockedBy: claimedOwner }));
    });

    const pending = ContentOperationsScheduleService.runDueOnce({
      workerId: "worker-heartbeat",
      now: new Date(),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(scheduleMock.updateOne).toHaveBeenCalledWith(
      {
        _id: SCHEDULE_ID,
        lockedBy: claimedOwner,
        leaseUntil: { $gt: expect.any(Date) },
      },
      { $set: { leaseUntil: expect.any(Date) } },
    );
    resolvePlan({ skipped: true, blocked: false, missingRequiredSources: [] });
    await pending;

    const completion = scheduleMock.updateOne.mock.calls.at(-1);
    expect(completion[0]).toEqual({
      _id: SCHEDULE_ID,
      lockedBy: claimedOwner,
      leaseUntil: { $gt: expect.any(Date) },
    });
    expect(completion[1].$unset).toEqual({ leaseUntil: "", lockedBy: "" });
    expect(completion[1].$set.enabled).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers a stale deterministic run without planning the same due slot again", async () => {
    scheduleMock.findOneAndUpdate.mockImplementation((_filter, update) =>
      leanResult(baseSchedule({ lockedBy: update.$set.lockedBy })),
    );
    runMock.findOne.mockReturnValue(
      leanResult({
        _id: RUN_ID,
        status: "running",
        leaseOwner: "old-worker:stale-claim",
        leaseUntil: new Date("2026-07-20T11:59:00.000Z"),
      }),
    );

    const result = await ContentOperationsScheduleService.runDueOnce({
      workerId: "worker-recovery",
      now: new Date(),
    });

    expect(result).toMatchObject({
      skipped: true,
      reason: "duplicate_run_recovered",
      runId: RUN_ID,
    });
    expect(planMock).not.toHaveBeenCalled();
    expect(compensateMock).toHaveBeenCalledWith({
      runId: RUN_ID,
      ownerToken: "old-worker:stale-claim",
      reasonCode: "STALE_SCHEDULE_LEASE_RECOVERED",
    });
    expect(runMock.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: RUN_ID,
        status: "running",
        $or: expect.arrayContaining([
          { leaseUntil: null },
          { leaseUntil: { $lte: expect.any(Date) } },
        ]),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: "failed" }),
      }),
    );
    expect(scheduleMock.updateOne.mock.calls.at(-1)[0]).toEqual({
      _id: SCHEDULE_ID,
      lockedBy: expect.stringMatching(/^worker-recovery:/),
      leaseUntil: { $gt: expect.any(Date) },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not recover or advance a running deterministic run while its lease is live", async () => {
    scheduleMock.findOneAndUpdate.mockImplementation((_filter, update) =>
      leanResult(baseSchedule({ lockedBy: update.$set.lockedBy })),
    );
    runMock.findOne.mockReturnValue(
      leanResult({
        _id: RUN_ID,
        status: "running",
        leaseUntil: new Date("2026-07-20T12:01:00.000Z"),
      }),
    );

    const result = await ContentOperationsScheduleService.runDueOnce({
      workerId: "worker-observer",
      now: new Date(),
    });

    expect(result).toMatchObject({
      skipped: true,
      reason: "run_in_progress",
      runId: RUN_ID,
      nextRunAt: new Date("2026-07-19T23:30:00.000Z"),
    });
    expect(runMock.updateOne).not.toHaveBeenCalled();
    expect(planMock).not.toHaveBeenCalled();
    const release = scheduleMock.updateOne.mock.calls.at(-1);
    expect(release[1].$set).toEqual({
      lastRunStatus: "running",
      lastError: "",
    });
    expect(release[1].$set.nextRunAt).toBeUndefined();
    expect(release[1].$set.lastRunAt).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails closed instead of returning planned when terminal schedule ownership is lost", async () => {
    scheduleMock.findOneAndUpdate.mockImplementation((_filter, update) =>
      leanResult(baseSchedule({ lockedBy: update.$set.lockedBy })),
    );
    scheduleMock.updateOne.mockImplementation((_filter, update) => {
      if (
        update?.$set?.lastRunStatus === "planned" &&
        update?.$unset?.lockedBy !== undefined
      ) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });

    await expect(
      ContentOperationsScheduleService.runDueOnce({
        workerId: "worker-stale",
        now: new Date(),
      }),
    ).rejects.toMatchObject({ code: "CONTENT_OPERATIONS_SCHEDULE_LEASE_LOST" });

    expect(planMock).toHaveBeenCalledOnce();
    expect(compensateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: RUN_ID,
        reasonCode: "CONTENT_OPERATIONS_SCHEDULE_LEASE_LOST",
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not advance a due slot when a duplicate-key race reveals another live run", async () => {
    scheduleMock.findOneAndUpdate.mockImplementation((_filter, update) =>
      leanResult(baseSchedule({ lockedBy: update.$set.lockedBy })),
    );
    runMock.findOne.mockReturnValueOnce(leanResult(null)).mockReturnValueOnce(
      leanResult({
        _id: RUN_ID,
        status: "running",
        leaseOwner: "winner:claim",
        leaseUntil: new Date("2026-07-20T12:01:00.000Z"),
      }),
    );
    const duplicateError = new Error("duplicate execution key");
    duplicateError.code = 11000;
    planMock.mockRejectedValueOnce(duplicateError);

    const result = await ContentOperationsScheduleService.runDueOnce({
      workerId: "loser",
      now: new Date(),
    });

    expect(result).toMatchObject({ reason: "run_in_progress", runId: RUN_ID });
    const release = scheduleMock.updateOne.mock.calls.at(-1)[1];
    expect(release.$set.nextRunAt).toBeUndefined();
    expect(runMock.updateOne).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
