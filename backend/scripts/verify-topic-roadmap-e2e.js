'use strict'

const assert = require('node:assert/strict')
const mongoose = require('mongoose')

const { BlogAutomationSchedule } = require('../src/models/blogAutomationSchedule.model')
const { BlogAutomationExecution } = require('../src/models/blogAutomationExecution.model')
const { BlogTopicRoadmap } = require('../src/models/blogTopicRoadmap.model')
const { BlogTopicRoadmapItem } = require('../src/models/blogTopicRoadmapItem.model')
const { BlogTopicRoadmapService } = require('../src/services/contentOperations/blogTopicRoadmap.service')
const { BlogDirectionInterpreterService } = require('../src/services/contentOperations/blogDirectionInterpreter.service')
const { ProductTopicCoverageService } = require('../src/services/contentOperations/productTopicCoverage.service')

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI || !/^mongodb:\/\/(?:127\.0\.0\.1|localhost):37028\//.test(MONGODB_URI)) {
    throw new Error('This verification script only accepts the isolated local MongoDB on port 37028')
}

const objectId = () => new mongoose.Types.ObjectId()
const now = new Date('2026-07-25T08:00:00.000Z')
const safeProducts = [
    {
        productId: String(objectId()), sku: 'INOX-24', name: 'Nồi inox 24 cm', slug: 'noi-inox-24',
        category: { id: 'Inoxs', name: 'Inox' }, status: 'active', availability: 'in_stock', eligible: true,
        materials: ['inox'], verifiedFeatures: ['đáy nhiều lớp'], supportedUseCases: ['nấu canh'], compatibility: ['bếp từ']
    },
    {
        productId: String(objectId()), sku: 'GANG-26', name: 'Chảo gang 26 cm', slug: 'chao-gang-26',
        category: { id: 'CastIrons', name: 'Gang' }, status: 'active', availability: 'in_stock', eligible: true,
        materials: ['gang'], verifiedFeatures: ['giữ nhiệt'], supportedUseCases: ['áp chảo'], compatibility: ['bếp gas']
    },
    {
        productId: String(objectId()), sku: 'ELEC-18', name: 'Nồi cơm điện 1,8 lít', slug: 'noi-com-dien-18',
        category: { id: 'Electronics', name: 'Gia dụng điện' }, status: 'active', availability: 'in_stock', eligible: true,
        verifiedFeatures: ['hẹn giờ'], supportedUseCases: ['nấu cơm gia đình'], compatibility: ['điện 220V']
    }
]

const contentSnapshot = {
    _id: objectId(), id: String(objectId()), googleIntelSnapshotId: String(objectId()),
    contentInventorySnapshotId: objectId(), sourceHealth: [], sourceFreshness: {},
    websitePerformance: {}, opportunitySignals: [], businessSignals: {}
}

const IntelligenceService = {
    ensureContentOperationsSnapshotForDate: async () => ({ snapshot: contentSnapshot, disabled: false })
}
const GoogleService = {
    ensureGoogleIntelligenceSnapshotForDate: async () => ({ _id: contentSnapshot.googleIntelSnapshotId, status: 'completed_no_change' })
}
const ProductCatalogService = {
    ensureSnapshot: async () => ({ _id: objectId(), catalogHash: 'catalog-e2e-hash', safeProducts })
}
const MarketResearchService = {
    ensureSnapshot: async () => ({
        _id: objectId(), status: 'partial', snapshotHash: 'market-e2e-hash', generatedAt: now,
        sourceHealth: { configured: 1, attempted: 1, succeeded: 1, failed: 0 },
        sources: [{ sourceId: 'market-1', canonicalUrl: 'https://example.com/housewares', status: 'available', fetchedAt: now }],
        signals: [{
            sourceId: 'market-1', signalHash: 'market-signal-1', topic: 'Gia đình quan tâm lựa chọn đồ bếp phù hợp',
            snippet: 'Nguồn công khai ghi nhận nhu cầu lựa chọn đồ bếp theo tình huống gia đình.', sourceDate: now,
            confidence: 'medium', classification: 'observed'
        }]
    })
}
const DirectionInterpreterService = {
    interpret: (input) => BlogDirectionInterpreterService.interpret({ ...input, env: {}, preferLlm: false })
}
const ProductCoverageService = {
    build: (input) => ProductTopicCoverageService.build(input)
}

