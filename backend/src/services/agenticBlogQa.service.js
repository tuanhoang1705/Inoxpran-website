"use strict";

const crypto = require("node:crypto");
const { Types } = require("mongoose");
const { AgenticBlogQaBatch } = require("../models/agenticBlogQaBatch.model");
const { AgenticBlogQaCase } = require("../models/agenticBlogQaCase.model");
const {
  BlogAutomationSchedule,
} = require("../models/blogAutomationSchedule.model");
const {
  BlogAutomationExecution,
} = require("../models/blogAutomationExecution.model");
const { blog: BlogPost } = require("../models/blog.model");
const {
  SeniorBlogAcceptanceReport,
} = require("../models/seniorBlogAcceptanceReport.model");
const {
  QaRemediationAttempt,
} = require("../models/qaRemediationAttempt.model");
const {
  QaTopicUniquenessService,
  normalizeTopicKey,
} = require("./qaTopicUniqueness.service");
const {
  SeniorBlogAcceptanceService,
} = require("./seniorBlogAcceptance.service");
const {
  QaRemediationOrchestrator,
  buildRemediationIdempotencyHash,
  currentCodeRevision,
} = require("./qaRemediationOrchestrator.service");
const {
  BlogAutomationScheduleService,
} = require("./blogAutomationSchedule.service");
const {
  ensureQaInfrastructureOnce,
} = require("./agenticBlogQaInfrastructure.service");
const {
  BadRequestError,
  ConflictRequestError,
  NotFoundError,
} = require("../core/error.response");
const {
  QA_EXECUTION_MODES,
  MAX_REMEDIATION_ITERATIONS,
  buildDefaultQaCaseMatrix,
  buildQaRunSlotKeyHash,
  buildAgenticBlogQaConfig,
} = require("../config/agenticBlogQa.config");

const MAX_CASES = 12;
const sha256 = (value) =>
  crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
const deterministicObjectId = (value) =>
  new Types.ObjectId(sha256(value).slice(0, 24));
const SECRET_ASSIGNMENT =
  /\b(?:[A-Za-z0-9_.-]*(?:token|secret|password|credential|authorization)|api[_-]?key)\b\s*[:=]/i;
const SECRET_URL_PARAMETER =
  /[?&#](?:token|access_token|auth|authorization|api[_-]?key|secret|password|credential)=/i;
const SECRET_VALUE_PATTERN =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAIza[A-Za-z0-9_-]{20,})/i;

const assertObjectId = (value, field) => {
  if (!Types.ObjectId.isValid(String(value || "")))
    throw new BadRequestError(`${field} is invalid`);
  return new Types.ObjectId(String(value));
};

const validateSafeKey = (value, field = "Idempotency-Key") => {
  const normalized = String(value || "").trim();
  if (
    normalized.length < 8 ||
    normalized.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(normalized)
  ) {
    throw new BadRequestError(`${field} must be 8-128 safe ASCII characters`);
  }
  return normalized;
};

const leanQuery = async (query) => (query?.lean ? query.lean() : query);
const toPlain = (value) => (value?.toObject ? value.toObject() : value);
const writeMatched = (result) =>
  Number(
    result?.matchedCount ?? result?.modifiedCount ?? result?.nModified ?? 0,
  ) > 0;
const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const assertExactKeys = (value, required, optional = [], field = "payload") => {
  const prototype = isRecord(value) ? Object.getPrototypeOf(value) : null;
  if (
    !isRecord(value) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    throw new BadRequestError(`${field} must be an object`);
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    !required.every((key) => keys.includes(key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw new BadRequestError(`${field} contains invalid fields`);
  }
  return value;
};

const normalizeListQuery = (query = {}) => {
  assertExactKeys(
    query,
    [],
    ["page", "limit", "environment"],
    "QA batch query",
  );
  const boundedInteger = (key, fallback, maximum) => {
    if (!Object.hasOwn(query, key)) return fallback;
    const raw = query[key];
    if (!["string", "number"].includes(typeof raw)) {
      throw new BadRequestError(
        `QA batch query ${key} must be an integer between 1 and ${maximum}`,
      );
    }
    const parsed = Number(String(raw).trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
      throw new BadRequestError(
        `QA batch query ${key} must be an integer between 1 and ${maximum}`,
      );
    }
    return parsed;
  };
  let environment;
  if (Object.hasOwn(query, "environment")) {
    if (typeof query.environment !== "string") {
      throw new BadRequestError(
        "QA batch query environment must be local or staging",
      );
    }
    environment = query.environment.trim();
    if (environment && !["local", "staging"].includes(environment)) {
      throw new BadRequestError(
        "QA batch query environment must be local or staging",
      );
    }
  }
  return {
    page: boundedInteger("page", 1, 1_000_000),
    limit: boundedInteger("limit", 20, 100),
    environment: environment || undefined,
  };
};

const assertEmptyQuery = (query = {}) =>
  assertExactKeys(query, [], [], "QA request query");

const hasDisallowedControlCharacter = (value) =>
  [...String(value || "")].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  });

const containsSecretMaterial = (value) => {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return (
    SECRET_ASSIGNMENT.test(serialized) ||
    SECRET_URL_PARAMETER.test(serialized) ||
    SECRET_VALUE_PATTERN.test(serialized)
  );
};

const assertNoSecretMaterial = (value, field) => {
  if (containsSecretMaterial(value)) {
    throw new BadRequestError(
      `${field} must not contain credentials or secret material`,
    );
  }
};

const boundedEvidenceText = (value, field, { min = 8, max = 1000 } = {}) => {
  const normalized = String(value || "").trim();
  if (
    normalized.length < min ||
    normalized.length > max ||
    hasDisallowedControlCharacter(normalized)
  ) {
    throw new BadRequestError(`${field} must be ${min}-${max} characters`);
  }
  assertNoSecretMaterial(normalized, field);
  return normalized;
};

const normalizeRevision = (value, field = "appliedCodeRevision") => {
  const normalized = String(value || "").trim();
  if (
    normalized.length < 7 ||
    normalized.length > 160 ||
    !/^[A-Za-z0-9._:/@+\-]+$/.test(normalized)
  ) {
    throw new BadRequestError(
      `${field} must be a 7-160 character source revision identifier`,
    );
  }
  return normalized;
};

const normalizeVerificationRefs = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new BadRequestError(
      "actionEvidence.verificationRefs must contain 1-20 references",
    );
  }
  return value.map((item, index) => {
    const normalized = String(item || "").trim();
    if (
      normalized.length < 3 ||
      normalized.length > 160 ||
      !/^[A-Za-z0-9._:/@+\-]+$/.test(normalized)
    ) {
      throw new BadRequestError(
        `actionEvidence.verificationRefs[${index}] is invalid`,
      );
    }
    assertNoSecretMaterial(
      normalized,
      `actionEvidence.verificationRefs[${index}]`,
    );
    return normalized;
  });
};

const normalizeCodeActionEvidence = ({
  payload,
  attempt,
  serverCodeRevision,
}) => {
  assertExactKeys(
    payload,
    ["acknowledgeCodeChange", "appliedCodeRevision", "actionEvidence"],
    [],
    "remediation body",
  );
  if (payload?.acknowledgeCodeChange !== true) {
    throw new BadRequestError(
      "acknowledgeCodeChange must be true before a shared or systemic rerun",
    );
  }
  const appliedCodeRevision = normalizeRevision(payload?.appliedCodeRevision);
  const verifiedServerRevision = normalizeRevision(
    serverCodeRevision,
    "serverCodeRevision",
  );
  const baselineCodeRevision = String(
    attempt?.baselineCodeRevision || "",
  ).trim();
  if (
    baselineCodeRevision.length < 7 ||
    baselineCodeRevision.length > 160 ||
    !/^[A-Za-z0-9._:/@+\-]+$/.test(baselineCodeRevision)
  ) {
    throw new ConflictRequestError(
      "The remediation attempt has no verifiable baseline code revision",
    );
  }
  if (appliedCodeRevision !== verifiedServerRevision) {
    throw new ConflictRequestError(
      "Applied code revision does not match the running server revision",
    );
  }
  if (appliedCodeRevision === baselineCodeRevision) {
    throw new ConflictRequestError(
      "The running code revision has not changed since remediation planning",
    );
  }
  const source = payload?.actionEvidence;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new BadRequestError(
      "actionEvidence is required for a shared or systemic rerun",
    );
  }
  const requiresArchitectureReport =
    attempt?.requiresArchitectureReport === true;
  if (requiresArchitectureReport && !isRecord(source.architectureReport)) {
    throw new BadRequestError(
      "actionEvidence.architectureReport is required for systemic remediation",
    );
  }
  assertExactKeys(
    source,
    requiresArchitectureReport
      ? [
          "changedLayer",
          "changeSummary",
          "verificationRefs",
          "architectureReport",
        ]
      : ["changedLayer", "changeSummary", "verificationRefs"],
    [],
    "actionEvidence",
  );
  const changedLayer = boundedEvidenceText(
    source.changedLayer,
    "actionEvidence.changedLayer",
    { min: 3, max: 160 },
  );
  if (changedLayer !== String(attempt?.failedLayer || "")) {
    throw new BadRequestError(
      "actionEvidence.changedLayer must exactly match the failed remediation layer",
    );
  }
  const evidence = {
    type: "verified_code_change",
    changedLayer,
    changeSummary: boundedEvidenceText(
      source.changeSummary,
      "actionEvidence.changeSummary",
      { min: 12, max: 1000 },
    ),
    verificationRefs: normalizeVerificationRefs(source.verificationRefs),
  };
  if (requiresArchitectureReport) {
    const report = source.architectureReport;
    if (!report || typeof report !== "object" || Array.isArray(report)) {
      throw new BadRequestError(
        "actionEvidence.architectureReport is required for systemic remediation",
      );
    }
    assertExactKeys(
      report,
      ["failedLayer", "rootCause", "redesignScope", "backwardCompatibility"],
      [],
      "actionEvidence.architectureReport",
    );
    const reportLayer = boundedEvidenceText(
      report.failedLayer,
      "actionEvidence.architectureReport.failedLayer",
      { min: 3, max: 160 },
    );
    if (reportLayer !== String(attempt.failedLayer || "")) {
      throw new BadRequestError(
        "The architecture report must identify the exact failed layer",
      );
    }
    evidence.architectureReport = {
      failedLayer: reportLayer,
      rootCause: boundedEvidenceText(
        report.rootCause,
        "actionEvidence.architectureReport.rootCause",
        { min: 20, max: 1500 },
      ),
      redesignScope: boundedEvidenceText(
        report.redesignScope,
        "actionEvidence.architectureReport.redesignScope",
        { min: 12, max: 1000 },
      ),
      backwardCompatibility: boundedEvidenceText(
        report.backwardCompatibility,
        "actionEvidence.architectureReport.backwardCompatibility",
        { min: 12, max: 1000 },
      ),
    };
  }
  return { appliedCodeRevision, actionEvidence: evidence };
};

