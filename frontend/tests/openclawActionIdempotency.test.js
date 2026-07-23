import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	createOpenClawActionIdempotencyManager,
	shouldRetainOpenClawActionKey
} from '../src/lib/openclaw/actionIdempotency.js';

const memoryStorage = () => {
	const values = new Map();
	return {
		getItem: (key) => values.get(key) || null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key)
	};
};

test('reuses one key across response-loss retries and page recreation', () => {
	const storage = memoryStorage();
	let generated = 0;
	const options = {
		getStorage: () => storage,
		generateKey: () => `openclaw-retry-key-${++generated}`
	};
	const firstPage = createOpenClawActionIdempotencyManager(options);
	const request = { action: 'daily-draft', profile: 'inoxpran' };
	const first = firstPage.acquire(request);

	const reloadedPage = createOpenClawActionIdempotencyManager(options);
	assert.equal(reloadedPage.acquire(request), first);
	assert.equal(generated, 1);
	assert.equal(shouldRetainOpenClawActionKey(0), true);
	assert.equal(shouldRetainOpenClawActionKey(503), true);
});

test('clears only the matching key after a definitive response', () => {
	const storage = memoryStorage();
	let generated = 0;
	const manager = createOpenClawActionIdempotencyManager({
		getStorage: () => storage,
		generateKey: () => `openclaw-definitive-${++generated}`
	});
	const request = { action: 'status', profile: 'inoxpran' };
	const first = manager.acquire(request);

	assert.equal(manager.clear({ ...request, key: 'different-key-value' }), false);
	assert.equal(manager.acquire(request), first);
	assert.equal(manager.clear({ ...request, key: first }), true);
	assert.notEqual(manager.acquire(request), first);
	assert.equal(shouldRetainOpenClawActionKey(201), false);
	assert.equal(shouldRetainOpenClawActionKey(409), false);
});

test('OpenClaw frontend proxies reject unknown query/body fields instead of dropping them', () => {
	const listProxy = readFileSync(
		new URL('../src/routes/admin/api/openclaw/runs/+server.js', import.meta.url),
		'utf8'
	);
	const detailProxy = readFileSync(
		new URL('../src/routes/admin/api/openclaw/runs/[runId]/+server.js', import.meta.url),
		'utf8'
	);
	const dashboardProxy = readFileSync(
		new URL('../src/routes/admin/api/openclaw/+server.js', import.meta.url),
		'utf8'
	);
	for (const source of [listProxy, detailProxy, dashboardProxy]) {
		assert.match(source, /url\.searchParams\.keys\(\)/);
	}
	assert.match(listProxy, /const exactRunBody/);
	assert.match(listProxy, /keys\.length !== 2/);
	assert.match(listProxy, /typeof body\.action !== 'string'/);
	assert.match(listProxy, /typeof body\.profile !== 'string'/);
});

test('OpenClaw action buttons remain disabled while their durable run is active', () => {
	const page = readFileSync(
		new URL('../src/routes/admin/openclaw/+page.svelte', import.meta.url),
		'utf8'
	);
	assert.match(page, /const actionIsActive/);
	assert.match(page, /activeRuns\.some\(\(run\) => run\.action === action\)/);
	assert.match(page, /Boolean\(busyAction\) \|\| actionIsActive\(action\.id\)/);
});