const ideationService = async ({ directionInterpretation, productCoverage, maxIdeas }) => {
    const cards = productCoverage.cards || []
    const axes = directionInterpretation.scopeMode === 'narrow'
        ? ['choice', 'compatibility', 'use', 'care', 'safety', 'lifecycle']
        : ['choice', 'care', 'use', 'safety', 'compatibility', 'lifecycle', 'comparison', 'seasonal']
    const ideas = []
    for (let index = 0; index < Math.min(maxIdeas, 8); index += 1) {
        const card = cards[index % Math.max(1, cards.length)]
        const focus = card?.name || directionInterpretation.focusTerms?.[0] || 'đời sống bếp Việt'
        const axis = axes[index % axes.length]
        const generation = Math.max(1, Number(productCoverage.generation || 1))
        const scenarios = [
            'căn hộ nhỏ và bữa sáng ngày thường',
            'gia đình nhiều thế hệ chuẩn bị mâm cơm cuối tuần',
            'người mới lập gia đình tối ưu gian bếp đầu tiên',
            'nhà có trẻ nhỏ cần thao tác an toàn dễ kiểm soát',
            'người cao tuổi ưu tiên cách dùng đơn giản ít sức',
            'gia đình bận rộn chuẩn bị thực phẩm cho cả tuần'
        ]
        const scenario = scenarios[(generation + index - 1) % scenarios.length]
        ideas.push({
            ideaId: `e2e-${generation}-${axis}-${index}`,
            topic: `${focus} trong bối cảnh ${scenario}: hướng tiếp cận ${axis}`,
            angle: `Giải quyết nhu cầu của ${scenario} bằng dữ kiện xác minh theo trục ${axis}`,
            primaryQuestion: `${scenario} nên đánh giá ${focus} như thế nào theo góc ${axis}?`,
            primaryKeyword: `${focus} ${axis}`,
            keywords: [focus, axis],
            categoryKey: axis === 'care' ? 'care' : axis === 'safety' ? 'knowledge' : 'guide',
            productScope: card?.categoryKey === 'CastIrons' ? 'gang' : card?.categoryKey === 'Electronics' ? 'dien' : 'inox',
            topicAxis: axis,
            searchIntent: axis === 'choice' ? 'commercial' : 'informational',
            articleType: 'practical-guide',
            targetAudience: ['Gia đình Việt'],
            userProblems: [`Cần thông tin ${axis}`],
            productIds: card ? [card.productId] : [],
            productEvidenceKeys: card?.evidenceKeys || [],
            marketEvidenceIds: ['market-signal-1'],
            sourceSignals: ['market-signal-1'],
            rationale: 'Candidate E2E có evidence và khác intent.',
            userDemandScore: 0.92,
            contentGapScore: 0.94,
            businessScore: 0.85,
            freshnessScore: 0.88,
            productFitScore: 0.9,
            evidenceScore: 0.95,
            userValueScore: 0.95
        })
    }
    return { ideas, source: 'e2e-safe-stub', model: null }
}

