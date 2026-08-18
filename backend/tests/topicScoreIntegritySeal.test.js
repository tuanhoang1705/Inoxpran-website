import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    computeItemScoreHash,
    hasCurrentEvidenceIntegrity,
    hasValidTopicScoreIntegrity
} = require('../src/services/contentOperations/blogTopicRoadmap.service')
const {
    EVIDENCE_ALIGNMENT_VERSION,
    RUBRIC_VERSION
} = require('../src/services/contentOperations/topicRoadmapScoring.service')
const { SOURCE_RELEVANCE_VERSION } = require('../src/services/contentOperations/sourceRelevanceScoring.service')
const { INDEX_VERSION } = require('../src/services/contentOperations/blogNoveltyIndex.service')

const evidence = (id, { version = SOURCE_RELEVANCE_VERSION, score = 0.82 } = {}) => ({
    evidenceId: id,
    sourceId: `source-${id}`,
    contentHash: 'c'.repeat(64),
    relevanceVersion: version,
    relevanceScore: score,
    title: `Vệ sinh nồi áp suất điện tử ${id}`,
    snippet: 'Hướng dẫn vệ sinh gioăng và đường xả áp sau mỗi lần nấu.',
    observedAt: new Date('2026-08-01T00:00:00.000Z')
})

// Shaped like a row the refill actually writes: evidence already narrowed to what
// the alignment gate trusted, text fields already truncated.
const persistedItem = ({ marketEvidence = [evidence('ev-1')] } = {}) => {
    const item = {
        topic: 'Vệ sinh gioăng và đường xả áp của nồi áp suất điện tử INP6903',
        angle: 'Hướng dẫn theo trình tự kiểm tra trước và sau khi nấu.',
        primaryKeyword: 'vệ sinh gioăng nồi áp suất INP6903',
        secondaryKeywords: ['gioăng nồi áp suất', 'đường xả áp'],
        searchIntent: 'informational',
        topicAxis: 'care',
        primaryQuestion: 'Vệ sinh gioăng và đường xả áp của INP6903 thế nào cho đúng?',
        supportingQuestions: ['Bao lâu nên kiểm tra gioăng một lần?'],
        userProblems: ['Không biết gioăng đã cần thay hay chưa'],
        marketEvidence,
        productEvidence: [{
            productId: 'p-6903',
            name: 'Nồi áp suất điện tử INOXPRAN INP6903',
            catalogEvidenceHash: 'd'.repeat(64),
            factKeys: ['capacity', 'material']
        }],
        candidateProvenance: { candidateId: 'candidate-6903' },
        scores: {
            totalScore: 88.98,
            noveltySubtotal: 61.2,
            rubricVersion: RUBRIC_VERSION,
            corpusVersion: INDEX_VERSION,
            corpusHash: 'e'.repeat(64),
            corpusCount: 50,
            scoreHash: '',
            semanticCalibration: {},
            hardGates: {
                corpusVersion: true,
                score: true,
                novelty: true,
                sameIntent: true,
                direction: true,
                sources: true,
                evidenceAlignment: true,
                products: true
            },
            hardGatesPassed: true,
            nearestCollisions: {},
            reasonCodes: [],
            scoreBreakdown: {},
            trustedSignals: {
                productEvidenceRequired: false,
                evidenceAlignment: { version: EVIDENCE_ALIGNMENT_VERSION, passed: true }
            },
            penalties: []
        }
    }
    item.scores.scoreHash = computeItemScoreHash(item)
    return item
}

describe('topic score integrity seal', () => {
    it('accepts a row the moment after it was written', () => {
        // The invariant the queue depends on. It used to fail whenever evidence
        // was filtered before persistence: the hash had been taken over the
        // unfiltered set, so the topic was discarded at claim time as
        // score_integrity_failed and the ready queue drained to nothing.
        expect(hasValidTopicScoreIntegrity(persistedItem(), {})).toBe(true)
    })

    it('still accepts a row whose evidence was narrowed before it was sealed', () => {
        const narrowed = persistedItem({ marketEvidence: [evidence('ev-2')] })
        expect(narrowed.marketEvidence).toHaveLength(1)
        expect(hasValidTopicScoreIntegrity(narrowed, {})).toBe(true)
    })

    it('rejects a row whose evidence changed after sealing', () => {
        const item = persistedItem()
        item.marketEvidence = [...item.marketEvidence, evidence('ev-smuggled')]
        expect(hasValidTopicScoreIntegrity(item, {})).toBe(false)
    })

    it('rejects a row whose topic was rewritten after sealing', () => {
        const item = persistedItem()
        item.topic = 'Một chủ đề hoàn toàn khác'
        expect(hasValidTopicScoreIntegrity(item, {})).toBe(false)
    })

    it('keeps a topic alive when one of several citations went stale', () => {
        // Requiring every citation to be current retired researched topics over a
        // single outdated source.
        const item = persistedItem({
            marketEvidence: [evidence('ev-fresh'), evidence('ev-stale', { version: 'source-relevance-v3-2026-07-01' })]
        })
        expect(hasCurrentEvidenceIntegrity(item)).toBe(true)
        expect(hasValidTopicScoreIntegrity(item, {})).toBe(true)
    })

    it('rejects a row with no usable citation at all', () => {
        expect(hasCurrentEvidenceIntegrity({ marketEvidence: [] })).toBe(false)
        expect(hasCurrentEvidenceIntegrity({
            marketEvidence: [evidence('ev-stale', { version: 'source-relevance-v3-2026-07-01' })]
        })).toBe(false)
    })
})
