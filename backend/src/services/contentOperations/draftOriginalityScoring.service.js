'use strict'

const crypto = require('node:crypto')

const RUBRIC_VERSION = 'draft-originality-v2-2026-07-25'
const ACCEPTANCE_SCORE = 82
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0))
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

const scoreDraftOriginality = ({ comparison = {}, informationGain = null } = {}) => {
    const lexicalDifference = 1 - clamp01(comparison.lexical?.lexicalSimilarity)
    const semanticWholeDifference = 1 - clamp01(comparison.body?.bodySimilarity)
    const semanticChunkDifference = 1 - clamp01(comparison.chunk?.chunkSimilarity)
    const headingDifference = 1 - clamp01(comparison.heading?.headingSimilarity)
    const structuralDifference = 1 - clamp01(comparison.structure?.structureSimilarity)
    const gain = informationGain === null
        ? Math.min(semanticWholeDifference, semanticChunkDifference)
        : clamp01(informationGain)
    const dimensions = {
        lexicalVocabularyDifference: { raw: lexicalDifference, weight: 20 },
        semanticWholeBodyDifference: { raw: semanticWholeDifference, weight: 20 },
        semanticChunkDifference: { raw: semanticChunkDifference, weight: 18 },
        headingAndSectionPurposeDifference: { raw: headingDifference, weight: 12 },
        structuralDifference: { raw: structuralDifference, weight: 10 },
        informationGain: { raw: gain, weight: 20 }
    }
    Object.values(dimensions).forEach((item) => { item.contribution = Number((item.raw * item.weight).toFixed(4)) })
    const noveltySubtotal = Number(Object.values(dimensions).reduce((sum, item) => sum + item.contribution, 0).toFixed(2))
    const hardGates = {
        score: noveltySubtotal >= ACCEPTANCE_SCORE,
        lexical: clamp01(comparison.lexical?.lexicalSimilarity) < 0.82,
        semanticWhole: clamp01(comparison.body?.bodySimilarity) < 0.82,
        semanticChunk: clamp01(comparison.chunk?.chunkSimilarity) < 0.84,
        corpus: Number(comparison.comparedCount || 0) > 0 && Boolean(comparison.indexVersion)
    }
    const hardGatesPassed = Object.values(hardGates).every(Boolean)
    const report = {
        rubricVersion: RUBRIC_VERSION,
        totalScore: noveltySubtotal,
        noveltySubtotal,
        dimensions,
        hardGates,
        hardGatesPassed,
        eligible: hardGatesPassed,
        acceptanceScore: ACCEPTANCE_SCORE,
        corpusVersion: comparison.indexVersion || '',
        corpusHash: comparison.corpusHash || '',
        corpusCount: Number(comparison.comparedCount || 0),
        nearestCollisions: {
            lexical: comparison.lexical || null,
            body: comparison.body || null,
            chunk: comparison.chunk || null,
            heading: comparison.heading || null,
            structure: comparison.structure || null
        },
        reasonCodes: Object.entries(hardGates).filter(([, passed]) => !passed).map(([key]) => `draft_gate_${key}_failed`)
    }
    return { ...report, scoreHash: hash(report) }
}

module.exports = { ACCEPTANCE_SCORE, RUBRIC_VERSION, scoreDraftOriginality }
