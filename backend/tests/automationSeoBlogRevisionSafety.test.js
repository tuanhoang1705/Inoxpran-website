import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Module } = require("node:module");

const ORIGINAL_ENV = { ...process.env };

const IDS = Object.freeze({
  googleSnapshot: "507f1f77bcf86cd799439021",
  researchBundle: "507f1f77bcf86cd799439022",
  styleProfile: "507f1f77bcf86cd799439023",
  strategyPlan: "507f1f77bcf86cd799439024",
  execution: "507f1f77bcf86cd799439025",
  operationsSnapshot: "507f1f77bcf86cd799439041",
  inventorySnapshot: "507f1f77bcf86cd799439042",
  opportunityDecision: "507f1f77bcf86cd799439043",
  workOrder: "507f1f77bcf86cd799439044",
  brief: "507f1f77bcf86cd799439045",
  evidenceMap: "507f1f77bcf86cd799439046",
  targetBlog: "507f1f77bcf86cd799439047",
  revision: "507f1f77bcf86cd799439048",
  readiness: "507f1f77bcf86cd799439049",
});
const WORK_ORDER_CLAIM_TOKEN = "publisher-worker:claim-current";

const blogMock = {
  findOne: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  findByIdAndUpdate: vi.fn(),
  updateOne: vi.fn(),
};
const executionMock = { findById: vi.fn(), updateOne: vi.fn() };
const workOrderMock = { findById: vi.fn(), updateOne: vi.fn() };
const briefMock = { findById: vi.fn() };
const evidenceMapMock = { findById: vi.fn() };
const opportunityDecisionMock = { findById: vi.fn() };
const researchBundleMock = { findById: vi.fn() };
const strategyPlanMock = { findById: vi.fn() };
const blogRevisionMock = { findOne: vi.fn() };
const ensureGoogleSnapshotMock = vi.fn();
const runImagePipelineMock = vi.fn();
const stageRevisionMock = vi.fn();
const createReadinessReportMock = vi.fn();
const attachArtifactMock = vi.fn();
const renewProductionClaimMock = vi.fn();
const transitionClaimedMock = vi.fn();
const transitionExecutionClaimedMock = vi.fn();
const transitionExecutionUnclaimedMock = vi.fn();
const scheduleMonitoringMock = vi.fn();
const postPublishVerificationMock = vi.fn();
const telegramNotifyMock = vi.fn();

const queryResult = (value) => ({ lean: () => Promise.resolve(value) });

const installMock = (modulePath, exports) => {
  const resolvedPath = require.resolve(modulePath);
  const mockModule = new Module(resolvedPath);
  mockModule.exports = exports;
  require.cache[resolvedPath] = mockModule;
};

