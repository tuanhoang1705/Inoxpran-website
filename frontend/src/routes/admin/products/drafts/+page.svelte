<script>
	import { onMount } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { locale, t } from '$lib/i18n/admin/index.js';

	let { data, form } = $props();


	const formatDate = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return date.toLocaleString(localeValue);
	};

	const getCreatorName = (product) => {
		const shop = product?.product_shop;
		if (!shop) return '--';
		if (typeof shop === 'string') {
			const trimmed = shop.trim();
			if (!trimmed) return '--';
			const isObjectId = /^[a-f\d]{24}$/i.test(trimmed);
			if (isObjectId) {
				return data?.creatorLookup?.[trimmed] || '--';
			}
			return trimmed;
		}
		return shop.name || shop.email || '--';
	};

	onMount(() => {
		if (form?.toast) {
			pushToast(form.toast);
		}
	});
</script>

<svelte:head>
	<title>{$t('admin.productsDrafts.title')} | Admin</title>
</svelte:head>

<section>
	<div class="d-flex justify-content-between align-items-center mb-3">
		<div>
			<h2 class="mb-1">{$t('admin.productsDrafts.title')}</h2>
			<p class="text-black-50 mb-0">{$t('admin.productsDrafts.lede')}</p>
		</div>
		<div class="d-flex gap-2">
			<a class="btn btn-outline-dark" href="/admin/products">{$t('admin.productsDrafts.backToList')}</a>
			<a class="btn btn-dark" href="/admin/products/new">{$t('admin.productsDrafts.newDraft')}</a>
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
						<th>{$t('admin.productsDrafts.name')}</th>
						<th>{$t('admin.productsDrafts.type')}</th>
						<th>{$t('admin.productsDrafts.created')}</th>
						<th>{$t('admin.productsDrafts.creator')}</th>
						<th>{$t('admin.productsDrafts.status')}</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#if data?.drafts?.length}
						{#each data.drafts as product}
							<tr>
								<td>{product.product_name}</td>
								<td>{product.product_type}</td>
								<td>{formatDate(product.createdAt)}</td>
								<td>{getCreatorName(product)}</td>
								<td>
									<span class="badge bg-warning text-dark">{$t('admin.productsDrafts.draftStatus')}</span>
								</td>
								<td class="text-end">
									<div class="d-inline-flex gap-2">
										<a class="btn btn-sm btn-outline-dark" href={`/admin/products/${product._id}`}
											>{$t('admin.products.edit')}</a
										>
										<form method="post" action="?/publish">
											<input type="hidden" name="product_id" value={product._id} />
											<button class="btn btn-sm btn-success" type="submit">
												{$t('admin.productsDrafts.publish')}
											</button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					{:else}
						<tr>
							<td colspan="6" class="text-center text-black-50 py-4">
								{$t('admin.productsDrafts.empty')}
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	</div>
</section>
