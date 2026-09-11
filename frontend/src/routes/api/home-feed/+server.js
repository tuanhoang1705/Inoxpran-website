import { json } from '@sveltejs/kit';
import {
	getHomeFeed,
	readHomeFeedSnapshot,
	HOME_FEED_CACHE_CONTROL,
	STALE_HOME_FEED_CACHE_CONTROL
} from '$lib/server/homeFeed.js';

// The client calls this to rescue a render that had no feed, so it has to answer
// quickly and it has to answer with something. Blocking here for as long as a
// refresh takes is what made the browser's retry time out in turn.
const HOME_FEED_API_BUDGET_MS = 2_500;

const waitWithTimeout = async (promise, timeoutMs) => {
	let timeoutId = null;
	const timeoutToken = Symbol('timeout');
	try {
		const result = await Promise.race([
			promise,
			new Promise((resolve) => {
				timeoutId = setTimeout(() => resolve(timeoutToken), timeoutMs);
				timeoutId.unref?.();
			})
		]);
		return result === timeoutToken ? null : result;
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
};

export const GET = async ({ fetch, setHeaders }) => {
	// The abandoned refresh keeps running and fills the cache for the next caller,
	// which is why the retry on the client is worth making.
	const fresh = await waitWithTimeout(getHomeFeed({ fetch }), HOME_FEED_API_BUDGET_MS);
	const feed = fresh?.loaded ? fresh : await readHomeFeedSnapshot();
	const loaded = Boolean(feed?.loaded);
	const stale = loaded && (!fresh?.loaded || Boolean(fresh?.stale));

	setHeaders({
		'cache-control': !loaded
			? 'no-store'
			: stale
				? STALE_HOME_FEED_CACHE_CONTROL
				: HOME_FEED_CACHE_CONTROL
	});
	return json(
		{
			success: loaded,
			bestSelling: Array.isArray(feed?.bestSelling) ? feed.bestSelling : [],
			latestPosts: Array.isArray(feed?.latestPosts) ? feed.latestPosts : [],
			...(loaded
				? { stale }
				: {
						errorCode: 'HOME_FEED_UPSTREAM_UNAVAILABLE',
						sourceHealth: feed?.sourceHealth || {
							bestSelling: 'unavailable',
							latestPosts: 'unavailable'
						}
					})
		},
		{
			status: loaded ? 200 : 502
		}
	);
};
