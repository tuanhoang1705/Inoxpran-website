"use strict";

const crypto = require("node:crypto");
const {
  ACTIONS,
  getContentOperationsConfig,
} = require("../../config/contentOperations.config");
const {
  ContentOpportunityDecision,
} = require("../../models/contentOpportunityDecision.model");

const ACTION_VALUES = Object.freeze(Object.values(ACTIONS));
const PRODUCTION_ACTIONS = new Set([
  ACTIONS.NEW,
  ACTIONS.UPDATE,
  ACTIONS.EXPAND,
  ACTIONS.MERGE,
]);

const clamp01 = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed > 1 ? parsed / 100 : parsed));
};

const stableHash = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const readFactor = (factors, names, fallback = 0) => {
  for (const name of names) {
    if (factors?.[name] !== undefined && factors?.[name] !== null)
      return clamp01(factors[name]);
  }
  return clamp01(fallback);
};

const normalizeFactors = (candidate = {}) => {
  const factors = candidate.factors || candidate.scoreFactors || {};
  const userDemand = readFactor(factors, [
    "userDemand",
    "searchDemand",
    "userSearchDemand",
    "demand",
  ]);
  const contentGap = readFactor(factors, ["contentGap", "gap"]);
  const performance = readFactor(factors, [
    "performance",
    "performanceOpportunity",
    "existingPerformanceOpportunity",
  ]);
  const customerSignal = readFactor(factors, [
    "customerSignal",
    "customerQuestionFrequency",
    "customerQuestions",
  ]);
  const internalLink = readFactor(factors, [
    "internalLink",
    "internalLinkOpportunity",
    "internalLinks",
  ]);
  const evidence = readFactor(factors, [
    "evidence",
    "evidenceAvailability",
    "productEvidence",
  ]);
  const explicitUserValue = readFactor(
    factors,
    ["userValue"],
    (userDemand + contentGap + performance + customerSignal) / 4,
  );

  return {
    userDemand,
    contentGap,
    performance,
    business: readFactor(factors, [
      "business",
      "businessValue",
      "businessAlignment",
    ]),
    freshness: readFactor(factors, [
      "freshness",
      "freshnessUrgency",
      "maintenanceUrgency",
    ]),
    customerSignal,
    productCampaign: readFactor(factors, [
      "productCampaign",
      "productCampaignRelevance",
      "productEvidence",
    ]),
    evidence,
    internalLink,
    userValue: Math.max(
      explicitUserValue,
      userDemand,
      contentGap,
      performance,
      customerSignal,
    ),
    // Compatibility aliases are deliberately outside the configurable score keys.
    evidenceAvailability: evidence,
    searchDemand: userDemand,
    businessValue: readFactor(factors, [
      "business",
      "businessValue",
      "businessAlignment",
    ]),
  };
};

const normalizePenaltySignals = (candidate = {}) => {
  const signals = candidate.penaltySignals || candidate.riskSignals || {};
  return [
    [
      "cannibalization_risk",
      "cannibalization",
      readFactor(signals, ["cannibalizationRisk", "cannibalization"]),
    ],
    [
      "duplicate_intent",
      "cannibalization",
      readFactor(signals, ["duplicateIntent"]),
    ],
    [
      "recent_similar_publication",
      "cannibalization",
      readFactor(signals, ["recentSimilarPublication"]),
    ],
    [
      "excessive_topic_exposure",
      "cannibalization",
      readFactor(signals, [
        "excessiveTopicExposure",
        "excessiveCategoryExposure",
      ]),
    ],
    [
      "insufficient_evidence",
      "weakEvidence",
      readFactor(signals, ["insufficientEvidence", "weakEvidence"]),
    ],
    [
      "unsupported_trend",
      "weakEvidence",
      readFactor(signals, ["unsupportedTrend"]),
    ],
    [
      "high_legal_claim_risk",
      "weakEvidence",
      readFactor(signals, ["highLegalClaimRisk", "legalClaimRisk"]),
    ],
    [
      "product_data_conflict",
      "staleProductData",
      readFactor(signals, ["productDataConflict", "staleProductData"]),
    ],
    ["low_confidence", "lowConfidence", readFactor(signals, ["lowConfidence"])],
    ["low_user_value", "lowConfidence", readFactor(signals, ["lowUserValue"])],
    [
      "low_business_relevance",
      "lowConfidence",
      readFactor(signals, ["lowBusinessRelevance"]),
    ],
    [
      "effort_beyond_capacity",
      "lowConfidence",
      readFactor(signals, [
        "effortBeyondCapacity",
        "estimatedEffortBeyondCapacity",
      ]),
    ],
  ];
};

