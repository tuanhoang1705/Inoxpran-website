"use strict";

const crypto = require("node:crypto");
const {
  ACTIONS,
  getContentOperationsConfig,
} = require("../../config/contentOperations.config");
const {
  normalizeOpportunityScore,
} = require("./topicRoadmapScoring.service");
const { safeErrorCode } = require("../../utils/httpError.util");
const {
  hasQaProvenanceMarkers,
  normalizeTrustedQaProvenance,
  qaProvenanceMatches,
} = require("../../utils/qaProvenance.util");
const { GoogleIntelligenceService } = require("../googleIntelligence.service");
const {
  ContentInventoryItem,
} = require("../../models/contentInventoryItem.model");
const {
  ContentOperationsRun,
} = require("../../models/contentOperationsRun.model");
const {
  ContentOpportunityDecision,
} = require("../../models/contentOpportunityDecision.model");
const { ContentWorkOrder } = require("../../models/contentWorkOrder.model");
const {
  UnifiedContentBrief,
} = require("../../models/unifiedContentBrief.model");
const {
  ContentOperationsIntelligenceService,
} = require("./contentOperationsIntelligence.service");
const { ContentSignalService } = require("./contentSignal.service");
const {
  ContentOpportunityDecisionService,
} = require("./opportunityDecision.service");
const {
  ContentWorkOrderService,
  isWorkOrderRunnable,
} = require("./workOrder.service");
const { UnifiedContentBriefService } = require("./unifiedBrief.service");
const {
  generateOpportunityCandidates,
} = require("./opportunityCandidate.service");
const { generateBlogIdeas } = require("./blogIdeation.service");

const MODES = new Set(["best_action", "fixed_brief", "maintenance_only"]);
const MAINTENANCE_ACTIONS = new Set([
  ACTIONS.UPDATE,
  ACTIONS.EXPAND,
  ACTIONS.MERGE,
  ACTIONS.METADATA_REFRESH,
  ACTIONS.INTERNAL_LINK_MAINTENANCE,
  ACTIONS.CONTENT_MAINTENANCE,
]);

const asObject = (value) =>
  typeof value?.toObject === "function" ? value.toObject() : value || {};
const asId = (value) => String(value?._id || value?.id || value || "");

const planningArtifactScopeError = (label) => {
  const error = new Error(`${label} does not belong to the trusted planning scope`);
  error.code = "TRUSTED_QA_PROVENANCE_INVALID";
  error.status = 409;
  return error;
};

const assertPlanningArtifactScope = ({ artifact, qaProvenance, label }) => {
  if (!artifact) return artifact;
  const source = asObject(artifact);
  const nestedCandidates = [source.metadata, source.qaContext].filter(Boolean);
  if (!qaProvenance) {
    if (
      hasQaProvenanceMarkers(source) ||
      nestedCandidates.some(hasQaProvenanceMarkers)
    ) {
      throw planningArtifactScopeError(label);
    }
    return artifact;
  }
  let stored;
  try {
    stored = normalizeTrustedQaProvenance(source);
  } catch {
    throw planningArtifactScopeError(label);
  }
  if (!qaProvenanceMatches(qaProvenance, stored)) {
    throw planningArtifactScopeError(label);
  }
  for (const candidate of nestedCandidates) {
    if (!hasQaProvenanceMarkers(candidate)) continue;
    let nested;
    try {
      nested = normalizeTrustedQaProvenance(candidate);
    } catch {
      throw planningArtifactScopeError(label);
    }
    if (!qaProvenanceMatches(qaProvenance, nested)) {
      throw planningArtifactScopeError(label);
    }
  }
  return artifact;
};
const cleanStrings = (values, max = 20) =>
  Array.isArray(values)
    ? [
        ...new Set(
          values.map((value) => String(value || "").trim()).filter(Boolean),
        ),
      ].slice(0, max)
    : [];

// This marker cannot arrive through JSON. Only plan({ trustedRoadmapContext })
// can attach it after validating a server-claimed roadmap item, so public/admin
// request payloads cannot opt themselves into selected-topic precedence.
const TRUSTED_ROADMAP_SELECTION = Symbol("trusted-roadmap-selection");
const ROADMAP_INPUT_KEYS = new Set([
  "selectionSource",
  "selectedTopic",
  "managerDirection",
  "roadmapItemId",
  "roadmapId",
  "__trustedRoadmapSelection",
]);

const textBound = (value, max) => String(value || "")
  .replace(new RegExp("[\\u0000-\\u001f\\u007f]", "g"), "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

const normalizeTrustedRoadmapContext = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const roadmapId = textBound(value.roadmapId, 80);
  const itemId = textBound(value.itemId || value.roadmapItemId, 80);
  const scheduleId = textBound(value.scheduleId, 80);
  const executionId = textBound(value.executionId, 80);
  const topic = textBound(value.topic, 300);
  if (!roadmapId || !itemId || !scheduleId || !executionId || !topic) {
    const error = new Error("Trusted roadmap context is incomplete");
    error.code = "TRUSTED_ROADMAP_CONTEXT_INVALID";
    error.status = 409;
    throw error;
  }
  const primaryQuestion = textBound(value.primaryQuestion, 500);
  const supportingQuestions = cleanStrings(value.supportingQuestions, 10).map((item) =>
    textBound(item, 500),
  );
  const productEvidence = Array.isArray(value.productEvidence)
    ? value.productEvidence.slice(0, 20)
    : [];
  const marketEvidence = Array.isArray(value.marketEvidence)
    ? value.marketEvidence.slice(0, 20)
    : [];
  return {
    roadmapId,
    itemId,
    scheduleId,
    executionId,
    directionRevision: Math.max(1, Number(value.directionRevision) || 1),
    generation: Math.max(1, Number(value.generation) || 1),
    topic,
    angle: textBound(value.angle, 1000),
    primaryKeyword: textBound(value.primaryKeyword || topic, 120),
    secondaryKeywords: cleanStrings(value.secondaryKeywords, 12).map((item) =>
      textBound(item, 80),
    ),
    primaryQuestion,
    supportingQuestions,
    targetAudience: cleanStrings(value.targetAudience, 10).map((item) =>
      textBound(item, 200),
    ),
    userProblems: cleanStrings(value.userProblems, 10).map((item) =>
      textBound(item, 300),
    ),
    searchIntent: textBound(value.searchIntent || "informational", 300),
    articleType: textBound(value.articleType || "practical-guide", 100),
    categoryKey: textBound(value.categoryKey || "guide", 80),
    managerDirection: textBound(value.managerDirection, 500),
    opportunityScore: normalizeOpportunityScore(value.opportunityScore),
    topicScoreReport:
      value.topicScoreReport && typeof value.topicScoreReport === "object"
        ? {
            totalScore: Math.min(100, Math.max(0, Number(value.topicScoreReport.totalScore) || 0)),
            noveltySubtotal: Math.min(65, Math.max(0, Number(value.topicScoreReport.noveltySubtotal) || 0)),
            acceptanceScore: Math.min(100, Math.max(82, Number(value.topicScoreReport.acceptanceScore) || 82)),
            minimumNoveltySubtotal: Math.min(65, Math.max(48, Number(value.topicScoreReport.minimumNoveltySubtotal) || 48)),
            rubricVersion: textBound(value.topicScoreReport.rubricVersion, 120),
            corpusVersion: textBound(value.topicScoreReport.corpusVersion, 120),
            hardGatesPassed: value.topicScoreReport.hardGatesPassed === true,
          }
        : null,
    productEvidence,
    marketEvidence,
  };
};

