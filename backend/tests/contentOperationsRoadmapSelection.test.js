import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  applyTrustedRoadmapSelection,
  briefInputFor,
  normalizeTrustedRoadmapContext,
  workOrderInputFor
} = require('../src/services/contentOperations/contentOperationsPlanning.service');

const context = () => ({
  roadmapId: '66d0f5b5e3d6a4a1b2c3d4e5',
  itemId: '66d0f5b5e3d6a4a1b2c3d4e6',
  scheduleId: '66d0f5b5e3d6a4a1b2c3d4e7',
  executionId: '66d0f5b5e3d6a4a1b2c3d4e8',
  topic: 'Cách chọn dung tích nồi cơm điện theo số người',
  angle: 'Dùng khẩu phần thực tế thay vì chọn theo cảm tính',
  primaryKeyword: 'dung tích nồi cơm điện',
  secondaryKeywords: ['nồi cơm điện gia đình', 'khẩu phần cơm'],
  primaryQuestion: 'Gia đình nên chọn nồi cơm điện bao nhiêu lít?',
  supportingQuestions: ['Hai người dùng bao nhiêu lít?', 'Sáu người dùng bao nhiêu lít?'],
  targetAudience: ['Gia đình Việt đang chọn nồi cơm điện'],
  userProblems: ['Khó ước lượng dung tích theo khẩu phần'],
  searchIntent: 'commercial-investigation',
  articleType: 'comparison-guide',
  categoryKey: 'guide',
  managerDirection: 'Mở rộng nhiều bài hữu ích về gia dụng điện',
  opportunityScore: 0.84,
  productEvidence: [{ source: 'product_catalog', productId: 'p1' }],
  marketEvidence: [{
    sourceType: 'market_web',
    sourceId: 'web-1',
    canonicalUrl: 'https://example.com/source',
    title: 'Observed housewares market signal',
    snippet: 'A public source describes a current household-kitchen concern.',
    confidence: 0.7
  }]
});

describe('trusted roadmap planning selection', () => {
  it('rejects incomplete trusted contexts', () => {
    expect(() => normalizeTrustedRoadmapContext({ topic: 'Missing identifiers' }))
      .toThrow(/incomplete/i);
  });

  it('normalizes and bounds trusted roadmap values', () => {
    const normalized = normalizeTrustedRoadmapContext({
      ...context(),
      secondaryKeywords: Array.from({ length: 30 }, (_, i) => `kw-${i}`),
      opportunityScore: 5,
      topicScoreReport: {
        totalScore: 95,
        noveltySubtotal: 60,
        acceptanceScore: 1,
        minimumNoveltySubtotal: 1,
        hardGatesPassed: true
      }
    });
    expect(normalized.topic).toBe(context().topic);
    expect(normalized.secondaryKeywords).toHaveLength(12);
    expect(normalized.opportunityScore).toBe(0.05);
    expect(normalized.topicScoreReport.acceptanceScore).toBe(82);
    expect(normalized.topicScoreReport.minimumNoveltySubtotal).toBe(48);
    expect(normalizeTrustedRoadmapContext({
      ...context(),
      opportunityScore: 84
    }).opportunityScore).toBe(0.84);
  });

  it('makes the claimed roadmap topic and angle authoritative through work order and brief', () => {
    const normalized = normalizeTrustedRoadmapContext(context());
    const input = applyTrustedRoadmapSelection(
      {
        topic: 'RAW MANAGER DIRECTION MUST NOT WIN',
        editorialAngle: 'generic angle',
        mode: 'best_action'
      },
      normalized
    );
    const decision = {
      recommendedAction: 'new',
      decisionType: 'new',
      topic: normalized.topic,
      positiveEvidence: [],
      decisionReason: 'Roadmap item was researched and claimed.'
    };
    const snapshot = {
      id: 'snapshot-1',
      googleIntelSnapshotId: 'google-1',
      sourceHealth: []
    };
    const workOrderInput = workOrderInputFor({ decision, snapshot, input });
    expect(workOrderInput.topic).toBe(normalized.topic);
    expect(workOrderInput.topic).not.toContain('RAW MANAGER');
    expect(workOrderInput.metadata.selectionSource).toBe('roadmap');
    expect(workOrderInput.metadata.managerDirection).toBe(normalized.managerDirection);
    expect(workOrderInput.requiredEvidence).toHaveLength(2);

    const workOrder = {
      ...workOrderInput,
      decision: 'new',
      opportunityScore: 0.84,
      primaryBusinessGoal: 'customer_education',
      secondaryBusinessGoals: [],
      funnelStage: 'consideration',
      secondarySearchIntents: [],
      productIntegrationPolicy: { mode: 'auto' },
      successMetrics: []
    };
    const brief = briefInputFor({ workOrder, decision, input, inventoryItems: [] });
    expect(brief.topic).toBe(normalized.topic);
    expect(brief.editorialAngle).toBe(normalized.angle);
    expect(brief.primaryQuestion).toBe(normalized.primaryQuestion);
    expect(brief.supportingQuestions).toEqual(normalized.supportingQuestions);
  });
});
