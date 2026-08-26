import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    TopicIdeationOrchestratorService,
    buildTopicSessionKey,
    compactNoveltyAvoidance,
    extractCriticFeedback
} = require('../src/services/contentOperations/topicIdeationOrchestrator.service')
const { SOURCE_RELEVANCE_VERSION } = require('../src/services/contentOperations/sourceRelevanceScoring.service')

const runStore = () => {
    const doc = { _id: 'run-1' }
    return {
        doc,
        findOneAndUpdate: vi.fn(async () => doc),
        updateOne: vi.fn(async () => ({ modifiedCount: 1 }))
    }
}

const adapterFor = (responses) => {
    const calls = []
    return {
        calls,
        run: vi.fn(async ({ agentId }) => {
            calls.push(agentId)
            const output = responses[agentId] ? responses[agentId](calls.filter((id) => id === agentId).length) : {}
            return { output, audit: { agentId, purpose: agentId, resolvedModel: 'openclaw-topic-pro', requestHash: 'r', responseHash: 's', sessionHash: 't', startedAt: new Date(), completedAt: new Date(), durationMs: 1, usage: null } }
        })
    }
}

const baseArgs = {
    scheduleId: 's', roadmapId: 'r', directionRevision: 1, generation: 1,
    brief: {
        marketEvidence: {
            status: 'complete',
            signals: [{
                evidenceId: 'verified-market-signal-1',
                contentHash: 'verified-market-content-hash-1',
                confidence: 'high',
                classification: 'observed',
                observedAt: new Date('2026-07-20T00:00:00.000Z'),
                relevance: {
                    version: SOURCE_RELEVANCE_VERSION,
                    totalScore: 0.9,
                    eligibleForIdeation: true
                }
            }]
        }
    },
    queryPack: { contextHash: 'ctx', queries: [] }, corpusManifest: { corpusHash: 'c' }
}

