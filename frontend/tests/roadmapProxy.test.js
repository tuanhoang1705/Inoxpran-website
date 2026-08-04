import assert from 'node:assert/strict';
import test from 'node:test';

import {
	isRoadmapEnqueuePayload,
	proxyOpenClawRoadmapRequest,
	safeRoadmapReasonBody
} from '../src/lib/server/openclawRoadmapProxy.js';

const enqueuePayload = (overrides = {}) => ({
	queued: true,
	duplicate: false,
	coalesced: false,
	regeneration: {
		id: 'regen-1',
		status: 'queued',
		baseEpoch: 'epoch-old',
		targetEpoch: 'epoch-new',
		...overrides
	}
});

const backendResponse = (payload, { status = 202 } = {}) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' }
	});

const callProxy = async ({ adminFetch, timeoutMs = 50 } = {}) =>
	proxyOpenClawRoadmapRequest({
		cookies: {},
		fetch: globalThis.fetch,
		path: '/admin/openclaw/blog-schedules/schedule-1/roadmap/regenerate',
		options: { method: 'POST' },
		timeoutMs,
		validatePayload: isRoadmapEnqueuePayload,
		fallbackError: 'Unable to queue roadmap regeneration',
		requestId: 'request-test-1234',
		adminFetch
	});

const responseBody = (response) => response.json();

test('roadmap proxy passes through backend 202 and a safe enqueue payload', async () => {
	let forwardedRequestId = '';
	const response = await callProxy({
		adminFetch: async ({ options }) => {
			forwardedRequestId = options.headers['x-request-id'];
			return backendResponse({
				status: 202,
				metadata: enqueuePayload({
					lineage: { ideationRunId: 'ideation-1' },
					credential: 'must-not-leak',
					sourceHealth: [
						{ source: 'market', detail: 'https://user:password@example.invalid/private' }
					]
				})
			});
		}
	});
	assert.equal(response.status, 202);
	assert.equal(forwardedRequestId, 'request-test-1234');
	assert.deepEqual(await responseBody(response), {
		...enqueuePayload({
			lineage: { ideationRunId: 'ideation-1' },
			credential: '[redacted]',
			sourceHealth: [{ source: 'market', detail: '[redacted-url]' }]
		}),
		requestId: 'request-test-1234'
	});
});

test('roadmap proxy preserves allowlisted 400 and 409 domain codes', async () => {
	for (const [status, code] of [
		[400, 'TOPIC_ROADMAP_DISABLED'],
		[409, 'BLOG_SCHEDULE_ACTIVE_ROADMAP_CLAIM'],
		[422, 'ROADMAP_SCORE_UNREACHABLE']
	]) {
		const response = await callProxy({
			adminFetch: async () =>
				backendResponse(
					{ message: 'Safe action required', errorCode: code, stack: 'secret stack' },
					{ status }
				)
		});
		assert.equal(response.status, status);
		assert.deepEqual(await responseBody(response), {
			error: 'Safe action required',
			errorCode: code,
			requestId: 'request-test-1234'
		});
	}
});

test('roadmap proxy maps transport reset to a sanitized 502', async () => {
	const response = await callProxy({
		adminFetch: async () => {
			throw Object.assign(new Error('ECONNRESET token=secret'), { code: 'ECONNRESET' });
		}
	});
	assert.equal(response.status, 502);
	assert.deepEqual(await responseBody(response), {
		error: 'OpenClaw backend is temporarily unavailable',
		errorCode: 'OPENCLAW_BACKEND_UNAVAILABLE',
		requestId: 'request-test-1234'
	});
});

test('roadmap proxy maps its bounded abort timeout to a sanitized 504', async () => {
	const response = await callProxy({
		timeoutMs: 5,
		adminFetch: ({ options }) =>
			new Promise((_resolve, reject) => {
				options.signal.addEventListener('abort', () => {
					reject(Object.assign(new Error('aborted bearer secret'), { name: 'AbortError' }));
				});
			})
	});
	assert.equal(response.status, 504);
	assert.deepEqual(await responseBody(response), {
		error: 'OpenClaw backend did not confirm the request in time',
		errorCode: 'OPENCLAW_BACKEND_TIMEOUT',
		requestId: 'request-test-1234'
	});
});

