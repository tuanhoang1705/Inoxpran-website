import { expect, test } from '@playwright/test';

const backendPort = Number(process.env.REAL_E2E_BACKEND_PORT || 5318);
const backendControlUrl = `http://127.0.0.1:${backendPort}/_test`;
const runNowPath = '/admin/api/openclaw/blog-schedules/schedule-real-1/run-now';
const idempotencyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

const resetBackend = async (request) => {
	const response = await request.post(`${backendControlUrl}/reset`);
	expect(response.ok()).toBe(true);
};

const setRunNowMode = async (request, runNow) => {
	const response = await request.post(`${backendControlUrl}/mode`, { data: { runNow } });
	expect(response.ok()).toBe(true);
};

const setSyncMode = async (request, sync) => {
	const response = await request.post(`${backendControlUrl}/mode`, { data: { sync } });
	expect(response.ok()).toBe(true);
};

const backendState = async (request) => {
	const response = await request.get(`${backendControlUrl}/state`);
	expect(response.ok()).toBe(true);
	return response.json();
};

const postRunNowFromBrowserSession = (page, idempotencyKey) =>
	page.evaluate(
		async ({ path, key }) => {
			const response = await fetch(path, {
				method: 'POST',
				headers: { 'Idempotency-Key': key }
			});
			return {
				status: response.status,
				payload: await response.json()
			};
		},
		{ path: runNowPath, key: idempotencyKey }
	);

const loginThroughRealForm = async (page, { openBlogs = true } = {}) => {
	await page.goto('/admin/openclaw/blogs');
	await expect(page).toHaveURL(/\/admin\/login$/);
	await expect(page.getByRole('heading', { name: 'Đăng nhập quản trị' })).toBeVisible();

	const email = page.getByLabel('Email');
	await email.focus();
	await page.keyboard.type('admin.e2e@example.invalid');
	await page.keyboard.press('Tab');
	await expect(page.getByLabel('Mật khẩu')).toBeFocused();
	await page.keyboard.type('real-e2e-password-not-secret');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/\/admin$/);

	if (openBlogs) {
		await page.goto('/admin/openclaw/blogs');
		await expect(page.getByRole('heading', { name: 'Trạm điều hành Blog' })).toBeVisible();
	}
};

test.beforeEach(async ({ request }) => {
	await resetBackend(request);
});

test('public VI/EN pages render real product and blog data through SSR', async ({
	page,
	request
}) => {
	for (const pathname of ['/', '/en']) {
		const response = await page.goto(pathname, { waitUntil: 'domcontentloaded' });
		expect(response).not.toBeNull();
		expect(response.status()).toBe(200);
		await expect(page).not.toHaveTitle('Internal Error');
		await expect(page.locator('#best-selling-items')).toContainText('Real E2E Featured Product');
		await expect(page.locator('#best-selling-items .product-card')).toHaveCount(1);
		await expect(page.locator('#latest-posts')).toContainText('Real E2E Latest Article');
		await expect(page.locator('#latest-posts .posts')).toHaveCount(1);
		await expect(
			page.locator('a[href="https://www.facebook.com/inoxpranvietnam"]').first()
		).toHaveAttribute('href', 'https://www.facebook.com/inoxpranvietnam');
	}

	const state = await backendState(request);
	// The app primes and caches the home feed at process start, so a test reset can
	// legitimately observe zero new upstream calls while still rendering real data.
	expect(state.publicProductCalls.every((call) => call.apiKeyAccepted)).toBe(true);
	expect(state.publicBlogCalls.every((call) => call.apiKeyAccepted)).toBe(true);
	expect(state.unknownCalls).toEqual([]);
});

test('real admin products page loads an authenticated product row', async ({ page, request }) => {
	await loginThroughRealForm(page, { openBlogs: false });
	await page.goto('/admin/products');

	await expect(page.locator('main h2').first()).toBeVisible();
	await expect(page.getByRole('cell', { name: 'Real E2E Featured Product' })).toBeVisible();
	await expect(page.locator('.alert-danger')).toHaveCount(0);
	await expect(page.locator('tbody tr')).toHaveCount(1);

	const state = await backendState(request);
	expect(state.adminProductCalls).toHaveLength(1);
	expect(state.adminProductCalls[0]).toMatchObject({
		limit: '11',
		page: '1',
		status: 'published',
		adminSessionAccepted: true
	});
	expect(state.unknownCalls).toEqual([]);
	expect(state.forbiddenPublishCalls).toEqual([]);
});

