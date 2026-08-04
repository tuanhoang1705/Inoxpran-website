import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  BlogTopicRoadmapService,
  hasValidTopicScoreIntegrity,
  mapMarketEvidence,
  mapProductEvidence,
  marketSourceHealthEntries,
  safeItemView,
  safeRegenerationView,
  scopeCoverageForInterpretation,
  uniquenessKeyFor
} = require('../src/services/contentOperations/blogTopicRoadmap.service');
const {
  EVIDENCE_ALIGNMENT_VERSION,
  assessTopicEvidenceAlignment,
  buildTopicScoreHash,
  RUBRIC_VERSION
} = require('../src/services/contentOperations/topicRoadmapScoring.service');
const { INDEX_VERSION } = require('../src/services/contentOperations/blogNoveltyIndex.service');
const { SOURCE_RELEVANCE_VERSION } = require('../src/services/contentOperations/sourceRelevanceScoring.service');
const { BlogTopicRoadmapItem } = require('../src/models/blogTopicRoadmapItem.model');

const ids = {
  schedule: '66d0f5b5e3d6a4a1b2c3d401',
  executionA: '66d0f5b5e3d6a4a1b2c3d402',
  executionB: '66d0f5b5e3d6a4a1b2c3d403',
  roadmap: '66d0f5b5e3d6a4a1b2c3d404',
  itemA: '66d0f5b5e3d6a4a1b2c3d405',
  itemB: '66d0f5b5e3d6a4a1b2c3d406'
};

const getPath = (doc, path) => path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), doc);

// Minimal evaluator for the subset of Mongo query operators claimableReadyMatch uses,
// so a test can assert the predicate rejects stale items without a live database.
const matchesCondition = (value, condition) => {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return value === condition;
  return Object.entries(condition).every(([op, operand]) => {
    if (op === '$gte') return Number(value) >= Number(operand);
    if (op === '$gt') return Number(value) > Number(operand);
    if (op === '$lt') return Number(value) < Number(operand);
    if (op === '$ne') return value !== operand;
    if (op === '$type') return operand === 'string' ? typeof value === 'string' : true;
    if (op === '$regex') return operand.test(String(value || ''));
    if (op === '$elemMatch') {
      return Array.isArray(value) && value.some((entry) =>
        Object.entries(operand).every(([key, nested]) => matchesCondition(entry?.[key], nested))
      );
    }
    throw new Error(`Unsupported operator in test matcher: ${op}`);
  });
};

const matchesMongoQuery = (doc, query) =>
  Object.entries(query).every(([key, condition]) => {
    if (key === 'roadmapId') return true; // identity field, not part of the claimability logic under test
    const value = getPath(doc, key);
    return matchesCondition(value, condition);
  });

const query = (value) => ({
  select() { return this; },
  sort() { return this; },
  limit() { return this; },
  lean: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
});

const regenerationHarness = () => {
  const jobs = [];
  let updateFilter = null;
  const RegenerationModel = {
    findOne(filter) {
      const found = jobs.find((job) => {
        if (Array.isArray(filter.$or)) return filter.$or.some((condition) => (
          condition.idempotencyKeyHash
            ? job.idempotencyKeyHash === condition.idempotencyKeyHash
            : (job.coalescedIdempotencyKeyHashes || []).includes(condition.coalescedIdempotencyKeyHashes)
        ));
        return job.activeFence === filter.activeFence && filter.status.$in.includes(job.status);
      });
      return query(found || null);
    },
    async create(document) {
      const created = { _id: `regen-${jobs.length + 1}`, ...document, createdAt: new Date() };
      jobs.push(created);
      return created;
    },
    findOneAndUpdate(filter, update) {
      updateFilter = filter;
      const claimed = jobs.find((job) => {
        if (filter._id && String(job._id) !== String(filter._id)) return false;
        if (filter.roadmapId && job.roadmapId !== filter.roadmapId) return false;
        if (filter.activeFence !== undefined && job.activeFence !== filter.activeFence) return false;
        if (typeof filter.status === 'string' && job.status !== filter.status) return false;
        if (filter.status?.$in && !filter.status.$in.includes(job.status)) return false;
        if (filter.leaseTokenHash && job.leaseTokenHash !== filter.leaseTokenHash) return false;
        if (filter.leaseExpiresAt?.$gt && (!job.leaseExpiresAt || new Date(job.leaseExpiresAt).getTime() <= filter.leaseExpiresAt.$gt.getTime())) return false;
        if (filter.$and) {
          return !job.leaseExpiresAt || new Date(job.leaseExpiresAt).getTime() <= filter.$and[1].$or[2].leaseExpiresAt.$lte.getTime();
        }
        if (filter.coalescedIdempotencyKeyHashes?.$ne && (job.coalescedIdempotencyKeyHashes || []).includes(filter.coalescedIdempotencyKeyHashes.$ne)) return false;
        return true;
      });
      if (!claimed) return query(null);
      Object.assign(claimed, update.$set);
      if (update.$unset) {
        for (const key of Object.keys(update.$unset)) delete claimed[key];
      }
      if (update.$addToSet?.coalescedIdempotencyKeyHashes) {
        claimed.coalescedIdempotencyKeyHashes = [...new Set([
          ...(claimed.coalescedIdempotencyKeyHashes || []),
          update.$addToSet.coalescedIdempotencyKeyHashes
        ])];
      }
      claimed.attemptCount = Number(claimed.attemptCount || 0) + Number(update.$inc?.attemptCount || 0);
      return query({ ...claimed });
    },
    updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    findById: () => query(null)
  };
  const RoadmapModel = {
    findOne: () => query({ ...roadmap, activeEpoch: 'epoch-old', epochMigrationComplete: true }),
    updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
  };
  const service = new BlogTopicRoadmapService({
    RoadmapModel,
    ItemModel: { updateMany: vi.fn() },
    ScheduleModel: { findById: () => query(schedule) },
    ExecutionModel: {},
    DirectionInterpreterService: {}, ProductCoverageService: {}, MarketResearchService: {},
    RegenerationModel,
    config: { topicRoadmap: { regenerationLeaseMs: 60_000, regenerationMaxAttempts: 5 } },
    randomUUID: () => 'worker-lease-token'
  });
  service.initialize = vi.fn(async () => ({ ...roadmap, activeEpoch: 'epoch-old', epochMigrationComplete: true }));
  return { service, jobs, RegenerationModel, RoadmapModel, getUpdateFilter: () => updateFilter };
};

