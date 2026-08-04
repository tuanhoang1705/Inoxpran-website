import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    EVIDENCE_ALIGNMENT_VERSION,
    MIN_CONFIGURABLE_ACCEPTANCE_SCORE,
    MIN_CONFIGURABLE_NOVELTY_SUBTOTAL,
    ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE,
    assessTopicEvidenceAlignment,
    assessTopicPlanReachability,
    calibrateSemanticCollision,
    normalizeOpportunityScore,
    resolveRoadmapThresholds,
    scoreTopicPlan
} = require('../src/services/contentOperations/topicRoadmapScoring.service')
const { INDEX_VERSION } = require('../src/services/contentOperations/blogNoveltyIndex.service')
const { SOURCE_RELEVANCE_VERSION } = require('../src/services/contentOperations/sourceRelevanceScoring.service')

const comparison = (similarity = 0.1) => ({
    indexVersion: INDEX_VERSION,
    corpusHash: 'corpus',
    corpusCount: 150,
    comparedCount: 150,
    lexical: { lexicalSimilarity: similarity, sourceId: 'a' },
    topic: { topicSimilarity: similarity, sameIntent: false, sourceId: 'b' },
    plan: { planSimilarity: similarity, sourceId: 'c' }
})
const source = {
    evidenceId: 'verified-market-signal-1',
    sourceId: 'verified-market-source-1',
    contentHash: 'a'.repeat(64),
    confidence: 'high',
    classification: 'observed',
    title: 'Nồi inox cho gia đình: cách chọn mua, sử dụng, vệ sinh, bảo quản an toàn và xử lý lỗi',
    snippet: 'Hướng dẫn thực tế về lựa chọn, làm sạch, cất giữ và khắc phục sự cố nồi inox.',
    observedAt: new Date('2026-07-20T00:00:00.000Z'),
    relevance: { version: SOURCE_RELEVANCE_VERSION, totalScore: 0.9, eligibleForIdeation: true }
}
const alignedIdea = {
    topic: 'Cách chọn nồi inox phù hợp cho gia đình',
    angle: 'Kinh nghiệm lựa chọn nồi inox theo nhu cầu sử dụng thực tế',
    primaryKeyword: 'chọn nồi inox',
    primaryQuestion: 'Gia đình nên chọn nồi inox thế nào?',
    keywords: ['nồi inox', 'chọn nồi'],
    supportingQuestions: [],
    userProblems: []
}
const productEvidence = {
    productId: '64b000000000000000000001',
    sku: 'INP7901',
    name: 'Vợt muỗi thông minh INP7901',
    category: 'vợt muỗi',
    catalogEvidenceHash: 'f'.repeat(64),
    factKeys: []
}
const evidence = ({ evidenceId, title, snippet = '', contentHash = 'b'.repeat(64) }) => ({
    ...source,
    evidenceId,
    sourceId: `source-${evidenceId}`,
    title,
    snippet,
    contentHash
})