const loadAutomationService = () => {
  installMock("../src/models/blog.model", {
    blog: blogMock,
    BLOG_CATEGORY_KEYS: [
      "guide",
      "care",
      "knowledge",
      "trend",
      "product",
      "design",
    ],
  });
  installMock("../src/models/blogAutomationExecution.model", {
    BlogAutomationExecution: executionMock,
  });
  installMock("../src/models/contentWorkOrder.model", {
    ContentWorkOrder: workOrderMock,
  });
  installMock("../src/models/unifiedContentBrief.model", {
    UnifiedContentBrief: briefMock,
  });
  installMock("../src/models/evidenceMap.model", {
    EvidenceMap: evidenceMapMock,
  });
  installMock("../src/models/contentOpportunityDecision.model", {
    ContentOpportunityDecision: opportunityDecisionMock,
  });
  installMock("../src/models/researchBundle.model", {
    ResearchBundle: researchBundleMock,
  });
  installMock("../src/models/blogStrategyPlan.model", {
    BlogStrategyPlan: strategyPlanMock,
  });
  installMock("../src/models/blogRevision.model", {
    BlogRevision: blogRevisionMock,
  });
  installMock("../src/services/googleIntelligence.service", {
    GoogleIntelligenceService: {
      ensureGoogleIntelligenceSnapshotForDate: ensureGoogleSnapshotMock,
    },
  });
  installMock("../src/services/openclaw/imagePipeline.service", {
    runImagePipeline: runImagePipelineMock,
  });
  installMock("../src/services/contentOperations/blogRevision.service", {
    BlogRevisionService: { stage: stageRevisionMock },
  });
  installMock("../src/services/contentOperations/publishReadiness.service", {
    ContentPublishReadinessService: { createReport: createReadinessReportMock },
  });
  installMock("../src/services/contentOperations/workOrder.service", {
    ContentWorkOrderService: {
      attachArtifact: attachArtifactMock,
      renewProductionClaim: renewProductionClaimMock,
      transitionClaimed: transitionClaimedMock,
      transitionExecutionClaimed: transitionExecutionClaimedMock,
      transitionExecutionUnclaimed: transitionExecutionUnclaimedMock,
    },
    getActiveClaimToken: (workOrder) =>
      String(workOrder?.metadata?.activeClaimToken || ""),
    isWorkOrderRunnable: () => true,
  });
  installMock("../src/services/contentOperations/performanceLearning.service", {
    PerformanceLearningService: { scheduleMonitoring: scheduleMonitoringMock },
  });
  installMock(
    "../src/services/contentOperations/postPublishVerification.service",
    {
      PostPublishVerificationService: { run: postPublishVerificationMock },
    },
  );
  installMock("../src/services/telegramApproval.service", {
    TelegramApprovalService: {
      createDraftApprovalAndNotify: telegramNotifyMock,
    },
  });

  for (const modulePath of [
    "../src/utils/seoBlogValidation",
    "../src/services/automationSeoBlog.service",
  ]) {
    delete require.cache[require.resolve(modulePath)];
  }

  return require("../src/services/automationSeoBlog.service");
};

const buildPayload = (contentDecision) => ({
  mode: "publish",
  source: "openclaw-daily-seo",
  primaryKeyword: "noi inox 304",
  secondaryKeywords: ["bao quan noi inox"],
  title: "Cach bao quan noi inox 304 dung cach",
  slug: "cach-bao-quan-noi-inox-304",
  excerpt: "Cap nhat noi dung huong dan bao quan noi inox 304 cho gia dinh.",
  contentHtml: `<article><h2>Huong dan cap nhat</h2><p>${"Lam sach va bao quan noi inox dung cach. ".repeat(45)}</p></article>`,
  seoTitle: "Cach bao quan noi inox 304",
  seoDescription:
    "Huong dan cap nhat cach bao quan noi inox 304 an toan va ben lau.",
  categoryKey: "guide",
  tags: ["inox 304", "bao quan"],
  authorName: "Inoxpran Editorial Team",
  imageUrl: "/images/existing-cover.jpg",
  review: {
    seoScore: 95,
    brandSafety: "pass",
    duplicateRisk: "low",
    claimRisk: "low",
    imageSafety: "pass",
    factuality: "pass",
    originality: "pass",
    peopleFirst: "pass",
    spamRisk: "low",
    seoAeoGeo: "pass",
  },
  metadata: { agentRunId: `revision-${contentDecision}` },
  googleIntelSnapshotId: IDS.googleSnapshot,
  googleIntelSnapshotDate: "2026-07-20",
  googleIntelStatus: "completed_no_change",
  researchBundleId: IDS.researchBundle,
  editorialStyleProfileId: IDS.styleProfile,
  strategyPlanId: IDS.strategyPlan,
  agenticExecutionId: IDS.execution,
  contentOperationsSnapshotId: IDS.operationsSnapshot,
  contentInventorySnapshotId: IDS.inventorySnapshot,
  contentOpportunityDecisionId: IDS.opportunityDecision,
  contentWorkOrderId: IDS.workOrder,
  unifiedContentBriefId: IDS.brief,
  evidenceMapId: IDS.evidenceMap,
  contentDecision,
  targetBlogId: IDS.targetBlog,
  productSeedingMode: "off",
  productSeedingDecision: "no_seed",
  structuralFingerprint: { hash: `revision-${contentDecision}` },
  agenticReviews: {},
});

const buildTargetBlog = () => ({
  _id: IDS.targetBlog,
  blog_slug: "cach-bao-quan-noi-inox-304",
  blog_title: "Cach bao quan noi inox 304",
  blog_content: "<article><p>Live content must remain unchanged.</p></article>",
  blog_image: "/images/existing-cover.jpg",
  canonicalUrl: "https://inoxpran.com/blog/cach-bao-quan-noi-inox-304",
  coverImage: { url: "/images/existing-cover.jpg", status: "complete" },
  contentImages: [],
  visualPlan: { source: "existing-live-blog" },
});

