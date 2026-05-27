<script>
	import { locale, t } from '$lib/i18n/admin/index.js';

	let { data, form } = $props();

	let selectedWindowKey = $state('last30d');

	const dashboard = $derived(data?.dashboardSummary ?? null);
	const dashboardWindows = $derived(dashboard?.windows ?? {});
	const selectedWindow = $derived(dashboardWindows?.[selectedWindowKey] ?? null);
	const dashboardOps = $derived(dashboard?.operations ?? {});
	const topPages30d = $derived(Array.isArray(dashboard?.top?.pages30d) ? dashboard.top.pages30d : []);
	const topProducts30d = $derived(
		Array.isArray(dashboard?.top?.products30d) ? dashboard.top.products30d : []
	);
	const topBlogs30d = $derived(Array.isArray(dashboard?.top?.blogs30d) ? dashboard.top.blogs30d : []);
	const daily30d = $derived(Array.isArray(dashboard?.daily30d) ? dashboard.daily30d : []);
	const recentDailyRows = $derived.by(() => daily30d.slice(-14));

	const dashboardCopy = $derived.by(() =>
		$locale === 'en'
			? {
					trackingScope: 'Traffic metrics are based on consented telemetry only.',
					generatedAt: 'Updated',
					windows: {
						last24h: 'Last 24h',
						last7d: 'Last 7 days',
						last30d: 'Last 30 days'
					},
					kpis: {
						sessions: 'Tracked sessions',
						pageViews: 'Page views',
						orders: 'Orders',
						revenue: 'Revenue',
						avgActive: 'Avg active / session',
						bounceRate: 'Bounce rate',
						checkoutSessions: 'Checkout sessions',
						productViewSessions: 'Sessions with product views'
					},
					quality: {
						title: 'Engagement & Funnel (tracked)',
						uniqueUsers: 'Identified users',
						uniqueIps: 'Unique IPs',
						addToCartSessions: 'Add-to-cart sessions',
						deliveredOrders: 'Delivered orders',
						sessionToOrderRate: 'Session -> order rate',
						sessionToDeliveredRate: 'Session -> delivered rate',
						avgPagesPerSession: 'Avg pages / session',
						avgScrollDepth: 'Avg scroll depth',
						deepScrollSessions: 'Deep scroll sessions',
						deepScrollHint: 'Sessions reaching 75%+ depth'
					},
					ops: {
						title: 'Business Snapshot',
						users: 'Users',
						products: 'Products',
						blogs: 'Blogs',
						orders: 'Orders',
						published: 'Published',
						draft: 'Draft',
						totalViews: 'Blog views',
						pending: 'Pending',
						delivered: 'Delivered'
					},
					topPages: 'Top pages (30d)',
					topProducts: 'Top products (30d)',
					topBlogs: 'Top blogs (30d)',
					daily: 'Daily trend (last 14 days)',
					dailyHint: 'Sessions / page views / orders',
					noData: 'No tracked data yet.',
					noDashboard: 'Dashboard summary is unavailable right now.'
				}
			: {
					trackingScope: 'S\u1ED1 li\u1EC7u traffic d\u1EF1a tr\u00EAn telemetry \u0111\u00E3 \u0111\u01B0\u1EE3c ng\u01B0\u1EDDi d\u00F9ng \u0111\u1ED3ng \u00FD (consent).',
					generatedAt: 'C\u1EADp nh\u1EADt l\u00FAc',
					windows: {
						last24h: '24 gi\u1EDD',
						last7d: '7 ng\u00E0y',
						last30d: '30 ng\u00E0y'
					},
					kpis: {
						sessions: 'Phi\u00EAn \u0111\u01B0\u1EE3c theo d\u00F5i',
						pageViews: 'L\u01B0\u1EE3t xem trang',
						orders: '\u0110\u01A1n h\u00E0ng',
						revenue: 'Doanh thu',
						avgActive: 'TG ho\u1EA1t \u0111\u1ED9ng / phi\u00EAn',
						bounceRate: 'T\u1EF7 l\u1EC7 tho\u00E1t',
						checkoutSessions: 'Phi\u00EAn v\u00E0o checkout',
						productViewSessions: 'Phi\u00EAn xem s\u1EA3n ph\u1EA9m'
					},
					quality: {
						title: 'Ch\u1EA5t l\u01B0\u1EE3ng truy c\u1EADp & Funnel (tracked)',
						uniqueUsers: 'User \u0111\u00E3 \u0111\u1ECBnh danh',
						uniqueIps: 'IP duy nh\u1EA5t',
						addToCartSessions: 'Phi\u00EAn c\u00F3 th\u00EAm gi\u1ECF h\u00E0ng',
						deliveredOrders: '\u0110\u01A1n giao th\u00E0nh c\u00F4ng',
						sessionToOrderRate: 'T\u1EF7 l\u1EC7 phi\u00EAn -> \u0111\u01A1n',
						sessionToDeliveredRate: 'T\u1EF7 l\u1EC7 phi\u00EAn -> giao th\u00E0nh c\u00F4ng',
						avgPagesPerSession: 'TB trang / phi\u00EAn',
						avgScrollDepth: '\u0110\u1ED9 s\u00E2u cu\u1ED9n TB',
						deepScrollSessions: 'Phi\u00EAn cu\u1ED9n s\u00E2u',
						deepScrollHint: 'Phi\u00EAn \u0111\u1EA1t \u0111\u1ED9 s\u00E2u 75%+'
					},
					ops: {
						title: 'T\u1ED5ng quan v\u1EADn h\u00E0nh',
						users: 'Ng\u01B0\u1EDDi d\u00F9ng',
						products: 'S\u1EA3n ph\u1EA9m',
						blogs: 'B\u00E0i vi\u1EBFt',
						orders: '\u0110\u01A1n h\u00E0ng',
						published: '\u0110\u00E3 xu\u1EA5t b\u1EA3n',
						draft: 'B\u1EA3n nh\u00E1p',
						totalViews: 'L\u01B0\u1EE3t xem blog',
						pending: 'Ch\u1EDD x\u1EED l\u00FD',
						delivered: '\u0110\u00E3 giao'
					},
					topPages: 'Trang \u0111\u01B0\u1EE3c xem nhi\u1EC1u (30 ng\u00E0y)',
					topProducts: 'S\u1EA3n ph\u1EA9m \u0111\u01B0\u1EE3c xem nhi\u1EC1u (30 ng\u00E0y)',
					topBlogs: 'B\u00E0i blog \u0111\u01B0\u1EE3c xem nhi\u1EC1u (30 ng\u00E0y)',
					daily: 'Xu h\u01B0\u1EDBng theo ng\u00E0y (14 ng\u00E0y g\u1EA7n nh\u1EA5t)',
					dailyHint: 'Phi\u00EAn / l\u01B0\u1EE3t xem trang / \u0111\u01A1n h\u00E0ng',
					noData: 'Ch\u01B0a c\u00F3 d\u1EEF li\u1EC7u telemetry.',
					noDashboard: 'Hi\u1EC7n ch\u01B0a t\u1EA3i \u0111\u01B0\u1EE3c t\u1ED5ng h\u1EE3p dashboard.'
				}
	);

	const formatNumber = (value) => {
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return new Intl.NumberFormat(localeValue).format(Number(value) || 0);
	};

	const formatCurrency = (value) => `${formatNumber(value)}${$t('common.currency')}`;

	const formatPercent = (ratio) => {
		const numeric = Number(ratio) || 0;
		return `${new Intl.NumberFormat($locale === 'en' ? 'en-US' : 'vi-VN', {
			maximumFractionDigits: 1
		}).format(numeric * 100)}%`;
	};

	const formatDuration = (seconds) => {
		const total = Math.max(0, Number(seconds) || 0);
		if (total < 60) return `${Math.round(total)}s`;
		const minutes = Math.floor(total / 60);
		const remain = Math.round(total % 60);
		return remain ? `${minutes}m ${remain}s` : `${minutes}m`;
	};

	const formatDateTime = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		return new Intl.DateTimeFormat($locale === 'en' ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	};

	const maxDailySessions = $derived.by(() =>
		Math.max(1, ...recentDailyRows.map((row) => Number(row?.sessions) || 0))
	);
	const maxDailyPageViews = $derived.by(() =>
		Math.max(1, ...recentDailyRows.map((row) => Number(row?.pageViewCount) || 0))
	);
	const maxDailyOrders = $derived.by(() =>
		Math.max(1, ...recentDailyRows.map((row) => Number(row?.orders) || 0))
	);

	const getFeatureLabel = (key) => {
		const path = `admin.dashboard.siteSettings.flags.${key}.label`;
		const translated = $t(path);
		return translated === path ? key : translated;
	};

	const getFeatureDescription = (key) => {
		const path = `admin.dashboard.siteSettings.flags.${key}.description`;
		const translated = $t(path);
		return translated === path ? '' : translated;
	};
	// Hidden with the admin AI knowledge shortcut by request.
	// const knowledgeDocuments = $derived(
	// 	Array.isArray(data?.agentKnowledgeSettings?.documents)
	// 		? data.agentKnowledgeSettings.documents
	// 		: []
	// );
	const siteMarketingCampaign = $derived(data?.siteMarketingCampaign ?? {});
	const siteMarketplaceLinks = $derived(
		Array.isArray(data?.siteMarketplaceLinks) ? data.siteMarketplaceLinks : []
	);