const publicId = (value) => (value ? String(value) : "");
const publicIds = (value) =>
  (Array.isArray(value) ? value : []).map(publicId).filter(Boolean);
const publicNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};
const publicText = (value, max = 1500) => {
  const normalized = String(value || "")
    .trim()
    .slice(0, max);
  return normalized && !containsSecretMaterial(normalized) ? normalized : "";
};
const publicTexts = (value, max = 1500) =>
  (Array.isArray(value) ? value : [])
    .map((item) => publicText(item, max))
    .filter(Boolean);

const publicAcceptance = (value) => ({
  pass: value?.pass === true,
  reasonCodes: publicTexts(value?.reasonCodes, 120),
});

const publicIssue = (value) => {
  if (typeof value === "string") return publicText(value, 500);
  if (!isRecord(value)) return null;
  return {
    code: publicText(value.code, 120),
    severity: publicText(value.severity, 32),
    source: publicText(value.source, 80),
    message: publicText(value.message, 500),
    description: publicText(value.description, 500),
  };
};

const publicIssues = (value) =>
  (Array.isArray(value) ? value : [])
    .map(publicIssue)
    .filter((item) =>
      typeof item === "string"
        ? Boolean(item)
        : Boolean(item && Object.values(item).some(Boolean)),
    );

const publicCategory = (value) => ({
  score: publicNumber(value?.score),
  maximum: publicNumber(value?.maximum),
  notApplicable: value?.notApplicable === true,
  evidence: publicTexts(value?.evidence, 500),
  strengths: publicTexts(value?.strengths, 500),
  issues: publicIssues(value?.issues),
  requiredFixes: publicTexts(value?.requiredFixes, 500),
});

const publicCategories = (value) => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key))
      .map(([key, category]) => [key, publicCategory(category)]),
  );
};

const publicGate = (value) => {
  if (!isRecord(value)) return null;
  return {
    key: publicText(value.key, 120),
    code: publicText(value.code, 120),
    reasonCode: publicText(value.reasonCode, 120),
    severity: publicText(value.severity, 32),
    pass: value.pass === true,
    status: publicText(value.status, 80),
    message: publicText(value.message, 500),
    description: publicText(value.description, 500),
  };
};

const publicGates = (value) =>
  (Array.isArray(value) ? value : [])
    .map(publicGate)
    .filter(
      (item) =>
        item &&
        Object.values(item).some((entry) => entry !== "" && entry !== false),
    );

const publicRunAttempt = (value) => ({
  attempt: Number.isFinite(Number(value?.attempt))
    ? Number(value.attempt)
    : null,
  batchIteration: Number.isFinite(Number(value?.batchIteration))
    ? Number(value.batchIteration)
    : null,
  executionMode: publicText(value?.executionMode, 80),
  executionId: publicId(value?.executionId),
  status: publicText(value?.status, 80),
  dispatchState: publicText(value?.dispatchState, 80),
  queuedAt: value?.queuedAt || null,
  scheduledFor: value?.scheduledFor || null,
  startedAt: value?.startedAt || null,
  completedAt: value?.completedAt || null,
  errorCode: publicText(value?.errorCode, 120),
});

const publicBatch = (value) => {
  const batch = toPlain(value);
  if (!batch) return null;
  const caseIds = publicIds(batch.caseIds);
  return {
    id: publicId(batch._id || batch.id),
    qaBatchId: publicId(batch.qaBatchId || batch._id || batch.id),
    environment: publicText(batch.environment, 32),
    status: publicText(batch.status, 80),
    stopNewDrafts: batch.stopNewDrafts === true,
    acceptanceThreshold: publicNumber(batch.acceptanceThreshold),
    existingSeoThreshold: publicNumber(batch.existingSeoThreshold),
    iteration: publicNumber(batch.iteration),
    maxIterations: publicNumber(batch.maxIterations),
    requireAllCasesPass: batch.requireAllCasesPass === true,
    caseIds,
    caseCount: caseIds.length,
    remediationState: publicText(batch.remediationState, 80),
    safetyPolicy: {
      allowPublicPublish: batch.safetyPolicy?.allowPublicPublish === true,
      telegramEnabled: batch.safetyPolicy?.telegramEnabled === true,
      paidImagesEnabled: batch.safetyPolicy?.paidImagesEnabled === true,
      requestIndexing: batch.safetyPolicy?.requestIndexing === true,
      socialDistribution: batch.safetyPolicy?.socialDistribution === true,
      blindReviewEnabled: batch.safetyPolicy?.blindReviewEnabled === true,
      topicUniquenessEnabled:
        batch.safetyPolicy?.topicUniquenessEnabled === true,
    },
    startedAt: batch.startedAt || null,
    completedAt: batch.completedAt || null,
    createdAt: batch.createdAt || null,
    updatedAt: batch.updatedAt || null,
    lastErrorCode: publicText(batch.lastErrorCode, 120),
  };
};

const publicCase = (value) => {
  const item = toPlain(value);
  if (!item) return null;
  return {
    id: publicId(item._id || item.id),
    batchId: publicId(item.batchId),
    qaBatchId: publicId(item.qaBatchId),
    qaCaseId: publicId(item.qaCaseId || item._id || item.id),
    caseKey: publicText(item.caseKey, 120),
    environment: publicText(item.environment, 32),
    executionMode: publicText(item.executionMode, 80),
    scheduleMode: publicText(item.scheduleMode, 80),
    originalTopicSeed: publicText(item.originalTopicSeed, 300),
    effectiveTopic: publicText(item.effectiveTopic, 300),
    articleType: publicText(item.articleType, 100),
    contentRole: publicText(item.contentRole, 120),
    searchIntent: publicText(item.searchIntent, 120),
    productMode: publicText(item.productMode, 32),
    productIntensity: publicText(item.productIntensity, 32),
    placementStyle: publicText(item.placementStyle, 120),
    scheduleId: publicId(item.scheduleId),
    executionId: publicId(item.executionId),
    blogId: publicId(item.blogId),
    acceptanceReportId: publicId(item.acceptanceReportId),
    expectedRunAt: item.expectedRunAt || null,
    actualRunAt: item.actualRunAt || null,
    status: publicText(item.status, 80),
    runAttempts: (Array.isArray(item.runAttempts) ? item.runAttempts : []).map(
      publicRunAttempt,
    ),
    seniorScore: publicNumber(item.seniorScore),
    existingSeoScore: publicNumber(item.existingSeoScore),
    hardGatePassed: item.hardGatePassed === true,
    draftAcceptance: publicAcceptance(item.draftAcceptance),
    publishAcceptance: publicAcceptance(item.publishAcceptance),
    issueCounts: {
      critical: Number(item.issueCounts?.critical || 0),
      high: Number(item.issueCounts?.high || 0),
      medium: Number(item.issueCounts?.medium || 0),
      low: Number(item.issueCounts?.low || 0),
    },
    startedAt: item.startedAt || null,
    completedAt: item.completedAt || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    lastErrorCode: publicText(item.lastErrorCode, 120),
  };
};

const publicReport = (value) => {
  const report = toPlain(value);
  if (!report) return null;
  return {
    id: publicId(report._id || report.id),
    batchId: publicId(report.batchId),
    caseId: publicId(report.caseId),
    qaBatchId: publicId(report.qaBatchId),
    qaCaseId: publicId(report.qaCaseId),
    environment: publicText(report.environment, 32),
    executionMode: publicText(report.executionMode, 80),
    originalTopicSeed: publicText(report.originalTopicSeed, 300),
    blogId: publicId(report.blogId),
    executionId: publicId(report.executionId),
    iteration: publicNumber(report.iteration),
    version: publicNumber(report.version),
    previousReportId: publicId(report.previousReportId),
    blindReview: report.blindReview === true,
    independence: {
      blindReviewConfirmed: report.independence?.blindReviewConfirmed === true,
      forbiddenInputsDetected: publicTexts(
        report.independence?.forbiddenInputsDetected,
        120,
      ),
    },
    rubricVersion: publicText(report.rubricVersion, 120),
    categories: publicCategories(report.categories),
    totalScore: publicNumber(report.totalScore),
    acceptanceThreshold: publicNumber(report.acceptanceThreshold),
    existingSeoScore: publicNumber(report.existingSeoScore),
    existingSeoThreshold: publicNumber(report.existingSeoThreshold),
    hardGates: publicGates(report.hardGates),
    auditorHardGates: publicGates(report.auditorHardGates),
    publishOnlyGates: publicGates(report.publishOnlyGates),
    criticalHighIssues: publicIssues(report.criticalHighIssues),
    hardGatePassed: report.hardGatePassed === true,
    issueCounts: {
      critical: Number(report.issueCounts?.critical || 0),
      high: Number(report.issueCounts?.high || 0),
      medium: Number(report.issueCounts?.medium || 0),
      low: Number(report.issueCounts?.low || 0),
    },
    requiredFixes: publicTexts(report.requiredFixes, 500),
    draftAcceptance: publicAcceptance(report.draftAcceptance),
    publishAcceptance: publicAcceptance(report.publishAcceptance),
    verdict: publicText(report.verdict, 32),
    auditorAgentId: publicText(report.auditorAgentId, 120),
    evaluatedAt: report.evaluatedAt || null,
    createdAt: report.createdAt || null,
  };
};

