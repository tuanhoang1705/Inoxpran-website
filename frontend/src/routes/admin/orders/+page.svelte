<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { locale, t } from '$lib/i18n/admin/index.js';
	import { pushToast } from '$lib/stores/adminToast.js';

	let { data, form } = $props();
	let lastToastKey = '';
	let selectedOrderIds = $state(new Set());

	const ORDER_STATUS_FLOW = {
		pending: ['confirmed', 'cancelled'],
		confirmed: ['shipped', 'cancel_requested'],
		cancel_requested: ['confirmed', 'cancelled'],
		shipped: ['delivered', 'returned'],
		delivered: ['returned'],
		cancelled: [],
		returned: []
	};

	const orders = $derived(data?.orders ?? []);
	const pagination = $derived(
		data?.pagination ?? {
			total: 0,
			page: 1,
			limit: 20,
			totalPages: 1,
			hasNext: false,
			hasPrev: false
		}
	);
	const summary = $derived(
		data?.summary ?? {
			total: 0,
			byStatus: {
				pending: 0,
				confirmed: 0,
				shipped: 0,
				cancel_requested: 0,
				cancelled: 0,
				delivered: 0,
				returned: 0
			},
			byTab: {
				waiting: 0,
				shipping: 0,
				completed: 0,
				cancel_requested: 0,
				cancelled: 0,
				returned: 0
			}
		}
	);
	const activeTab = $derived(data?.activeTab ?? 'all');
	const filters = $derived(
		data?.filters ?? { q: '', page: 1, limit: 20, from: '', to: '', sort: 'ctime' }
	);
	const returnTo = $derived(data?.returnTo || '/admin/orders');
	const apiError = $derived(form?.error || data?.apiError || '');
	const visibleOrderIds = $derived(
		orders.map((order) => String(order?._id || '').trim()).filter(Boolean)
	);
	const selectedOrderCount = $derived(selectedOrderIds.size);
	const selectedVisibleOrderCount = $derived(
		visibleOrderIds.reduce((count, id) => count + (selectedOrderIds.has(id) ? 1 : 0), 0)
	);
	const allVisibleOrdersSelected = $derived(
		visibleOrderIds.length > 0 && selectedVisibleOrderCount === visibleOrderIds.length
	);
	const selectedOrderIdsPayload = $derived(JSON.stringify(Array.from(selectedOrderIds)));

	const statusLabels = $derived.by(() => ({
		pending: $t('admin.orders.status.pending'),
		confirmed: $t('admin.orders.status.confirmed'),
		shipped: $t('admin.orders.status.shipped'),
		cancel_requested: $t('admin.orders.status.cancelRequested'),
		cancelled: $t('admin.orders.status.cancelled'),
		delivered: $t('admin.orders.status.delivered'),
		returned: $t('admin.orders.status.returned')
	}));

	const tabs = $derived.by(() => [
		{ key: 'all', label: $t('admin.orders.tabs.all'), count: summary.total },
		{ key: 'waiting', label: $t('admin.orders.tabs.waiting'), count: summary.byTab?.waiting ?? 0 },
		{ key: 'shipping', label: $t('admin.orders.tabs.shipping'), count: summary.byTab?.shipping ?? 0 },
		{ key: 'completed', label: $t('admin.orders.tabs.completed'), count: summary.byTab?.completed ?? 0 },
		{
			key: 'cancelRequested',
			label: $t('admin.orders.tabs.cancelRequested'),
			count: summary.byTab?.cancel_requested ?? 0
		},
		{ key: 'cancelled', label: $t('admin.orders.tabs.cancelled'), count: summary.byTab?.cancelled ?? 0 },
		{ key: 'returned', label: $t('admin.orders.tabs.returned'), count: summary.byTab?.returned ?? 0 }
	]);

	const metricCards = $derived.by(() => [
		{ label: $t('admin.orders.metrics.total'), value: summary.total ?? 0, tone: 'metric-total' },
		{ label: $t('admin.orders.metrics.waiting'), value: summary.byTab?.waiting ?? 0, tone: 'metric-waiting' },
		{ label: $t('admin.orders.metrics.shipping'), value: summary.byTab?.shipping ?? 0, tone: 'metric-shipping' },
		{ label: $t('admin.orders.metrics.completed'), value: summary.byTab?.completed ?? 0, tone: 'metric-completed' },
		{
			label: $t('admin.orders.metrics.cancelRequested'),
			value: summary.byTab?.cancel_requested ?? 0,
			tone: 'metric-cancel'
		}
	]);

	const formatPrice = (value) => {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) return '--';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return `${new Intl.NumberFormat(localeValue).format(numeric)}${$t('common.currency')}`;
	};

	const formatDate = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return new Intl.DateTimeFormat(localeValue, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	};

	const getItemCount = (order) => {
		const groups = Array.isArray(order?.order_products) ? order.order_products : [];
		return groups.reduce((total, group) => {
			const products = Array.isArray(group?.item_products) ? group.item_products : [];
			return total + products.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0);
		}, 0);
	};

	const getOrderTotal = (order) => {
		const checkout = order?.order_checkout ?? {};
		return checkout.totalCheckout ?? checkout.totalPrice ?? 0;
	};

	const getCustomerName = (order) => {
		const shippingName = String(order?.order_shipping?.name || '').trim();
		if (shippingName) return shippingName;
		const profileName = String(order?.order_userId?.name || '').trim();
		if (profileName) return profileName;
		return '--';
	};

	const getCustomerPhone = (order) => {
		const shippingPhone = String(order?.order_shipping?.phone || '').trim();
		if (shippingPhone) return shippingPhone;
		const profilePhone = String(order?.order_userId?.phone || '').trim();
		if (profilePhone) return profilePhone;
		return '--';
	};

	const getCustomerEmail = (order) => {
		const shippingEmail = String(order?.order_shipping?.email || '').trim();
		if (shippingEmail) return shippingEmail;
		const profileEmail = String(order?.order_userId?.email || '').trim();
		if (profileEmail) return profileEmail;
		return '--';
	};

	const formatAddress = (order) => {
		const shipping = order?.order_shipping ?? {};
		const parts = [shipping.address, shipping.ward, shipping.district, shipping.province]
			.map((part) => String(part || '').trim())
			.filter(Boolean);
		return parts.join(', ');
	};

	const getOrderSourceLabel = (order) => {
		if (order?.order_source === 'guest_checkout') {
			return $locale === 'en' ? 'Guest COD' : 'KhÃ¡ch COD';
		}
		return $locale === 'en' ? 'Account' : 'TÃ i khoáº£n';
	};

	const resolveStatusLabel = (status) => statusLabels[status] || status || '--';

	const getStatusTone = (status) => {
		switch (status) {
			case 'confirmed':
			case 'pending':
				return 'status-waiting';
			case 'shipped':
				return 'status-shipping';
			case 'delivered':
				return 'status-completed';
			case 'cancel_requested':
				return 'status-cancel-requested';
			case 'cancelled':
				return 'status-cancelled';
			case 'returned':
				return 'status-returned';
			default:
				return '';
		}
	};

	const getNextStatuses = (status) => ORDER_STATUS_FLOW[status] ?? [];

	const hasTrackingNumber = (order) =>
		Boolean(order?.order_trackingNumber && order.order_trackingNumber !== '#');

	const buildHref = (overrides = {}) => {
		const entries = [];
		const nextTab = overrides.tab ?? activeTab;
		const nextQuery = typeof overrides.q === 'string' ? overrides.q : String(filters.q || '');
		const nextPage = Number(overrides.page ?? filters.page ?? 1) || 1;
		const nextLimit = Number(overrides.limit ?? filters.limit ?? 20) || 20;
		const nextFrom = typeof overrides.from === 'string' ? overrides.from : String(filters.from || '');
		const nextTo = typeof overrides.to === 'string' ? overrides.to : String(filters.to || '');
		const nextSort = String(overrides.sort ?? filters.sort ?? 'ctime');

		if (nextTab && nextTab !== 'all') entries.push(['status', nextTab]);
		if (nextQuery.trim()) entries.push(['q', nextQuery.trim()]);
		if (nextFrom) entries.push(['from', nextFrom]);
		if (nextTo) entries.push(['to', nextTo]);
		if (nextSort && nextSort !== 'ctime') entries.push(['sort', nextSort]);
		if (nextPage > 1) entries.push(['page', String(nextPage)]);
		if (nextLimit !== 20) entries.push(['limit', String(nextLimit)]);

		const query = entries
			.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
			.join('&');
		return query ? `/admin/orders?${query}` : '/admin/orders';
	};

	const toggleOrderSelection = (orderId) => {
		const id = String(orderId || '').trim();
		if (!id) return;
		const next = new Set(selectedOrderIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selectedOrderIds = next;
	};

	const toggleSelectAllVisibleOrders = () => {
		const next = new Set(selectedOrderIds);
		if (allVisibleOrdersSelected) {
			for (const id of visibleOrderIds) next.delete(id);
		} else {
			for (const id of visibleOrderIds) next.add(id);
		}
		selectedOrderIds = next;
	};

	const clearSelectedOrders = () => {
		selectedOrderIds = new Set();
	};

	const confirmDeleteSelectedOrders = (event) => {
		if (selectedOrderCount <= 0) {
			event.preventDefault();
			return;
		}
		const confirmed = window.confirm(
			$t('admin.orders.bulk.confirmDeleteSelected', { count: selectedOrderCount })
		);
		if (!confirmed) event.preventDefault();
	};

	const confirmDeleteAllOrders = (event) => {
		const confirmed = window.confirm($t('admin.orders.bulk.confirmDeleteAll'));
		if (!confirmed) event.preventDefault();
	};

	$effect(() => {
		const visibleSet = new Set(visibleOrderIds);
		const next = new Set();
		for (const id of selectedOrderIds) {
			if (visibleSet.has(id)) next.add(id);
		}
		if (next.size !== selectedOrderIds.size) {
			selectedOrderIds = next;
		}
	});

	onMount(() => {
		if (!browser) return;
		const toast = form?.toast;
		if (!toast?.message) return;
		const key = toast.id || `${toast.tone || 'info'}:${toast.message}`;
		if (key === lastToastKey) return;
		lastToastKey = key;
		pushToast(toast);
	});
</script>

<svelte:head>
	<title>{$t('admin.orders.title')} | Inoxpran</title>
</svelte:head>

<section class="admin-orders">
	<header class="admin-orders-header card-shell">
		<div>
			<h1>{$t('admin.orders.title')}</h1>
			<p class="lead">{$t('admin.orders.lede')}</p>
			<p class="hint">{$t('admin.orders.autoStatusHint')}</p>
		</div>
	</header>

	<div class="metrics-grid">
		{#each metricCards as metric (metric.label)}
			<div class={`metric-card ${metric.tone}`}>
				<span>{metric.label}</span>
				<strong>{metric.value}</strong>
			</div>
		{/each}
	</div>

	<nav class="order-tabs" aria-label={$t('admin.orders.tabs.label')}>
		{#each tabs as tab (tab.key)}
			<a class:active={tab.key === activeTab} href={resolve(buildHref({ tab: tab.key, page: 1 }))}>
				<span>{tab.label}</span>
				<small>{tab.count}</small>
			</a>
		{/each}
	</nav>

	{#if apiError}
		<div class="alert alert-danger mb-4">{apiError}</div>
	{/if}

	<form method="get" action="/admin/orders" class="filter-bar card-shell">
		<div class="field field-search">
			<label for="admin-order-search">{$t('admin.orders.filters.search')}</label>
			<input
				id="admin-order-search"
				class="form-control"
				name="q"
				value={filters.q}
				placeholder={$t('admin.orders.filters.searchPlaceholder')}
			/>
		</div>
		<div class="field">
			<label for="admin-order-from">{$t('admin.orders.filters.fromDate')}</label>
			<input id="admin-order-from" class="form-control" type="date" name="from" value={filters.from} />
		</div>
		<div class="field">
			<label for="admin-order-to">{$t('admin.orders.filters.toDate')}</label>
			<input id="admin-order-to" class="form-control" type="date" name="to" value={filters.to} />
		</div>
		<div class="field field-actions">
			{#if activeTab !== 'all'}
				<input type="hidden" name="status" value={activeTab} />
			{/if}
			{#if filters.limit !== 20}
				<input type="hidden" name="limit" value={filters.limit} />
			{/if}
			{#if filters.sort && filters.sort !== 'ctime'}
				<input type="hidden" name="sort" value={filters.sort} />
			{/if}
			<button class="btn btn-dark" type="submit">{$t('admin.orders.filters.apply')}</button>
			<a class="btn btn-outline-dark" href={resolve(buildHref({ tab: activeTab, q: '', from: '', to: '', page: 1 }))}>
				{$t('admin.orders.filters.clear')}
			</a>
		</div>
	</form>

	<div class="bulk-toolbar card-shell">
		<div class="bulk-toolbar__left">
			<label class="bulk-check">
				<input
					type="checkbox"
					checked={allVisibleOrdersSelected}
					disabled={orders.length === 0}
					onclick={toggleSelectAllVisibleOrders}
				/>
				<span>{$t('admin.orders.bulk.selectPage')}</span>
			</label>
			<span class="bulk-toolbar__summary">
				{$t('admin.orders.bulk.selectedCount', { count: selectedOrderCount })}
			</span>
			{#if selectedOrderCount > 0}
				<button type="button" class="btn btn-sm btn-outline-dark" onclick={clearSelectedOrders}>
					{$t('admin.orders.bulk.clearSelection')}
				</button>
			{/if}
		</div>
		<div class="bulk-toolbar__actions">
			<form method="post" action="?/deleteSelected">
				<input type="hidden" name="selected_ids" value={selectedOrderIdsPayload} />
				<input type="hidden" name="return_to" value={returnTo} />
				<button
					type="submit"
					class="btn btn-sm btn-outline-danger"
					disabled={selectedOrderCount === 0}
					onclick={confirmDeleteSelectedOrders}
				>
					{$t('admin.orders.bulk.deleteSelected')}
				</button>
			</form>
			<form method="post" action="?/deleteAll">
				<input type="hidden" name="return_to" value={returnTo} />
				<input type="hidden" name="active_tab" value={activeTab} />
				<input type="hidden" name="q" value={filters.q} />
				<input type="hidden" name="from" value={filters.from} />
				<input type="hidden" name="to" value={filters.to} />
				<input type="hidden" name="sort" value={filters.sort} />
				<button
					type="submit"
					class="btn btn-sm btn-danger"
					disabled={orders.length === 0}
					onclick={confirmDeleteAllOrders}
				>
					{$t('admin.orders.bulk.deleteAllFiltered')}
				</button>
			</form>
		</div>
	</div>

	{#if orders.length === 0}
		<div class="empty-state card-shell">
			<h4>{$t('admin.orders.emptyTitle')}</h4>
			<p>{$t('admin.orders.emptyDesc')}</p>
		</div>
	{:else}
		<div class="orders-list">
			{#each orders as order (order._id)}
				{@const nextStatuses = getNextStatuses(order?.order_status)}
				<article class="order-card card-shell">
					<div class="order-card__head">
						<div class="order-card__select">
							<label class="row-check">
								<input
									type="checkbox"
									checked={selectedOrderIds.has(String(order?._id || ''))}
									aria-label={$t('admin.orders.bulk.selectItem')}
									onclick={() => toggleOrderSelection(order?._id)}
								/>
							</label>
						</div>
						<div class="order-card__identity">
							<div class="eyebrow">{$t('admin.orders.table.orderId')}</div>
							<h3 class="order-id break-anywhere">{order?._id}</h3>
							<div class="order-meta-line">
								<span>{formatDate(order?.createdOn)}</span>
								{#if hasTrackingNumber(order)}
									<span>•</span>
									<span class="tracking break-anywhere">{order.order_trackingNumber}</span>
								{:else}
									<span>•</span>
									<span>{$t('admin.orders.noTracking')}</span>
								{/if}
							</div>
						</div>
						<div class="order-card__status">
							<span class={`status-chip ${getStatusTone(order?.order_status)}`}>
								{resolveStatusLabel(order?.order_status)}
							</span>
							<span class="status-chip status-source">{getOrderSourceLabel(order)}</span>
						</div>
					</div>

					<div class="order-card__grid">
						<section class="info-box">
							<div class="info-box__label">{$t('admin.orders.table.customer')}</div>
							<div class="info-box__value">{getCustomerName(order)}</div>
							<div class="info-box__hint break-anywhere">{getCustomerPhone(order)}</div>
							<div class="info-box__hint break-anywhere">{getCustomerEmail(order)}</div>
						</section>

						<section class="info-box">
							<div class="info-box__label">{$t('admin.orders.details.address')}</div>
							<div class="info-box__value break-anywhere">
								{formatAddress(order) || $t('admin.orders.noAddress')}
							</div>
						</section>

						<section class="info-box info-box--metrics">
							<div class="mini-metric">
								<span>{$t('admin.orders.table.items')}</span>
								<strong>{getItemCount(order)}</strong>
							</div>
							<div class="mini-metric">
								<span>{$t('admin.orders.table.total')}</span>
								<strong>{formatPrice(getOrderTotal(order))}</strong>
							</div>
						</section>

						<section class="info-box">
							<div class="info-box__label">{$t('admin.orders.details.paymentStatus')}</div>
							<div class="info-box__value break-anywhere">{order?.order_payment_status || '--'}</div>
							<div class="info-box__label mt-2">{$t('admin.orders.details.shippingStatus')}</div>
							<div class="info-box__value break-anywhere">{order?.order_shipping_status || '--'}</div>
							<div class="info-box__label mt-2">{$t('admin.orders.details.codStatus')}</div>
							<div class="info-box__value break-anywhere">{order?.order_cod_status || '--'}</div>
						</section>
					</div>

					<div class="order-card__actions">
						{#if nextStatuses.length > 0}
							<form method="post" action="?/updateStatus" class="status-form">
								<input type="hidden" name="order_id" value={order?._id} />
								<input type="hidden" name="return_to" value={returnTo} />
								<select name="status" class="form-select form-select-sm">
									{#each nextStatuses as status (status)}
										<option value={status}>{resolveStatusLabel(status)}</option>
									{/each}
								</select>
								<button class="btn btn-sm btn-dark" type="submit">
									{$t('admin.orders.updateStatus')}
								</button>
							</form>
						{:else}
							<div class="status-lock">{$t('admin.orders.noTransitions')}</div>
						{/if}
					</div>

					<details class="order-details">
						<summary>{$t('admin.orders.detailsToggle')}</summary>
						<div class="order-details-grid">
							<div>
								<span>{$t('admin.orders.details.receiver')}</span>
								<strong>{getCustomerName(order)}</strong>
							</div>
							<div>
								<span>{$t('admin.orders.details.phone')}</span>
								<strong>{getCustomerPhone(order)}</strong>
							</div>
							<div>
								<span>{$t('admin.orders.details.email')}</span>
								<strong class="break-anywhere">{getCustomerEmail(order)}</strong>
							</div>
							<div>
								<span>{$t('admin.orders.details.updatedAt')}</span>
								<strong>{formatDate(order?.modifiedOn)}</strong>
							</div>
							{#if order?.order_cancel_request?.reason}
								<div class="full">
									<span>{$t('admin.orders.details.cancelReason')}</span>
									<strong class="break-anywhere">{order.order_cancel_request.reason}</strong>
								</div>
							{/if}
						</div>
					</details>
				</article>
			{/each}
		</div>
	{/if}

	{#if pagination.totalPages > 1}
		<nav class="pagination-wrap" aria-label={$t('admin.orders.pagination.label')}>
			<a
				class={`page-link ${pagination.hasPrev ? '' : 'disabled'}`}
				href={resolve(buildHref({ page: pagination.hasPrev ? pagination.page - 1 : pagination.page }))}
				aria-disabled={!pagination.hasPrev}
			>
				{$t('admin.orders.pagination.prev')}
			</a>
			<span>
				{$t('admin.orders.pagination.page', { page: pagination.page, total: pagination.totalPages })}
			</span>
			<a
				class={`page-link ${pagination.hasNext ? '' : 'disabled'}`}
				href={resolve(buildHref({ page: pagination.hasNext ? pagination.page + 1 : pagination.page }))}
				aria-disabled={!pagination.hasNext}
			>
				{$t('admin.orders.pagination.next')}
			</a>
		</nav>
	{/if}
</section>

<style>
	.admin-orders {
		padding: 0;
		background: transparent;
		color: var(--admin-ink);
		display: grid;
		gap: 16px;
	}

	.card-shell {
		background: #fff;
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius);
		box-shadow: var(--admin-shadow);
	}

	.admin-orders-header {
		padding: 18px;
	}

	.admin-orders-header h1 {
		font-size: 2rem;
		margin-bottom: 8px;
	}

	.admin-orders-header .lead {
		color: var(--admin-muted);
		max-width: 720px;
		margin: 0;
	}

	.admin-orders-header .hint {
		margin: 8px 0 0;
		color: #8a561f;
		font-size: 0.9rem;
	}

	.metrics-grid {
		display: grid;
		gap: 14px;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	}

	.metric-card {
		border-radius: 14px;
		border: 1px solid var(--admin-border);
		background: var(--admin-card);
		padding: 12px 14px;
		display: grid;
		gap: 4px;
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.05);
	}

	.metric-card span {
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #7a6f62;
		font-weight: 600;
	}

	.metric-card strong {
		font-size: 1.5rem;
		line-height: 1;
	}

	.metric-total {
		background: linear-gradient(145deg, #ffffff 0%, #f6f0e7 100%);
	}

	.metric-waiting strong {
		color: #8a5a00;
	}
	.metric-shipping strong {
		color: #0b8799;
	}
	.metric-completed strong {
		color: #2d8a45;
	}
	.metric-cancel strong {
		color: #b23b3b;
	}

	.order-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.order-tabs a {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: 999px;
		border: 1px solid #d8d1c5;
		background: #fff;
		text-decoration: none;
		color: #2f2a23;
		font-weight: 600;
		font-size: 0.88rem;
		transition: all 0.2s ease;
		max-width: 100%;
	}

	.order-tabs a span {
		overflow-wrap: anywhere;
	}

	.order-tabs a small {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 24px;
		height: 24px;
		border-radius: 999px;
		background: #f5f1ea;
		font-size: 0.72rem;
		font-weight: 700;
		color: #4a4138;
	}

	.order-tabs a.active {
		background: #1f1a14;
		color: #fff7e8;
		border-color: #1f1a14;
	}

	.order-tabs a.active small {
		background: rgba(255, 247, 232, 0.22);
		color: #fff7e8;
	}

	.filter-bar {
		display: grid;
		grid-template-columns: 1.6fr 1fr 1fr auto;
		gap: 12px;
		align-items: end;
		padding: 14px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.field label {
		font-size: 0.76rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #66584a;
	}

	.field-actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}

	.field-actions .btn {
		white-space: nowrap;
	}

	.empty-state {
		padding: 38px 24px;
		text-align: center;
	}

	.bulk-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 14px;
		align-items: center;
		justify-content: space-between;
		padding: 12px 14px;
	}

	.bulk-toolbar__left {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.bulk-toolbar__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.bulk-toolbar__actions form {
		margin: 0;
	}

	.bulk-toolbar__summary {
		font-size: 0.86rem;
		font-weight: 600;
		color: #4f4539;
	}

	.bulk-check,
	.row-check {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 0.84rem;
		font-weight: 600;
		color: #3a322a;
	}

	.bulk-check input,
	.row-check input {
		width: 16px;
		height: 16px;
		margin: 0;
	}

	.empty-state h4 {
		margin-bottom: 8px;
	}

	.empty-state p {
		margin: 0;
		color: var(--admin-muted);
	}

	.orders-list {
		display: grid;
		gap: 14px;
	}

	.order-card {
		padding: 14px;
		overflow: hidden;
	}

	.order-card__head {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 12px;
	}

	.order-card__select {
		padding-top: 2px;
	}

	.order-card__identity {
		min-width: 0;
	}

	.eyebrow {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #7e7264;
	}

	.order-id {
		margin: 4px 0 0;
		font-size: 0.95rem;
		font-weight: 700;
		line-height: 1.35;
	}

	.order-meta-line {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		align-items: center;
		margin-top: 4px;
		font-size: 0.82rem;
		color: #7b7063;
	}

	.order-card__status {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 6px;
		flex-shrink: 0;
	}

	.order-card__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 10px;
		margin-bottom: 12px;
	}

	.info-box {
		border: 1px solid #efe9df;
		background: #fbf8f3;
		border-radius: 12px;
		padding: 10px;
		min-width: 0;
	}

	.info-box__label {
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #7e7264;
		font-weight: 700;
	}

	.info-box__value {
		margin-top: 4px;
		font-size: 0.88rem;
		font-weight: 700;
		color: #2d2620;
		line-height: 1.35;
	}

	.info-box__hint {
		margin-top: 3px;
		font-size: 0.8rem;
		color: #6d6256;
		line-height: 1.35;
	}

	.info-box--metrics {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.mini-metric {
		display: grid;
		gap: 4px;
		padding: 8px;
		border-radius: 10px;
		background: #fff;
		border: 1px solid #eee4d5;
	}

	.mini-metric span {
		font-size: 0.72rem;
		color: #6f6458;
	}

	.mini-metric strong {
		font-size: 0.95rem;
		line-height: 1.2;
		word-break: break-word;
	}

	.tracking {
		font-weight: 700;
		color: #2f6da1;
	}

	.status-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		background: #f2eee8;
		color: #4f4539;
	}

	.status-chip.status-waiting {
		background: rgba(255, 196, 87, 0.22);
		color: #8a5a00;
	}
	.status-chip.status-shipping {
		background: rgba(11, 135, 153, 0.2);
		color: #0b8799;
	}
	.status-chip.status-completed {
		background: rgba(45, 138, 69, 0.2);
		color: #2d8a45;
	}
	.status-chip.status-cancel-requested {
		background: rgba(178, 59, 59, 0.18);
		color: #b23b3b;
	}
	.status-chip.status-cancelled {
		background: rgba(120, 120, 120, 0.22);
		color: #565656;
	}
	.status-chip.status-returned {
		background: rgba(233, 77, 47, 0.2);
		color: #e94d2f;
	}

	.status-chip.status-source {
		background: rgba(15, 95, 119, 0.12);
		color: #0f5f77;
	}

	.order-card__actions {
		margin-bottom: 10px;
	}

	.status-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		align-items: center;
	}

	.status-lock {
		font-size: 0.82rem;
		color: #7b7063;
		padding: 8px 10px;
		border-radius: 10px;
		background: #f6f2ea;
		border: 1px dashed #e3d9c8;
	}

	.order-details {
		background: #fdfbf8;
		border: 1px dashed #e6ddcf;
		border-radius: 12px;
		padding: 6px 10px;
	}

	.order-details summary {
		cursor: pointer;
		font-weight: 700;
		color: #41372d;
	}

	.order-details-grid {
		margin-top: 10px;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.order-details-grid span {
		display: block;
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #7e7264;
	}

	.order-details-grid strong {
		font-size: 0.86rem;
		color: #2d2620;
		line-height: 1.35;
		display: block;
		margin-top: 2px;
	}

	.order-details-grid .full {
		grid-column: 1 / -1;
	}

	.pagination-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 14px;
		margin-top: 4px;
		font-weight: 600;
		flex-wrap: wrap;
	}

	.page-link {
		padding: 7px 12px;
		border-radius: 8px;
		border: 1px solid var(--admin-border);
		text-decoration: none;
		color: #1f1a14;
		background: #fff;
	}

	.page-link.disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	.break-anywhere {
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	@media (max-width: 1100px) {
		.filter-bar {
			grid-template-columns: 1fr 1fr;
		}

		.field-search {
			grid-column: 1 / -1;
		}

		.field-actions {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 768px) {
		.admin-orders-header h1 {
			font-size: 1.55rem;
		}

		.metrics-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.filter-bar {
			grid-template-columns: 1fr;
		}

		.field-actions {
			flex-direction: column;
		}

		.field-actions .btn {
			width: 100%;
		}

		.order-card__head {
			grid-template-columns: 1fr;
		}

		.order-card__status {
			width: 100%;
		}

		.order-card__select {
			padding-top: 0;
		}

		.bulk-toolbar {
			flex-direction: column;
			align-items: stretch;
		}

		.bulk-toolbar__actions {
			width: 100%;
		}

		.bulk-toolbar__actions form,
		.bulk-toolbar__actions .btn {
			width: 100%;
		}

		.status-form {
			grid-template-columns: 1fr;
		}

		.status-form .btn {
			width: 100%;
		}

		.order-details-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 576px) {
		.metrics-grid {
			grid-template-columns: 1fr;
		}

		.order-tabs a {
			width: 100%;
			justify-content: space-between;
		}

		.info-box--metrics {
			grid-template-columns: 1fr;
		}
	}
</style>
