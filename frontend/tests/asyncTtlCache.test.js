import assert from 'node:assert/strict';
import test from 'node:test';

import { createAsyncTtlCache } from '../src/lib/server/asyncTtlCache.js';

const controllableClock = (start = 1_000) => {
	let current = start;
	return {
		now: () => current,
		advance: (ms) => {
			current += ms;
		}
	};
};

test('a seeded value is served without asking the loader for it', async () => {
	const clock = controllableClock();
	const cache = createAsyncTtlCache({ ttlMs: 60_000, now: clock.now });
	let loaderCalls = 0;

	cache.set('feed', { id: 'from-refresh' });
	const value = await cache.getOrLoad('feed', async () => {
		loaderCalls += 1;
		return { id: 'from-loader' };
	});

	assert.deepEqual(value, { id: 'from-refresh' });
	assert.equal(loaderCalls, 0);
});

test('seeding restarts the lifetime, which is what keeps a scheduled refresh useful', async () => {
	// A refresh that ran but did not extend the entry would leave the cache expiring on
	// its original schedule, and a visitor arriving at that moment would still wait on
	// the upstream - the exact gap the background loop exists to close.
	const clock = controllableClock();
	const cache = createAsyncTtlCache({ ttlMs: 60_000, now: clock.now });
	let loaderCalls = 0;
	const load = async () => {
		loaderCalls += 1;
		return { id: `load-${loaderCalls}` };
	};

	await cache.getOrLoad('feed', load);
	clock.advance(45_000);
	cache.set('feed', { id: 'refreshed' });

	// Past the original expiry, but inside the refreshed one.
	clock.advance(30_000);
	const value = await cache.getOrLoad('feed', load);

	assert.deepEqual(value, { id: 'refreshed' });
	assert.equal(loaderCalls, 1, 'the seeded value must not be reloaded');
});

test('an expired entry is loaded again', async () => {
	const clock = controllableClock();
	const cache = createAsyncTtlCache({ ttlMs: 10_000, now: clock.now });

	cache.set('feed', { id: 'stale' });
	clock.advance(10_001);
	const value = await cache.getOrLoad('feed', async () => ({ id: 'reloaded' }));

	assert.deepEqual(value, { id: 'reloaded' });
});

test('concurrent readers share one load rather than stampeding the upstream', async () => {
	const cache = createAsyncTtlCache({ ttlMs: 60_000 });
	let loaderCalls = 0;
	const load = async () => {
		loaderCalls += 1;
		await new Promise((resolve) => setTimeout(resolve, 10));
		return { id: 'once' };
	};

	const results = await Promise.all([
		cache.getOrLoad('feed', load),
		cache.getOrLoad('feed', load),
		cache.getOrLoad('feed', load)
	]);

	assert.equal(loaderCalls, 1);
	for (const result of results) assert.deepEqual(result, { id: 'once' });
});

test('a failed load does not leave a poisoned entry behind', async () => {
	const cache = createAsyncTtlCache({ ttlMs: 60_000 });

	await assert.rejects(
		cache.getOrLoad('feed', async () => {
			throw new Error('upstream down');
		})
	);

	const value = await cache.getOrLoad('feed', async () => ({ id: 'recovered' }));
	assert.deepEqual(value, { id: 'recovered' });
});