const publicRemediation = (value) => {
  const attempt = toPlain(value);
  if (!attempt) return null;
  const evidence = isRecord(attempt.actionEvidence)
    ? attempt.actionEvidence
    : {};
  return {
    id: publicId(attempt._id || attempt.id),
    attemptId: publicId(attempt._id || attempt.id),
    batchId: publicId(attempt.batchId),
    caseId: publicId(attempt.caseId),
    qaBatchId: publicId(attempt.qaBatchId),
    qaCaseId: publicId(attempt.qaCaseId),
    environment: publicText(attempt.environment, 32),
    executionMode: publicText(attempt.executionMode, 80),
    originalTopicSeed: publicText(attempt.originalTopicSeed, 300),
    caseIds: publicIds(attempt.caseIds),
    sourceReportIds: publicIds(attempt.sourceReportIds),
    previousReportIds: publicIds(attempt.previousReportIds),
    resultingReportIds: publicIds(attempt.resultingReportIds),
    rerunCaseIds: publicIds(attempt.rerunCaseIds),
    controlCaseIds: publicIds(attempt.controlCaseIds),
    iteration: publicNumber(attempt.iteration),
    classification: publicText(attempt.classification, 80),
    status: publicText(attempt.status, 80),
    issueCodes: publicTexts(attempt.issueCodes, 120),
    failedLayer: publicText(attempt.failedLayer, 160),
    plan: (Array.isArray(attempt.plan) ? attempt.plan : []).map((step) => ({
      action: publicText(step?.action, 300),
      target: publicText(step?.target, 200),
      expectedEvidence: publicText(step?.expectedEvidence, 500),
    })),
    regressionControls: (Array.isArray(attempt.regressionControls)
      ? attempt.regressionControls
      : []
    ).map((control) => ({
      control: publicText(control?.control, 120),
      required: control?.required === true,
      scope: publicTexts(control?.scope, 160),
      evidence: publicText(control?.evidence, 500),
    })),
    stopNewDrafts: attempt.stopNewDrafts === true,
    requiresArchitectureReport: attempt.requiresArchitectureReport === true,
    actionState: publicText(attempt.actionState, 80),
    baselineCodeRevision: publicText(attempt.baselineCodeRevision, 160),
    appliedCodeRevision: publicText(attempt.appliedCodeRevision, 160),
    actionEvidenceSummary: {
      type: publicText(evidence.type, 80),
      changedLayer: publicText(evidence.changedLayer, 160),
      verificationCount: Array.isArray(evidence.verificationRefs)
        ? evidence.verificationRefs.length
        : 0,
      architectureReportIncluded: isRecord(evidence.architectureReport),
      revisedCaseCount: Array.isArray(evidence.caseRevisions)
        ? evidence.caseRevisions.length
        : 0,
    },
    startedAt: attempt.startedAt || null,
    completedAt: attempt.completedAt || null,
    createdAt: attempt.createdAt || null,
    updatedAt: attempt.updatedAt || null,
    errorCode: publicText(attempt.errorCode, 120),
  };
};

const validateResumePayloadEnvelope = (payload) => {
  assertExactKeys(
    payload,
    [],
    ["acknowledgeCodeChange", "appliedCodeRevision", "actionEvidence"],
    "remediation body",
  );
  if (Object.keys(payload).length === 0) return "empty";
  assertExactKeys(
    payload,
    ["acknowledgeCodeChange", "appliedCodeRevision", "actionEvidence"],
    [],
    "remediation body",
  );
  assertExactKeys(
    payload.actionEvidence,
    ["changedLayer", "changeSummary", "verificationRefs"],
    ["architectureReport"],
    "actionEvidence",
  );
  boundedEvidenceText(
    payload.actionEvidence.changedLayer,
    "actionEvidence.changedLayer",
    { min: 3, max: 160 },
  );
  boundedEvidenceText(
    payload.actionEvidence.changeSummary,
    "actionEvidence.changeSummary",
    { min: 12, max: 1000 },
  );
  normalizeVerificationRefs(payload.actionEvidence.verificationRefs);
  if (Object.hasOwn(payload.actionEvidence, "architectureReport")) {
    const report = assertExactKeys(
      payload.actionEvidence.architectureReport,
      ["failedLayer", "rootCause", "redesignScope", "backwardCompatibility"],
      [],
      "actionEvidence.architectureReport",
    );
    boundedEvidenceText(
      report.failedLayer,
      "actionEvidence.architectureReport.failedLayer",
      { min: 3, max: 160 },
    );
    boundedEvidenceText(
      report.rootCause,
      "actionEvidence.architectureReport.rootCause",
      { min: 20, max: 1500 },
    );
    boundedEvidenceText(
      report.redesignScope,
      "actionEvidence.architectureReport.redesignScope",
      { min: 12, max: 1000 },
    );
    boundedEvidenceText(
      report.backwardCompatibility,
      "actionEvidence.architectureReport.backwardCompatibility",
      { min: 12, max: 1000 },
    );
  }
  return "code";
};

const normalizeCaseInput = (input, index) => {
  if (!input || typeof input !== "object")
    throw new BadRequestError(`cases[${index}] must be an object`);
  const caseKey = String(input.caseKey || `case-${index + 1}`)
    .trim()
    .slice(0, 120);
  const originalTopicSeed = String(
    input.originalTopicSeed || input.topicSeed || "",
  ).trim();
  if (!caseKey || !originalTopicSeed)
    throw new BadRequestError(`cases[${index}] requires caseKey and topicSeed`);
  const executionMode = String(input.executionMode || "").trim();
  if (!QA_EXECUTION_MODES.includes(executionMode))
    throw new BadRequestError(`cases[${index}].executionMode is invalid`);
  const articleType = String(input.articleType || "").trim();
  const contentRole = String(input.contentRole || "").trim();
  const searchIntent = String(input.searchIntent || "").trim();
  if (!articleType || !contentRole || !searchIntent) {
    throw new BadRequestError(
      `cases[${index}] requires articleType, contentRole, and searchIntent`,
    );
  }
  const productMode = String(input.productMode || "off").trim();
  if (!["off", "auto", "required"].includes(productMode))
    throw new BadRequestError(`cases[${index}].productMode is invalid`);
  const productIntensity = String(input.productIntensity || "light").trim();
  if (!["light", "balanced", "commercial"].includes(productIntensity))
    throw new BadRequestError(`cases[${index}].productIntensity is invalid`);
  const plannedOutline = (
    Array.isArray(input.plannedOutline || input.outline)
      ? input.plannedOutline || input.outline
      : []
  )
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 20);
  return {
    caseKey,
    executionMode,
    originalTopicSeed,
    effectiveTopic: String(input.effectiveTopic || originalTopicSeed).trim(),
    mainEntity: String(input.mainEntity || "").trim(),
    topicCore: String(input.topicCore || originalTopicSeed).trim(),
    userProblem: String(input.userProblem || "").trim(),
    audience: String(input.audience || "").trim(),
    plannedOutline,
    articleType,
    contentRole,
    searchIntent,
    productMode,
    productIntensity,
    placementStyle: String(input.placementStyle || "").trim(),
    expectedRunAt: input.expectedRunAt ? new Date(input.expectedRunAt) : null,
  };
};

class AgenticBlogQaBatchService {
  constructor({
    BatchModel = AgenticBlogQaBatch,
    CaseModel = AgenticBlogQaCase,
    ScheduleModel = BlogAutomationSchedule,
    ExecutionModel = BlogAutomationExecution,
    BlogModel = BlogPost,
    ReportModel = SeniorBlogAcceptanceReport,
    RemediationModel = QaRemediationAttempt,
    TopicService = new QaTopicUniquenessService(),
    AcceptanceService = new SeniorBlogAcceptanceService(),
    RemediationService = new QaRemediationOrchestrator(),
    ScheduleService = BlogAutomationScheduleService,
    EnsureInfrastructure = ensureQaInfrastructureOnce,
    CodeRevision = currentCodeRevision,
    config = null,
    now = () => new Date(),
  } = {}) {
    this.BatchModel = BatchModel;
    this.CaseModel = CaseModel;
    this.ScheduleModel = ScheduleModel;
    this.ExecutionModel = ExecutionModel;
    this.BlogModel = BlogModel;
    this.ReportModel = ReportModel;
    this.RemediationModel = RemediationModel;
    this.TopicService = TopicService;
    this.AcceptanceService = AcceptanceService;
    this.RemediationService = RemediationService;
    this.ScheduleService = ScheduleService;
    this.EnsureInfrastructure = EnsureInfrastructure;
    this.CodeRevision = CodeRevision;
    this.config = config;
    this.now = now;
  }

  _config() {
    const config = this.config || buildAgenticBlogQaConfig();
    if (!config.enabled)
      throw new BadRequestError("AGENTIC_BLOG_QA_ENABLED is false");
    if (!["local", "staging"].includes(config.environment))
      throw new BadRequestError("QA environment is unsafe");
    return config;
  }

  async _ensureInfrastructure(config) {
    if (typeof this.EnsureInfrastructure !== "function") return null;
    return this.EnsureInfrastructure({ config });
  }

