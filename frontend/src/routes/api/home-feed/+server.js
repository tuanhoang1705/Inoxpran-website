import { json } from '@sveltejs/kit';
import { getHomeFeed, HOME_FEED_CACHE_CONTROL } from '$lib/server/homeFeed.js';

export const GET = async ({ fetch, setHeaders }) => {
	const feed = await getHomeFeed({ fetch });
	const loaded = Boolean(feed?.loaded);
	setHeaders({
		'cache-control': loaded ? HOME_FEED_CACHE_CONTROL : 'no-store'
	});
	return json(
		{
			success: loaded,
			bestSelling: Array.isArray(feed?.bestSelling) ? feed.bestSelling : [],
			latestPosts: Array.isArray(feed?.latestPosts) ? feed.latestPosts : [],
			...(loaded
				? { stale: Boolean(feed?.stale) }
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
