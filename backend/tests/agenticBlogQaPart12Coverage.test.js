import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const {
  buildDefaultQaCaseMatrix,
} = require("../src/config/agenticBlogQa.config");
const {
  AgenticBlogQaBatchService,
} = require("../src/services/agenticBlogQa.service");
const {
  QaTopicUniquenessService,
  buildSemanticProfile,
  normalizeTopicKey,
} = require("../src/services/qaTopicUniqueness.service");

const ids = Object.freeze({
  batch: "507f1f77bcf86cd79943b001",
  qaCase: "507f1f77bcf86cd79943b002",
  schedule: "507f1f77bcf86cd79943b003",
  execution: "507f1f77bcf86cd79943b004",
  admin: "507f1f77bcf86cd79943b005",
  duplicateCase: "507f1f77bcf86cd79943b006",
});

const config = Object.freeze({
  enabled: true,
  environment: "local",
  databaseName: "inoxpran_qa_local",
  requiredScore: 81,
  existingSeoThreshold: 85,
  maxIterations: 3,
  requireAllCasesPass: true,
  localRunNowCases: 3,
  localScheduleCases: 3,
  stagingRunNowCases: 2,
  stagingScheduleCases: 2,
});

const lean = (value) => ({ lean: vi.fn().mockResolvedValue(value) });
const sortedLean = (value) => ({ sort: vi.fn(() => lean(value)) });