const scoreOpportunityCandidate = (
  candidate = {},
  { config = getContentOperationsConfig() } = {},
) => {
  const decisionType = String(
    candidate.decisionType || candidate.action || "",
  ).trim();
  if (!ACTION_VALUES.includes(decisionType)) {
    const error = new Error(
      `Unsupported content action: ${decisionType || "missing"}`,
    );
    error.code = "INVALID_CONTENT_ACTION";
    throw error;
  }

  if (decisionType === ACTIONS.SKIP) {
    return {
      candidateId: String(candidate.candidateId || "skip"),
      decisionType: ACTIONS.SKIP,
      topic: String(candidate.topic || ""),
      targetBlogIds: [],
      totalScore: 0,
      scoreBreakdown: {},
      positiveEvidence: candidate.positiveEvidence || [],
      penalties: [],
      requiredData: candidate.requiredData || [],
      missingData: candidate.missingData || [],
      risks: candidate.risks || [],
      eligible: true,
      recommendedAction: ACTIONS.SKIP,
      decisionReason: String(
        candidate.decisionReason ||
          candidate.reason ||
          "No sufficiently valuable safe content action is available.",
      ),
      rejectedAlternatives: candidate.rejectedAlternatives || [],
    };
  }

  const normalized = normalizeFactors(candidate);
  const weights = config.opportunityWeights || {};
  const applicable = new Set(
    Array.isArray(candidate.applicableFactors)
      ? candidate.applicableFactors
      : [],
  );
  const weightEntries = Object.entries(weights).filter(
    ([key, value]) =>
      Number.isFinite(Number(value)) &&
      Number(value) >= 0 &&
      (!applicable.size || applicable.has(key)),
  );
  const weightTotal =
    weightEntries.reduce((sum, [, value]) => sum + Number(value), 0) || 1;
  const scoreBreakdown = {};
  let positiveScore = 0;

  for (const [key, configuredWeight] of weightEntries) {
    const raw = clamp01(normalized[key]);
    const weight = Number(configuredWeight) / weightTotal;
    const contribution = raw * weight;
    positiveScore += contribution;
    scoreBreakdown[key] = { raw, weight, contribution };
  }

  const penalties = normalizePenaltySignals(candidate)
    .filter(([, , severity]) => severity > 0)
    .map(([code, configuredKey, severity]) => {
      const configuredWeight = clamp01(
        config.opportunityPenalties?.[configuredKey],
      );
      return {
        code,
        severity,
        configuredKey,
        contribution: severity * configuredWeight,
      };
    });
  const penaltyTotal = penalties.reduce(
    (sum, item) => sum + item.contribution,
    0,
  );
  const totalScore = clamp01(positiveScore - penaltyTotal);
  const requiredData = Array.isArray(candidate.requiredData)
    ? candidate.requiredData.map(String)
    : [];
  const missingData = Array.isArray(candidate.missingData)
    ? candidate.missingData.map(String)
    : [];
  const minimumUserValue = clamp01(config.minimumUserValueScore);
  const userValueScore = clamp01(normalized.userValue);
  const businessOnly =
    userValueScore < minimumUserValue &&
    normalized.business >= minimumUserValue &&
    normalized.userDemand < minimumUserValue &&
    normalized.contentGap < minimumUserValue;
  const evidenceBlocked =
    PRODUCTION_ACTIONS.has(decisionType) &&
    (normalized.evidenceAvailability === 0 ||
      missingData.some((item) => /evidence|source/i.test(item)));
  const eligible =
    !businessOnly &&
    !evidenceBlocked &&
    totalScore >= clamp01(config.opportunitySkipThreshold);
  const risks = [
    ...new Set([
      ...(candidate.risks || []).map(String),
      ...(businessOnly
        ? ["business_priority_without_sufficient_user_value"]
        : []),
      ...(evidenceBlocked
        ? ["insufficient_evidence_for_production_action"]
        : []),
    ]),
  ];
  const decisionReason = eligible
    ? String(
        candidate.decisionReason ||
          candidate.reason ||
          `${decisionType} is the highest-value safe action supported by current evidence.`,
      )
    : businessOnly
      ? "Skipped because business priority alone cannot force a low-user-value content action."
      : evidenceBlocked
        ? "Skipped because the proposed production action lacks required evidence."
        : "Skipped because the opportunity score is below the configured threshold.";

  return {
    candidateId: String(
      candidate.candidateId ||
        stableHash({
          decisionType,
          topic: candidate.topic,
          targets: candidate.targetBlogIds,
        }).slice(0, 24),
    ),
    decisionType,
    topic: String(candidate.topic || "").trim(),
    targetBlogIds: Array.isArray(candidate.targetBlogIds)
      ? candidate.targetBlogIds
      : [],
    primaryTargetBlogId:
      candidate.primaryTargetBlogId || candidate.targetBlogId || null,
    totalScore,
    scoreBreakdown,
    positiveEvidence: Array.isArray(candidate.positiveEvidence)
      ? candidate.positiveEvidence
      : [],
    penalties,
    requiredData,
    missingData,
    risks,
    eligible,
    recommendedAction: eligible ? decisionType : ACTIONS.SKIP,
    decisionReason,
    rejectedAlternatives: Array.isArray(candidate.rejectedAlternatives)
      ? candidate.rejectedAlternatives
      : [],
  };
};

