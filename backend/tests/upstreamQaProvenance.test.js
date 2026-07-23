import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GoogleIntelligenceSnapshot } = require('../src/models/googleIntelligenceSnapshot.model');
const { GoogleIntelligenceRun } = require('../src/models/googleIntelligenceRun.model');
const { ContentOperationsDailySnapshot } = require('../src/models/contentOperationsDailySnapshot.model');
const { ContentInventorySnapshot } = require('../src/models/contentInventorySnapshot.model');
const { ContentInventoryItem } = require('../src/models/contentInventoryItem.model');
const { ProductCatalogSnapshot } = require('../src/models/productCatalogSnapshot.model');
const { GoogleIntelligenceService } = require('../src/services/googleIntelligence.service');
const { AgenticBlogCoreService } = require('../src/services/agenticBlogCore.service');
const {
    ContentOperationsIntelligenceService
} = require('../src/services/contentOperations/contentOperationsIntelligence.service');
const {
    ContentInventoryService
} = require('../src/services/contentOperations/contentInventory.service');
const {
    ContentOperationsPlanningService
} = require('../src/services/contentOperations/contentOperationsPlanning.service');
const {
    ContentOpportunityDecisionService
} = require('../src/services/contentOperations/opportunityDecision.service');
const {
    buildWorkOrderDocument
} = require('../src/services/contentOperations/workOrder.service');
const { ACTIONS } = require('../src/config/contentOperations.config');
const AutomationSeoBlogService = require('../src/services/automationSeoBlog.service');
const {
    ProductCatalogIntelligenceService,
    hashSafeCatalog
} = require('../src/services/productCatalogIntelligence.service');
const {
    normalizeTrustedQaProvenance,
    qaScopeFilter
} = require('../src/utils/qaProvenance.util');
const {
    buildContentOperationsRunLineage,
    buildGoogleRunLineage,
    buildInventoryItemLineage,
    classifyUpstreamQaProvenance
} = require('../src/services/agenticBlogQaEvidence.service');

const now = new Date('2026-07-22T05:00:00.000Z');
const qaContext = Object.freeze({
    isQaTest: true,
    qaBatchId: '507f1f77bcf86cd799439101',
    qaCaseId: '507f1f77bcf86cd799439102',
    environment: 'local',
    executionMode: 'run_now',
    originalTopicSeed: 'A bounded QA provenance topic',
    normalizedTopicKey: 'a-bounded-qa-provenance-topic',
    qaTopicReservationId: '507f1f77bcf86cd799439103'
});
const expectedProvenance = {
    isQaTest: true,
    qaBatchId: qaContext.qaBatchId,
    qaCaseId: qaContext.qaCaseId,
    environment: 'local',
    executionMode: 'run_now',
    originalTopicSeed: qaContext.originalTopicSeed,
    normalizedTopicKey: qaContext.normalizedTopicKey
};

