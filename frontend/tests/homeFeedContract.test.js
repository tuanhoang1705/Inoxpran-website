import assert from 'node:assert/strict';
import test from 'node:test';

import {
	extractBestSellingItems,
	extractLatestBlogItems,
	isCompleteHomeFeed
} from '../src/lib/server/homeFeedContract.js';

test('home feed accepts empty arrays as valid source responses', () => {
	const bestSellingItems = extractBestSellingItems({ metadata: [] });
	const latestBlogItems = extractLatestBlogItems({ metadata: { items: [] } });

	assert.deepEqual(bestSellingItems, []);
	assert.deepEqual(latestBlogItems, []);
	assert.equal(isCompleteHomeFeed({ bestSellingItems, latestBlogItems }), true);
});

test('home feed rejects malformed 200 payloads and requires both sources', () => {
	assert.equal(extractBestSellingItems({ metadata: {} }), null);
	assert.equal(extractLatestBlogItems({ metadata: [] }), null);
	assert.equal(isCompleteHomeFeed({ bestSellingItems: [], latestBlogItems: null }), false);
	assert.equal(isCompleteHomeFeed({ bestSellingItems: null, latestBlogItems: [] }), false);
});
