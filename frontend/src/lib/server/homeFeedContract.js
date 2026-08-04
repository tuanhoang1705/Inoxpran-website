export const extractBestSellingItems = (payload) =>
	Array.isArray(payload?.metadata) ? payload.metadata : null;

export const extractLatestBlogItems = (payload) =>
	Array.isArray(payload?.metadata?.items) ? payload.metadata.items : null;

export const isCompleteHomeFeed = ({ bestSellingItems, latestBlogItems } = {}) =>
	Array.isArray(bestSellingItems) && Array.isArray(latestBlogItems);