  async createBatch({ payload = {}, query = {}, adminId, idempotencyKey }) {
    assertEmptyQuery(query);
    assertExactKeys(payload, ["environment"], [], "QA batch body");
    if (typeof payload.environment !== "string") {
      throw new BadRequestError("Batch environment must be local or staging");
    }
    const environment = payload.environment.trim();
    if (!["local", "staging"].includes(environment)) {
      throw new BadRequestError("Batch environment must be local or staging");
    }
    const config = this._config();
    await this._ensureInfrastructure(config);
    const rawKey = validateSafeKey(idempotencyKey);
    if (environment !== config.environment)
      throw new BadRequestError(
        "Batch environment must match the validated QA environment",
      );
    const adminScope = String(adminId || "system");
    const batchKeyHash = sha256(
      `qa-batch-v1\0${environment}\0${adminScope}\0${rawKey}`,
    );
    const caseInputs = buildDefaultQaCaseMatrix({
      environment,
      config,
      variantSeed: batchKeyHash,
    }).map(normalizeCaseInput);
    if (!caseInputs.length || caseInputs.length > MAX_CASES)
      throw new BadRequestError(`cases must contain 1-${MAX_CASES} items`);
    if (
      new Set(caseInputs.map((item) => item.caseKey)).size !== caseInputs.length
    )
      throw new BadRequestError("caseKey values must be unique in a batch");
    let existingQuery = this.BatchModel.findOne({ environment, batchKeyHash });
    if (existingQuery?.lean) existingQuery = existingQuery.lean();
    const existing = await existingQuery;

    const batchId = deterministicObjectId(
      `qa-batch-id-v1\0${environment}\0${adminScope}\0${rawKey}`,
    );
    const createdBy = Types.ObjectId.isValid(adminScope)
      ? new Types.ObjectId(adminScope)
      : null;
    const batchDocument = {
      _id: batchId,
      isQaTest: true,
      qaBatchId: batchId,
      batchKeyHash,
      environment,
      status: "planned",
      acceptanceThreshold: config.requiredScore,
      existingSeoThreshold: config.existingSeoThreshold,
      iteration: 0,
      maxIterations: config.maxIterations,
      requireAllCasesPass: true,
      safetyPolicy: {
        allowPublicPublish: false,
        telegramEnabled: false,
        paidImagesEnabled: false,
        requestIndexing: false,
        socialDistribution: false,
        blindReviewEnabled: true,
        topicUniquenessEnabled: true,
      },
      createdBy,
    };
    let batch = existing;
    let resumedPartialBatch = Boolean(existing);
    if (existing && String(existing._id) !== String(batchId)) {
      throw new ConflictRequestError("QA batch idempotency binding is invalid");
    }
    if (existing) {
      const retainedCases = await this.CaseModel.find({ batchId })
        .select("_id scheduleId")
        .lean();
      const expectedIds = new Set(
        caseInputs.map((input) =>
          String(
            deterministicObjectId(`qa-case-v1\0${batchId}\0${input.caseKey}`),
          ),
        ),
      );
      const complete =
        retainedCases.length === caseInputs.length &&
        retainedCases.every(
          (item) => expectedIds.has(String(item._id)) && item.scheduleId,
        );
      if (complete)
        return {
          batch: publicBatch(existing),
          casesCreated: retainedCases.length,
          duplicate: true,
          idempotent: true,
        };
    } else {
      try {
        batch = await this.BatchModel.create(batchDocument);
        resumedPartialBatch = false;
      } catch (error) {
        if (error?.code !== 11000) throw error;
        batch = await leanQuery(
          this.BatchModel.findOne({ environment, batchKeyHash }),
        );
        if (!batch || String(batch._id) !== String(batchId))
          throw new ConflictRequestError("QA batch idempotency conflict");
        resumedPartialBatch = true;
      }
    }

    const caseIds = [];
    const topicFingerprints = [];
    const pendingReservations = [];
    try {
      for (const input of caseInputs) {
        const caseId = deterministicObjectId(
          `qa-case-v1\0${batchId}\0${input.caseKey}`,
        );
        const reservationResult = await this.TopicService.reserve({
          batchId,
          caseId,
          environment,
          executionMode: input.executionMode,
          originalTopicSeed: input.originalTopicSeed,
          effectiveTopic: input.effectiveTopic,
          mainEntity: input.mainEntity,
          topicCore: input.topicCore,
          searchIntent: input.searchIntent,
          userProblem: input.userProblem,
          audience: input.audience,
          articleType: input.articleType,
          contentRole: input.contentRole,
          plannedOutline: input.plannedOutline,
        });
        const reservation = reservationResult.reservation;
        if (reservationResult.duplicate !== true) {
          pendingReservations.push({
            reservationId: String(reservation._id),
            batchId,
            caseId,
          });
        }
        const scheduleConfiguration = {
          mode: "fixed_brief",
          draftOnly: true,
          autoPublish: false,
          generateImages: false,
          requestIndexing: false,
          telegramEnabled: false,
          socialDistribution: false,
          topic: input.effectiveTopic,
          articleType: input.articleType,
          contentRole: input.contentRole,
          searchIntent: input.searchIntent,
          productMode: input.productMode,
          productIntensity: input.productIntensity,
          placementStyle: input.placementStyle,
        };
        const caseDocument = {
          _id: caseId,
          batchId,
          caseKey: input.caseKey,
          isQaTest: true,
          qaBatchId: batchId,
          qaCaseId: caseId,
          environment,
          executionMode: input.executionMode,
          scheduleMode: "fixed_brief",
          originalTopicSeed: input.originalTopicSeed,
          mainEntity: input.mainEntity,
          topicCore: input.topicCore,
          userProblem: input.userProblem,
          audience: input.audience,
          plannedOutline: input.plannedOutline,
          topicSeed: input.originalTopicSeed,
          effectiveTopic: input.effectiveTopic,
          normalizedTopicKey: reservation.normalizedTopicKey,
          topicFingerprint: reservation.topicFingerprint,
          semanticFingerprint: reservation.semanticFingerprint,
          outlineFingerprint: reservation.outlineFingerprint,
          topicReservationId: String(reservation._id),
          articleType: input.articleType,
          contentRole: input.contentRole,
          searchIntent: input.searchIntent,
          productMode: input.productMode,
          productIntensity: input.productIntensity,
          placementStyle: input.placementStyle,
          expectedRunAt: input.expectedRunAt,
          status: "reserved",
          scheduleConfiguration,
        };
        let qaCase = await leanQuery(this.CaseModel.findById(caseId));
        if (qaCase) {
          const bindingValid =
            qaCase.isQaTest === true &&
            String(qaCase.qaBatchId || qaCase.batchId) === String(batchId) &&
            qaCase.caseKey === input.caseKey &&
            qaCase.normalizedTopicKey === reservation.normalizedTopicKey &&
            qaCase.executionMode === input.executionMode;
          if (!bindingValid)
            throw new ConflictRequestError(
              `QA case ${input.caseKey} has an invalid retained binding`,
            );
        } else {
          try {
            qaCase = await this.CaseModel.create(caseDocument);
          } catch (error) {
            if (error?.code !== 11000) throw error;
            qaCase = await leanQuery(this.CaseModel.findById(caseId));
            if (!qaCase)
              throw new ConflictRequestError(
                `QA case ${input.caseKey} creation conflicted`,
              );
          }
        }
        const scheduleDocument = {
          isQaTest: true,
          qaBatchId: batchId,
          qaCaseId: caseId,
          environment,
          executionMode: input.executionMode,
          originalTopicSeed: input.originalTopicSeed,
          normalizedTopicKey: reservation.normalizedTopicKey,
          qaTopicReservationId: String(reservation._id),
          name: `QA ${input.caseKey}: ${input.effectiveTopic}`.slice(0, 120),
          description: "Isolated Agentic Blog QA fixed-brief schedule",
          enabled: false,
          scheduleType: "interval",
          timezone: "Asia/Ho_Chi_Minh",
          interval: { value: 24, unit: "hours" },
          runLimit: 1,
          runCount: 0,
          autoPublish: false,
          mode: "fixed_brief",
          allowSkip: false,
          draftOnly: true,
          maximumTasksPerDay: 1,
          nextRunAt: null,
          agentConfig: {
            topic: input.effectiveTopic,
            primaryKeyword: input.effectiveTopic,
            mainEntity: input.mainEntity,
            topicCore: input.topicCore,
            userProblem: input.userProblem,
            audience: input.audience,
            articleType: input.articleType,
            contentRole: input.contentRole,
            searchIntent: input.searchIntent,
            outline: input.plannedOutline,
            generateImages: false,
            productSeeding: {
              mode: input.productMode,
              intensity: input.productIntensity,
            },
            productPlacement: { placementStyle: input.placementStyle },
          },
          createdBy,
        };
        let schedule = qaCase.scheduleId
          ? await leanQuery(this.ScheduleModel.findById(qaCase.scheduleId))
          : null;
        if (!schedule) {
          try {
            schedule = await this.ScheduleModel.create(scheduleDocument);
          } catch (error) {
            if (error?.code !== 11000) throw error;
            schedule = await leanQuery(
              this.ScheduleModel.findOne({ isQaTest: true, qaCaseId: caseId }),
            );
            if (!schedule)
              throw new ConflictRequestError(
                `QA schedule ${input.caseKey} creation conflicted`,
              );
          }
        }
        if (
          schedule.isQaTest !== true ||
          String(schedule.qaBatchId) !== String(batchId) ||
          String(schedule.qaCaseId) !== String(caseId) ||
          schedule.normalizedTopicKey !== reservation.normalizedTopicKey
        )
          throw new ConflictRequestError(
            `QA schedule ${input.caseKey} has an invalid retained binding`,
          );
        await this.CaseModel.updateOne(
          { _id: qaCase._id, isQaTest: true },
          { $set: { scheduleId: schedule._id } },
        );
        const pendingIndex = pendingReservations.findIndex(
          (item) => item.reservationId === String(reservation._id),
        );
        if (pendingIndex >= 0) pendingReservations.splice(pendingIndex, 1);
        caseIds.push(caseId);
        topicFingerprints.push(reservation.topicFingerprint);
      }
      const updated = await this.BatchModel.findByIdAndUpdate(
        batchId,
        {
          $set: {
            caseIds,
            topicFingerprints,
            status: "planned",
            lastErrorCode: "",
          },
        },
        { new: true },
      ).lean();
      return {
        batch: publicBatch(updated || toPlain(batch)),
        casesCreated: caseIds.length,
        duplicate: resumedPartialBatch,
        idempotent: resumedPartialBatch,
        reconciled: resumedPartialBatch,
      };
    } catch (error) {
      if (typeof this.TopicService.releaseUnbound === "function") {
        await Promise.allSettled(
          pendingReservations.map((item) =>
            this.TopicService.releaseUnbound(item),
          ),
        );
      }
      await this.BatchModel.updateOne(
        { _id: batchId },
        {
          $set: {
            status: "blocked",
            lastErrorCode: String(error.code || "QA_BATCH_CREATE_FAILED").slice(
              0,
              120,
            ),
          },
        },
      );
      throw error;
    }
  }