describe("Agentic Blog QA Part 12 retained source-level coverage", () => {
  it("persists the reviewed six-case fixed-brief matrix with product and draft-only controls intact", async () => {
    const schedules = [];
    const cases = [];
    const BatchModel = {
      findOne: vi.fn(() => lean(null)),
      create: vi.fn(async (document) => document),
      findByIdAndUpdate: vi.fn((id, update) =>
        lean({
          _id: id,
          ...update.$set,
          environment: "local",
          isQaTest: true,
          acceptanceThreshold: 81,
          existingSeoThreshold: 85,
        }),
      ),
      updateOne: vi.fn(),
    };
    const CaseModel = {
      findById: vi.fn(() => lean(null)),
      create: vi.fn(async (document) => {
        cases.push(document);
        return document;
      }),
      updateOne: vi
        .fn()
        .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    const ScheduleModel = {
      create: vi.fn(async (document) => {
        const schedule = {
          ...document,
          _id: `507f1f77bcf86cd79943c0${String(schedules.length + 1).padStart(2, "0")}`,
        };
        schedules.push(schedule);
        return schedule;
      }),
    };
    const TopicService = {
      reserve: vi.fn(async (input) => ({
        reservation: {
          _id: `reservation-${String(input.caseId)}`,
          normalizedTopicKey: normalizeTopicKey(input.effectiveTopic),
          topicFingerprint: `topic-${String(input.caseId)}`,
          semanticFingerprint: `semantic-${String(input.caseId)}`,
          outlineFingerprint: `outline-${String(input.caseId)}`,
        },
        duplicate: false,
      })),
      releaseUnbound: vi.fn(),
    };
    const service = new AgenticBlogQaBatchService({
      BatchModel,
      CaseModel,
      ScheduleModel,
      TopicService,
      EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
      config,
    });

    const result = await service.createBatch({
      payload: { environment: "local" },
      adminId: ids.admin,
      idempotencyKey: "part12-six-case-matrix",
    });

    expect(result.casesCreated).toBe(6);
    expect(cases).toHaveLength(6);
    expect(schedules).toHaveLength(6);
    expect(schedules.map((item) => item.executionMode)).toEqual([
      "run_now",
      "schedule_run_now",
      "run_now",
      "actual_schedule",
      "actual_schedule",
      "actual_schedule",
    ]);

    for (const schedule of schedules) {
      expect(schedule).toMatchObject({
        isQaTest: true,
        environment: "local",
        mode: "fixed_brief",
        enabled: false,
        runLimit: 1,
        runCount: 0,
        autoPublish: false,
        draftOnly: true,
        maximumTasksPerDay: 1,
        nextRunAt: null,
      });
      expect(schedule.agentConfig.generateImages).toBe(false);
      expect(schedule.agentConfig.topic).toBeTruthy();
      expect(schedule.originalTopicSeed).toBeTruthy();
      expect(schedule.normalizedTopicKey).toBe(
        normalizeTopicKey(schedule.agentConfig.topic),
      );
    }

    expect(schedules[0].agentConfig.productSeeding).toEqual({
      mode: "off",
      intensity: "light",
    });
    expect(schedules[1].agentConfig.productSeeding).toEqual({
      mode: "off",
      intensity: "light",
    });
    expect(schedules[2].agentConfig.productSeeding).toEqual({
      mode: "auto",
      intensity: "light",
    });
    expect(schedules[2].agentConfig.productPlacement).toEqual({
      placementStyle: "criteria-first-recommendation",
    });
    expect(
      schedules.some((item) => item.agentConfig.productSeeding.mode === "auto"),
    ).toBe(true);
    expect(new Set(schedules.map((item) => item.normalizedTopicKey)).size).toBe(
      6,
    );
    expect(
      new Set(schedules.map((item) => item.qaTopicReservationId)).size,
    ).toBe(6);
    expect(TopicService.reserve).toHaveBeenCalledTimes(6);
    for (const qaCase of cases) {
      expect(qaCase).toMatchObject({
        isQaTest: true,
        environment: "local",
        scheduleMode: "fixed_brief",
        scheduleConfiguration: {
          mode: "fixed_brief",
          draftOnly: true,
          autoPublish: false,
          generateImages: false,
          requestIndexing: false,
          telegramEnabled: false,
          socialDistribution: false,
        },
      });
    }
  });

  it("uses one semantic run slot for the initial Daily Draft request and a client-timeout retry", async () => {
    const qaCase = {
      _id: ids.qaCase,
      batchId: ids.batch,
      qaBatchId: ids.batch,
      isQaTest: true,
      environment: "local",
      caseKey: "LOCAL-RUNNOW-RETRY",
      executionMode: "run_now",
      scheduleMode: "fixed_brief",
      scheduleId: ids.schedule,
      status: "reserved",
      runAttempts: [],
    };
    const batch = {
      _id: ids.batch,
      isQaTest: true,
      environment: "local",
      status: "planned",
      stopNewDrafts: false,
      iteration: 0,
      caseIds: [ids.qaCase],
    };
    const BatchModel = {
      findOne: vi.fn(() => lean(batch)),
      updateOne: vi.fn().mockImplementation(async (_filter, update) => {
        Object.assign(batch, update.$set || {});
        return { matchedCount: 1, modifiedCount: 1 };
      }),
    };
    const CaseModel = {
      find: vi.fn(() => sortedLean([qaCase])),
      findById: vi.fn(() => lean(qaCase)),
      updateOne: vi.fn().mockImplementation(async (_filter, update) => {
        if (update.$push?.runAttempts)
          qaCase.runAttempts.push({ ...update.$push.runAttempts });
        const values = update.$set || {};
        if (values.status) qaCase.status = values.status;
        if (values.executionId) qaCase.executionId = values.executionId;
        const attempt =
          qaCase.runAttempts.find(
            (item) =>
              item.idempotencyKeyHash ===
              _filter?.runAttempts?.$not?.$elemMatch?.idempotencyKeyHash,
          ) || qaCase.runAttempts[0];
        if (attempt) {
          if (values["runAttempts.$[attempt].executionId"])
            attempt.executionId = values["runAttempts.$[attempt].executionId"];
          if (values["runAttempts.$[attempt].status"])
            attempt.status = values["runAttempts.$[attempt].status"];
          if (values["runAttempts.$[attempt].dispatchState"])
            attempt.dispatchState =
              values["runAttempts.$[attempt].dispatchState"];
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }),
    };
    const ScheduleModel = {
      findOne: vi.fn(() =>
        lean({
          _id: ids.schedule,
          isQaTest: true,
          qaBatchId: ids.batch,
          qaCaseId: ids.qaCase,
          environment: "local",
        }),
      ),
    };
    const ScheduleService = {
      runDailyDraftForQa: vi.fn().mockResolvedValue({
        executionId: ids.execution,
        status: "queued",
        duplicate: false,
      }),
      runNow: vi.fn(),
    };
    const service = new AgenticBlogQaBatchService({
      BatchModel,
      CaseModel,
      ScheduleModel,
      ScheduleService,
      EnsureInfrastructure: vi.fn().mockResolvedValue({ ensured: true }),
      config,
    });

    const initial = await service.runBatch({
      batchId: ids.batch,
      adminId: ids.admin,
      idempotencyKey: "part12-initial-request",
    });
    const retried = await service.runBatch({
      batchId: ids.batch,
      adminId: ids.admin,
      idempotencyKey: "part12-client-timeout-retry",
    });

    expect(initial.queued).toHaveLength(1);
    expect(initial.queued[0]).toMatchObject({
      caseId: ids.qaCase,
      executionMode: "run_now",
      executionId: ids.execution,
      duplicate: false,
    });
    expect(retried.queued).toHaveLength(1);
    expect(retried.queued[0]).toMatchObject({
      caseId: ids.qaCase,
      executionMode: "run_now",
      executionId: ids.execution,
      duplicate: true,
      idempotent: true,
    });
    expect(qaCase.runAttempts).toHaveLength(1);
    expect(ScheduleService.runDailyDraftForQa).toHaveBeenCalledTimes(1);
    expect(ScheduleService.runNow).not.toHaveBeenCalled();
  });

  it("rejects an exact duplicated topic before any reservation or draft artifact is created", async () => {
    const topic = "How to clean a stainless-steel pot safely";
    const normalizedTopicKey = normalizeTopicKey(topic);
    const ReservationModel = {
      findById: vi.fn(() => lean(null)),
      find: vi.fn().mockResolvedValue([
        {
          caseId: ids.duplicateCase,
          normalizedTopicKey,
          semanticProfile: buildSemanticProfile({
            effectiveTopic: topic,
            mainEntity: "stainless-steel pot",
            userProblem: "clean safely",
            searchIntent: "how-to",
            articleType: "how-to",
            contentRole: "task completion",
            plannedOutline: ["Assess the surface", "Clean without scratching"],
          }),
        },
      ]),
      create: vi.fn(),
    };
    const service = new QaTopicUniquenessService({
      ReservationModel,
      InventoryItemModel: {},
      BlogModel: {},
    });

    await expect(
      service.reserve({
        batchId: ids.batch,
        caseId: ids.qaCase,
        environment: "local",
        executionMode: "run_now",
        originalTopicSeed: topic,
        effectiveTopic: topic,
        mainEntity: "stainless-steel pot",
        userProblem: "clean safely",
        searchIntent: "how-to",
        articleType: "how-to",
        contentRole: "task completion",
        plannedOutline: ["Assess the surface", "Clean without scratching"],
      }),
    ).rejects.toMatchObject({ code: "QA_TOPIC_ALREADY_RESERVED" });
    expect(ReservationModel.create).not.toHaveBeenCalled();
  });

  it("keeps the reviewed default matrix deterministic, bounded, and distinct before persistence", () => {
    const matrix = buildDefaultQaCaseMatrix({
      environment: "local",
      config,
      variantSeed: "part12-reviewed-matrix",
    });

    expect(matrix).toHaveLength(6);
    expect(
      matrix.filter((item) => item.executionMode === "run_now"),
    ).toHaveLength(2);
    expect(
      matrix.filter((item) => item.executionMode === "schedule_run_now"),
    ).toHaveLength(1);
    expect(
      matrix.filter((item) => item.executionMode === "actual_schedule"),
    ).toHaveLength(3);
    expect(matrix.filter((item) => item.productMode === "off")).toHaveLength(2);
    expect(matrix.filter((item) => item.productMode === "auto")).toHaveLength(
      4,
    );
    expect(
      matrix.some(
        (item) => item.placementStyle === "criteria-first-recommendation",
      ),
    ).toBe(true);
    expect(
      new Set(matrix.map((item) => normalizeTopicKey(item.effectiveTopic)))
        .size,
    ).toBe(6);
  });

  it("retains the final publisher, public-state, indexing, and Telegram QA fences", () => {
    const publisherSource = readFileSync(
      require.resolve("../src/services/automationSeoBlog.service"),
      "utf8",
    );
    const schedulerSource = readFileSync(
      require.resolve("../src/services/blogAutomationSchedule.service"),
      "utf8",
    );

    expect(publisherSource).toContain(
      "if (qaContext) normalized.mode = 'draft'",
    );
    expect(publisherSource).toContain(
      "indexability: { index: false, follow: false, determinable: true, reason: 'qa_draft_only' }",
    );
    expect(publisherSource).toContain("publishedAt: qaContext ? null");
    expect(publisherSource).toContain("isDraft: qaContext ? true");
    expect(publisherSource).toContain("isPublished: qaContext ? false");
    expect(schedulerSource).toContain(
      "publishSeoBlog({ payload, trustedQaContext: qaContext })",
    );
    expect(schedulerSource).toContain(
      "if (schedule.isQaTest === true && result.published)",
    );
    expect(schedulerSource).toContain("reason: 'qa_telegram_forbidden'");
    expect(
      schedulerSource.indexOf("reason: 'qa_telegram_forbidden'"),
    ).toBeLessThan(
      schedulerSource.indexOf(
        "TelegramApprovalService.createDraftApprovalAndNotify",
      ),
    );
  });
});
