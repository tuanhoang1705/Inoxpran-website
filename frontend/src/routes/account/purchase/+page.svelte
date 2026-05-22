<script>
	import { locale, t } from '$lib/i18n/index.js';

	let { data } = $props();

	const orders = $derived(data?.orders ?? []);
	const activeTab = $derived(data?.activeTab ?? 'all');

	const tabs = $derived.by(() => [
		{ key: 'all', label: $t('purchase.tabs.all'), href: '/account/purchase' },
		{ key: 'shipping', label: $t('purchase.tabs.shipping'), href: '/account/purchase?status=shipping' },
		{ key: 'waiting', label: $t('purchase.tabs.waiting'), href: '/account/purchase?status=waiting' },
		{
			key: 'completed',
			label: $t('purchase.tabs.completed'),
			href: '/account/purchase?status=completed'
		},
		{
			key: 'cancelled',
			label: $t('purchase.tabs.cancelled'),
			href: '/account/purchase?status=cancelled'
		},
		{
			key: 'returned',
			label: $t('purchase.tabs.returned'),
			href: '/account/purchase?status=returned'
		}
	]);

	const statusLabels = $derived.by(() => ({
		pending: $t('purchase.status.pending'),
		confirmed: $t('purchase.status.confirmed'),
		shipped: $t('purchase.status.shipped'),
		delivered: $t('purchase.status.delivered'),
		cancel_requested: $t('purchase.status.cancelRequested'),
		cancelled: $t('purchase.status.cancelled'),
		returned: $t('purchase.status.returned')
	}));

	const formatPrice = (value) => {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) return '';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return `${new Intl.NumberFormat(localeValue).format(numeric)}${$t('common.currency')}`;
	};

	const formatDate = (value) => {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return new Intl.DateTimeFormat(localeValue, { dateStyle: 'medium' }).format(date);
	};

	const getItemCount = (order) => {
		const groups = Array.isArray(order?.order_products) ? order.order_products : [];
		return groups.reduce((total, group) => {
			const items = Array.isArray(group?.item_products) ? group.item_products : [];
			return total + items.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0);
		}, 0);
	};

	const getOrderTotal = (order) => {
		const checkout = order?.order_checkout ?? {};
		return checkout.totalCheckout ?? checkout.totalPrice ?? 0;
	};

	const getStatusLabel = (status) => statusLabels[status] ?? status ?? '';
</script>

<svelte:head>
	<title>{$t('purchase.title')} | Inoxpran</title>
</svelte:head>

<section class="purchase-shell padding-large">
	<div class="container">
		<div class="purchase-header">
			<div>
				<p class="eyebrow">{$t('purchase.title')}</p>
				<h1 class="section-title">{$t('purchase.heading')}</h1>
				<p class="purchase-lede">{$t('purchase.lede')}</p>
			</div>
		</div>

		<div class="purchase-tabs" role="tablist">
			{#each tabs as tab}
				<a
					class:active={tab.key === activeTab}
					href={tab.href}
					role="tab"
					aria-selected={tab.key === activeTab}
				>
					{tab.label}
				</a>
			{/each}
		</div>

		{#if data?.apiError}
			<div class="alert alert-danger" role="alert">{data.apiError}</div>
		{/if}

		{#if orders.length === 0}
			<div class="purchase-empty card border-0 shadow-sm">
				<p>{$t('purchase.empty')}</p>
			</div>
		{:else}
			<div class="purchase-list">
				{#each orders as order}
					<article class="purchase-card">
						<div class="purchase-card-head">
							<div>
								<span class="purchase-label">{$t('purchase.orderId')}</span>
								<span class="purchase-id">{order?._id}</span>
							</div>
							<span class={`purchase-status status-${order?.order_status || 'pending'}`}>
								{getStatusLabel(order?.order_status)}
							</span>
						</div>
						<div class="purchase-meta">
							<div>
								<span class="purchase-label">{$t('purchase.items')}</span>
								<span class="purchase-value">{getItemCount(order)}</span>
							</div>
							<div>
								<span class="purchase-label">{$t('purchase.total')}</span>
								<span class="purchase-value">{formatPrice(getOrderTotal(order))}</span>
							</div>
							<div>
								<span class="purchase-label">{$t('purchase.createdAt')}</span>
								<span class="purchase-value">{formatDate(order?.createdOn)}</span>
							</div>
						</div>
						{#if order?.order_trackingNumber && order.order_trackingNumber !== '#'}
							<div class="purchase-tracking">
								<span class="purchase-label">{$t('purchase.tracking')}</span>
								<span class="purchase-value">{order.order_trackingNumber}</span>
							</div>
						{/if}
					</article>
				{/each}
			</div>
		{/if}
	</div>
</section>

<style>
	.purchase-shell {
		background:
			radial-gradient(circle at top left, rgba(241, 247, 255, 0.6), transparent 60%),
			radial-gradient(circle at top right, rgba(255, 244, 230, 0.5), transparent 55%),
			#fffdf8;
		min-height: 100vh;
	}

	.purchase-header {
		margin-bottom: 24px;
	}

	.purchase-lede {
		max-width: 640px;
		color: #5b5b5b;
	}

	.purchase-tabs {
		display: flex;
		gap: 20px;
		flex-wrap: wrap;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
		margin-bottom: 24px;
	}

	.purchase-tabs a {
		text-decoration: none;
		color: #6b5e53;
		padding-bottom: 10px;
		border-bottom: 2px solid transparent;
		font-weight: 600;
		transition: color 0.2s ease, border-color 0.2s ease;
	}

	.purchase-tabs a.active {
		color: #1b1b1b;
		border-color: #e94d2f;
	}

	.purchase-list {
		display: grid;
		gap: 16px;
	}

	.purchase-card {
		background: #fff;
		border-radius: 18px;
		border: 1px solid rgba(0, 0, 0, 0.08);
		padding: 16px 18px;
		box-shadow: 0 12px 24px rgba(0, 0, 0, 0.05);
		display: grid;
		gap: 12px;
	}

	.purchase-card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.purchase-label {
		display: block;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(90, 74, 60, 0.75);
	}

	.purchase-id {
		font-weight: 700;
		color: #1b1b1b;
		word-break: break-all;
	}

	.purchase-meta {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
	}

	.purchase-value {
		font-weight: 600;
		color: #1b1b1b;
	}

	.purchase-status {
		padding: 6px 12px;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.purchase-status.status-pending,
	.purchase-status.status-confirmed,
	.purchase-status.status-cancel_requested {
		background: rgba(255, 196, 87, 0.2);
		color: #8a5a00;
	}

	.purchase-status.status-shipped {
		background: rgba(11, 135, 153, 0.18);
		color: #0b8799;
	}

	.purchase-status.status-delivered {
		background: rgba(45, 138, 69, 0.18);
		color: #2d8a45;
	}

	.purchase-status.status-cancelled {
		background: rgba(120, 120, 120, 0.18);
		color: #555;
	}

	.purchase-status.status-returned {
		background: rgba(233, 77, 47, 0.18);
		color: #e94d2f;
	}

	.purchase-tracking {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		border-top: 1px dashed rgba(0, 0, 0, 0.1);
		padding-top: 10px;
	}

	.purchase-empty {
		padding: 32px;
		text-align: center;
	}

	@media (max-width: 768px) {
		.purchase-meta {
			grid-template-columns: 1fr;
		}
	}
</style>
