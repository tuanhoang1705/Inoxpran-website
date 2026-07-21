"use strict";

const crypto = require("node:crypto");
const { ACTIONS } = require("../../config/contentOperations.config");
const {
  UnifiedContentBrief,
} = require("../../models/unifiedContentBrief.model");

const asStrings = (items) =>
  Array.isArray(items)
    ? [
        ...new Set(
          items.map((item) => String(item || "").trim()).filter(Boolean),
        ),
      ]
    : [];
const hasObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value);

const assertBriefComplete = (brief = {}) => {
  const missing = [];
  for (const key of [
    "contentWorkOrderId",
    "topic",
    "workingTitle",
    "primaryBusinessGoal",
    "funnelStage",
    "primarySearchIntent",
    "primaryQuestion",
    "articleType",
    "contentRole",
    "editorialAngle",
  ]) {
    if (!brief[key] || !String(brief[key]).trim()) missing.push(key);
  }
  if (!Array.isArray(brief.targetAudience) || brief.targetAudience.length === 0)
    missing.push("targetAudience");
  if (!Array.isArray(brief.successMetrics) || brief.successMetrics.length === 0)
    missing.push("successMetrics");
  if (
    !Array.isArray(brief.reviewRequirements) ||
    brief.reviewRequirements.length === 0
  )
    missing.push("reviewRequirements");
  if (!hasObject(brief.ctaStrategy)) missing.push("ctaStrategy");
  if (!hasObject(brief.publishTarget)) missing.push("publishTarget");
  if (!Array.isArray(brief.imagePlanRequirements))
    missing.push("imagePlanRequirements");
  if (!Array.isArray(brief.evidenceRequirements))
    missing.push("evidenceRequirements");
  if (missing.length) {
    const error = new Error(
      `Unified Content Brief is incomplete: ${missing.join(", ")}`,
    );
    error.code = "INCOMPLETE_UNIFIED_CONTENT_BRIEF";
    error.missing = missing;
    throw error;
  }
  return true;
};

const buildUnifiedBriefDocument = ({
  workOrder,
  input = {},
  version = 1,
} = {}) => {
  const contentWorkOrderId = workOrder?._id || workOrder?.id;
  if (!contentWorkOrderId)
    throw new Error(
      "A persisted Content Work Order is required before the brief",
    );
  if (workOrder.decision === ACTIONS.SKIP)
    throw new Error(
      "Skip work orders do not invoke brief or writer production",
    );
  const document = {
    contentWorkOrderId,
    version,
    status: input.status || "complete",
    topic: String(input.topic || workOrder.topic || "").trim(),
    workingTitle: String(input.workingTitle || "").trim(),
    language: input.language || "vi",
    primaryBusinessGoal: String(
      input.primaryBusinessGoal || workOrder.primaryBusinessGoal || "",
    ).trim(),
    secondaryBusinessGoals: asStrings(
      input.secondaryBusinessGoals || workOrder.secondaryBusinessGoals,
    ),
    targetAudience: asStrings(input.targetAudience || workOrder.targetAudience),
    funnelStage: String(
      input.funnelStage || workOrder.funnelStage || "",
    ).trim(),
    primarySearchIntent: String(
      input.primarySearchIntent || workOrder.primarySearchIntent || "",
    ).trim(),
    secondarySearchIntents: asStrings(
      input.secondarySearchIntents || workOrder.secondarySearchIntents,
    ),
    primaryQuestion: String(input.primaryQuestion || "").trim(),
    supportingQuestions: asStrings(
      input.supportingQuestions || workOrder.customerQuestions,
    ),
    articleType: String(input.articleType || "").trim(),
    contentRole: String(input.contentRole || "").trim(),
    editorialAngle: String(input.editorialAngle || "").trim(),
    primaryTerms: asStrings(input.primaryTerms),
    relatedTerms: asStrings(input.relatedTerms),
    requiredEntities: asStrings(input.requiredEntities),
    contentGap: asStrings(input.contentGap),
    existingContentReferences: Array.isArray(input.existingContentReferences)
      ? input.existingContentReferences
      : [],
    targetBlogId: input.targetBlogId || workOrder.targetBlogId || null,
    internalLinkCandidates: Array.isArray(input.internalLinkCandidates)
      ? input.internalLinkCandidates
      : [],
    categoryLinkCandidates: Array.isArray(input.categoryLinkCandidates)
      ? input.categoryLinkCandidates
      : [],
    productIntegration: input.productIntegration ||
      workOrder.productIntegrationPolicy || { mode: "off" },
    requiredFacts: Array.isArray(input.requiredFacts)
      ? input.requiredFacts
      : [],
    forbiddenClaims: asStrings(input.forbiddenClaims),
    evidenceRequirements: Array.isArray(input.evidenceRequirements)
      ? input.evidenceRequirements
      : workOrder.requiredEvidence || [],
    editorialStyleConstraints: input.editorialStyleConstraints || {},
    productPlacementConstraints: input.productPlacementConstraints || {},
    imagePlanRequirements: Array.isArray(input.imagePlanRequirements)
      ? input.imagePlanRequirements
      : [],
    ctaStrategy: input.ctaStrategy,
    structuredDataCandidate: input.structuredDataCandidate || null,
    successMetrics: Array.isArray(input.successMetrics)
      ? input.successMetrics
      : workOrder.successMetrics || [],
    publishTarget: input.publishTarget,
    reviewRequirements: asStrings(input.reviewRequirements),
  };
  assertBriefComplete(document);
  document.contentHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(document))
    .digest("hex");
  document.planningRunId = input.planningRunId || null;
  return document;
};

class UnifiedContentBriefService {
  static assertComplete(brief) {
    return assertBriefComplete(brief);
  }
  static buildDocument(input) {
    return buildUnifiedBriefDocument(input);
  }

  static async create({
    workOrder,
    input,
    version = 1,
    BriefModel = UnifiedContentBrief,
  }) {
    const document = buildUnifiedBriefDocument({ workOrder, input, version });
    return BriefModel.findOneAndUpdate(
      { contentWorkOrderId: document.contentWorkOrderId, version },
      { $setOnInsert: document },
      { upsert: true, new: true, runValidators: true },
    );
  }
}

module.exports = {
  UnifiedContentBriefService,
  assertBriefComplete,
  buildUnifiedBriefDocument,
};
