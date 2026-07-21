import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ACTIONS,
  getContentOperationsConfig,
} = require("../src/config/contentOperations.config");
const {
  ContentOperationsPlanningService,
  createPlanningRunLeaseGuard,
} = require("../src/services/contentOperations/contentOperationsPlanning.service");

const ids = {
  run: "507f1f77bcf86cd799439301",
  google: "507f1f77bcf86cd799439302",
  snapshot: "507f1f77bcf86cd799439303",
  inventory: "507f1f77bcf86cd799439304",
  decision: "507f1f77bcf86cd799439305",
};

const fixedNow = new Date("2026-07-20T12:00:00.000Z");
const successfulUpdate = () => ({ matchedCount: 1, modifiedCount: 1 });
const inventoryModel = () => ({
  find: vi.fn(() => ({
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    lean: async () => [],
  })),
});

describe("Content Operations planning lease fencing", () => {
  it("compensates only artifacts owned by the stale planning run when ownership is lost after persistence", async () => {
    let decisionPersisted = false;
    const runState = { status: "running" };
    const RunModel = {
      create: vi.fn(async (document) => ({ _id: ids.run, ...document })),
      updateOne: vi.fn(async (_filter, update) => {
        if (update?.$set?.status) runState.status = update.$set.status;
        return successfulUpdate();
      }),
    };
    const selected = {
      _id: ids.decision,
      candidateId: "selected-new",
      status: "selected",
      decisionType: ACTIONS.NEW,
      recommendedAction: ACTIONS.NEW,
      topic: "Evidence-backed cookware guide",
      totalScore: 0.84,
      positiveEvidence: [
        { source: "content_inventory", detail: "Verified gap" },
      ],
      targetBlogIds: [],
      decisionReason: "The verified gap exceeds the configured threshold.",
    };
    const DecisionService = {
      persistCandidates: vi.fn(async ({ planningRunId }) => {
        expect(String(planningRunId)).toBe(ids.run);
        decisionPersisted = true;
        return {
          selected,
          persisted: [selected],
          rankedCandidates: [selected],
        };
      }),
    };
    const OpportunityModel = {
      deleteMany: vi.fn(async () => ({ deletedCount: 1 })),
    };
    const WorkOrderModel = {
      deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
    };
    const BriefModel = { deleteMany: vi.fn(async () => ({ deletedCount: 0 })) };
    const WorkOrderService = {
      createFromDecision: vi.fn(),
      attachArtifact: vi.fn(),
    };
    const service = new ContentOperationsPlanningService({
      config: getContentOperationsConfig({
        CONTENT_OPERATIONS_ENABLED: "true",
        CONTENT_INVENTORY_ENABLED: "true",
      }),
      GoogleService: {
        ensureGoogleIntelligenceSnapshotForDate: vi.fn(async () => ({
          _id: ids.google,
          id: ids.google,
        })),
      },
      IntelligenceService: {
        ensureContentOperationsSnapshotForDate: vi.fn(async () => ({
          snapshot: {
            _id: ids.snapshot,
            id: ids.snapshot,
            googleIntelSnapshotId: ids.google,
            contentInventorySnapshotId: ids.inventory,
            status: "complete",
            sourceHealth: [],
            sourceFreshness: {},
            warnings: [],
          },
        })),
      },
      DecisionService,
      WorkOrderService,
      BriefService: { create: vi.fn() },
      SignalService: { listSignals: vi.fn(async () => []) },
      InventoryItemModel: inventoryModel(),
      OpportunityModel,
      WorkOrderModel,
      BriefModel,
      RunModel,
      now: () => new Date(fixedNow),
    });

    await expect(
      service.plan({
        trigger: "scheduled",
        executionKey: "schedule:slot-1",
        input: { mode: "fixed_brief", topic: "Evidence-backed cookware guide" },
        lease: {
          ownerToken: "worker-a:claim-1",
          leaseMs: 30_000,
          heartbeat: false,
          assertOwner: vi.fn(async () => !decisionPersisted),
        },
      }),
    ).rejects.toMatchObject({ code: "CONTENT_OPERATIONS_RUN_LEASE_LOST" });

    expect(WorkOrderService.createFromDecision).not.toHaveBeenCalled();
    expect(OpportunityModel.deleteMany).toHaveBeenCalledWith({
      planningRunId: ids.run,
    });
    expect(WorkOrderModel.deleteMany).toHaveBeenCalledWith({
      "metadata.planningRunId": ids.run,
    });
    expect(BriefModel.deleteMany).toHaveBeenCalledWith({
      planningRunId: ids.run,
    });
    expect(runState.status).toBe("failed");
    const persistedWrites = JSON.stringify(RunModel.updateOne.mock.calls);
    expect(persistedWrites).not.toContain("Bearer");
    expect(persistedWrites).not.toContain("token=");
  });

  it.each(["work_order", "brief"])(
    "removes decision, Work Order, and brief provenance after losing the lease at the %s boundary",
    async (lossBoundary) => {
      let persistedBoundary = "";
      const RunModel = {
        create: vi.fn(async (document) => ({ _id: ids.run, ...document })),
        updateOne: vi.fn(async () => successfulUpdate()),
      };
      const selected = {
        _id: ids.decision,
        candidateId: "selected-new",
        status: "selected",
        decisionType: ACTIONS.NEW,
        recommendedAction: ACTIONS.NEW,
        topic: "Lease-fenced cookware guide",
        totalScore: 0.88,
        positiveEvidence: [
          { source: "content_inventory", detail: "Verified gap" },
        ],
        targetBlogIds: [],
        decisionReason: "The evidence-backed gap is eligible.",
      };
      const workOrder = {
        _id: "507f1f77bcf86cd799439306",
        status: "planned",
        decision: ACTIONS.NEW,
        topic: selected.topic,
        primaryBusinessGoal: "customer_education",
        targetAudience: ["Vietnamese households"],
        funnelStage: "consideration",
        primarySearchIntent: "informational",
        secondarySearchIntents: [],
        customerQuestions: ["What should readers know?"],
        requiredEvidence: [],
        productIntegrationPolicy: { mode: "off" },
        successMetrics: [
          { key: "readiness_critical_issues", operator: "equals", target: 0 },
        ],
        metadata: { planningRunId: ids.run },
      };
      const brief = { _id: "507f1f77bcf86cd799439307" };
      const DecisionService = {
        persistCandidates: vi.fn(async () => ({
          selected,
          persisted: [selected],
          rankedCandidates: [selected],
        })),
      };
      const WorkOrderService = {
        createFromDecision: vi.fn(async ({ input }) => {
          expect(input.metadata.planningRunId).toBe(ids.run);
          persistedBoundary = "work_order";
          return workOrder;
        }),
        attachArtifact: vi.fn(),
      };
      const BriefService = {
        create: vi.fn(async ({ input }) => {
          expect(String(input.planningRunId)).toBe(ids.run);
          persistedBoundary = "brief";
          return brief;
        }),
      };
      const OpportunityModel = {
        deleteMany: vi.fn(async () => ({ deletedCount: 1 })),
      };
      const WorkOrderModel = {
        deleteMany: vi.fn(async () => ({ deletedCount: 1 })),
      };
      const BriefModel = {
        deleteMany: vi.fn(async () => ({ deletedCount: 1 })),
      };
      const service = new ContentOperationsPlanningService({
        config: getContentOperationsConfig({
          CONTENT_OPERATIONS_ENABLED: "true",
          CONTENT_INVENTORY_ENABLED: "true",
        }),
        GoogleService: {
          ensureGoogleIntelligenceSnapshotForDate: vi.fn(async () => ({
            _id: ids.google,
            id: ids.google,
          })),
        },
        IntelligenceService: {
          ensureContentOperationsSnapshotForDate: vi.fn(async () => ({
            snapshot: {
              _id: ids.snapshot,
              id: ids.snapshot,
              googleIntelSnapshotId: ids.google,
              contentInventorySnapshotId: ids.inventory,
              status: "complete",
              sourceHealth: [],
              sourceFreshness: {},
              warnings: [],
            },
          })),
        },
        DecisionService,
        WorkOrderService,
        BriefService,
        SignalService: { listSignals: vi.fn(async () => []) },
        InventoryItemModel: inventoryModel(),
        OpportunityModel,
        WorkOrderModel,
        BriefModel,
        RunModel,
        now: () => new Date(fixedNow),
      });

      await expect(
        service.plan({
          trigger: "scheduled",
          executionKey: `schedule:${lossBoundary}`,
          input: { mode: "fixed_brief", topic: selected.topic },
          lease: {
            ownerToken: "worker-boundary:claim",
            leaseMs: 30_000,
            heartbeat: false,
            assertOwner: vi.fn(async () => persistedBoundary !== lossBoundary),
          },
        }),
      ).rejects.toMatchObject({ code: "CONTENT_OPERATIONS_RUN_LEASE_LOST" });

      expect(OpportunityModel.deleteMany).toHaveBeenCalledWith({
        planningRunId: ids.run,
      });
      expect(WorkOrderModel.deleteMany).toHaveBeenCalledWith({
        "metadata.planningRunId": ids.run,
      });
      expect(BriefModel.deleteMany).toHaveBeenCalledWith({
        planningRunId: ids.run,
      });
      expect(WorkOrderService.attachArtifact).not.toHaveBeenCalled();
      if (lossBoundary === "work_order")
        expect(BriefService.create).not.toHaveBeenCalled();
      if (lossBoundary === "brief")
        expect(BriefService.create).toHaveBeenCalledOnce();
    },
  );

  it("rejects terminal success when the run ownership compare-and-set loses the race", async () => {
    const RunModel = {
      updateOne: vi.fn(async (_filter, update) =>
        update?.$set?.status === "completed"
          ? { matchedCount: 0, modifiedCount: 0 }
          : successfulUpdate(),
      ),
    };
    const service = new ContentOperationsPlanningService({
      RunModel,
      SignalService: { listSignals: vi.fn() },
      now: () => new Date(fixedNow),
    });
    const guard = createPlanningRunLeaseGuard({
      RunModel,
      runId: ids.run,
      ownerToken: "worker-a:stale-claim",
      leaseMs: 30_000,
      assertExternalOwner: vi.fn(async () => true),
      clock: () => new Date(fixedNow),
      heartbeat: false,
    });

    await expect(
      service.persistRunTerminal({
        runId: ids.run,
        ownerToken: "worker-a:stale-claim",
        leaseGuard: guard,
        updates: { status: "completed" },
      }),
    ).rejects.toMatchObject({ code: "CONTENT_OPERATIONS_RUN_LEASE_LOST" });

    const terminalCall = RunModel.updateOne.mock.calls.at(-1);
    expect(terminalCall[0]).toMatchObject({
      _id: ids.run,
      status: "running",
      leaseOwner: "worker-a:stale-claim",
      leaseUntil: { $gt: fixedNow },
    });
    await guard.stop();
  });

  it("never persists a raw secret-bearing exception message", async () => {
    const secretError = new Error(
      "Bearer top-secret at https://vendor.invalid/data?token=top-secret",
    );
    secretError.code = "bad code https://vendor.invalid/?signature=top-secret";
    const RunModel = {
      create: vi.fn(async (document) => ({ _id: ids.run, ...document })),
      updateOne: vi.fn(async () => successfulUpdate()),
    };
    const service = new ContentOperationsPlanningService({
      GoogleService: {
        ensureGoogleIntelligenceSnapshotForDate: vi.fn(async () => {
          throw secretError;
        }),
      },
      SignalService: { listSignals: vi.fn() },
      RunModel,
      now: () => new Date(fixedNow),
    });

    await expect(service.plan({ trigger: "manual", input: {} })).rejects.toBe(
      secretError,
    );

    const failureUpdate = RunModel.updateOne.mock.calls.at(-1);
    expect(failureUpdate[0]).toEqual({ _id: ids.run, status: "running" });
    expect(failureUpdate[1].$set.errorDetails).toEqual([
      {
        code: "INTERNAL_ERROR",
        message: "Content Operations planning failed safely.",
      },
    ]);
    const serialized = JSON.stringify(failureUpdate);
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("vendor.invalid");
  });
});