  async listBatches({ query = {}, actions = [] } = {}) {
    const { page, limit, environment } = normalizeListQuery(query);
    const config = this.config || buildAgenticBlogQaConfig();
    if (!config.enabled || !["local", "staging"].includes(config.environment)) {
      return {
        featureEnabled: false,
        environment: config.environment,
        // The route already enforces agentic_blog_qa.view. Preserve that
        // read-only capability so authorized admins can discover the QA
        // workspace and understand why execution is disabled. Mutating
        // actions remain unavailable until the isolated QA feature is enabled.
        actions: (Array.isArray(actions) ? actions : []).filter(
          (action) => action === "view",
        ),
        batches: [],
        pagination: { page, limit, total: 0 },
      };
    }
    const requestedEnvironment = environment
      ? String(environment).trim().toLowerCase()
      : config.environment;
    if (requestedEnvironment !== config.environment) {
      throw new BadRequestError(
        "QA batches are restricted to the active validated environment",
      );
    }
    const filter = { environment: config.environment, isQaTest: true };
    const [items, total] = await Promise.all([
      this.BatchModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.BatchModel.countDocuments(filter),
    ]);
    return {
      featureEnabled: true,
      environment: config.environment,
      actions: (Array.isArray(actions) ? actions : []).filter((action) =>
        ["view", "create", "run", "review", "remediate"].includes(action),
      ),
      batches: items.map(publicBatch),
      pagination: { page, limit, total },
    };
  }

  async getBatch({ batchId, query = {} }) {
    assertEmptyQuery(query);
    const config = this._config();
    const id = assertObjectId(batchId, "batchId");
    const batch = await leanQuery(
      this.BatchModel.findOne({
        _id: id,
        environment: config.environment,
        isQaTest: true,
      }),
    );
    if (!batch) throw new NotFoundError("QA batch not found");
    const [cases, reports, remediation] = await Promise.all([
      this.CaseModel.find({
        batchId: id,
        environment: config.environment,
        isQaTest: true,
      })
        .sort({ createdAt: 1 })
        .lean(),
      this.ReportModel.find({
        batchId: id,
        environment: config.environment,
        isQaTest: true,
      })
        .sort({ caseId: 1, iteration: 1 })
        .lean(),
      this.RemediationModel.find({
        batchId: id,
        environment: config.environment,
        isQaTest: true,
      })
        .sort({ iteration: 1, createdAt: 1 })
        .lean(),
    ]);
    return {
      batch: publicBatch(batch),
      cases: cases.map(publicCase),
      reports: reports.map(publicReport),
      remediation: remediation.map(publicRemediation),
    };
  }