</script>

<svelte:head>
	<title>{$t('admin.dashboard.title')} | Inoxpran</title>
</svelte:head>

<section class="admin-dashboard">
	<div class="border rounded-3 p-3 p-lg-4 bg-white admin-fade-up">
		<div class="d-flex flex-wrap justify-content-between align-items-start gap-3">
			<div>
				<h2 class="mb-2">{$t('admin.dashboard.title')}</h2>
				<p class="text-black-50 mb-1">{$t('admin.dashboard.siteSettings.description')}</p>
				<p class="small text-black-50 mb-0">{dashboardCopy.trackingScope}</p>
			</div>
			<div class="text-black-50 small">
				<div>{dashboardCopy.generatedAt}</div>
				<div class="fw-semibold text-dark">{formatDateTime(dashboard?.generatedAt)}</div>
			</div>
		</div>
	</div>

	{#if !dashboard}
		<div class="alert alert-warning mb-0">{dashboardCopy.noDashboard}</div>
	{:else}
		<div class="border rounded-3 p-3 bg-white admin-fade-up">
			<div class="d-flex flex-wrap gap-2">
				{#each ['last24h', 'last7d', 'last30d'] as key (key)}
					<button
						type="button"
						class={`btn btn-sm ${selectedWindowKey === key ? 'btn-dark' : 'btn-outline-dark'}`}
						onclick={() => (selectedWindowKey = key)}
					>
						{dashboardCopy.windows[key]}
					</button>
				{/each}
			</div>
		</div>

		{#if selectedWindow}
			<div class="row g-3 admin-fade-up">
				<div class="col-6 col-xl-3">
					<div class="border rounded-3 p-3 bg-white h-100">
						<div class="small text-uppercase text-black-50">{dashboardCopy.kpis.sessions}</div>
						<div class="h4 mb-1">{formatNumber(selectedWindow.sessions)}</div>
						<div class="small text-black-50">
							{$locale === 'en' ? 'Identified' : '\u0110\u1ECBnh danh'}: {formatNumber(selectedWindow.identifiedSessions)}
						</div>
					</div>
				</div>
				<div class="col-6 col-xl-3">
					<div class="border rounded-3 p-3 bg-white h-100">
						<div class="small text-uppercase text-black-50">{dashboardCopy.kpis.pageViews}</div>
						<div class="h4 mb-1">{formatNumber(selectedWindow.pageViewCount)}</div>
						<div class="small text-black-50">
							{dashboardCopy.quality.avgPagesPerSession}: {selectedWindow.avgPageViewsPerSession}
						</div>
					</div>
				</div>
				<div class="col-6 col-xl-3">
					<div class="border rounded-3 p-3 bg-white h-100">
						<div class="small text-uppercase text-black-50">{dashboardCopy.kpis.orders}</div>
						<div class="h4 mb-1">{formatNumber(selectedWindow.orderCount)}</div>
						<div class="small text-black-50">
							{dashboardCopy.quality.deliveredOrders}: {formatNumber(selectedWindow.deliveredOrderCount)}
						</div>
					</div>
				</div>
				<div class="col-6 col-xl-3">
					<div class="border rounded-3 p-3 bg-white h-100">
						<div class="small text-uppercase text-black-50">
							{$locale === 'en' ? 'Delivered revenue' : 'Doanh thu giao th\u00E0nh c\u00F4ng'}
						</div>
						<div class="h4 mb-1 text-break">{formatCurrency(selectedWindow.revenue)}</div>
						<div class="small text-black-50">
							{$locale === 'en' ? 'Delivered AOV' : 'Gi\u00E1 tr\u1ECB TB/\u0111\u01A1n giao th\u00E0nh c\u00F4ng'}: {formatCurrency(
								selectedWindow.avgOrderValue
							)}
						</div>
					</div>
				</div>
				<div class="col-6 col-xl-3">
					<div class="border rounded-3 p-3 bg-white h-100">
						<div class="small text-uppercase text-black-50">{dashboardCopy.kpis.avgActive}</div>
						<div class="h4 mb-1">{formatDuration(selectedWindow.avgActiveSecondsPerSession)}</div>
						<div class="small text-black-50">
							{$locale === 'en' ? 'Total active' : 'T\u1ED5ng TG ho\u1EA1t \u0111\u1ED9ng'}: {formatDuration(
								selectedWindow.totalActiveSeconds
							)}
						</div>
					</div>
				</div>
				<div class="col-6 col-xl-3">
					<div class="border rounded-3 p-3 bg-white h-100">
						<div class="small text-uppercase text-black-50">{dashboardCopy.kpis.bounceRate}</div>
						<div class="h4 mb-1">{formatPercent(selectedWindow.bounceRate)}</div>
						<div class="small text-black-50">
							{$locale === 'en' ? 'Bounce sessions' : 'Phi\u00EAn tho\u00E1t'}: {formatNumber(
								selectedWindow.bounceSessions
							)}
						</div>
					</div>
				</div>
				<div class="col-6 col-xl-3">
					<div class="border rounded-3 p-3 bg-white h-100">
						<div class="small text-uppercase text-black-50">{dashboardCopy.kpis.checkoutSessions}</div>
						<div class="h4 mb-1">{formatNumber(selectedWindow.checkoutSessions)}</div>
						<div class="small text-black-50">
							{dashboardCopy.quality.addToCartSessions}: {formatNumber(selectedWindow.addToCartSessions)}
						</div>
					</div>
				</div>
				<div class="col-6 col-xl-3">
					<div class="border rounded-3 p-3 bg-white h-100">
						<div class="small text-uppercase text-black-50">
							{dashboardCopy.kpis.productViewSessions}
						</div>
						<div class="h4 mb-1">{formatNumber(selectedWindow.sessionsWithProductViews)}</div>
						<div class="small text-black-50">
							{$locale === 'en' ? 'Blog view sessions' : 'Phi\u00EAn xem blog'}: {formatNumber(
								selectedWindow.sessionsWithBlogViews
							)}
						</div>
					</div>
				</div>
			</div>

			<div class="row g-3 mt-1 admin-fade-up">
				<div class="col-xl-7">
					<div class="border rounded-3 p-3 bg-white h-100">
						<div class="d-flex justify-content-between align-items-center gap-2 mb-3 flex-wrap">
							<h5 class="mb-0">{dashboardCopy.quality.title}</h5>
							<span class="small text-black-50">{dashboardCopy.windows[selectedWindowKey]}</span>
						</div>
						<div class="row g-3">
							<div class="col-6">
								<div class="small text-black-50">{dashboardCopy.quality.uniqueUsers}</div>
								<div class="fw-semibold">{formatNumber(selectedWindow.uniqueTrackedUsers)}</div>
							</div>
							<div class="col-6">
								<div class="small text-black-50">{dashboardCopy.quality.uniqueIps}</div>
								<div class="fw-semibold">{formatNumber(selectedWindow.uniqueIps)}</div>
							</div>
							<div class="col-6">
								<div class="small text-black-50">{dashboardCopy.quality.sessionToOrderRate}</div>
								<div class="fw-semibold">{formatPercent(selectedWindow.sessionToOrderRate)}</div>
							</div>
							<div class="col-6">
								<div class="small text-black-50">{dashboardCopy.quality.sessionToDeliveredRate}</div>
								<div class="fw-semibold">
									{formatPercent(selectedWindow.sessionToDeliveredOrderRate)}
								</div>
							</div>
							<div class="col-6">
								<div class="small text-black-50">{dashboardCopy.quality.avgPagesPerSession}</div>
								<div class="fw-semibold">{selectedWindow.avgPageViewsPerSession}</div>
							</div>
							<div class="col-6">
								<div class="small text-black-50">{dashboardCopy.quality.avgScrollDepth}</div>
								<div class="fw-semibold">
									{formatNumber(selectedWindow.avgScrollDepthPercent)}%
								</div>
							</div>
						</div>
						<div class="mt-3">
							<div class="small text-black-50 mb-1">
								{dashboardCopy.quality.deepScrollSessions}
							</div>
							<div
								class="progress"
								role="progressbar"
								aria-valuenow={Math.round((selectedWindow.deepScrollRate || 0) * 100)}
								aria-valuemin="0"
								aria-valuemax="100"
							>
								<div
									class="progress-bar bg-dark"
									style={`width:${Math.min(100, Math.max(0, (selectedWindow.deepScrollRate || 0) * 100))}%`}
								>
									{formatPercent(selectedWindow.deepScrollRate)}
								</div>
							</div>
						</div>
					</div>
				</div>

				<div class="col-xl-5">
					<div class="border rounded-3 p-3 bg-white h-100">
						<h5 class="mb-3">{dashboardCopy.ops.title}</h5>
						<div class="row g-3">
							<div class="col-6">
								<div class="small text-black-50">{dashboardCopy.ops.users}</div>
								<div class="fw-semibold">{formatNumber(dashboardOps?.users?.total)}</div>
								<div class="small text-black-50">
									{$locale === 'en' ? 'Active' : '\u0110ang ho\u1EA1t \u0111\u1ED9ng'}: {formatNumber(
										dashboardOps?.users?.byStatus?.active
									)}
								</div>
							</div>
							<div class="col-6">
								<div class="small text-black-50">{dashboardCopy.ops.products}</div>
								<div class="fw-semibold">{formatNumber(dashboardOps?.products?.total)}</div>
								<div class="small text-black-50">
									{dashboardCopy.ops.published}: {formatNumber(dashboardOps?.products?.published)}
								</div>
							</div>
							<div class="col-6">
								<div class="small text-black-50">{dashboardCopy.ops.blogs}</div>
								<div class="fw-semibold">{formatNumber(dashboardOps?.blogs?.total)}</div>
								<div class="small text-black-50">
									{dashboardCopy.ops.totalViews}: {formatNumber(dashboardOps?.blogs?.totalViews)}
								</div>
							</div>
							<div class="col-6">
								<div class="small text-black-50">{dashboardCopy.ops.orders}</div>
								<div class="fw-semibold">{formatNumber(dashboardOps?.orders?.total)}</div>
								<div class="small text-black-50">
									{dashboardCopy.ops.pending}: {formatNumber(dashboardOps?.orders?.byStatus?.pending)}
								</div>
							</div>
						</div>
						<hr />
						<div class="small text-black-50 mb-1">{$locale === 'en' ? 'New users (30d)' : 'Ng\u01B0\u1EDDi d\u00F9ng m\u1EDBi (30 ng\u00E0y)'}</div>
						<div class="fw-semibold">{formatNumber(dashboardOps?.users?.newUsers?.last30d)}</div>
						<div class="small text-black-50 mt-2 mb-1">{$locale === 'en' ? 'Delivered orders (30d)' : '\u0110\u01A1n giao th\u00E0nh c\u00F4ng (30 ng\u00E0y)'}</div>
						<div class="fw-semibold">{formatNumber(dashboardOps?.orders?.windows?.last30d?.deliveredOrders)}</div>
					</div>
				</div>
			</div>

			<div class="border rounded-3 p-3 bg-white mt-3 admin-fade-up">
				<div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
					<div>
						<h5 class="mb-1">{dashboardCopy.daily}</h5>
						<p class="small text-black-50 mb-0">{dashboardCopy.dailyHint}</p>
					</div>
				</div>
				{#if recentDailyRows.length}
					<div class="d-grid gap-2">
						{#each recentDailyRows as row (row.date)}
							<div class="border rounded-3 p-2">
								<div class="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-2">
									<div class="fw-semibold">{row.date}</div>
									<div class="small text-black-50 d-flex flex-wrap gap-2">
										<span>{$locale === 'en' ? 'Sessions' : 'Phi\u00EAn'}: {formatNumber(row.sessions)}</span>
										<span>{$locale === 'en' ? 'Pages' : 'Trang'}: {formatNumber(row.pageViewCount)}</span>
										<span>{$locale === 'en' ? 'Orders' : '\u0110\u01A1n'}: {formatNumber(row.orders)}</span>
									</div>
								</div>
								<div class="d-grid gap-2">
									<div>
										<div class="small text-black-50 mb-1">{$locale === 'en' ? 'Sessions' : 'Phi\u00EAn'}</div>
										<div class="progress">
											<div class="progress-bar bg-dark" style={`width:${((row.sessions || 0) / maxDailySessions) * 100}%`}></div>
										</div>
									</div>
									<div>
										<div class="small text-black-50 mb-1">{$locale === 'en' ? 'Page views' : 'L\u01B0\u1EE3t xem trang'}</div>
										<div class="progress">
											<div class="progress-bar bg-secondary" style={`width:${((row.pageViewCount || 0) / maxDailyPageViews) * 100}%`}></div>
										</div>
									</div>
									<div>
										<div class="small text-black-50 mb-1">{$locale === 'en' ? 'Orders' : '\u0110\u01A1n h\u00E0ng'}</div>
										<div class="progress">
											<div class="progress-bar bg-success" style={`width:${((row.orders || 0) / maxDailyOrders) * 100}%`}></div>
										</div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="text-black-50">{dashboardCopy.noData}</div>
				{/if}
			</div>

			<div class="row g-3 mt-1 admin-fade-up">
				<div class="col-xl-4">
					<div class="border rounded-3 p-3 bg-white h-100">
						<h5 class="mb-3">{dashboardCopy.topPages}</h5>
						<ul class="list-group list-group-flush">
							{#if topPages30d.length}
								{#each topPages30d.slice(0, 10) as row}
									<li class="list-group-item px-0">
										<div class="fw-semibold text-break">{row.path}</div>
										<div class="small text-black-50 d-flex flex-wrap gap-2">
											<span>{$locale === 'en' ? 'PV' : 'PV'}: {formatNumber(row.pageViews)}</span>
											<span>{$locale === 'en' ? 'Sessions' : 'Phi\u00EAn'}: {formatNumber(row.uniqueSessions)}</span>
										</div>
									</li>
								{/each}
							{:else}
								<li class="list-group-item px-0 text-black-50">{dashboardCopy.noData}</li>
							{/if}
						</ul>
					</div>
				</div>
				<div class="col-xl-4">
					<div class="border rounded-3 p-3 bg-white h-100">
						<h5 class="mb-3">{dashboardCopy.topProducts}</h5>
						<ul class="list-group list-group-flush">
							{#if topProducts30d.length}
								{#each topProducts30d.slice(0, 10) as row}
									<li class="list-group-item px-0">
										<div class="fw-semibold text-break">{row.name || row.slug || row.productId}</div>
										<div class="small text-black-50 d-flex flex-wrap gap-2">
											<span>{$locale === 'en' ? 'Views' : 'L\u01B0\u1EE3t xem'}: {formatNumber(row.views)}</span>
											<span>{$locale === 'en' ? 'Sessions' : 'Phi\u00EAn'}: {formatNumber(row.uniqueSessions)}</span>
										</div>
									</li>
								{/each}
							{:else}
								<li class="list-group-item px-0 text-black-50">{dashboardCopy.noData}</li>
							{/if}
						</ul>
					</div>
				</div>
				<div class="col-xl-4">
					<div class="border rounded-3 p-3 bg-white h-100">
						<h5 class="mb-3">{dashboardCopy.topBlogs}</h5>
						<ul class="list-group list-group-flush">
							{#if topBlogs30d.length}
								{#each topBlogs30d.slice(0, 10) as row}
									<li class="list-group-item px-0">
										<div class="fw-semibold text-break">{row.title || row.slug || row.path}</div>
										<div class="small text-black-50 d-flex flex-wrap gap-2">
											<span>{$locale === 'en' ? 'Views' : 'L\u01B0\u1EE3t xem'}: {formatNumber(row.views)}</span>
											<span>{$locale === 'en' ? 'Sessions' : 'Phi\u00EAn'}: {formatNumber(row.uniqueSessions)}</span>
										</div>
									</li>
								{/each}
							{:else}
								<li class="list-group-item px-0 text-black-50">{dashboardCopy.noData}</li>
							{/if}
						</ul>
					</div>
				</div>
			</div>
		{:else}
			<div class="alert alert-secondary mb-0 admin-fade-up">{dashboardCopy.noData}</div>
		{/if}
	{/if}

	<div class="row g-4 mt-1">
		<div class="col-12">
			<div class="border rounded-3 p-3 bg-white h-100 admin-fade-up">
				<h5 class="mb-3">{$t('admin.dashboard.siteSettings.title')}</h5>
				<p class="text-black-50 mb-3">{$t('admin.dashboard.siteSettings.description')}</p>
				<div class="row g-3">
					<div class="col-12">
						<form method="POST" action="?/updateFeatureFlags" class="d-flex flex-column gap-3">
							{#if data?.siteFeatureDefinitions?.length}
								{#each data.siteFeatureDefinitions as feature (feature.key)}
									{@const featureDescription = getFeatureDescription(feature.key)}
									<div class="border rounded-3 p-3">
										<input type="hidden" name="featureKeys" value={feature.key} />
										<label class="form-check form-switch m-0 d-flex align-items-center gap-2">
											<input
												class="form-check-input"
												type="checkbox"
												name={`feature__${feature.key}`}
												value="on"
												checked={Boolean(data?.siteFeatures?.[feature.key])}
											/>
											<span class="form-check-label">{getFeatureLabel(feature.key)}</span>
										</label>
										{#if featureDescription}
											<div class="small text-black-50 mt-2">{featureDescription}</div>
										{/if}
										<div class="small text-black-50 mt-2">
											{#if data?.siteFeatures?.[feature.key]}
												{$t('admin.dashboard.siteSettings.flagStatusEnabled')}
											{:else}
												{$t('admin.dashboard.siteSettings.flagStatusDisabled')}
											{/if}
										</div>
									</div>
								{/each}
							{:else}
								<div class="text-black-50">{$t('admin.dashboard.siteSettings.noFlags')}</div>
							{/if}
							<div>
								<button class="btn btn-dark" type="submit">{$t('admin.dashboard.siteSettings.saveButton')}</button>
							</div>
						</form>
					</div>
				</div>
				<div class="row g-3 mt-1">
					<div class="col-12">
						<form method="POST" action="?/updateMarketingSettings" class="border rounded-3 p-3">
							<div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
								<div>
									<h6 class="mb-1">Marketing campaign & marketplace</h6>
									<p class="small text-black-50 mb-0">
										Header offer, lead popup copy, and official marketplace links used on the storefront.
									</p>
								</div>
								<button class="btn btn-dark" type="submit">Save marketing</button>
							</div>
							<div class="row g-3">
								<div class="col-12 d-flex flex-wrap gap-3">
									<label class="form-check form-switch m-0">
										<input
											class="form-check-input"
											type="checkbox"
											name="campaign_enabled"
											checked={Boolean(siteMarketingCampaign.enabled)}
										/>
										<span class="form-check-label">Campaign enabled</span>
									</label>
									<label class="form-check form-switch m-0">
										<input
											class="form-check-input"
											type="checkbox"
											name="campaign_header_enabled"
											checked={Boolean(siteMarketingCampaign.headerEnabled)}
										/>
										<span class="form-check-label">Header promo</span>
									</label>
									<label class="form-check form-switch m-0">
										<input
											class="form-check-input"
											type="checkbox"
											name="campaign_popup_enabled"
											checked={Boolean(siteMarketingCampaign.popupEnabled)}
										/>
										<span class="form-check-label">Lead popup copy</span>
									</label>
								</div>
								<div class="col-md-3">
									<label class="form-label" for="campaign-offer-code">Offer code</label>
									<input
										class="form-control"
										id="campaign-offer-code"
										name="campaign_offer_code"
										value={siteMarketingCampaign.offerCode || ''}
									/>
								</div>
								<div class="col-md-3">
									<label class="form-label" for="campaign-min-order">Minimum order</label>
									<input
										class="form-control"
										id="campaign-min-order"
										name="campaign_min_order_value"
										type="number"
										min="0"
										step="1000"
										value={siteMarketingCampaign.minOrderValue || 0}
									/>
								</div>
								<div class="col-md-6">
									<label class="form-label" for="campaign-ends-at">Ends at</label>
									<input
										class="form-control"
										id="campaign-ends-at"
										name="campaign_ends_at"
										placeholder="YYYY-MM-DD"
										value={siteMarketingCampaign.endsAt || ''}
									/>
								</div>
								<div class="col-md-6">
									<label class="form-label" for="campaign-kicker-vi">Kicker VI</label>
									<input
										class="form-control"
										id="campaign-kicker-vi"
										name="campaign_kicker_vi"
										value={siteMarketingCampaign.kickerVi || ''}
									/>
								</div>
								<div class="col-md-6">
									<label class="form-label" for="campaign-kicker-en">Kicker EN</label>
									<input
										class="form-control"
										id="campaign-kicker-en"
										name="campaign_kicker_en"
										value={siteMarketingCampaign.kickerEn || ''}
									/>
								</div>
								<div class="col-md-6">
									<label class="form-label" for="campaign-title-vi">Title VI</label>
									<input
										class="form-control"
										id="campaign-title-vi"
										name="campaign_title_vi"
										value={siteMarketingCampaign.titleVi || ''}
									/>
								</div>
								<div class="col-md-6">
									<label class="form-label" for="campaign-title-en">Title EN</label>
									<input
										class="form-control"
										id="campaign-title-en"
										name="campaign_title_en"
										value={siteMarketingCampaign.titleEn || ''}
									/>
								</div>
								<div class="col-md-6">
									<label class="form-label" for="campaign-description-vi">Description VI</label>
									<textarea
										class="form-control"
										id="campaign-description-vi"
										name="campaign_description_vi"
										rows="2"
										value={siteMarketingCampaign.descriptionVi || ''}
									></textarea>
								</div>
								<div class="col-md-6">
									<label class="form-label" for="campaign-description-en">Description EN</label>
									<textarea
										class="form-control"
										id="campaign-description-en"
										name="campaign_description_en"
										rows="2"
										value={siteMarketingCampaign.descriptionEn || ''}
									></textarea>
								</div>
								<div class="col-md-6">
									<label class="form-label" for="campaign-cta-vi">CTA VI</label>
									<input
										class="form-control"
										id="campaign-cta-vi"
										name="campaign_cta_vi"
										value={siteMarketingCampaign.ctaVi || ''}
									/>
								</div>
								<div class="col-md-6">
									<label class="form-label" for="campaign-cta-en">CTA EN</label>
									<input
										class="form-control"
										id="campaign-cta-en"
										name="campaign_cta_en"
										value={siteMarketingCampaign.ctaEn || ''}
									/>
								</div>
								<div class="col-md-6">
									<label class="form-label" for="campaign-success-vi">Success VI</label>
									<input
										class="form-control"
										id="campaign-success-vi"
										name="campaign_success_vi"
										value={siteMarketingCampaign.successVi || ''}
									/>
								</div>
								<div class="col-md-6">
									<label class="form-label" for="campaign-success-en">Success EN</label>
									<input
										class="form-control"
										id="campaign-success-en"
										name="campaign_success_en"
										value={siteMarketingCampaign.successEn || ''}
									/>
								</div>
							</div>
							<hr />
							<div class="row g-3">
								{#each siteMarketplaceLinks as link (link.id)}
									<div class="col-md-6">
										<div class="border rounded-3 p-3 h-100">
											<input type="hidden" name="marketplaceIds" value={link.id} />
											<label class="form-check form-switch mb-2">
												<input
													class="form-check-input"
													type="checkbox"
													name={`marketplace_enabled__${link.id}`}
													checked={Boolean(link.enabled)}
												/>
												<span class="form-check-label">{link.label}</span>
											</label>
											<label class="form-label" for={`marketplace-label-${link.id}`}>Label</label>
											<input
												class="form-control mb-2"
												id={`marketplace-label-${link.id}`}
												name={`marketplace_label__${link.id}`}
												value={link.label}
											/>
											<label class="form-label" for={`marketplace-url-${link.id}`}>URL</label>
											<input
												class="form-control"
												id={`marketplace-url-${link.id}`}
												name={`marketplace_url__${link.id}`}
												type="url"
												value={link.url}
											/>
										</div>
									</div>
								{/each}
							</div>
						</form>
					</div>
				</div>
				<!-- Hidden by request: admin AI knowledge shortcut. -->
				{#if form?.error}
					<div class="alert alert-danger py-2 px-3 mb-0 mt-3">{form.error}</div>
				{/if}
			</div>
		</div>

		<div class="col-lg-6">
			<div class="border rounded-3 p-3 bg-white h-100 admin-fade-up">
				<h5 class="mb-3">{$t('admin.dashboard.latestUsers')}</h5>
				<div class="small text-black-50 mb-3">
					{$locale === 'en' ? 'New users (last 24h)' : 'Ng\u01B0\u1EDDi d\u00F9ng m\u1EDBi (24 gi\u1EDD g\u1EA7n nh\u1EA5t)'}:
					{formatNumber(dashboardOps?.users?.newUsers?.last24h)}
				</div>
				<ul class="list-group list-group-flush">
					{#if data?.recentUsers?.length}
						{#each data.recentUsers as user}
							<li class="list-group-item px-0 d-flex flex-column flex-sm-row justify-content-between align-items-start gap-2">
								<div class="min-w-0">
									<div class="fw-semibold text-break">{user.name || user.email}</div>
									<div class="text-black-50 small text-break">{user.email}</div>
								</div>
								<a class="btn btn-sm btn-outline-dark" href={`/admin/users/${user._id}`}>{$t('admin.dashboard.view')}</a>
							</li>
						{/each}
					{:else}
						<li class="list-group-item px-0 text-black-50">{$t('admin.dashboard.noUsers')}</li>
					{/if}
				</ul>
			</div>
		</div>

		<div class="col-lg-6">
			<div class="border rounded-3 p-3 bg-white h-100 admin-fade-up">
				<h5 class="mb-3">{$t('admin.dashboard.latestProducts')}</h5>
				<ul class="list-group list-group-flush">
					{#if data?.recentProducts?.length}
						{#each data.recentProducts as product}
							<li class="list-group-item px-0 d-flex flex-column flex-sm-row justify-content-between align-items-start gap-2">
								<div class="min-w-0">
									<div class="fw-semibold text-break">{product.product_name}</div>
									<div class="text-black-50 small text-break">{product.product_type}</div>
								</div>
								<a class="btn btn-sm btn-outline-dark" href={`/admin/products/${product._id}`}>{$t('admin.dashboard.edit')}</a>
							</li>
						{/each}
					{:else}
						<li class="list-group-item px-0 text-black-50">{$t('admin.dashboard.noProducts')}</li>
					{/if}
				</ul>
			</div>
		</div>
	</div>
</section>
