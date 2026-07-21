import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    buildSafeErrorPayload,
    buildSafeServerLog,
    escapeHtml,
    redactInternalOwnership,
    resolveStatusCode,
    safeClientMessage,
    safeRequestPath,
    safeStoredErrorCode
} = require('../src/utils/httpError.util')

describe('HTTP error disclosure boundary', () => {
    it('returns a generic 5xx payload without raw messages, URLs, credentials or fields', () => {
        const error = Object.assign(
            new Error('fetch https://user:password@example.com/private?token=secret failed'),
            { status: 503, code: 'UPSTREAM_FAILURE', field: 'privateToken' }
        )
        const statusCode = resolveStatusCode(error)
        const message = safeClientMessage({ error, statusCode })
        const payload = buildSafeErrorPayload({ error, statusCode, message })

        expect(payload).toEqual({ status: 'error', code: 503, message: 'Internal Server Error' })
        expect(JSON.stringify(payload)).not.toContain('secret')
        expect(JSON.stringify(payload)).not.toContain('password')
    })

    it('preserves bounded controlled 4xx details and safe machine-readable fields', () => {
        const error = Object.assign(new Error('topic is required'), {
            status: 400,
            code: 'TOPIC_REQUIRED',
            field: 'topic'
        })
        const statusCode = resolveStatusCode(error)
        const payload = buildSafeErrorPayload({
            error,
            statusCode,
            message: safeClientMessage({ error, statusCode })
        })

        expect(payload).toMatchObject({
            status: 'error',
            code: 400,
            errorCode: 'TOPIC_REQUIRED',
            field: 'topic',
            message: 'topic is required'
        })
    })

    it('logs only bounded metadata and strips query/hash values from request paths', () => {
        const error = Object.assign(new Error('token=secret'), { code: 'UPSTREAM_FAILURE' })
        const req = { method: 'GET', originalUrl: '/admin/jobs?token=secret#private' }
        const entry = buildSafeServerLog({ error, req, statusCode: 500 })

        expect(entry).toEqual({
            event: 'http_request_failed',
            statusCode: 500,
            method: 'GET',
            path: '/admin/jobs',
            errorCode: 'UPSTREAM_FAILURE',
            errorName: 'Error'
        })
        expect(safeRequestPath(req)).toBe('/admin/jobs')
        expect(JSON.stringify(entry)).not.toContain('secret')
    })

    it('escapes values rendered into the HTML 404 response', () => {
        expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
            '&lt;img src=x onerror=alert(1)&gt;'
        )
    })

    it('accepts machine error codes but redacts historical token-like values', () => {
        expect(safeStoredErrorCode('UPSTREAM_TIMEOUT')).toBe('UPSTREAM_TIMEOUT')
        expect(safeStoredErrorCode('ECONNRESET')).toBe('ECONNRESET')
        expect(safeStoredErrorCode('skLiveSecretToken123456789')).toBe('INTERNAL_ERROR')
        expect(safeStoredErrorCode('https://private.invalid/?token=secret')).toBe('INTERNAL_ERROR')
        expect(safeStoredErrorCode('')).toBe('')
    })

    it('removes internal lease ownership fields recursively without altering public data', () => {
        const value = redactInternalOwnership({
            id: 'work-order-1',
            metadata: {
                activeClaimToken: 'worker-a:secret',
                activeExecutionId: 'execution-internal',
                nested: [{ leaseOwner: 'lease-secret', status: 'running' }]
            },
            lockedBy: 'scheduler-secret',
            status: 'drafting'
        })

        expect(value).toEqual({
            id: 'work-order-1',
            metadata: { nested: [{ status: 'running' }] },
            status: 'drafting'
        })
        expect(JSON.stringify(value)).not.toContain('secret')
    })
})