describe('topic roadmap v2 scoring', () => {
    it('normalizes mixed opportunity inputs onto the 0-1 dimension scale before 0-100 scoring', () => {
        expect(normalizeOpportunityScore(0.84)).toBe(0.84)
        expect(normalizeOpportunityScore(84)).toBe(0.84)
        expect(normalizeOpportunityScore(101)).toBe(0)
        const report = scoreTopicPlan({
            idea: { userDemandScore: 90, directionFitScore: 100, businessScore: 80 },
            comparison: comparison(0.05),
            sourceEvidence: [source],
            portfolioDiversity: 1,
            now: new Date('2026-07-29T00:00:00.000Z')
        })
        expect(report.totalScore).toBeGreaterThanOrEqual(0)
        expect(report.totalScore).toBeLessThanOrEqual(100)
    })

    it('propagates effective score and novelty thresholds into the authoritative report', () => {
        const report = scoreTopicPlan({
            idea: { userDemandScore: 1, directionFitScore: 1, businessScore: 1 },
            comparison: comparison(0.05),
            sourceEvidence: [source],
            portfolioDiversity: 1,
            acceptanceScore: 95,
            minimumNoveltySubtotal: 60
        })
        expect(report.acceptanceScore).toBe(95)
        expect(report.minimumNoveltySubtotal).toBe(60)
        expect(report.hardGates.score).toBe(report.totalScore >= 95)
        expect(report.hardGates.novelty).toBe(report.noveltySubtotal >= 60)
    })

    it('defaults to the 82/48 policy and bounds any explicit relaxation at the configurable floor', () => {
        // Absent or unusable input must never silently relax the audited policy.
        expect(resolveRoadmapThresholds()).toEqual({ acceptanceScore: 82, minimumNoveltySubtotal: 48 })
        expect(resolveRoadmapThresholds({
            acceptanceScore: null,
            minimumNoveltySubtotal: undefined
        })).toEqual({ acceptanceScore: 82, minimumNoveltySubtotal: 48 })

        // An operator may deliberately tune a live site, but only down to the floor.
        expect(resolveRoadmapThresholds({
            acceptanceScore: 74,
            minimumNoveltySubtotal: 40
        })).toEqual({ acceptanceScore: 74, minimumNoveltySubtotal: 40 })
        expect(resolveRoadmapThresholds({
            acceptanceScore: 1,
            minimumNoveltySubtotal: 2
        })).toEqual({
            acceptanceScore: MIN_CONFIGURABLE_ACCEPTANCE_SCORE,
            minimumNoveltySubtotal: MIN_CONFIGURABLE_NOVELTY_SUBTOTAL
        })

        const report = scoreTopicPlan({
            comparison: comparison(0.72),
            sourceEvidence: [source],
            portfolioDiversity: 0.5,
            acceptanceScore: 1,
            minimumNoveltySubtotal: 2,
            now: new Date('2026-07-29T00:00:00.000Z')
        })
        expect(report.acceptanceScore).toBe(MIN_CONFIGURABLE_ACCEPTANCE_SCORE)
        expect(report.minimumNoveltySubtotal).toBe(MIN_CONFIGURABLE_NOVELTY_SUBTOTAL)
        // A 0.72-similar plan is a near-duplicate and stays rejected even at the
        // lowest threshold an operator is allowed to configure.
        expect(report.noveltySubtotal).toBeLessThan(MIN_CONFIGURABLE_NOVELTY_SUBTOTAL)
        expect(report.eligible).toBe(false)
    })

    it('accepts a novelty-dominant plan above 82 with all hard gates', () => {
        const report = scoreTopicPlan({
            idea: { ...alignedIdea, userDemandScore: 0.9, directionFitScore: 1, businessScore: 0.8 },
            comparison: comparison(0.05),
            sourceEvidence: [source],
            productEvidence: [],
            portfolioDiversity: 0.9,
            now: new Date('2026-07-29T00:00:00.000Z')
        })
        expect(report.totalScore).toBeGreaterThanOrEqual(82)
        expect(report.noveltySubtotal).toBeGreaterThanOrEqual(48)
        expect(report.eligible).toBe(true)
        expect(report.trustedSignals).toMatchObject({
            verifiedEvidenceCount: 1,
            userDemand: 0.81,
            evidenceAlignment: {
                version: EVIDENCE_ALIGNMENT_VERSION,
                passed: true
            }
        })
    })

    it('forces research when a plan is 80 or 81, regardless of other strengths', () => {
        const report = scoreTopicPlan({
            idea: { userDemandScore: 0.4, directionFitScore: 1, businessScore: 0.3 },
            comparison: comparison(0.5),
            sourceEvidence: [source],
            portfolioDiversity: 0.5,
            now: new Date('2026-07-29T00:00:00.000Z')
        })
        expect(report.totalScore).toBeLessThan(82)
        expect(report.hardGates.score).toBe(false)
        expect(report.eligible).toBe(false)
    })

    it('treats the same-domain cosine baseline as novel without weakening high-similarity collisions', () => {
        // Two housewares articles share a high cosine baseline purely by domain.
        // Charging that baseline as a collision cost a genuinely new topic ~16
        // points and put the 82-point gate out of reach for every candidate.
        expect(calibrateSemanticCollision(0.2)).toBe(0)
        expect(calibrateSemanticCollision(0.45)).toBe(0)
        expect(calibrateSemanticCollision(0.55)).toBe(0)
        expect(calibrateSemanticCollision(0.715)).toBe(0.5)
        expect(calibrateSemanticCollision(0.88)).toBe(1)
        expect(calibrateSemanticCollision(0.98)).toBe(1)

        // A realistically novel same-domain plan must now clear the gate.
        const sameDomainNovel = scoreTopicPlan({
            idea: alignedIdea,
            comparison: {
                ...comparison(0.45),
                lexical: { lexicalSimilarity: 0.15, sourceId: 'a' }
            },
            sourceEvidence: [source],
            portfolioDiversity: 0.7,
            now: new Date('2026-07-29T00:00:00.000Z')
        })
        expect(sameDomainNovel.totalScore).toBeGreaterThanOrEqual(82)
        expect(sameDomainNovel.eligible).toBe(true)

        const unrelatedComparison = comparison(0.35)
        unrelatedComparison.lexical.lexicalSimilarity = 0
        const unrelatedBaseline = scoreTopicPlan({
            comparison: unrelatedComparison,
            sourceEvidence: [source],
            portfolioDiversity: 0.9,
            now: new Date('2026-07-29T00:00:00.000Z')
        })
        expect(unrelatedBaseline.semanticCalibration).toMatchObject({
            rawTopicSimilarity: 0.35,
            rawPlanSimilarity: 0.35,
            calibratedTopicCollision: 0,
            calibratedPlanCollision: 0
        })
        expect(unrelatedBaseline.noveltySubtotal).toBe(65)

        const nearDuplicate = scoreTopicPlan({
            comparison: comparison(0.9),
            sourceEvidence: [source],
            portfolioDiversity: 1
        })
        expect(nearDuplicate.noveltySubtotal).toBeLessThan(48)
        expect(nearDuplicate.eligible).toBe(false)
    })

    it('blocks a semantic same-intent collision', () => {
        const input = comparison(0.05)
        input.topic = { topicSimilarity: 0.9, sameIntent: true, sourceId: 'collision' }
        const report = scoreTopicPlan({
            idea: { userDemandScore: 1, directionFitScore: 1, businessScore: 1 },
            comparison: input,
            sourceEvidence: [source],
            portfolioDiversity: 1
        })
        expect(report.hardGates.sameIntent).toBe(false)
        expect(report.eligible).toBe(false)
    })

    it('fails closed when a candidate has no exact verified evidence identity', () => {
        const report = scoreTopicPlan({
            idea: { userDemandScore: 1, directionFitScore: 1, businessScore: 1 },
            comparison: comparison(0),
            sourceEvidence: [],
            productEvidence: [],
            portfolioDiversity: 1
        })
        expect(report.totalScore).toBeLessThan(82)
        expect(report.hardGates.sources).toBe(false)
        expect(report.reasonCodes).toContain('topic_gate_sources_failed')
        expect(report.eligible).toBe(false)
    })

    it('detects unavailable evidence before a paid ideation call and proves verified evidence can reach 82', () => {
        expect(assessTopicPlanReachability({ sourceEvidence: [] })).toMatchObject({
            reachable: false,
            code: ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE,
            verifiedEvidenceCount: 0
        })
        expect(assessTopicPlanReachability({
            sourceEvidence: [source],
            acceptanceScore: 82,
            minimumNoveltySubtotal: 48,
            now: new Date('2026-07-29T00:00:00.000Z')
        })).toMatchObject({
            reachable: true,
            code: '',
            selectedEvidenceId: 'verified-market-signal-1'
        })
    })

    it('does not falsely skip a reachable fresh source behind an older demand leader', () => {
        const olderDemandLeader = {
            ...source,
            evidenceId: 'older-demand-leader',
            contentHash: 'b'.repeat(64),
            relevance: { ...source.relevance, totalScore: 0.25 },
            observedAt: new Date('2025-01-01T00:00:00.000Z')
        }
        const freshReachableSource = {
            ...source,
            evidenceId: 'fresh-reachable-source',
            contentHash: 'c'.repeat(64),
            relevance: { ...source.relevance, totalScore: 0.22 },
            observedAt: new Date('2026-07-28T00:00:00.000Z')
        }
        expect(assessTopicPlanReachability({
            sourceEvidence: [olderDemandLeader, freshReachableSource],
            now: new Date('2026-07-29T00:00:00.000Z')
        })).toMatchObject({
            reachable: true,
            selectedEvidenceId: 'fresh-reachable-source'
        })
    })

    it('binds the immutable score hash to candidate and persisted evidence identity', () => {
        const base = scoreTopicPlan({
            idea: { ideaId: 'candidate-1', topic: 'Nồi inox', angle: 'Chọn mua' },
            comparison: comparison(0.05),
            sourceEvidence: [source],
            portfolioDiversity: 1
        })
        const changedEvidence = scoreTopicPlan({
            idea: { ideaId: 'candidate-1', topic: 'Nồi inox', angle: 'Chọn mua' },
            comparison: comparison(0.05),
            sourceEvidence: [{ ...source, contentHash: 'b'.repeat(64) }],
            portfolioDiversity: 1
        })
        const changedCandidate = scoreTopicPlan({
            idea: { ideaId: 'candidate-2', topic: 'Nồi inox', angle: 'Chọn mua' },
            comparison: comparison(0.05),
            sourceEvidence: [source],
            portfolioDiversity: 1
        })
        expect(base.scoreHash).toMatch(/^[a-f0-9]{64}$/)
        expect(changedEvidence.scoreHash).not.toBe(base.scoreHash)
        expect(changedCandidate.scoreHash).not.toBe(base.scoreHash)
    })

    it('rejects cross-product and wrong-intent citations even when the source is globally trusted', () => {
        const cleaningIdea = {
            topic: 'Cách vệ sinh lưới vợt muỗi và bảo quản pin',
            angle: 'Làm sạch đúng cách sau mỗi lần sử dụng',
            primaryQuestion: 'Vệ sinh và bảo quản vợt muỗi thế nào?'
        }
        const pressureCleaning = evidence({
            evidenceId: 'pressure-cleaning',
            title: 'Cách vệ sinh nồi áp suất điện và bảo quản gioăng'
        })
        const report = scoreTopicPlan({
            idea: cleaningIdea,
            comparison: comparison(0.05),
            sourceEvidence: [pressureCleaning],
            productEvidence: [productEvidence],
            requireProductEvidence: true,
            portfolioDiversity: 1
        })

        expect(report.hardGates.evidenceAlignment).toBe(false)
        expect(report.reasonCodes).toContain('topic_gate_evidenceAlignment_failed')
        expect(report.eligible).toBe(false)

        const bentIdea = {
            topic: 'Lưới vợt muỗi bị cong: có an toàn để dùng tiếp?',
            angle: 'Kiểm tra biến dạng trước khi tiếp tục sử dụng',
            primaryQuestion: 'Lưới bị cong có gây nguy hiểm không?'
        }
        const selectionOnly = evidence({
            evidenceId: 'mosquito-selection',
            title: 'Kinh nghiệm chọn mua vợt muỗi an toàn cho gia đình'
        })
        expect(assessTopicEvidenceAlignment({
            idea: bentIdea,
            sourceEvidence: [selectionOnly],
            productEvidence: [productEvidence]
        })).toMatchObject({
            passed: false,
            requiredIntent: 'troubleshooting',
            evidence: [{ productAligned: true, intentAligned: false, conditionAligned: false }]
        })
    })

    it('accepts Vietnamese maintenance and fault synonyms for the same product family', () => {
        const cleaning = assessTopicEvidenceAlignment({
            idea: {
                topic: 'Cách vệ sinh lưới vợt muỗi và bảo quản pin',
                angle: 'Chăm sóc vợt sau khi dùng',
                primaryQuestion: 'Vệ sinh vợt muỗi thế nào?'
            },
            sourceEvidence: [evidence({
                evidenceId: 'aligned-cleaning',
                title: 'Hướng dẫn làm sạch và cất giữ vợt bắt muỗi'
            })],
            productEvidence: [productEvidence]
        })
        expect(cleaning.passed).toBe(true)

        const powerFailure = assessTopicEvidenceAlignment({
            idea: {
                topic: 'Vợt muỗi không hoạt động: kiểm tra thế nào?',
                angle: 'Tìm nguyên nhân mất nguồn',
                primaryQuestion: 'Vì sao vợt muỗi không chạy?'
            },
            sourceEvidence: [evidence({
                evidenceId: 'aligned-power',
                title: 'Vợt bắt muỗi mất nguồn, không sạc: các bước kiểm tra'
            })],
            productEvidence: [productEvidence]
        })
        expect(powerFailure.passed).toBe(true)

        const deformation = assessTopicEvidenceAlignment({
            idea: {
                topic: 'Lưới vợt muỗi bị cong: có an toàn để dùng tiếp?',
                angle: 'Kiểm tra biến dạng trước khi dùng',
                primaryQuestion: 'Khi nào phải ngừng dùng?'
            },
            sourceEvidence: [evidence({
                evidenceId: 'aligned-deformation',
                title: 'Lưới vợt muỗi bị móp hoặc biến dạng: khi nào phải ngừng dùng'
            })],
            productEvidence: [productEvidence]
        })
        expect(deformation.passed).toBe(true)
    })

    it('drops an unrelated citation instead of rejecting a candidate its other sources support', () => {
        const idea = {
            topic: 'Vợt muỗi không hoạt động: kiểm tra thế nào?',
            angle: 'Khắc phục tình trạng mất nguồn',
            primaryQuestion: 'Vì sao vợt muỗi không chạy?'
        }
        const aligned = evidence({
            evidenceId: 'aligned-vot',
            title: 'Vợt muỗi mất nguồn, không sạc: cách kiểm tra'
        })
        const unrelated = evidence({
            evidenceId: 'unrelated-pressure',
            title: 'Nồi áp suất mất nguồn: nguyên nhân và cách khắc phục'
        })
        const alignment = assessTopicEvidenceAlignment({
            idea,
            sourceEvidence: [aligned, unrelated],
            productEvidence: [productEvidence]
        })
        // The ideation agent routinely over-cites. The unrelated source must be
        // excluded from every trusted signal and from what the writer may later
        // read, but it must not veto a candidate the remaining source supports.
        expect(alignment.passed).toBe(true)
        expect(alignment.alignedEvidenceCount).toBe(1)
        expect(alignment.evidenceCount).toBe(2)
        expect(alignment.alignedEvidenceIds).toEqual(['aligned-vot'])
        expect(alignment.droppedEvidenceIds).toEqual(['unrelated-pressure'])

        // With no supporting source left, the candidate still fails closed.
        expect(assessTopicEvidenceAlignment({
            idea,
            sourceEvidence: [unrelated],
            productEvidence: [productEvidence]
        })).toMatchObject({ passed: false, alignedEvidenceCount: 0 })
    })

    it('requires exact verified product evidence for product-led roadmaps', () => {
        const idea = {
            topic: 'Cách chọn vợt muỗi phù hợp cho gia đình',
            angle: 'Lựa chọn theo nhu cầu sử dụng',
            primaryQuestion: 'Nên chọn vợt muỗi thế nào?'
        }
        const alignedSource = evidence({
            evidenceId: 'vot-selection',
            title: 'Cách chọn mua vợt muỗi phù hợp và an toàn'
        })
        const missingProduct = scoreTopicPlan({
            idea,
            comparison: comparison(0.05),
            sourceEvidence: [alignedSource],
            productEvidence: [],
            requireProductEvidence: true,
            portfolioDiversity: 1
        })
        expect(missingProduct.hardGates.products).toBe(false)
        expect(missingProduct.reasonCodes).toContain('topic_gate_products_failed')

        const exactProduct = scoreTopicPlan({
            idea,
            comparison: comparison(0.05),
            sourceEvidence: [alignedSource],
            productEvidence: [productEvidence],
            requireProductEvidence: true,
            portfolioDiversity: 1
        })
        expect(exactProduct.hardGates.products).toBe(true)
        expect(exactProduct.hardGates.evidenceAlignment).toBe(true)
        expect(exactProduct.eligible).toBe(true)
    })

    it('does not accept URL or query metadata as semantic evidence', () => {
        const metadataOnly = {
            ...evidence({ evidenceId: 'metadata-only', title: '', snippet: '' }),
            sourceName: 'Vợt muỗi không hoạt động',
            canonicalUrl: 'https://example.com/vot-muoi-khong-hoat-dong',
            queryText: 'vợt muỗi không hoạt động'
        }
        const alignment = assessTopicEvidenceAlignment({
            idea: {
                topic: 'Vợt muỗi không hoạt động',
                angle: 'Tìm nguyên nhân mất nguồn',
                primaryQuestion: 'Vì sao vợt muỗi không chạy?'
            },
            sourceEvidence: [metadataOnly],
            productEvidence: [productEvidence]
        })
        expect(alignment.passed).toBe(false)
    })

    it('binds the score hash to questions and semantic source text', () => {
        const alignedSource = evidence({
            evidenceId: 'hash-source',
            title: 'Cách chọn nồi inox cho gia đình',
            snippet: 'Đối chiếu nhu cầu và kích thước nồi.'
        })
        const base = scoreTopicPlan({
            idea: { ...alignedIdea, ideaId: 'hash-candidate' },
            comparison: comparison(0.05),
            sourceEvidence: [alignedSource],
            portfolioDiversity: 1
        })
        const changedQuestion = scoreTopicPlan({
            idea: {
                ...alignedIdea,
                ideaId: 'hash-candidate',
                primaryQuestion: 'Nồi inox nào phù hợp với gia đình bốn người?'
            },
            comparison: comparison(0.05),
            sourceEvidence: [alignedSource],
            portfolioDiversity: 1
        })
        const changedSnippet = scoreTopicPlan({
            idea: { ...alignedIdea, ideaId: 'hash-candidate' },
            comparison: comparison(0.05),
            sourceEvidence: [{ ...alignedSource, snippet: `${alignedSource.snippet} Có thêm dữ liệu mới.` }],
            portfolioDiversity: 1
        })
        expect(changedQuestion.scoreHash).not.toBe(base.scoreHash)
        expect(changedSnippet.scoreHash).not.toBe(base.scoreHash)
    })
})
