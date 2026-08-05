import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAdminRefreshCoordinator,
	fingerprintAdminRefreshSession,
	shouldRefreshAdminSession
} from '../src/lib/server/adminSessionRefresh.js';

test('concurrent and late refresh requests reuse one token rotation', async () => {
	let now = 1_000;
	let refreshCalls = 0;
	let releaseRefresh;
	const coordinator = createAdminRefreshCoordinator({
		reuseWindowMs: 10_000,
		now: () => now
	});
	const refresh = async () => {
		refreshCalls += 1;
		await new Promise((resolve) => {
			releaseRefresh = resolve;
		});
		return { accessToken: 'new-access', refreshToken: 'new-refresh' };
	};

	const first = coordinator.run({ userId: 'admin-1', refreshToken: 'old-refresh', refresh });
	const second = coordinator.run({ userId: 'admin-1', refreshToken: 'old-refresh', refresh });
	await Promise.resolve();
	assert.equal(refreshCalls, 1);

	releaseRefresh();
	assert.deepEqual(await first, await second);

	now += 5_000;
	const late = await coordinator.run({
		userId: 'admin-1',
		refreshToken: 'old-refresh',
		refresh
	});
	assert.equal(refreshCalls, 1);
	assert.equal(late.refreshToken, 'new-refresh');
});

test('failed refreshes are not cached and expired successful refreshes can retry', async () => {
	let now = 10;
	let refreshCalls = 0;
	const coordinator = createAdminRefreshCoordinator({ reuseWindowMs: 100, now: () => now });
	const input = { userId: 'admin-1', refreshToken: 'refresh-1' };

	assert.equal(
		await coordinator.run({
			...input,
			refresh: async () => {
				refreshCalls += 1;
				return null;
			}
		}),
		null
	);
	assert.deepEqual(
		await coordinator.run({
			...input,
			refresh: async () => {
				refreshCalls += 1;
				return { accessToken: 'a', refreshToken: 'b' };
			}
		}),
		{ accessToken: 'a', refreshToken: 'b' }
	);
	assert.equal(refreshCalls, 2);

	now += 101;
	await coordinator.run({
		...input,
		refresh: async () => {
			refreshCalls += 1;
			return { accessToken: 'c', refreshToken: 'd' };
		}
	});
	assert.equal(refreshCalls, 3);
});

test('refresh cache keys are fixed-length fingerprints and separated by admin', () => {
	const first = fingerprintAdminRefreshSession({ userId: 'admin-1', refreshToken: 'secret' });
	const same = fingerprintAdminRefreshSession({ userId: 'admin-1', refreshToken: 'secret' });
	const other = fingerprintAdminRefreshSession({ userId: 'admin-2', refreshToken: 'secret' });

	assert.equal(first, same);
	assert.notEqual(first, other);
	assert.equal(first.includes('secret'), false);
	assert.equal(first.length, 43);
});

test('only authentication failures rotate admin tokens', () => {
	assert.equal(shouldRefreshAdminSession(401), true);
	assert.equal(shouldRefreshAdminSession(403), false);
	assert.equal(shouldRefreshAdminSession(500), false);
});
