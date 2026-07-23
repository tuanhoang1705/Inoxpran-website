import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Module } = require("node:module");

const ORIGINAL_ENV = { ...process.env };
const ids = Object.freeze({
  admin: "507f1f77bcf86cd79943d001",
  workOrder: "507f1f77bcf86cd79943d002",
  opportunity: "507f1f77bcf86cd79943d003",
  googleSnapshot: "507f1f77bcf86cd79943d004",
  contentSnapshot: "507f1f77bcf86cd79943d005",
  brief: "507f1f77bcf86cd79943d006",
  execution: "507f1f77bcf86cd79943d007",
  inventory: "507f1f77bcf86cd79943d008",
  evidence: "507f1f77bcf86cd79943d009",
  research: "507f1f77bcf86cd79943d00a",
  style: "507f1f77bcf86cd79943d00b",
  strategy: "507f1f77bcf86cd79943d00c",
  readiness: "507f1f77bcf86cd79943d00d",
  productCatalog: "507f1f77bcf86cd79943d00e",
  productSeed: "507f1f77bcf86cd79943d00f",
  placement: "507f1f77bcf86cd79943d010",
  blog: "507f1f77bcf86cd79943d011",
});

const workOrder = {
  _id: ids.workOrder,
  status: "approved",
  decision: "new",
  topic: "Selected Work Order cookware guide",
  googleIntelSnapshotId: ids.googleSnapshot,
  contentOperationsSnapshotId: ids.contentSnapshot,
  contentOpportunityDecisionId: ids.opportunity,
  targetBlogId: null,
  mergeSourceBlogIds: [],
  warnings: [],
};
const brief = {
  _id: ids.brief,
  status: "complete",
  contentWorkOrderId: ids.workOrder,
  topic: "Selected fixed brief cookware guide",
  primaryTerms: ["safe cookware selection"],
  relatedTerms: ["material labels", "household use"],
  articleType: "buying-guide",
  language: "vi",
  productIntegration: { mode: "auto" },
  productPlacementConstraints: {
    placementStyle: "criteria-first-recommendation",
    forbiddenSections: ["introduction"],
  },
};
const opportunity = {
  _id: ids.opportunity,
  status: "converted",
  recommendedAction: "new",
  contentOperationsSnapshotId: ids.contentSnapshot,
};
const pipelinePayload = {
  mode: "draft",
  title: "Selected fixed brief cookware guide",
  contentInventorySnapshotId: ids.inventory,
  evidenceMapId: ids.evidence,
  researchBundleId: ids.research,
  editorialStyleProfileId: ids.style,
  strategyPlanId: ids.strategy,
  publishReadinessReportId: ids.readiness,
  productCatalogSnapshotId: ids.productCatalog,
  productSeedPlanId: ids.productSeed,
  editorialProductPlacementPlanId: ids.placement,
  productSeedingMode: "auto",
  productSeedingDecision: "selected",
  seededProductIds: [],
  productSeedingReview: { pass: true },
  productClaimReview: { pass: true },
  editorialProductPlacementReview: { pass: true },
};

const workOrderModel = {
  findById: vi.fn(),
};
const briefModel = {
  findOne: vi.fn(),
};
const opportunityModel = {
  findById: vi.fn(),
};
const executionModel = {
  create: vi.fn(),
  updateOne: vi.fn(),
  findById: vi.fn(),
};
const auditMock = vi.fn();
const runPipelineMock = vi.fn();
const publishMock = vi.fn();
const attachProductMock = vi.fn();
const attachPlacementMock = vi.fn();

const installMock = (modulePath, exports) => {
  const resolvedPath = require.resolve(modulePath);
  const mockModule = new Module(resolvedPath);
  mockModule.exports = exports;
  require.cache[resolvedPath] = mockModule;
};