const rankOpportunityCandidates = (candidates = [], options = {}) =>
  candidates
    .map((candidate) => scoreOpportunityCandidate(candidate, options))
    .sort(
      (left, right) =>
        Number(right.eligible) - Number(left.eligible) ||
        right.totalScore - left.totalScore ||
        left.decisionType.localeCompare(right.decisionType) ||
        left.candidateId.localeCompare(right.candidateId),
    );

const chooseBestAction = ({
  candidates = [],
  config = getContentOperationsConfig(),
} = {}) => {
  const rankedCandidates = rankOpportunityCandidates(candidates, { config });
  const selected = rankedCandidates.find(
    (candidate) =>
      candidate.eligible && candidate.decisionType !== ACTIONS.SKIP,
  );
  if (selected) {
    return {
      selected: { ...selected, status: "selected", selectedAt: new Date() },
      rankedCandidates,
      skipped: false,
    };
  }

  const reasons = rankedCandidates.flatMap(
    (candidate) => candidate.risks || [],
  );
  const skip = scoreOpportunityCandidate(
    {
      candidateId: "skip",
      decisionType: ACTIONS.SKIP,
      risks: [...new Set(reasons)],
      decisionReason: rankedCandidates.length
        ? "No candidate met the configured user-value, evidence, and score thresholds."
        : "No content opportunity candidates were available.",
    },
    { config },
  );
  return {
    selected: { ...skip, status: "selected", selectedAt: new Date() },
    rankedCandidates,
    skipped: true,
  };
};

class ContentOpportunityDecisionService {
  static scoreCandidate(candidate, options) {
    return scoreOpportunityCandidate(candidate, options);
  }
  static rankCandidates(candidates, options) {
    return rankOpportunityCandidates(candidates, options);
  }
  static chooseBestAction(input) {
    return chooseBestAction(input);
  }

  static async persistCandidates({
    contentOperationsSnapshotId,
    contentInventorySnapshotId = null,
    planningRunId = null,
    candidates = [],
    config,
    DecisionModel = ContentOpportunityDecision,
  }) {
    if (!contentOperationsSnapshotId)
      throw new Error("contentOperationsSnapshotId is required");
    const result = chooseBestAction({ candidates, config });
    const selectedId = result.selected.candidateId;
    const documents = [...result.rankedCandidates];
    if (!documents.some((item) => item.candidateId === selectedId))
      documents.push(result.selected);

    const persisted = [];
    for (const item of documents) {
      const isSelected = item.candidateId === selectedId;
      const document = {
        ...item,
        contentOperationsSnapshotId,
        contentInventorySnapshotId,
        status: isSelected ? "selected" : "candidate",
        selectedAt: isSelected ? new Date() : null,
        contentHash: stableHash(item),
      };
      delete document.eligible;
      const initialStatus = document.status;
      const initialSelectedAt = document.selectedAt;
      delete document.status;
      delete document.selectedAt;
      document.metadata = {
        ...(document.metadata || {}),
        latestPreviewSelected: isSelected,
        latestPreviewAt: new Date(),
      };
      const update = planningRunId
        ? {
            // Scheduled planning artifacts are immutable once claimed by a run. This
            // lets lease-loss compensation remove only inserts owned by that run while
            // leaving a previously persisted decision untouched.
            $setOnInsert: {
              ...document,
              status: initialStatus,
              selectedAt: initialSelectedAt,
              planningRunId,
            },
          }
        : {
            $set: document,
            $setOnInsert: {
              status: initialStatus,
              selectedAt: initialSelectedAt,
            },
          };
      persisted.push(
        await DecisionModel.findOneAndUpdate(
          { contentOperationsSnapshotId, candidateId: item.candidateId },
          update,
          { upsert: true, new: true, runValidators: true },
        ),
      );
    }
    return { ...result, persisted };
  }
}

module.exports = {
  ContentOpportunityDecisionService,
  chooseBestAction,
  normalizeFactors,
  rankOpportunityCandidates,
  scoreOpportunityCandidate,
};
