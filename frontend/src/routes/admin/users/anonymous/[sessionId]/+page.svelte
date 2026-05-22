<script>
	import { locale } from '$lib/i18n/admin/index.js';

	let { data } = $props();
	const visitor = $derived(data?.visitor || null);
	const loadError = $derived(String(data?.apiError || ''));

	const recentClicks = $derived(Array.isArray(visitor?.recentClicks) ? visitor.recentClicks : []);
	const viewedProducts = $derived(Array.isArray(visitor?.viewedProducts) ? visitor.viewedProducts : []);
	const visitedPaths = $derived(Array.isArray(visitor?.visitedPaths) ? visitor.visitedPaths : []);
	const dailyActiveTime = $derived(Array.isArray(visitor?.dailyActiveTime) ? visitor.dailyActiveTime : []);
	const recentEvents = $derived(Array.isArray(visitor?.recentEvents) ? visitor.recentEvents : []);

	const formatDate = (value) => {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleString($locale === 'en' ? 'en-US' : 'vi-VN');
	};

	const formatDuration = (seconds) => {
		const total = Math.max(Number(seconds) || 0, 0);
		if (total <= 0) return '0m';
		const hours = Math.floor(total / 3600);
		const minutes = Math.round((total % 3600) / 60);
		if (hours <= 0) return `${minutes}m`;
		return `${hours}h ${minutes}m`;
	};

	const eventTitle = (event) => {
		if (!event) return '—';
		if (event.type === 'click') return event.click?.label || event.click?.trackName || event.click?.href || 'click';
		if (event.type === 'product_view') return event.product?.name || event.product?.slug || 'product_view';
		return event.type || 'event';
	};
</script>

<svelte:head>
	<title>{($locale === 'en' ? 'Anonymous visitor' : 'Khách lạ')} | Admin</title>
</svelte:head>

