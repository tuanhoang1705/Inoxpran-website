'use strict';

const UserSession = require('../models/userSession.model');
const UserEvent = require('../models/userEvent.model');
const userModel = require('../models/user.model');
const { product } = require('../models/product.model');
const { blog } = require('../models/blog.model');
const { order } = require('../models/order');

const ACTIVE_TIME_EVENT_TYPES = ['heartbeat', 'page_leave', 'session_end'];
const DAY_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_TIMEZONE = 'Asia/Ho_Chi_Minh';

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const toDateKey = (value) => {
	const raw = value == null ? '' : String(value).trim();
	return raw || null;
};

const toNumber = (value, fallback = 0) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min = 0, max = 100) => Math.min(Math.max(value, min), max);

const toPercentile = (values = [], percentile = 0.9) => {
	const normalized = ensureArray(values)
		.map((value) => Number(value))
		.filter((value) => Number.isFinite(value))
		.map((value) => clamp(value, 0, 100))
		.sort((left, right) => left - right);

	if (!normalized.length) return 0;
	const safePercentile = Math.min(Math.max(Number(percentile) || 0, 0), 1);
	const rank = Math.max(0, Math.ceil(safePercentile * normalized.length) - 1);
	return normalized[Math.min(rank, normalized.length - 1)];
};

