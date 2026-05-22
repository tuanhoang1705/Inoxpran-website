import { json } from '@sveltejs/kit';
import { getHomeFeed, HOME_FEED_CACHE_CONTROL } from '$lib/server/homeFeed.js';

export const GET = async ({ fetch, setHeaders }) => {
	const feed = await getHomeFeed({ fetch });
	setHeaders({
		'cache-control': feed.loaded ? HOME_FEED_CACHE_CONTROL : 'no-store'
	});
	return json(
		{
			success: Boolean(feed?.loaded),
			bestSelling: Array.isArray(feed?.bestSelling) ? feed.bestSelling : [],
			latestPosts: Array.isArray(feed?.latestPosts) ? feed.latestPosts : []
		},
		{
			status: 200
		}
	);
};