const applyTrustedRoadmapSelection = (input, context) => {
  if (!context) return input;
  const customerQuestions = [
    context.primaryQuestion,
    ...context.supportingQuestions,
  ].filter(Boolean);
  const productEvidence = context.productEvidence.map((item) => ({
    source: "product_catalog",
    sourceType: "product_catalog",
    type: "roadmap_product_opportunity",
    claim: `Verified catalog evidence is available for ${textBound(item?.name || item?.productId, 200)}.`,
    internalReferenceId: textBound(item?.productId, 80),
    evidenceHash: textBound(item?.catalogEvidenceHash, 128),
    classification: "verified",
    confidence: 1,
    allowedUsage:
      "Use only as a product/topic planning reference. Reload and verify current catalog facts before writing any product claim.",
  }));
  const marketEvidence = context.marketEvidence.map((item) => ({
    source: textBound(item?.sourceType || "market_research", 80),
    sourceType: textBound(item?.sourceType || "market_research", 80),
    type: "roadmap_market_signal",
    claim: textBound(item?.snippet || item?.title, 500),
    sourceUrl: textBound(item?.canonicalUrl, 2_000),
    internalReferenceId: textBound(item?.sourceId, 160),
    checkedAt: item?.fetchedAt || item?.observedAt || null,
    // "unknown" maps to a blocked evidence status, which contradicts the
    // allowedUsage/requiredQualification written right below it and blocked
    // every market signal the roadmap had already relevance-scored and pinned
    // to a fetched source. Attributed third-party context is an inference:
    // usable with qualification, never assertable as fact.
    classification: "inferred",
    confidence: Math.min(1, Math.max(0, Number(item?.confidence) || 0)),
    allowedUsage:
      "Use as attributed qualitative market context only; never infer numerical demand or a product performance claim.",
    requiredQualification:
      "Attribute the source and preserve uncertainty unless a separate verified fact supports the statement.",
  })).filter((item) => item.claim);
  return {
    ...input,
    mode: "fixed_brief",
    action: ACTIONS.NEW,
    topic: context.topic,
    primaryKeyword: context.primaryKeyword,
    secondaryKeywords: context.secondaryKeywords,
    categoryKey: context.categoryKey,
    articleType: context.articleType,
    primarySearchIntent: context.searchIntent,
    targetAudience: context.targetAudience,
    userProblems: context.userProblems,
    customerQuestions,
    primaryQuestion: context.primaryQuestion,
    supportingQuestions: context.supportingQuestions,
    editorialAngle: context.angle,
    requiredEvidence: [...marketEvidence, ...productEvidence],
    userDemandScore: context.opportunityScore || undefined,
    contentGapScore: context.opportunityScore || undefined,
    userValueScore: context.opportunityScore || undefined,
    managerDirection: context.managerDirection,
    selectedTopic: context.topic,
    roadmapItemId: context.itemId,
    roadmapId: context.roadmapId,
    __trustedRoadmapSelection: true,
    [TRUSTED_ROADMAP_SELECTION]: true,
  };
};

const explicitOwnerUpdateFailed = (result) =>
  Number.isFinite(result?.matchedCount)
    ? result.matchedCount === 0
    : result?.modifiedCount === 0;

const planningRunLeaseLostError = () => {
  const error = new Error("Content Operations planning lease was lost");
  error.code = "CONTENT_OPERATIONS_RUN_LEASE_LOST";
  return error;
};

const createPlanningRunLeaseGuard = ({
  RunModel,
  runId,
  ownerToken,
  leaseMs,
  assertExternalOwner,
  clock = () => new Date(),
  heartbeatMs = Math.max(1_000, Math.floor(leaseMs / 3)),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  heartbeat = true,
} = {}) => {
  let stopped = false;
  let ownershipLost = false;
  let pending = Promise.resolve(true);
  const renew = async (checkpoint = "heartbeat") => {
    if (stopped || ownershipLost) return !ownershipLost;
    try {
      if (
        typeof assertExternalOwner === "function" &&
        (await assertExternalOwner()) === false
      ) {
        ownershipLost = true;
        return false;
      }
      const checkpointAt = new Date(clock());
      const result = await RunModel.updateOne(
        {
          _id: runId,
          status: "running",
          leaseOwner: ownerToken,
          leaseUntil: { $gt: checkpointAt },
        },
        {
          $set: {
            leaseUntil: new Date(checkpointAt.getTime() + leaseMs),
            lastCheckpoint: String(checkpoint || "heartbeat").slice(0, 120),
          },
        },
      );
      if (explicitOwnerUpdateFailed(result)) ownershipLost = true;
      return !ownershipLost;
    } catch {
      ownershipLost = true;
      return false;
    }
  };
  const enqueue = (checkpoint) => {
    pending = pending
      .then(() => renew(checkpoint))
      .catch(() => {
        ownershipLost = true;
        return false;
      });
    return pending;
  };
  const timer = heartbeat
    ? setIntervalFn(() => {
        enqueue("heartbeat");
      }, heartbeatMs)
    : null;
  timer?.unref?.();
  return {
    checkpoint: async (name) => {
      if (!(await enqueue(name))) throw planningRunLeaseLostError();
      return true;
    },
    stop: async () => {
      if (!stopped) {
        stopped = true;
        if (timer) clearIntervalFn(timer);
      }
      await pending;
    },
    ownershipLost: () => ownershipLost,
  };
};

const defaultBusinessGoal = (action) => {
  if (action === ACTIONS.INTERNAL_LINK_MAINTENANCE)
    return "internal_link_improvement";
  if (MAINTENANCE_ACTIONS.has(action)) return "content_maintenance";
  return "customer_education";
};

const defaultSuccessMetrics = (action) =>
  action === ACTIONS.SKIP
    ? [
        {
          key: "unsafe_or_low_value_tasks_started",
          operator: "equals",
          target: 0,
        },
      ]
    : MAINTENANCE_ACTIONS.has(action)
      ? [
          { key: "readiness_critical_issues", operator: "equals", target: 0 },
          { key: "canonical_preserved", operator: "equals", target: 1 },
        ]
      : [
          { key: "readiness_critical_issues", operator: "equals", target: 0 },
          { key: "user_question_answered", operator: "equals", target: 1 },
        ];