  async runBatch({
    batchId,
    payload = {},
    query = {},
    adminId,
    idempotencyKey,
    caseIds = null,
  }) {
    assertEmptyQuery(query);
    assertExactKeys(payload, [], [], "QA batch run body");
    const config = this._config();
    await this._ensureInfrastructure(config);
    validateSafeKey(idempotencyKey);
    const id = assertObjectId(batchId, "batchId");
    const batch = await leanQuery(
      this.BatchModel.findOne({
        _id: id,
        environment: config.environment,
        isQaTest: true,
      }),
    );
    if (!batch) throw new NotFoundError("QA batch not found");
    if (
      [
        "reviewing",
        "passed",
        "failed",
        "blocked",
        "remediating",
        "awaiting_remediation_action",
      ].includes(batch.status)
    ) {
      throw new ConflictRequestError(`Cannot run a ${batch.status} QA batch`);
    }
    if (batch.stopNewDrafts === true)
      throw new ConflictRequestError(
        "This QA batch is stopped pending a shared or systemic remediation action",
      );
    if (caseIds !== null && caseIds !== undefined)
      throw new BadRequestError(
        "QA batches always run their complete retained case matrix",
      );
    const cases = await this.CaseModel.find({
      batchId: id,
      environment: config.environment,
      isQaTest: true,
    })
      .sort({ createdAt: 1 })
      .lean();
    if (!cases.length) throw new BadRequestError("No QA cases selected");
    if ((batch.caseIds || []).length && cases.length !== batch.caseIds.length) {
      throw new ConflictRequestError(
        "The retained QA case matrix is incomplete",
      );
    }
    for (const qaCase of cases) {
      if (!qaCase.scheduleId)
        throw new ConflictRequestError(
          `QA case ${qaCase.caseKey} has no schedule`,
        );
      const retainedSchedule = await leanQuery(
        this.ScheduleModel.findOne({
          _id: qaCase.scheduleId,
          isQaTest: true,
          qaCaseId: qaCase._id,
          qaBatchId: id,
          environment: config.environment,
        }),
      );
      if (!retainedSchedule)
        throw new ConflictRequestError(
          `QA case ${qaCase.caseKey} schedule binding is invalid`,
        );
      const iteration = Number(batch.iteration || 0);
      const hasAttempt = (qaCase.runAttempts || []).some(
        (attempt) =>
          Number(attempt.batchIteration) === iteration &&
          attempt.executionMode === qaCase.executionMode,
      );
      if (!hasAttempt && !["planned", "reserved"].includes(qaCase.status)) {
        throw new ConflictRequestError(
          `QA case ${qaCase.caseKey} cannot create a new run slot from ${qaCase.status}`,
        );
      }
    }
    const started = await this.BatchModel.updateOne(
      {
        _id: id,
        environment: config.environment,
        isQaTest: true,
        stopNewDrafts: { $ne: true },
      },
      {
        $set: {
          status: "running",
          startedAt: batch.startedAt || this.now(),
          completedAt: null,
          lastErrorCode: "",
        },
      },
    );
    if (!writeMatched(started)) {
      throw new ConflictRequestError(
        "The QA batch could not acquire its run fence",
      );
    }
    const cancelPartialDispatch = async (errorCode) => {
      const failedAt = this.now();
      await Promise.allSettled([
        Promise.resolve().then(() =>
          this.BatchModel.updateOne(
            { _id: id, environment: config.environment, isQaTest: true },
            {
              $set: {
                status: "failed",
                completedAt: failedAt,
                stopNewDrafts: true,
                lastErrorCode: errorCode,
              },
            },
          ),
        ),
        Promise.resolve().then(() =>
          this.CaseModel.updateMany(
            {
              batchId: id,
              environment: config.environment,
              isQaTest: true,
              status: { $in: ["reserved", "queued", "running"] },
            },
            {
              $set: {
                status: "failed",
                completedAt: failedAt,
                lastErrorCode: errorCode,
              },
            },
          ),
        ),
        Promise.resolve().then(() =>
          this.ScheduleModel.updateMany(
            { qaBatchId: id, environment: config.environment, isQaTest: true },
            { $set: { enabled: false, nextRunAt: null } },
          ),
        ),
        Promise.resolve().then(() =>
          this.ExecutionModel.updateMany(
            {
              qaBatchId: id,
              environment: config.environment,
              isQaTest: true,
              status: "queued",
            },
            {
              $set: {
                status: "failed",
                completedAt: failedAt,
                error: "QA_BATCH_PARTIAL_DISPATCH_CANCELLED",
                "metadata.cancelledBeforeClaimAt": failedAt,
              },
            },
          ),
        ),
      ]);
    };
    const queued = [];
    try {
      for (const qaCase of cases) {
        if (!qaCase.scheduleId)
          throw new ConflictRequestError(
            `QA case ${qaCase.caseKey} has no schedule`,
          );
        const iteration = Number(batch.iteration || 0);
        const attemptHash = buildQaRunSlotKeyHash({
          caseId: qaCase._id,
          iteration,
          executionMode: qaCase.executionMode,
        });
        const scopedKey = sha256(`qa-case-dispatch-v3\0${attemptHash}`);
        const existingAttempt = (qaCase.runAttempts || []).find(
          (attempt) =>
            Number(attempt.batchIteration) === iteration &&
            attempt.executionMode === qaCase.executionMode,
        );
        if (existingAttempt) {
          queued.push({
            caseId: String(qaCase._id),
            executionMode: qaCase.executionMode,
            executionId: existingAttempt.executionId
              ? String(existingAttempt.executionId)
              : "",
            expectedRunAt: existingAttempt.scheduledFor || null,
            status: existingAttempt.status,
            duplicate: true,
            idempotent: true,
            scheduled: qaCase.executionMode === "actual_schedule",
          });
          continue;
        }
        if (!["planned", "reserved"].includes(qaCase.status)) {
          throw new ConflictRequestError(
            `QA case ${qaCase.caseKey} cannot create a new run slot from ${qaCase.status}`,
          );
        }
        const attemptNumber = Number(qaCase.runAttempts?.length || 0) + 1;
        if (attemptNumber > 4)
          throw new ConflictRequestError(
            `QA case ${qaCase.caseKey} exceeded its bounded run attempts`,
          );
        const dueAt =
          qaCase.executionMode === "actual_schedule"
            ? qaCase.expectedRunAt && qaCase.expectedRunAt > this.now()
              ? qaCase.expectedRunAt
              : new Date(this.now().getTime() + 60 * 1000)
            : null;
        const attempt = {
          attempt: attemptNumber,
          batchIteration: iteration,
          executionMode: qaCase.executionMode,
          idempotencyKeyHash: attemptHash,
          executionId: null,
          status: "queued",
          queuedAt: this.now(),
          scheduledFor: dueAt,
          dispatchState: "pending",
        };
        const recorded = await this.CaseModel.updateOne(
          {
            _id: qaCase._id,
            isQaTest: true,
            runAttempts: {
              $not: {
                $elemMatch: {
                  batchIteration: iteration,
                  executionMode: qaCase.executionMode,
                },
              },
            },
          },
          {
            $set: {
              status: "queued",
              ...(dueAt ? { expectedRunAt: dueAt } : {}),
            },
            $push: { runAttempts: attempt },
          },
        );
        if (Number(recorded?.modifiedCount || 0) === 0) {
          const retained = await leanQuery(this.CaseModel.findById(qaCase._id));
          const racedAttempt = (retained?.runAttempts || []).find(
            (item) =>
              Number(item.batchIteration) === iteration &&
              item.executionMode === qaCase.executionMode,
          );
          if (!racedAttempt)
            throw new ConflictRequestError(
              `QA case ${qaCase.caseKey} run slot could not be reserved`,
            );
          queued.push({
            caseId: String(qaCase._id),
            executionMode: qaCase.executionMode,
            executionId: racedAttempt.executionId
              ? String(racedAttempt.executionId)
              : "",
            expectedRunAt: racedAttempt.scheduledFor || null,
            status: racedAttempt.status,
            duplicate: true,
            idempotent: true,
            scheduled: qaCase.executionMode === "actual_schedule",
          });
          continue;
        }
        if (qaCase.executionMode === "actual_schedule") {
          const scheduled = await this.ScheduleModel.updateOne(
            {
              _id: qaCase.scheduleId,
              isQaTest: true,
              qaCaseId: qaCase._id,
              qaBatchId: id,
            },
            {
              $set: {
                enabled: true,
                nextRunAt: dueAt,
                leaseUntil: null,
                lockedBy: "",
                qaIteration: iteration,
                runCount: 0,
                lastRunAt: null,
                lastRunStatus: "",
                lastError: "",
              },
            },
          );
          if (Number(scheduled?.matchedCount || 0) === 0) {
            await this.CaseModel.updateOne(
              { _id: qaCase._id, isQaTest: true },
              {
                $set: {
                  status: "failed",
                  lastErrorCode: "QA_SCHEDULE_BINDING_MISSING",
                  "runAttempts.$[attempt].status": "failed",
                  "runAttempts.$[attempt].dispatchState": "failed",
                  "runAttempts.$[attempt].completedAt": this.now(),
                  "runAttempts.$[attempt].errorCode":
                    "QA_SCHEDULE_BINDING_MISSING",
                },
              },
              { arrayFilters: [{ "attempt.idempotencyKeyHash": attemptHash }] },
            );
            throw new ConflictRequestError(
              `QA case ${qaCase.caseKey} schedule binding is invalid`,
            );
          }
          queued.push({
            caseId: String(qaCase._id),
            executionMode: qaCase.executionMode,
            expectedRunAt: dueAt,
            scheduled: true,
          });
          continue;
        }
        const runner =
          qaCase.executionMode === "run_now" &&
          typeof this.ScheduleService.runDailyDraftForQa === "function"
            ? this.ScheduleService.runDailyDraftForQa.bind(this.ScheduleService)
            : this.ScheduleService.runNow.bind(this.ScheduleService);
        let result;
        try {
          result = await runner({
            scheduleId: qaCase.scheduleId,
            idempotencyKey: scopedKey,
            adminId,
            trustedQaRun: true,
            qaIteration: iteration,
          });
        } catch (error) {
          const errorCode = String(error?.code || "QA_DISPATCH_FAILED").slice(
            0,
            120,
          );
          await this.CaseModel.updateOne(
            { _id: qaCase._id, isQaTest: true },
            {
              $set: {
                status: "failed",
                lastErrorCode: errorCode,
                "runAttempts.$[attempt].status": "failed",
                "runAttempts.$[attempt].dispatchState": "failed",
                "runAttempts.$[attempt].completedAt": this.now(),
                "runAttempts.$[attempt].errorCode": errorCode,
              },
            },
            { arrayFilters: [{ "attempt.idempotencyKeyHash": attemptHash }] },
          );
          throw error;
        }
        const executionId = assertObjectId(result.executionId, "executionId");
        await this.CaseModel.updateOne(
          { _id: qaCase._id, isQaTest: true },
          {
            $set: {
              status: "queued",
              executionId,
              actualRunAt: this.now(),
              "runAttempts.$[attempt].executionId": executionId,
              "runAttempts.$[attempt].status": result.status || "queued",
              "runAttempts.$[attempt].dispatchState": "dispatched",
            },
          },
          { arrayFilters: [{ "attempt.idempotencyKeyHash": attemptHash }] },
        );
        queued.push({
          caseId: String(qaCase._id),
          executionMode: qaCase.executionMode,
          executionId: String(executionId),
          duplicate: result.duplicate === true,
        });
      }
      return { batchId: String(id), queued, requireAllCasesPass: true };
    } catch (error) {
      const errorCode = String(error?.code || "QA_DISPATCH_FAILED")
        .replace(/[^A-Za-z0-9._:-]+/g, "_")
        .slice(0, 120);
      await cancelPartialDispatch(errorCode);
      throw error;
    }
  }

  async _reviewPersistedBatch({
    id,
    batch,
    config,
    adminId,
    activeAttempt = null,
  }) {
    const cases = await this.CaseModel.find({
      batchId: id,
      environment: config.environment,
      isQaTest: true,
    })
      .sort({ createdAt: 1 })
      .lean();
    const results = [];
    for (const qaCase of cases) {
      if (!qaCase.blogId || !qaCase.executionId) continue;
      const reportResult = await this.AcceptanceService.reviewPersistedCase({
        qaCaseId: qaCase._id,
        blogId: qaCase.blogId,
        executionId: qaCase.executionId,
        iteration: Number(batch.iteration || 0),
        createdBy: adminId,
      });
      const report = reportResult.report;
      await this.CaseModel.updateOne(
        { _id: qaCase._id },
        {
          $set: {
            status: report.verdict === "passed" ? "passed" : "failed",
            acceptanceReportId: report._id,
            seniorScore: report.totalScore,
            existingSeoScore: report.existingSeoScore,
            hardGatePassed: report.hardGatePassed,
            draftAcceptance: report.draftAcceptance,
            publishAcceptance: report.publishAcceptance,
            issueCounts: report.issueCounts,
            completedAt: this.now(),
          },
        },
      );
      results.push({
        caseId: String(qaCase._id),
        reportId: String(report._id),
        verdict: report.verdict,
        score: report.totalScore,
      });
    }
    const refreshed = await this.CaseModel.find({
      batchId: id,
      environment: config.environment,
      isQaTest: true,
    })
      .select("status hardGatePassed")
      .lean();
    const allPassed =
      refreshed.length > 0 &&
      refreshed.every(
        (item) => item.status === "passed" && item.hardGatePassed === true,
      );
    const allReviewed = refreshed.every((item) =>
      ["passed", "failed", "blocked"].includes(item.status),
    );
    const status = allPassed ? "passed" : allReviewed ? "failed" : "reviewing";
    if (activeAttempt) {
      const reportIds = results.map((item) =>
        assertObjectId(item.reportId, "reportId"),
      );
      const update = {
        $set: {
          status: allReviewed ? "completed" : "in_progress",
          completedAt: allReviewed ? this.now() : null,
          errorCode: "",
        },
      };
      if (reportIds.length)
        update.$addToSet = { resultingReportIds: { $each: reportIds } };
      const retained = await this.RemediationModel.updateOne(
        {
          _id: activeAttempt._id,
          batchId: id,
          environment: config.environment,
          isQaTest: true,
          iteration: Number(batch.iteration || 0),
          status: "in_progress",
        },
        update,
      );
      if (!writeMatched(retained)) {
        throw new ConflictRequestError(
          "The active remediation review lock was lost",
        );
      }
    }
    await this.BatchModel.updateOne(
      { _id: id, environment: config.environment, isQaTest: true },
      {
        $set: {
          status,
          completedAt: allReviewed ? this.now() : null,
          ...(activeAttempt
            ? { remediationState: allReviewed ? "completed" : "reviewing" }
            : {}),
          functionalResult: {
            allCasesReviewed: allReviewed,
            allCasesPassed: allPassed,
          },
          hardGateResult: { pass: allPassed, policy: "all_cases_pass" },
        },
      },
    );
    return {
      batchId: String(id),
      status,
      allCasesPass: allPassed,
      reviewed: results,
    };
  }

