"use strict";

const crypto = require("node:crypto");
const {
  getContentOperationsConfig,
} = require("../../config/contentOperations.config");
const {
  ContentLearningRecord,
} = require("../../models/contentLearningRecord.model");
const {
  ContentMonitoringTask,
  MONITORING_WINDOWS,
} = require("../../models/contentMonitoringTask.model");
const {
  ContentPerformanceSnapshot,
} = require("../../models/contentPerformanceSnapshot.model");
const {
  PostPublishVerification,
} = require("../../models/postPublishVerification.model");
const {
  ContentInventoryItem,
} = require("../../models/contentInventoryItem.model");
const {
  ContentOpportunityDecision,
} = require("../../models/contentOpportunityDecision.model");
const { ContentWorkOrder } = require("../../models/contentWorkOrder.model");
const { blog } = require("../../models/blog.model");
const { ContentWorkOrderService } = require("./workOrder.service");
const {
  hasQaProvenanceMarkers,
  qaScopeFilter,
} = require("../../utils/qaProvenance.util");
const {
  writeContentOperationsAudit,
} = require("./contentOperationsAudit.service");
const { SearchConsoleAdapter } = require("./searchConsole.adapter");
const { AggregateAnalyticsAdapter } = require("./aggregateAnalytics.adapter");

const WINDOW_MS = Object.freeze({
  immediate: 0,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
});
const DAY_MS = 24 * 60 * 60 * 1000;
const MONITORING_LEASE_MS = 10 * 60 * 1000;
const LEARNING_LEASE_MS = 10 * 60 * 1000;

const productionArtifactScopeFilter = () => ({
  ...qaScopeFilter(null),
  qaBatchId: null,
  qaCaseId: null,
  environment: { $in: [null, ""] },
  executionMode: { $in: [null, ""] },
  originalTopicSeed: { $in: [null, ""] },
  normalizedTopicKey: { $in: [null, ""] },
  "metadata.isQaTest": { $ne: true },
  "metadata.qaBatchId": null,
  "metadata.qaCaseId": null,
});

const assertProductionArtifact = (value, label) => {
  if (!value) return value;
  const source = typeof value?.toObject === "function" ? value.toObject() : value;
  if (
    hasQaProvenanceMarkers(source) ||
    hasQaProvenanceMarkers(source?.metadata) ||
    hasQaProvenanceMarkers(source?.qaContext)
  ) {
    const error = new Error(`${label}_qa_scope_forbidden`);
    error.code = "PRODUCTION_ARTIFACT_SCOPE_INVALID";
    throw error;
  }
  return value;
};

const createLeaseOwner = (workerId, scope = "content-performance") => {
  const normalizedWorkerId =
    String(workerId || scope)
      .trim()
      .slice(0, 150) || scope;
  return `${normalizedWorkerId}:${crypto.randomUUID()}`.slice(0, 200);
};

const explicitOwnerUpdateFailed = (result) => {
  if (Number.isFinite(result?.matchedCount)) return result.matchedCount === 0;
  if (Number.isFinite(result?.modifiedCount)) return result.modifiedCount === 0;
  return true;
};

const createMonitoringLeaseLostError = () => {
  const error = new Error("monitoring_task_lease_lost");
  error.code = "MONITORING_TASK_LEASE_LOST";
  return error;
};

const normalizeClaimGeneration = (value) => {
  const generation = Number(value);
  return Number.isInteger(generation) && generation >= 1 ? generation : 0;
};