<section class="anonymous-visitor-page">
	<a class="btn btn-link mb-3 px-0" href="/admin/users">
		{$locale === 'en' ? 'Back to users' : 'Quay lại danh sách users'}
	</a>
	<h2 class="mb-4">{$locale === 'en' ? 'Anonymous visitor detail' : 'Chi tiết khách lạ'}</h2>

	{#if loadError}
		<div class="alert alert-danger">{loadError}</div>
	{/if}

	{#if visitor}
		<div class="panel-card mb-3">
			<div class="panel-card__header">
				<div>
					<div class="meta-label">Session ID</div>
					<div class="session-id break-anywhere">{visitor.sessionId}</div>
				</div>
				{#if visitor.user?._id}
					<div class="mapped-user-box">
						<div class="meta-label">{$locale === 'en' ? 'Mapped account' : 'Tài khoản đã map'}</div>
						<a class="mapped-user-box__link break-anywhere" href={`/admin/users/${visitor.user._id}`}>
							{visitor.user.name || visitor.user.email || visitor.user._id}
						</a>
						<div class="small text-black-50 break-anywhere">{visitor.user.email || visitor.user._id}</div>
					</div>
				{/if}
			</div>

			<div class="metric-grid">
				<div class="metric-box"><div class="meta-label">IP</div><div class="metric-box__value break-anywhere">{visitor.lastIp || visitor.firstIp || '—'}</div></div>
				<div class="metric-box"><div class="meta-label">{$locale === 'en' ? 'First seen / last seen' : 'Lần đầu / lần cuối truy cập'}</div><div class="metric-box__value">{formatDate(visitor.firstSeenAt)} → {formatDate(visitor.lastSeenAt)}</div></div>
				<div class="metric-box"><div class="meta-label">{$locale === 'en' ? 'Clicks' : 'Click'}</div><div class="metric-box__value">{visitor.clickCount ?? 0}</div></div>
				<div class="metric-box"><div class="meta-label">{$locale === 'en' ? 'Products viewed' : 'Sản phẩm đã xem'}</div><div class="metric-box__value">{visitor.productViewCount ?? 0}</div></div>
				<div class="metric-box"><div class="meta-label">{$locale === 'en' ? 'Time on site' : 'Thời gian trên web'}</div><div class="metric-box__value">{formatDuration(visitor.totalTimeSeconds)}</div></div>
				<div class="metric-box"><div class="meta-label">{$locale === 'en' ? 'Max scroll' : 'Độ sâu cuộn tối đa'}</div><div class="metric-box__value">{visitor.maxScrollDepthPercent ?? 0}%</div></div>
				<div class="metric-box"><div class="meta-label">{$locale === 'en' ? 'Language' : 'Ngôn ngữ'}</div><div class="metric-box__value">{visitor.locale || '—'}</div></div>
				<div class="metric-box"><div class="meta-label">{$locale === 'en' ? 'Status' : 'Trạng thái'}</div><div class="metric-box__value">{visitor.status || '—'}</div></div>
			</div>

			{#if visitor.mappedUserAt}
				<div class="alert alert-info mt-3 mb-0">
					<div class="fw-semibold mb-1">
						{$locale === 'en' ? 'Mapped from anonymous to user' : 'Đã map từ khách lạ sang tài khoản'}
					</div>
					<div class="small break-anywhere">
						{$locale === 'en' ? 'Mapped at' : 'Thời điểm map'}: {formatDate(visitor.mappedUserAt)} ·
						{$locale === 'en' ? 'Strategy' : 'Chiến lược'}: {visitor.mappedUserStrategy || '—'} ·
						{$locale === 'en' ? 'Auth event' : 'Sự kiện auth'}: {visitor.mappedByAuthEvent || '—'}
					</div>
				</div>
			{/if}
		</div>

		<div class="telemetry-grid">
			<div class="panel-card">
				<h3 class="h6 mb-3">{$locale === 'en' ? 'Viewed products' : 'Sản phẩm đã xem'}</h3>
				{#if viewedProducts.length}
					<div class="stack-list">
						{#each viewedProducts as item}
							<div class="stack-item">
								<div>
									<div class="fw-semibold break-anywhere">{item.name || item.slug || item.productId || '—'}</div>
									<div class="small text-black-50 break-anywhere">{item.slug || item.productId || '—'}</div>
								</div>
								<div class="small text-black-50 text-end">
									<div>x{item.count ?? 0}</div>
									<div>{formatDate(item.lastViewedAt)}</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-black-50 mb-0">{$locale === 'en' ? 'No product views yet.' : 'Chưa có lượt xem sản phẩm.'}</p>
				{/if}
			</div>

			<div class="panel-card">
				<h3 class="h6 mb-3">{$locale === 'en' ? 'Recent clicks' : 'Click gần đây'}</h3>
				{#if recentClicks.length}
					<div class="stack-list">
						{#each recentClicks as item}
							<div class="stack-item stack-item--single">
								<div class="fw-semibold break-anywhere">{item.label || item.trackName || item.href || '—'}</div>
								<div class="small text-black-50 break-anywhere">{item.path || '—'}{#if item.href}<span> · {item.href}</span>{/if}</div>
								<div class="small text-black-50">{formatDate(item.at)}</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-black-50 mb-0">{$locale === 'en' ? 'No click events yet.' : 'Chưa có dữ liệu click.'}</p>
				{/if}
			</div>

			<div class="panel-card">
				<h3 class="h6 mb-3">{$locale === 'en' ? 'Visited paths' : 'Trang đã truy cập'}</h3>
				{#if visitedPaths.length}
					<div class="stack-list">
						{#each visitedPaths as item}
							<div class="stack-item">
								<div class="fw-semibold break-anywhere">{item.path || '—'}</div>
								<div class="small text-black-50 text-end">
									<div>x{item.count ?? 0}</div>
									<div>{formatDate(item.lastSeenAt)}</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-black-50 mb-0">{$locale === 'en' ? 'No page history yet.' : 'Chưa có lịch sử trang.'}</p>
				{/if}
			</div>

			<div class="panel-card">
				<h3 class="h6 mb-3">{$locale === 'en' ? 'Daily active time (30 days)' : 'Thời gian truy cập theo ngày (30 ngày)'}</h3>
				{#if dailyActiveTime.length}
					<div class="stack-list">
						{#each dailyActiveTime as item}
							<div class="stack-item">
								<div class="fw-semibold">{item.date || '—'}</div>
								<div class="small text-black-50 text-end">
									<div>{formatDuration(item.totalDurationSeconds)}</div>
									<div>{$locale === 'en' ? 'Events' : 'Sự kiện'}: {item.eventCount ?? 0}</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-black-50 mb-0">{$locale === 'en' ? 'No daily time data yet.' : 'Chưa có dữ liệu theo ngày.'}</p>
				{/if}
			</div>
		</div>

		<div class="panel-card mt-3">
			<h3 class="h6 mb-3">{$locale === 'en' ? 'Recent events timeline' : 'Timeline sự kiện gần đây'}</h3>
			{#if recentEvents.length}
				<div class="stack-list">
					{#each recentEvents as item}
						<div class="stack-item stack-item--single">
							<div class="d-flex justify-content-between gap-3 flex-wrap">
								<div>
									<div class="fw-semibold break-anywhere">{eventTitle(item)}</div>
									<div class="small text-black-50 break-anywhere">
										{item.type || '—'}{#if item.path}<span> · {item.path}</span>{/if}
									</div>
								</div>
								<div class="small text-black-50 text-end">{formatDate(item.occurredAt)}</div>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-black-50 mb-0">{$locale === 'en' ? 'No recent events.' : 'Chưa có sự kiện gần đây.'}</p>
			{/if}
		</div>
	{:else}
		<p class="text-black-50">{$locale === 'en' ? 'Anonymous visitor not found.' : 'Không tìm thấy phiên khách lạ.'}</p>
	{/if}
</section>

<style>
	.anonymous-visitor-page {
		display: grid;
		gap: 1rem;
	}

	.panel-card {
		background: #fff;
		border: 1px solid #e7ebf0;
		border-radius: 16px;
		padding: 1rem;
	}

	.panel-card__header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.meta-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 700;
		color: #64748b;
	}

	.session-id {
		margin-top: 0.2rem;
		font-weight: 700;
		color: #0f172a;
	}

	.mapped-user-box {
		max-width: 100%;
	}

	.mapped-user-box__link {
		display: inline-block;
		font-weight: 700;
		text-decoration: none;
		margin-top: 0.2rem;
	}

	.mapped-user-box__link:hover {
		text-decoration: underline;
	}

	.metric-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.75rem;
		margin-top: 0.9rem;
	}

	.metric-box {
		padding: 0.75rem;
		border-radius: 12px;
		background: #f8fafc;
		border: 1px solid #edf2f7;
		min-width: 0;
	}

	.metric-box__value {
		margin-top: 0.25rem;
		font-weight: 600;
		line-height: 1.35;
		color: #0f172a;
	}

	.telemetry-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 1rem;
	}

	.stack-list {
		display: grid;
		gap: 0.6rem;
	}

	.stack-item {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.75rem;
		border-radius: 12px;
		border: 1px solid #edf2f7;
		background: #fbfdff;
		min-width: 0;
	}

	.stack-item--single {
		display: block;
	}

	.break-anywhere {
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	@media (max-width: 576px) {
		.stack-item {
			flex-direction: column;
		}

		.telemetry-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
