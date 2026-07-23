"use strict";

const crypto = require("node:crypto");
const {
  ACTIONS,
  getContentOperationsConfig,
} = require("../../config/contentOperations.config");
const {
  BlogAutomationExecution,
} = require("../../models/blogAutomationExecution.model");
const {
  BUSINESS_GOALS,
  ContentWorkOrder,
  WORK_ORDER_STATUSES,
} = require("../../models/contentWorkOrder.model");
const {
  inheritTrustedQaProvenance,
} = require("../../utils/qaProvenance.util");

const TARGET_REQUIRED = new Set([
  ACTIONS.UPDATE,
  ACTIONS.EXPAND,
  ACTIONS.METADATA_REFRESH,
  ACTIONS.INTERNAL_LINK_MAINTENANCE,
  ACTIONS.CONTENT_MAINTENANCE,
  ACTIONS.MERGE,
]);

const EXECUTION_TERMINAL_STATUSES = new Set([
  "draft_created",
  "maintenance_created",
  "published",
  "completed",
  "blocked",
  "failed",
  "skipped",
]);

const asNonEmptyStrings = (items) =>
  Array.isArray(items)
    ? [
        ...new Set(
          items.map((item) => String(item || "").trim()).filter(Boolean),
        ),
      ]
    : [];

const getWorkOrderLeaseMinutes = () =>
  getContentOperationsConfig().workOrderLeaseMinutes;

const staleClaimBefore = (now = new Date()) =>
  new Date(now.getTime() - getWorkOrderLeaseMinutes() * 60_000);

const createWorkOrderClaimToken = (workerId = "content-work-order") => {
  const normalizedWorkerId =
    String(workerId || "content-work-order")
      .trim()
      .slice(0, 150) || "content-work-order";
  return `${normalizedWorkerId}:${crypto.randomUUID()}`.slice(0, 200);
};

const explicitOwnerUpdateFailed = (result) => {
  if (Number.isFinite(result?.matchedCount)) return result.matchedCount === 0;
  if (Number.isFinite(result?.n)) return result.n === 0;
  if (Number.isFinite(result?.modifiedCount)) return result.modifiedCount === 0;
  return true;
};

const ownerUpdateMatched = (result) => !explicitOwnerUpdateFailed(result);

const unclaimedWorkOrderFilter = () => ({
  $or: [
    { "metadata.activeClaimToken": { $exists: false } },
    { "metadata.activeClaimToken": { $in: [null, ""] } },
  ],
});

const claimOwnershipFilter = (claimToken = "") =>
  claimToken
    ? { "metadata.activeClaimToken": String(claimToken) }
    : unclaimedWorkOrderFilter();

const unclaimedExecutionFilter = () => ({
  $or: [
    { "metadata.contentWorkOrderClaimToken": { $exists: false } },
    { "metadata.contentWorkOrderClaimToken": { $in: [null, ""] } },
  ],
});

const validateExecutionTransition = ({ executionId, status, updates }) => {
  if (!executionId) throw new Error("executionId is required");
  if (!EXECUTION_TERMINAL_STATUSES.has(status))
    throw new Error("Unsupported execution terminal status");
  if (!updates || typeof updates !== "object" || Array.isArray(updates))
    throw new Error("updates must be an object");
  if (Object.prototype.hasOwnProperty.call(updates, "status"))
    throw new Error("updates must not override status");
  if (Object.prototype.hasOwnProperty.call(updates, "completedAt"))
    throw new Error("updates must not override completedAt");
};

const getActiveClaimToken = (workOrder) =>
  String(workOrder?.metadata?.activeClaimToken || "").trim();

const getExecutionClaimToken = (execution) =>
  String(execution?.metadata?.contentWorkOrderClaimToken || "").trim();

const hashClaimToken = (claimToken) =>
  crypto.createHash("sha256").update(String(claimToken || "")).digest("hex");

const isWorkOrderRunnable = (workOrder, { now = new Date() } = {}) =>
  Boolean(
    workOrder &&
    (["planned", "approved", "brief_ready"].includes(workOrder.status) ||
      (workOrder.status === "drafting" &&
        workOrder.lockedAt &&
        new Date(workOrder.lockedAt) < staleClaimBefore(now))),
  );

