import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.REAL_E2E_BACKEND_PORT || 5318);
const expectedPublicKey = 'real-e2e-public-key-not-secret';
const expectedAdminKey = 'real-e2e-admin-bff-key-not-secret';
const scheduleId = 'schedule-real-1';
const safeId = /^[A-Za-z0-9._:-]{8,128}$/;

const featuredProduct = Object.freeze({
	_id: 'product-real-e2e-1',
	product_name: 'Real E2E Featured Product',
	product_slug: 'real-e2e-featured-product',
	product_thumb: '/images/product-item1.jpg',
	product_description: 'A stable product fixture rendered by the real SvelteKit application.',
	product_type: 'Cookware',
	product_original_price: 150000,
	product_price: 123000,
	product_ratingsAverage: 5,
	product_ratingsCount: 1,
	product_weight: 1000,
	product_shop: 'Real E2E Admin',
	isPublished: true,
	isDraft: false,
	createdAt: '2026-07-29T01:00:00.000Z',
	updatedAt: '2026-07-29T02:00:00.000Z'
});

const latestBlog = Object.freeze({
	_id: 'blog-real-e2e-1',
	id: 'blog-real-e2e-1',
	slug: 'real-e2e-latest-article',
	title: 'Real E2E Latest Article',
	excerpt: 'A stable article fixture rendered by the real SvelteKit application.',
	image: '/images/post-item1.jpg',
	categoryKey: 'guide',
	publishedAt: '2026-07-29T03:00:00.000Z'
});

let mode = 'success';
let syncMode = 'normal';
let runSequence = 0;
let runNowDelayMs = 450;
let state = {};
const pendingResponses = new Set();

const resetState = () => {
	mode = 'success';
	syncMode = 'normal';
	runSequence = 0;
	runNowDelayMs = 450;
	state = {
		loginCalls: 0,
		profileCalls: 0,
		publicProductCalls: [],
		publicBlogCalls: [],
		adminProductCalls: [],
		scheduleGetCalls: 0,
		summaryGetCalls: 0,
		runNowCalls: [],
		forbiddenPublishCalls: [],
		unknownCalls: []
	};
};

resetState();

const sendJson = (response, status, payload, headers = {}) => {
	if (response.destroyed || response.writableEnded) return;
	response.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		...headers
	});
	response.end(JSON.stringify(payload));
};

const readJson = async (request) => {
	const chunks = [];
	let length = 0;
	for await (const chunk of request) {
		length += chunk.length;
		if (length > 16_384) throw new Error('Request body too large');
		chunks.push(chunk);
	}
	const raw = Buffer.concat(chunks).toString('utf8');
	if (!raw.trim()) return null;
	return JSON.parse(raw);
};

const requestHasAdminSession = (request) =>
	request.headers['x-api-key'] === expectedAdminKey &&
	request.headers['x-client-id'] === 'admin-real-e2e' &&
	request.headers.authorization === 'real-e2e-admin-access-token';

const schedule = () => ({
	id: scheduleId,
	name: 'Real-app E2E draft schedule',
	direction: 'Nội dung chăm sóc đồ gia dụng an toàn',
	enabled: true,
	scheduleType: 'daily',
	timezone: 'Asia/Ho_Chi_Minh',
	daily: { times: ['08:30'] },
	startAt: '2026-07-29T00:00:00.000Z',
	endAt: null,
	nextRunAt: '2026-07-30T01:30:00.000Z',
	lastRunStatus: '',
	lastOutcomeCode: '',
	lastError: ''
});