const schedule = {
  _id: ids.schedule,
  isQaTest: false,
  timezone: 'Asia/Ho_Chi_Minh',
  description: 'Mở rộng nhiều chủ đề gia dụng',
  agentConfig: { simpleContract: true, direction: 'Mở rộng nhiều chủ đề gia dụng' }
};
const roadmap = {
  _id: ids.roadmap,
  scheduleId: ids.schedule,
  direction: schedule.agentConfig.direction,
  directionHash: require('node:crypto').createHash('sha256').update(schedule.agentConfig.direction).digest('hex'),
  directionRevision: 1,
  generation: 1,
  activeEpoch: 'epoch-current',
  epochMigrationComplete: true,
  status: 'ready',
  minimumReady: 1,
  targetReady: 2,
  readyCount: 2
};

const item = (id, rank) => {
  const candidateId = `candidate-${rank}`;
  const topic = `Cách chọn nồi inox khác biệt ${rank}`;
  const angle = `Kinh nghiệm lựa chọn nồi inox cho nhu cầu ${rank}`;
  const primaryKeyword = `chọn nồi inox ${rank}`;
  const primaryQuestion = `Gia đình nên chọn nồi inox thế nào cho nhu cầu ${rank}?`;
  const idea = {
    topic,
    angle,
    primaryKeyword,
    primaryQuestion,
    supportingQuestions: [],
    keywords: [],
    userProblems: [],
    searchIntent: 'informational',
    topicAxis: ''
  };
  const marketEvidence = [{
    evidenceId: `evidence-${rank}`,
    sourceId: `source-${rank}`,
    contentHash: String(rank).repeat(64),
    relevanceVersion: SOURCE_RELEVANCE_VERSION,
    relevanceScore: 0.9,
    confidence: 0.9,
    classification: 'observed',
    title: 'Cách chọn nồi inox phù hợp cho gia đình',
    snippet: 'Kinh nghiệm lựa chọn nồi inox theo nhu cầu sử dụng thực tế.',
    observedAt: new Date('2026-07-20T00:00:00.000Z')
  }];
  const evidenceAlignment = assessTopicEvidenceAlignment({
    idea,
    sourceEvidence: marketEvidence,
    productEvidence: []
  });
  const scores = {
    totalScore: 92,
    noveltySubtotal: 58,
    rubricVersion: RUBRIC_VERSION,
    corpusVersion: INDEX_VERSION,
    corpusHash: 'corpus-hash',
    corpusCount: 100,
    semanticCalibration: {
      version: 'text-embedding-3-large-cosine-v1',
      floor: 0.35,
      ceiling: 0.9,
      rawTopicSimilarity: 0.41,
      rawPlanSimilarity: 0.43,
      calibratedTopicCollision: 0.109091,
      calibratedPlanCollision: 0.145455
    },
    hardGates: {
      corpusVersion: true,
      score: true,
      novelty: true,
      sameIntent: true,
      direction: true,
      sources: true,
      products: true,
      evidenceAlignment: true
    },
    hardGatesPassed: true,
    scoreBreakdown: {},
    trustedSignals: {
      productEvidenceRequired: false,
      evidenceAlignment
    },
    nearestCollisions: {},
    reasonCodes: []
  };
  scores.scoreHash = buildTopicScoreHash({
    idea,
    candidateId,
    sourceEvidence: marketEvidence,
    productEvidence: [],
    report: scores
  });
  return {
    _id: id,
    roadmapId: ids.roadmap,
    scheduleId: ids.schedule,
    directionRevision: 1,
    generation: 1,
    activationEpoch: 'epoch-current',
    rank,
    status: 'ready',
    attemptCount: 0,
    topic,
    angle,
    primaryKeyword,
    secondaryKeywords: [],
    primaryQuestion,
    supportingQuestions: [],
    targetAudience: [],
    userProblems: [],
    searchIntent: 'informational',
    articleType: 'practical-guide',
    categoryKey: 'guide',
    productEvidence: [],
    marketEvidence,
    scores,
    candidateProvenance: { candidateId }
  };
};

