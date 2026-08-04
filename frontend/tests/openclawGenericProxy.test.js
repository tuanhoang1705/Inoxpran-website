import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
	isOpenClawObjectPayload,
	openClawProxyClientError,
	proxyOpenClawRequest
} from '../src/lib/server/openclawRoadmapProxy.js';

const backendResponse = (payload, { status = 200, requestId = '' } = {}) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: {
			'content-type': 'application/json',
			...(requestId ? { 'x-request-id': requestId } : {})
		}
	});

const callGenericProxy = ({ adminFetch, timeoutMs = 50 } = {}) =>
	proxyOpenClawRequest({
		cookies: {},
		fetch: globalThis.fetch,
		path: '/admin/openclaw/blog-schedules',
		timeoutMs,
		validatePayload: isOpenClawObjectPayload,
		fallbackError: 'Unable to load blog schedules',
		requestId: 'request-generic-1234',
		adminFetch
	});

test('generic OpenClaw proxy sanitizes success payloads and propagates correlation IDs', async () => {
	let forwardedRequestId = '';
	const response = await callGenericProxy({
		adminFetch: async ({ options }) => {
			forwardedRequestId = options.headers['x-request-id'];
			return backendResponse(
				{
					metadata: {
						schedules: [],
						token: 'must-not-leak',
						detail: 'https://admin:password@example.invalid/private'
					}
				},
				{ requestId: 'request-upstream-1234' }
			);
		}
	});

	assert.equal(response.status, 200);
	assert.equal(forwardedRequestId, 'request-generic-1234');
	assert.deepEqual(await response.json(), {
		schedules: [],
		token: '[redacted]',
		detail: '[redacted-url]',
		requestId: 'request-upstream-1234'
	});
});

test('generic OpenClaw proxy keeps only allowlisted 4xx codes and sanitized fields', async () => {
	const safe = await callGenericProxy({
		adminFetch: async () =>
			backendResponse(
				{
					message: 'Unsafe token=secret https://user:password@example.invalid/private',
					errorCode: 'ROADMAP_NO_SAFE_TOPIC',
					field: 'direction',
					stack: 'must-not-leak'
				},
				{ status: 422 }
			)
	});
	assert.equal(safe.status, 422);
	assert.deepEqual(await safe.json(), {
		error: 'Unsafe [redacted] [redacted-url]',
		errorCode: 'ROADMAP_NO_SAFE_TOPIC',
		field: 'direction',
		requestId: 'request-generic-1234'
	});

	const unknown = await callGenericProxy({
		adminFetch: async () =>
			backendResponse(
				{ message: 'Invalid request', errorCode: 'INTERNAL_DATABASE_TRACE' },
				{ status: 400 }
			)
	});
	assert.deepEqual(await unknown.json(), {
		error: 'Invalid request',
		requestId: 'request-generic-1234'
	});
});

test('generic OpenClaw proxy maps 5xx, timeout, and malformed success to bounded errors', async () => {
	const cases = [
		{
			name: 'upstream 5xx',
			adminFetch: async () =>
				backendResponse(
					{ message: 'database password=secret', stack: 'secret stack' },
					{ status: 503 }
				),
			expectedStatus: 502,
			expectedCode: 'OPENCLAW_BACKEND_ERROR'
		},
		{
			name: 'malformed success',
			adminFetch: async () => backendResponse({ metadata: [] }),
			expectedStatus: 502,
			expectedCode: 'OPENCLAW_BACKEND_INVALID_RESPONSE'
		},
		{
			name: 'timeout',
			adminFetch: ({ options }) =>
				new Promise((_resolve, reject) => {
					options.signal.addEventListener('abort', () => {
						reject(Object.assign(new Error('aborted token=secret'), { name: 'AbortError' }));
					});
				}),
			timeoutMs: 5,
			expectedStatus: 504,
			expectedCode: 'OPENCLAW_BACKEND_TIMEOUT'
		}
	];

	for (const entry of cases) {
		const response = await callGenericProxy(entry);
		const payload = await response.json();
		assert.equal(response.status, entry.expectedStatus, entry.name);
		assert.equal(payload.errorCode, entry.expectedCode, entry.name);
		assert.equal(payload.requestId, 'request-generic-1234', entry.name);
		assert.doesNotMatch(JSON.stringify(payload), /password=|token=|secret stack/i, entry.name);
	}
});

test('local OpenClaw validation failures use the same sanitized request envelope', async () => {
	const response = openClawProxyClientError({
		status: 400,
		error: 'Malformed token=secret',
		errorCode: 'NOT_ALLOWLISTED',
		requestId: 'request-local-1234'
	});
	assert.deepEqual(await response.json(), {
		error: 'Malformed [redacted]',
		errorCode: 'OPENCLAW_INVALID_REQUEST',
		requestId: 'request-local-1234'
	});
});

test('schedule list and detail BFFs use the shared proxy for every method', () => {
	const root = process.cwd();
	const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
	const list = read('src/routes/admin/api/openclaw/blog-schedules/+server.js');
	const detail = read('src/routes/admin/api/openclaw/blog-schedules/[scheduleId]/+server.js');

	for (const source of [list, detail]) {
		assert.match(source, /proxyOpenClawRequest/);
		assert.match(source, /isOpenClawObjectPayload/);
		assert.match(source, /requestId/);
		assert.match(source, /adminFetch: adminApiFetch/);
		assert.doesNotMatch(source, /await adminApiFetch\s*\(/);
		assert.doesNotMatch(source, /response\.json\s*\(/);
	}
	assert.match(list, /export const GET/);
	assert.match(list, /export const POST/);
	assert.match(detail, /export const GET/);
	assert.match(detail, /export const PATCH/);
	assert.match(detail, /export const DELETE/);
	assert.match(detail, /encodeURIComponent\(params\.scheduleId\)/);
});

test('all OpenClaw BFF routes cross the shared proxy boundary', () => {
	const root = path.join(process.cwd(), 'src/routes/admin/api/openclaw');
	const routes = [];
	const visit = (directory) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) visit(absolute);
			else if (entry.name === '+server.js') routes.push(absolute);
		}
	};
	visit(root);

	assert.equal(routes.length, 20);
	for (const route of routes) {
		const source = fs.readFileSync(route, 'utf8');
		assert.match(source, /proxyOpenClaw(?:Roadmap)?Request/, route);
		assert.doesNotMatch(source, /await adminApiFetch\s*\(/, route);
		assert.doesNotMatch(source, /response\.json\s*\(/, route);
	}
});
