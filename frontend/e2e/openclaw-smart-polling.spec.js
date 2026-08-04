import { expect, test } from '@playwright/test';

const ACTIVITY_STORAGE_KEY = 'inoxpran:openclaw-activities:v1';

const openBrowserHarness = async (page) => {
	// This suite exercises browser-side stores/pollers and does not require an
	// authenticated SSR page or a live backend.
	await page.goto('/favicon.png');
	await page.evaluate((storageKey) => sessionStorage.removeItem(storageKey), ACTIVITY_STORAGE_KEY);
};

test('active runs settle as success or failure without a page reload', async ({ page }) => {
	await openBrowserHarness(page);

	const result = await page.evaluate(async () => {
		const { createSmartPoller } = await import('/src/lib/openclaw/smartPolling.js');
		const { createOpenClawActivityStore, openClawActivityStatus } =
			await import('/src/lib/openclaw/activityCenter.js');
		const store = createOpenClawActivityStore();
		store.hydrate();

		const run = (key, terminalStatus) =>
			new Promise((resolve, reject) => {
				const statuses = ['running', terminalStatus];
				let cursor = 0;
				const timeout = setTimeout(() => reject(new Error(`Polling ${key} did not settle`)), 2000);
				const poller = createSmartPoller({
					poll: async () => {
						const status = statuses[Math.min(cursor++, statuses.length - 1)];
						return { status, active: status === 'running' };
					},
					onResult: ({ status }) => {
						store.upsert({
							key,
							domain: 'e2e',
							entityId: key,
							title: key,
							status: openClawActivityStatus(status),
							rawStatus: status
						});
					},
					onSettled: () => {
						clearTimeout(timeout);
						poller.stop();
						resolve(store.find((item) => item.key === key));
					},
					activeIntervalMs: 20,
					idleIntervalMs: 1000
				});
				poller.start();
			});

		return {
			succeeded: await run('e2e-success', 'completed'),
			failed: await run('e2e-failure', 'failed')
		};
	});

	expect(result.succeeded.status).toBe('succeeded');
	expect(result.succeeded.rawStatus).toBe('completed');
	expect(result.failed.status).toBe('failed');
	expect(result.failed.rawStatus).toBe('failed');
});

test('running activity survives a reload and then persists its terminal transition', async ({
	page
}) => {
	await openBrowserHarness(page);
	await page.evaluate(async () => {
		const { openClawActivityStore } = await import('/src/lib/openclaw/activityCenter.js');
		openClawActivityStore.hydrate();
		openClawActivityStore.upsert({
			key: 'schedule:reload:execution-1',
			domain: 'schedule',
			entityId: 'reload',
			runId: 'execution-1',
			title: 'Reload recovery',
			status: 'running'
		});
	});

	await page.reload();
	const restoredRunning = await page.evaluate(async () => {
		const { openClawActivityStore } = await import('/src/lib/openclaw/activityCenter.js');
		openClawActivityStore.hydrate();
		return openClawActivityStore.find((item) => item.key === 'schedule:reload:execution-1');
	});
	expect(restoredRunning.status).toBe('running');

	await page.evaluate(async () => {
		const { openClawActivityStore } = await import('/src/lib/openclaw/activityCenter.js');
		openClawActivityStore.upsert({
			key: 'schedule:reload:execution-1',
			status: 'succeeded',
			rawStatus: 'completed'
		});
	});
	await page.reload();
	const restoredTerminal = await page.evaluate(async () => {
		const { openClawActivityStore } = await import('/src/lib/openclaw/activityCenter.js');
		openClawActivityStore.hydrate();
		return openClawActivityStore.find((item) => item.key === 'schedule:reload:execution-1');
	});
	expect(restoredTerminal).toMatchObject({
		status: 'succeeded',
		rawStatus: 'completed',
		unread: true
	});
});