const configureArtifactChain = (contentDecision) => {
  const execution = {
    _id: IDS.execution,
    contentOperationsSnapshotId: IDS.operationsSnapshot,
    contentInventorySnapshotId: IDS.inventorySnapshot,
    contentOpportunityDecisionId: IDS.opportunityDecision,
    contentWorkOrderId: IDS.workOrder,
    unifiedContentBriefId: IDS.brief,
    evidenceMapId: IDS.evidenceMap,
    researchBundleId: IDS.researchBundle,
    editorialStyleProfileId: IDS.styleProfile,
    strategyPlanId: IDS.strategyPlan,
    metadata: { contentWorkOrderClaimToken: WORK_ORDER_CLAIM_TOKEN },
  };
  const workOrder = {
    _id: IDS.workOrder,
    decision: contentDecision,
    contentOperationsSnapshotId: IDS.operationsSnapshot,
    googleIntelSnapshotId: IDS.googleSnapshot,
    contentOpportunityDecisionId: IDS.opportunityDecision,
    status: "drafting",
    targetBlogId: IDS.targetBlog,
    metadata: {
      activeExecutionId: IDS.execution,
      activeClaimToken: WORK_ORDER_CLAIM_TOKEN,
    },
  };
  const brief = {
    _id: IDS.brief,
    contentWorkOrderId: IDS.workOrder,
    targetBlogId: IDS.targetBlog,
    structuredDataCandidate: "Article",
  };
  const evidenceMap = {
    _id: IDS.evidenceMap,
    contentWorkOrderId: IDS.workOrder,
    unifiedContentBriefId: IDS.brief,
  };
  const decision = {
    _id: IDS.opportunityDecision,
    contentOperationsSnapshotId: IDS.operationsSnapshot,
    recommendedAction: contentDecision,
    status: "selected",
  };
  const researchBundle = {
    _id: IDS.researchBundle,
    contentWorkOrderId: IDS.workOrder,
    unifiedContentBriefId: IDS.brief,
  };
  const strategyPlan = {
    _id: IDS.strategyPlan,
    contentWorkOrderId: IDS.workOrder,
    unifiedContentBriefId: IDS.brief,
  };

  executionMock.findById.mockReturnValue(queryResult(execution));
  workOrderMock.findById.mockReturnValue(queryResult(workOrder));
  briefMock.findById.mockReturnValue(queryResult(brief));
  evidenceMapMock.findById.mockReturnValue(queryResult(evidenceMap));
  opportunityDecisionMock.findById.mockReturnValue(queryResult(decision));
  researchBundleMock.findById.mockReturnValue(queryResult(researchBundle));
  strategyPlanMock.findById.mockReturnValue(queryResult(strategyPlan));
  return { workOrder, brief };
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env = {
    ...ORIGINAL_ENV,
    CONTENT_OPERATIONS_ENABLED: "true",
    CONTENT_PUBLISH_READINESS_ENABLED: "true",
    CONTENT_POST_PUBLISH_VERIFY_ENABLED: "true",
    CONTENT_PERFORMANCE_MONITORING_ENABLED: "true",
    SEO_AGENT_ENABLED: "true",
    SEO_AGENT_AUTO_PUBLISH: "true",
    SEO_AGENT_MIN_SEO_SCORE: "85",
    SEO_AGENT_MIN_WORDS: "1",
    SEO_AGENT_MAX_WORDS: "1000",
    OPENCLAW_IMAGE_PIPELINE_ENABLED: "true",
    OPENCLAW_REQUIRE_COVER_IMAGE_FOR_PUBLISH: "true",
    PUBLIC_SITE_URL: "https://inoxpran.com",
  };

  ensureGoogleSnapshotMock.mockResolvedValue({
    id: IDS.googleSnapshot,
    snapshotDate: "2026-07-20",
    status: "completed_no_change",
  });
  blogMock.findOne.mockReturnValue({
    select: () => queryResult({ _id: IDS.targetBlog }),
  });
  blogMock.findById.mockReturnValue(queryResult(buildTargetBlog()));
  blogRevisionMock.findOne.mockReturnValue({
    sort: () => ({
      select: () => queryResult({ revisionNumber: 2 }),
    }),
  });
  stageRevisionMock.mockResolvedValue({
    _id: IDS.revision,
    revisionNumber: 3,
    status: "staged",
  });
  createReadinessReportMock.mockResolvedValue({
    _id: IDS.readiness,
    pass: true,
    autoPublishAllowed: true,
    riskLevel: "low",
  });
  attachArtifactMock.mockResolvedValue({ attached: true });
  renewProductionClaimMock.mockResolvedValue(true);
  transitionClaimedMock.mockImplementation(async ({ status, updates }) => ({
    _id: IDS.workOrder,
    status,
    artifactIds: {
      blogRevisionId: updates?.["artifactIds.blogRevisionId"],
      publishReadinessReportId:
        updates?.["artifactIds.publishReadinessReportId"],
    },
    metadata: { activeClaimToken: "" },
  }));
  transitionExecutionClaimedMock.mockResolvedValue(true);
  transitionExecutionUnclaimedMock.mockResolvedValue(true);
  workOrderMock.updateOne.mockResolvedValue({ modifiedCount: 1 });
  executionMock.updateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe("AutomationSeoBlogService V3 revision safety", () => {
  it.each([
    ["update", false],
    ["metadata_refresh", true],
    ["content_maintenance", true],
  ])(
    "stages %s without mutating, publishing, generating images, or notifying Telegram",
    async (contentDecision, scopedMaintenance) => {
      const { workOrder, brief } = configureArtifactChain(contentDecision);
      const AutomationSeoBlogService = loadAutomationService();

      const result = await AutomationSeoBlogService.publishSeoBlog({
        payload: buildPayload(contentDecision),
      });

      expect(stageRevisionMock).toHaveBeenCalledOnce();
      expect(stageRevisionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workOrder,
          brief,
          currentBlog: expect.objectContaining({
            _id: IDS.targetBlog,
            contentHtml:
              "<article><p>Live content must remain unchanged.</p></article>",
          }),
          changes: expect.objectContaining({
            sectionChanges: scopedMaintenance
              ? []
              : [
                  expect.objectContaining({
                    operation: "add_reviewed_section",
                  }),
                ],
          }),
        }),
      );
      expect(stageRevisionMock.mock.calls[0][0]).not.toHaveProperty(
        "revisionNumber",
      );
      expect(
        JSON.stringify(stageRevisionMock.mock.calls[0][0].changes),
      ).not.toMatch(/replace_content_in_staged_revision/);
      expect(blogMock.create).not.toHaveBeenCalled();
      expect(blogMock.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(blogMock.updateOne).not.toHaveBeenCalled();
      expect(runImagePipelineMock).not.toHaveBeenCalled();
      expect(scheduleMonitoringMock).not.toHaveBeenCalled();
      expect(postPublishVerificationMock).not.toHaveBeenCalled();
      expect(telegramNotifyMock).not.toHaveBeenCalled();
      expect(transitionClaimedMock).toHaveBeenCalledWith({
        workOrderId: IDS.workOrder,
        claimToken: WORK_ORDER_CLAIM_TOKEN,
        status: "reviewing",
        updates: {
          "artifactIds.blogRevisionId": IDS.revision,
          "artifactIds.publishReadinessReportId": IDS.readiness,
        },
      });
      expect(workOrderMock.updateOne).not.toHaveBeenCalled();
      expect(transitionExecutionClaimedMock).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: IDS.execution,
          workOrderId: IDS.workOrder,
          claimToken: WORK_ORDER_CLAIM_TOKEN,
          status: "maintenance_created",
          completedAt: expect.any(Date),
        }),
      );
      expect(transitionExecutionUnclaimedMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        mode: "revision",
        blogId: IDS.targetBlog,
        published: false,
        revisionStaged: true,
        blogRevisionId: IDS.revision,
        liveBlogMutated: false,
        updatedExisting: true,
        imagePipelineStatus: "not_run_for_revision",
      });
      expect(result.reasons).toContain(
        "revision_staged_live_article_unchanged",
      );
    },
  );

  it("rejects a stale execution before creating a revision or writing terminal state", async () => {
    configureArtifactChain("update");
    renewProductionClaimMock.mockResolvedValue(false);
    const AutomationSeoBlogService = loadAutomationService();

    await expect(
      AutomationSeoBlogService.publishSeoBlog({
        payload: buildPayload("update"),
      }),
    ).rejects.toMatchObject({
      code: "CONTENT_WORK_ORDER_LEASE_LOST",
      status: 409,
    });

    expect(stageRevisionMock).not.toHaveBeenCalled();
    expect(createReadinessReportMock).not.toHaveBeenCalled();
    expect(transitionClaimedMock).not.toHaveBeenCalled();
    expect(transitionExecutionClaimedMock).not.toHaveBeenCalled();
    expect(executionMock.updateOne).not.toHaveBeenCalled();
  });

  it("does not report completion when terminal ownership compare-and-set loses the race", async () => {
    configureArtifactChain("update");
    transitionClaimedMock.mockResolvedValue(null);
    const AutomationSeoBlogService = loadAutomationService();

    await expect(
      AutomationSeoBlogService.publishSeoBlog({
        payload: buildPayload("update"),
      }),
    ).rejects.toMatchObject({
      code: "CONTENT_WORK_ORDER_LEASE_LOST",
      status: 409,
    });

    expect(stageRevisionMock).toHaveBeenCalledOnce();
    expect(transitionClaimedMock).toHaveBeenCalledOnce();
    expect(transitionExecutionClaimedMock).not.toHaveBeenCalled();
    expect(executionMock.updateOne).not.toHaveBeenCalled();
    expect(workOrderMock.updateOne).not.toHaveBeenCalled();
  });

  it("does not report completion when the execution claim changes before its terminal write", async () => {
    configureArtifactChain("update");
    transitionExecutionClaimedMock.mockResolvedValue(false);
    const AutomationSeoBlogService = loadAutomationService();

    await expect(
      AutomationSeoBlogService.publishSeoBlog({
        payload: buildPayload("update"),
      }),
    ).rejects.toMatchObject({
      code: "CONTENT_WORK_ORDER_LEASE_LOST",
      status: 409,
    });

    expect(transitionClaimedMock).toHaveBeenCalledOnce();
    expect(transitionExecutionClaimedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: IDS.execution,
        workOrderId: IDS.workOrder,
        claimToken: WORK_ORDER_CLAIM_TOKEN,
        status: "maintenance_created",
      }),
    );
    expect(executionMock.updateOne).not.toHaveBeenCalled();
  });
});