const workOrderInputFor = ({
  decision,
  snapshot,
  input = {},
  adminId = null,
}) => {
  const action = String(decision.recommendedAction || decision.decisionType);
  // A roadmap selection is a trusted backend artifact that has already been
  // researched, ranked and atomically claimed. In that narrow path the selected
  // candidate must win over the manager's raw direction. All legacy/fixed/
  // maintenance callers keep the previous input.topic-first semantics.
  const roadmapSelection = input[TRUSTED_ROADMAP_SELECTION] === true;
  const topic = String(
    roadmapSelection
      ? input.selectedTopic || decision.topic || ""
      : input.topic || decision.topic || "",
  ).trim();
  const searchIntent = String(
    input.primarySearchIntent ||
      (MAINTENANCE_ACTIONS.has(action)
        ? "content maintenance for the observed user need"
        : "informational"),
  ).trim();
  const targetAudience = cleanStrings(input.targetAudience).length
    ? cleanStrings(input.targetAudience)
    : ["Vietnamese households evaluating and using durable cookware"];
  const userProblems = cleanStrings(input.userProblems).length
    ? cleanStrings(input.userProblems)
    : [
        `Need a clear, evidence-backed answer about ${topic || "the selected topic"}`,
      ];
  const customerQuestions = cleanStrings(input.customerQuestions).length
    ? cleanStrings(input.customerQuestions)
    : topic
      ? [`What should a reader know or do about ${topic}?`]
      : [];
  const sourceHealth = Array.isArray(snapshot.sourceHealth)
    ? snapshot.sourceHealth
    : [];
  return {
    contentOperationsSnapshotId: snapshot.id || snapshot._id,
    googleIntelSnapshotId: snapshot.googleIntelSnapshotId,
    topic,
    targetBlogId:
      input.targetBlogId ||
      decision.primaryTargetBlogId ||
      decision.targetBlogIds?.[0] ||
      null,
    mergeSourceBlogIds:
      input.mergeSourceBlogIds ||
      (action === ACTIONS.MERGE ? (decision.targetBlogIds || []).slice(1) : []),
    primaryBusinessGoal:
      input.primaryBusinessGoal || defaultBusinessGoal(action),
    secondaryBusinessGoals: cleanStrings(input.secondaryBusinessGoals),
    targetAudience,
    funnelStage: String(input.funnelStage || "consideration").trim(),
    primarySearchIntent: searchIntent,
    secondarySearchIntents: cleanStrings(input.secondarySearchIntents),
    userProblems,
    customerQuestions,
    requiredSources: sourceHealth.map((source) => ({
      source: source.source,
      status: source.status,
      required: ["google_intelligence", "content_inventory"].includes(
        source.source,
      ),
      checkedAt: source.checkedAt || null,
    })),
    requiredEvidence: Array.isArray(input.requiredEvidence)
      ? input.requiredEvidence
      : decision.positiveEvidence || [],
    productIntegrationPolicy: input.productIntegrationPolicy || {
      mode: input.productSeeding?.mode || "auto",
      requireVerifiedClaims: true,
    },
    targetPublishDate: input.targetPublishDate || null,
    owner: input.owner || adminId,
    reviewer: input.reviewer || null,
    successMetrics:
      Array.isArray(input.successMetrics) && input.successMetrics.length
        ? input.successMetrics
        : defaultSuccessMetrics(action),
    risks: cleanStrings(input.risks),
    warnings: cleanStrings(snapshot.warnings),
    decisionReason: decision.decisionReason,
    overrideReason: input.overrideReason || null,
    metadata: {
      planningMode: input.mode || "best_action",
      draftOnly: input.draftOnly !== false,
      ...(roadmapSelection
        ? {
            selectionSource: "roadmap",
            roadmapId: input.roadmapId,
            roadmapItemId: input.roadmapItemId,
            managerDirection: input.managerDirection,
          }
        : {}),
      ...(input.qaContext || {}),
    },
    ...(input.qaContext || {}),
  };
};

const briefInputFor = ({
  workOrder,
  decision,
  input = {},
  inventoryItems = [],
}) => {
  const targetId = asId(workOrder.targetBlogId);
  const target = inventoryItems.find((item) => asId(item.blogId) === targetId);
  const topic = String(
    workOrder.topic || decision.topic || input.topic || "",
  ).trim();
  const questions = cleanStrings(workOrder.customerQuestions);
  const action = workOrder.decision;
  return {
    topic,
    workingTitle: String(input.workingTitle || target?.title || topic).trim(),
    language: input.language === "en" ? "en" : "vi",
    primaryBusinessGoal: workOrder.primaryBusinessGoal,
    secondaryBusinessGoals: workOrder.secondaryBusinessGoals,
    targetAudience: workOrder.targetAudience,
    funnelStage: workOrder.funnelStage,
    primarySearchIntent: workOrder.primarySearchIntent,
    secondarySearchIntents: workOrder.secondarySearchIntents,
    primaryQuestion: String(
      input.primaryQuestion ||
        questions[0] ||
        `What does the reader need to know about ${topic}?`,
    ).trim(),
    supportingQuestions: cleanStrings(input.supportingQuestions).length
      ? cleanStrings(input.supportingQuestions)
      : questions.slice(1),
    articleType: String(
      input.articleType ||
        (MAINTENANCE_ACTIONS.has(action)
          ? "existing-article-revision"
          : "practical-guide"),
    ).trim(),
    contentRole: String(
      input.contentRole ||
        (MAINTENANCE_ACTIONS.has(action)
          ? "maintain existing helpful content"
          : "answer a verified user need"),
    ).trim(),
    editorialAngle: String(
      input.editorialAngle ||
        "Practical, people-first guidance grounded in current evidence and explicit uncertainty.",
    ).trim(),
    primaryTerms: cleanStrings(input.primaryTerms).length
      ? cleanStrings(input.primaryTerms)
      : cleanStrings([input.primaryKeyword, topic]),
    relatedTerms: cleanStrings(input.secondaryKeywords),
    requiredEntities: cleanStrings(input.requiredEntities),
    contentGap: cleanStrings(input.contentGap).length
      ? cleanStrings(input.contentGap)
      : [
          "Address only the gap supported by the selected opportunity evidence.",
        ],
    existingContentReferences: target
      ? [
          {
            blogId: asId(target.blogId),
            title: target.title,
            slug: target.slug,
            canonicalUrl: target.canonicalUrl,
            contentHash: target.contentHash,
          },
        ]
      : [],
    targetBlogId: workOrder.targetBlogId,
    internalLinkCandidates: inventoryItems
      .filter(
        (item) => asId(item.blogId) !== targetId && item.status === "published",
      )
      .slice(0, 12)
      .map((item) => ({
        blogId: asId(item.blogId),
        title: item.title,
        slug: item.slug,
      })),
    categoryLinkCandidates: [],
    productIntegration: workOrder.productIntegrationPolicy,
    plannedOutline: Array.isArray(input.plannedOutline) ? input.plannedOutline.slice(0, 20) : [],
    requiredFacts: Array.isArray(input.requiredFacts)
      ? input.requiredFacts
      : [],
    forbiddenClaims: cleanStrings(input.forbiddenClaims).length
      ? cleanStrings(input.forbiddenClaims)
      : [
          "Unverified certifications, tests, performance guarantees, rankings, or statistics",
        ],
    evidenceRequirements: workOrder.requiredEvidence || [],
    editorialStyleConstraints: input.editorialStyleConstraints || {
      peopleFirst: true,
      noCopiedStructure: true,
      attributeExternalFacts: true,
    },
    productPlacementConstraints: input.productPlacement || {
      disclosureRequired: true,
      noForcedProductPlacement: true,
    },
    imagePlanRequirements: Array.isArray(input.imagePlanRequirements)
      ? input.imagePlanRequirements
      : [],
    ctaStrategy: input.ctaStrategy || {
      mode: "helpful_next_step",
      maxCount: 1,
      pressure: "low",
    },
    structuredDataCandidate: input.structuredDataCandidate || "Article",
    successMetrics: workOrder.successMetrics,
    publishTarget: {
      mode: input.draftOnly === false ? "publish_requested" : "draft",
      preserveCanonical: action !== ACTIONS.NEW,
      canonicalUrl: target?.canonicalUrl || null,
    },
    reviewRequirements: cleanStrings(input.reviewRequirements).length
      ? cleanStrings(input.reviewRequirements)
      : [
          "fact_check",
          "evidence_map",
          "people_first",
          "seo",
          "brand_voice",
          "publish_readiness",
        ],
    qaContext: input.qaContext || workOrder.metadata || null,
  };
};

