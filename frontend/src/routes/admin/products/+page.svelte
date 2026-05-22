<script>
	import { page } from '$app/stores';
	import { locale, t } from '$lib/i18n/admin/index.js';

	let { data } = $props();


	const formatPrice = (value) => {
		const numeric = Number(value);
		if (Number.isNaN(numeric)) return '';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return new Intl.NumberFormat(localeValue).format(numeric);
	};

	const formatDate = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return date.toLocaleString(localeValue);
	};

	const getCreatorName = (product, lookup = {}) => {
		const shop = product?.product_shop;
		if (!shop) return '--';
		if (typeof shop === 'string') {
			const trimmed = shop.trim();
			if (!trimmed) return '--';
			const isObjectId = /^[a-f\d]{24}$/i.test(trimmed);
			if (isObjectId) {
				return lookup?.[trimmed] || '--';
			}
			return trimmed;
		}
		return shop.name || shop.email || '--';
	};

	const getStatusBadge = (product) => {
		if (product?.isPublished) {
			return { label: $t('admin.products.published'), tone: 'success' };
		}
		if (product?.isDraft) {
			return { label: $t('admin.products.draft'), tone: 'warning' };
		}
		return { label: $t('admin.products.unknown'), tone: 'secondary' };
	};

	const pagination = $derived(data?.pagination ?? null);

	const buildPageHref = (target) => {
		const url = new URL($page.url);
		url.searchParams.set('page', String(target));
		return `${url.pathname}${url.search}`;
	};
</script>

<svelte:head>
	<title>{$t('admin.products.title')} | Inoxpran</title>
</svelte:head>

<section>
	<div class="d-flex justify-content-between align-items-center mb-3">
		<h2 class="mb-0">{$t('admin.products.title')}</h2>
		<div class="d-flex gap-2">
			<a class="btn btn-outline-dark" href="/admin/products/drafts">{$t('admin.products.drafts')}</a>
			<a class="btn btn-dark" href="/admin/products/new">{$t('admin.products.newDraft')}</a>
		</div>
	</div>

	{#if data?.apiError}
		<div class="alert alert-danger">{data.apiError}</div>
	{/if}

	<div class="border rounded-3 bg-white">
		<div class="table-responsive">
			<table class="table mb-0 align-middle">
				<thead>
					<tr>
						<th>{$t('admin.products.name')}</th>
						<th>{$t('admin.products.type')}</th>
						<th>{$t('admin.products.price')}</th>
						<th>{$t('admin.products.admin')}</th>
						<th>{$t('admin.products.created')}</th>
						<th>{$t('admin.products.updated')}</th>
						<th>{$t('admin.products.status')}</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#if data?.products?.length}
						{#each data.products as product}
							{@const statusInfo = getStatusBadge(product)}
							<tr>
								<td>{product.product_name}</td>
								<td>{product.product_type}</td>
								<td>{formatPrice(product.product_price)} {$t('common.currency')}</td>
								<td>{getCreatorName(product, data?.creatorLookup)}</td>
								<td>{formatDate(product.createdAt)}</td>
								<td>{formatDate(product.updatedAt)}</td>
								<td>
									<span class={`badge bg-${statusInfo.tone}`}>{statusInfo.label}</span>
								</td>
								<td>
									<a class="btn btn-sm btn-outline-dark" href={`/admin/products/${product._id}`}
										>{$t('admin.products.edit')}</a
									>
								</td>
							</tr>
						{/each}
					{:else}
						<tr>
							<td colspan="8" class="text-center text-black-50 py-4">{$t('admin.products.empty')}</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	</div>

	{#if pagination}
		<div class="d-flex justify-content-between align-items-center mt-3">
			<a
				class="btn btn-outline-dark"
				href={buildPageHref(Math.max(pagination.page - 1, 1))}
				aria-disabled={!pagination.hasPrev}
				class:disabled={!pagination.hasPrev}
			>
				{$t('common.paginationPrev')}
			</a>
			<span class="text-black-50">
				{$t('common.pageLabel', { page: pagination.page })}
			</span>
			<a
				class="btn btn-outline-dark"
				href={buildPageHref(pagination.page + 1)}
				aria-disabled={!pagination.hasNext}
				class:disabled={!pagination.hasNext}
			>
				{$t('common.paginationNext')}
			</a>
		</div>
	{/if}
</section>