test('real admin login/session supports VI/EN, keyboard navigation, and mobile menu', async ({
	page,
	request
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await loginThroughRealForm(page);
	await expect(
		page.getByLabel('Danh sách lịch Blog').getByText('Real-app E2E draft schedule')
	).toBeVisible();

	const menuButton = page.getByRole('button', { name: 'Mở menu quản trị' });
	await expect(menuButton).toBeVisible();
	await menuButton.focus();
	await expect(menuButton).toBeFocused();
	await menuButton.press('Enter');
	await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

	const englishButton = page.getByRole('button', { name: 'Tiếng Anh' });
	await englishButton.focus();
	await expect(englishButton).toBeFocused();
	await englishButton.press('Enter');
	await expect(page.getByRole('heading', { name: 'Blog Autopilot' })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	const vietnameseButton = page.getByRole('button', { name: 'Vietnamese' });
	await vietnameseButton.focus();
	await expect(vietnameseButton).toBeFocused();
	await vietnameseButton.press('Enter');
	await expect(page.getByRole('heading', { name: 'Trạm điều hành Blog' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menuButton).toHaveAttribute('aria-expanded', 'false');

	const state = await backendState(request);
	expect(state.loginCalls).toBe(1);
	expect(state.profileCalls).toBeGreaterThan(0);
	expect(state.forbiddenPublishCalls).toEqual([]);
});

test('one Run now click sends one POST and forwards one retained idempotency key to a draft-only 202', async ({
	page,
	request
}) => {
	await loginThroughRealForm(page);

	const bffRequests = [];
	page.on('request', (browserRequest) => {
		const url = new URL(browserRequest.url());
		if (url.pathname === runNowPath && browserRequest.method() === 'POST') {
			bffRequests.push(browserRequest);
		}
	});
	const responsePromise = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === runNowPath && response.request().method() === 'POST';
	});

	await page.getByRole('button', { name: 'Chạy ngay' }).click();
	await expect.poll(() => bffRequests.length).toBe(1);
	await expect.poll(async () => (await backendState(request)).runNowCalls.length).toBe(1);

	const browserKey = bffRequests[0].headers()['idempotency-key'];
	expect(browserKey).toMatch(idempotencyPattern);
	const retainedRecords = await page.evaluate(() =>
		Object.entries(sessionStorage)
			.filter(([key]) => key.startsWith('inoxpran:openclaw-action:v1:'))
			.map(([, value]) => JSON.parse(value))
	);
	expect(retainedRecords).toContainEqual(expect.objectContaining({ key: browserKey }));

	const bffResponse = await responsePromise;
	expect(bffResponse.status()).toBe(202);
	const payload = await bffResponse.json();
	expect(payload).toMatchObject({
		executionId: 'execution-real-1',
		status: 'queued',
		draftOnly: true,
		autoPublish: false
	});
	expect(payload.requestId).toMatch(idempotencyPattern);

	const state = await backendState(request);
	expect(state.runNowCalls).toHaveLength(1);
	expect(state.runNowCalls[0]).toMatchObject({
		idempotencyKey: browserKey,
		bodyWasEmpty: true,
		autoPublishRequested: false,
		draftOnlyDisabled: false
	});
	expect(state.runNowCalls[0].requestId).toMatch(idempotencyPattern);
	expect(state.forbiddenPublishCalls).toEqual([]);
	expect(bffRequests).toHaveLength(1);
	await expect
		.poll(() =>
			page.evaluate(() =>
				Object.keys(sessionStorage).filter((key) => key.startsWith('inoxpran:openclaw-action:v1:'))
			)
		)
		.toEqual([]);
});

test('real BFF maps upstream 5xx and malformed success to sanitized 502 responses', async ({
	page,
	request
}) => {
	await loginThroughRealForm(page, { openBlogs: false });

	await setRunNowMode(request, 'http500');
	const failed = await postRunNowFromBrowserSession(page, 'real-e2e-upstream-500-key');
	expect(failed.status).toBe(502);
	expect(failed.payload).toEqual({
		error: 'OpenClaw backend request failed',
		errorCode: 'OPENCLAW_BACKEND_ERROR',
		requestId: 'mock-upstream-500'
	});

	await setRunNowMode(request, 'malformed');
	const malformed = await postRunNowFromBrowserSession(page, 'real-e2e-malformed-key');
	expect(malformed.status).toBe(502);
	expect(malformed.payload).toEqual({
		error: 'OpenClaw backend returned an invalid response',
		errorCode: 'OPENCLAW_BACKEND_INVALID_RESPONSE',
		requestId: 'mock-malformed-response'
	});

	const state = await backendState(request);
	expect(state.runNowCalls).toHaveLength(2);
	expect(state.forbiddenPublishCalls).toEqual([]);
});

test('timeout recovery keeps and replays the same key once, then clears it after draft-only 202', async ({
	page,
	request
}) => {
	await loginThroughRealForm(page);
	await setRunNowMode(request, 'timeout');

	const bffRequests = [];
	page.on('request', (browserRequest) => {
		const url = new URL(browserRequest.url());
		if (url.pathname === runNowPath && browserRequest.method() === 'POST') {
			bffRequests.push(browserRequest);
		}
	});
	const timeoutResponsePromise = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === runNowPath && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Chạy ngay' }).click();
	const timeoutResponse = await timeoutResponsePromise;
	expect(timeoutResponse.status()).toBe(504);
	expect(await timeoutResponse.json()).toMatchObject({
		error: 'OpenClaw backend did not confirm the request in time',
		errorCode: 'OPENCLAW_BACKEND_TIMEOUT'
	});
	await expect(page.getByRole('button', { name: 'Khôi phục yêu cầu chạy' })).toBeVisible();

	const retainedKey = bffRequests[0].headers()['idempotency-key'];
	expect(retainedKey).toMatch(idempotencyPattern);
	const retainedRecords = await page.evaluate(() =>
		Object.entries(sessionStorage)
			.filter(([key]) => key.startsWith('inoxpran:openclaw-action:v1:'))
			.map(([, value]) => JSON.parse(value))
	);
	expect(retainedRecords).toContainEqual(expect.objectContaining({ key: retainedKey }));
	let state = await backendState(request);
	expect(state.runNowCalls).toHaveLength(1);
	expect(state.runNowCalls[0].idempotencyKey).toBe(retainedKey);

	await setRunNowMode(request, 'success');
	const recoveredResponsePromise = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === runNowPath && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Khôi phục yêu cầu chạy' }).click();
	const recoveredResponse = await recoveredResponsePromise;
	expect(recoveredResponse.status()).toBe(202);
	expect(await recoveredResponse.json()).toMatchObject({
		status: 'queued',
		draftOnly: true,
		autoPublish: false
	});

	expect(bffRequests).toHaveLength(2);
	expect(bffRequests[1].headers()['idempotency-key']).toBe(retainedKey);
	state = await backendState(request);
	expect(state.runNowCalls).toHaveLength(2);
	expect(state.runNowCalls.map((call) => call.idempotencyKey)).toEqual([retainedKey, retainedKey]);
	expect(state.forbiddenPublishCalls).toEqual([]);
	await expect
		.poll(() =>
			page.evaluate(() =>
				Object.keys(sessionStorage).filter((key) => key.startsWith('inoxpran:openclaw-action:v1:'))
			)
		)
		.toEqual([]);
});

test('active polling keeps the last schedule visible and shows the VI stale-data notice on sync failure', async ({
	page,
	request
}) => {
	await setSyncMode(request, 'active');
	await loginThroughRealForm(page);
	const scheduleRow = page
		.getByLabel('Danh sách lịch Blog')
		.getByText('Real-app E2E draft schedule');
	await expect(scheduleRow).toBeVisible();
	await expect(page.locator('.bs-result--live')).toBeVisible();
	await expect.poll(async () => (await backendState(request)).summaryGetCalls).toBeGreaterThan(0);

	await setSyncMode(request, 'failure');
	await expect(page.locator('.bs-notice--sync')).toContainText(
		'Đồng bộ trạng thái đang tạm chậm. Thông tin bên dưới có thể chưa mới nhất.',
		{ timeout: 8_000 }
	);
	await expect(scheduleRow).toBeVisible();

	const state = await backendState(request);
	expect(state.scheduleGetCalls).toBeGreaterThan(1);
	expect(state.forbiddenPublishCalls).toEqual([]);
});
