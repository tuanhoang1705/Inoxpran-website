import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ACTIONS, getContentOperationsConfig } = require('../src/config/contentOperations.config');
const {
    ContentOpportunityDecisionService,
    chooseBestAction,
    scoreOpportunityCandidate
} = require('../src/services/contentOperations/opportunityDecision.service');
const { buildWorkOrderDocument } = require('../src/services/contentOperations/workOrder.service');
const {
    assertBriefComplete,
    buildUnifiedBriefDocument
} = require('../src/services/contentOperations/unifiedBrief.service');
const {
    buildEvidenceMapDocument,
    normalizeEvidenceEntry
} = require('../src/services/contentOperations/evidenceMap.service');
const { buildStagedRevision } = require('../src/services/contentOperations/blogRevision.service');
const { writeContentOperationsAudit } = require('../src/services/contentOperations/contentOperationsAudit.service');

const objectId = (suffix) => `507f1f77bcf86cd7994390${suffix}`;
const highFactors = {
    userDemand: 1,
    contentGap: 1,
    performance: 1,
    business: 1,
    freshness: 1,
    customerSignal: 1,
    productCampaign: 1,
    evidence: 1,
    internalLink: 1
};

const selectedDecision = (decisionType = ACTIONS.NEW) => ({
    _id: objectId('11'),
    contentOperationsSnapshotId: objectId('12'),
    candidateId: 'candidate-1',
    decisionType,
    recommendedAction: decisionType,
    topic: 'Cách chọn nồi inox',
    totalScore: 0.9,
    scoreBreakdown: { userDemand: { contribution: 0.18 } },
    decisionReason: 'Strong verified user demand',
    risks: [],
    targetBlogIds: []
});

const workOrderInput = {
    googleIntelSnapshotId: objectId('13'),
    primaryBusinessGoal: 'customer_education',
    targetAudience: ['Người mua gia dụng'],
    funnelStage: 'consideration',
    primarySearchIntent: 'informational',
    successMetrics: [{ metric: 'qualified_impressions', target: 100 }]
};

describe('Content opportunity scoring', () => {
    it('audits all nine configured factors and supports all eight actions', () => {
        const config = getContentOperationsConfig({
            CONTENT_OPPORTUNITY_SKIP_THRESHOLD: '0.1',
            CONTENT_OPPORTUNITY_MINIMUM_USER_VALUE_SCORE: '0.1'
        });
        for (const action of Object.values(ACTIONS)) {
            const result = scoreOpportunityCandidate({
                candidateId: action,
                decisionType: action,
                topic: action,
                factors: highFactors
            }, { config });
            expect(result.decisionType).toBe(action);
            if (action !== ACTIONS.SKIP) {
                expect(Object.keys(result.scoreBreakdown)).toEqual(Object.keys(config.opportunityWeights));
                expect(result.totalScore).toBeGreaterThan(0);
            }
        }
    });

    it('does not let business or product priority alone force production', () => {
        const result = chooseBestAction({
            candidates: [{
                candidateId: 'business-only',
                decisionType: ACTIONS.NEW,
                topic: 'Campaign-only topic',
                factors: { business: 1, productCampaign: 1, evidence: 1 }
            }]
        });
        expect(result.skipped).toBe(true);
        expect(result.selected.decisionType).toBe(ACTIONS.SKIP);
        expect(result.rankedCandidates[0].risks).toContain('business_priority_without_sufficient_user_value');
    });

    it('uses deterministic penalties and skips below the configured threshold', () => {
        const config = getContentOperationsConfig({
            CONTENT_OPPORTUNITY_SKIP_THRESHOLD: '0.8',
            CONTENT_OPPORTUNITY_MINIMUM_USER_VALUE_SCORE: '0.2'
        });
        const scored = scoreOpportunityCandidate({
            candidateId: 'penalized',
            decisionType: ACTIONS.EXPAND,
            factors: highFactors,
            penaltySignals: { cannibalizationRisk: 1, insufficientEvidence: 1 }
        }, { config });
        expect(scored.penalties.map((item) => item.code)).toEqual(['cannibalization_risk', 'insufficient_evidence']);
        expect(scored.eligible).toBe(false);
        expect(scored.recommendedAction).toBe(ACTIONS.SKIP);
    });

    it('preserves terminal review state across repeated previews and audits the latest selection', async () => {
        const acceptedAt = new Date('2026-07-19T00:00:00.000Z');
        const stored = new Map([['accepted-candidate', {
            candidateId: 'accepted-candidate',
            status: 'accepted',
            selectedAt: acceptedAt,
            metadata: { reviewedBy: 'editor' }
        }]]);
        const updates = [];
        const DecisionModel = {
            findOneAndUpdate: async (query, update) => {
                updates.push(update);
                const existing = stored.get(query.candidateId);
                const next = existing
                    ? {
                        ...existing,
                        ...update.$set,
                        metadata: { ...existing.metadata, ...update.$set.metadata }
                    }
                    : { ...update.$setOnInsert, ...update.$set };
                stored.set(query.candidateId, next);
                return next;
            }
        };
        const input = {
            contentOperationsSnapshotId: objectId('71'),
            candidates: [{
                candidateId: 'accepted-candidate',
                decisionType: ACTIONS.NEW,
                topic: 'Evidence-backed cookware guide',
                factors: highFactors
            }],
            DecisionModel
        };

        await ContentOpportunityDecisionService.persistCandidates(input);
        const repeated = await ContentOpportunityDecisionService.persistCandidates(input);
        const persisted = repeated.persisted[0];

        expect(persisted.status).toBe('accepted');
        expect(persisted.selectedAt).toEqual(acceptedAt);
        expect(persisted.metadata).toMatchObject({ reviewedBy: 'editor', latestPreviewSelected: true });
        expect(updates).toHaveLength(2);
        expect(updates.every((update) => update.$set.status === undefined)).toBe(true);
        expect(updates.every((update) => update.$setOnInsert.status === 'selected')).toBe(true);
    });
});

