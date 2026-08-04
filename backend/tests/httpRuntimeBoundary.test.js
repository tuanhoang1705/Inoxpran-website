import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const request = require('supertest')
const app = require('../src/app')
const { buildSafeErrorPayload } = require('../src/utils/httpError.util')

describe('runtime HTTP boundary', () => {
    it('serves unauthenticated liveness and keeps readiness closed before startup', async () => {
        const live = await request(app).get('/health/live').expect(200)
        expect(live.body.status).toBe('alive')
        expect(live.body.requestId).toBeTruthy()
        expect(live.headers['cache-control']).toBe('no-store')

        const ready = await request(app).get('/health/ready').expect(503)
        expect(ready.body.status).toBe('not_ready')
        expect(ready.body.checks.application).toBe('not_ready')
        expect(ready.body.checks.mongodb).not.toBe('ready')
    })

    it('returns a request-correlated, cache-disabled JSON 404 without query data', async () => {
        const response = await request(app)
            .get('/404?token=must-not-leak')
            .set('Accept', 'application/json')
            .set('X-Request-Id', 'boundary-test-1')
            .expect(404)

        expect(response.body).toMatchObject({
            status: 'error',
            code: 404,
            errorCode: 'ROUTE_NOT_FOUND',
            method: 'GET',
            path: '/404',
            requestId: 'boundary-test-1'
        })
        expect(JSON.stringify(response.body)).not.toContain('must-not-leak')
        expect(response.headers['x-request-id']).toBe('boundary-test-1')
        expect(response.headers['cache-control']).toBe('no-store')
    })

    it('keeps the 5xx envelope stable without exposing an internal exception code', async () => {
        const payload = buildSafeErrorPayload({
            error: Object.assign(new Error('database URL must-not-leak'), {
                code: 'MONGODB_CONNECTION_FAILED'
            }),
            statusCode: 500,
            message: 'Internal Server Error',
            requestId: 'boundary-test-500'
        })
        expect(payload).toEqual({
            status: 'error',
            code: 500,
            message: 'Internal Server Error',
            errorCode: 'INTERNAL_ERROR',
            requestId: 'boundary-test-500'
        })
        expect(JSON.stringify(payload)).not.toContain('database URL')
    })
})