class ContentOperationsPlanningService {
  constructor({
    config = getContentOperationsConfig(),
    GoogleService = GoogleIntelligenceService,
    IntelligenceService = ContentOperationsIntelligenceService,
    DecisionService = ContentOpportunityDecisionService,
    WorkOrderService = ContentWorkOrderService,
    BriefService = UnifiedContentBriefService,
    SignalService = ContentSignalService,
    InventoryItemModel = ContentInventoryItem,
    OpportunityModel = ContentOpportunityDecision,
    WorkOrderModel = ContentWorkOrder,
    BriefModel = UnifiedContentBrief,
    RunModel = ContentOperationsRun,
    ideationService = generateBlogIdeas,
    now = () => new Date(),
  } = {}) {
    this.config = config;
    this.GoogleService = GoogleService;
    this.IntelligenceService = IntelligenceService;
    this.DecisionService = DecisionService;
    this.ideationService = ideationService;
    this.WorkOrderService = WorkOrderService;
    this.BriefService = BriefService;
    this.signalService =
      typeof SignalService === "function"
        ? new SignalService({ config })
        : SignalService;
    this.InventoryItemModel = InventoryItemModel;
    this.OpportunityModel = OpportunityModel;
    this.WorkOrderModel = WorkOrderModel;
    this.BriefModel = BriefModel;
    this.RunModel = RunModel;
    this.now = now;
  }

  async readInventoryItems(snapshotId) {
    let query = this.InventoryItemModel.find({ snapshotId });
    if (typeof query.sort === "function")
      query = query.sort({ reviewStatus: -1, articleUpdatedAt: 1 });
    if (typeof query.limit === "function")
      query = query.limit(this.config.inventory.maxItems);
    if (typeof query.lean === "function") query = query.lean();
    const items = await query;
    return Array.isArray(items) ? items : [];
  }

  // Run the creative ideation layer for best_action mode only. Ideas widen the
  // candidate funnel; they never bypass a gate. Failure is non-fatal — the older
  // deterministic candidate generators still run, so a bad ideation call only
  // means fewer fresh ideas that day, not a broken pipeline.
  async runIdeation({ snapshot, inventoryItems, mode, input = {} }) {
    if (
      mode !== "best_action" ||
      typeof this.ideationService !== "function" ||
      this.config.ideation?.enabled === false
    ) {
      return { ideas: [], source: "disabled", model: null };
    }
    try {
      const result = await this.ideationService({
        snapshot,
        inventoryItems,
        direction: String(input.topic || input.primaryKeyword || input.direction || ""),
        now: this.now(),
        timezone: this.config.timezone,
        maxIdeas: this.config.ideation?.maxIdeasPerRun || 12,
      });
      return {
        ideas: Array.isArray(result?.ideas) ? result.ideas : [],
        source: result?.source || "unknown",
        model: result?.model || null,
      };
    } catch (_error) {
      return { ideas: [], source: "failed", model: null };
    }
  }

  async persistRunTerminal({
    runId,
    ownerToken = "",
    leaseGuard = null,
    updates = {},
  } = {}) {
    if (leaseGuard) await leaseGuard.checkpoint("terminal_ready");
    const terminalAt = this.now();
    const filter = ownerToken
      ? {
          _id: runId,
          status: "running",
          leaseOwner: ownerToken,
          leaseUntil: { $gt: terminalAt },
        }
      : { _id: runId, status: "running" };
    const result = await this.RunModel.updateOne(filter, {
      $set: {
        ...updates,
        leaseUntil: null,
        lastCheckpoint: "terminal",
        completedAt: updates.completedAt || terminalAt,
      },
    });
    if (explicitOwnerUpdateFailed(result)) throw planningRunLeaseLostError();
    return true;
  }

  async compensateRun({
    runId,
    ownerToken,
    reasonCode = "CONTENT_OPERATIONS_PLANNING_FAILED",
  } = {}) {
    if (!runId || !ownerToken) return false;
    const code = safeErrorCode({ code: reasonCode });
    const compensatedStatus =
      code === "CONTENT_OPERATIONS_DISABLED" ? "blocked" : "failed";
    const terminalAt = this.now();
    const claimed = await this.RunModel.updateOne(
      {
        _id: runId,
        leaseOwner: ownerToken,
        status: {
          $in: [
            "running",
            "completed",
            "partial",
            "skipped",
            "blocked",
            "failed",
          ],
        },
      },
      {
        $set: {
          status: compensatedStatus,
          googleIntelSnapshotId: null,
          contentOperationsSnapshotId: null,
          contentInventorySnapshotId: null,
          contentOpportunityDecisionId: null,
          contentWorkOrderId: null,
          unifiedContentBriefId: null,
          selectedDecision: "",
          candidates: [],
          rejectedDecisions: [],
          errorDetails: [
            { code, message: "Content Operations planning stopped safely." },
          ],
          leaseUntil: null,
          lastCheckpoint: "compensation_pending",
          completedAt: terminalAt,
        },
      },
    );
    if (explicitOwnerUpdateFailed(claimed)) return false;

    try {
      // Provenance is set only on newly inserted artifacts. These deletes cannot
      // remove a decision, Work Order, or brief reused from another planning run.
      const deletions = [];
      if (
        typeof this.BriefModel.find === "function" &&
        typeof this.WorkOrderModel.updateOne === "function"
      ) {
        let query = this.BriefModel.find({ planningRunId: runId });
        if (typeof query.select === "function")
          query = query.select("_id contentWorkOrderId");
        if (typeof query.lean === "function") query = query.lean();
        const ownedBriefs = await query;
        for (const brief of Array.isArray(ownedBriefs) ? ownedBriefs : []) {
          deletions.push(
            Promise.resolve().then(() =>
              this.WorkOrderModel.updateOne(
                {
                  _id: brief.contentWorkOrderId,
                  "artifactIds.unifiedContentBriefId": brief._id,
                },
                { $unset: { "artifactIds.unifiedContentBriefId": "" } },
              ),
            ),
          );
        }
      }
      if (typeof this.BriefModel.deleteMany === "function") {
        deletions.push(
          Promise.resolve().then(() =>
            this.BriefModel.deleteMany({ planningRunId: runId }),
          ),
        );
      }
      if (typeof this.WorkOrderModel.deleteMany === "function") {
        deletions.push(
          Promise.resolve().then(() =>
            this.WorkOrderModel.deleteMany({
              "metadata.planningRunId": String(runId),
            }),
          ),
        );
      }
      if (typeof this.OpportunityModel.deleteMany === "function") {
        deletions.push(
          Promise.resolve().then(() =>
            this.OpportunityModel.deleteMany({ planningRunId: runId }),
          ),
        );
      }
      const settled = await Promise.allSettled(deletions);
      if (settled.some((item) => item.status === "rejected"))
        throw new Error("compensation_delete_failed");
      const finalized = await this.RunModel.updateOne(
        {
          _id: runId,
          leaseOwner: ownerToken,
          status: compensatedStatus,
          lastCheckpoint: "compensation_pending",
        },
        { $set: { lastCheckpoint: "compensated" } },
      );
      if (explicitOwnerUpdateFailed(finalized))
        throw new Error("compensation_finalize_failed");
      return true;
    } catch {
      const error = new Error(
        "Content Operations planning compensation failed",
      );
      error.code = "CONTENT_OPERATIONS_COMPENSATION_FAILED";
      throw error;
    }
  }