const buildWorkOrderDocument = ({ decision, input = {} } = {}) => {
  if (!decision)
    throw new Error("A persisted opportunity decision is required");
  const decisionId = decision._id || decision.id;
  if (!decisionId) throw new Error("contentOpportunityDecisionId is required");
  const action = String(
    decision.recommendedAction || decision.decisionType || input.decision || "",
  );
  if (!Object.values(ACTIONS).includes(action))
    throw new Error("Unsupported work-order decision");

  const contentOperationsSnapshotId =
    input.contentOperationsSnapshotId || decision.contentOperationsSnapshotId;
  const googleIntelSnapshotId = input.googleIntelSnapshotId;
  if (!contentOperationsSnapshotId)
    throw new Error("contentOperationsSnapshotId is required");
  if (!googleIntelSnapshotId)
    throw new Error("googleIntelSnapshotId is required");

  const targetBlogId =
    input.targetBlogId ||
    decision.primaryTargetBlogId ||
    decision.targetBlogIds?.[0] ||
    null;
  const mergeSourceBlogIds =
    input.mergeSourceBlogIds ||
    (action === ACTIONS.MERGE ? (decision.targetBlogIds || []).slice(1) : []);
  if (TARGET_REQUIRED.has(action) && !targetBlogId)
    throw new Error(`${action} requires targetBlogId`);
  if (
    action === ACTIONS.MERGE &&
    asNonEmptyStrings(mergeSourceBlogIds).length === 0
  ) {
    throw new Error("merge requires at least one mergeSourceBlogId");
  }
  if (action === ACTIONS.NEW && targetBlogId)
    throw new Error("new must not target an existing blog");

  const primaryBusinessGoal = String(input.primaryBusinessGoal || "").trim();
  if (!BUSINESS_GOALS.includes(primaryBusinessGoal))
    throw new Error("A supported primaryBusinessGoal is required");
  const successMetrics = Array.isArray(input.successMetrics)
    ? input.successMetrics.filter(Boolean)
    : [];
  if (successMetrics.length === 0)
    throw new Error("At least one measurable success metric is required");

  const qaProvenance = inheritTrustedQaProvenance({
    anchor: decision,
    candidates: [input, input.qaContext, input.metadata],
  });

  return {
    ...(qaProvenance || {}),
    contentOperationsSnapshotId,
    googleIntelSnapshotId,
    contentOpportunityDecisionId: decisionId,
    decision: action,
    status: input.status || "planned",
    priority: ["low", "medium", "high", "critical"].includes(input.priority)
      ? input.priority
      : Number(decision.totalScore || 0) >= 0.85
        ? "high"
        : Number(decision.totalScore || 0) >= 0.65
          ? "medium"
          : "low",
    topic: String(input.topic ?? decision.topic ?? "").trim(),
    topicLocked: input.topicLocked === true,
    targetBlogId,
    mergeSourceBlogIds,
    primaryBusinessGoal,
    secondaryBusinessGoals: asNonEmptyStrings(
      input.secondaryBusinessGoals,
    ).filter((goal) => BUSINESS_GOALS.includes(goal)),
    targetAudience: asNonEmptyStrings(input.targetAudience),
    funnelStage: String(input.funnelStage || "").trim(),
    primarySearchIntent: String(input.primarySearchIntent || "").trim(),
    secondarySearchIntents: asNonEmptyStrings(input.secondarySearchIntents),
    userProblems: asNonEmptyStrings(input.userProblems),
    customerQuestions: asNonEmptyStrings(input.customerQuestions),
    opportunityScore: Number(
      decision.totalScore ?? input.opportunityScore ?? 0,
    ),
    scoreBreakdown: decision.scoreBreakdown || input.scoreBreakdown || {},
    requiredSources: Array.isArray(input.requiredSources)
      ? input.requiredSources
      : [],
    requiredEvidence: Array.isArray(input.requiredEvidence)
      ? input.requiredEvidence
      : [],
    productIntegrationPolicy: input.productIntegrationPolicy || { mode: "off" },
    targetPublishDate: input.targetPublishDate || null,
    owner: input.owner || null,
    reviewer: input.reviewer || null,
    successMetrics,
    risks: asNonEmptyStrings([
      ...(decision.risks || []),
      ...(input.risks || []),
    ]),
    warnings: asNonEmptyStrings(input.warnings),
    decisionReason: String(
      input.decisionReason || decision.decisionReason || "",
    ).trim(),
    overrideReason: input.overrideReason || null,
    artifactIds: {},
    metadata: {
      sourceCandidateId: decision.candidateId || "",
      ...(input.metadata || {}),
    },
  };
};

class ContentWorkOrderService {
  static buildDocument(input) {
    return buildWorkOrderDocument(input);
  }