describe('Work orders and unified briefs', () => {
    it('builds a persisted-before-production work order contract', () => {
        const document = buildWorkOrderDocument({ decision: selectedDecision(), input: workOrderInput });
        expect(document.decision).toBe(ACTIONS.NEW);
        expect(document.contentOpportunityDecisionId).toBe(objectId('11'));
        expect(document.targetBlogId).toBeNull();
        expect(document.artifactIds).toEqual({});
    });

    it('enforces target identity for update, expand, merge, and new', () => {
        expect(() => buildWorkOrderDocument({ decision: selectedDecision(ACTIONS.UPDATE), input: workOrderInput }))
            .toThrow(/targetBlogId/);
        expect(() => buildWorkOrderDocument({
            decision: selectedDecision(ACTIONS.MERGE),
            input: { ...workOrderInput, targetBlogId: objectId('21') }
        })).toThrow(/mergeSourceBlogId/);
        expect(() => buildWorkOrderDocument({
            decision: selectedDecision(ACTIONS.NEW),
            input: { ...workOrderInput, targetBlogId: objectId('21') }
        })).toThrow(/must not target/);
    });

    it('requires a complete unified brief instead of topic-and-keyword input', () => {
        const workOrder = { _id: objectId('31'), ...buildWorkOrderDocument({ decision: selectedDecision(), input: workOrderInput }) };
        const brief = buildUnifiedBriefDocument({
            workOrder,
            input: {
                workingTitle: 'Cách chọn nồi inox phù hợp',
                primaryQuestion: 'Nên chọn nồi inox như thế nào?',
                articleType: 'guide',
                contentRole: 'education',
                editorialAngle: 'Decision guide grounded in verified needs',
                evidenceRequirements: [],
                imagePlanRequirements: [],
                ctaStrategy: { mode: 'soft' },
                publishTarget: { mode: 'draft' },
                reviewRequirements: ['fact', 'seo']
            }
        });
        expect(assertBriefComplete(brief)).toBe(true);
        expect(brief.contentWorkOrderId).toBe(objectId('31'));
        expect(brief.contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(() => assertBriefComplete({ topic: 'only topic' })).toThrow(/incomplete/i);
    });

    it('never builds a writer brief for skip', () => {
        expect(() => buildUnifiedBriefDocument({
            workOrder: { _id: objectId('31'), decision: ACTIONS.SKIP },
            input: {}
        })).toThrow(/Skip work orders/);
    });
});

describe('Evidence and additive revisions', () => {
    it('blocks unknown, conflicting, and unbound product claims', () => {
        expect(normalizeEvidenceEntry({ evidenceKey: 'unknown', claim: 'Unknown claim', classification: 'unknown' }).status).toBe('blocked');
        expect(normalizeEvidenceEntry({ evidenceKey: 'conflict', claim: 'Conflicting claim', classification: 'conflicting' }).status).toBe('blocked');
        expect(normalizeEvidenceEntry({
            evidenceKey: 'product', claim: 'Công suất 1000W', classification: 'verified', sourceType: 'product_specification'
        }).status).toBe('blocked');
    });

    it('marks inferred claims restricted and computes an auditable map status', () => {
        const map = buildEvidenceMapDocument({
            contentWorkOrderId: objectId('41'),
            unifiedContentBriefId: objectId('42'),
            entries: [{ evidenceKey: 'inference', claim: 'Likely useful', classification: 'inferred', confidence: 0.6 }]
        });
        expect(map.status).toBe('restricted');
        expect(map.entries[0].requiredQualification).toMatch(/inference/i);
    });

    it('removes credential-like evidence URL parameters and fragments before persistence', () => {
        const entry = normalizeEvidenceEntry({
            evidenceKey: 'safe-source',
            claim: 'Verified guidance',
            classification: 'verified',
            sourceUrl: 'https://example.com/guide?locale=vi&api_key=never-store#private'
        });
        expect(entry.sourceUrl).toBe('https://example.com/guide?locale=vi');
    });

    it('stages revisions without applying, deleting, or changing canonical identity', () => {
        const base = {
            workOrder: { _id: objectId('51'), decision: ACTIONS.UPDATE, targetBlogId: objectId('52') },
            brief: { _id: objectId('53') },
            currentBlog: { _id: objectId('52'), canonicalUrl: 'https://inoxpran.com/blog/noi-inox', content: '<p>Old</p>' }
        };
        const staged = buildStagedRevision({ ...base, changes: { sectionChanges: [{ sectionKey: 'care', operation: 'update_existing_section' }] } });
        expect(staged.status).toBe('staged');
        expect(staged.autoApply).toBe(false);
        expect(staged.canonicalUrl).toBe(base.currentBlog.canonicalUrl);
        expect(staged.auditMetadata.liveBlogMutated).toBe(false);
        expect(() => buildStagedRevision({ ...base, changes: { delete: true } })).toThrow(/forbidden/i);
        expect(() => buildStagedRevision({ ...base, changes: { canonicalUrl: 'https://example.com/new' } })).toThrow(/preserved/i);
    });

    it('keeps metadata refresh scoped and merge non-destructive', () => {
        const common = {
            brief: { _id: objectId('61') },
            currentBlog: { _id: objectId('62'), canonicalUrl: 'https://inoxpran.com/blog/primary', content: 'base' }
        };
        expect(() => buildStagedRevision({
            ...common,
            workOrder: { _id: objectId('63'), decision: ACTIONS.METADATA_REFRESH, targetBlogId: objectId('62') },
            changes: { sectionChanges: [{ operation: 'replace' }] }
        })).toThrow(/cannot rewrite/);
        const merge = buildStagedRevision({
            ...common,
            workOrder: { _id: objectId('64'), decision: ACTIONS.MERGE, targetBlogId: objectId('62'), mergeSourceBlogIds: [objectId('65')] },
            changes: {
                sectionChanges: [{ operation: 'consolidate_into_primary_section', sectionKey: 'intro', proposedContentHtml: '<p>Consolidated</p>' }],
                mergePlan: { retain: ['intro'], removeRecommendations: ['duplicate section'] }
            }
        });
        expect(merge.sourceBlogIds).toEqual([objectId('65')]);
        expect(merge.autoApply).toBe(false);
    });
});

describe('Content Operations audit safety', () => {
    it('redacts secrets and customer PII from bounded audit fields', async () => {
        const AuditModel = { create: vi.fn(async (document) => document) };
        const document = await writeContentOperationsAudit({
            action: 'safe_audit',
            entityType: 'ContentWorkOrder',
            reason: 'Contact private@example.com with api_key=never-store',
            changes: [{ field: 'topic', after: 'Bearer secret-token-value' }],
            metadata: {
                apiKey: 'never-store',
                nested: { customerEmail: 'private@example.com' },
                errorCode: 'SAFE_ERROR_CODE'
            },
            AuditModel
        });

        const persisted = JSON.stringify(document);
        expect(persisted).not.toContain('private@example.com');
        expect(persisted).not.toContain('never-store');
        expect(persisted).not.toContain('secret-token-value');
        expect(document.metadata).toMatchObject({
            apiKey: '[redacted]',
            nested: { customerEmail: '[redacted]' },
            errorCode: 'SAFE_ERROR_CODE'
        });
        expect(AuditModel.create).toHaveBeenCalledOnce();
    });
});
