import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { scoreDraftOriginality } = require('../src/services/contentOperations/draftOriginalityScoring.service')

const comparison = (similarity) => ({
    indexVersion: 'blog-novelty-v2-2026-07-25',
    corpusHash: 'corpus',
    comparedCount: 140,
    lexical: { lexicalSimilarity: similarity },
    body: { bodySimilarity: similarity },
    chunk: { chunkSimilarity: similarity },
    heading: { headingSimilarity: similarity },
    structure: { structureSimilarity: similarity }
})

describe('draft originality v2 scoring', () => {
    it('accepts a deeply different full draft above 82', () => {
        const report = scoreDraftOriginality({ comparison: comparison(0.05), informationGain: 0.9 })
        expect(report.totalScore).toBeGreaterThanOrEqual(82)
        expect(report.eligible).toBe(true)
    })

    it('blocks semantic paraphrasing despite different words', () => {
        const input = comparison(0.2)
        input.lexical.lexicalSimilarity = 0.1
        input.body.bodySimilarity = 0.9
        input.chunk.chunkSimilarity = 0.92
        const report = scoreDraftOriginality({ comparison: input, informationGain: 0.1 })
        expect(report.eligible).toBe(false)
        expect(report.hardGates.semanticWhole).toBe(false)
        expect(report.hardGates.semanticChunk).toBe(false)
    })
})