const createMonitoringLeaseHeartbeat = ({
  TaskModel,
  taskId,
  ownerToken,
  claimGeneration,
  leaseMs = MONITORING_LEASE_MS,
  heartbeatMs = Math.max(1_000, Math.floor(leaseMs / 3)),
  clock = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) => {
  const generation = normalizeClaimGeneration(claimGeneration);
  if (!taskId || !ownerToken || !generation)
    throw new Error("monitoring_task_claim_required");
  let stopped = false;
  let ownershipLost = false;
  let pending = Promise.resolve();
  const renew = async () => {
    if (stopped || ownershipLost) return !ownershipLost;
    const heartbeatAt = new Date(clock());
    const result = await TaskModel.updateOne(
      {
        _id: taskId,
        status: "running",
        lockedBy: ownerToken,
        claimGeneration: generation,
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
      if (ownershipLost || stopped) return false;
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

const nullableMetric = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const positiveNumber = (
  value,
  fallback,
  { min = 1, max = Number.POSITIVE_INFINITY } = {},
) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const daysSince = (value, now = new Date()) => {
  const timestamp = new Date(value);
  const measuredAt = new Date(now);
  if (Number.isNaN(timestamp.getTime()) || Number.isNaN(measuredAt.getTime()))
    return 0;
  return Math.max(
    0,
    Math.floor((measuredAt.getTime() - timestamp.getTime()) / DAY_MS),
  );
};

const normalizeSourceMetrics = ({ source = {}, fields = [] } = {}) => {
  const configured = source.configured === true;
  const normalized = {
    configured,
    status: configured ? source.status || "available" : "unavailable",
  };
  for (const field of fields)
    normalized[field] = configured ? nullableMetric(source[field]) : null;
  return normalized;
};

const buildMonitoringTasks = ({
  blogId,
  contentWorkOrderId,
  publishedAt = new Date(),
  windows,
  config = getContentOperationsConfig(),
} = {}) => {
  if (!blogId || !contentWorkOrderId)
    throw new Error("blogId and contentWorkOrderId are required");
  const configuredWindows =
    Array.isArray(windows) && windows.length
      ? windows
      : ["immediate", ...(config.monitoringWindows || [])];
  const uniqueWindows = [...new Set(configuredWindows.map(String))];
  const invalid = uniqueWindows.find(
    (window) => !MONITORING_WINDOWS.includes(window),
  );
  if (invalid) throw new Error(`Unsupported monitoring window: ${invalid}`);
  const origin = new Date(publishedAt);
  if (Number.isNaN(origin.getTime())) throw new Error("publishedAt is invalid");
  return uniqueWindows.map((window) => ({
    blogId,
    contentWorkOrderId,
    window,
    dueAt: new Date(origin.getTime() + WINDOW_MS[window]),
    status: "pending",
  }));
};

const buildPerformanceSnapshot = ({
  task,
  sources = {},
  measuredAt = new Date(),
} = {}) => {
  const monitoringTaskId = task?._id || task?.id;
  const monitoringClaimToken = String(
    task?.lockedBy || task?.monitoringClaimToken || "",
  ).trim();
  const monitoringClaimGeneration =
    normalizeClaimGeneration(task?.claimGeneration) ||
    normalizeClaimGeneration(task?.monitoringClaimGeneration);
  if (
    !monitoringTaskId ||
    !task.blogId ||
    !task.contentWorkOrderId ||
    !task.window ||
    !monitoringClaimToken ||
    !monitoringClaimGeneration
  )
    throw new Error("A claimed persisted monitoring task is required");
  const searchConsole = normalizeSourceMetrics({
    source: sources.searchConsole,
    fields: ["clicks", "impressions", "ctr", "averagePosition"],
  });
  searchConsole.queries =
    searchConsole.configured && Array.isArray(sources.searchConsole?.queries)
      ? sources.searchConsole.queries
      : [];
  const analytics = normalizeSourceMetrics({
    source: sources.analytics,
    fields: [
      "views",
      "engagedSessions",
      "engagementTime",
      "productLinkClicks",
      "conversionAssist",
    ],
  });
  const document = {
    blogId: task.blogId,
    contentWorkOrderId: task.contentWorkOrderId,
    monitoringTaskId,
    monitoringClaimToken,
    monitoringClaimGeneration,
    measuredAt,
    window: task.window,
    searchConsole,
    analytics,
    technical: sources.technical || {},
    contentState: sources.contentState || {},
    productState: sources.productState || {},
    warnings: Array.isArray(sources.warnings)
      ? sources.warnings.map(String)
      : [],
  };
  document.contentHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(document))
    .digest("hex");
  return document;
};

const windowDays = (window) =>
  Math.round((WINDOW_MS[window] || 0) / (24 * 60 * 60 * 1000));

const selectPage = (rows, urls) =>
  (rows || []).find((row) =>
    urls.has(String(row.page || row.path || "").replace(/\/$/, "")),
  ) || null;

const collectMonitoringSources = async ({
  task,
  config = getContentOperationsConfig(),
  now = new Date(),
} = {}) => {
  const currentBlog = await blog
    .findById(task.blogId)
    .select(
      "_id blog_slug canonicalUrl contentRevisionHash isPublished isDraft createdAt updatedAt isQaTest qaBatchId qaCaseId environment executionMode originalTopicSeed normalizedTopicKey",
    )
    .lean();
  if (!currentBlog) throw new Error("monitored_blog_not_found");
  assertProductionArtifact(currentBlog, "monitored_blog");
  const publicBase = String(
    process.env.PUBLIC_SITE_URL ||
      process.env.APP_BASE_URL ||
      "https://inoxpran.com",
  ).replace(/\/+$/, "");
  const path = `/blog/${currentBlog.blog_slug}`;
  const canonical = String(
    currentBlog.canonicalUrl || `${publicBase}${path}`,
  ).replace(/\/$/, "");
  const urls = new Set([path, canonical]);
  const days = Math.max(1, windowDays(task.window));
  const expectedRevisionHash = String(
    currentBlog.contentRevisionHash || "",
  ).trim();
  const verificationFilter = {
    blogId: task.blogId,
    contentWorkOrderId: task.contentWorkOrderId,
    ...(expectedRevisionHash ? { expectedRevisionHash } : {}),
  };
  const metadataChangedAt = currentBlog.updatedAt || currentBlog.createdAt;
  const [searchResult, analyticsResult, verification, inventory] =
    await Promise.all([
      new SearchConsoleAdapter({
        config: { ...config.searchConsole, windows: [days] },
        now: () => now,
      }).read(),
      new AggregateAnalyticsAdapter({
        config: { ...config.aggregateAnalytics, windows: [days] },
        now: () => now,
      }).read(),
      PostPublishVerification.findOne(verificationFilter)
        .sort({ checkedAt: -1 })
        .lean(),
      ContentInventoryItem.findOne({
        blogId: task.blogId,
        ...productionArtifactScopeFilter(),
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);
  const searchWindow =
    searchResult.windows?.find(
      (item) => item.days === days && item.status === "available",
    ) || null;
  const searchPage = selectPage(searchWindow?.topPages, urls);
  const analyticsPeriod =
    analyticsResult.periods?.find(
      (item) => item.days === days && item.status === "available",
    ) || null;
  const analyticsPage = selectPage(analyticsPeriod?.pages, urls);
  const inventoryWarnings = inventory?.warnings || [];
  return {
    searchConsole: {
      configured: searchResult.configured === true,
      status: searchPage ? "available" : "unavailable",
      clicks: searchPage?.clicks ?? null,
      impressions: searchPage?.impressions ?? null,
      ctr: searchPage?.ctr ?? null,
      averagePosition: searchPage?.position ?? null,
      queries: [],
    },
    analytics: {
      configured: analyticsResult.configured === true,
      status: analyticsPage ? "available" : "unavailable",
      views: analyticsPage?.views ?? null,
      engagedSessions: analyticsPage?.engagedSessions ?? null,
      engagementTime: analyticsPage?.engagementTimeMs ?? null,
      productLinkClicks: analyticsPage?.productLinkClicks ?? null,
      conversionAssist: null,
    },
    technical: verification
      ? {
          pass: verification.pass,
          status: verification.status,
          verificationId: verification._id,
          checkedAt: verification.checkedAt,
        }
      : { pass: null, status: "unavailable" },
    contentState: {
      published:
        currentBlog.isPublished === true && currentBlog.isDraft !== true,
      daysSinceMetadataChange: daysSince(metadataChangedAt, now),
      reviewStatus: inventory?.reviewStatus || null,
      weakInternalLinks: inventoryWarnings.some((warning) =>
        /internal_link|orphan/i.test(warning),
      ),
      cannibalizationConfirmed: inventoryWarnings.some((warning) =>
        /cannibal/i.test(warning),
      ),
      decayConfirmed: false,
      competingBlogIds: inventory?.duplicateIntentBlogIds || [],
      verifiedQueryGaps: [],
      missingSections: [],
    },
    productState: {
      outdatedReference: inventoryWarnings.some((warning) =>
        /outdated_product|stale_product/i.test(warning),
      ),
      inactiveProductReference: inventoryWarnings.some((warning) =>
        /inactive_product|out_of_stock/i.test(warning),
      ),
    },
    warnings: [
      ...new Set([
        ...(searchResult.warnings || []),
        ...(analyticsResult.warnings || []),
      ]),
    ],
  };
};

const deriveLearningRecommendation = ({
  snapshots = [],
  minimumImpressions = 100,
  minimumDays = 14,
  daysSinceMetadataChange = 0,
} = {}) => {
  const ordered = [...snapshots].sort(
    (left, right) => windowDays(left.window) - windowDays(right.window),
  );
  const latest = ordered.at(-1) || null;
  if (!latest)
    return {
      recommendation: "monitor_longer",
      confidence: 1,
      reasons: ["no_performance_snapshots"],
      minimumThresholdsMet: false,
    };

  const ageDays = windowDays(latest.window);
  const impressions = nullableMetric(latest.searchConsole?.impressions);
  const thresholdsMet =
    ageDays >= minimumDays &&
    impressions !== null &&
    impressions >= minimumImpressions;
  const base = {
    minimumThresholdsMet: thresholdsMet,
    requiresNewWorkOrder: false,
  };

  if (
    latest.technical?.pass === false ||
    latest.technical?.criticalFailure === true
  ) {
    return {
      ...base,
      recommendation: "update",
      confidence: 0.95,
      reasons: ["technical_failure"],
      requiresNewWorkOrder: true,
    };
  }
  if (
    latest.productState?.outdatedReference === true ||
    latest.productState?.inactiveProductReference === true
  ) {
    return {
      ...base,
      recommendation: "replace_outdated_product_reference",
      confidence: 0.9,
      reasons: ["outdated_product_reference"],
      requiresNewWorkOrder: true,
    };
  }
  if (
    latest.contentState?.cannibalizationConfirmed === true &&
    (latest.contentState?.competingBlogIds || []).length > 0
  ) {
    return {
      ...base,
      recommendation: "merge",
      confidence: 0.85,
      reasons: ["confirmed_cannibalization"],
      requiresNewWorkOrder: true,
    };
  }
  if (latest.contentState?.weakInternalLinks === true) {
    return {
      ...base,
      recommendation: "improve_internal_links",
      confidence: 0.8,
      reasons: ["weak_internal_links"],
      requiresNewWorkOrder: true,
    };
  }
  if (!thresholdsMet) {
    return {
      ...base,
      recommendation: "monitor_longer",
      confidence: 0.9,
      reasons: ["minimum_time_or_sample_threshold_not_met"],
    };
  }
  const ctr = nullableMetric(latest.searchConsole?.ctr);
  if (ctr !== null && ctr < 0.02 && daysSinceMetadataChange >= 30) {
    return {
      ...base,
      recommendation: "metadata_refresh",
      confidence: 0.75,
      reasons: ["sustained_low_ctr_with_impressions"],
      requiresNewWorkOrder: true,
    };
  }
  if (latest.contentState?.decayConfirmed === true) {
    return {
      ...base,
      recommendation: "update",
      confidence: 0.8,
      reasons: ["confirmed_content_decay"],
      requiresNewWorkOrder: true,
    };
  }
  if (
    latest.contentState?.verifiedQueryGaps?.length ||
    latest.contentState?.missingSections?.length
  ) {
    return {
      ...base,
      recommendation: "expand",
      confidence: 0.75,
      reasons: ["verified_query_or_section_gap"],
      requiresNewWorkOrder: true,
    };
  }
  return {
    ...base,
    recommendation: "keep",
    confidence: 0.7,
    reasons: ["minimum_thresholds_met_without_actionable_regression"],
  };
};

const LEARNING_ACTIONS = Object.freeze({
  expand: "expand",
  update: "update",
  metadata_refresh: "metadata_refresh",
  improve_internal_links: "internal_link_maintenance",
  replace_outdated_product_reference: "content_maintenance",
  merge: "merge",
});

const resolveQuery = async (query) =>
  typeof query?.lean === "function" ? query.lean() : query;

const findCompletedGenerationSnapshots = async (
  { blogId, contentWorkOrderId } = {},
  {
    TaskModel = ContentMonitoringTask,
    SnapshotModel = ContentPerformanceSnapshot,
  } = {},
) => {
  let taskQuery = TaskModel.find({
    blogId,
    contentWorkOrderId,
    status: "complete",
    performanceSnapshotId: { $ne: null },
  });
  if (typeof taskQuery?.select === "function") {
    taskQuery = taskQuery.select(
      "_id claimGeneration performanceSnapshotId completedAt",
    );
  }
  const completedTasks = await resolveQuery(taskQuery);
  const generations = (Array.isArray(completedTasks) ? completedTasks : [])
    .map((task) => ({
      taskId: task?._id || task?.id,
      snapshotId: task?.performanceSnapshotId,
      monitoringClaimGeneration: normalizeClaimGeneration(
        task?.claimGeneration,
      ),
    }))
    .filter(
      ({ taskId, snapshotId, monitoringClaimGeneration }) =>
        taskId && snapshotId && monitoringClaimGeneration,
    );
  if (!generations.length) return [];

  let snapshotQuery = SnapshotModel.find({
    blogId,
    contentWorkOrderId,
    $or: generations.map(
      ({ taskId, snapshotId, monitoringClaimGeneration }) => ({
        _id: snapshotId,
        monitoringTaskId: taskId,
        monitoringClaimGeneration,
      }),
    ),
  });
  if (typeof snapshotQuery?.sort === "function") {
    snapshotQuery = snapshotQuery.sort({ measuredAt: 1 });
  }
  const snapshots = await resolveQuery(snapshotQuery);
  const allowed = new Set(
    generations.map(
      ({ taskId, snapshotId, monitoringClaimGeneration }) =>
        `${String(snapshotId)}:${String(taskId)}:${monitoringClaimGeneration}`,
    ),
  );
  return (Array.isArray(snapshots) ? snapshots : []).filter((snapshot) =>
    allowed.has(
      `${String(snapshot?._id || snapshot?.id)}:${String(snapshot?.monitoringTaskId)}:${normalizeClaimGeneration(snapshot?.monitoringClaimGeneration)}`,
    ),
  );
};

const createLearningWorkOrder = async (
  { learning, sourceWorkOrderId, latestSnapshot = {}, now = new Date() } = {},
  dependencies = {},
) => {
  if (!learning?.requiresNewWorkOrder) return null;
  const WorkOrderModel = dependencies.WorkOrderModel || ContentWorkOrder;
  const DecisionModel =
    dependencies.DecisionModel || ContentOpportunityDecision;
  const LearningModel = dependencies.LearningModel || ContentLearningRecord;
  const auditWriter = dependencies.auditWriter || writeContentOperationsAudit;
  if (learning.generatedWorkOrderId) {
    const generated = await resolveQuery(
      WorkOrderModel.findById(learning.generatedWorkOrderId),
    );
    return assertProductionArtifact(generated, "generated_learning_work_order");
  }
  const learningId = learning._id || learning.id;
  if (!learningId || typeof LearningModel.findOneAndUpdate !== "function") {
    throw new Error("learning_record_persistence_required");
  }
  const claimToken = createLeaseOwner(
    dependencies.workerId || "content-learning",
    "content-learning",
  );
  const claimedLearning = await resolveQuery(
    LearningModel.findOneAndUpdate(
      {
        _id: learningId,
        requiresNewWorkOrder: true,
        generatedWorkOrderId: null,
        status: { $in: ["proposed", "converted"] },
        $or: [
          { leaseUntil: null },
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          lockedBy: claimToken,
          leaseUntil: new Date(now.getTime() + LEARNING_LEASE_MS),
        },
      },
      { new: true, runValidators: true },
    ),
  );
  if (!claimedLearning) {
    const current =
      typeof LearningModel.findById === "function"
        ? await resolveQuery(LearningModel.findById(learningId))
        : null;
    if (current?.generatedWorkOrderId) {
      const generated = await resolveQuery(
        WorkOrderModel.findById(current.generatedWorkOrderId),
      );
      return assertProductionArtifact(generated, "generated_learning_work_order");
    }
    throw new Error("learning_record_claim_unavailable");
  }

  const activeLearning = { ...learning, ...claimedLearning };
  const action = LEARNING_ACTIONS[activeLearning.recommendation];
  if (!action) {
    await LearningModel.updateOne(
      { _id: learningId, lockedBy: claimToken },
      { $set: { leaseUntil: null, lockedBy: "" } },
    );
    return null;
  }

  try {
    const sourceWorkOrder = await resolveQuery(
      WorkOrderModel.findById(sourceWorkOrderId),
    );
    assertProductionArtifact(sourceWorkOrder, "learning_source_work_order");
    if (
      !sourceWorkOrder?.contentOperationsSnapshotId ||
      !sourceWorkOrder?.googleIntelSnapshotId
    ) {
      throw new Error("learning_source_work_order_context_missing");
    }

    const blogId = activeLearning.blogId || latestSnapshot.blogId;
    const competingBlogIds = (
      latestSnapshot.contentState?.competingBlogIds || []
    )
      .map(String)
      .filter((id) => id && id !== String(blogId));
    if (action === "merge" && competingBlogIds.length === 0)
      throw new Error("learning_merge_sources_missing");
    const learningKey = String(
      learningId ||
        activeLearning.contentHash ||
        `${blogId}:${sourceWorkOrderId}`,
    );
    const candidateId = `learning-${crypto.createHash("sha256").update(learningKey).digest("hex").slice(0, 32)}`;
    const decisionDocument = {
      contentOperationsSnapshotId: sourceWorkOrder.contentOperationsSnapshotId,
      contentInventorySnapshotId:
        sourceWorkOrder.metadata?.contentInventorySnapshotId || null,
      candidateId,
      decisionType: action,
      topic: String(
        sourceWorkOrder.topic || `Content learning follow-up for ${blogId}`,
      ).slice(0, 300),
      targetBlogIds: [blogId, ...(action === "merge" ? competingBlogIds : [])],
      primaryTargetBlogId: blogId,
      totalScore: Math.min(
        1,
        Math.max(0, Number(activeLearning.confidence) || 0),
      ),
      scoreBreakdown: {
        learningConfidence: Number(activeLearning.confidence) || 0,
      },
      positiveEvidence: activeLearning.evidence || [],
      penalties: [],
      requiredData: [],
      missingData: [],
      risks: ["learning_recommendation_requires_editorial_review"],
      recommendedAction: action,
      rejectedAlternatives: [],
      decisionReason:
        `Content learning recommendation: ${(activeLearning.reasons || []).join(", ") || activeLearning.recommendation}`.slice(
          0,
          2000,
        ),
      status: "selected",
      selectedAt: now,
      contentHash: crypto
        .createHash("sha256")
        .update(JSON.stringify({ learningKey, action, blogId }))
        .digest("hex"),
      metadata: {
        source: "content_learning",
        learningRecordId: learningId,
        sourceContentWorkOrderId: sourceWorkOrderId,
      },
    };
    const decision = await DecisionModel.findOneAndUpdate(
      {
        contentOperationsSnapshotId:
          decisionDocument.contentOperationsSnapshotId,
        candidateId,
        ...productionArtifactScopeFilter(),
      },
      { $setOnInsert: decisionDocument },
      { upsert: true, new: true, runValidators: true },
    );
    assertProductionArtifact(decision, "learning_opportunity_decision");
    const workOrder = await ContentWorkOrderService.createFromDecision({
      decision,
      WorkOrderModel,
      input: {
        contentOperationsSnapshotId:
          sourceWorkOrder.contentOperationsSnapshotId,
        googleIntelSnapshotId: sourceWorkOrder.googleIntelSnapshotId,
        status: "planned",
        priority: Number(activeLearning.confidence) >= 0.85 ? "high" : "medium",
        topic: decisionDocument.topic,
        targetBlogId: blogId,
        mergeSourceBlogIds: action === "merge" ? competingBlogIds : [],
        primaryBusinessGoal:
          action === "internal_link_maintenance"
            ? "internal_link_improvement"
            : "content_maintenance",
        targetAudience: sourceWorkOrder.targetAudience || [],
        primarySearchIntent: sourceWorkOrder.primarySearchIntent || "",
        userProblems: sourceWorkOrder.userProblems || [],
        successMetrics: [
          { metric: "learning_recommendation_resolved", target: true },
        ],
        requiredEvidence: activeLearning.evidence || [],
        productIntegrationPolicy: { mode: "off" },
        decisionReason: decisionDocument.decisionReason,
        warnings: [
          "Generated from a learning recommendation; editorial approval is required.",
        ],
        metadata: {
          source: "content_learning",
          learningRecordId: learningId,
          sourceContentWorkOrderId: sourceWorkOrderId,
        },
      },
    });
    assertProductionArtifact(workOrder, "learning_work_order");
    const workOrderId = workOrder?._id || workOrder?.id || null;
    const terminal = await LearningModel.updateOne(
      {
        _id: learningId,
        lockedBy: claimToken,
        status: { $in: ["proposed", "converted"] },
      },
      {
        $set: {
          status: "converted",
          generatedWorkOrderId: workOrderId,
          leaseUntil: null,
          lockedBy: "",
        },
      },
    );
    if (explicitOwnerUpdateFailed(terminal)) {
      const current =
        typeof LearningModel.findById === "function"
          ? await resolveQuery(LearningModel.findById(learningId))
          : null;
      if (
        String(current?.generatedWorkOrderId || "") !==
        String(workOrderId || "")
      ) {
        throw new Error("learning_record_lease_lost");
      }
    }
    await auditWriter({
      action: "learning_work_order_created",
      entityType: "ContentLearningRecord",
      entityId: learningId,
      contentWorkOrderId: workOrderId,
      reason:
        "A high-impact learning recommendation created a planned Work Order for editorial review.",
      correlationId: candidateId,
      metadata: {
        recommendation: activeLearning.recommendation,
        autoApplied: false,
      },
    }).catch(() => null);
    return workOrder;
  } catch (error) {
    await LearningModel.updateOne(
      { _id: learningId, lockedBy: claimToken },
      { $set: { leaseUntil: null, lockedBy: "" } },
    ).catch(() => null);
    throw error;
  }
};

class PerformanceLearningService {
  static buildMonitoringTasks(input) {
    return buildMonitoringTasks(input);
  }

  static async scheduleMonitoring(
    input,
    { TaskModel = ContentMonitoringTask } = {},
  ) {
    const tasks = buildMonitoringTasks(input);
    const persisted = [];
    for (const task of tasks) {
      persisted.push(
        await TaskModel.findOneAndUpdate(
          {
            blogId: task.blogId,
            contentWorkOrderId: task.contentWorkOrderId,
            window: task.window,
          },
          { $setOnInsert: task },
          { upsert: true, new: true, runValidators: true },
        ),
      );
    }
    return persisted;
  }

  static buildPerformanceSnapshot(input) {
    return buildPerformanceSnapshot(input);
  }

  static async recordPerformance(
    input,
    {
      SnapshotModel = ContentPerformanceSnapshot,
      TaskModel = ContentMonitoringTask,
      claimToken = input?.task?.lockedBy || "",
      completeTask = true,
    } = {},
  ) {
    const document = buildPerformanceSnapshot(input);
    const generation = normalizeClaimGeneration(
      document.monitoringClaimGeneration,
    );
    if (
      !claimToken ||
      claimToken !== document.monitoringClaimToken ||
      !generation
    ) {
      throw new Error("monitoring_task_claim_required");
    }
    let snapshot;
    try {
      snapshot = await SnapshotModel.findOneAndUpdate(
        {
          monitoringTaskId: document.monitoringTaskId,
          $or: [
            { monitoringClaimGeneration: { $exists: false } },
            { monitoringClaimGeneration: { $lt: generation } },
            {
              monitoringClaimGeneration: generation,
              monitoringClaimToken: claimToken,
            },
          ],
        },
        { $set: document },
        { upsert: true, new: true, runValidators: true },
      );
    } catch (error) {
      if (error?.code === 11000) throw createMonitoringLeaseLostError();
      throw error;
    }
    if (
      !snapshot ||
      normalizeClaimGeneration(snapshot.monitoringClaimGeneration) !==
        generation
    ) {
      throw createMonitoringLeaseLostError();
    }
    if (snapshot?._id && completeTask) {
      const terminal = await TaskModel.updateOne(
        {
          _id: document.monitoringTaskId,
          status: "running",
          lockedBy: claimToken,
          claimGeneration: generation,
        },
        {
          $set: {
            status: "complete",
            completedAt: document.measuredAt,
            performanceSnapshotId: snapshot._id,
            leaseUntil: null,
            lockedBy: "",
          },
        },
      );
      if (explicitOwnerUpdateFailed(terminal))
        throw createMonitoringLeaseLostError();
    }
    return snapshot;
  }

  static deriveRecommendation(input) {
    return deriveLearningRecommendation(input);
  }

  static createLearningWorkOrder(input, dependencies) {
    return createLearningWorkOrder(input, dependencies);
  }

  static async createLearningRecord(
    { blogId, contentWorkOrderId, snapshots = [], ...options } = {},
    { LearningModel = ContentLearningRecord } = {},
  ) {
    if (!blogId || !contentWorkOrderId)
      throw new Error("blogId and contentWorkOrderId are required");
    const result = deriveLearningRecommendation({ snapshots, ...options });
    const performanceSnapshotIds = snapshots
      .map((snapshot) => snapshot._id || snapshot.id)
      .filter(Boolean);
    const contentHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          blogId: String(blogId),
          contentWorkOrderId: String(contentWorkOrderId),
          performanceSnapshotIds: performanceSnapshotIds.map(String).sort(),
          result,
        }),
      )
      .digest("hex");
    return LearningModel.findOneAndUpdate(
      { blogId, contentHash },
      {
        $setOnInsert: {
          blogId,
          contentWorkOrderId,
          performanceSnapshotIds,
          ...result,
          evidence: snapshots.map((snapshot) => ({
            id: snapshot._id || snapshot.id || null,
            window: snapshot.window,
          })),
          autoApplied: false,
          status: "proposed",
          contentHash,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
  }

  static async runDueOnce(
    { workerId = "content-performance-worker", now = new Date() } = {},
    dependencies = {},
  ) {
    const config = dependencies.config || getContentOperationsConfig();
    if (!config.enabled || !config.performanceMonitoring.enabled) return null;
    const TaskModel = dependencies.TaskModel || ContentMonitoringTask;
    const SnapshotModel =
      dependencies.SnapshotModel || ContentPerformanceSnapshot;
    const LearningModel = dependencies.LearningModel || ContentLearningRecord;
    const ownerToken = createLeaseOwner(workerId);
    const leaseUntil = new Date(now.getTime() + MONITORING_LEASE_MS);
    const task = await TaskModel.findOneAndUpdate(
      {
        dueAt: { $lte: now },
        $or: [
          { status: "pending" },
          { status: "failed", attemptCount: { $lt: 3 } },
          { status: "running", leaseUntil: { $lt: now } },
        ],
      },
      {
        $set: {
          status: "running",
          leaseUntil,
          lockedBy: ownerToken,
          lastError: "",
        },
        $inc: { claimGeneration: 1 },
      },
      { sort: { dueAt: 1 }, new: true, runValidators: true },
    );
    if (!task) return null;
    const claimGeneration = normalizeClaimGeneration(task.claimGeneration);
    if (!claimGeneration) {
      throw new Error("monitoring_task_claim_generation_required");
    }
    const heartbeatFactory =
      dependencies.heartbeatFactory || createMonitoringLeaseHeartbeat;
    const heartbeat = heartbeatFactory({
      TaskModel,
      taskId: task._id,
      ownerToken,
      claimGeneration,
      leaseMs: MONITORING_LEASE_MS,
      clock: dependencies.clock || (() => new Date()),
    });
    try {
      const sources = dependencies.collectSources
        ? await dependencies.collectSources({ task, now })
        : await collectMonitoringSources({ task, now });
      if (!(await heartbeat.beat())) throw createMonitoringLeaseLostError();
      const snapshot = await PerformanceLearningService.recordPerformance(
        { task, sources, measuredAt: now },
        {
          SnapshotModel,
          TaskModel,
          claimToken: ownerToken,
          completeTask: false,
        },
      );
      if (!(await heartbeat.beat())) throw createMonitoringLeaseLostError();
      await heartbeat.stop();
      const terminal = await TaskModel.updateOne(
        {
          _id: task._id,
          status: "running",
          lockedBy: ownerToken,
          claimGeneration,
        },
        {
          $set: {
            status: "complete",
            completedAt: now,
            performanceSnapshotId: snapshot._id,
            leaseUntil: null,
            lockedBy: "",
          },
        },
      );
      if (explicitOwnerUpdateFailed(terminal))
        throw createMonitoringLeaseLostError();

      let learning = null;
      let learningWorkOrder = null;
      let learningError = null;
      if (config.learning.enabled) {
        try {
          const snapshots = await findCompletedGenerationSnapshots(
            {
              blogId: task.blogId,
              contentWorkOrderId: task.contentWorkOrderId,
            },
            { TaskModel, SnapshotModel },
          );
          if (!snapshots.length)
            throw new Error("authoritative_performance_snapshot_not_found");
          const latestSnapshot = [...snapshots]
            .sort(
              (left, right) =>
                new Date(left.measuredAt || 0).getTime() -
                new Date(right.measuredAt || 0).getTime(),
            )
            .at(-1);
          learning = await PerformanceLearningService.createLearningRecord(
            {
              blogId: task.blogId,
              contentWorkOrderId: task.contentWorkOrderId,
              snapshots,
              minimumImpressions: config.learning.minimumImpressions,
              minimumDays: config.learning.minimumAgeDays,
              daysSinceMetadataChange: positiveNumber(
                latestSnapshot?.contentState?.daysSinceMetadataChange,
                0,
                { min: 0, max: 36500 },
              ),
            },
            { LearningModel },
          );
          learningWorkOrder = await createLearningWorkOrder(
            {
              learning,
              sourceWorkOrderId: task.contentWorkOrderId,
              latestSnapshot,
              now,
            },
            {
              WorkOrderModel: dependencies.WorkOrderModel,
              DecisionModel: dependencies.DecisionModel,
              LearningModel,
              auditWriter: dependencies.auditWriter,
              workerId: ownerToken,
            },
          );
        } catch {
          learningError = "CONTENT_LEARNING_FAILED";
          const auditWriter =
            dependencies.auditWriter || writeContentOperationsAudit;
          await Promise.resolve()
            .then(() =>
              auditWriter({
                action: "content_learning_failed",
                entityType: "ContentMonitoringTask",
                entityId: task._id,
                contentWorkOrderId: task.contentWorkOrderId,
                reason:
                  "Performance capture completed, but the isolated learning step failed.",
                correlationId: ownerToken,
                metadata: { errorCode: learningError, claimGeneration },
              }),
            )
            .catch(() => null);
        }
      }
      return { task, snapshot, learning, learningWorkOrder, learningError };
    } catch (error) {
      await heartbeat.stop();
      await TaskModel.updateOne(
        {
          _id: task._id,
          status: "running",
          lockedBy: ownerToken,
          claimGeneration,
        },
        {
          $set: {
            status: "failed",
            leaseUntil: null,
            lockedBy: "",
            dueAt: new Date(now.getTime() + 15 * 60 * 1000),
            lastError:
              error?.code === "MONITORING_TASK_LEASE_LOST"
                ? "MONITORING_TASK_LEASE_LOST"
                : "PERFORMANCE_MONITORING_FAILED",
          },
          $inc: { attemptCount: 1 },
        },
      );
      throw error;
    } finally {
      await heartbeat.stop();
    }
  }
}

module.exports = {
  PerformanceLearningService,
  WINDOW_MS,
  buildMonitoringTasks,
  buildPerformanceSnapshot,
  collectMonitoringSources,
  createLeaseOwner,
  createLearningWorkOrder,
  createMonitoringLeaseHeartbeat,
  daysSince,
  deriveLearningRecommendation,
  normalizeSourceMetrics,
  nullableMetric,
};