const claimHarness = () => {
  const items = [item(ids.itemA, 1), item(ids.itemB, 2)];
  const executions = new Set([ids.executionA, ids.executionB]);
  const ScheduleModel = { findById: () => query(schedule) };
  const ExecutionModel = {
    findOne(filter) {
      return query(executions.has(String(filter._id)) ? { _id: String(filter._id), scheduleId: ids.schedule, status: 'running' } : null);
    }
  };
  const RoadmapModel = {
    findOne: () => query(roadmap),
    updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 })
  };
  const ItemModel = {
    findOne(filter) {
      const found = items.find((entry) => entry.status === filter.status && entry.claimExecutionId === String(filter.claimExecutionId));
      return query(found || null);
    },
    findOneAndUpdate(filter, update, options) {
      return {
        select() { return this; },
        lean: async () => {
          const ready = items
            .filter((entry) => entry.status === 'ready' && entry.directionRevision === filter.directionRevision)
            .sort((left, right) => left.rank - right.rank)[0];
          if (!ready) return null;
          Object.assign(ready, update.$set);
          ready.attemptCount += Number(update.$inc?.attemptCount || 0);
          return { ...ready };
        }
      };
    },
    updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))
  };
  const service = new BlogTopicRoadmapService({
    RoadmapModel,
    ItemModel,
    ScheduleModel,
    ExecutionModel,
    DirectionInterpreterService: {},
    ProductCoverageService: {},
    MarketResearchService: {},
    config: { topicRoadmap: { claimLeaseMs: 60_000, maxClaimAttempts: 3 } },
    randomUUID: (() => { let n = 0; return () => `claim-${++n}`; })()
  });
  return { service, items };
};