  async reviewBatch({ batchId, payload = {}, query = {}, adminId }) {
    assertEmptyQuery(query);
    assertExactKeys(payload, [], [], "QA batch review body");
    const config = this._config();
    await this._ensureInfrastructure(config);
    const id = assertObjectId(batchId, "batchId");
    const batch = await leanQuery(
      this.BatchModel.findOne({
        _id: id,
        environment: config.environment,
        isQaTest: true,
      }),
    );
    if (!batch) throw new NotFoundError("QA batch not found");
    if (["awaiting_remediation_action", "remediating"].includes(batch.status)) {
      throw new ConflictRequestError(
        "Apply the retained remediation action before reviewing this QA batch",
      );
    }
    if (!["running", "reviewing"].includes(batch.status)) {
      throw new ConflictRequestError(
        `Cannot review a ${batch.status} QA batch`,
      );
    }
    let activeAttempt = null;
    if (Number(batch.iteration || 0) > 0) {
      activeAttempt = await leanQuery(
        this.RemediationModel.findOne({
          batchId: id,
          environment: config.environment,
          isQaTest: true,
          iteration: Number(batch.iteration),
          status: "in_progress",
        }),
      );
      if (!activeAttempt) {
        throw new ConflictRequestError(
          "The current remediation iteration has not been safely resumed",
        );
      }
    }
    return this._reviewPersistedBatch({
      id,
      batch,
      config,
      adminId,
      activeAttempt,
    });
  }

  async getReports({ batchId, query = {} }) {
    assertEmptyQuery(query);
    const config = this._config();
    const id = assertObjectId(batchId, "batchId");
    const exists = await leanQuery(
      this.BatchModel.findOne({
        _id: id,
        environment: config.environment,
        isQaTest: true,
      }),
    );
    if (!exists) throw new NotFoundError("QA batch not found");
    const reports = await this.ReportModel.find({
      batchId: id,
      environment: config.environment,
      isQaTest: true,
    })
      .sort({ caseId: 1, iteration: 1 })
      .lean();
    return { reports: reports.map(publicReport) };
  }

  async planRemediation({
    batchId,
    payload = {},
    query = {},
    adminId,
    idempotencyKey,
  }) {
    assertEmptyQuery(query);
    assertExactKeys(payload, [], [], "remediation body");
    const config = this._config();
    await this._ensureInfrastructure(config);
    const id = assertObjectId(batchId, "batchId");
    const rawKey = validateSafeKey(idempotencyKey);
    const batch = await leanQuery(
      this.BatchModel.findOne({
        _id: id,
        environment: config.environment,
        isQaTest: true,
      }),
    );
    if (!batch) throw new NotFoundError("QA batch not found");
    const [cases, reports, priorAttempts] = await Promise.all([
      this.CaseModel.find({
        batchId: id,
        environment: config.environment,
        isQaTest: true,
      }).lean(),
      this.ReportModel.find({
        batchId: id,
        environment: config.environment,
        isQaTest: true,
        verdict: "failed",
        iteration: Number(batch.iteration || 0),
      })
        .sort({ caseId: 1 })
        .lean(),
      this.RemediationModel.find({
        batchId: id,
        environment: config.environment,
        isQaTest: true,
      })
        .sort({ iteration: 1 })
        .lean(),
    ]);
    const idempotencyKeyHash = buildRemediationIdempotencyHash({
      batchId: id,
      idempotencyKey: rawKey,
    });
    const duplicateAttempt = priorAttempts.find(
      (item) => item.idempotencyKeyHash === idempotencyKeyHash,
    );
    if (duplicateAttempt) {
      return {
        attempt: publicRemediation(duplicateAttempt),
        duplicate: true,
        idempotent: true,
        stopNewDrafts: duplicateAttempt.stopNewDrafts === true,
        requiresArchitectureReport:
          duplicateAttempt.requiresArchitectureReport === true,
        executed: duplicateAttempt.status !== "awaiting_action",
        awaitingAction: duplicateAttempt.actionState,
        batchId: String(id),
        iteration: Number(duplicateAttempt.iteration),
      };
    }
    if (batch.status !== "failed") {
      throw new ConflictRequestError(
        `Cannot plan remediation for a ${batch.status} QA batch`,
      );
    }
    if (
      priorAttempts.some((item) =>
        ["awaiting_action", "in_progress"].includes(item.status),
      )
    ) {
      throw new ConflictRequestError(
        "A remediation attempt is already awaiting action or in progress",
      );
    }
    const iteration = Number(batch.iteration || 0) + 1;
    const maxIterations = Math.min(
      MAX_REMEDIATION_ITERATIONS,
      Number(batch.maxIterations || MAX_REMEDIATION_ITERATIONS),
    );
    if (iteration > maxIterations)
      throw new ConflictRequestError("QA remediation iteration limit reached");
    const result = await this.RemediationService.plan({
      batch,
      cases,
      reports,
      priorAttempts,
      iteration,
      idempotencyKey: rawKey,
      plan: undefined,
      regressionControls: [],
      createdBy: adminId,
    });
    const persistedIteration = Number(result.attempt?.iteration || iteration);
    await this.BatchModel.updateOne(
      { _id: id },
      {
        $set: {
          status: "awaiting_remediation_action",
          iteration: persistedIteration,
          stopNewDrafts: result.stopNewDrafts === true,
          remediationState:
            result.awaitingAction ||
            result.attempt?.actionState ||
            "awaiting_action",
          completedAt: null,
        },
      },
    );
    await this.CaseModel.updateMany(
      { _id: { $in: result.attempt.caseIds || [] }, status: "failed" },
      { $set: { status: "awaiting_remediation_action" } },
    );
    return {
      attempt: publicRemediation(result.attempt),
      duplicate: result.duplicate === true,
      idempotent: result.idempotent === true,
      stopNewDrafts: result.stopNewDrafts === true,
      requiresArchitectureReport: result.requiresArchitectureReport === true,
      executed: result.executed === true,
      awaitingAction: publicText(result.awaitingAction, 80),
      batchId: String(id),
      iteration: persistedIteration,
    };
  }

  async _markRemediationResumeFailed({ id, attemptId, config, error }) {
    const errorCode = String(error?.code || "QA_REMEDIATION_RESUME_FAILED")
      .replace(/[^A-Za-z0-9._:-]+/g, "_")
      .slice(0, 120);
    const failedAt = this.now();
    await Promise.allSettled([
      this.RemediationModel.updateOne(
        {
          _id: attemptId,
          batchId: id,
          environment: config.environment,
          isQaTest: true,
          status: "in_progress",
        },
        { $set: { status: "failed", completedAt: failedAt, errorCode } },
      ),
      this.BatchModel.updateOne(
        { _id: id, environment: config.environment, isQaTest: true },
        {
          $set: {
            status: "failed",
            stopNewDrafts: true,
            remediationState: "resume_failed",
            completedAt: failedAt,
            lastErrorCode: errorCode,
          },
        },
      ),
    ]);
  }

