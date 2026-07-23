"use strict";

const crypto = require("node:crypto");
const {
  calculateNextRun,
  getZonedParts,
  zonedTimeToUtc,
} = require("../../utils/blogSchedule.util");
const {
  ContentOperationsSchedule,
} = require("../../models/contentOperationsSchedule.model");
const {
  ContentOperationsRun,
} = require("../../models/contentOperationsRun.model");
const { safeErrorCode } = require("../../utils/httpError.util");
const { qaScopeFilter } = require("../../utils/qaProvenance.util");
const {
  ContentOperationsPlanningService,
} = require("./contentOperationsPlanning.service");
const {
  getContentOperationsConfig,
} = require("../../config/contentOperations.config");

const isEnabled = () => {
  const config = getContentOperationsConfig();
  return config.enabled && config.cronEnabled;
};

const nextRunFor = (schedule, now) =>
  calculateNextRun({
    schedule: { ...schedule, enabled: true, lastRunAt: now },
    from: now,
  });

const buildLeaseOwner = (workerId) =>
  `${String(workerId || `content-operations-${process.pid}`).slice(0, 120)}:${crypto.randomUUID()}`;

const getScheduleDayBounds = ({ schedule = {}, now = new Date() } = {}) => {
  const timezone = schedule.timezone || "Asia/Ho_Chi_Minh";
  const local = getZonedParts(now, timezone);
  return {
    start: zonedTimeToUtc({
      year: local.year,
      month: local.month,
      day: local.day,
      timeZone: timezone,
    }),
    end: zonedTimeToUtc({
      year: local.year,
      month: local.month,
      day: local.day + 1,
      timeZone: timezone,
    }),
  };
};

const buildRealTaskCountQuery = ({ schedule, now }) => {
  const bounds = getScheduleDayBounds({ schedule, now });
  return {
    ...qaScopeFilter(null),
    qaBatchId: null,
    qaCaseId: null,
    environment: { $in: [null, ""] },
    executionMode: { $in: [null, ""] },
    originalTopicSeed: { $in: [null, ""] },
    normalizedTopicKey: { $in: [null, ""] },
    trigger: "scheduled",
    createdAt: { $gte: bounds.start, $lt: bounds.end },
    status: { $in: ["running", "completed", "partial", "blocked", "failed"] },
    contentWorkOrderId: { $ne: null },
    selectedDecision: { $exists: true, $nin: ["", "skip", null] },
  };
};

const buildExecutionKey = (schedule) =>
  `content-operations-schedule:${schedule._id || schedule.id}:${new Date(schedule.nextRunAt).toISOString()}`;

const explicitOwnerUpdateFailed = (result) =>
  Number.isFinite(result?.matchedCount)
    ? result.matchedCount === 0
    : result?.modifiedCount === 0;

const scheduleLeaseLostError = () => {
  const error = new Error("Content Operations schedule lease was lost");
  error.code = "CONTENT_OPERATIONS_SCHEDULE_LEASE_LOST";
  return error;
};

const hasLiveRunLease = (run, now = new Date()) => {
  const leaseUntil = new Date(run?.leaseUntil || 0);
  return (
    run?.status === "running" &&
    !Number.isNaN(leaseUntil.getTime()) &&
    leaseUntil > now
  );
};

