import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  AgenticBlogQaBatchService,
  normalizeCodeActionEvidence,
} = require("../src/services/agenticBlogQa.service");
const {
  AgenticBlogQaController,
} = require("../src/controllers/agenticBlogQa.controller");

const ids = Object.freeze({
  batch: "507f1f77bcf86cd79943d001",
  qaCase: "507f1f77bcf86cd79943d002",
  schedule: "507f1f77bcf86cd79943d003",
  execution: "507f1f77bcf86cd79943d004",
  blog: "507f1f77bcf86cd79943d005",
  report: "507f1f77bcf86cd79943d006",
  remediation: "507f1f77bcf86cd79943d007",
});

const config = Object.freeze({
  enabled: true,
  environment: "local",
  databaseName: "inoxpran_qa_local",
  requiredScore: 81,
  existingSeoThreshold: 85,
  maxIterations: 3,
  requireAllCasesPass: true,
});

const lean = (value) => ({ lean: vi.fn().mockResolvedValue(value) });
const sortedLean = (value) => ({ sort: vi.fn(() => lean(value)) });

const validCodeBody = () => ({
  acknowledgeCodeChange: true,
  appliedCodeRevision: "revision-new-002",
  actionEvidence: {
    changedLayer: "shared_editorial_stage",
    changeSummary:
      "Repair the shared editorial stage while retaining every quality gate.",
    verificationRefs: ["LOCAL-QA-CODE-001", "LOCAL-VERIFY-001"],
  },
});

