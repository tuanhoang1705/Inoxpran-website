import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    hasValidTopicScoreIntegrity,
    retainAlignedMarketEvidence,
    retainBoundProductEvidence
} = require('../src/services/contentOperations/blogTopicRoadmap.service')
const {
    ACCEPTANCE_SCORE,
    MIN_NOVELTY_SUBTOTAL,
    assessTopicEvidenceAlignment,
    scoreTopicPlan
} = require('../src/services/contentOperations/topicRoadmapScoring.service')
const { SOURCE_RELEVANCE_VERSION } = require('../src/services/contentOperations/sourceRelevanceScoring.service')
const { INDEX_VERSION } = require('../src/services/contentOperations/blogNoveltyIndex.service')

const mosquitoIdea = {
    ideaId: 'candidate-mosquito',
    topic: 'Vợt muỗi không hoạt động: kiểm tra thế nào?',
    angle: 'Khắc phục tình trạng mất nguồn',
    primaryQuestion: 'Vì sao vợt muỗi không chạy?',
    keywords: ['vợt muỗi'],
    supportingQuestions: [],
    userProblems: []
}
const marketSignal = (evidenceId, title) => ({
    evidenceId,
    sourceId: `source-${evidenceId}`,
    contentHash: `${evidenceId}-hash`,
    signalHash: `${evidenceId}-hash`,
    title,
    snippet: '',
    confidence: 'high',
    classification: 'observed',
    observedAt: new Date('2026-08-01T00:00:00.000Z'),
    relevance: { version: SOURCE_RELEVANCE_VERSION, totalScore: 0.8, eligibleForIdeation: true }
})
const alignedSignal = marketSignal('aligned-vot', 'Vợt muỗi mất nguồn, không sạc: cách kiểm tra')
const straySignal = marketSignal('stray-pressure', 'Nồi áp suất mất nguồn: nguyên nhân và cách khắc phục')
const mosquitoProduct = {
    productId: 'product-mosquito',
    name: 'Vợt muỗi thông minh INP7901',
    sku: 'INP7901',
    category: 'vợt muỗi',
    catalogEvidenceHash: 'f'.repeat(64),
    eligible: true
}
const cookerProduct = {
    productId: 'product-cooker',
    name: 'Nồi áp suất inox 6L',
    sku: 'NAS6L',
    category: 'nồi áp suất',
    catalogEvidenceHash: 'e'.repeat(64),
    eligible: true
}

describe('roadmap evidence retention', () => {
    // The writer reads the persisted roadmap item, not the score report. Keeping
    // an over-cited source on the item is how a mosquito-racket article ended up
    // citing pressure-cooker sources even after the gate had discarded them.
    it('persists only the evidence the alignment gate trusted for this candidate', () => {
        const report = scoreTopicPlan({
            idea: mosquitoIdea,
            comparison: {
                indexVersion: INDEX_VERSION,
                comparedCount: 40,
                lexical: { lexicalSimilarity: 0.1 },
                topic: { topicSimilarity: 0.3, sameIntent: false },
                plan: { planSimilarity: 0.3 }
            },
            sourceEvidence: [alignedSignal, straySignal],
            productEvidence: [mosquitoProduct, cookerProduct],
            requireProductEvidence: true,
            now: new Date('2026-08-04T00:00:00.000Z')
        })

        expect(report.eligible).toBe(true)
        expect(retainAlignedMarketEvidence(
            [{ evidenceId: 'aligned-vot' }, { evidenceId: 'stray-pressure' }],
            report
        )).toEqual([{ evidenceId: 'aligned-vot' }])
        expect(retainBoundProductEvidence(
            [{ productId: 'product-mosquito' }, { productId: 'product-cooker' }],
            report
        )).toEqual([{ productId: 'product-mosquito' }])
    })

    it('leaves evidence untouched when a report carries no alignment decision', () => {
        const evidence = [{ evidenceId: 'a' }, { evidenceId: 'b' }]
        expect(retainAlignedMarketEvidence(evidence, {})).toEqual(evidence)
        expect(retainBoundProductEvidence([{ productId: 'p' }], {})).toEqual([{ productId: 'p' }])
    })

    it('re-verifies a persisted item against the effective policy, not the compiled default', () => {
        const alignment = assessTopicEvidenceAlignment({
            idea: mosquitoIdea,
            sourceEvidence: [alignedSignal],
            productEvidence: [mosquitoProduct]
        })
        // An item scored under a deliberately relaxed policy must stay claimable
        // under that same policy, otherwise every claim retires its own item and
        // the roadmap deadlocks with an intermittent "no ready topic".
        const relaxedItem = {
            topic: mosquitoIdea.topic,
            angle: mosquitoIdea.angle,
            primaryQuestion: mosquitoIdea.primaryQuestion,
            secondaryKeywords: mosquitoIdea.keywords,
            marketEvidence: [{
                evidenceId: alignedSignal.evidenceId,
                contentHash: alignedSignal.contentHash,
                title: alignedSignal.title,
                relevanceVersion: SOURCE_RELEVANCE_VERSION,
                relevanceScore: 0.8
            }],
            productEvidence: [mosquitoProduct],
            candidateProvenance: { candidateId: mosquitoIdea.ideaId },
            scores: {
                scoreHash: 'a'.repeat(64),
                totalScore: 76,
                noveltySubtotal: 40,
                rubricVersion: 'stale-rubric',
                corpusVersion: INDEX_VERSION,
                hardGatesPassed: true,
                hardGates: { sources: true, products: true, evidenceAlignment: true },
                trustedSignals: { evidenceAlignment: alignment }
            }
        }

        // Below the audited default: rejected on score before anything else.
        expect(hasValidTopicScoreIntegrity(relaxedItem)).toBe(false)
        expect(ACCEPTANCE_SCORE).toBe(82)
        expect(MIN_NOVELTY_SUBTOTAL).toBe(48)

        // Under the relaxed policy the score no longer disqualifies it, so the
        // check falls through to the provenance rules it is really there to
        // enforce — here the superseded rubric.
        const relaxedPolicy = { acceptanceScore: 70, minimumNoveltySubtotal: 35 }
        expect(hasValidTopicScoreIntegrity(relaxedItem, relaxedPolicy)).toBe(false)
        expect(hasValidTopicScoreIntegrity(
            { ...relaxedItem, scores: { ...relaxedItem.scores, totalScore: 60, noveltySubtotal: 20 } },
            relaxedPolicy
        )).toBe(false)
    })
})