const queryOf = (value) => {
    const query = {};
    const resolveValue = () => typeof value === 'function' ? value() : value;
    query.select = vi.fn(() => query);
    query.sort = vi.fn(() => query);
    query.lean = vi.fn(async () => resolveValue());
    query.then = (resolve, reject) => Promise.resolve(resolveValue()).then(resolve, reject);
    return query;
};

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('upstream QA provenance contract', () => {
    it('adds the six provenance fields to every upstream artifact that QA can create', () => {
        const models = [
            GoogleIntelligenceSnapshot,
            GoogleIntelligenceRun,
            ContentOperationsDailySnapshot,
            ContentInventorySnapshot,
            ContentInventoryItem,
            ProductCatalogSnapshot
        ];
        const fields = [
            'isQaTest', 'qaBatchId', 'qaCaseId',
            'environment', 'executionMode', 'originalTopicSeed', 'normalizedTopicKey'
        ];
        for (const Model of models) {
            for (const field of fields) expect(Model.schema.path(field), `${Model.modelName}.${field}`).toBeTruthy();
        }
        for (const Model of [GoogleIntelligenceSnapshot, ContentOperationsDailySnapshot, ContentInventorySnapshot]) {
            expect(Model.schema.indexes()).toEqual(expect.arrayContaining([
                [
                    expect.objectContaining({
                        snapshotDate: 1,
                        timezone: 1,
                        isQaTest: 1,
                        qaBatchId: 1,
                        qaCaseId: 1
                    }),
                    expect.objectContaining({ unique: true })
                ]
            ]));
        }
    });

    it('fails closed on incomplete provenance and keeps production scope separate', () => {
        expect(() => normalizeTrustedQaProvenance({ isQaTest: true })).toThrow(
            expect.objectContaining({ code: 'TRUSTED_QA_PROVENANCE_INVALID' })
        );
        expect(normalizeTrustedQaProvenance({ ...qaContext, injected: 'ignored' })).toEqual(expectedProvenance);
        expect(qaScopeFilter(null)).toEqual({ isQaTest: { $ne: true } });
        expect(qaScopeFilter(qaContext)).toEqual({
            isQaTest: true,
            qaBatchId: qaContext.qaBatchId,
            qaCaseId: qaContext.qaCaseId
        });
    });

    it('persists Work Order provenance only from its trusted decision anchor', () => {
        const decision = {
            _id: '507f1f77bcf86cd799439120',
            contentOperationsSnapshotId: '507f1f77bcf86cd799439121',
            candidateId: 'qa-work-order-candidate',
            decisionType: ACTIONS.NEW,
            recommendedAction: ACTIONS.NEW,
            topic: qaContext.originalTopicSeed,
            totalScore: 0.9,
            targetBlogIds: [],
            ...expectedProvenance
        };
        const input = {
            googleIntelSnapshotId: '507f1f77bcf86cd799439122',
            primaryBusinessGoal: 'customer_education',
            successMetrics: [{ metric: 'qualified_impressions', target: 1 }],
            qaContext
        };

        expect(buildWorkOrderDocument({ decision, input })).toMatchObject(expectedProvenance);
        expect(() => buildWorkOrderDocument({
            decision,
            input: {
                ...input,
                qaContext: { ...qaContext, qaCaseId: '507f1f77bcf86cd799439199' }
            }
        })).toThrow(expect.objectContaining({ code: 'TRUSTED_QA_PROVENANCE_INVALID' }));
        expect(() => buildWorkOrderDocument({
            decision: { ...decision, executionMode: '' },
            input
        })).toThrow(expect.objectContaining({ code: 'TRUSTED_QA_PROVENANCE_INVALID' }));
        expect(() => buildWorkOrderDocument({
            decision: {
                ...decision,
                isQaTest: false,
                qaBatchId: null,
                qaCaseId: null,
                environment: '',
                executionMode: '',
                originalTopicSeed: '',
                normalizedTopicKey: ''
            },
            input
        })).toThrow(expect.objectContaining({ code: 'TRUSTED_QA_PROVENANCE_INVALID' }));
    });

    it('keeps production and QA opportunity decisions in separate upsert scopes', async () => {
        const filters = [];
        const DecisionModel = {
            findOneAndUpdate: vi.fn(async (filter, update) => {
                filters.push(filter);
                return {
                    _id: `decision-${filters.length}`,
                    ...update.$setOnInsert,
                    ...update.$set
                };
            })
        };
        const common = {
            contentOperationsSnapshotId: '507f1f77bcf86cd799439123',
            candidates: [{
                candidateId: 'shared-candidate',
                decisionType: ACTIONS.NEW,
                topic: 'Scoped opportunity',
                factors: {
                    userDemand: 1,
                    contentGap: 1,
                    performance: 1,
                    business: 1,
                    freshness: 1,
                    customerSignal: 1,
                    productCampaign: 1,
                    evidence: 1,
                    internalLink: 1
                }
            }],
            DecisionModel
        };

        const production = await ContentOpportunityDecisionService.persistCandidates(common);
        const qa = await ContentOpportunityDecisionService.persistCandidates({
            ...common,
            qaContext
        });

        expect(filters[0]).toMatchObject({
            contentOperationsSnapshotId: common.contentOperationsSnapshotId,
            candidateId: 'shared-candidate',
            isQaTest: { $ne: true }
        });
        expect(filters[1]).toMatchObject({
            contentOperationsSnapshotId: common.contentOperationsSnapshotId,
            candidateId: 'shared-candidate',
            isQaTest: true,
            qaBatchId: qaContext.qaBatchId,
            qaCaseId: qaContext.qaCaseId
        });
        expect(production.persisted[0]).toMatchObject({
            isQaTest: false,
            qaBatchId: null,
            qaCaseId: null
        });
        expect(qa.persisted[0]).toMatchObject(expectedProvenance);
    });

    it('fails the publisher closed on cross-scope or partial shared artifacts', () => {
        const assertArtifact = AutomationSeoBlogService.assertPublisherArtifactProvenance;
        expect(assertArtifact({
            label: 'workOrder',
            artifact: { _id: 'qa-work-order', ...expectedProvenance },
            qaContext
        })).toBe('qa_exact');
        expect(assertArtifact({
            label: 'googleSnapshot',
            artifact: { _id: 'production-google', isQaTest: false },
            qaContext,
            allowCleanProductionReuse: true
        })).toBe('production_reused');
        expect(() => assertArtifact({
            label: 'workOrder',
            artifact: { _id: 'production-work-order', isQaTest: false },
            qaContext
        })).toThrow(/trusted publisher provenance scope/);
        expect(() => assertArtifact({
            label: 'workOrder',
            artifact: { _id: 'partial', isQaTest: false, qaCaseId: qaContext.qaCaseId }
        })).toThrow(/trusted publisher provenance scope/);
        expect(() => assertArtifact({
            label: 'workOrder',
            artifact: { _id: 'qa-work-order', ...expectedProvenance }
        })).toThrow(/trusted publisher provenance scope/);
    });

    it('classifies retained upstream evidence only as exact QA or clean production reuse', () => {
        expect(classifyUpstreamQaProvenance({
            artifact: { _id: 'qa-snapshot', ...expectedProvenance },
            expected: expectedProvenance
        })).toEqual({ valid: true, provenanceClass: 'qa_exact', reason: '' });
        expect(classifyUpstreamQaProvenance({
            artifact: { _id: 'production-snapshot', isQaTest: false },
            expected: expectedProvenance
        })).toEqual({ valid: true, provenanceClass: 'production_reused', reason: '' });
        expect(classifyUpstreamQaProvenance({
            artifact: { _id: 'partial', isQaTest: false, qaCaseId: qaContext.qaCaseId },
            expected: expectedProvenance
        })).toMatchObject({ valid: false, provenanceClass: 'invalid_partial_non_qa' });
        expect(classifyUpstreamQaProvenance({
            artifact: { _id: 'wrong-case', ...expectedProvenance, qaCaseId: '507f1f77bcf86cd799439199' },
            expected: expectedProvenance
        })).toMatchObject({ valid: false, provenanceClass: 'invalid_qa_mismatch', reason: 'qa_case_id' });
    });

    it('requires an exact terminal Google run for a QA snapshot and permits no run for clean production reuse', () => {
        const snapshot = { _id: 'google-snapshot', runId: 'google-run', ...expectedProvenance };
        const exact = buildGoogleRunLineage({
            snapshot,
            run: {
                _id: 'google-run',
                snapshotId: 'google-snapshot',
                status: 'completed_no_change',
                ...expectedProvenance
            },
            expected: expectedProvenance
        });
        expect(exact).toMatchObject({
            valid: true,
            summary: { id: 'google-run', status: 'completed_no_change', provenanceClass: 'qa_exact' }
        });
        expect(buildGoogleRunLineage({
            snapshot: { _id: 'production-google', isQaTest: false },
            run: null,
            expected: expectedProvenance
        })).toMatchObject({
            valid: true,
            requiredArtifactMissing: false,
            summary: { provenanceClass: 'not_applicable' }
        });
        expect(buildGoogleRunLineage({
            snapshot,
            run: null,
            expected: expectedProvenance
        })).toMatchObject({ valid: false, requiredArtifactMissing: true });
    });

    it('counts and validates every retained QA inventory item without exposing item content', () => {
        const lineage = buildInventoryItemLineage({
            snapshot: { _id: 'inventory-snapshot', itemCount: 2, ...expectedProvenance },
            retainedItemCount: 2,
            items: [
                { _id: 'item-1', snapshotId: 'inventory-snapshot', ...expectedProvenance },
                { _id: 'item-2', snapshotId: 'inventory-snapshot', ...expectedProvenance }
            ],
            expected: expectedProvenance
        });
        expect(lineage).toMatchObject({
            valid: true,
            summary: { declaredItemCount: 2, retainedItemCount: 2, provenanceClass: 'qa_exact' }
        });
        expect(lineage.summary).not.toHaveProperty('items');
        expect(buildInventoryItemLineage({
            snapshot: { _id: 'inventory-snapshot', itemCount: 2, ...expectedProvenance },
            retainedItemCount: 1,
            items: [{ _id: 'item-1', snapshotId: 'other-snapshot', ...expectedProvenance }],
            expected: expectedProvenance
        }).valid).toBe(false);
    });

    it('validates a linked Content Operations run or marks a selected existing Work Order path not applicable', () => {
        const googleSnapshot = { _id: 'google-snapshot' };
        const contentOperationsSnapshot = { _id: 'daily-snapshot' };
        const inventorySnapshot = { _id: 'inventory-snapshot' };
        const opportunityDecision = { _id: 'opportunity', planningRunId: 'planning-run' };
        const workOrder = { _id: 'work-order', metadata: { planningRunId: 'planning-run' } };
        const brief = { _id: 'brief', planningRunId: 'planning-run' };
        const lineage = buildContentOperationsRunLineage({
            run: {
                _id: 'planning-run',
                status: 'completed',
                googleIntelSnapshotId: 'google-snapshot',
                contentOperationsSnapshotId: 'daily-snapshot',
                contentInventorySnapshotId: 'inventory-snapshot',
                contentOpportunityDecisionId: 'opportunity',
                contentWorkOrderId: 'work-order',
                unifiedContentBriefId: 'brief',
                ...expectedProvenance
            },
            opportunityDecision,
            workOrder,
            brief,
            googleSnapshot,
            contentOperationsSnapshot,
            inventorySnapshot,
            expected: expectedProvenance
        });
        expect(lineage).toMatchObject({
            valid: true,
            summary: { id: 'planning-run', status: 'completed', provenanceClass: 'qa_exact' }
        });
        expect(buildContentOperationsRunLineage({
            opportunityDecision: { _id: 'opportunity' },
            workOrder: { _id: 'work-order', metadata: {} },
            brief: { _id: 'brief' }
        })).toMatchObject({
            valid: true,
            requiredArtifactMissing: false,
            summary: { status: 'not_applicable', provenanceClass: 'not_applicable' }
        });
    });

    it('rejects QA keys placed in ordinary Content Operations planning input', async () => {
        const GoogleService = { ensureGoogleIntelligenceSnapshotForDate: vi.fn() };
        const service = new ContentOperationsPlanningService({ GoogleService });

        await expect(service.plan({
            trigger: 'manual',
            input: { qaContext }
        })).rejects.toMatchObject({ code: 'QA_PROVENANCE_INPUT_FORBIDDEN' });
        expect(GoogleService.ensureGoogleIntelligenceSnapshotForDate).not.toHaveBeenCalled();
    });

    it('moves QA context across the internal planning boundary instead of leaving it in input', async () => {
        vi.stubEnv('CONTENT_OPERATIONS_ENABLED', 'true');
        const googleSnapshot = {
            id: '507f1f77bcf86cd799439110',
            snapshotDate: '2026-07-22',
            timezone: 'Asia/Ho_Chi_Minh',
            status: 'completed_no_change'
        };
        const plan = vi.spyOn(ContentOperationsPlanningService.prototype, 'plan').mockResolvedValue({
            googleSnapshot,
            contentOperationsSnapshot: null,
            workOrder: null,
            brief: null,
            topic: 'A bounded QA provenance topic',
            skipped: true,
            selectedOpportunity: { decisionReason: 'Mocked safe skip' }
        });

        await AgenticBlogCoreService.prepareContext({
            topic: qaContext.originalTopicSeed,
            primaryKeyword: 'qa provenance',
            articleType: 'technical-explainer',
            contentOperations: {
                mode: 'fixed_brief',
                draftOnly: true,
                qaContext
            }
        });

        expect(plan).toHaveBeenCalledWith(expect.objectContaining({
            trustedQaContext: expect.objectContaining(expectedProvenance),
            input: expect.not.objectContaining({ qaContext: expect.anything() })
        }));
    });

    it('labels a QA-created product catalog snapshot but reuses production first', async () => {
        vi.spyOn(ProductCatalogIntelligenceService, 'readSafeCatalog').mockResolvedValue([]);
        const findOne = vi.spyOn(ProductCatalogSnapshot, 'findOne')
            .mockReturnValueOnce({ sort: () => ({ lean: async () => null }) })
            .mockReturnValueOnce({ sort: () => ({ lean: async () => null }) });
        const create = vi.spyOn(ProductCatalogSnapshot, 'create').mockImplementation(async (document) => ({
            _id: '507f1f77bcf86cd799439104',
            ...document
        }));

        const result = await ProductCatalogIntelligenceService.ensureSnapshot({ now, trustedQaContext: qaContext });

        expect(findOne.mock.calls[0][0]).toMatchObject({ isQaTest: { $ne: true } });
        expect(findOne.mock.calls[1][0]).toMatchObject({
            isQaTest: true,
            qaBatchId: qaContext.qaBatchId,
            qaCaseId: qaContext.qaCaseId
        });
        expect(create).toHaveBeenCalledWith(expect.objectContaining(expectedProvenance));
        expect(result).toMatchObject({ ...expectedProvenance, catalogHash: hashSafeCatalog([]) });
    });

    it('scopes a Content Operations daily lease to its QA owner', async () => {
        const claimed = {
            _id: '507f1f77bcf86cd799439105',
            ...expectedProvenance,
            snapshotDate: '2026-07-22',
            timezone: 'Asia/Ho_Chi_Minh',
            status: 'building'
        };
        const SnapshotModel = {
            findOne: vi.fn(() => queryOf(null)),
            findOneAndUpdate: vi.fn(async () => claimed)
        };
        const service = new ContentOperationsIntelligenceService({
            SnapshotModel,
            config: {
                timezone: 'Asia/Ho_Chi_Minh',
                snapshotMaxAgeHours: 24,
                leaseMs: 60_000,
                leaseWaitMs: 0,
                leasePollMs: 1
            },
            now: () => now,
            sleep: vi.fn(async () => {})
        });

        const lease = await service.acquireLease({
            snapshotDate: '2026-07-22',
            now,
            force: false,
            trustedQaContext: qaContext
        });

        expect(SnapshotModel.findOne).toHaveBeenCalledWith(expect.objectContaining({
            isQaTest: true,
            qaBatchId: qaContext.qaBatchId,
            qaCaseId: qaContext.qaCaseId
        }));
        expect(SnapshotModel.findOneAndUpdate.mock.calls[0][1].$setOnInsert).toMatchObject(expectedProvenance);
        expect(lease.snapshotKey).toMatchObject({
            isQaTest: true,
            qaBatchId: qaContext.qaBatchId,
            qaCaseId: qaContext.qaCaseId
        });
    });

    it('labels both a QA inventory snapshot and every derivative inventory item', async () => {
        const claimed = {
            _id: '507f1f77bcf86cd799439106',
            ...expectedProvenance,
            snapshotDate: '2026-07-22',
            timezone: 'Asia/Ho_Chi_Minh',
            status: 'building',
            buildToken: 'qa-build-token',
            buildGeneration: 1,
            leaseUntil: new Date('2026-07-22T05:10:00.000Z')
        };
        const completed = { ...claimed, status: 'complete', checkedAt: now };
        const SnapshotModel = {
            findOne: vi.fn()
                .mockReturnValueOnce(queryOf(null))
                .mockImplementation(() => queryOf(claimed)),
            findOneAndUpdate: vi.fn()
                .mockReturnValueOnce(queryOf(claimed))
                .mockResolvedValueOnce(completed)
        };
        const BlogModel = {
            find: vi.fn(() => [{
                _id: '507f1f77bcf86cd799439107',
                blog_title: 'Production article',
                blog_slug: 'production-article',
                blog_excerpt: 'Safe summary',
                blog_content: '<h2>Verified structure</h2><p>Useful production content.</p>',
                sourceType: 'manual',
                isDraft: false,
                isPublished: true,
                updatedAt: now
            }])
        };
        const ItemModel = {
            bulkWrite: vi.fn(async () => ({ ok: 1 })),
            deleteMany: vi.fn(async () => ({ deletedCount: 0 }))
        };
        const service = new ContentInventoryService({
            BlogModel,
            SnapshotModel,
            ItemModel,
            productCatalogService: { readSafeCatalog: vi.fn(async () => []) },
            config: {
                timezone: 'Asia/Ho_Chi_Minh',
                leaseMs: 60_000,
                inventory: {
                    maxItems: 100,
                    maxAgeHours: 24,
                    staleDays: 180,
                    reviewDays: 90,
                    thinWordThreshold: 300
                }
            },
            now: () => now
        });

        await service.ensureSnapshotForDate({ now, trustedQaContext: qaContext });

        expect(BlogModel.find).toHaveBeenCalledWith({ isQaTest: { $ne: true } });
        expect(SnapshotModel.findOneAndUpdate.mock.calls[0][1].$setOnInsert).toMatchObject(expectedProvenance);
        const itemUpdate = ItemModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
        expect(itemUpdate).toMatchObject(expectedProvenance);
    });

    it('creates a scoped Google snapshot/run without mutating production baselines or changes', async () => {
        let snapshot = null;
        const SnapshotModel = {
            findOne: vi.fn(() => queryOf(null)),
            findOneAndUpdate: vi.fn((_filter, update) => {
                if (update.$inc?.buildGeneration) {
                    snapshot = {
                        _id: '507f1f77bcf86cd799439108',
                        ...update.$setOnInsert,
                        ...update.$set,
                        buildGeneration: 1
                    };
                } else {
                    snapshot = { ...snapshot, ...update.$set };
                }
                return queryOf(snapshot);
            }),
            updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
        };
        const SourceModel = {
            find: vi.fn(() => queryOf([])),
            updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
        };
        const RunModel = {
            findOneAndUpdate: vi.fn((_filter, update) => queryOf({
                _id: '507f1f77bcf86cd799439109',
                ...update.$set,
                buildToken: update.$set.buildToken,
                snapshotGeneration: 1
            })),
            updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
        };
        const ChangeModel = { updateOne: vi.fn() };
        const seedDefaultSources = vi.fn();

        const result = await GoogleIntelligenceService.executeWorkflow({
            now,
            trustedQaContext: qaContext
        }, {
            SnapshotModel,
            SourceModel,
            RunModel,
            ChangeModel,
            seedDefaultSources,
            buildHeartbeatFactory: () => ({
                beat: vi.fn(async () => true),
                stop: vi.fn(async () => undefined),
                ownershipLost: vi.fn(() => false)
            }),
            clock: () => now,
            config: {
                enabled: true,
                timezone: 'Asia/Ho_Chi_Minh',
                strictGate: false,
                maxSnapshotAgeHours: 24,
                sourceTimeoutMs: 15_000,
                retryCount: 0,
                retryDelayMs: 100,
                sourceGroups: []
            }
        });

        expect(result.snapshot).toMatchObject(expectedProvenance);
        expect(SnapshotModel.findOneAndUpdate.mock.calls[0][1].$setOnInsert).toMatchObject(expectedProvenance);
        expect(RunModel.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject(expectedProvenance);
        expect(RunModel.findOneAndUpdate.mock.calls[0][0].executionKey).toContain('qa:local');
        expect(seedDefaultSources).not.toHaveBeenCalled();
        expect(SourceModel.updateOne).not.toHaveBeenCalled();
        expect(ChangeModel.updateOne).not.toHaveBeenCalled();
    });
});