describe('rolling Blog topic roadmap service', () => {
  it('builds stable uniqueness from topic + angle + reader question', () => {
    const first = uniquenessKeyFor({ topic: 'Nồi gang', angle: 'Chọn mua', primaryQuestion: 'Chọn thế nào?' });
    const same = uniquenessKeyFor({ topic: '  nồi GANG ', angle: 'chọn mua', primaryQuestion: 'Chọn thế nào?' });
    const distinct = uniquenessKeyFor({ topic: 'Nồi gang', angle: 'Bảo quản', primaryQuestion: 'Vệ sinh ra sao?' });
    expect(first).toBe(same);
    expect(first).not.toBe(distinct);
  });

  it('clears direction-derived state when a manager edits the brief', async () => {
    const previous = {
      ...roadmap,
      direction: 'Brief cũ',
      directionHash: 'old-direction-hash',
      interpretation: { normalizedGoal: 'Mục tiêu cũ', focusTerms: ['cũ'] },
      lastRefillAt: new Date('2026-08-03T00:00:00.000Z'),
      lastOutcomeCode: 'ROADMAP_NO_ACCEPTABLE_TOPIC',
      productCatalogSnapshotId: '66d0f5b5e3d6a4a1b2c3d410',
      contentOperationsSnapshotId: '66d0f5b5e3d6a4a1b2c3d411',
      contentInventorySnapshotId: '66d0f5b5e3d6a4a1b2c3d412',
      marketSnapshotId: '66d0f5b5e3d6a4a1b2c3d413',
      latestIdeationRunId: '66d0f5b5e3d6a4a1b2c3d414',
      latestRegenerationId: '66d0f5b5e3d6a4a1b2c3d415',
      sourceHealth: [{ source: 'old', status: 'ready' }]
    };
    const editedSchedule = {
      ...schedule,
      description: 'Brief mới',
      agentConfig: { ...schedule.agentConfig, direction: 'Brief mới' }
    };
    let roadmapUpdate;
    const RoadmapModel = {
      findOne: () => query(previous),
      findOneAndUpdate: vi.fn(async (filter, update) => {
        roadmapUpdate = { filter, update };
        return {
          ...previous,
          ...update.$set,
          directionRevision: previous.directionRevision + update.$inc.directionRevision
        };
      })
    };
    const ItemModel = { updateMany: vi.fn(async () => ({ modifiedCount: 1 })) };
    const service = new BlogTopicRoadmapService({
      RoadmapModel,
      ItemModel,
      ScheduleModel: {},
      ExecutionModel: {},
      DirectionInterpreterService: {},
      ProductCoverageService: {},
      MarketResearchService: {},
      config: { topicRoadmap: {} }
    });

    const revised = await service.initialize({ schedule: editedSchedule });

    expect(revised.direction).toBe('Brief mới');
    expect(revised.directionRevision).toBe(2);
    expect(roadmapUpdate.update.$set).toMatchObject({
      interpretation: {},
      status: 'needs_refill',
      readyCount: 0,
      lastRefillAt: null,
      lastOutcomeCode: '',
      sourceHealth: []
    });
    expect(roadmapUpdate.update.$set.productCatalogSnapshotId).toBeNull();
    expect(roadmapUpdate.update.$set.latestRegenerationId).toBeNull();
    expect(ItemModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ directionRevision: { $lt: 2 }, status: 'ready' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'invalidated', reasonCode: 'direction_changed' }) })
    );
  });

  it('keeps only catalog and market evidence IDs that exist in trusted inputs', () => {
    const productEvidence = mapProductEvidence({
      idea: { productIds: ['p1', 'invented'], productEvidenceKeys: ['p1:material', 'fake:key'] },
      catalogHash: 'catalog-hash',
      coverageCards: [{
        productId: 'p1', sku: 'SKU-1', name: 'Nồi inox', slug: 'noi-inox', categoryKey: 'Inoxs',
        coverageGaps: ['chưa có bài bảo quản'], evidenceKeys: ['p1:material'], evidenceHash: 'p1-hash'
      }]
    });
    expect(productEvidence).toHaveLength(1);
    expect(productEvidence[0].productId).toBe('p1');
    expect(productEvidence[0].factKeys).toEqual(['p1:material']);

    const { SOURCE_RELEVANCE_VERSION } = require('../src/services/contentOperations/sourceRelevanceScoring.service');
    const marketEvidence = mapMarketEvidence({
      idea: { marketEvidenceIds: ['m1', 'invented', 'irrelevant'] },
      marketSignals: [
        {
          evidenceId: 'm1', sourceId: 'm1', contentHash: 'a'.repeat(64), title: 'Observed signal', snippet: 'Qualitative evidence', canonicalUrl: 'https://example.com/source',
          relevance: { version: SOURCE_RELEVANCE_VERSION, totalScore: 0.9, eligibleForIdeation: true }
        },
        {
          evidenceId: 'irrelevant', sourceId: 'irrelevant', contentHash: 'b'.repeat(64), title: 'Tô Lâm', canonicalUrl: 'https://example.com/x',
          relevance: { version: SOURCE_RELEVANCE_VERSION, totalScore: 0.1, eligibleForIdeation: false }
        }
      ]
    });
    expect(marketEvidence).toHaveLength(1);
    expect(marketEvidence[0].evidenceId).toBe('m1');
    expect(marketEvidence[0].sourceId).toBe('m1');
  });

  it('normalizes market source health objects into bounded roadmap records', () => {
    const health = marketSourceHealthEntries({
      status: 'partial',
      generatedAt: new Date('2026-07-25T00:00:00Z'),
      sourceHealth: { configured: 2, attempted: 2, succeeded: 1, failed: 1 },
      sources: [
        { sourceId: 'good', status: 'available', fetchedAt: new Date('2026-07-25T00:00:00Z') },
        { sourceId: 'bad', status: 'failed', errorCode: 'timeout', fetchedAt: new Date('2026-07-25T00:00:00Z') }
      ]
    });
    expect(health).toHaveLength(3);
    expect(health[0]).toMatchObject({ source: 'housewares_market_web', status: 'partial' });
    expect(health[2]).toMatchObject({ source: 'bad', status: 'failed', detail: 'timeout' });
  });

  it('filters narrow coverage cards to matching SKU/product facts', () => {
    const coverage = {
      cards: [
        { productId: 'gang', sku: 'NG-24', name: 'Nồi gang 24 cm', categoryKey: 'CastIrons', materials: ['gang'] },
        { productId: 'rice', sku: 'RC-18', name: 'Nồi cơm điện 1,8 lít', categoryKey: 'Electronics' }
      ],
      promptCards: []
    };
    coverage.promptCards = coverage.cards;
    const scoped = scopeCoverageForInterpretation(coverage, { scopeMode: 'narrow', focusTerms: ['nồi gang', 'NG-24'] });
    expect(scoped.cards.map((entry) => entry.productId)).toEqual(['gang']);
  });

  it('atomically gives two active executions two different roadmap items', async () => {
    const { service, items } = claimHarness();
    const [left, right] = await Promise.all([
      service.claimNext({ scheduleId: ids.schedule, executionId: ids.executionA }),
      service.claimNext({ scheduleId: ids.schedule, executionId: ids.executionB })
    ]);
    expect(new Set([left.itemId, right.itemId]).size).toBe(2);
    expect(left.claimToken).toBeTruthy();
    expect(right.claimToken).toBeTruthy();
    expect(items.every((entry) => entry.status === 'claimed')).toBe(true);
  });

  it('excludes stale-rubric ready items from the claimable buffer count', () => {
    const { RUBRIC_VERSION } = require('../src/services/contentOperations/topicRoadmapScoring.service');
    const { INDEX_VERSION } = require('../src/services/contentOperations/blogNoveltyIndex.service');
    const service = new BlogTopicRoadmapService({
      RoadmapModel: {}, ItemModel: {}, ScheduleModel: {}, ExecutionModel: {},
      DirectionInterpreterService: {}, ProductCoverageService: {}, MarketResearchService: {},
      config: { topicRoadmap: { acceptanceScore: 90, minimumNoveltySubtotal: 55 } }
    });
    const match = service.claimableReadyMatch({ _id: ids.roadmap, directionRevision: 1, activeEpoch: 'epoch-current' });
    expect(match.activationEpoch).toBe('epoch-current');
    expect(match['scores.totalScore'].$gte).toBe(90);
    expect(match['scores.noveltySubtotal'].$gte).toBe(55);
    // A pre-rubric item like the ones that deadlocked production: fractional totalScore,
    // no rubric/corpus version, no hard-gate flag. It must NOT satisfy the claimable match.
    const staleItem = { status: 'ready', directionRevision: 1, attemptCount: 0, scores: { totalScore: 0.69 } };
    const freshItem = item(ids.itemA, 1);
    expect(matchesMongoQuery(staleItem, match)).toBe(false);
    expect(matchesMongoQuery(freshItem, match)).toBe(true);
  });

  it('rejects a score hash when persisted evidence changes after scoring', () => {
    const valid = item(ids.itemA, 1);
    expect(hasValidTopicScoreIntegrity(valid)).toBe(true);
    const tampered = {
      ...valid,
      marketEvidence: valid.marketEvidence.map((entry) => ({
        ...entry,
        contentHash: 'f'.repeat(64)
      }))
    };
    expect(hasValidTopicScoreIntegrity(tampered)).toBe(false);
  });

  it('preserves semantic score calibration through the roadmap item schema', () => {
    const source = item(ids.itemA, 1);
    const persisted = new BlogTopicRoadmapItem(source).toObject();

    expect(persisted.scores.semanticCalibration).toEqual(source.scores.semanticCalibration);
    expect(hasValidTopicScoreIntegrity(persisted)).toBe(true);
  });

  it('exposes the effective gate policy in the safe roadmap response', async () => {
    let aggregatePipeline;
    let itemFilter;
    let regenerationFilter;
    const service = new BlogTopicRoadmapService({
      RoadmapModel: {
        findOne: () => query({ ...roadmap, activeEpoch: 'epoch-current', epochMigrationComplete: true })
      },
      ItemModel: {
        aggregate: vi.fn(async (pipeline) => { aggregatePipeline = pipeline; return []; }),
        find: vi.fn((filter) => { itemFilter = filter; return query([]); })
      },
      RegenerationModel: {
        findOne: vi.fn((filter) => { regenerationFilter = filter; return query(null); })
      },
      ScheduleModel: { findById: () => query(schedule) },
      ExecutionModel: {},
      DirectionInterpreterService: {},
      ProductCoverageService: {},
      MarketResearchService: {},
      config: { topicRoadmap: { acceptanceScore: 90, minimumNoveltySubtotal: 55 } }
    });
    service.initialize = vi.fn(async () => ({ ...roadmap, activeEpoch: 'epoch-current', epochMigrationComplete: true }));

    const response = await service.getRoadmap({ scheduleId: ids.schedule });

    expect(response.policy).toEqual({ acceptanceScore: 90, minimumNoveltySubtotal: 55 });
    expect(aggregatePipeline[0].$match.directionRevision).toBe(1);
    expect(itemFilter.directionRevision).toBe(1);
    expect(regenerationFilter.directionRevision).toBe(1);
  });

  it('invalidates ready items scored under a superseded rubric or corpus version', async () => {
    const { RUBRIC_VERSION } = require('../src/services/contentOperations/topicRoadmapScoring.service');
    const { INDEX_VERSION } = require('../src/services/contentOperations/blogNoveltyIndex.service');
    let captured = null;
    const service = new BlogTopicRoadmapService({
      RoadmapModel: {}, ScheduleModel: {}, ExecutionModel: {},
      ItemModel: { updateMany: async (filter, update) => { captured = { filter, update }; return { modifiedCount: 6 }; } },
      DirectionInterpreterService: {}, ProductCoverageService: {}, MarketResearchService: {},
      config: { topicRoadmap: {} }
    });
    const now = new Date('2026-07-27T00:00:00Z');
    const result = await service.invalidateSupersededReady({ roadmap: { _id: ids.roadmap, directionRevision: 1 }, now });
    expect(result.modifiedCount).toBe(6);
    expect(captured.filter.status).toBe('ready');
    expect(captured.filter.directionRevision).toBe(1);
    expect(captured.filter.$or).toEqual([
      { 'scores.rubricVersion': { $ne: RUBRIC_VERSION } },
      { 'scores.corpusVersion': { $ne: INDEX_VERSION } },
      { 'scores.hardGates.sources': { $ne: true } },
      { 'scores.hardGates.products': { $ne: true } },
      { 'scores.hardGates.evidenceAlignment': { $ne: true } },
      { 'scores.trustedSignals.evidenceAlignment.version': { $ne: EVIDENCE_ALIGNMENT_VERSION } }
    ]);
    expect(captured.update.$set).toMatchObject({ status: 'invalidated', reasonCode: 'rubric_superseded', invalidatedAt: now });
  });

  it('redacts claim tokens, hashes, and unsafe free text from API views', () => {
    const view = safeItemView({
      ...item(ids.itemA, 1),
      claimToken: 'secret-claim-token',
      claimUntil: new Date(),
      reasonCode: 'fetch https://private.invalid/?access_token=secret-value',
      scores: {
        ...item(ids.itemA, 1).scores,
        scoreHash: 'internal-score-hash',
        corpusHash: 'internal-corpus-hash'
      },
      productEvidence: [{ productId: 'p1', name: 'Nồi', catalogEvidenceHash: 'secret-hash', factKeys: ['secret-key'] }]
    });
    expect(JSON.stringify(view)).not.toContain('secret-claim-token');
    expect(JSON.stringify(view)).not.toContain('secret-hash');
    expect(JSON.stringify(view)).not.toContain('secret-key');
    expect(JSON.stringify(view)).not.toContain('internal-score-hash');
    expect(JSON.stringify(view)).not.toContain('internal-corpus-hash');
    expect(JSON.stringify(view)).not.toContain('secret-value');
    expect(view.reasonCode).toBe('INTERNAL_ERROR');
  });

  it('returns a secret-safe regeneration view while preserving outcome and lineage', () => {
    const view = safeRegenerationView({
      _id: 'regen-1',
      scheduleId: ids.schedule,
      roadmapId: ids.roadmap,
      status: 'completed',
      outcome: 'no_change',
      outcomeCode: 'ROADMAP_NO_SAFE_TOPIC',
      errorCode: '',
      idempotencyKeyHash: 'secret-idempotency-hash',
      leaseTokenHash: 'secret-lease-hash',
      sourceHealth: [{ source: 'web', status: 'failed', detail: 'https://private.invalid/?token=secret' }],
      ideationRunId: 'ideation-1',
      productCatalogSnapshotId: 'catalog-1'
    });
    expect(view).toMatchObject({
      outcome: 'no_change',
      outcomeCode: 'ROADMAP_NO_SAFE_TOPIC',
      errorCode: '',
      lineage: { ideationRunId: 'ideation-1', productCatalogSnapshotId: 'catalog-1' }
    });
    expect(JSON.stringify(view)).not.toContain('secret-idempotency-hash');
    expect(JSON.stringify(view)).not.toContain('secret-lease-hash');
    expect(JSON.stringify(view)).not.toContain('private.invalid');
  });

  it('rejects regeneration immediately when the roadmap feature is disabled', async () => {
    const { service, jobs } = regenerationHarness();
    service.roadmapConfig.enabled = false;

    await expect(service.enqueueRegeneration({
      scheduleId: ids.schedule,
      idempotencyKey: 'regen-disabled-0001',
      adminId: 'admin-1'
    })).rejects.toMatchObject({ code: 'TOPIC_ROADMAP_DISABLED', status: 400 });
    expect(jobs).toHaveLength(0);
  });

  it('durably enqueues once, returns the same job for a retry, and coalesces another key', async () => {
    const { service, jobs, RoadmapModel } = regenerationHarness();
    const first = await service.enqueueRegeneration({
      scheduleId: ids.schedule,
      idempotencyKey: 'regen-key-0001',
      adminId: 'admin-1',
      requestId: 'request-roadmap-1'
    });
    const duplicate = await service.enqueueRegeneration({
      scheduleId: ids.schedule,
      idempotencyKey: 'regen-key-0001',
      adminId: 'admin-1'
    });
    const coalesced = await service.enqueueRegeneration({
      scheduleId: ids.schedule,
      idempotencyKey: 'regen-key-0002',
      adminId: 'admin-1'
    });
    expect(first).toMatchObject({ queued: true, duplicate: false, coalesced: false });
    expect(first.regeneration.correlationId).toBe('request-roadmap-1');
    expect(duplicate).toMatchObject({ queued: true, duplicate: true, coalesced: false });
    expect(coalesced).toMatchObject({ queued: true, duplicate: false, coalesced: true });
    expect(duplicate.regeneration.id).toBe(first.regeneration.id);
    expect(coalesced.regeneration.id).toBe(first.regeneration.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].coalescedIdempotencyKeyHashes).toHaveLength(2);
    expect(jobs[0].coalescedIdempotencyKeyHashes).toContain(jobs[0].idempotencyKeyHash);
    expect(RoadmapModel.updateOne).toHaveBeenCalledTimes(1);
    expect(RoadmapModel.updateOne.mock.calls[0][1].$set).not.toHaveProperty('activeEpoch');
  });

  it('replays a coalesced idempotency key after the active run becomes terminal', async () => {
    const { service, jobs } = regenerationHarness();
    const first = await service.enqueueRegeneration({
      scheduleId: ids.schedule,
      idempotencyKey: 'regen-key-0001',
      adminId: 'admin-1'
    });
    const coalesced = await service.enqueueRegeneration({
      scheduleId: ids.schedule,
      idempotencyKey: 'regen-key-0002',
      adminId: 'admin-1'
    });
    jobs[0].status = 'completed';
    jobs[0].activeFence = false;
    jobs[0].outcome = 'replacement_committed';

    const replay = await service.enqueueRegeneration({
      scheduleId: ids.schedule,
      idempotencyKey: 'regen-key-0002',
      adminId: 'admin-1'
    });

    expect(coalesced).toMatchObject({ coalesced: true, duplicate: false });
    expect(replay).toMatchObject({ duplicate: true, coalesced: true, queued: false });
    expect(replay.regeneration.id).toBe(first.regeneration.id);
    expect(jobs).toHaveLength(1);
  });

  it('classifies only explicit transport and lease failures as regeneration retries', () => {
    const { isTransientFailureCode } = require('../src/services/contentOperations/blogTopicRoadmap.service');
    expect(isTransientFailureCode('OPENCLAW_AGENT_TIMEOUT')).toBe(true);
    expect(isTransientFailureCode('OPENCLAW_AGENT_HTTP_503')).toBe(true);
    expect(isTransientFailureCode('GOOGLE_INTELLIGENCE_BUILD_BUSY')).toBe(true);
    expect(isTransientFailureCode('ROADMAP_INTELLIGENCE_UNAVAILABLE')).toBe(true);
    expect(isTransientFailureCode('OPENCLAW_AGENT_INVALID_JSON')).toBe(false);
    expect(isTransientFailureCode('OPENCLAW_PROVIDER_AUTH_FAILED')).toBe(false);
    expect(isTransientFailureCode('NOVELTY_CORPUS_EMPTY')).toBe(false);
  });

  it('claims an expired running regeneration through an independent hashed lease', async () => {
    const { service, jobs, getUpdateFilter } = regenerationHarness();
    const expiredAt = new Date('2026-07-27T00:00:00.000Z');
    jobs.push({
      _id: 'regen-stale', scheduleId: ids.schedule, roadmapId: ids.roadmap,
      status: 'running', activeFence: true, attemptCount: 1,
      nextRetryAt: expiredAt, leaseExpiresAt: expiredAt,
      baseEpoch: 'epoch-old', targetEpoch: 'epoch-new', baseGeneration: 1, targetGeneration: 2
    });
    const claimed = await service.claimQueuedRegeneration({
      workerId: 'replacement-worker',
      now: new Date('2026-07-27T00:01:00.000Z')
    });
    expect(claimed.job.status).toBe('running');
    expect(claimed.job.attemptCount).toBe(2);
    expect(claimed.job.leaseTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(claimed.job.leaseTokenHash).not.toBe(claimed.token);
    expect(getUpdateFilter().status.$in).toEqual(['queued', 'running']);
    expect(getUpdateFilter().$and[1].$or).toContainEqual({ leaseExpiresAt: { $lte: new Date('2026-07-27T00:01:00.000Z') } });
  });

  it('refuses to terminalize a regeneration after its lease has expired', async () => {
    const { service, jobs } = regenerationHarness();
    jobs.push({
      _id: 'regen-expired-owner',
      roadmapId: ids.roadmap,
      scheduleId: ids.schedule,
      status: 'running',
      activeFence: true,
      leaseTokenHash: 'expired-token-hash',
      leaseExpiresAt: new Date('2026-07-26T23:59:00.000Z'),
      attemptCount: 1
    });
    service.now = () => new Date('2026-07-27T00:00:00.000Z');

    await expect(service.completeRegeneration({
      job: jobs[0],
      tokenHash: 'expired-token-hash',
      outcome: 'replacement_committed',
      outcomeCode: 'ROADMAP_REPLACEMENT_COMMITTED'
    })).rejects.toMatchObject({ code: 'ROADMAP_REGENERATION_LEASE_LOST' });
    expect(jobs[0].status).toBe('running');
    expect(jobs[0].activeFence).toBe(true);
  });

  it('heartbeats a long-running regeneration lease and clears the timer at completion', async () => {
    vi.useFakeTimers();
    try {
      const { service } = regenerationHarness();
      const job = {
        _id: 'regen-long',
        scheduleId: ids.schedule,
        roadmapId: ids.roadmap,
        directionRevision: 1,
        baseGeneration: 1,
        targetGeneration: 2,
        baseEpoch: 'epoch-old',
        targetEpoch: 'epoch-new',
        attemptCount: 1,
        reason: 'manager_refresh'
      };
      let finishGeneration;
      service.claimQueuedRegeneration = vi.fn(async () => ({ job, tokenHash: 'lease-token-hash' }));
      service.RoadmapModel.findOne = vi.fn(() => query(null));
      service.ensureReadyBuffer = vi.fn(() => new Promise((resolve) => { finishGeneration = resolve; }));
      service.heartbeatRegeneration = vi.fn(async () => true);
      service.completeRegeneration = vi.fn(async () => ({
        ...job,
        status: 'completed',
        outcome: 'replacement_committed',
        outcomeCode: 'ROADMAP_REPLACEMENT_COMMITTED'
      }));

      const running = service.runQueuedRegenerationOnce({ workerId: 'roadmap-worker' });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(20_000);

      expect(service.heartbeatRegeneration).toHaveBeenCalledWith({
        jobId: 'regen-long',
        tokenHash: 'lease-token-hash'
      });
      expect(service.completeRegeneration).not.toHaveBeenCalled();

      finishGeneration({ roadmap: { sourceHealth: [] }, ideationRunId: null });
      await running;
      expect(service.completeRegeneration).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed on missing persisted evidence before calling paid ideation', async () => {
    let releasedUpdates = null;
    const RoadmapModel = {
      findOne: () => query({ ...roadmap, activeEpoch: 'epoch-old', epochMigrationComplete: true }),
      findOneAndUpdate: vi.fn((filter, update) => {
        if (filter.refillToken) {
          releasedUpdates = update.$set;
          return query({ ...roadmap, ...update.$set });
        }
        return query({ ...roadmap, status: 'refilling', refillToken: 'refill-token' });
      }),
      updateOne: vi.fn(async () => ({ matchedCount: 1 }))
    };
    const ItemModel = {
      find: () => query([]),
      create: vi.fn(),
      countDocuments: vi.fn(async () => 0),
      deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
      updateMany: vi.fn(async () => ({ modifiedCount: 0 }))
    };
    const directionInterpreter = { interpret: vi.fn(async () => ({ scopeMode: 'broad', targetAudience: [] })) };
    const ideationService = vi.fn(async () => ({ ideas: [], source: 'fallback', model: null }));
    const service = new BlogTopicRoadmapService({
      RoadmapModel,
      ItemModel,
      ScheduleModel: { findById: () => query(schedule) },
      ExecutionModel: {},
      InventoryItemModel: { find: () => query([]) },
      GoogleService: { ensureGoogleIntelligenceSnapshotForDate: vi.fn(async () => ({ _id: 'google-1' })) },
      IntelligenceService: {
        ensureContentOperationsSnapshotForDate: vi.fn(async () => ({ disabled: false, snapshot: {
          id: 'content-1', contentInventorySnapshotId: 'inventory-1', sourceHealth: []
        } }))
      },
      ProductCatalogService: { ensureSnapshot: vi.fn(async () => ({ id: 'catalog-1', safeProducts: [] })) },
      DirectionInterpreterService: directionInterpreter,
      ProductCoverageService: { build: vi.fn(async () => ({ cards: [], promptCards: [] })) },
      MarketResearchService: { ensureSnapshot: vi.fn(async () => ({ id: 'market-1', status: 'partial', sourceHealth: {}, sources: [], signals: [] })) },
      NoveltyService: { comparePlan: vi.fn() },
      ideationService,
      RegenerationModel: { updateOne: vi.fn() },
      config: { inventory: { maxItems: 100 }, topicRoadmap: {
        enabled: true, minimumReady: 1, targetReady: 2, agenticIdeationEnabled: false,
        acceptanceScore: 82, minimumNoveltySubtotal: 48
      } },
      randomUUID: () => 'refill-token'
    });
    service.initialize = vi.fn(async () => ({ ...roadmap, activeEpoch: 'epoch-old', epochMigrationComplete: true }));

    await expect(service.ensureReadyBuffer({
      scheduleId: ids.schedule,
      force: true,
      reason: 'automatic_refill'
    })).rejects.toMatchObject({ code: 'ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE' });

    expect(releasedUpdates).toMatchObject({
      status: 'needs_refill',
      readyCount: 0,
      lastOutcomeCode: 'ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE',
      lastErrorCode: ''
    });
    expect(directionInterpreter.interpret).toHaveBeenCalledTimes(1);
    expect(directionInterpreter.interpret).toHaveBeenCalledWith(expect.objectContaining({ preferLlm: false }));
    expect(ideationService).not.toHaveBeenCalled();
  });

  it('keeps the old active epoch when persisted evidence cannot reach the score gate', async () => {
    const updates = [];
    const RoadmapModel = {
      findOne: () => query({ ...roadmap, activeEpoch: 'epoch-old', epochMigrationComplete: true }),
      updateOne: vi.fn(async (...args) => { updates.push(args); return { matchedCount: 1 }; }),
      findOneAndUpdate: vi.fn()
    };
    const ItemModel = {
      find: () => query([]),
      create: vi.fn(),
      countDocuments: vi.fn(async () => 0),
      deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
      updateMany: vi.fn(async () => ({ modifiedCount: 0 }))
    };
    const RegenerationModel = { updateOne: vi.fn(async () => ({ matchedCount: 1 })) };
    const directionInterpreter = { interpret: vi.fn(async () => ({ scopeMode: 'broad', targetAudience: [] })) };
    const ideationService = vi.fn(async () => ({ ideas: [], source: 'fallback', model: null }));
    const service = new BlogTopicRoadmapService({
      RoadmapModel,
      ItemModel,
      ScheduleModel: { findById: () => query(schedule) },
      ExecutionModel: {},
      InventoryItemModel: { find: () => query([]) },
      GoogleService: { ensureGoogleIntelligenceSnapshotForDate: vi.fn(async () => ({ _id: 'google-1' })) },
      IntelligenceService: {
        ensureContentOperationsSnapshotForDate: vi.fn(async () => ({ disabled: false, snapshot: {
          id: 'content-1', contentInventorySnapshotId: 'inventory-1', sourceHealth: []
        } }))
      },
      ProductCatalogService: { ensureSnapshot: vi.fn(async () => ({ id: 'catalog-1', safeProducts: [] })) },
      DirectionInterpreterService: directionInterpreter,
      ProductCoverageService: { build: vi.fn(async () => ({ cards: [], promptCards: [] })) },
      MarketResearchService: { ensureSnapshot: vi.fn(async () => ({
        id: 'market-1',
        status: 'partial',
        sourceHealth: { configured: 1, attempted: 1, succeeded: 1, failed: 0 },
        sources: [],
        signals: [{
          evidenceId: 'weak-evidence-1',
          sourceId: 'weak-source-1',
          signalHash: 'b'.repeat(64),
          confidence: 0.1,
          observedAt: new Date('2025-01-01T00:00:00Z'),
          relevance: {
            version: require('../src/services/contentOperations/sourceRelevanceScoring.service').SOURCE_RELEVANCE_VERSION,
            totalScore: 0.05,
            eligibleForIdeation: true,
            rejectionReasons: []
          }
        }]
      })) },
      NoveltyService: { comparePlan: vi.fn() },
      ideationService,
      RegenerationModel,
      config: { inventory: { maxItems: 100 }, topicRoadmap: {
        enabled: true, minimumReady: 1, targetReady: 2, agenticIdeationEnabled: false,
        acceptanceScore: 82, minimumNoveltySubtotal: 48
      } }
    });
    service.initialize = vi.fn(async () => ({ ...roadmap, activeEpoch: 'epoch-old', epochMigrationComplete: true }));
    await expect(service.ensureReadyBuffer({
      scheduleId: ids.schedule,
      force: true,
      activationEpoch: 'epoch-new',
      regenerationId: 'regen-1',
      expectedRoadmap: { roadmapId: ids.roadmap, directionRevision: 1, baseGeneration: 1, baseEpoch: 'epoch-old' },
      preserveActivePlan: true,
      assertReplacementOwner: vi.fn(async () => false)
    })).rejects.toMatchObject({ code: 'ROADMAP_SCORE_UNREACHABLE' });
    expect(directionInterpreter.interpret).toHaveBeenCalledTimes(1);
    expect(directionInterpreter.interpret).toHaveBeenCalledWith(expect.objectContaining({ preferLlm: false }));
    expect(ideationService).not.toHaveBeenCalled();
    expect(RoadmapModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ItemModel.deleteMany).not.toHaveBeenCalled();
    expect(updates.flatMap(([, update]) => Object.keys(update?.$set || {}))).not.toContain('activeEpoch');
    expect(ItemModel.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ activationEpoch: { $ne: 'epoch-new' } }),
      expect.anything()
    );
  });
});