const service = new BlogTopicRoadmapService({
    RoadmapModel: BlogTopicRoadmap,
    ItemModel: BlogTopicRoadmapItem,
    ScheduleModel: BlogAutomationSchedule,
    ExecutionModel: BlogAutomationExecution,
    InventoryItemModel: { find: () => ({ limit() { return this }, lean: async () => [] }) },
    GoogleService,
    IntelligenceService,
    ProductCatalogService,
    DirectionInterpreterService,
    ProductCoverageService,
    MarketResearchService,
    ideationService,
    config: {
        enabled: false,
        timezone: 'Asia/Ho_Chi_Minh',
        minimumOpportunityScore: 0.65,
        opportunitySkipThreshold: 0.65,
        minimumUserValueScore: 0.2,
        opportunityWeights: {
            userDemand: 0.2, contentGap: 0.2, business: 0.15, freshness: 0.1,
            productCampaign: 0.15, evidence: 0.1, userValue: 0.1
        },
        opportunityPenalties: { cannibalization: 0.2, weakEvidence: 0.25, staleProductData: 0.2, lowConfidence: 0.15 },
        inventory: { maxItems: 100 },
        topicRoadmap: {
            enabled: true, minimumReady: 3, targetReady: 6, maxCandidatesPerRefill: 12,
            refillLeaseMs: 60_000, claimLeaseMs: 60_000, maxClaimAttempts: 3, similarityThreshold: 0.88,
            marketResearch: { enabled: true }
        }
    }
})

const scheduleDocument = (direction, name) => ({
    name,
    description: direction,
    enabled: true,
    scheduleType: 'daily',
    timezone: 'Asia/Ho_Chi_Minh',
    daily: { times: ['08:30'] },
    autoPublish: false,
    draftOnly: true,
    mode: 'best_action',
    agentConfig: { simpleContract: true, topicRoadmapEnabled: true, direction }
})

const createRunningExecutions = async (scheduleId, count, prefix) => Promise.all(
    Array.from({ length: count }, (_, index) => BlogAutomationExecution.create({
        scheduleId,
        executionKey: `${prefix}-${index}`,
        status: 'running',
        startedAt: now,
        mode: 'draft'
    }))
)