  async resumeRemediation({
    batchId,
    attemptId,
    payload = {},
    query = {},
    adminId,
  }) {
    assertEmptyQuery(query);
    const resumePayloadKind = validateResumePayloadEnvelope(payload);
    const config = this._config();
    await this._ensureInfrastructure(config);
    const id = assertObjectId(batchId, "batchId");
    const remediationId = assertObjectId(attemptId, "attemptId");
    const [batch, attempt, cases] = await Promise.all([
      leanQuery(
        this.BatchModel.findOne({
          _id: id,
          environment: config.environment,
          isQaTest: true,
        }),
      ),
      leanQuery(
        this.RemediationModel.findOne({
          _id: remediationId,
          batchId: id,
          environment: config.environment,
          isQaTest: true,
        }),
      ),
      this.CaseModel.find({
        batchId: id,
        environment: config.environment,
        isQaTest: true,
      })
        .sort({ createdAt: 1 })
        .lean(),
    ]);
    if (!batch) throw new NotFoundError("QA batch not found");
    if (!attempt) throw new NotFoundError("QA remediation attempt not found");
    if (attempt.status === "completed") {
      return {
        batchId: String(id),
        attemptId: String(remediationId),
        iteration: Number(attempt.iteration),
        status: "completed",
        resultingReportIds: (attempt.resultingReportIds || []).map(String),
        duplicate: true,
        idempotent: true,
      };
    }
    if (
      attempt.classification === "article_specific" &&
      resumePayloadKind !== "empty"
    ) {
      throw new BadRequestError(
        "Article-specific remediation body must be empty",
      );
    }
    if (attempt.status !== "awaiting_action") {
      throw new ConflictRequestError(
        `Cannot resume a ${attempt.status} remediation attempt`,
      );
    }
    if (batch.status !== "awaiting_remediation_action") {
      throw new ConflictRequestError(
        `Cannot resume remediation for a ${batch.status} QA batch`,
      );
    }
    const iteration = Number(attempt.iteration);
    const maxIterations = Math.min(
      MAX_REMEDIATION_ITERATIONS,
      Number(batch.maxIterations || MAX_REMEDIATION_ITERATIONS),
    );
    if (
      !Number.isInteger(iteration) ||
      iteration < 1 ||
      iteration > maxIterations ||
      Number(batch.iteration) !== iteration
    ) {
      throw new ConflictRequestError(
        "The remediation attempt is outside the retained bounded batch iteration",
      );
    }
    const retainedIds = new Set(cases.map((item) => String(item._id)));
    const expectedIds = (batch.caseIds || []).map(String);
    if (
      !cases.length ||
      expectedIds.length !== cases.length ||
      expectedIds.some((caseId) => !retainedIds.has(caseId))
    ) {
      throw new ConflictRequestError(
        "The retained QA case matrix is incomplete",
      );
    }
    const affectedIds = new Set((attempt.caseIds || []).map(String));
    const affectedCases = cases.filter((item) =>
      affectedIds.has(String(item._id)),
    );
    if (!affectedIds.size || affectedCases.length !== affectedIds.size) {
      throw new ConflictRequestError(
        "The remediation attempt has an invalid affected-case binding",
      );
    }
    const unaffectedCases = cases.filter(
      (item) => !affectedIds.has(String(item._id)),
    );

    if (attempt.classification === "article_specific") {
      const sourceReports = await leanQuery(
        this.ReportModel.find({
          _id: { $in: attempt.sourceReportIds || [] },
          batchId: id,
          environment: config.environment,
          isQaTest: true,
        }),
      );
      const blogIds = affectedCases.map((item) => item.blogId).filter(Boolean);
      const blogs = await leanQuery(
        this.BlogModel.find({
          _id: { $in: blogIds },
          qaBatchId: id,
          environment: config.environment,
          isQaTest: true,
        }),
      );
      const expectedSourceReportIds = new Set(
        (attempt.sourceReportIds || []).map(String),
      );
      if (
        !expectedSourceReportIds.size ||
        (sourceReports || []).length !== expectedSourceReportIds.size ||
        (sourceReports || []).some(
          (report) => !expectedSourceReportIds.has(String(report._id)),
        )
      ) {
        throw new ConflictRequestError(
          "The remediation source-report chain is incomplete",
        );
      }
      const reportsByCase = new Map(
        (sourceReports || []).map((report) => [
          String(report.caseId || report.qaCaseId),
          report,
        ]),
      );
      const blogsById = new Map(
        (blogs || []).map((blog) => [String(blog._id), blog]),
      );
      const caseRevisions = affectedCases.map((qaCase) => {
        const sourceReport = reportsByCase.get(String(qaCase._id));
        const currentBlog = blogsById.get(String(qaCase.blogId || ""));
        if (
          !sourceReport ||
          !currentBlog ||
          !qaCase.executionId ||
          qaCase.status !== "awaiting_remediation_action"
        ) {
          throw new ConflictRequestError(
            `QA case ${qaCase.caseKey || qaCase._id} has an incomplete retained article binding`,
          );
        }
        if (
          String(sourceReport.blogId) !== String(currentBlog._id) ||
          String(sourceReport.executionId) !== String(qaCase.executionId) ||
          Number(sourceReport.iteration) !== iteration - 1 ||
          sourceReport.verdict !== "failed" ||
          String(currentBlog.qaCaseId) !== String(qaCase._id) ||
          Number(currentBlog.qaIteration) !== Number(sourceReport.iteration) ||
          currentBlog.isDraft !== true ||
          currentBlog.isPublished === true ||
          currentBlog.publishedAt
        ) {
          throw new ConflictRequestError(
            `QA case ${qaCase.caseKey || qaCase._id} is not a retained draft-only article`,
          );
        }
        const previousContentRevisionHash = String(
          sourceReport.contentRevisionHash || "",
        ).trim();
        const appliedContentRevisionHash = String(
          currentBlog.contentRevisionHash || "",
        ).trim();
        if (
          !previousContentRevisionHash ||
          !appliedContentRevisionHash ||
          previousContentRevisionHash === appliedContentRevisionHash
        ) {
          throw new ConflictRequestError(
            `QA case ${qaCase.caseKey || qaCase._id} requires a persisted changed draft revision before review`,
          );
        }
        return {
          caseId: String(qaCase._id),
          blogId: String(currentBlog._id),
          previousContentRevisionHash,
          appliedContentRevisionHash,
        };
      });
      const startedAt = this.now();
      const claimed = await this.RemediationModel.updateOne(
        {
          _id: remediationId,
          batchId: id,
          environment: config.environment,
          isQaTest: true,
          iteration,
          status: "awaiting_action",
        },
        {
          $set: {
            status: "in_progress",
            startedAt,
            completedAt: null,
            errorCode: "",
            actionEvidence: {
              type: "verified_article_revision",
              caseRevisions,
            },
            rerunCaseIds: cases.map((item) => item._id),
            // Prefer a previously unaffected article when one exists. If every
            // retained article has an independent article-level defect, each
            // revised draft is its own before/after regression control through
            // the immutable source report and content revision hash.
            controlCaseIds: unaffectedCases.length
              ? [unaffectedCases[0]._id]
              : affectedCases.map((item) => item._id),
          },
        },
      );
      if (!writeMatched(claimed))
        throw new ConflictRequestError(
          "The remediation attempt was already claimed",
        );
      try {
        const locked = await this.BatchModel.updateOne(
          {
            _id: id,
            environment: config.environment,
            isQaTest: true,
            status: "awaiting_remediation_action",
            iteration,
          },
          {
            $set: {
              status: "remediating",
              stopNewDrafts: false,
              remediationState: "reviewing_revised_drafts",
              completedAt: null,
              lastErrorCode: "",
            },
          },
        );
        if (!writeMatched(locked))
          throw new ConflictRequestError(
            "The QA batch remediation lock was lost",
          );
        await this.CaseModel.updateMany(
          {
            _id: { $in: affectedCases.map((item) => item._id) },
            batchId: id,
            isQaTest: true,
          },
          {
            $set: { status: "reviewing", completedAt: null, lastErrorCode: "" },
          },
        );
        const activeAttempt = {
          ...attempt,
          _id: remediationId,
          status: "in_progress",
        };
        const review = await this._reviewPersistedBatch({
          id,
          batch,
          config,
          adminId,
          activeAttempt,
        });
        return {
          batchId: String(id),
          attemptId: String(remediationId),
          iteration,
          status: review.status,
          generatedDrafts: false,
          review,
        };
      } catch (error) {
        await this._markRemediationResumeFailed({
          id,
          attemptId: remediationId,
          config,
          error,
        });
        throw error;
      }
    }

    if (
      !["shared_stage", "systemic_workflow"].includes(attempt.classification)
    ) {
      throw new ConflictRequestError(
        "The remediation classification is invalid",
      );
    }
    if (attempt.classification === "shared_stage" && !unaffectedCases.length) {
      throw new ConflictRequestError(
        "A shared-stage rerun requires at least one retained unaffected control case",
      );
    }
    if (resumePayloadKind !== "code") {
      throw new BadRequestError(
        "Verified code-change evidence is required for shared or systemic remediation",
      );
    }
    const serverCodeRevision = await this.CodeRevision();
    const verifiedAction = normalizeCodeActionEvidence({
      payload,
      attempt,
      serverCodeRevision,
    });
    const startedAt = this.now();
    const claimed = await this.RemediationModel.updateOne(
      {
        _id: remediationId,
        batchId: id,
        environment: config.environment,
        isQaTest: true,
        iteration,
        status: "awaiting_action",
      },
      {
        $set: {
          status: "in_progress",
          startedAt,
          completedAt: null,
          errorCode: "",
          appliedCodeRevision: verifiedAction.appliedCodeRevision,
          actionEvidence: verifiedAction.actionEvidence,
          rerunCaseIds: cases.map((item) => item._id),
          controlCaseIds: unaffectedCases.length
            ? [unaffectedCases[0]._id]
            : [],
        },
      },
    );
    if (!writeMatched(claimed))
      throw new ConflictRequestError(
        "The remediation attempt was already claimed",
      );
    try {
      const locked = await this.BatchModel.updateOne(
        {
          _id: id,
          environment: config.environment,
          isQaTest: true,
          status: "awaiting_remediation_action",
          iteration,
        },
        {
          $set: {
            status: "remediating",
            stopNewDrafts: true,
            remediationState: "preparing_full_batch_rerun",
            completedAt: null,
            lastErrorCode: "",
          },
        },
      );
      if (!writeMatched(locked))
        throw new ConflictRequestError(
          "The QA batch remediation lock was lost",
        );
      const reset = await this.CaseModel.updateMany(
        { batchId: id, environment: config.environment, isQaTest: true },
        {
          $set: {
            status: "reserved",
            executionId: null,
            blogId: null,
            acceptanceReportId: null,
            seniorScore: null,
            existingSeoScore: null,
            hardGatePassed: false,
            draftAcceptance: { pass: false },
            publishAcceptance: {
              pass: false,
              reasonCode: "qa_publish_forbidden",
            },
            issueCounts: { critical: 0, high: 0, medium: 0, low: 0 },
            actualRunAt: null,
            completedAt: null,
            lastErrorCode: "",
          },
        },
      );
      if (
        Number(reset?.matchedCount ?? reset?.n ?? cases.length) !== cases.length
      ) {
        throw new ConflictRequestError(
          "The retained QA case matrix could not be prepared for a full rerun",
        );
      }
      const reopened = await this.BatchModel.updateOne(
        {
          _id: id,
          environment: config.environment,
          isQaTest: true,
          status: "remediating",
          iteration,
        },
        {
          $set: {
            status: "planned",
            stopNewDrafts: false,
            remediationState: "full_batch_rerun_pending",
          },
        },
      );
      if (!writeMatched(reopened))
        throw new ConflictRequestError(
          "The QA batch could not enter its bounded rerun state",
        );
      const dispatch = await this.runBatch({
        batchId: id,
        adminId,
        idempotencyKey: `qa-remediation-resume-${String(remediationId)}`,
        caseIds: null,
      });
      return {
        batchId: String(id),
        attemptId: String(remediationId),
        iteration,
        status: "in_progress",
        fullBatchRerun: true,
        unaffectedControlCaseId: unaffectedCases[0]
          ? String(unaffectedCases[0]._id)
          : null,
        dispatch,
      };
    } catch (error) {
      await this._markRemediationResumeFailed({
        id,
        attemptId: remediationId,
        config,
        error,
      });
      throw error;
    }
  }
}

module.exports = {
  AgenticBlogQaBatchService,
  MAX_CASES,
  assertExactKeys,
  containsSecretMaterial,
  deterministicObjectId,
  normalizeCodeActionEvidence,
  normalizeCaseInput,
  normalizeRevision,
  publicBatch,
  publicCase,
  publicRemediation,
  publicReport,
  validateResumePayloadEnvelope,
  validateSafeKey,
};