const server = http.createServer(async (request, response) => {
	const url = new URL(request.url || '/', `http://${host}:${port}`);
	const { pathname } = url;

	try {
		if (pathname === '/_test/health' && request.method === 'GET') {
			return sendJson(response, 200, { ok: true });
		}
		if (pathname === '/_test/reset' && request.method === 'POST') {
			for (const pending of pendingResponses) pending.destroy();
			pendingResponses.clear();
			resetState();
			return sendJson(response, 200, { ok: true });
		}
		if (pathname === '/_test/mode' && request.method === 'POST') {
			const body = await readJson(request);
			const nextRunNowMode = body?.runNow ?? mode;
			const nextSyncMode = body?.sync ?? syncMode;
			if (
				!['success', 'http500', 'malformed', 'timeout'].includes(nextRunNowMode) ||
				!['normal', 'active', 'failure'].includes(nextSyncMode)
			) {
				return sendJson(response, 400, { error: 'Invalid test mode' });
			}
			mode = nextRunNowMode;
			syncMode = nextSyncMode;
			if (Number.isInteger(body?.delayMs) && body.delayMs >= 0 && body.delayMs <= 2_000) {
				runNowDelayMs = body.delayMs;
			}
			return sendJson(response, 200, { ok: true, mode, syncMode });
		}
		if (pathname === '/_test/state' && request.method === 'GET') {
			return sendJson(response, 200, state);
		}

		if (pathname === '/v1/api/site-settings' && request.method === 'GET') {
			return sendJson(response, 200, {
				metadata: {
					features: { showDiscountBadge: false },
					homeSlides: [],
					marketingCampaign: { enabled: false, headerEnabled: false, popupEnabled: false },
					marketplaceLinks: []
				}
			});
		}

		if (pathname === '/v1/api/product/best-selling' && request.method === 'GET') {
			const call = {
				method: request.method,
				path: pathname,
				limit: url.searchParams.get('limit'),
				page: url.searchParams.get('page'),
				apiKeyAccepted: request.headers['x-api-key'] === expectedPublicKey
			};
			state.publicProductCalls.push(call);
			if (!call.apiKeyAccepted || call.limit !== '6' || call.page !== '1') {
				return sendJson(response, 401, { message: 'Invalid public product request' });
			}
			return sendJson(response, 200, { metadata: [featuredProduct] });
		}

		if (pathname === '/v1/api/blog' && request.method === 'GET') {
			const call = {
				method: request.method,
				path: pathname,
				limit: url.searchParams.get('limit'),
				page: url.searchParams.get('page'),
				sort: url.searchParams.get('sort'),
				apiKeyAccepted: request.headers['x-api-key'] === expectedPublicKey
			};
			state.publicBlogCalls.push(call);
			if (
				!call.apiKeyAccepted ||
				call.limit !== '8' ||
				call.page !== '1' ||
				call.sort !== 'published'
			) {
				return sendJson(response, 401, { message: 'Invalid public blog request' });
			}
			return sendJson(response, 200, { metadata: { items: [latestBlog] } });
		}

		if (pathname === '/v1/api/product/admin/all' && request.method === 'GET') {
			const call = {
				method: request.method,
				path: pathname,
				limit: url.searchParams.get('limit'),
				page: url.searchParams.get('page'),
				status: url.searchParams.get('status'),
				adminSessionAccepted: requestHasAdminSession(request)
			};
			state.adminProductCalls.push(call);
			if (
				!call.adminSessionAccepted ||
				call.limit !== '11' ||
				call.page !== '1' ||
				call.status !== 'published'
			) {
				return sendJson(response, 401, { message: 'Invalid admin product request' });
			}
			return sendJson(response, 200, { metadata: [featuredProduct] });
		}

		if (pathname === '/v1/api/admin/users' && request.method === 'GET') {
			if (!requestHasAdminSession(request)) {
				return sendJson(response, 401, { message: 'Unauthorized' });
			}
			return sendJson(response, 200, { metadata: { items: [] } });
		}

		if (pathname === '/v1/api/admin/dashboard-summary' && request.method === 'GET') {
			if (!requestHasAdminSession(request)) {
				return sendJson(response, 401, { message: 'Unauthorized' });
			}
			return sendJson(response, 200, { metadata: {} });
		}

		if (pathname === '/v1/api/product' && request.method === 'GET') {
			const apiKey = request.headers['x-api-key'];
			if (![expectedPublicKey, expectedAdminKey].includes(apiKey)) {
				return sendJson(response, 401, { message: 'Unauthorized' });
			}
			return sendJson(response, 200, { metadata: [featuredProduct] });
		}

		if (pathname === '/v1/api/admin/login' && request.method === 'POST') {
			state.loginCalls += 1;
			const body = await readJson(request);
			if (
				request.headers['x-api-key'] !== expectedAdminKey ||
				body?.email !== 'admin.e2e@example.invalid' ||
				body?.password !== 'real-e2e-password-not-secret'
			) {
				return sendJson(response, 401, { message: 'Invalid E2E credentials' });
			}
			return sendJson(response, 200, {
				metadata: {
					admin: {
						_id: 'admin-real-e2e',
						name: 'Real E2E Admin',
						email: 'admin.e2e@example.invalid',
						roles: ['ADMIN', 'SUPER_ADMIN']
					},
					tokens: {
						accessToken: 'real-e2e-admin-access-token',
						refreshToken: 'real-e2e-admin-refresh-token'
					}
				}
			});
		}

		if (pathname === '/v1/api/admin/profile' && request.method === 'GET') {
			state.profileCalls += 1;
			if (!requestHasAdminSession(request)) {
				return sendJson(response, 401, { message: 'Unauthorized' });
			}
			return sendJson(response, 200, {
				metadata: {
					_id: 'admin-real-e2e',
					name: 'Real E2E Admin',
					email: 'admin.e2e@example.invalid',
					roles: ['ADMIN', 'SUPER_ADMIN']
				}
			});
		}

		if (
			pathname === '/v1/api/admin/openclaw/blog-schedules/execution-summaries' &&
			request.method === 'GET'
		) {
			state.summaryGetCalls += 1;
			if (syncMode === 'failure') {
				return sendJson(response, 503, {
					message: 'Mock synchronization failure',
					requestId: 'mock-summary-failure'
				});
			}
			return sendJson(response, 200, {
				metadata: {
					checkedAt: new Date().toISOString(),
					summaries: [
						{
							scheduleId,
							executions:
								syncMode === 'active'
									? [
											{
												id: 'execution-active-poll',
												status: 'running',
												startedAt: new Date().toISOString()
											}
										]
									: []
						}
					]
				},
				requestId: 'mock-summary-request'
			});
		}

		if (
			pathname === `/v1/api/admin/openclaw/blog-schedules/${scheduleId}/executions` &&
			request.method === 'GET'
		) {
			return sendJson(response, 200, {
				metadata: { executions: [] },
				requestId: 'mock-executions-request'
			});
		}

		if (
			pathname === `/v1/api/admin/openclaw/blog-schedules/${scheduleId}/run-now` &&
			request.method === 'POST'
		) {
			const idempotencyKey = String(request.headers['idempotency-key'] || '');
			const requestId = String(request.headers['x-request-id'] || '');
			const body = await readJson(request);
			const call = {
				method: request.method,
				path: pathname,
				idempotencyKey,
				requestId,
				bodyWasEmpty: body === null,
				autoPublishRequested: body?.autoPublish === true,
				draftOnlyDisabled: body?.draftOnly === false
			};
			state.runNowCalls.push(call);
			if (pathname.includes('publish') || call.autoPublishRequested || call.draftOnlyDisabled) {
				state.forbiddenPublishCalls.push(call);
			}
			if (
				!requestHasAdminSession(request) ||
				!safeId.test(idempotencyKey) ||
				!safeId.test(requestId)
			) {
				return sendJson(response, 400, {
					message: 'Invalid request metadata',
					errorCode: 'OPENCLAW_INVALID_REQUEST',
					requestId: 'mock-invalid-request'
				});
			}

			if (mode === 'http500') {
				return sendJson(
					response,
					503,
					{
						message: 'internal upstream detail must not cross the BFF',
						errorCode: 'INTERNAL_SECRET_CODE',
						requestId: 'mock-upstream-500'
					},
					{ 'x-request-id': 'mock-upstream-500' }
				);
			}
			if (mode === 'malformed') {
				return sendJson(response, 202, {
					metadata: 'not-an-object',
					requestId: 'mock-malformed-response'
				});
			}
			if (mode === 'timeout') {
				pendingResponses.add(response);
				response.on('close', () => pendingResponses.delete(response));
				return;
			}

			runSequence += 1;
			await new Promise((resolve) => setTimeout(resolve, runNowDelayMs));
			return sendJson(
				response,
				202,
				{
					metadata: {
						executionId: `execution-real-${runSequence}`,
						status: 'queued',
						queued: true,
						draftOnly: true,
						autoPublish: false
					},
					requestId: `mock-run-request-${runSequence}`
				},
				{ 'x-request-id': `mock-run-request-${runSequence}` }
			);
		}

		if (pathname === '/v1/api/admin/openclaw/blog-schedules' && request.method === 'GET') {
			state.scheduleGetCalls += 1;
			if (syncMode === 'failure') {
				return sendJson(response, 503, {
					message: 'Mock synchronization failure',
					requestId: 'mock-schedules-failure'
				});
			}
			return sendJson(response, 200, {
				metadata: {
					schedules: [schedule()],
					pagination: { page: 1, limit: 50, total: 1 }
				},
				requestId: 'mock-schedules-request'
			});
		}

		if (pathname.includes('/publish') && request.method !== 'GET') {
			state.forbiddenPublishCalls.push({ method: request.method, path: pathname });
			return sendJson(response, 409, { message: 'Publishing is disabled in real-app E2E' });
		}

		state.unknownCalls.push({ method: request.method, path: pathname });
		return sendJson(response, 404, { message: 'Undeclared real-app E2E route' });
	} catch {
		return sendJson(response, 400, { message: 'Invalid mock request' });
	}
});

server.requestTimeout = 0;
server.listen(port, host, () => {
	console.log(`Real-app E2E mock backend listening at http://${host}:${port}`);
});

const shutdown = () => {
	for (const pending of pendingResponses) pending.destroy();
	server.close(() => process.exit(0));
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
