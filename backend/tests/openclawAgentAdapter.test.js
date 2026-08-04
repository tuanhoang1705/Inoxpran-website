import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    DEFAULT_AGENT_RETRY_BASE_MS,
    DEFAULT_TRANSPORT_MAX_ATTEMPTS_PER_PHASE,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    OpenClawAgentAdapter,
    OpenClawAgentUnavailableError,
    boundedTimeout,
    computeRetryDelayMs,
    getAgentRetryConfig,
    getOpenClawTopicModelReadiness,
    isRetryableAgentFailure,
    parseRetryAfterMs,
    resolveGatewayUrl
} = require('../src/services/openclawAgentAdapter.service')

const baseEnv = {
    OPENCLAW_GATEWAY_HTTP_URL: 'http://app_openclaw:18789',
    OPENCLAW_GATEWAY_TOKEN: 'secret-token',
    OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS: 'openclaw-topic-pro',
    OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL: 'openclaw-topic-pro'
}

const okResponse = (output, model = 'openclaw-topic-pro') => ({
    ok: true,
    body: null,
    text: async () => JSON.stringify({
        model: 'openclaw/content-ideator',
        provider_model: model,
        usage: { total_tokens: 10 },
        output_text: JSON.stringify(output)
    })
})

const rawOutputResponse = (outputText, model = 'openclaw-topic-pro') => ({
    ok: true,
    body: null,
    text: async () => JSON.stringify({ model: 'openclaw/content-ideator', provider_model: model, usage: { total_tokens: 10 }, output_text: outputText })
})