const actualWorkOrderModel = require("../src/models/contentWorkOrder.model");
installMock("../src/models/contentWorkOrder.model", {
  ...actualWorkOrderModel,
  ContentWorkOrder: workOrderModel,
});
installMock("../src/models/unifiedContentBrief.model", {
  UnifiedContentBrief: briefModel,
});
installMock("../src/models/contentOpportunityDecision.model", {
  ContentOpportunityDecision: opportunityModel,
});
installMock("../src/models/blogAutomationExecution.model", {
  BlogAutomationExecution: executionModel,
});
installMock(
  "../src/services/contentOperations/contentOperationsAudit.service",
  {
    writeContentOperationsAudit: auditMock,
  },
);
installMock("../src/services/agenticBlogCore.service", {
  AgenticBlogCoreService: { runPipeline: runPipelineMock },
});
installMock("../src/services/automationSeoBlog.service", {
  publishSeoBlog: publishMock,
});
installMock("../src/services/productSeedPlanning.service", {
  ProductSeedPlanningService: { attachExecution: attachProductMock },
});
installMock("../src/services/editorialProductPlacementPlanning.service", {
  EditorialProductPlacementPlanningService: {
    attachRelations: attachPlacementMock,
  },
});

delete require.cache[
  require.resolve("../src/services/contentOperations/contentOperationsAdmin.service")
];
const {
  ContentOperationsAdminService,
} = require("../src/services/contentOperations/contentOperationsAdmin.service");