const main = async () => {
    await mongoose.connect(MONGODB_URI, { autoIndex: true, serverSelectionTimeoutMS: 5_000 })
    await mongoose.connection.dropDatabase()
    await Promise.all([
        BlogAutomationSchedule.init(), BlogAutomationExecution.init(),
        BlogTopicRoadmap.init(), BlogTopicRoadmapItem.init()
    ])

    const broad = await BlogAutomationSchedule.create(scheduleDocument(
        'Mở rộng đa dạng nhiều chủ đề gia dụng cho toàn bộ danh mục',
        'E2E broad roadmap'
    ))
    const broadFill = await service.ensureReadyBuffer({ scheduleId: broad._id, reason: 'e2e_broad' })
    assert.ok(broadFill.readyCount >= 3)
    const broadView = await service.getRoadmap({ scheduleId: broad._id })
    assert.equal(broadView.roadmap.interpretation.scopeMode, 'broad')
    assert.ok(new Set(broadView.items.filter((item) => item.status === 'ready').map((item) => item.topic)).size >= 3)
    assert.ok(!JSON.stringify(broadView).includes('claimToken'))
    assert.ok(!JSON.stringify(broadView).includes('catalogEvidenceHash'))

    const broadExecutions = await createRunningExecutions(broad._id, 3, 'broad-execution')
    const broadClaims = await Promise.all(broadExecutions.map((execution) => service.claimNext({
        scheduleId: broad._id,
        executionId: execution._id
    })))
    assert.equal(new Set(broadClaims.map((claim) => claim.itemId)).size, 3)
    assert.equal(new Set(broadClaims.map((claim) => claim.topic)).size, 3)
    assert.ok(broadClaims.every((claim) => claim.claimToken))

    const hiddenClaim = await BlogTopicRoadmapItem.findById(broadClaims[0].itemId).lean()
    const selectedClaim = await BlogTopicRoadmapItem.findById(broadClaims[0].itemId).select('+claimToken').lean()
    assert.equal(hiddenClaim.claimToken, undefined)
    assert.equal(selectedClaim.claimToken, broadClaims[0].claimToken)

    await service.completeClaim({ context: broadClaims[0], blogId: objectId() })
    await service.failClaim({
        context: broadClaims[1],
        error: Object.assign(new Error('lease lost'), { code: 'SCHEDULE_EXECUTION_FENCE_LOST' })
    })
    const firstCompleted = await BlogTopicRoadmapItem.findById(broadClaims[0].itemId).lean()
    const secondRequeued = await BlogTopicRoadmapItem.findById(broadClaims[1].itemId).lean()
    assert.equal(firstCompleted.status, 'completed')
    assert.equal(secondRequeued.status, 'ready')

    const readyToDismiss = await BlogTopicRoadmapItem.findOne({ scheduleId: broad._id, status: 'ready' }).lean()
    await service.dismiss({ scheduleId: broad._id, itemId: readyToDismiss._id, reason: 'e2e_dismiss' })
    assert.equal((await BlogTopicRoadmapItem.findById(readyToDismiss._id).lean()).status, 'dismissed')

    const narrow = await BlogAutomationSchedule.create(scheduleDocument(
        'Chỉ tập trung đào sâu Nồi inox 24 cm mã INOX-24',
        'E2E narrow roadmap'
    ))
    await service.ensureReadyBuffer({ scheduleId: narrow._id, reason: 'e2e_narrow' })
    const narrowView = await service.getRoadmap({ scheduleId: narrow._id })
    assert.equal(narrowView.roadmap.interpretation.scopeMode, 'narrow')
    const narrowReady = narrowView.items.filter((item) => item.status === 'ready')
    assert.ok(narrowReady.length >= 3)
    assert.ok(narrowReady.every((item) => /Nồi inox 24 cm/i.test(`${item.topic} ${item.angle}`)))
    assert.ok(new Set(narrowReady.map((item) => item.primaryQuestion)).size >= 3)

    const beforeRevision = narrowView.roadmap.directionRevision
    narrow.description = 'Chỉ tập trung sâu về Chảo gang 26 cm mã GANG-26'
    narrow.agentConfig = { ...narrow.agentConfig, direction: narrow.description }
    await narrow.save()
    await service.ensureReadyBuffer({ scheduleId: narrow._id, reason: 'e2e_direction_change' })
    const revised = await service.getRoadmap({ scheduleId: narrow._id })
    assert.equal(revised.roadmap.directionRevision, beforeRevision + 1)
    assert.ok(revised.items.some((item) => item.status === 'invalidated'))
    assert.equal(revised.roadmap.interpretation.scopeMode, 'narrow')
    assert.ok(revised.items.filter((item) => item.status === 'ready').every((item) => /Chảo gang 26 cm/i.test(`${item.topic} ${item.angle}`)))

    const regenerateAdminId = String(objectId())
    const regenerated = await service.regenerate({
        scheduleId: narrow._id,
        reason: 'e2e_regenerate',
        idempotencyKey: 'e2e-regenerate-0001',
        adminId: regenerateAdminId
    })
    const regeneratedAgain = await service.regenerate({
        scheduleId: narrow._id,
        reason: 'e2e_regenerate',
        idempotencyKey: 'e2e-regenerate-0001',
        adminId: regenerateAdminId
    }).catch(() => null)
    assert.ok(regenerated.roadmap)
    assert.ok(regeneratedAgain === null || regeneratedAgain.roadmap)

    const indexes = await BlogTopicRoadmapItem.collection.indexes()
    const uniqueIndex = indexes.find((index) => index.unique && index.key.scheduleId === 1 && index.key.uniquenessKey === 1)
    assert.ok(uniqueIndex)

    console.log(JSON.stringify({
        ok: true,
        broad: {
            scopeMode: broadView.roadmap.interpretation.scopeMode,
            initialReady: broadFill.readyCount,
            claimedTopics: broadClaims.map((claim) => claim.topic),
            uniqueClaims: new Set(broadClaims.map((claim) => claim.itemId)).size
        },
        narrow: {
            scopeMode: narrowView.roadmap.interpretation.scopeMode,
            readyTopics: narrowReady.map((item) => item.topic),
            directionRevision: revised.roadmap.directionRevision
        },
        mongoose: {
            claimTokenHiddenByDefault: hiddenClaim.claimToken === undefined,
            uniqueIndex: uniqueIndex.name
        }
    }, null, 2))
}

main()
    .finally(async () => {
        await mongoose.disconnect()
    })
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