test('polling pauses while the tab is hidden and resumes as soon as it becomes visible', async ({
	page
}) => {
	await openBrowserHarness(page);
	await page.evaluate(async () => {
		const { createSmartPoller } = await import('/src/lib/openclaw/smartPolling.js');
		let visible = true;
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => (visible ? 'visible' : 'hidden')
		});
		window.__openClawTabHarness = {
			calls: 0,
			setVisible(value) {
				visible = value;
				document.dispatchEvent(new Event('visibilitychange'));
			}
		};
		window.__openClawTabHarness.poller = createSmartPoller({
			poll: async () => {
				window.__openClawTabHarness.calls += 1;
				return { active: true };
			},
			activeIntervalMs: 40,
			idleIntervalMs: 1000
		});
		window.__openClawTabHarness.poller.start();
	});

	await expect
		.poll(() => page.evaluate(() => window.__openClawTabHarness.calls))
		.toBeGreaterThan(0);
	await page.evaluate(() => window.__openClawTabHarness.setVisible(false));
	const hiddenCount = await page.evaluate(() => window.__openClawTabHarness.calls);
	await page.waitForTimeout(150);
	expect(await page.evaluate(() => window.__openClawTabHarness.calls)).toBe(hiddenCount);
	await page.evaluate(() => window.__openClawTabHarness.setVisible(true));
	await expect
		.poll(() => page.evaluate(() => window.__openClawTabHarness.calls))
		.toBeGreaterThan(hiddenCount);
	await page.evaluate(() => window.__openClawTabHarness.poller.stop());
});

test('polling waits offline and synchronizes immediately when the network returns', async ({
	page,
	context
}) => {
	await openBrowserHarness(page);
	await page.evaluate(async () => {
		const { createSmartPoller } = await import('/src/lib/openclaw/smartPolling.js');
		window.__openClawNetworkHarness = { calls: 0, createSmartPoller };
	});
	await context.setOffline(true);
	await page.evaluate(() => {
		window.__openClawNetworkHarness.poller = window.__openClawNetworkHarness.createSmartPoller({
			poll: async () => {
				window.__openClawNetworkHarness.calls += 1;
				return { active: true };
			},
			activeIntervalMs: 40,
			idleIntervalMs: 1000
		});
		window.__openClawNetworkHarness.poller.start();
	});
	await page.waitForTimeout(100);
	expect(await page.evaluate(() => window.__openClawNetworkHarness.calls)).toBe(0);

	await context.setOffline(false);
	await expect
		.poll(() => page.evaluate(() => window.__openClawNetworkHarness.calls))
		.toBeGreaterThan(0);
	await page.evaluate(() => window.__openClawNetworkHarness.poller.stop());
});

test('one browser batch request covers 1, 10, or 50 schedules and bounds each history', async ({
	page
}) => {
	await openBrowserHarness(page);
	const results = await page.evaluate(async () => {
		const { buildExecutionSummariesRequest } =
			await import('/src/lib/openclaw/executionSummaries.js');
		return [1, 10, 50].map((count) => {
			const ids = Array.from({ length: count }, (_, index) => `schedule-${index + 1}`);
			const request = buildExecutionSummariesRequest(ids, 99);
			const parsed = new URL(request.url, location.origin);
			return {
				count,
				encodedIds: parsed.searchParams.get('scheduleIds').split(',').length,
				limit: parsed.searchParams.get('limit'),
				requestCount: 1
			};
		});
	});

	expect(results).toEqual([
		{ count: 1, encodedIds: 1, limit: '5', requestCount: 1 },
		{ count: 10, encodedIds: 10, limit: '5', requestCount: 1 },
		{ count: 50, encodedIds: 50, limit: '5', requestCount: 1 }
	]);
});

test('a timeout keeps the same idempotency key across reload until a definitive response', async ({
	page
}) => {
	await openBrowserHarness(page);
	const firstKey = await page.evaluate(async () => {
		const { createOpenClawActionIdempotencyManager, shouldRetainOpenClawActionKey } =
			await import('/src/lib/openclaw/actionIdempotency.js');
		const manager = createOpenClawActionIdempotencyManager();
		const request = { action: 'roadmap-regenerate', profile: 'schedule-e2e' };
		const key = manager.acquire(request);
		if (!shouldRetainOpenClawActionKey(504)) manager.clear({ ...request, key });
		return key;
	});

	await page.reload();
	const recovered = await page.evaluate(async () => {
		const { createOpenClawActionIdempotencyManager, shouldRetainOpenClawActionKey } =
			await import('/src/lib/openclaw/actionIdempotency.js');
		const manager = createOpenClawActionIdempotencyManager();
		const request = { action: 'roadmap-regenerate', profile: 'schedule-e2e' };
		const replayKey = manager.acquire(request);
		if (!shouldRetainOpenClawActionKey(202)) manager.clear({ ...request, key: replayKey });
		return { replayKey, nextKey: manager.acquire(request) };
	});

	expect(recovered.replayKey).toBe(firstKey);
	expect(recovered.nextKey).not.toBe(firstKey);
});