describe('topic ideation orchestrator', () => {
    it('uses stable bounded per-run session slots without timestamp or round churn', async () => {
        const RunModel = runStore()
        const adapter = adapterFor({
            'market-insight-analyst': () => ({}),
            'keyword-researcher': () => ({}),
            'content-ideator': () => ({ ideas: [{ topic: 'Stable session candidate' }] })
        })
        const service = new TopicIdeationOrchestratorService({
            RunModel,
            agentAdapter: adapter,
            scorer: async () => ({ eligible: true, totalScore: 90, noveltySubtotal: 52, reasonCodes: [] }),
            now: () => new Date()
        })

        await service.run(baseArgs)
        const firstRunKeys = adapter.run.mock.calls.slice(0, 4).map(([request]) => request.sessionKey)
        await service.run(baseArgs)
        const secondRunKeys = adapter.run.mock.calls.slice(4, 8).map(([request]) => request.sessionKey)

        expect(secondRunKeys).toEqual(firstRunKeys)
        expect(new Set(firstRunKeys)).toHaveProperty('size', 4)
        expect(firstRunKeys.every((key) => key.startsWith('topic:run-1:'))).toBe(true)
        expect(firstRunKeys.every((key) => key.length <= 164 && !key.includes('2026-'))).toBe(true)
        expect(buildTopicSessionKey({
            runId: 'x'.repeat(500),
            agentId: 'content-ideator',
            purpose: 'candidate-ideation-1'
        }).length).toBeLessThanOrEqual(164)
    })

    it('accepts only candidates the backend scores at 82 and records real invocations', async () => {
        const RunModel = runStore()
        const adapter = adapterFor({
            'market-insight-analyst': () => ({ queryResults: [] }),
            'keyword-researcher': () => ({ queryResults: [] }),
            'content-ideator': () => ({
                ideas: [
                    { title: 'A', intent: 'commercial investigation', secondaryKeywords: ['a-keyword'], readerPromise: 'A promise' },
                    { topic: 'B' }
                ]
            })
        })
        const scorer = vi.fn(async ({ idea }) => ({ eligible: idea.topic === 'A', totalScore: idea.topic === 'A' ? 88 : 60, noveltySubtotal: idea.topic === 'A' ? 52 : 30, reasonCodes: [] }))
        const service = new TopicIdeationOrchestratorService({ RunModel, agentAdapter: adapter, scorer, now: () => new Date() })
        const result = await service.run(baseArgs)
        expect(result.accepted.map((entry) => entry.idea.topic)).toEqual(['A'])
        expect(result.accepted[0].idea).toMatchObject({
            searchIntent: 'commercial investigation',
            keywords: ['a-keyword'],
            rationale: 'A promise',
            userDemandScore: 0.55,
            businessScore: 0.5
        })
        expect(adapter.calls).toContain('content-ideator')
        const ideationCalls = adapter.run.mock.calls
            .map(([request]) => request)
            .filter((request) => request.agentId === 'content-ideator')
        expect(ideationCalls).toHaveLength(2)
        expect(ideationCalls.map((request) => request.input.requiredCandidateCount)).toEqual([12, 12])
        expect(ideationCalls.map((request) => request.purpose)).toEqual(['candidate-ideation-1', 'candidate-ideation-2'])
        expect(RunModel.findOneAndUpdate).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                $set: expect.objectContaining({ status: 'running', terminalCode: '', invocations: [], sourceHealth: [] })
            }),
            expect.any(Object)
        )
        expect(RunModel.updateOne).toHaveBeenCalled()
    })

    it('uses the authoritative batch scorer once for a candidate round', async () => {
        const RunModel = runStore()
        const adapter = adapterFor({
            'market-insight-analyst': () => ({}),
            'keyword-researcher': () => ({}),
            'content-ideator': () => ({
                ideas: [
                    { topic: 'Batch candidate A', marketEvidenceIds: ['verified-market-signal-1'] },
                    { topic: 'Batch candidate B', marketEvidenceIds: ['verified-market-signal-1'] }
                ]
            })
        })
        const scorer = vi.fn()
        const scoreBatch = vi.fn(async ({ ideas }) => ideas.map((idea) => ({
            eligible: idea.topic === 'Batch candidate A',
            totalScore: idea.topic === 'Batch candidate A' ? 86 : 70,
            noveltySubtotal: idea.topic === 'Batch candidate A' ? 55 : 42,
            reasonCodes: []
        })))
        const service = new TopicIdeationOrchestratorService({
            RunModel,
            agentAdapter: adapter,
            scorer,
            scoreBatch,
            now: () => new Date()
        })

        const result = await service.run(baseArgs)
        expect(result.accepted[0].idea.topic).toBe('Batch candidate A')
        expect(scoreBatch).toHaveBeenCalledTimes(1)
        expect(scoreBatch.mock.calls[0][0].ideas).toHaveLength(2)
        expect(scorer).not.toHaveBeenCalled()
    })

    it('persists bounded source health before the first agent call', async () => {
        const RunModel = runStore()
        const adapter = adapterFor({
            'market-insight-analyst': () => ({}),
            'keyword-researcher': () => ({}),
            'content-ideator': () => ({ ideas: [{ topic: 'A' }] })
        })
        const service = new TopicIdeationOrchestratorService({
            RunModel,
            agentAdapter: adapter,
            scorer: async () => ({ eligible: true, totalScore: 90, noveltySubtotal: 52, reasonCodes: [] }),
            now: () => new Date()
        })
        await service.run({
            ...baseArgs,
            sourceHealth: [{ source: 'market', status: 'partial', detail: 'source_http_503' }]
        })
        expect(RunModel.findOneAndUpdate.mock.calls[0][1].$set.sourceHealth).toEqual([
            { source: 'market', status: 'partial', detail: 'source_http_503', lastSuccessAt: null, lastFailureAt: null }
        ])
        expect(adapter.run).toHaveBeenCalled()
    })

    it('compacts full catalog context before sending it to topic agents', async () => {
        const RunModel = runStore()
        const adapter = adapterFor({
            'market-insight-analyst': () => ({}),
            'keyword-researcher': () => ({}),
            'content-ideator': () => ({ ideas: [{ topic: 'A' }] })
        })
        const oversizedCards = Array.from({ length: 40 }, (_, index) => ({
            productId: `product-${index}`,
            name: `Product ${index}`,
            safeFacts: Array.from({ length: 30 }, (_, fact) => `${fact}-${'x'.repeat(300)}`),
            evidenceKeys: Array.from({ length: 30 }, (_, key) => `evidence-${index}-${key}`)
        }))
        const service = new TopicIdeationOrchestratorService({
            RunModel,
            agentAdapter: adapter,
            scorer: async () => ({ eligible: true, totalScore: 90, noveltySubtotal: 52, reasonCodes: [] }),
            now: () => new Date()
        })
        await service.run({
            ...baseArgs,
            brief: { ...baseArgs.brief, direction: 'x'.repeat(2_000), productCoverage: { cards: oversizedCards } },
            queryPack: { ...baseArgs.queryPack, queries: Array.from({ length: 30 }, (_, index) => ({ queryId: `q-${index}`, anchors: Array(50).fill('anchor') })) }
        })
        const firstRequest = adapter.run.mock.calls[0][0]
        expect(firstRequest.input.brief.productCoverage.cards).toHaveLength(12)
        expect(firstRequest.input.brief.productCoverage.cards[0].safeFacts).toHaveLength(4)
        expect(firstRequest.input.queryPack.queries).toHaveLength(8)
        expect(JSON.stringify(firstRequest.input).length).toBeLessThan(30_000)
    })

    it('uses effective thresholds and ignores an agent score below policy', async () => {
        const RunModel = runStore()
        const adapter = adapterFor({
            'market-insight-analyst': () => ({}),
            'keyword-researcher': () => ({}),
            'content-ideator': () => ({ ideas: [{ ideaId: 'borderline', topic: 'A' }] }),
            'originality-reviewer': () => ({ feedback: [] })
        })
        const service = new TopicIdeationOrchestratorService({
            RunModel,
            agentAdapter: adapter,
            scorer: async () => ({ eligible: true, totalScore: 93, noveltySubtotal: 60, reasonCodes: [] }),
            policy: { acceptanceScore: 94, minimumNoveltySubtotal: 55 },
            maxRounds: 1,
            now: () => new Date()
        })
        await expect(service.run(baseArgs)).rejects.toMatchObject({ code: 'ROADMAP_NO_ACCEPTABLE_TOPIC' })
        const terminal = RunModel.updateOne.mock.calls.at(-1)[1].$set
        expect(terminal).toMatchObject({
            status: 'completed',
            outcome: 'no_change',
            outcomeCode: 'ROADMAP_NO_ACCEPTABLE_TOPIC',
            errorCode: ''
        })
    })

    it('calls the novelty critic and fails closed when nothing reaches 82', async () => {
        const RunModel = runStore()
        const adapter = adapterFor({
            'market-insight-analyst': () => ({}),
            'keyword-researcher': () => ({}),
            'content-ideator': () => ({ ideas: [{ ideaId: 'weak', topic: 'B' }] }),
            'originality-reviewer': () => ({
                diagnosis: {
                    primary: 'The current cluster is too generic',
                    patterns: ['catalog overview']
                },
                failedDimensions: ['topic_gate_novelty'],
                recommendation: {
                    action: 'regenerate_after_research',
                    steps: ['Use a concrete post-purchase problem']
                },
                decision: 'skip_current_batch_and_regenerate_after_query_cleanup'
            })
        })
        const scorer = vi.fn(async () => ({ eligible: false, totalScore: 70, reasonCodes: ['topic_gate_novelty_failed'] }))
        const service = new TopicIdeationOrchestratorService({ RunModel, agentAdapter: adapter, scorer, maxRounds: 3, now: () => new Date() })
        await expect(service.run(baseArgs)).rejects.toMatchObject({ code: 'ROADMAP_NO_ACCEPTABLE_TOPIC' })
        expect(adapter.calls).toContain('originality-reviewer')
        expect(adapter.run).toHaveBeenCalledTimes(12)
        const retryIdeation = adapter.run.mock.calls
            .map(([request]) => request)
            .filter((request) => request.agentId === 'content-ideator')[2]
        expect(retryIdeation.input.criticFeedback[0]).toMatchObject({
            summary: 'The current cluster is too generic',
            recommendation: 'regenerate_after_research',
            decision: 'skip_current_batch_and_regenerate_after_query_cleanup',
            failedDimensions: ['topic_gate_novelty'],
            patternsToAvoid: ['catalog overview'],
            guidance: ['Use a concrete post-purchase problem']
        })
    })

    it('feeds bounded backend collision plans directly into round-aware retries', async () => {
        const RunModel = runStore()
        const adapter = adapterFor({
            'market-insight-analyst': () => ({}),
            'keyword-researcher': () => ({}),
            'content-ideator': (callNumber) => ({
                ideas: [{
                    topic: `Distinct topic ${callNumber}`,
                    angle: `Distinct angle ${callNumber}`,
                    primaryQuestion: `Distinct question ${callNumber}?`,
                    categoryKey: callNumber % 2 ? 'care' : 'knowledge',
                    productScope: callNumber % 2 ? 'dien' : 'kitchen',
                    searchIntent: callNumber % 2 ? 'troubleshooting' : 'decision support',
                    articleType: callNumber % 2 ? 'checklist' : 'matrix',
                    marketEvidenceIds: ['verified-market-signal-1']
                }]
            }),
            'originality-reviewer': () => ({ feedback: [] })
        })
        const scorer = vi.fn(async ({ idea }) => ({
            eligible: false,
            totalScore: 70,
            noveltySubtotal: 44,
            reasonCodes: ['topic_gate_score_failed', 'topic_gate_novelty_failed'],
            nearestCollisions: {
                topic: {
                    sourceType: 'blog',
                    sourceId: 'existing-blog',
                    title: `Existing collision for ${idea.topic}`,
                    topicSimilarity: 0.72,
                    sameIntent: true
                }
            }
        }))
        const service = new TopicIdeationOrchestratorService({
            RunModel,
            agentAdapter: adapter,
            scorer,
            maxRounds: 3,
            now: () => new Date()
        })

        await expect(service.run(baseArgs)).rejects.toMatchObject({
            code: 'ROADMAP_NO_ACCEPTABLE_TOPIC'
        })
        const ideationCalls = adapter.run.mock.calls
            .map(([request]) => request)
            .filter((request) => request.agentId === 'content-ideator')
        expect(ideationCalls).toHaveLength(4)
        expect(ideationCalls[2].input.batch.focus).not.toBe(ideationCalls[0].input.batch.focus)
        expect(ideationCalls[3].input.batch.focus).not.toBe(ideationCalls[2].input.batch.focus)
        expect(ideationCalls[2].input.noveltyAvoidance.priorPlans[0]).toMatchObject({
            topic: expect.stringContaining('Distinct topic'),
            categoryKey: expect.any(String),
            productScope: expect.any(String),
            searchIntent: expect.any(String),
            articleType: expect.any(String)
        })
        expect(ideationCalls[2].input.noveltyAvoidance.collisionTitles[0])
            .toContain('Existing collision')
        expect(ideationCalls[2].instructions).toContain('do not paraphrase')
        expect(ideationCalls[2].instructions).toContain('at least one supplied eligible market evidence ID')
        expect(JSON.stringify(ideationCalls[2].input).length).toBeLessThan(30_000)

        const terminal = RunModel.updateOne.mock.calls.at(-1)[1].$set
        expect(terminal.rejectedCandidates[0]).toMatchObject({
            categoryKey: expect.any(String),
            productScope: expect.any(String),
            searchIntent: expect.any(String),
            articleType: expect.any(String)
        })
        expect(terminal.invocations
            .filter((entry) => entry.agentId === 'content-ideator')
            .every((entry) => entry.candidateIds.length > 0)).toBe(true)
    })

    it('does not rescore an exact candidate repeated across batches or rounds', async () => {
        const RunModel = runStore()
        const adapter = adapterFor({
            'market-insight-analyst': () => ({}),
            'keyword-researcher': () => ({}),
            'content-ideator': () => ({
                ideas: [{
                    topic: 'The same repeated topic',
                    angle: 'The same angle',
                    marketEvidenceIds: ['verified-market-signal-1']
                }]
            }),
            'originality-reviewer': () => ({ feedback: [] })
        })
        const scorer = vi.fn(async () => ({
            eligible: false,
            totalScore: 60,
            noveltySubtotal: 35,
            reasonCodes: ['topic_gate_novelty_failed']
        }))
        const service = new TopicIdeationOrchestratorService({
            RunModel,
            agentAdapter: adapter,
            scorer,
            maxRounds: 2,
            now: () => new Date()
        })

        await expect(service.run(baseArgs)).rejects.toMatchObject({
            code: 'ROADMAP_NO_ACCEPTABLE_TOPIC'
        })
        expect(scorer).toHaveBeenCalledTimes(1)
    })

    it('bounds and ranks direct novelty avoidance data', () => {
        const rejected = Array.from({ length: 30 }, (_, index) => ({
            topic: `Rejected ${index} ${'x'.repeat(300)}`,
            angle: `Angle ${index} ${'y'.repeat(300)}`,
            primaryQuestion: `Question ${index}?`,
            categoryKey: 'care',
            productScope: 'dien',
            searchIntent: 'informational',
            articleType: 'guide',
            round: index % 3 + 1,
            nearestCollisions: {
                topic: {
                    title: index % 2 ? 'Frequent collision' : `Collision ${index}`,
                    sameIntent: index % 2 === 1
                }
            }
        }))
        const compacted = compactNoveltyAvoidance(rejected)
        expect(compacted.priorPlans).toHaveLength(12)
        expect(compacted.collisionTitles.length).toBeLessThanOrEqual(12)
        expect(compacted.collisionTitles[0]).toBe('Frequent collision')
        expect(compacted.priorPlans.every((entry) => entry.topic.length <= 240)).toBe(true)
    })

    it('records missing verified evidence as a safe no-change before any paid agent call', async () => {
        const RunModel = runStore()
        const adapter = adapterFor({})
        const service = new TopicIdeationOrchestratorService({
            RunModel,
            agentAdapter: adapter,
            scorer: vi.fn(),
            now: () => new Date('2026-07-29T00:00:00.000Z')
        })

        await expect(service.run({ ...baseArgs, brief: {} })).rejects.toMatchObject({
            code: 'ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE'
        })
        expect(adapter.run).not.toHaveBeenCalled()
        expect(RunModel.updateOne.mock.calls.at(-1)[1].$set).toMatchObject({
            status: 'completed',
            outcome: 'no_change',
            outcomeCode: 'ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE',
            errorCode: '',
            roundCount: 0,
            callCount: 0
        })
    })

    it('normalizes the alternate critic shape emitted by Luna without object-string leakage', () => {
        const feedback = extractCriticFeedback({
            status: 'review_complete',
            overallDecision: 'skip_current_batch_and_regenerate',
            diagnosis: {
                primaryFailure: 'The ideas repeat catalog-first intent',
                pattern: 'generic catalog overview'
            },
            failedDimensions: ['topic_gate_novelty'],
            highestRisk: { candidateId: 'weak-1' },
            recommendation: {
                action: 'reposition',
                nextDirection: 'Start from a concrete post-purchase failure mode',
                promisingAngles: ['Troubleshoot one specific household problem']
            },
            requiredNextStep: 'Research the unresolved user question',
            dataQualityNotes: ['External demand evidence is unavailable']
        })

        expect(feedback).toEqual([expect.objectContaining({
            summary: 'The ideas repeat catalog-first intent',
            decision: 'skip_current_batch_and_regenerate',
            recommendation: 'reposition',
            failedDimensions: ['topic_gate_novelty'],
            patternsToAvoid: ['generic catalog overview'],
            guidance: [
                'Start from a concrete post-purchase failure mode',
                'Troubleshoot one specific household problem',
                'Research the unresolved user question',
                'External demand evidence is unavailable'
            ]
        })])
        expect(JSON.stringify(feedback)).not.toContain('[object Object]')
    })
})
