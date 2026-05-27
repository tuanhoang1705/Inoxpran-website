<script>
	import { page } from '$app/stores';
	import { locale, t } from '$lib/i18n/admin/index.js';

	let { data } = $props();
	let searchQuery = $state('');
	let allProducts = $state([]);
	let isLoadingAll = $state(false);

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

	// Fetch all products for search
	const loadAllProducts = async () => {
		if (isLoadingAll || allProducts.length > 0) return;
		isLoadingAll = true;

		try {
			const params = new URLSearchParams();
			params.set('limit', '10000');
			params.set('page', '1');
			params.set('sort', 'created');
			params.set('status', 'published');

			const response = await fetch(`/admin/api/products/all?${params.toString()}`);
			if (response.ok) {
				const result = await response.json();
				allProducts = Array.isArray(result?.data) ? result.data : [];
			}
		} catch (error) {
			console.error('Error loading all products:', error);
		} finally {
			isLoadingAll = false;
		}
	};

	// Auto load all products when search is active
	$effect(() => {
		if (searchQuery.trim() && allProducts.length === 0) {
			loadAllProducts();
		}
	});

	const pagination = $derived(data?.pagination ?? null);

	// Levenshtein distance - đo độ tương đồng giữa 2 chuỗi
	const levenshteinDistance = (str1, str2) => {
		const track = Array(str2.length + 1)
			.fill(null)
			.map(() => Array(str1.length + 1).fill(0));

		for (let i = 0; i <= str1.length; i += 1) {
			track[0][i] = i;
		}
		for (let j = 0; j <= str2.length; j += 1) {
			track[j][0] = j;
		}

		for (let j = 1; j <= str2.length; j += 1) {
			for (let i = 1; i <= str1.length; i += 1) {
				const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
				track[j][i] = Math.min(
					track[j][i - 1] + 1,
					track[j - 1][i] + 1,
					track[j - 1][i - 1] + indicator
				);
			}
		}

		return track[str2.length][str1.length];
	};

	// Tính điểm tương ứng cho sản phẩm
	const calculateScore = (product, query) => {
		let score = 0;
		const queryLower = query.toLowerCase();
		const nameLower = product.product_name.toLowerCase();
		const typeLower = product.product_type.toLowerCase();

		// Exact match (điểm cao nhất)
		if (nameLower === queryLower) return 10000;
		if (nameLower.startsWith(queryLower)) score += 1000;
		if (nameLower.includes(queryLower)) score += 500;

		// Type match
		if (typeLower.includes(queryLower)) score += 200;

		// Fuzzy match - độ gần giống
		const nameDistance = levenshteinDistance(nameLower, queryLower);
		const fuzzyScore = Math.max(0, 100 - nameDistance * 10);
		score += fuzzyScore;

		// Word-by-word search
		const queryWords = queryLower.split(/\s+/).filter(Boolean);
		queryWords.forEach((word) => {
			if (nameLower.includes(word)) score += 50;
			if (typeLower.includes(word)) score += 25;
		});

		return score;
	};

	// Hàm tìm kiếm chính
	const searchProducts = (products, query) => {
		if (!query.trim()) return products ?? [];

		return (products ?? [])
			.map((product) => ({
				product,
				score: calculateScore(product, query)
			}))
			.filter(({ score }) => score > 0)
			.sort((a, b) => b.score - a.score)
			.map(({ product }) => product);
	};

	// Use allProducts if available (search mode), otherwise use paginated data
	const productsToSearch = $derived(allProducts.length > 0 ? allProducts : data?.products ?? []);
	const filteredProducts = $derived(searchProducts(productsToSearch, searchQuery));

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

	<div class="mb-3">
		<input
			type="text"
			class="form-control form-control-lg"
			placeholder='Tìm kiếm sản phẩm...'
			bind:value={searchQuery}
		/>
	</div>

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
					{#if filteredProducts?.length}
						{#each filteredProducts as product}
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
									<a
										class="btn btn-sm btn-primary fw-semibold text-white"
										href={`/admin/products/${product._id}`}
										style="padding: 0.4rem 0.8rem; border-radius: 0.375rem; transition: all 0.3s ease;"
									>
										✎ {$t('admin.products.edit')}
									</a>
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

<style>
	:global(.btn-primary:hover) {
		background-color: #0d6efd;
		box-shadow: 0 0.5rem 1rem rgba(13, 110, 253, 0.3);
		transform: translateY(-1px);
	}

	:global(.form-control-lg) {
		height: 2.75rem;
		font-size: 1rem;
		border-color: #dee2e6;
	}

	:global(.form-control-lg:focus) {
		border-color: #0d6efd;
		box-shadow: 0 0 0 0.2rem rgba(13, 110, 253, 0.25);
	}
</style>