const lean = (value) => ({ lean: vi.fn().mockResolvedValue(value) });
const sortedLean = (value) => ({ sort: vi.fn(() => lean(value)) });

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, CONTENT_OPERATIONS_ENABLED: "true" };
  vi.clearAllMocks();
  workOrderModel.findById.mockImplementation(() => lean(workOrder));
  briefModel.findOne.mockImplementation(() => sortedLean(brief));
  opportunityModel.findById.mockImplementation(() => lean(opportunity));
  executionModel.create.mockResolvedValue({
    _id: ids.execution,
    executionKey: `content-work-order:${ids.workOrder}:test`,
    correlationId: "selected-work-order-test-correlation",
  });
  executionModel.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
  auditMock.mockResolvedValue({});
  attachProductMock.mockResolvedValue({});
  attachPlacementMock.mockResolvedValue({});
  runPipelineMock.mockResolvedValue({
    skipped: false,
    maintenance: false,
    payload: pipelinePayload,
    reviews: [{ name: "fact-review", pass: true }],
    context: {
      productSeedPlan: { _id: ids.productSeed },
      editorialPlacementPlan: { _id: ids.placement },
      strategy: { _id: ids.strategy },
      contentPlanning: {
        candidates: [{ action: "new", score: 90 }],
        sourceHealth: { googleIntelligence: "healthy" },
        sourceFreshness: { googleIntelligence: "fresh" },
      },
    },
  });
  publishMock.mockResolvedValue({
    blogId: ids.blog,
    slug: "selected-fixed-brief-cookware-guide",
    mode: "draft",
    published: false,
    revisionStaged: false,
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("Content Operations selected Work Order source-level QA path", () => {
  it("runs only the selected persisted Work Order and preserves its complete draft artifact chain", async () => {
    const result = await ContentOperationsAdminService.runWorkOrder({
      id: ids.workOrder,
      payload: { draftOnly: true, workOrderId: ids.workOrder },
      adminId: ids.admin,
      ip: "127.0.0.1",
    });

    expect(workOrderModel.findById).toHaveBeenCalledWith(ids.workOrder);
    expect(briefModel.findOne).toHaveBeenCalledWith({
      contentWorkOrderId: ids.workOrder,
      status: "complete",
      isQaTest: { $ne: true },
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
    expect(opportunityModel.findById).toHaveBeenCalledWith(ids.opportunity);
    expect(executionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: null,
        status: "running",
        googleIntelSnapshotId: ids.googleSnapshot,
        contentOperationsSnapshotId: ids.contentSnapshot,
        contentOpportunityDecisionId: ids.opportunity,
        contentWorkOrderId: ids.workOrder,
        unifiedContentBriefId: ids.brief,
        contentAction: "new",
        metadata: expect.objectContaining({
          trigger: "admin_work_order",
          draftOnly: true,
          actorAdminId: ids.admin,
        }),
      }),
    );
    expect(runPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: ids.execution,
        schedule: expect.objectContaining({
          name: workOrder.topic,
          mode: "fixed_brief",
          draftOnly: true,
          autoPublish: false,
          agentConfig: expect.objectContaining({
            topic: brief.topic,
            primaryKeyword: brief.primaryTerms[0],
            articleType: brief.articleType,
            language: "vi",
            workOrderId: ids.workOrder,
            contentAction: "new",
            productSeeding: { mode: "auto" },
            productPlacement: brief.productPlacementConstraints,
          }),
        }),
      }),
    );
    expect(executionModel.updateOne).toHaveBeenCalledWith(
      { _id: ids.execution },
      {
        $set: expect.objectContaining({
          contentInventorySnapshotId: ids.inventory,
          evidenceMapId: ids.evidence,
          researchBundleId: ids.research,
          editorialStyleProfileId: ids.style,
          strategyPlanId: ids.strategy,
          productCatalogSnapshotId: ids.productCatalog,
          productSeedPlanId: ids.productSeed,
          editorialProductPlacementPlanId: ids.placement,
          productSeedingMode: "auto",
          reviewerDecisions: [{ name: "fact-review", pass: true }],
          agentSteps: expect.arrayContaining([
            "google-intelligence-gate",
            "content-work-order",
            "unified-content-brief",
            "research",
            "evidence-map",
            "writer",
            "reviewers",
            "publish-readiness",
          ]),
        }),
      },
    );
    expect(attachProductMock).toHaveBeenCalledWith({
      planId: ids.productSeed,
      executionId: ids.execution,
    });
    expect(attachPlacementMock).toHaveBeenCalledWith({
      planId: ids.placement,
      executionId: ids.execution,
      strategyPlanId: ids.strategy,
    });
    expect(publishMock).toHaveBeenCalledOnce();
    expect(publishMock).toHaveBeenCalledWith({ payload: pipelinePayload });
    expect(result).toMatchObject({
      executionId: ids.execution,
      result: {
        blogId: ids.blog,
        mode: "draft",
        published: false,
      },
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "work_order_run_requested",
        contentWorkOrderId: ids.workOrder,
      }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "work_order_draft_created",
        contentWorkOrderId: ids.workOrder,
      }),
    );
  });

  it("fails closed before reads or execution when a selected Work Order requests public mode", async () => {
    await expect(
      ContentOperationsAdminService.runWorkOrder({
        id: ids.workOrder,
        payload: { draftOnly: false, workOrderId: ids.workOrder },
        adminId: ids.admin,
        ip: "127.0.0.1",
      }),
    ).rejects.toThrow("Content Operations Work Orders are draft-only");

    expect(workOrderModel.findById).not.toHaveBeenCalled();
    expect(briefModel.findOne).not.toHaveBeenCalled();
    expect(executionModel.create).not.toHaveBeenCalled();
    expect(runPipelineMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("rejects a conflicting selected Work Order identifier before reading either artifact chain", async () => {
    await expect(
      ContentOperationsAdminService.runWorkOrder({
        id: ids.workOrder,
        payload: { draftOnly: true, workOrderId: ids.opportunity },
        adminId: ids.admin,
        ip: "127.0.0.1",
      }),
    ).rejects.toThrow("Selected Work Order does not match the route");

    expect(workOrderModel.findById).not.toHaveBeenCalled();
    expect(briefModel.findOne).not.toHaveBeenCalled();
    expect(opportunityModel.findById).not.toHaveBeenCalled();
    expect(executionModel.create).not.toHaveBeenCalled();
    expect(runPipelineMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });
});