describe('OpenClaw agent adapter', () => {
    it('keeps reasoning agents alive beyond the provider timeout within a bounded window', () => {
        expect(DEFAULT_TIMEOUT_MS).toBe(240_000)
        expect(MAX_TIMEOUT_MS).toBe(300_000)
        expect(boundedTimeout(undefined)).toBe(240_000)
        expect(boundedTimeout(600_000)).toBe(300_000)
    })

    it('bounds retry configuration and exposes deterministic backoff helpers', () => {
        expect(getAgentRetryConfig({})).toEqual({
            maxAttempts: DEFAULT_TRANSPORT_MAX_ATTEMPTS_PER_PHASE,
            maxTotalAttempts: DEFAULT_TRANSPORT_MAX_ATTEMPTS_PER_PHASE * 2,
            baseMs: DEFAULT_AGENT_RETRY_BASE_MS
        })
        expect(getAgentRetryConfig({
            OPENCLAW_AGENT_MAX_ATTEMPTS: '99',
            OPENCLAW_AGENT_RETRY_BASE_MS: '99'
        })).toEqual({ maxAttempts: 5, maxTotalAttempts: 10, baseMs: 100 })
        expect(getAgentRetryConfig({
            OPENCLAW_AGENT_TRANSPORT_MAX_ATTEMPTS_PER_PHASE: '2',
            OPENCLAW_AGENT_MAX_ATTEMPTS: '5'
        })).toEqual({
            maxAttempts: 2,
            maxTotalAttempts: 4,
            baseMs: DEFAULT_AGENT_RETRY_BASE_MS
        })
        expect(getAgentRetryConfig({
            OPENCLAW_AGENT_MAX_ATTEMPTS: '2.5',
            OPENCLAW_AGENT_RETRY_BASE_MS: 'not-a-number'
        })).toEqual({
            maxAttempts: DEFAULT_TRANSPORT_MAX_ATTEMPTS_PER_PHASE,
            maxTotalAttempts: DEFAULT_TRANSPORT_MAX_ATTEMPTS_PER_PHASE * 2,
            baseMs: DEFAULT_AGENT_RETRY_BASE_MS
        })
        expect(parseRetryAfterMs('2')).toBe(2_000)
        expect(parseRetryAfterMs('1.5')).toBeNull()
        expect(parseRetryAfterMs('31')).toBeNull()
        expect(computeRetryDelayMs({
            failedAttempt: 2,
            baseMs: 1_000,
            random: () => 0.5
        })).toBe(2_100)
        expect(computeRetryDelayMs({
            failedAttempt: 1,
            baseMs: 100,
            retryAfterMs: 2_000,
            random: () => 0
        })).toBe(2_000)
    })

    it('retries only the explicitly safe transient failure classes', () => {
        for (const status of [408, 425, 429, 500, 502, 503, 504]) {
            expect(isRetryableAgentFailure(`OPENCLAW_AGENT_HTTP_${status}`)).toBe(true)
        }
        expect(isRetryableAgentFailure('OPENCLAW_AGENT_GATEWAY_UNREACHABLE')).toBe(true)
        expect(isRetryableAgentFailure('OPENCLAW_AGENT_TIMEOUT')).toBe(true)
        expect(isRetryableAgentFailure('OPENCLAW_AGENT_HTTP_409')).toBe(false)
        expect(isRetryableAgentFailure('OPENCLAW_GATEWAY_AUTH_REJECTED')).toBe(false)
        expect(isRetryableAgentFailure('OPENCLAW_AGENT_RESOLVED_MODEL_MISMATCH')).toBe(false)
    })

    it('reports canonical allowlist readiness without exposing gateway credentials', () => {
        expect(getOpenClawTopicModelReadiness(baseEnv)).toEqual({
            ready: true,
            strict: true,
            allowedModels: ['openclaw-topic-pro'],
            expectedModel: 'openclaw-topic-pro',
            reasonCode: ''
        })
        expect(getOpenClawTopicModelReadiness({
            ...baseEnv,
            OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS: '',
            OPENCLAW_TOPIC_AGENT_STRICT_MODEL: 'false'
        })).toEqual({
            ready: false,
            strict: true,
            allowedModels: [],
            expectedModel: 'openclaw-topic-pro',
            reasonCode: 'OPENCLAW_AGENT_MODEL_ALLOWLIST_MISSING'
        })
        expect(getOpenClawTopicModelReadiness({
            ...baseEnv,
            OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL: ''
        })).toMatchObject({
            ready: false,
            reasonCode: 'OPENCLAW_AGENT_EXPECTED_MODEL_MISSING'
        })
        expect(getOpenClawTopicModelReadiness({
            ...baseEnv,
            OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL: 'unreviewed-model'
        })).toMatchObject({
            ready: false,
            reasonCode: 'OPENCLAW_AGENT_EXPECTED_MODEL_NOT_ALLOWED'
        })
    })

    it('rejects a public gateway host', () => {
        expect(() => resolveGatewayUrl({ OPENCLAW_GATEWAY_HTTP_URL: 'https://evil.example.com/v1/responses' }))
            .toThrow(OpenClawAgentUnavailableError)
    })

    it('rejects an agent outside the allowlist', async () => {
        const adapter = new OpenClawAgentAdapter({ fetchImpl: vi.fn(), envProvider: () => baseEnv })
        await expect(adapter.run({ agentId: 'publisher', purpose: 'x', input: {} })).rejects.toMatchObject({ code: 'OPENCLAW_AGENT_NOT_ALLOWED' })
    })

    it('returns parsed JSON with audit metadata and never leaks the token in the body', async () => {
        const fetchImpl = vi.fn(async (_url, options) => {
            expect(options.headers.authorization).toBe('Bearer secret-token')
            expect(options.headers['x-openclaw-agent-id']).toBe('content-ideator')
            expect(options.headers['x-openclaw-session-key']).toMatch(/^agent:content-ideator:topic-[a-f0-9]{32}$/)
            expect(options.body).not.toContain('secret-token')
            expect(options.redirect).toBe('error')
            return okResponse({ ideas: [{ ideaId: 'a' }] })
        })
        const adapter = new OpenClawAgentAdapter({ fetchImpl, envProvider: () => baseEnv, now: () => new Date('2026-07-25T00:00:00Z') })
        const result = await adapter.run({ agentId: 'content-ideator', purpose: 'candidate-ideation', input: { brief: 'x' } })
        expect(result.output.ideas[0].ideaId).toBe('a')
        expect(result.audit.resolvedModel).toBe('openclaw-topic-pro')
        expect(result.audit.providerResolvedModel).toBe('openclaw-topic-pro')
        expect(result.audit.providerResolvedModelSource).toBe('gateway_provider_metadata')
        expect(result.audit.requestedAlias).toBe('openclaw/content-ideator')
        expect(result.audit.requestedModel).toBe('openclaw/content-ideator')
        expect(result.audit.requestHash).toMatch(/^[a-f0-9]{64}$/)
        expect(result.audit.attemptCount).toBe(1)
        expect(result.audit).toMatchObject({
            maxAttemptsPerPhase: 3,
            maxTotalAttempts: 6,
            jsonRepairAttempted: false
        })
        expect(result.audit.attemptReceipts).toEqual([{
            attempt: 1,
            phase: 'primary',
            status: 200,
            code: 'OPENCLAW_AGENT_OK',
            durationMs: 0
        }])
    })

    it('retries transient HTTP failures with the exact same payload and session key', async () => {
        const sleepImpl = vi.fn(async () => {})
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'too early' } }), { status: 425 }))
            .mockResolvedValueOnce(okResponse({ ideas: [] }))
        const adapter = new OpenClawAgentAdapter({
            fetchImpl,
            sleepImpl,
            random: () => 0,
            envProvider: () => ({
                ...baseEnv,
                OPENCLAW_AGENT_MAX_ATTEMPTS: '3',
                OPENCLAW_AGENT_RETRY_BASE_MS: '100'
            })
        })

        const result = await adapter.run({
            agentId: 'content-ideator',
            purpose: 'candidate-ideation',
            sessionKey: 'stable-session',
            input: { brief: 'same bytes every time' }
        })

        expect(fetchImpl).toHaveBeenCalledTimes(3)
        expect(fetchImpl.mock.calls.map((call) => call[1].body)).toEqual([
            fetchImpl.mock.calls[0][1].body,
            fetchImpl.mock.calls[0][1].body,
            fetchImpl.mock.calls[0][1].body
        ])
        expect(new Set(fetchImpl.mock.calls.map((call) => call[1].headers['x-openclaw-session-key'])).size).toBe(1)
        expect(sleepImpl.mock.calls.map(([delay]) => delay)).toEqual([100, 200])
        expect(result.audit.attemptCount).toBe(3)
        expect(result.audit.attemptReceipts.map(({ status, code }) => ({ status, code }))).toEqual([
            { status: 503, code: 'OPENCLAW_AGENT_HTTP_503' },
            { status: 425, code: 'OPENCLAW_AGENT_HTTP_425' },
            { status: 200, code: 'OPENCLAW_AGENT_OK' }
        ])
        expect(JSON.stringify(result.audit)).not.toContain('secret-token')
    })

    it('honors a safe integer Retry-After header before retrying', async () => {
        const sleepImpl = vi.fn(async () => {})
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(
                JSON.stringify({ error: { message: 'rate limited' } }),
                { status: 429, headers: { 'retry-after': '2' } }
            ))
            .mockResolvedValueOnce(okResponse({ ideas: [] }))
        const adapter = new OpenClawAgentAdapter({
            fetchImpl,
            sleepImpl,
            random: () => 0,
            envProvider: () => ({
                ...baseEnv,
                OPENCLAW_AGENT_RETRY_BASE_MS: '100'
            })
        })

        await adapter.run({ agentId: 'content-ideator', purpose: 'x', input: {} })

        expect(sleepImpl).toHaveBeenCalledOnce()
        expect(sleepImpl).toHaveBeenCalledWith(2_000)
    })

    it('retries gateway reachability and timeout failures but remains bounded', async () => {
        const sleepImpl = vi.fn(async () => {})
        const timeoutError = Object.assign(new Error('request timed out'), { name: 'AbortError' })
        const fetchImpl = vi.fn()
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockRejectedValueOnce(timeoutError)
            .mockResolvedValueOnce(okResponse({ ideas: [] }))
        const adapter = new OpenClawAgentAdapter({
            fetchImpl,
            sleepImpl,
            random: () => 0,
            envProvider: () => ({
                ...baseEnv,
                OPENCLAW_AGENT_MAX_ATTEMPTS: '3',
                OPENCLAW_AGENT_RETRY_BASE_MS: '100'
            })
        })

        const result = await adapter.run({ agentId: 'content-ideator', purpose: 'x', input: {} })

        expect(fetchImpl).toHaveBeenCalledTimes(3)
        expect(sleepImpl.mock.calls.map(([delay]) => delay)).toEqual([100, 200])
        expect(result.audit.attemptReceipts.map(({ status, code }) => ({ status, code }))).toEqual([
            { status: null, code: 'OPENCLAW_AGENT_GATEWAY_UNREACHABLE' },
            { status: null, code: 'OPENCLAW_AGENT_TIMEOUT' },
            { status: 200, code: 'OPENCLAW_AGENT_OK' }
        ])
    })

    it('stops after the configured per-phase transport ceiling', async () => {
        const sleepImpl = vi.fn(async () => {})
        const fetchImpl = vi.fn(async () => new Response(
            JSON.stringify({ error: { message: 'still unavailable' } }),
            { status: 503 }
        ))
        const adapter = new OpenClawAgentAdapter({
            fetchImpl,
            sleepImpl,
            random: () => 0,
            envProvider: () => ({
                ...baseEnv,
                OPENCLAW_AGENT_TRANSPORT_MAX_ATTEMPTS_PER_PHASE: '2',
                OPENCLAW_AGENT_RETRY_BASE_MS: '100'
            })
        })

        const error = await adapter.run({
            agentId: 'content-ideator',
            purpose: 'x',
            input: {}
        }).catch((caught) => caught)

        expect(error).toMatchObject({ code: 'OPENCLAW_AGENT_HTTP_503' })
        expect(error.audit).toMatchObject({
            attemptCount: 2,
            maxAttemptsPerPhase: 2,
            maxTotalAttempts: 4,
            jsonRepairAttempted: false
        })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
        expect(sleepImpl).toHaveBeenCalledTimes(1)
    })

    it('never retries an unsafe 4xx response', async () => {
        const sleepImpl = vi.fn(async () => {})
        const fetchImpl = vi.fn(async () => new Response(
            JSON.stringify({ error: { message: 'conflict' } }),
            { status: 409 }
        ))
        const adapter = new OpenClawAgentAdapter({
            fetchImpl,
            sleepImpl,
            envProvider: () => ({
                ...baseEnv,
                OPENCLAW_AGENT_MAX_ATTEMPTS: '5'
            })
        })

        const error = await adapter.run({
            agentId: 'content-ideator',
            purpose: 'x',
            input: {}
        }).catch((caught) => caught)

        expect(error).toMatchObject({ code: 'OPENCLAW_AGENT_HTTP_409' })
        expect(error.audit).toMatchObject({
            status: 'failed',
            attemptCount: 1,
            errorCode: 'OPENCLAW_AGENT_HTTP_409'
        })
        expect(fetchImpl).toHaveBeenCalledOnce()
        expect(sleepImpl).not.toHaveBeenCalled()
        expect(JSON.stringify(error.audit)).not.toContain('secret-token')
    })

    it('retries one malformed agent JSON response with the original trusted input', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(rawOutputResponse('{"queryId":"missing-quote,"signals":[]}'))
            .mockResolvedValueOnce(okResponse({ queryResults: [], sourceProposals: [] }))
        const adapter = new OpenClawAgentAdapter({ fetchImpl, envProvider: () => baseEnv })

        const result = await adapter.run({
            agentId: 'market-insight-analyst',
            purpose: 'market-research',
            input: { queryPack: { queries: [{ queryId: 'safe-id' }] } }
        })

        expect(result.output).toEqual({ queryResults: [], sourceProposals: [] })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
        const firstRequest = JSON.parse(fetchImpl.mock.calls[0][1].body)
        const repairRequest = JSON.parse(fetchImpl.mock.calls[1][1].body)
        expect(repairRequest.input).toBe(firstRequest.input)
        expect(repairRequest.instructions).toContain('previous response for this exact request was not valid JSON')
        expect(repairRequest.instructions).toContain('Do not call tools')
    })

    it('keeps the single JSON-repair phase bounded while retrying its exact payload', async () => {
        const sleepImpl = vi.fn(async () => {})
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(rawOutputResponse('{"queryId":"missing-quote,"signals":[]}'))
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 }))
            .mockResolvedValueOnce(okResponse({ queryResults: [], sourceProposals: [] }))
        const adapter = new OpenClawAgentAdapter({
            fetchImpl,
            sleepImpl,
            random: () => 0,
            envProvider: () => ({
                ...baseEnv,
                OPENCLAW_AGENT_MAX_ATTEMPTS: '2',
                OPENCLAW_AGENT_RETRY_BASE_MS: '100'
            })
        })

        const result = await adapter.run({
            agentId: 'market-insight-analyst',
            purpose: 'market-research',
            input: { queryPack: { queries: [{ queryId: 'safe-id' }] } }
        })

        expect(fetchImpl).toHaveBeenCalledTimes(3)
        expect(fetchImpl.mock.calls[1][1].body).not.toBe(fetchImpl.mock.calls[0][1].body)
        expect(fetchImpl.mock.calls[2][1].body).toBe(fetchImpl.mock.calls[1][1].body)
        expect(new Set(fetchImpl.mock.calls.map((call) => call[1].headers['x-openclaw-session-key'])).size).toBe(1)
        expect(sleepImpl).toHaveBeenCalledWith(100)
        expect(result.audit.attemptCount).toBe(3)
        expect(result.audit).toMatchObject({
            maxAttemptsPerPhase: 2,
            maxTotalAttempts: 4,
            jsonRepairAttempted: true
        })
        expect(result.audit.attemptReceipts.map(({ phase, code }) => ({ phase, code }))).toEqual([
            { phase: 'primary', code: 'OPENCLAW_AGENT_INVALID_JSON' },
            { phase: 'json_repair', code: 'OPENCLAW_AGENT_HTTP_503' },
            { phase: 'json_repair', code: 'OPENCLAW_AGENT_OK' }
        ])
    })

    it('enforces the documented 2N hard ceiling across primary and JSON-repair phases', async () => {
        const sleepImpl = vi.fn(async () => {})
        const transientResponse = () => new Response(
            JSON.stringify({ error: { message: 'busy' } }),
            { status: 503 }
        )
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(transientResponse())
            .mockResolvedValueOnce(rawOutputResponse('{"queryId":"missing-quote,"signals":[]}'))
            .mockResolvedValueOnce(transientResponse())
            .mockResolvedValueOnce(transientResponse())
        const adapter = new OpenClawAgentAdapter({
            fetchImpl,
            sleepImpl,
            random: () => 0,
            envProvider: () => ({
                ...baseEnv,
                OPENCLAW_AGENT_TRANSPORT_MAX_ATTEMPTS_PER_PHASE: '2',
                OPENCLAW_AGENT_RETRY_BASE_MS: '100'
            })
        })

        const error = await adapter.run({
            agentId: 'market-insight-analyst',
            purpose: 'market-research',
            input: {}
        }).catch((caught) => caught)

        expect(error).toMatchObject({ code: 'OPENCLAW_AGENT_HTTP_503' })
        expect(error.audit).toMatchObject({
            attemptCount: 4,
            maxAttemptsPerPhase: 2,
            maxTotalAttempts: 4,
            jsonRepairAttempted: true
        })
        expect(fetchImpl).toHaveBeenCalledTimes(4)
        expect(fetchImpl.mock.calls[1][1].body).toBe(fetchImpl.mock.calls[0][1].body)
        expect(fetchImpl.mock.calls[2][1].body).not.toBe(fetchImpl.mock.calls[1][1].body)
        expect(fetchImpl.mock.calls[3][1].body).toBe(fetchImpl.mock.calls[2][1].body)
        expect(sleepImpl.mock.calls.map(([delay]) => delay)).toEqual([100, 100])
    })

    it('fails closed after one bounded malformed JSON retry', async () => {
        const fetchImpl = vi.fn(async () => rawOutputResponse('{"queryId":"still-broken,"signals":[]}'))
        const adapter = new OpenClawAgentAdapter({ fetchImpl, envProvider: () => baseEnv })

        await expect(adapter.run({
            agentId: 'market-insight-analyst',
            purpose: 'market-research',
            input: {}
        })).rejects.toMatchObject({ code: 'OPENCLAW_AGENT_INVALID_JSON' })
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('fails closed when the gateway-reported model does not match the reviewed pin', async () => {
        const fetchImpl = vi.fn(async () => okResponse({ ideas: [] }, 'cheap-nano'))
        const adapter = new OpenClawAgentAdapter({ fetchImpl, envProvider: () => baseEnv })
        await expect(adapter.run({ agentId: 'content-ideator', purpose: 'x', input: {} })).rejects.toMatchObject({ code: 'OPENCLAW_AGENT_RESOLVED_MODEL_MISMATCH' })
        expect(fetchImpl).toHaveBeenCalledOnce()
    })

    it('fails closed instead of treating malformed provider metadata as omitted', async () => {
        const fetchImpl = vi.fn(async () => okResponse({ ideas: [] }, 'invalid model id'))
        const adapter = new OpenClawAgentAdapter({ fetchImpl, envProvider: () => baseEnv })
        await expect(adapter.run({ agentId: 'content-ideator', purpose: 'x', input: {} }))
            .rejects.toMatchObject({ code: 'OPENCLAW_AGENT_RESOLVED_MODEL_INVALID' })
    })

    it('fails closed when strict mode has no canonical model allowlist', async () => {
        const fetchImpl = vi.fn(async () => okResponse({ ideas: [] }))
        const adapter = new OpenClawAgentAdapter({
            fetchImpl,
            envProvider: () => ({ ...baseEnv, OPENCLAW_TOPIC_ALLOWED_RESOLVED_MODELS: '' })
        })
        await expect(adapter.run({ agentId: 'content-ideator', purpose: 'x', input: {} }))
            .rejects.toMatchObject({ code: 'OPENCLAW_AGENT_MODEL_ALLOWLIST_MISSING' })
    })

    it('fails closed when the gateway returns only a virtual alias without provider metadata', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            body: null,
            text: async () => JSON.stringify({
                model: 'openclaw/content-ideator',
                output_text: JSON.stringify({ ideas: [] })
            })
        }))
        const adapter = new OpenClawAgentAdapter({ fetchImpl, envProvider: () => baseEnv })
        await expect(adapter.run({ agentId: 'content-ideator', purpose: 'x', input: {} }))
            .rejects.toMatchObject({ code: 'OPENCLAW_AGENT_RESOLVED_MODEL_MISSING' })
    })

    it('does not trust a model-authored resolvedModel field as provider metadata', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            body: null,
            text: async () => JSON.stringify({
                model: 'openclaw/content-ideator',
                output_text: JSON.stringify({
                    ideas: [],
                    resolvedModel: 'openclaw-topic-pro'
                })
            })
        }))
        const adapter = new OpenClawAgentAdapter({ fetchImpl, envProvider: () => baseEnv })
        await expect(adapter.run({ agentId: 'content-ideator', purpose: 'x', input: {} }))
            .rejects.toMatchObject({ code: 'OPENCLAW_AGENT_RESOLVED_MODEL_MISSING' })
    })

    it('fails before calling the gateway when the expected canonical model is missing', async () => {
        const fetchImpl = vi.fn(async () => okResponse({ ideas: [] }))
        const adapter = new OpenClawAgentAdapter({
            fetchImpl,
            envProvider: () => ({ ...baseEnv, OPENCLAW_TOPIC_EXPECTED_RESOLVED_MODEL: '' })
        })
        await expect(adapter.run({ agentId: 'content-ideator', purpose: 'x', input: {} }))
            .rejects.toMatchObject({ code: 'OPENCLAW_AGENT_EXPECTED_MODEL_MISSING' })
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('distinguishes rejected Gateway auth from an expired provider OAuth session', async () => {
        const gatewayFetch = vi.fn(async () => new Response(JSON.stringify({
            error: { message: 'Unauthorized', type: 'unauthorized' }
        }), { status: 401 }))
        const gatewayAdapter = new OpenClawAgentAdapter({
            fetchImpl: gatewayFetch,
            envProvider: () => baseEnv
        })
        await expect(gatewayAdapter.run({ agentId: 'content-ideator', purpose: 'x', input: {} }))
            .rejects.toMatchObject({ code: 'OPENCLAW_GATEWAY_AUTH_REJECTED' })

        const providerFetch = vi.fn(async () => new Response(JSON.stringify({
            object: 'response',
            status: 'failed',
            error: {
                code: 'authentication_error',
                message: 'OAuth refresh failed: refresh_token_invalidated. Please log in again.'
            }
        }), { status: 401 }))
        const providerAdapter = new OpenClawAgentAdapter({
            fetchImpl: providerFetch,
            envProvider: () => baseEnv
        })
        await expect(providerAdapter.run({ agentId: 'content-ideator', purpose: 'x', input: {} }))
            .rejects.toMatchObject({ code: 'OPENCLAW_PROVIDER_AUTH_EXPIRED' })
        expect(gatewayFetch).toHaveBeenCalledOnce()
        expect(providerFetch).toHaveBeenCalledOnce()
    })

    it('does not persist or expose a raw provider authentication message', async () => {
        const sensitiveDetail = 'account-specific-detail'
        const adapter = new OpenClawAgentAdapter({
            fetchImpl: vi.fn(async () => new Response(JSON.stringify({
                error: { code: 'authentication_error', message: sensitiveDetail }
            }), { status: 401 })),
            envProvider: () => baseEnv
        })
        const error = await adapter.run({ agentId: 'content-ideator', purpose: 'x', input: {} }).catch((caught) => caught)
        expect(error).toMatchObject({ code: 'OPENCLAW_PROVIDER_AUTH_FAILED' })
        expect(error.message).not.toContain(sensitiveDetail)
    })
})