describe("AutomationSeoBlogService post-commit isolation", () => {
  const postCommitInput = {
    shouldPublish: true,
    workOrder: { _id: IDS.workOrder },
    blogId: IDS.targetBlog,
    executionId: IDS.execution,
    correlationId: "correlation-post-commit",
    publishedAt: new Date("2026-07-20T02:00:00.000Z"),
    monitoringWindows: ["7d"],
    postPublishVerificationEnabled: true,
    publishReadinessReportId: IDS.readiness,
    slug: "cach-bao-quan-noi-inox-304",
    contentHtml:
      '<article data-revision="safe"><p>Published content.</p></article>',
    requireCover: true,
  };

  const buildDependencies = () => ({
    PerformanceService: { scheduleMonitoring: vi.fn() },
    VerificationService: { run: vi.fn() },
    ExecutionModel: {
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    WorkOrderModel: {
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    WorkOrderService: {
      attachArtifact: vi.fn().mockResolvedValue({ attached: true }),
    },
    AlertModel: {
      findOneAndUpdate: vi.fn().mockResolvedValue({ _id: "alert-id" }),
    },
    auditWriter: vi.fn().mockResolvedValue({ _id: "audit-id" }),
    environment: {
      CONTENT_OPERATIONS_ENABLED: "true",
      CONTENT_PERFORMANCE_MONITORING_ENABLED: "true",
    },
    fetchImpl: vi.fn(),
  });

  it("preserves a successful publication and records bounded warnings when both auxiliary steps fail", async () => {
    const dependencies = buildDependencies();
    dependencies.PerformanceService.scheduleMonitoring.mockRejectedValue(
      Object.assign(new Error("monitor failed with secret=do-not-store"), {
        code: "MONITOR_TIMEOUT",
      }),
    );
    dependencies.VerificationService.run.mockRejectedValue(
      new Error("verification failed with token=do-not-store"),
    );
    const AutomationSeoBlogService = loadAutomationService();

    const result = await AutomationSeoBlogService.runPostCommitSafeguards(
      postCommitInput,
      dependencies,
    );

    expect(result.monitoringTasks).toEqual([]);
    expect(result.postPublishVerification).toBeNull();
    expect(result.postCommitWarnings).toEqual([
      expect.objectContaining({
        code: "performance_monitoring_schedule_failed",
        errorCode: "MONITOR_TIMEOUT",
        publicationPreserved: true,
      }),
      expect.objectContaining({
        code: "post_publish_verification_failed",
        errorCode: "Error",
        publicationPreserved: true,
      }),
    ]);
    expect(dependencies.AlertModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(dependencies.WorkOrderModel.updateOne).toHaveBeenCalledTimes(2);
    expect(dependencies.auditWriter).toHaveBeenCalledTimes(2);
    const persistedCalls = JSON.stringify({
      alerts: dependencies.AlertModel.findOneAndUpdate.mock.calls,
      audits: dependencies.auditWriter.mock.calls,
      executions: dependencies.ExecutionModel.updateOne.mock.calls,
    });
    expect(persistedCalls).not.toContain("do-not-store");
  });

  it("returns persisted auxiliary artifacts when both post-commit steps succeed", async () => {
    const dependencies = buildDependencies();
    const monitoringTask = {
      _id: "monitor-id",
      window: "7d",
      dueAt: new Date("2026-07-27T02:00:00.000Z"),
    };
    const verification = { _id: "verification-id", status: "passed" };
    dependencies.PerformanceService.scheduleMonitoring.mockResolvedValue([
      monitoringTask,
    ]);
    dependencies.VerificationService.run.mockResolvedValue({ verification });
    const AutomationSeoBlogService = loadAutomationService();

    const result = await AutomationSeoBlogService.runPostCommitSafeguards(
      postCommitInput,
      dependencies,
    );

    expect(result).toEqual({
      monitoringTasks: [monitoringTask],
      postPublishVerification: verification,
      postCommitWarnings: [],
    });
    expect(dependencies.WorkOrderService.attachArtifact).toHaveBeenCalledWith({
      workOrderId: IDS.workOrder,
      artifactType: "postPublishVerificationId",
      artifactId: verification._id,
    });
    expect(dependencies.AlertModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  // Verification used to hang off CONTENT_OPERATIONS_ENABLED (default false)
  // while the publish gate demanded CONTENT_POST_PUBLISH_VERIFY_ENABLED
  // (default true), so an article could publish having satisfied the
  // verification precondition while no verification ever ran. The two flags now
  // gate the two concerns separately.
  it("still verifies the publication when only the Content Operations flag is off", async () => {
    const dependencies = buildDependencies();
    dependencies.environment.CONTENT_OPERATIONS_ENABLED = "false";
    const AutomationSeoBlogService = loadAutomationService();

    await AutomationSeoBlogService.runPostCommitSafeguards(
      postCommitInput,
      dependencies,
    );

    expect(
      dependencies.PerformanceService.scheduleMonitoring,
    ).not.toHaveBeenCalled();
    expect(dependencies.VerificationService.run).toHaveBeenCalled();
  });

  it("runs no verification when post-publish verification itself is disabled", async () => {
    const dependencies = buildDependencies();
    dependencies.environment.CONTENT_OPERATIONS_ENABLED = "false";
    const AutomationSeoBlogService = loadAutomationService();

    const result = await AutomationSeoBlogService.runPostCommitSafeguards(
      { ...postCommitInput, postPublishVerificationEnabled: false },
      dependencies,
    );

    expect(result).toEqual({
      monitoringTasks: [],
      postPublishVerification: null,
      postCommitWarnings: [],
    });
    expect(
      dependencies.PerformanceService.scheduleMonitoring,
    ).not.toHaveBeenCalled();
    expect(dependencies.VerificationService.run).not.toHaveBeenCalled();
  });
});