  static async createFromDecision({
    decision,
    input,
    WorkOrderModel = ContentWorkOrder,
  }) {
    const document = buildWorkOrderDocument({ decision, input });
    return WorkOrderModel.findOneAndUpdate(
      { contentOpportunityDecisionId: document.contentOpportunityDecisionId },
      { $setOnInsert: document },
      { upsert: true, new: true, runValidators: true },
    );
  }

  static isRunnable(workOrder, options) {
    return isWorkOrderRunnable(workOrder, options);
  }

  static async claimForProduction({
    workOrderId,
    planningCorrelationId,
    executionId = null,
    workerId = "content-work-order",
    now = new Date(),
    WorkOrderModel = ContentWorkOrder,
  }) {
    if (!workOrderId) throw new Error("workOrderId is required");
    const claimToken = createWorkOrderClaimToken(workerId);
    const claimed = await WorkOrderModel.findOneAndUpdate(
      {
        _id: workOrderId,
        $or: [
          { status: { $in: ["planned", "approved", "brief_ready"] } },
          { status: "drafting", lockedAt: { $lt: staleClaimBefore(now) } },
        ],
      },
      {
        $set: {
          status: "drafting",
          lockedAt: now,
          "metadata.activeClaimToken": claimToken,
          "metadata.activePlanningCorrelationId": String(
            planningCorrelationId || "",
          ),
          ...(executionId ? { "metadata.activeExecutionId": executionId } : {}),
        },
      },
      { new: true, runValidators: true },
    );
    return typeof claimed?.toObject === "function"
      ? claimed.toObject()
      : claimed;
  }

  static async bindExecution({
    workOrderId,
    planningCorrelationId,
    executionId,
    claimToken = "",
    WorkOrderModel = ContentWorkOrder,
  }) {
    if (!workOrderId || !executionId)
      throw new Error("workOrderId and executionId are required");
    return WorkOrderModel.findOneAndUpdate(
      {
        _id: workOrderId,
        status: "drafting",
        "metadata.activePlanningCorrelationId": String(
          planningCorrelationId || "",
        ),
        ...claimOwnershipFilter(claimToken),
      },
      { $set: { "metadata.activeExecutionId": executionId } },
      { new: true, runValidators: true },
    );
  }

  static async renewProductionClaim({
    workOrderId,
    claimToken,
    now = new Date(),
    WorkOrderModel = ContentWorkOrder,
  }) {
    if (!workOrderId || !claimToken)
      throw new Error("workOrderId and claimToken are required");
    const result = await WorkOrderModel.updateOne(
      {
        _id: workOrderId,
        status: "drafting",
        "metadata.activeClaimToken": String(claimToken),
      },
      { $set: { lockedAt: now } },
    );
    return !explicitOwnerUpdateFailed(result);
  }

  static async bindExecutionClaim({
    executionId,
    workOrderId,
    claimToken,
    ExecutionModel = BlogAutomationExecution,
  }) {
    if (!executionId || !workOrderId || !claimToken) {
      throw new Error("executionId, workOrderId and claimToken are required");
    }
    const normalizedClaimToken = String(claimToken);
    const result = await ExecutionModel.updateOne(
      {
        _id: executionId,
        status: "running",
        $and: [
          {
            $or: [
              { contentWorkOrderId: workOrderId },
              { contentWorkOrderId: null },
              { contentWorkOrderId: { $exists: false } },
            ],
          },
          {
            $or: [
              { "metadata.contentWorkOrderClaimToken": normalizedClaimToken },
              ...unclaimedExecutionFilter().$or,
            ],
          },
        ],
      },
      {
        $set: {
          contentWorkOrderId: workOrderId,
          "metadata.contentWorkOrderClaimToken": normalizedClaimToken,
        },
      },
    );
    return ownerUpdateMatched(result);
  }

  static async transitionExecutionClaimed({
    executionId,
    workOrderId,
    claimToken,
    status,
    updates = {},
    completedAt = new Date(),
    fromStatuses = ["running"],
    ExecutionModel = BlogAutomationExecution,
  }) {
    validateExecutionTransition({ executionId, status, updates });
    if (!workOrderId || !claimToken)
      throw new Error("workOrderId and claimToken are required");
    const allowedFromStatuses = asNonEmptyStrings(fromStatuses).filter(
      (item) => item === "running" || item === "committing",
    );
    if (!allowedFromStatuses.length)
      throw new Error("At least one supported claimed execution source status is required");
    const result = await ExecutionModel.updateOne(
      {
        _id: executionId,
        contentWorkOrderId: workOrderId,
        status: { $in: allowedFromStatuses },
        "metadata.contentWorkOrderClaimToken": String(claimToken),
      },
      {
        $set: {
          ...updates,
          status,
          completedAt,
          "metadata.completedWorkOrderClaimTokenHash": hashClaimToken(claimToken),
          "metadata.contentWorkOrderClaimToken": "",
        },
      },
    );
    return ownerUpdateMatched(result);
  }

