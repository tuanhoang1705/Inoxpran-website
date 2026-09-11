import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { mergeHomeFeedSources } from '../src/lib/server/homeFeedContract.js';

const read = (relativePath) => fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

const products = [{ _id: 'p1' }];
const posts = [{ id: 'b1' }];

test('a slow blog query no longer blanks the product rail', () => {
	// This is the reported bug, reduced: best-selling answered, the blog list timed
	// out, and the homepage reported "product request failed" over a shelf whose own
	// query had succeeded.
	const merged = mergeHomeFeedSources({
		bestSellingItems: products,
		latestBlogItems: null,
		previous: { bestSelling: [{ _id: 'old' }], latestPosts: posts }
	});

	assert.deepEqual(merged.bestSelling, products);
	assert.deepEqual(merged.latestPosts, posts);
	assert.equal(merged.loaded, true);
	assert.equal(merged.sourceHealth.bestSelling, 'ready');
	assert.equal(merged.sourceHealth.latestPosts, 'stale');
});

test('a source with no remembered value is reported unavailable, not silently empty', () => {
	const merged = mergeHomeFeedSources({
		bestSellingItems: products,
		latestBlogItems: null,
		previous: null
	});

	assert.equal(merged.loaded, false);
	assert.equal(merged.sourceHealth.latestPosts, 'unavailable');
});

test('an empty upstream response still counts as an answer', () => {
	// A shop with nothing published is a valid state; it must not be mistaken for an
	// outage and must not resurrect yesterday's rail.
	const merged = mergeHomeFeedSources({
		bestSellingItems: [],
		latestBlogItems: [],
		previous: { bestSelling: products, latestPosts: posts }
	});

	assert.deepEqual(merged.bestSelling, []);
	assert.deepEqual(merged.latestPosts, []);
	assert.equal(merged.loaded, true);
});

test('a refresh that answered nothing is not written back over the snapshot', () => {
	const merged = mergeHomeFeedSources({
		bestSellingItems: null,
		latestBlogItems: null,
		previous: { bestSelling: products, latestPosts: posts }
	});

	assert.equal(merged.loaded, true, 'the remembered feed is still renderable');
	assert.equal(merged.hasFreshSource, false, 'but there is nothing new worth storing');
});

test('the refresh timeout is generous because nobody is waiting on it', () => {
	const source = read('src/lib/server/homeFeed.js');
	const apiTimeout = Number(
		/HOME_FEED_API_TIMEOUT_MS'\s*,\s*([\d_]+)/.exec(source)?.[1]?.replace(/_/g, '')
	);
	const refreshInterval = Number(
		/HOME_FEED_REFRESH_INTERVAL_MS'\s*,\s*([\d_]+)/.exec(source)?.[1]?.replace(/_/g, '')
	);

	// The old value was 1200ms, below the round trip it was meant to cover, so every
	// refresh aborted and the snapshot froze at whatever boot had loaded.
	assert.ok(apiTimeout >= 10_000, `refresh timeout ${apiTimeout}ms must outlast a slow upstream`);
	// Refreshing must outpace the cache it fills, or there is a window with no warm copy.
	const ttl = Number(/HOME_FEED_TTL_MS'\s*,\s*([\d_]+)/.exec(source)?.[1]?.replace(/_/g, ''));
	assert.ok(refreshInterval < ttl, `refresh (${refreshInterval}ms) must beat the TTL (${ttl}ms)`);
});

test('the scheduled refresh bypasses the read cache instead of being absorbed by it', () => {
	const source = read('src/lib/server/homeFeed.js');
	const warmLoop = /startHomeFeedWarmLoop[\s\S]*?\n};/.exec(source)?.[0] || '';

	// getOrLoad returns the cached value while it is still valid, so a loop calling it
	// refreshes nothing until the entry expires - and then a visitor is the one waiting.
	assert.match(warmLoop, /refreshHomeFeed/);
	assert.doesNotMatch(warmLoop, /getHomeFeed/);
	// And the refresh has to write its result back, or the next reader reloads anyway.
	assert.match(source, /homeFeedCache\.set\(/);
});

test('the browser retries before it reports a failure', () => {
	const page = read('src/routes/+page.svelte');
	const timeout = Number(
		/CLIENT_HOME_FEED_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(page)?.[1]?.replace(/_/g, '')
	);
	const delays = /CLIENT_HOME_FEED_RETRY_DELAYS_MS\s*=\s*\[([^\]]+)\]/
		.exec(page)?.[1]
		.split(',')
		.map((value) => Number(value.trim().replace(/_/g, '')));

	assert.ok(timeout >= 5_000, `client timeout ${timeout}ms must exceed a cold round trip`);
	assert.ok(delays.length >= 2, 'a single attempt is what left visitors pressing reload');
	assert.equal(delays.at(-1), 0, 'there is no attempt after the last one to wait for');
});

test('the render reaches for the shared snapshot before it reports an error', () => {
	const loader = read('src/routes/+page.server.js');

	assert.match(loader, /readHomeFeedSnapshot/);
	// The snapshot lookup is the fallback, so it must not be paid for on the happy path.
	assert.match(loader, /fresh\?\.loaded\s*\?\s*null\s*:/);
});

test('the shop catalogue is kept warm the same way, not on a visitor request', () => {
	const source = read('src/lib/server/shopCatalogData.js');
	const warmLoop = /startCatalogWarmLoop[\s\S]*?\n};/.exec(source)?.[0] || '';

	// The shop pulls the whole catalogue to count facets, so a cold cache there costs
	// a visitor exactly what a cold home feed used to.
	assert.match(warmLoop, /refreshCatalogSnapshot/);
	assert.doesNotMatch(warmLoop, /fetchAllCatalogProducts/);
	assert.match(source, /catalogSnapshotCache\.set\(/);
	// And it must fall back to the stored catalogue rather than rendering an empty grid.
	assert.match(source, /readCatalogSnapshot/);

	const refresh = Number(
		/SHOP_CATALOG_REFRESH_INTERVAL_MS'\s*,\s*([\d_]+)/.exec(source)?.[1]?.replace(/_/g, '')
	);
	const ttl = Number(/SHOP_CATALOG_TTL_MS'\s*,\s*([\d_]+)/.exec(source)?.[1]?.replace(/_/g, ''));
	assert.ok(refresh < ttl, `refresh (${refresh}ms) must beat the TTL (${ttl}ms)`);
});

test('both warm loops start at boot', () => {
	const hooks = read('src/hooks.server.js');
	assert.match(hooks, /startHomeFeedWarmLoop/);
	assert.match(hooks, /startCatalogWarmLoop/);
});