describe("Agentic Blog QA backend boundary safety", () => {
  it("enforces exact body and query contracts before configuration, infrastructure, or persistence", async () => {
    const EnsureInfrastructure = vi.fn();
    const service = new AgenticBlogQaBatchService({ EnsureInfrastructure });

    await expect(
      service.createBatch({
        payload: {},
        idempotencyKey: "boundary-create-key",
      }),
    ).rejects.toThrow("QA batch body contains invalid fields");
    await expect(
      service.createBatch({
        payload: { environment: "local", cases: [] },
        idempotencyKey: "boundary-create-key",
      }),
    ).rejects.toThrow("QA batch body contains invalid fields");
    await expect(
      service.createBatch({
        payload: { environment: "LOCAL" },
        idempotencyKey: "boundary-create-key",
      }),
    ).rejects.toThrow("Batch environment must be local or staging");
    await expect(
      service.runBatch({
        batchId: ids.batch,
        payload: { caseIds: [ids.qaCase] },
        idempotencyKey: "boundary-run-key",
      }),
    ).rejects.toThrow("QA batch run body contains invalid fields");
    await expect(
      service.reviewBatch({
        batchId: ids.batch,
        payload: { force: true },
      }),
    ).rejects.toThrow("QA batch review body contains invalid fields");
    await expect(
      service.getBatch({
        batchId: ids.batch,
        query: { includeInternal: "true" },
      }),
    ).rejects.toThrow("QA request query contains invalid fields");
    await expect(
      service.getReports({
        batchId: ids.batch,
        query: { raw: "true" },
      }),
    ).rejects.toThrow("QA request query contains invalid fields");
    await expect(
      service.planRemediation({
        batchId: ids.batch,
        payload: {},
        query: { force: "true" },
        idempotencyKey: "boundary-plan-key",
      }),
    ).rejects.toThrow("QA request query contains invalid fields");
    await expect(
      service.resumeRemediation({
        batchId: ids.batch,
        attemptId: ids.remediation,
        payload: {},
        query: { force: "true" },
      }),
    ).rejects.toThrow("QA request query contains invalid fields");

    for (const query of [
      { unsupported: "1" },
      { page: "1.5" },
      { page: "1000001" },
      { limit: "101" },
      { environment: "production" },
    ]) {
      await expect(service.listBatches({ query })).rejects.toThrow(
        /QA batch query/,
      );
    }

    expect(EnsureInfrastructure).not.toHaveBeenCalled();
  });

  it("forwards authoritative request bodies and queries without rebuilding or dropping fields", async () => {
    const qaService = {
      createBatch: vi.fn().mockResolvedValue({}),
      listBatches: vi.fn().mockResolvedValue({}),
      getBatch: vi.fn().mockResolvedValue({}),
      runBatch: vi.fn().mockResolvedValue({}),
      reviewBatch: vi.fn().mockResolvedValue({}),
      getReports: vi.fn().mockResolvedValue({}),
      planRemediation: vi.fn().mockResolvedValue({}),
      resumeRemediation: vi.fn().mockResolvedValue({}),
    };
    const controller = new AgenticBlogQaController({ qaService });
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const body = { environment: "local", unexpected: true };
    const query = { unexpected: "true" };
    const request = {
      body,
      query,
      params: { id: ids.batch, attemptId: ids.remediation },
      user: { userId: "admin-boundary" },
      adminRoles: ["ADMIN"],
      get: vi.fn().mockReturnValue("boundary-controller-key"),
    };

    await controller.createBatch(request, response);
    await controller.listBatches(request, response);
    await controller.getBatch(request, response);
    await controller.runBatch(request, response);
    await controller.reviewBatch(request, response);
    await controller.getReports(request, response);
    await controller.planRemediation(request, response);
    await controller.resumeRemediation(request, response);

    expect(qaService.createBatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: body, query }),
    );
    expect(qaService.listBatches).toHaveBeenCalledWith(
      expect.objectContaining({ query }),
    );
    expect(qaService.getBatch).toHaveBeenCalledWith(
      expect.objectContaining({ query }),
    );
    expect(qaService.runBatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: body, query }),
    );
    expect(qaService.reviewBatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: body, query }),
    );
    expect(qaService.getReports).toHaveBeenCalledWith(
      expect.objectContaining({ query }),
    );
    expect(qaService.planRemediation).toHaveBeenCalledWith(
      expect.objectContaining({ payload: body, query }),
    );
    expect(qaService.resumeRemediation).toHaveBeenCalledWith(
      expect.objectContaining({ payload: body, query }),
    );
  });

  it("rejects unknown remediation fields for direct service callers before infrastructure or persistence", async () => {
    const EnsureInfrastructure = vi.fn();
    const service = new AgenticBlogQaBatchService({ EnsureInfrastructure });

    await expect(
      service.planRemediation({
        batchId: ids.batch,
        payload: { plan: [{ action: "client supplied" }] },
        idempotencyKey: "boundary-plan-key",
      }),
    ).rejects.toThrow("remediation body contains invalid fields");

    await expect(
      service.resumeRemediation({
        batchId: ids.batch,
        attemptId: ids.remediation,
        payload: {
          ...validCodeBody(),
          debug: true,
        },
      }),
    ).rejects.toThrow("remediation body contains invalid fields");

    await expect(
      service.resumeRemediation({
        batchId: ids.batch,
        attemptId: ids.remediation,
        payload: {
          ...validCodeBody(),
          actionEvidence: {
            ...validCodeBody().actionEvidence,
            internalNotes: "should not be accepted",
          },
        },
      }),
    ).rejects.toThrow("actionEvidence contains invalid fields");

    expect(EnsureInfrastructure).not.toHaveBeenCalled();
  });

  it("rejects secret-bearing free text at the authoritative backend boundary", async () => {
    const service = new AgenticBlogQaBatchService();
    const secretBody = validCodeBody();
    secretBody.actionEvidence.changeSummary =
      "Repair the shared stage after copying api_key=should-never-cross-this-boundary.";

    await expect(
      service.resumeRemediation({
        batchId: ids.batch,
        attemptId: ids.remediation,
        payload: secretBody,
      }),
    ).rejects.toThrow("must not contain credentials or secret material");

    expect(() =>
      normalizeCodeActionEvidence({
        payload: {
          ...validCodeBody(),
          actionEvidence: {
            ...validCodeBody().actionEvidence,
            changeSummary:
              "Repair the shared stage using Authorization: Bearer abcdefghijklmnopqrstuvwxyz.",
          },
        },
        attempt: {
          failedLayer: "shared_editorial_stage",
          baselineCodeRevision: "revision-old-001",
          requiresArchitectureReport: false,
        },
        serverCodeRevision: "revision-new-002",
      }),
    ).toThrow("must not contain credentials or secret material");
  });

  it("returns explicit safe detail and report DTOs without internal hashes, leases, or raw action evidence", async () => {
    const batch = {
      _id: ids.batch,
      qaBatchId: ids.batch,
      batchKeyHash: "internal-batch-key-hash",
      topicFingerprints: ["internal-topic-fingerprint"],
      isQaTest: true,
      environment: "local",
      status: "awaiting_remediation_action",
      stopNewDrafts: true,
      acceptanceThreshold: 81,
      existingSeoThreshold: 85,
      iteration: 1,
      maxIterations: 3,
      requireAllCasesPass: true,
      caseIds: [ids.qaCase],
      remediationState: "awaiting_code_change",
      safetyPolicy: {
        allowPublicPublish: false,
        telegramEnabled: false,
        paidImagesEnabled: false,
        requestIndexing: false,
        socialDistribution: false,
        blindReviewEnabled: true,
        topicUniquenessEnabled: true,
      },
    };
    const qaCase = {
      _id: ids.qaCase,
      batchId: ids.batch,
      qaBatchId: ids.batch,
      qaCaseId: ids.qaCase,
      caseKey: "LOCAL-SAFE-DTO",
      environment: "local",
      executionMode: "run_now",
      scheduleMode: "fixed_brief",
      originalTopicSeed: "Safe QA topic",
      effectiveTopic: "Safe QA topic",
      articleType: "how_to",
      contentRole: "education",
      searchIntent: "informational",
      productMode: "off",
      productIntensity: "light",
      scheduleId: ids.schedule,
      executionId: ids.execution,
      blogId: ids.blog,
      acceptanceReportId: ids.report,
      status: "awaiting_remediation_action",
      runAttempts: [
        {
          attempt: 1,
          batchIteration: 0,
          executionMode: "run_now",
          idempotencyKeyHash: "internal-run-idempotency-hash",
          executionKey: "internal-run-execution-key",
          leaseOwnerHash: "internal-run-lease-owner-hash",
          executionId: ids.execution,
          status: "draft_created",
          dispatchState: "dispatched",
        },
      ],
      seniorScore: 72,
      existingSeoScore: 88,
      hardGatePassed: false,
      draftAcceptance: { pass: false, reasonCodes: ["quality_gate_failed"] },
      publishAcceptance: { pass: false, reasonCodes: ["qa_publish_forbidden"] },
      issueCounts: { critical: 0, high: 1, medium: 0, low: 0 },
    };
    const report = {
      _id: ids.report,
      batchId: ids.batch,
      caseId: ids.qaCase,
      qaBatchId: ids.batch,
      qaCaseId: ids.qaCase,
      environment: "local",
      executionMode: "run_now",
      originalTopicSeed: "Safe QA topic",
      blogId: ids.blog,
      executionId: ids.execution,
      iteration: 0,
      version: 1,
      reviewKeyHash: "internal-review-key-hash",
      blindInputHash: "internal-blind-input-hash",
      contentRevisionHash: "internal-content-revision-hash",
      blindReview: true,
      independence: { blindReviewConfirmed: true, forbiddenInputsDetected: [] },
      rubricVersion: "senior-blog-acceptance-v1",
      categories: {
        editorialQuality: {
          score: 5,
          maximum: 10,
          evidence: ["Persisted editorial evidence"],
          issues: [
            {
              code: "weak_opening",
              severity: "high",
              message: "Opening is weak.",
            },
          ],
          requiredFixes: ["Strengthen the opening."],
        },
      },
      totalScore: 72,
      acceptanceThreshold: 81,
      existingSeoScore: 88,
      existingSeoThreshold: 85,
      hardGates: [{ key: "draft_only", pass: true }],
      auditorHardGates: [],
      publishOnlyGates: [],
      criticalHighIssues: [{ code: "weak_opening", severity: "high" }],
      hardGatePassed: false,
      issueCounts: { critical: 0, high: 1, medium: 0, low: 0 },
      requiredFixes: ["Strengthen the opening."],
      draftAcceptance: { pass: false, reasonCodes: ["quality_gate_failed"] },
      publishAcceptance: { pass: false, reasonCodes: ["qa_publish_forbidden"] },
      verdict: "failed",
      evaluatedAt: new Date("2026-07-22T08:00:00.000Z"),
    };
    const remediation = {
      _id: ids.remediation,
      batchId: ids.batch,
      caseId: ids.qaCase,
      qaBatchId: ids.batch,
      qaCaseId: ids.qaCase,
      environment: "local",
      executionMode: "run_now",
      originalTopicSeed: "Safe QA topic",
      caseIds: [ids.qaCase],
      sourceReportIds: [ids.report],
      previousReportIds: [ids.report],
      iteration: 1,
      idempotencyKeyHash: "internal-remediation-idempotency-hash",
      classification: "shared_stage",
      status: "awaiting_action",
      issueCodes: ["weak_opening"],
      failedLayer: "shared_editorial_stage",
      plan: [
        {
          action: "Repair the shared stage",
          target: "shared_editorial_stage",
          expectedEvidence: "Integration regression coverage",
        },
      ],
      regressionControls: [],
      stopNewDrafts: true,
      requiresArchitectureReport: false,
      actionState: "awaiting_code_change",
      baselineCodeRevision: "revision-old-001",
      actionEvidence: {
        type: "verified_code_change",
        changedLayer: "shared_editorial_stage",
        changeSummary: "Raw action summary must stay internal.",
        verificationRefs: ["INTERNAL-REF-SECRET"],
      },
    };

    const BatchModel = { findOne: vi.fn(() => lean(batch)) };
    const CaseModel = { find: vi.fn(() => sortedLean([qaCase])) };
    const ReportModel = { find: vi.fn(() => sortedLean([report])) };
    const RemediationModel = { find: vi.fn(() => sortedLean([remediation])) };
    const service = new AgenticBlogQaBatchService({
      BatchModel,
      CaseModel,
      ReportModel,
      RemediationModel,
      config,
    });

    const detail = await service.getBatch({ batchId: ids.batch });
    const reports = await service.getReports({ batchId: ids.batch });
    const serialized = JSON.stringify({ detail, reports });

    for (const forbidden of [
      "internal-batch-key-hash",
      "internal-topic-fingerprint",
      "internal-run-idempotency-hash",
      "internal-run-execution-key",
      "internal-run-lease-owner-hash",
      "internal-review-key-hash",
      "internal-blind-input-hash",
      "internal-content-revision-hash",
      "internal-remediation-idempotency-hash",
      "Raw action summary must stay internal.",
      "INTERNAL-REF-SECRET",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    expect(detail.batch).toMatchObject({
      id: ids.batch,
      caseIds: [ids.qaCase],
      caseCount: 1,
      status: "awaiting_remediation_action",
    });
    expect(detail.cases[0]).toMatchObject({
      id: ids.qaCase,
      executionId: ids.execution,
      blogId: ids.blog,
      runAttempts: [
        {
          attempt: 1,
          batchIteration: 0,
          executionMode: "run_now",
          executionId: ids.execution,
          status: "draft_created",
          dispatchState: "dispatched",
        },
      ],
    });
    expect(detail.reports[0]).toMatchObject({
      id: ids.report,
      caseId: ids.qaCase,
      totalScore: 72,
      verdict: "failed",
    });
    expect(detail.remediation[0]).toMatchObject({
      id: ids.remediation,
      caseIds: [ids.qaCase],
      sourceReportIds: [ids.report],
      classification: "shared_stage",
      actionEvidenceSummary: {
        type: "verified_code_change",
        changedLayer: "shared_editorial_stage",
        verificationCount: 1,
        architectureReportIncluded: false,
        revisedCaseCount: 0,
      },
    });
    expect(detail.remediation[0]).not.toHaveProperty("actionEvidence");
    expect(reports.reports[0]).not.toHaveProperty("reviewKeyHash");
    expect(reports.reports[0]).not.toHaveProperty("blindInputHash");
    expect(reports.reports[0]).not.toHaveProperty("contentRevisionHash");
  });
});
