export const extractBestSellingItems = (payload) =>
	Array.isArray(payload?.metadata) ? payload.metadata : null;

export const extractLatestBlogItems = (payload) =>
	Array.isArray(payload?.metadata?.items) ? payload.metadata.items : null;

export const isCompleteHomeFeed = ({ bestSellingItems, latestBlogItems } = {}) =>
	Array.isArray(bestSellingItems) && Array.isArray(latestBlogItems);

export const HOME_FEED_CACHE_CONTROL =
	'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

// A stale render must not be pinned at the edge for the full five minutes, or a
// single slow moment would keep serving old data long after the feed recovered.
export const STALE_HOME_FEED_CACHE_CONTROL =
	'public, max-age=15, s-maxage=30, stale-while-revalidate=300';

// Missing the SSR budget is not the same as having no data. A cold MongoDB
// Atlas connection alone costs more than that budget, so the first visitor
// after the cache expired could be shown "product request failed" while a
// perfectly good feed sat in memory. The abandoned refresh keeps running and
// fills the cache for the next visitor, so render the last good snapshot.
export const resolveHomeFeedForRender = ({ fresh = null, snapshot = null } = {}) => {
	const hasFresh = Boolean(fresh?.loaded);
	const feed = hasFresh ? fresh : snapshot?.loaded ? snapshot : null;
	const servedStale = !hasFresh && Boolean(feed);
	return {
		feed,
		servedStale,
		cacheControl: !feed
			? 'no-store'
			: servedStale
				? STALE_HOME_FEED_CACHE_CONTROL
				: HOME_FEED_CACHE_CONTROL
	};
};