test('roadmap proxy maps an upstream AbortError to the same sanitized 504', async () => {
	const response = await callProxy({
		adminFetch: async () => {
			throw Object.assign(new Error('request aborted token=secret'), { name: 'AbortError' });
		}
	});
	assert.equal(response.status, 504);
	assert.deepEqual(await responseBody(response), {
		error: 'OpenClaw backend did not confirm the request in time',
		errorCode: 'OPENCLAW_BACKEND_TIMEOUT',
		requestId: 'request-test-1234'
	});
});

test('roadmap proxy timeout also bounds a stalled response body', async () => {
	const response = await callProxy({
		timeoutMs: 5,
		adminFetch: async () => ({
			status: 202,
			ok: true,
			json: () => new Promise(() => {})
		})
	});
	assert.equal(response.status, 504);
	assert.deepEqual(await responseBody(response), {
		error: 'OpenClaw backend did not confirm the request in time',
		errorCode: 'OPENCLAW_BACKEND_TIMEOUT',
		requestId: 'request-test-1234'
	});
});

test('roadmap proxy rejects malformed success bodies and sanitizes backend 5xx', async () => {
	const malformed = await callProxy({
		adminFetch: async () => backendResponse({ status: 202, metadata: { queued: true } })
	});
	assert.equal(malformed.status, 502);
	assert.equal((await responseBody(malformed)).errorCode, 'OPENCLAW_BACKEND_INVALID_RESPONSE');

	const invalidJson = await callProxy({
		adminFetch: async () =>
			new Response('not-json token=secret', {
				status: 202,
				headers: { 'content-type': 'application/json' }
			})
	});
	assert.equal(invalidJson.status, 502);
	assert.deepEqual(await responseBody(invalidJson), {
		error: 'OpenClaw backend returned an invalid response',
		errorCode: 'OPENCLAW_BACKEND_INVALID_RESPONSE',
		requestId: 'request-test-1234'
	});

	const failure = await callProxy({
		adminFetch: async () =>
			backendResponse(
				{
					message: 'postgres failed token=secret https://admin:password@internal.invalid/x',
					errorCode: 'OPENCLAW_PROVIDER_AUTH_FAILED',
					stack: 'stack secret'
				},
				{ status: 503 }
			)
	});
	assert.equal(failure.status, 502);
	assert.deepEqual(await responseBody(failure), {
		error: 'OpenClaw backend request failed',
		errorCode: 'OPENCLAW_BACKEND_ERROR',
		requestId: 'request-test-1234'
	});
});

test('roadmap action reason accepts exactly 160 characters and fails closed above it', () => {
	const exact = 'x'.repeat(160);
	assert.deepEqual(safeRoadmapReasonBody({ reason: exact }), { reason: exact });
	assert.equal(safeRoadmapReasonBody({ reason: `${exact}x` }), null);
	assert.equal(safeRoadmapReasonBody({ reason: 'safe', unexpected: true }), null);
});

test('roadmap proxy redacts secrets and credential-bearing URLs from preserved 4xx copy', async () => {
	const response = await callProxy({
		adminFetch: async () =>
			backendResponse(
				{
					message:
						'Invalid input token=secret authorization=Bearer another https://user:password@example.invalid/private',
					errorCode: 'TOPIC_ROADMAP_DISABLED'
				},
				{ status: 400 }
			)
	});
	const payload = await responseBody(response);
	assert.equal(response.status, 400);
	assert.equal(payload.errorCode, 'TOPIC_ROADMAP_DISABLED');
	assert.doesNotMatch(JSON.stringify(payload), /secret|another|password|user@|Bearer/i);
});