  static async transitionExecutionUnclaimed({
    executionId,
    status,
    updates = {},
    completedAt = new Date(),
    fromStatuses = ["running"],
    ExecutionModel = BlogAutomationExecution,
  }) {
    validateExecutionTransition({ executionId, status, updates });
    const allowedFromStatuses = asNonEmptyStrings(fromStatuses).filter(
      (item) => item === "queued" || item === "running" || item === "committing",
    );
    if (!allowedFromStatuses.length)
      throw new Error(
        "At least one supported execution source status is required",
      );
    const result = await ExecutionModel.updateOne(
      {
        _id: executionId,
        status: { $in: allowedFromStatuses },
        ...unclaimedExecutionFilter(),
      },
      {
        $set: {
          ...updates,
          status,
          completedAt,
        },
      },
    );
    return ownerUpdateMatched(result);
  }

  static async transitionClaimed({
    workOrderId,
    claimToken,
    status,
    updates = {},
    WorkOrderModel = ContentWorkOrder,
  }) {
    if (!workOrderId || !claimToken)
      throw new Error("workOrderId and claimToken are required");
    if (!WORK_ORDER_STATUSES.includes(status))
      throw new Error("Unsupported Work Order terminal status");
    if (!updates || typeof updates !== "object" || Array.isArray(updates))
      throw new Error("updates must be an object");
    const claimed = await WorkOrderModel.findOneAndUpdate(
      {
        _id: workOrderId,
        status: "drafting",
        "metadata.activeClaimToken": String(claimToken),
      },
      {
        $set: {
          ...updates,
          status,
          lockedAt: null,
          "metadata.completedClaimTokenHash": hashClaimToken(claimToken),
          "metadata.activeClaimToken": "",
        },
      },
      { new: true, runValidators: true },
    );
    return typeof claimed?.toObject === "function"
      ? claimed.toObject()
      : claimed;
  }

  static async transitionUnclaimed({
    workOrderId,
    status,
    updates = {},
    fromStatuses = ["drafting"],
    WorkOrderModel = ContentWorkOrder,
  }) {
    if (!workOrderId) throw new Error("workOrderId is required");
    if (!WORK_ORDER_STATUSES.includes(status))
      throw new Error("Unsupported Work Order terminal status");
    if (!updates || typeof updates !== "object" || Array.isArray(updates))
      throw new Error("updates must be an object");
    const allowedFromStatuses = asNonEmptyStrings(fromStatuses).filter((item) =>
      WORK_ORDER_STATUSES.includes(item),
    );
    if (!allowedFromStatuses.length)
      throw new Error("At least one supported source status is required");
    const transitioned = await WorkOrderModel.findOneAndUpdate(
      {
        _id: workOrderId,
        status: { $in: allowedFromStatuses },
        ...unclaimedWorkOrderFilter(),
      },
      {
        $set: {
          ...updates,
          status,
          lockedAt: null,
        },
      },
      { new: true, runValidators: true },
    );
    return typeof transitioned?.toObject === "function"
      ? transitioned.toObject()
      : transitioned;
  }

  static async attachArtifact({
    workOrderId,
    artifactType,
    artifactId,
    claimToken = "",
    WorkOrderModel = ContentWorkOrder,
  }) {
    if (!workOrderId || !artifactType || !artifactId)
      throw new Error("workOrderId, artifactType and artifactId are required");
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(artifactType))
      throw new Error("Invalid artifactType");
    return WorkOrderModel.findOneAndUpdate(
      {
        _id: workOrderId,
        ...(claimToken ? { status: "drafting" } : {}),
        ...claimOwnershipFilter(claimToken),
      },
      { $set: { [`artifactIds.${artifactType}`]: artifactId } },
      { new: true, runValidators: true },
    );
  }
}

module.exports = {
  ContentWorkOrderService,
  buildWorkOrderDocument,
  claimOwnershipFilter,
  createWorkOrderClaimToken,
  EXECUTION_TERMINAL_STATUSES,
  getActiveClaimToken,
  getExecutionClaimToken,
  getWorkOrderLeaseMinutes,
  isWorkOrderRunnable,
  staleClaimBefore,
  unclaimedExecutionFilter,
};