const extractBlogSlug = (path) => {
	const raw = typeof path === 'string' ? path.trim() : '';
	if (!raw) return null;
	const match = raw.match(/^\/blog\/([^/?#]+)/i);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
};

class DashboardMetricsService {
	static async getWindowTelemetry({ since, until }) {
		const sinceDate = since instanceof Date ? since : new Date(since || Date.now());
		const untilDate = until instanceof Date ? until : new Date(until || Date.now());
		if (Number.isNaN(sinceDate.getTime()) || Number.isNaN(untilDate.getTime())) {
			return null;
		}

		const effectiveAtExpr = { $ifNull: ['$occurredAt', '$createdAt'] };
		const baseWindowStages = [
			{ $addFields: { effectiveAt: effectiveAtExpr } },
			{ $match: { effectiveAt: { $gte: sinceDate, $lte: untilDate } } }
		];

		const [trafficRows, mappedRows] = await Promise.all([
			UserEvent.aggregate([
				...baseWindowStages,
				{
					$group: {
						_id: '$sessionId',
						user: { $max: '$user' },
						ip: { $max: '$ip' },
						eventCount: { $sum: 1 },
						pageViewCount: { $sum: { $cond: [{ $eq: ['$type', 'page_view'] }, 1, 0] } },
						productViewCount: { $sum: { $cond: [{ $eq: ['$type', 'product_view'] }, 1, 0] } },
						blogViewCount: { $sum: { $cond: [{ $eq: ['$type', 'blog_view'] }, 1, 0] } },
						clickCount: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
						scrollEventCount: { $sum: { $cond: [{ $eq: ['$type', 'scroll'] }, 1, 0] } },
						activeMs: {
							$sum: {
								$cond: [
									{ $in: ['$type', ACTIVE_TIME_EVENT_TYPES] },
									{ $ifNull: ['$durationMs', 0] },
									0
								]
							}
						},
						maxScrollDepthPercent: { $max: { $ifNull: ['$scrollDepthPercent', 0] } },
						hasCheckoutVisit: {
							$max: {
								$cond: [
									{
										$and: [
											{ $eq: ['$type', 'page_view'] },
											{
												$regexMatch: {
													input: { $ifNull: ['$path', ''] },
													regex: '^/checkout(?:$|/)'
												}
											}
										]
									},
									1,
									0
								]
							}
						},
						hasAddToCartClick: {
							$max: {
								$cond: [
									{
										$and: [
											{ $eq: ['$type', 'click'] },
											{
												$eq: [
													{ $ifNull: ['$click.trackName', null] },
													'add_to_cart_click'
												]
											}
										]
									},
									1,
									0
								]
							}
						}
					}
				},
				{
					$group: {
						_id: null,
						sessions: { $sum: 1 },
						identifiedSessions: { $sum: { $cond: [{ $ne: ['$user', null] }, 1, 0] } },
						anonymousSessions: { $sum: { $cond: [{ $eq: ['$user', null] }, 1, 0] } },
						sessionsWithProductViews: {
							$sum: { $cond: [{ $gt: ['$productViewCount', 0] }, 1, 0] }
						},
						sessionsWithBlogViews: {
							$sum: { $cond: [{ $gt: ['$blogViewCount', 0] }, 1, 0] }
						},
						checkoutSessions: { $sum: '$hasCheckoutVisit' },
						addToCartSessions: { $sum: '$hasAddToCartClick' },
						bounceSessions: {
							$sum: {
								$cond: [
									{
										$and: [
											{ $lte: ['$pageViewCount', 1] },
											{ $lt: ['$activeMs', 15000] }
										]
									},
									1,
									0
								]
							}
						},
						eventCount: { $sum: '$eventCount' },
						pageViewCount: { $sum: '$pageViewCount' },
						productViewCount: { $sum: '$productViewCount' },
						blogViewCount: { $sum: '$blogViewCount' },
						clickCount: { $sum: '$clickCount' },
						scrollEventCount: { $sum: '$scrollEventCount' },
						totalActiveMs: { $sum: '$activeMs' },
						avgActiveMsPerSession: { $avg: '$activeMs' },
						avgPageViewsPerSession: { $avg: '$pageViewCount' },
						avgScrollDepthPercent: { $avg: '$maxScrollDepthPercent' },
						maxScrollDepthPercent: { $max: '$maxScrollDepthPercent' },
						scrollDepthSamples: { $push: '$maxScrollDepthPercent' },
						uniqueUsers: { $addToSet: '$user' },
						uniqueIps: { $addToSet: '$ip' }
					}
				},
				{
					$project: {
						_id: 0,
						sessions: 1,
						identifiedSessions: 1,
						anonymousSessions: 1,
						sessionsWithProductViews: 1,
						sessionsWithBlogViews: 1,
						checkoutSessions: 1,
						addToCartSessions: 1,
						bounceSessions: 1,
						eventCount: 1,
						pageViewCount: 1,
						productViewCount: 1,
						blogViewCount: 1,
						clickCount: 1,
						scrollEventCount: 1,
						totalActiveMs: 1,
						avgActiveMsPerSession: 1,
						avgPageViewsPerSession: 1,
						avgScrollDepthPercent: 1,
						maxScrollDepthPercent: 1,
						scrollDepthSamples: 1,
						uniqueTrackedUsers: {
							$size: {
								$filter: {
									input: '$uniqueUsers',
									as: 'userId',
									cond: { $ne: ['$$userId', null] }
								}
							}
						},
						uniqueIps: {
							$size: {
								$filter: {
									input: '$uniqueIps',
									as: 'ip',
									cond: { $and: [{ $ne: ['$$ip', null] }, { $ne: ['$$ip', ''] }] }
								}
							}
						}
					}
				}
			]),
			UserSession.aggregate([
				{
					$match: {
						eventCount: { $gt: 0 },
						startedAnonymous: true,
						mappedUserAt: { $gte: sinceDate, $lte: untilDate }
					}
				},
				{
					$group: {
						_id: null,
						mappedAnonymousSessions: { $sum: 1 }
					}
				}
			])
		]);

		const traffic = trafficRows?.[0] || {};
		const mapped = mappedRows?.[0] || {};
		const sessions = toNumber(traffic.sessions);
		const bounceSessions = toNumber(traffic.bounceSessions);
		const totalActiveMs = toNumber(traffic.totalActiveMs);

		return {
			since: sinceDate,
			until: untilDate,
			sessions,
			identifiedSessions: toNumber(traffic.identifiedSessions),
			anonymousSessions: toNumber(traffic.anonymousSessions),
			mappedAnonymousSessions: toNumber(mapped.mappedAnonymousSessions),
			uniqueTrackedUsers: toNumber(traffic.uniqueTrackedUsers),
			uniqueIps: toNumber(traffic.uniqueIps),
			eventCount: toNumber(traffic.eventCount),
			pageViewCount: toNumber(traffic.pageViewCount),
			productViewCount: toNumber(traffic.productViewCount),
			blogViewCount: toNumber(traffic.blogViewCount),
			clickCount: toNumber(traffic.clickCount),
			scrollEventCount: toNumber(traffic.scrollEventCount),
			sessionsWithProductViews: toNumber(traffic.sessionsWithProductViews),
			sessionsWithBlogViews: toNumber(traffic.sessionsWithBlogViews),
			checkoutSessions: toNumber(traffic.checkoutSessions),
			addToCartSessions: toNumber(traffic.addToCartSessions),
			bounceSessions,
			bounceRate: sessions > 0 ? Number((bounceSessions / sessions).toFixed(4)) : 0,
			totalActiveMs,
			totalActiveSeconds: Math.round(totalActiveMs / 1000),
			avgActiveMsPerSession: Math.round(toNumber(traffic.avgActiveMsPerSession)),
			avgActiveSecondsPerSession: Math.round(toNumber(traffic.avgActiveMsPerSession) / 1000),
			avgPageViewsPerSession: Number(toNumber(traffic.avgPageViewsPerSession).toFixed(2)),
			avgScrollDepthPercent: Math.round(toNumber(traffic.avgScrollDepthPercent)),
			maxScrollDepthPercent: Math.round(toPercentile(traffic.scrollDepthSamples, 0.9)),
			absoluteMaxScrollDepthPercent: Math.round(toNumber(traffic.maxScrollDepthPercent))
		};
	}

	static async getBusinessMetrics({ now }) {
		const nowDate = now instanceof Date ? now : new Date();
		const since24h = new Date(nowDate.getTime() - DAY_MS);
		const since7d = new Date(nowDate.getTime() - 7 * DAY_MS);
		const since30d = new Date(nowDate.getTime() - 30 * DAY_MS);

		const [userStatusRows, userWindows, productCounts, blogCounts, orderStatusRows, orderWindows, dailyOrders] =
			await Promise.all([
				userModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
				Promise.all([
					userModel.countDocuments({ createdAt: { $gte: since24h, $lte: nowDate } }),
					userModel.countDocuments({ createdAt: { $gte: since7d, $lte: nowDate } }),
					userModel.countDocuments({ createdAt: { $gte: since30d, $lte: nowDate } })
				]),
				product.aggregate([
					{
						$group: {
							_id: null,
							total: { $sum: 1 },
							published: { $sum: { $cond: [{ $eq: ['$isPublished', true] }, 1, 0] } },
							draft: { $sum: { $cond: [{ $eq: ['$isDraft', true] }, 1, 0] } }
						}
					}
				]),
				blog.aggregate([
					{
						$group: {
							_id: null,
							total: { $sum: 1 },
							published: { $sum: { $cond: [{ $eq: ['$isPublished', true] }, 1, 0] } },
							draft: { $sum: { $cond: [{ $eq: ['$isDraft', true] }, 1, 0] } },
							totalViews: { $sum: { $ifNull: ['$blog_views', 0] } }
						}
					}
				]),
				order.aggregate([{ $group: { _id: '$order_status', count: { $sum: 1 } } }]),
				Promise.all([
					this.getOrderWindowMetrics({ since: since24h, until: nowDate }),
					this.getOrderWindowMetrics({ since: since7d, until: nowDate }),
					this.getOrderWindowMetrics({ since: since30d, until: nowDate })
				]),
				order.aggregate([
					{
						$match: {
							createdOn: { $gte: since30d, $lte: nowDate }
						}
					},
					{
						$group: {
							_id: {
								$dateToString: {
									format: '%Y-%m-%d',
									date: '$createdOn',
									timezone: DASHBOARD_TIMEZONE
								}
							},
							orders: { $sum: 1 },
							deliveredOrders: {
								$sum: { $cond: [{ $eq: ['$order_status', 'delivered'] }, 1, 0] }
							},
							revenue: { $sum: { $ifNull: ['$order_checkout.totalCheckout', 0] } },
							deliveredRevenue: {
								$sum: {
									$cond: [
										{ $eq: ['$order_status', 'delivered'] },
										{ $ifNull: ['$order_checkout.totalCheckout', 0] },
										0
									]
								}
							}
						}
					},
					{ $sort: { _id: 1 } }
				])
			]);

		const usersByStatus = { active: 0, inactive: 0, blocked: 0 };
		for (const row of ensureArray(userStatusRows)) {
			const key = typeof row?._id === 'string' ? row._id : '';
			if (!key) continue;
			usersByStatus[key] = toNumber(row?.count);
		}

		const ordersByStatus = {
			pending: 0,
			confirmed: 0,
			shipped: 0,
			cancel_requested: 0,
			cancelled: 0,
			delivered: 0,
			returned: 0
		};
		for (const row of ensureArray(orderStatusRows)) {
			const key = typeof row?._id === 'string' ? row._id : '';
			if (!key) continue;
			ordersByStatus[key] = toNumber(row?.count);
		}

		const productRow = productCounts?.[0] || {};
		const blogRow = blogCounts?.[0] || {};

		return {
			users: {
				total: Object.values(usersByStatus).reduce((sum, count) => sum + toNumber(count), 0),
				byStatus: usersByStatus,
				newUsers: {
					last24h: toNumber(userWindows?.[0]),
					last7d: toNumber(userWindows?.[1]),
					last30d: toNumber(userWindows?.[2])
				}
			},
			products: {
				total: toNumber(productRow.total),
				published: toNumber(productRow.published),
				draft: toNumber(productRow.draft)
			},
			blogs: {
				total: toNumber(blogRow.total),
				published: toNumber(blogRow.published),
				draft: toNumber(blogRow.draft),
				totalViews: toNumber(blogRow.totalViews)
			},
			orders: {
				total: Object.values(ordersByStatus).reduce((sum, count) => sum + toNumber(count), 0),
				byStatus: ordersByStatus,
				windows: {
					last24h: orderWindows?.[0] || this.emptyOrderWindow(since24h, nowDate),
					last7d: orderWindows?.[1] || this.emptyOrderWindow(since7d, nowDate),
					last30d: orderWindows?.[2] || this.emptyOrderWindow(since30d, nowDate)
				}
			},
			dailyOrders30d: ensureArray(dailyOrders).map((row) => ({
				date: toDateKey(row?._id),
				orders: toNumber(row?.orders),
				deliveredOrders: toNumber(row?.deliveredOrders),
				revenue: toNumber(row?.revenue),
				deliveredRevenue: toNumber(row?.deliveredRevenue)
			}))
		};
	}

	static emptyOrderWindow(since, until) {
		return {
			since,
			until,
			orders: 0,
			deliveredOrders: 0,
			cancelledOrders: 0,
			returnedOrders: 0,
			revenue: 0,
			deliveredRevenue: 0,
			avgOrderValue: 0,
			deliveredAvgOrderValue: 0
		};
	}

	static async getOrderWindowMetrics({ since, until }) {
		const rows = await order.aggregate([
			{
				$match: {
					createdOn: { $gte: since, $lte: until }
				}
			},
			{
				$group: {
					_id: null,
					orders: { $sum: 1 },
					deliveredOrders: { $sum: { $cond: [{ $eq: ['$order_status', 'delivered'] }, 1, 0] } },
					cancelledOrders: { $sum: { $cond: [{ $eq: ['$order_status', 'cancelled'] }, 1, 0] } },
					returnedOrders: { $sum: { $cond: [{ $eq: ['$order_status', 'returned'] }, 1, 0] } },
					revenue: { $sum: { $ifNull: ['$order_checkout.totalCheckout', 0] } },
					deliveredRevenue: {
						$sum: {
							$cond: [
								{ $eq: ['$order_status', 'delivered'] },
								{ $ifNull: ['$order_checkout.totalCheckout', 0] },
								0
							]
						}
					}
				}
			}
		]);
		const row = rows?.[0] || {};
		const ordersCount = toNumber(row.orders);
		const deliveredOrdersCount = toNumber(row.deliveredOrders);
		const revenue = toNumber(row.revenue);
		const deliveredRevenue = toNumber(row.deliveredRevenue);
		return {
			since,
			until,
			orders: ordersCount,
			deliveredOrders: deliveredOrdersCount,
			cancelledOrders: toNumber(row.cancelledOrders),
			returnedOrders: toNumber(row.returnedOrders),
			revenue,
			deliveredRevenue,
			avgOrderValue: ordersCount > 0 ? Math.round(revenue / ordersCount) : 0,
			deliveredAvgOrderValue:
				deliveredOrdersCount > 0 ? Math.round(deliveredRevenue / deliveredOrdersCount) : 0
		};
	}

	static async getTopTrafficAndDaily30d({ now }) {
		const nowDate = now instanceof Date ? now : new Date();
		const since30d = new Date(nowDate.getTime() - 30 * DAY_MS);
		const effectiveAtExpr = { $ifNull: ['$occurredAt', '$createdAt'] };
		const baseStages = [
			{ $addFields: { effectiveAt: effectiveAtExpr } },
			{ $match: { effectiveAt: { $gte: since30d, $lte: nowDate } } }
		];

		const [pagesRows, productsRows, blogsRows, dailyEventRows, dailySessionRows] = await Promise.all([
			UserEvent.aggregate([
				...baseStages,
				{ $match: { type: 'page_view', path: { $nin: [null, ''] } } },
				{
					$group: {
						_id: '$path',
						pageViews: { $sum: 1 },
						lastSeenAt: { $max: '$effectiveAt' },
						sessions: { $addToSet: '$sessionId' }
					}
				},
				{
					$project: {
						_id: 0,
						path: '$_id',
						pageViews: 1,
						lastSeenAt: 1,
						uniqueSessions: { $size: '$sessions' }
					}
				},
				{ $sort: { pageViews: -1, lastSeenAt: -1 } },
				{ $limit: 15 }
			]),
			UserEvent.aggregate([
				...baseStages,
				{ $match: { type: 'product_view' } },
				{
					$group: {
						_id: {
							productId: '$product.productId',
							slug: '$product.slug',
							name: '$product.name'
						},
						views: { $sum: 1 },
						lastViewedAt: { $max: '$effectiveAt' },
						sessions: { $addToSet: '$sessionId' }
					}
				},
				{
					$project: {
						_id: 0,
						productId: '$_id.productId',
						slug: '$_id.slug',
						name: '$_id.name',
						views: 1,
						lastViewedAt: 1,
						uniqueSessions: { $size: '$sessions' }
					}
				},
				{ $sort: { views: -1, lastViewedAt: -1 } },
				{ $limit: 15 }
			]),
			UserEvent.aggregate([
				...baseStages,
				{ $match: { type: 'blog_view' } },
				{
					$group: {
						_id: {
							path: '$path',
							slug: '$meta.blogSlug',
							title: '$meta.title'
						},
						views: { $sum: 1 },
						lastViewedAt: { $max: '$effectiveAt' },
						sessions: { $addToSet: '$sessionId' }
					}
				},
				{
					$project: {
						_id: 0,
						path: '$_id.path',
						slug: '$_id.slug',
						title: '$_id.title',
						views: 1,
						lastViewedAt: 1,
						uniqueSessions: { $size: '$sessions' }
					}
				},
				{ $sort: { views: -1, lastViewedAt: -1 } },
				{ $limit: 15 }
			]),
			UserEvent.aggregate([
				...baseStages,
				{
					$group: {
						_id: {
							$dateToString: {
								format: '%Y-%m-%d',
								date: '$effectiveAt',
								timezone: DASHBOARD_TIMEZONE
							}
						},
						eventCount: { $sum: 1 },
						pageViewCount: { $sum: { $cond: [{ $eq: ['$type', 'page_view'] }, 1, 0] } },
						productViewCount: { $sum: { $cond: [{ $eq: ['$type', 'product_view'] }, 1, 0] } },
						blogViewCount: { $sum: { $cond: [{ $eq: ['$type', 'blog_view'] }, 1, 0] } },
						clickCount: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
						totalActiveMs: {
							$sum: {
								$cond: [
									{ $in: ['$type', ACTIVE_TIME_EVENT_TYPES] },
									{ $ifNull: ['$durationMs', 0] },
									0
								]
							}
						}
					}
				},
				{ $sort: { _id: 1 } }
			]),
			UserEvent.aggregate([
				...baseStages,
				{
					$group: {
						_id: {
							date: {
								$dateToString: {
									format: '%Y-%m-%d',
									date: '$effectiveAt',
									timezone: DASHBOARD_TIMEZONE
								}
							},
							sessionId: '$sessionId'
						},
						user: { $max: '$user' }
					}
				},
				{
					$group: {
						_id: '$_id.date',
						sessions: { $sum: 1 },
						identifiedSessions: { $sum: { $cond: [{ $ne: ['$user', null] }, 1, 0] } },
						uniqueUsersSet: { $addToSet: '$user' }
					}
				},
				{
					$project: {
						_id: 0,
						date: '$_id',
						sessions: 1,
						identifiedSessions: 1,
						uniqueUsers: {
							$size: {
								$filter: {
									input: '$uniqueUsersSet',
									as: 'userId',
									cond: { $ne: ['$$userId', null] }
								}
							}
						}
					}
				},
				{ $sort: { date: 1 } }
			])
		]);

		const dailyMap = new Map();
		for (const row of ensureArray(dailyEventRows)) {
			const date = toDateKey(row?._id);
			if (!date) continue;
			dailyMap.set(date, {
				date,
				sessions: 0,
				identifiedSessions: 0,
				uniqueUsers: 0,
				eventCount: toNumber(row?.eventCount),
				pageViewCount: toNumber(row?.pageViewCount),
				productViewCount: toNumber(row?.productViewCount),
				blogViewCount: toNumber(row?.blogViewCount),
				clickCount: toNumber(row?.clickCount),
				totalActiveMs: toNumber(row?.totalActiveMs)
			});
		}
		for (const row of ensureArray(dailySessionRows)) {
			const date = toDateKey(row?.date);
			if (!date) continue;
			const existing = dailyMap.get(date) || {
				date,
				eventCount: 0,
				pageViewCount: 0,
				productViewCount: 0,
				blogViewCount: 0,
				clickCount: 0,
				totalActiveMs: 0
			};
			existing.sessions = toNumber(row?.sessions);
			existing.identifiedSessions = toNumber(row?.identifiedSessions);
			existing.uniqueUsers = toNumber(row?.uniqueUsers);
			dailyMap.set(date, existing);
		}

		return {
			topPages30d: ensureArray(pagesRows).map((row) => ({
				path: row?.path || null,
				pageViews: toNumber(row?.pageViews),
				uniqueSessions: toNumber(row?.uniqueSessions),
				lastSeenAt: row?.lastSeenAt || null
			})).filter((row) => row.path),
			topProducts30d: ensureArray(productsRows)
				.map((row) => ({
					productId: row?.productId ? String(row.productId) : null,
					slug: row?.slug || null,
					name: row?.name || null,
					views: toNumber(row?.views),
					uniqueSessions: toNumber(row?.uniqueSessions),
					lastViewedAt: row?.lastViewedAt || null
				}))
				.filter((row) => row.productId || row.slug || row.name),
			topBlogs30d: ensureArray(blogsRows)
				.map((row) => ({
					path: row?.path || null,
					slug: row?.slug || extractBlogSlug(row?.path),
					title: row?.title || null,
					views: toNumber(row?.views),
					uniqueSessions: toNumber(row?.uniqueSessions),
					lastViewedAt: row?.lastViewedAt || null
				}))
				.filter((row) => (row.slug || row.path) && row.path !== '/blog'),
			daily30d: Array.from(dailyMap.values())
				.sort((a, b) => String(a.date).localeCompare(String(b.date)))
				.map((row) => ({
					...row,
					totalActiveSeconds: Math.round(toNumber(row.totalActiveMs) / 1000)
				}))
		};
	}

	static async getDashboardSummary() {
		const now = new Date();
		const [last24h, last7d, last30d, business, traffic30d] = await Promise.all([
			this.getWindowTelemetry({ since: new Date(now.getTime() - DAY_MS), until: now }),
			this.getWindowTelemetry({ since: new Date(now.getTime() - 7 * DAY_MS), until: now }),
			this.getWindowTelemetry({ since: new Date(now.getTime() - 30 * DAY_MS), until: now }),
			this.getBusinessMetrics({ now }),
			this.getTopTrafficAndDaily30d({ now })
		]);

		const windows = {
			last24h: last24h || null,
			last7d: last7d || null,
			last30d: last30d || null
		};
		const orderWindows = business?.orders?.windows || {};

		for (const key of ['last24h', 'last7d', 'last30d']) {
			const traffic = windows[key];
			const orderWindow = orderWindows[key];
			if (!traffic || !orderWindow) continue;
			traffic.orderCount = toNumber(orderWindow.orders);
			traffic.deliveredOrderCount = toNumber(orderWindow.deliveredOrders);
			traffic.grossRevenue = toNumber(orderWindow.revenue);
			traffic.revenue = toNumber(orderWindow.deliveredRevenue);
			traffic.deliveredRevenue = toNumber(orderWindow.deliveredRevenue);
			traffic.grossAvgOrderValue = toNumber(orderWindow.avgOrderValue);
			traffic.avgOrderValue = toNumber(orderWindow.deliveredAvgOrderValue);
			traffic.sessionToOrderRate =
				toNumber(traffic.sessions) > 0
					? Number((toNumber(orderWindow.orders) / toNumber(traffic.sessions)).toFixed(4))
					: 0;
			traffic.sessionToDeliveredOrderRate =
				toNumber(traffic.sessions) > 0
					? Number((toNumber(orderWindow.deliveredOrders) / toNumber(traffic.sessions)).toFixed(4))
					: 0;
		}

		const dailyMap = new Map();
		for (const row of ensureArray(traffic30d?.daily30d)) {
			if (!row?.date) continue;
			dailyMap.set(row.date, { ...row, orders: 0, deliveredOrders: 0, revenue: 0, deliveredRevenue: 0 });
		}
		for (const row of ensureArray(business?.dailyOrders30d)) {
			if (!row?.date) continue;
			const existing = dailyMap.get(row.date) || {
				date: row.date,
				sessions: 0,
				identifiedSessions: 0,
				uniqueUsers: 0,
				eventCount: 0,
				pageViewCount: 0,
				productViewCount: 0,
				blogViewCount: 0,
				clickCount: 0,
				totalActiveMs: 0,
				totalActiveSeconds: 0,
				orders: 0,
				deliveredOrders: 0,
				revenue: 0,
				deliveredRevenue: 0
			};
			existing.orders = toNumber(row.orders);
			existing.deliveredOrders = toNumber(row.deliveredOrders);
			existing.revenue = toNumber(row.revenue);
			existing.deliveredRevenue = toNumber(row.deliveredRevenue);
			dailyMap.set(row.date, existing);
		}

		return {
			generatedAt: now,
			timezone: DASHBOARD_TIMEZONE,
			trackingScope: 'consented_telemetry_only',
			windows,
			operations: {
				users: business?.users || null,
				products: business?.products || null,
				blogs: business?.blogs || null,
				orders: business?.orders || null
			},
			top: {
				pages30d: traffic30d?.topPages30d || [],
				products30d: traffic30d?.topProducts30d || [],
				blogs30d: traffic30d?.topBlogs30d || []
			},
			daily30d: Array.from(dailyMap.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)))
		};
	}
}

module.exports = DashboardMetricsService;