  async preview({ input = {} } = {}) {
    const now = this.now();
    const correlationId = crypto.randomUUID();
    // Preview may ensure today's read-only intelligence snapshots, but it must never
    // persist a planning run, decision, Work Order, brief, or downstream artifact.
    const googleSnapshot =
      await this.GoogleService.ensureGoogleIntelligenceSnapshotForDate({
        now,
        createSchedule: false,
      });
    const intelligenceService =
      typeof this.IntelligenceService === "function"
        ? new this.IntelligenceService({ config: this.config })
        : this.IntelligenceService;
    const snapshotResult =
      await intelligenceService.ensureContentOperationsSnapshotForDate({
        now,
        force: false,
        googleIntelSnapshot: googleSnapshot,
      });
    if (snapshotResult.disabled) {
      const error = new Error("Content Operations is disabled");
      error.code = "CONTENT_OPERATIONS_DISABLED";
      error.status = 409;
      throw error;
    }
    const snapshot = snapshotResult.snapshot;
    const inventoryItems = await this.readInventoryItems(
      snapshot.contentInventorySnapshotId,
    );

    if (input.workOrderId) {
      const [existingWorkOrder, existingBrief] = await Promise.all([
        this.WorkOrderModel.findById(input.workOrderId),
        this.BriefModel.findOne({
          contentWorkOrderId: input.workOrderId,
          status: "complete",
        }).sort({ version: -1 }),
      ]);
      if (!existingWorkOrder || !existingBrief) {
        const error = new Error(
          "The requested Work Order or its complete Unified Brief was not found",
        );
        error.code = "CONTENT_WORK_ORDER_NOT_RUNNABLE";
        error.status = 404;
        throw error;
      }
      const workOrderRunnable =
        isWorkOrderRunnable(existingWorkOrder, { now }) &&
        existingWorkOrder.decision !== ACTIONS.SKIP;
      if (
        asId(existingWorkOrder.contentOperationsSnapshotId) !==
          asId(snapshot) ||
        asId(existingWorkOrder.googleIntelSnapshotId) !== asId(googleSnapshot)
      ) {
        const error = new Error(
          "The Work Order is stale; create a new decision against today's intelligence snapshots",
        );
        error.code = "CONTENT_WORK_ORDER_STALE";
        error.status = 409;
        throw error;
      }
      const selected = await this.OpportunityModel.findById(
        existingWorkOrder.contentOpportunityDecisionId,
      );
      if (!selected)
        throw new Error("The Work Order opportunity decision was not found");
      return {
        dryRun: true,
        correlationId,
        runId: "",
        googleIntelSnapshotId: asId(googleSnapshot),
        contentOperationsSnapshotId: asId(snapshot),
        contentInventorySnapshotId: asId(snapshot.contentInventorySnapshotId),
        contentOpportunityDecisionId: asId(selected),
        contentWorkOrderId: asId(existingWorkOrder),
        unifiedContentBriefId: asId(existingBrief),
        evidenceMapId: asId(existingWorkOrder.artifactIds?.evidenceMapId),
        action: workOrderRunnable ? existingWorkOrder.decision : ACTIONS.SKIP,
        topic: existingWorkOrder.topic,
        opportunityScore: existingWorkOrder.opportunityScore,
        selectedOpportunity: asObject(selected),
        candidates: [],
        workOrder: asObject(existingWorkOrder),
        brief: workOrderRunnable ? asObject(existingBrief) : null,
        skipped: !workOrderRunnable,
        blocked: false,
        missingRequiredSources: [],
        warnings: [
          ...(snapshot.warnings || []),
          ...(!workOrderRunnable
            ? [`work_order_${existingWorkOrder.status}_not_runnable`]
            : []),
        ],
        sourceHealth: snapshot.sourceHealth || [],
        sourceFreshness: snapshot.sourceFreshness || {},
        googleSnapshot: asObject(googleSnapshot),
        contentOperationsSnapshot: snapshot,
        planningArtifactsPersisted: false,
        snapshotReused: snapshotResult.reused === true,
        downstreamInvoked: {
          product: false,
          research: false,
          writer: false,
          image: false,
          telegram: false,
          publisher: false,
        },
      };
    }

    const signals = await this.signalService.listSignals({
      limit: 200,
      status: "active",
      mutateExpiry: false,
    });
    if (input.mode !== undefined && !MODES.has(input.mode)) {
      const error = new Error("Unsupported Content Operations mode");
      error.code = "CONTENT_OPERATIONS_MODE_INVALID";
      error.status = 400;
      throw error;
    }
    const mode =
      input.mode ||
      (input.topic || input.primaryKeyword ? "fixed_brief" : "best_action");
    const sourceMap = new Map(
      (snapshot.sourceHealth || []).map((item) => [String(item.source), item]),
    );
    const missingRequiredSources = (
      Array.isArray(input.sourceRequirements) ? input.sourceRequirements : []
    ).filter((source) => {
      const health = sourceMap.get(String(source));
      return !health || !["available", "partial"].includes(health.status);
    });
    const ideation = missingRequiredSources.length
      ? { ideas: [], source: "skipped", model: null }
      : await this.runIdeation({ snapshot, inventoryItems, mode, input });
    const candidates = missingRequiredSources.length
      ? []
      : generateOpportunityCandidates({
          snapshot,
          inventoryItems,
          signals,
          input,
          mode,
          ideas: ideation.ideas,
        });
    const decisionConfig = {
      ...this.config,
      opportunitySkipThreshold:
        input.minimumOpportunityScore === undefined
          ? this.config.opportunitySkipThreshold
          : Number(input.minimumOpportunityScore),
    };
    const decisionResult = this.DecisionService.chooseBestAction({
      candidates,
      config: decisionConfig,
    });
    const selectedObject = asObject(decisionResult.selected);
    const selectedActionIsSkip =
      selectedObject.recommendedAction === ACTIONS.SKIP ||
      selectedObject.decisionType === ACTIONS.SKIP;
    const skipDisallowed = selectedActionIsSkip && input.allowSkip === false;
    const blocked = skipDisallowed || missingRequiredSources.length > 0;
    const blockCode = missingRequiredSources.length > 0
      ? "CONTENT_OPERATIONS_REQUIRED_SOURCE_UNAVAILABLE"
      : skipDisallowed
        ? "CONTENT_OPERATIONS_SKIP_DISALLOWED"
        : "";
    const skipped = !blocked && selectedActionIsSkip;
    const selectedDecision = skipped
      ? ACTIONS.SKIP
      : selectedObject.recommendedAction || selectedObject.decisionType;
    const warnings = [
      ...(snapshot.warnings || []),
      ...missingRequiredSources.map(
        (source) => `required_source_unavailable:${source}`,
      ),
      ...(skipDisallowed
        ? ["schedule_disallows_skip_but_no_safe_action_exists"]
        : []),
    ];
    return {
      dryRun: true,
      correlationId,
      runId: "",
      googleIntelSnapshotId: asId(googleSnapshot),
      contentOperationsSnapshotId: asId(snapshot),
      contentInventorySnapshotId: asId(snapshot.contentInventorySnapshotId),
      contentOpportunityDecisionId: "",
      contentWorkOrderId: "",
      unifiedContentBriefId: "",
      action: selectedDecision,
      topic: selectedObject.topic,
      opportunityScore: selectedObject.totalScore,
      selectedOpportunity: selectedObject,
      candidates: decisionResult.rankedCandidates,
      ideation: {
        source: ideation.source,
        model: ideation.model,
        ideaCount: ideation.ideas.length,
      },
      workOrder: null,
      brief: null,
      skipped,
      blocked,
      blockCode,
      missingRequiredSources,
      warnings,
      sourceHealth: snapshot.sourceHealth || [],
      sourceFreshness: snapshot.sourceFreshness || {},
      googleSnapshot: asObject(googleSnapshot),
      contentOperationsSnapshot: snapshot,
      planningArtifactsPersisted: false,
      snapshotReused: snapshotResult.reused === true,
      downstreamInvoked: {
        product: false,
        research: false,
        writer: false,
        image: false,
        telegram: false,
        publisher: false,
      },
    };
  }