const createScheduleLeaseHeartbeat = ({
  ScheduleModel = ContentOperationsSchedule,
  scheduleId,
  ownerToken,
  leaseMs,
  heartbeatMs = Math.max(1_000, Math.floor(leaseMs / 3)),
  clock = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) => {
  let stopped = false;
  let ownershipLost = false;
  let pending = Promise.resolve();
  const renew = async () => {
    if (stopped || ownershipLost) return !ownershipLost;
    const heartbeatAt = new Date(clock());
    const result = await ScheduleModel.updateOne(
      {
        _id: scheduleId,
        lockedBy: ownerToken,
        leaseUntil: { $gt: heartbeatAt },
      },
      { $set: { leaseUntil: new Date(heartbeatAt.getTime() + leaseMs) } },
    );
    if (explicitOwnerUpdateFailed(result)) ownershipLost = true;
    return !ownershipLost;
  };
  const timer = setIntervalFn(() => {
    pending = pending.then(renew).catch(() => {
      ownershipLost = true;
    });
  }, heartbeatMs);
  timer?.unref?.();
  return {
    beat: async () => {
      await pending;
      if (stopped || ownershipLost) return false;
      return renew();
    },
    stop: async () => {
      if (!stopped) {
        stopped = true;
        clearIntervalFn(timer);
      }
      await pending;
    },
    ownershipLost: () => ownershipLost,
  };
};

class ContentOperationsScheduleService {
  static async runDueOnce({
    workerId = `content-operations-${process.pid}`,
    now = new Date(),
  } = {}) {
    const config = getContentOperationsConfig();
    if (!config.enabled || !config.cronEnabled) return null;
    const leaseMs = config.leaseMs;
    const lockOwner = buildLeaseOwner(workerId);
    const schedule = await ContentOperationsSchedule.findOneAndUpdate(
      {
        singletonKey: "default",
        enabled: true,
        nextRunAt: { $ne: null, $lte: now },
        $or: [
          { leaseUntil: null },
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          leaseUntil: new Date(now.getTime() + leaseMs),
          lockedBy: lockOwner,
        },
      },
      { new: true },
    ).lean();
    if (!schedule) return null;
    const completeSchedule = ({
      lastRunStatus,
      nextRunAt,
      lastError = "",
      completedAt = new Date(),
    }) =>
      ContentOperationsSchedule.updateOne(
        {
          _id: schedule._id,
          lockedBy: lockOwner,
          leaseUntil: { $gt: completedAt },
        },
        {
          $set: { lastRunAt: completedAt, lastRunStatus, nextRunAt, lastError },
          $unset: { leaseUntil: "", lockedBy: "" },
        },
      );
    const releaseSchedule = (
      releasedAt = new Date(),
      lastRunStatus = "running",
      lastError = "",
    ) =>
      ContentOperationsSchedule.updateOne(
        {
          _id: schedule._id,
          lockedBy: lockOwner,
          leaseUntil: { $gt: releasedAt },
        },
        {
          $set: { lastRunStatus, lastError },
          $unset: { leaseUntil: "", lockedBy: "" },
        },
      );
    const heartbeat = createScheduleLeaseHeartbeat({
      scheduleId: schedule._id,
      ownerToken: lockOwner,
      leaseMs,
    });
    const assertScheduleOwner = async () => {
      if (!(await heartbeat.beat())) throw scheduleLeaseLostError();
      return true;
    };
    let planner = null;
    let planningResult = null;
    try {
      const executionKey = buildExecutionKey(schedule);
      const existingRun = await ContentOperationsRun.findOne({
        executionKey,
      }).lean();
      if (existingRun) {
        if (hasLiveRunLease(existingRun, now)) {
          const released = await releaseSchedule(now);
          if (explicitOwnerUpdateFailed(released))
            throw scheduleLeaseLostError();
          return {
            skipped: true,
            reason: "run_in_progress",
            runId: String(existingRun._id || ""),
            nextRunAt: schedule.nextRunAt,
          };
        }
        let recoveredStatus = existingRun.status || "duplicate";
        if (existingRun.status === "running") {
          const recoveredAt = new Date();
          const recovery = await ContentOperationsRun.updateOne(
            {
              _id: existingRun._id,
              status: "running",
              $or: [
                { leaseUntil: null },
                { leaseUntil: { $exists: false } },
                { leaseUntil: { $lte: recoveredAt } },
                { leaseOwner: "" },
                { leaseOwner: { $exists: false } },
              ],
            },
            {
              $set: {
                status: "failed",
                completedAt: recoveredAt,
                leaseUntil: null,
                lastCheckpoint: "stale_run_recovered",
                errorDetails: [
                  {
                    code: "STALE_SCHEDULE_LEASE_RECOVERED",
                    message:
                      "Recovered a stale deterministic Content Operations run.",
                  },
                ],
              },
            },
          );
          if (explicitOwnerUpdateFailed(recovery)) {
            const released = await releaseSchedule(recoveredAt);
            if (explicitOwnerUpdateFailed(released))
              throw scheduleLeaseLostError();
            return {
              skipped: true,
              reason: "run_in_progress",
              runId: String(existingRun._id || ""),
              nextRunAt: schedule.nextRunAt,
            };
          }
          recoveredStatus = "failed";
          if (existingRun.leaseOwner) {
            planner = new ContentOperationsPlanningService();
            await planner.compensateRun?.({
              runId: existingRun._id,
              ownerToken: existingRun.leaseOwner,
              reasonCode: "STALE_SCHEDULE_LEASE_RECOVERED",
            });
          }
        } else if (
          ["failed", "blocked"].includes(existingRun.status) &&
          existingRun.lastCheckpoint === "compensation_pending" &&
          existingRun.leaseOwner
        ) {
          planner = new ContentOperationsPlanningService();
          await planner.compensateRun?.({
            runId: existingRun._id,
            ownerToken: existingRun.leaseOwner,
            reasonCode: safeErrorCode({
              code:
                existingRun.errorDetails?.[0]?.code ||
                "CONTENT_OPERATIONS_PLANNING_FAILED",
            }),
          });
        }
        const completedAt = new Date();
        const nextRunAt = nextRunFor(schedule, completedAt);
        const completed = await completeSchedule({
          lastRunStatus: recoveredStatus,
          nextRunAt,
          lastError:
            recoveredStatus === "failed"
              ? "STALE_SCHEDULE_LEASE_RECOVERED"
              : "",
          completedAt,
        });
        if (explicitOwnerUpdateFailed(completed))
          throw scheduleLeaseLostError();
        return {
          skipped: true,
          reason: "duplicate_run_recovered",
          runId: String(existingRun._id || ""),
          nextRunAt,
        };
      }
      await assertScheduleOwner();
      const recentRuns = await ContentOperationsRun.countDocuments(
        buildRealTaskCountQuery({ schedule, now }),
      );
      if (recentRuns >= Number(schedule.maximumTasksPerDay || 1)) {
        const completedAt = new Date();
        const nextRunAt = nextRunFor(schedule, completedAt);
        const completed = await completeSchedule({
          lastRunStatus: "daily_limit",
          nextRunAt,
          completedAt,
        });
        if (explicitOwnerUpdateFailed(completed))
          throw scheduleLeaseLostError();
        return {
          skipped: true,
          reason: "maximum_tasks_per_day_reached",
          nextRunAt,
        };
      }
      let result;
      try {
        planner = new ContentOperationsPlanningService();
        result = await planner.plan({
          trigger: "scheduled",
          executionKey,
          lease: {
            ownerToken: lockOwner,
            leaseMs,
            assertOwner: assertScheduleOwner,
          },
          input: {
            mode: schedule.mode,
            topic: schedule.topic || "",
            primaryKeyword: schedule.primaryKeyword || "",
            draftOnly: true,
            sourceRequirements: schedule.sourceRequirements || [],
            minimumOpportunityScore: Number(
              schedule.minimumOpportunityScore ?? 0.65,
            ),
            allowSkip: schedule.allowSkip !== false,
          },
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        const duplicate = await ContentOperationsRun.findOne({
          executionKey,
        }).lean();
        const completedAt = new Date();
        if (hasLiveRunLease(duplicate, completedAt)) {
          const released = await releaseSchedule(completedAt);
          if (explicitOwnerUpdateFailed(released))
            throw scheduleLeaseLostError();
          return {
            skipped: true,
            reason: "run_in_progress",
            runId: String(duplicate?._id || ""),
            nextRunAt: schedule.nextRunAt,
          };
        }
        let duplicateStatus = duplicate?.status || "duplicate";
        if (duplicate?.status === "running") {
          const recovery = await ContentOperationsRun.updateOne(
            {
              _id: duplicate._id,
              status: "running",
              $or: [
                { leaseUntil: null },
                { leaseUntil: { $exists: false } },
                { leaseUntil: { $lte: completedAt } },
                { leaseOwner: "" },
                { leaseOwner: { $exists: false } },
              ],
            },
            {
              $set: {
                status: "failed",
                completedAt,
                leaseUntil: null,
                lastCheckpoint: "stale_run_recovered",
                errorDetails: [
                  {
                    code: "STALE_SCHEDULE_LEASE_RECOVERED",
                    message:
                      "Recovered a stale deterministic Content Operations run.",
                  },
                ],
              },
            },
          );
          if (explicitOwnerUpdateFailed(recovery)) {
            const released = await releaseSchedule(completedAt);
            if (explicitOwnerUpdateFailed(released))
              throw scheduleLeaseLostError();
            return {
              skipped: true,
              reason: "run_in_progress",
              runId: String(duplicate._id || ""),
              nextRunAt: schedule.nextRunAt,
            };
          }
          duplicateStatus = "failed";
          if (duplicate.leaseOwner) {
            await planner.compensateRun?.({
              runId: duplicate._id,
              ownerToken: duplicate.leaseOwner,
              reasonCode: "STALE_SCHEDULE_LEASE_RECOVERED",
            });
          }
        } else if (
          ["failed", "blocked"].includes(duplicate?.status) &&
          duplicate.lastCheckpoint === "compensation_pending" &&
          duplicate.leaseOwner
        ) {
          await planner.compensateRun?.({
            runId: duplicate._id,
            ownerToken: duplicate.leaseOwner,
            reasonCode: safeErrorCode({
              code:
                duplicate.errorDetails?.[0]?.code ||
                "CONTENT_OPERATIONS_PLANNING_FAILED",
            }),
          });
        }
        const nextRunAt = nextRunFor(schedule, completedAt);
        const completed = await completeSchedule({
          lastRunStatus: duplicateStatus,
          nextRunAt,
          completedAt,
        });
        if (explicitOwnerUpdateFailed(completed))
          throw scheduleLeaseLostError();
        return {
          skipped: true,
          reason: "duplicate_run_recovered",
          runId: String(duplicate?._id || ""),
          nextRunAt,
        };
      }
      planningResult = result;
      const missingRequired = result.missingRequiredSources || [];
      const lastRunStatus = result.blocked
        ? "blocked"
        : result.skipped
          ? "skipped"
          : "planned";
      const completedAt = new Date();
      const nextRunAt = nextRunFor(schedule, completedAt);
      await assertScheduleOwner();
      const completed = await completeSchedule({
        lastRunStatus,
        nextRunAt,
        completedAt,
      });
      if (explicitOwnerUpdateFailed(completed)) throw scheduleLeaseLostError();
      return { ...result, status: lastRunStatus, missingRequired, nextRunAt };
    } catch (error) {
      if (error?.code === "CONTENT_OPERATIONS_COMPENSATION_FAILED") {
        const releasedAt = new Date();
        const released = await releaseSchedule(
          releasedAt,
          "compensation_pending",
          "CONTENT_OPERATIONS_COMPENSATION_FAILED",
        );
        if (explicitOwnerUpdateFailed(released)) throw scheduleLeaseLostError();
        throw error;
      }
      if (
        error?.code === "CONTENT_OPERATIONS_SCHEDULE_LEASE_LOST" ||
        error?.code === "CONTENT_OPERATIONS_RUN_LEASE_LOST"
      ) {
        if (planningResult?.runId) {
          await planner
            ?.compensateRun?.({
              runId: planningResult.runId,
              ownerToken: lockOwner,
              reasonCode: safeErrorCode(error),
            })
            .catch(() => {});
        }
        throw error;
      }
      const completedAt = new Date();
      const nextRunAt = nextRunFor(schedule, completedAt);
      const completed = await completeSchedule({
        lastRunStatus: "failed",
        nextRunAt,
        lastError: safeErrorCode(error),
        completedAt,
      });
      if (explicitOwnerUpdateFailed(completed)) throw scheduleLeaseLostError();
      throw error;
    } finally {
      await heartbeat.stop();
    }
  }
}

module.exports = {
  ContentOperationsScheduleService,
  buildContentOperationsRealTaskCountQuery: buildRealTaskCountQuery,
  createContentOperationsScheduleLeaseHeartbeat: createScheduleLeaseHeartbeat,
  getContentOperationsScheduleDayBounds: getScheduleDayBounds,
  hasLiveContentOperationsRunLease: hasLiveRunLease,
  isContentOperationsScheduleEnabled: isEnabled,
};
