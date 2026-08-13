import assert from 'node:assert/strict';
import test from 'node:test';

import {
	resolveHomeFeedForRender,
	HOME_FEED_CACHE_CONTROL,
	STALE_HOME_FEED_CACHE_CONTROL
} from '../src/lib/server/homeFeedContract.js';

const feedOf = (label) => ({
	loaded: true,
	bestSelling: [{ _id: label }],
	latestPosts: [{ id: label }]
});

test('a fresh feed is served and cached normally', () => {
	const fresh = feedOf('fresh');
	const result = resolveHomeFeedForRender({ fresh, snapshot: feedOf('old') });

	assert.equal(result.feed, fresh);
	assert.equal(result.servedStale, false);
	assert.equal(result.cacheControl, HOME_FEED_CACHE_CONTROL);
});

test('a missed budget renders the last good feed instead of an error', () => {
	// waitWithTimeout resolves to null when the SSR budget expires. A cold Atlas
	// connection alone costs more than that budget, so this is the ordinary case
	// for the first visitor after the cache expired — not a real outage.
	const snapshot = feedOf('previous');
	const result = resolveHomeFeedForRender({ fresh: null, snapshot });

	assert.equal(result.feed, snapshot);
	assert.equal(result.servedStale, true);
	assert.equal(result.cacheControl, STALE_HOME_FEED_CACHE_CONTROL);
});

test('a stale render is not pinned at the edge for as long as a fresh one', () => {
	assert.notEqual(STALE_HOME_FEED_CACHE_CONTROL, HOME_FEED_CACHE_CONTROL);
	const staleSMaxAge = Number(/s-maxage=(\d+)/.exec(STALE_HOME_FEED_CACHE_CONTROL)?.[1]);
	const freshSMaxAge = Number(/s-maxage=(\d+)/.exec(HOME_FEED_CACHE_CONTROL)?.[1]);
	assert.ok(staleSMaxAge < freshSMaxAge);
});

test('an incomplete snapshot is never presented as content', () => {
	const result = resolveHomeFeedForRender({
		fresh: null,
		snapshot: { loaded: false, bestSelling: [], latestPosts: [] }
	});

	assert.equal(result.feed, null);
	assert.equal(result.servedStale, false);
	assert.equal(result.cacheControl, 'no-store');
});

test('with nothing cached at all the page still reports the failure', () => {
	const result = resolveHomeFeedForRender({ fresh: null, snapshot: null });

	assert.equal(result.feed, null);
	assert.equal(result.cacheControl, 'no-store');
});

test('a fresh but incomplete feed falls back rather than rendering empty shelves', () => {
	const snapshot = feedOf('previous');
	const result = resolveHomeFeedForRender({
		fresh: { loaded: false, bestSelling: [], latestPosts: [] },
		snapshot
	});

	assert.equal(result.feed, snapshot);
	assert.equal(result.servedStale, true);
});