  async plan({
    input = {},
    trigger = "preview",
    adminId = null,
    executionKey: requestedExecutionKey = "",
    lease = null,
    trustedQaContext = null,
    trustedRoadmapContext = null,
  } = {}) {
    if (Object.prototype.hasOwnProperty.call(input, "qaContext")) {
      const error = new Error("QA provenance cannot be supplied through planning input");
      error.code = "QA_PROVENANCE_INPUT_FORBIDDEN";
      error.status = 400;
      throw error;
    }
    const injectedRoadmapKey = Object.keys(input || {}).find((key) =>
      ROADMAP_INPUT_KEYS.has(key),
    );
    if (injectedRoadmapKey) {
      const error = new Error("Roadmap selection cannot be supplied through planning input");
      error.code = "ROADMAP_SELECTION_INPUT_FORBIDDEN";
      error.status = 400;
      throw error;
    }
    const roadmapContext = normalizeTrustedRoadmapContext(trustedRoadmapContext);
    input = applyTrustedRoadmapSelection(input, roadmapContext);
    const qaProvenance = normalizeTrustedQaProvenance(trustedQaContext);
    if (qaProvenance) {
      input = {
        ...input,
        qaContext: { ...trustedQaContext, ...qaProvenance },
      };
    }
    if (trigger === "preview") return this.preview({ input });
    const now = this.now();
    const correlationId = crypto.randomUUID();
    const executionKey = String(
      requestedExecutionKey ||
        `content-operations:${trigger}:${now.toISOString()}:${correlationId}`,
    ).slice(0, 500);
    const leaseOwner = String(lease?.ownerToken || "")
      .trim()
      .slice(0, 200);
    const leaseMs = Math.min(
      60 * 60 * 1000,
      Math.max(30_000, Number(lease?.leaseMs || 10 * 60 * 1000)),
    );
    if (leaseOwner && typeof lease?.assertOwner === "function") {
      const ownsSchedule = await lease.assertOwner();
      if (ownsSchedule === false) throw planningRunLeaseLostError();
    }
    const run = await this.RunModel.create({
      executionKey,
      correlationId,
      leaseOwner,
      leaseUntil: leaseOwner ? new Date(now.getTime() + leaseMs) : null,
      lastCheckpoint: leaseOwner ? "created" : "",
      trigger,
      status: "running",
      startedAt: now,
      triggeredByAdminId: adminId,
      ...(input.qaContext || {}),
      pipelineSteps: [
        { step: "google_intelligence", status: "running", at: now },
      ],
    });
    const planningRunId = leaseOwner ? run._id : null;
    const leaseGuard = leaseOwner
      ? createPlanningRunLeaseGuard({
          RunModel: this.RunModel,
          runId: run._id,
          ownerToken: leaseOwner,
          leaseMs,
          assertExternalOwner: lease?.assertOwner,
          clock: this.now,
          heartbeat: lease?.heartbeat !== false,
          heartbeatMs: lease?.heartbeatMs,
          setIntervalFn: lease?.setIntervalFn,
          clearIntervalFn: lease?.clearIntervalFn,
        })
      : null;
    try {
      if (leaseGuard) await leaseGuard.checkpoint("before_google_intelligence");
      // This explicit gate must complete before inventory, decision, product, research, or writer work.
      const googleSnapshot =
        await this.GoogleService.ensureGoogleIntelligenceSnapshotForDate({
          now,
          ...(qaProvenance ? { trustedQaContext: input.qaContext } : {}),
        });
      if (leaseGuard) await leaseGuard.checkpoint("after_google_intelligence");
      const intelligenceService =
        typeof this.IntelligenceService === "function"
          ? new this.IntelligenceService({ config: this.config })
          : this.IntelligenceService;
      const snapshotResult =
        await intelligenceService.ensureContentOperationsSnapshotForDate({
          now,
          force: input.force === true,
          googleIntelSnapshot: googleSnapshot,
          ...(qaProvenance ? { trustedQaContext: input.qaContext } : {}),
        });
      if (leaseGuard) await leaseGuard.checkpoint("after_daily_snapshot");
      if (snapshotResult.disabled) {
        const error = new Error("Content Operations is disabled");
        error.code = "CONTENT_OPERATIONS_DISABLED";
        error.status = 409;
        throw error;
      }
      const snapshot = snapshotResult.snapshot;
      const inventoryItems = await this.readInventoryItems(
        snapshot.contentInventorySnapshotId,
      );
      if (leaseGuard) await leaseGuard.checkpoint("after_inventory_read");
      if (input.workOrderId) {
        const [existingWorkOrder, existingBrief] = await Promise.all([
          this.WorkOrderModel.findById(input.workOrderId),
          this.BriefModel.findOne({
            contentWorkOrderId: input.workOrderId,
            status: "complete",
          }).sort({ version: -1 }),
        ]);
        if (!existingWorkOrder || !existingBrief) {
          const error = new Error(
            "The requested Work Order or its complete Unified Brief was not found",
          );
          error.code = "CONTENT_WORK_ORDER_NOT_RUNNABLE";
          error.status = 404;
          throw error;
        }
        assertPlanningArtifactScope({
          artifact: existingWorkOrder,
          qaProvenance,
          label: "Content Work Order",
        });
        assertPlanningArtifactScope({
          artifact: existingBrief,
          qaProvenance,
          label: "Unified Content Brief",
        });
        if (
          asId(existingBrief.contentWorkOrderId) !== asId(existingWorkOrder) ||
          asId(existingWorkOrder._id || existingWorkOrder.id) !==
            asId(input.workOrderId)
        ) {
          throw planningArtifactScopeError("Selected Work Order chain");
        }
        const existingWorkOrderRunnable =
          isWorkOrderRunnable(existingWorkOrder, { now }) &&
          existingWorkOrder.decision !== ACTIONS.SKIP;
        if (
          asId(existingWorkOrder.contentOperationsSnapshotId) !==
            asId(snapshot.id) ||
          asId(existingWorkOrder.googleIntelSnapshotId) !== asId(googleSnapshot)
        ) {
          const error = new Error(
            "The Work Order is stale; create a new decision against today's intelligence snapshots",
          );
          error.code = "CONTENT_WORK_ORDER_STALE";
          error.status = 409;
          throw error;
        }
        const selected = await this.OpportunityModel.findById(
          existingWorkOrder.contentOpportunityDecisionId,
        );
        if (!selected)
          throw new Error("The Work Order opportunity decision was not found");
        assertPlanningArtifactScope({
          artifact: selected,
          qaProvenance,
          label: "Content opportunity decision",
        });
        if (
          asId(selected) !== asId(existingWorkOrder.contentOpportunityDecisionId) ||
          asId(selected.contentOperationsSnapshotId) !==
            asId(existingWorkOrder.contentOperationsSnapshotId)
        ) {
          throw planningArtifactScopeError("Selected Work Order chain");
        }
        await this.persistRunTerminal({
          runId: run._id,
          ownerToken: leaseOwner,
          leaseGuard,
          updates: {
            status: existingWorkOrderRunnable ? "completed" : "skipped",
            googleIntelSnapshotId: googleSnapshot.id || googleSnapshot._id,
            contentOperationsSnapshotId: snapshot.id,
            contentInventorySnapshotId: snapshot.contentInventorySnapshotId,
            contentOpportunityDecisionId: selected._id,
            contentWorkOrderId: existingWorkOrder._id,
            unifiedContentBriefId: existingBrief._id,
            selectedDecision: existingWorkOrderRunnable
              ? existingWorkOrder.decision
              : ACTIONS.SKIP,
            sourceHealth: snapshot.sourceHealth,
            sourceFreshness: snapshot.sourceFreshness,
            pipelineSteps: [
              { step: "google_intelligence", status: "completed" },
              { step: "daily_snapshot", status: snapshot.status },
              {
                step: "existing_work_order",
                status: existingWorkOrderRunnable
                  ? "validated"
                  : "not_runnable",
              },
              {
                step: "unified_content_brief",
                status: existingWorkOrderRunnable ? "validated" : "not_started",
              },
              { step: "downstream_production", status: "not_started" },
            ],
          },
        });
        return {
          dryRun: trigger === "preview",
          correlationId,
          runId: asId(run),
          googleIntelSnapshotId: asId(googleSnapshot),
          contentOperationsSnapshotId: asId(snapshot),
          contentInventorySnapshotId: asId(snapshot.contentInventorySnapshotId),
          contentOpportunityDecisionId: asId(selected),
          contentWorkOrderId: asId(existingWorkOrder),
          unifiedContentBriefId: asId(existingBrief),
          evidenceMapId: asId(existingWorkOrder.artifactIds?.evidenceMapId),
          action: existingWorkOrderRunnable
            ? existingWorkOrder.decision
            : ACTIONS.SKIP,
          topic: existingWorkOrder.topic,
          opportunityScore: existingWorkOrder.opportunityScore,
          selectedOpportunity: asObject(selected),
          candidates: [],
          workOrder: asObject(existingWorkOrder),
          brief: existingWorkOrderRunnable ? asObject(existingBrief) : null,
          skipped: !existingWorkOrderRunnable,
          blocked: false,
          warnings: [
            ...(snapshot.warnings || []),
            ...(!existingWorkOrderRunnable
              ? [`work_order_${existingWorkOrder.status}_not_runnable`]
              : []),
          ],
          sourceHealth: snapshot.sourceHealth || [],
          sourceFreshness: snapshot.sourceFreshness || {},
          googleSnapshot: asObject(googleSnapshot),
          contentOperationsSnapshot: snapshot,
          downstreamInvoked: {
            product: false,
            research: false,
            writer: false,
            image: false,
            telegram: false,
            publisher: false,
          },
        };
      }
      const signals = await this.signalService.listSignals({
        limit: 200,
        status: "active",
      });
      if (input.mode !== undefined && !MODES.has(input.mode)) {
        const error = new Error("Unsupported Content Operations mode");
        error.code = "CONTENT_OPERATIONS_MODE_INVALID";
        error.status = 400;
        throw error;
      }
      const mode =
        input.mode ||
        (input.topic || input.primaryKeyword ? "fixed_brief" : "best_action");
      const sourceMap = new Map(
        (snapshot.sourceHealth || []).map((item) => [
          String(item.source),
          item,
        ]),
      );
      const missingRequiredSources = (
        Array.isArray(input.sourceRequirements) ? input.sourceRequirements : []
      ).filter((source) => {
        const health = sourceMap.get(String(source));
        return !health || !["available", "partial"].includes(health.status);
      });
      const ideation = missingRequiredSources.length
        ? { ideas: [], source: "skipped", model: null }
        : await this.runIdeation({ snapshot, inventoryItems, mode, input });
      const candidates = missingRequiredSources.length
        ? []
        : generateOpportunityCandidates({
            snapshot,
            inventoryItems,
            signals,
            input,
            mode,
            ideas: ideation.ideas,
          });
      const decisionConfig = {
        ...this.config,
        opportunitySkipThreshold:
          input.minimumOpportunityScore === undefined
            ? this.config.opportunitySkipThreshold
            : Number(input.minimumOpportunityScore),
      };
      if (leaseGuard)
        await leaseGuard.checkpoint("before_opportunity_decisions");
      const decisionResult = await this.DecisionService.persistCandidates({
        contentOperationsSnapshotId: snapshot.id,
        contentInventorySnapshotId: snapshot.contentInventorySnapshotId,
        planningRunId,
        candidates,
        qaContext: input.qaContext || null,
        config: decisionConfig,
      });
      if (leaseGuard)
        await leaseGuard.checkpoint("after_opportunity_decisions");
      const selected = decisionResult.persisted.find(
        (item) => item.candidateId === decisionResult.selected.candidateId,
      );
      if (!selected)
        throw new Error("Selected opportunity decision was not persisted");
      const selectedObject = asObject(selected);
      const selectedActionIsSkip =
        selectedObject.recommendedAction === ACTIONS.SKIP ||
        selectedObject.decisionType === ACTIONS.SKIP;
      const skipDisallowed = selectedActionIsSkip && input.allowSkip === false;
      const blocked = skipDisallowed || missingRequiredSources.length > 0;
      const blockCode = missingRequiredSources.length > 0
        ? "CONTENT_OPERATIONS_REQUIRED_SOURCE_UNAVAILABLE"
        : skipDisallowed
          ? "CONTENT_OPERATIONS_SKIP_DISALLOWED"
          : "";
      if (
        leaseGuard &&
        selectedObject.status !== "dismissed" &&
        !blocked
      ) {
        await leaseGuard.checkpoint("before_content_work_order");
      }
      const proposedWorkOrderInput = workOrderInputFor({
        decision: selectedObject,
        snapshot,
        input: { ...input, mode },
        adminId,
      });
      if (planningRunId)
        proposedWorkOrderInput.metadata.planningRunId = String(planningRunId);
      const workOrder =
        selectedObject.status === "dismissed" || blocked
          ? null
          : await this.WorkOrderService.createFromDecision({
              decision: selectedObject,
              input: proposedWorkOrderInput,
            });
      if (leaseGuard && workOrder)
        await leaseGuard.checkpoint("after_content_work_order");
      let brief = null;
      const workOrderRunnable = isWorkOrderRunnable(workOrder, { now });
      if (!blocked && !selectedActionIsSkip && workOrderRunnable) {
        if (leaseGuard)
          await leaseGuard.checkpoint("before_unified_content_brief");
        brief = await this.BriefService.create({
          workOrder: asObject(workOrder),
          input: {
            ...briefInputFor({
              workOrder: asObject(workOrder),
              decision: selectedObject,
              input,
              inventoryItems,
            }),
            ...(planningRunId ? { planningRunId } : {}),
          },
        });
        if (leaseGuard)
          await leaseGuard.checkpoint("after_unified_content_brief");
        await this.WorkOrderService.attachArtifact({
          workOrderId: workOrder._id || workOrder.id,
          artifactType: "unifiedContentBriefId",
          artifactId: brief._id || brief.id,
        });
        if (leaseGuard) await leaseGuard.checkpoint("after_brief_attachment");
      }
      const skipped = !blocked && (
        selectedActionIsSkip ||
        !workOrderRunnable ||
        selectedObject.status === "dismissed"
      );
      const selectedDecision = skipped
        ? ACTIONS.SKIP
        : selectedObject.recommendedAction || selectedObject.decisionType;
      await this.persistRunTerminal({
        runId: run._id,
        ownerToken: leaseOwner,
        leaseGuard,
        updates: {
          status: blocked ? "blocked" : skipped ? "skipped" : "completed",
          googleIntelSnapshotId: googleSnapshot.id || googleSnapshot._id,
          contentOperationsSnapshotId: snapshot.id,
          contentInventorySnapshotId: snapshot.contentInventorySnapshotId,
          contentOpportunityDecisionId: selected._id || selected.id,
          contentWorkOrderId: workOrder?._id || workOrder?.id || null,
          unifiedContentBriefId: brief?._id || brief?.id || null,
          selectedDecision,
          candidates: decisionResult.rankedCandidates,
          rejectedDecisions: decisionResult.rankedCandidates.filter(
            (item) => item.candidateId !== selectedObject.candidateId,
          ),
          sourceHealth: snapshot.sourceHealth,
          sourceFreshness: snapshot.sourceFreshness,
          pipelineSteps: [
            { step: "google_intelligence", status: "completed" },
            { step: "daily_snapshot", status: snapshot.status },
            { step: "opportunity_decision", status: "completed" },
            {
              step: "content_work_order",
              status: workOrder ? "completed" : "not_created",
            },
            {
              step: "unified_content_brief",
              status: blocked || skipped ? "not_applicable" : "completed",
            },
            { step: "downstream_production", status: "not_started" },
          ],
          warnings: [
            ...(snapshot.warnings || []),
            ...missingRequiredSources.map(
              (source) => `required_source_unavailable:${source}`,
            ),
            ...(skipDisallowed
              ? ["schedule_disallows_skip_but_no_safe_action_exists"]
              : []),
            ...(!workOrderRunnable && !selectedActionIsSkip && workOrder
              ? [`work_order_${workOrder.status}_not_runnable`]
              : []),
            ...(selectedObject.status === "dismissed"
              ? ["opportunity_was_dismissed"]
              : []),
          ],
        },
      });
      return {
        dryRun: trigger === "preview",
        correlationId,
        runId: asId(run),
        googleIntelSnapshotId: asId(googleSnapshot),
        contentOperationsSnapshotId: asId(snapshot),
        contentInventorySnapshotId: asId(snapshot.contentInventorySnapshotId),
        contentOpportunityDecisionId: asId(selected),
        contentWorkOrderId: asId(workOrder),
        unifiedContentBriefId: asId(brief),
        action: selectedDecision,
        topic: selectedObject.topic,
        opportunityScore: selectedObject.totalScore,
        selectedOpportunity: selectedObject,
        candidates: decisionResult.rankedCandidates,
        workOrder: workOrder ? asObject(workOrder) : null,
        brief: brief ? asObject(brief) : null,
        skipped,
        blocked,
        blockCode,
        missingRequiredSources,
        warnings: [
          ...(snapshot.warnings || []),
          ...missingRequiredSources.map(
            (source) => `required_source_unavailable:${source}`,
          ),
          ...(skipDisallowed
            ? ["schedule_disallows_skip_but_no_safe_action_exists"]
            : []),
          ...(!workOrderRunnable && !selectedActionIsSkip && workOrder
            ? [`work_order_${workOrder.status}_not_runnable`]
            : []),
          ...(selectedObject.status === "dismissed"
            ? ["opportunity_was_dismissed"]
            : []),
        ],
        sourceHealth: snapshot.sourceHealth || [],
        sourceFreshness: snapshot.sourceFreshness || {},
        googleSnapshot: asObject(googleSnapshot),
        contentOperationsSnapshot: snapshot,
        downstreamInvoked: {
          product: false,
          research: false,
          writer: false,
          image: false,
          telegram: false,
          publisher: false,
        },
      };
    } catch (error) {
      await leaseGuard?.stop().catch(() => {});
      const code = safeErrorCode(error);
      let surfacedError = error;
      if (leaseOwner) {
        try {
          await this.compensateRun({
            runId: run._id,
            ownerToken: leaseOwner,
            reasonCode: code,
          });
        } catch (compensationError) {
          surfacedError = compensationError;
        }
      } else {
        await this.RunModel.updateOne(
          { _id: run._id, status: "running" },
          {
            $set: {
              status:
                code === "CONTENT_OPERATIONS_DISABLED" ? "blocked" : "failed",
              errorDetails: [
                { code, message: "Content Operations planning failed safely." },
              ],
              leaseUntil: null,
              lastCheckpoint: "failed",
              completedAt: this.now(),
            },
          },
        ).catch(() => {});
      }
      throw surfacedError;
    } finally {
      await leaseGuard?.stop().catch(() => {});
    }
  }
}

module.exports = {
  ContentOperationsPlanningService,
  applyTrustedRoadmapSelection,
  briefInputFor,
  createPlanningRunLeaseGuard,
  defaultBusinessGoal,
  defaultSuccessMetrics,
  normalizeTrustedRoadmapContext,
  planningRunLeaseLostError,
  workOrderInputFor,
};
