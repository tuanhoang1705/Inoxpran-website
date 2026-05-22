<script>
	import { onMount } from 'svelte';
	import { locale, t } from '$lib/i18n/admin/index.js';
	import { pushToast } from '$lib/stores/adminToast.js';

	let { data, form } = $props();

	let bestSelling = $state(Array.isArray(data?.bestSelling) ? [...data.bestSelling] : []);
	let searchTerm = $state('');
	let draggingId = $state('');
	let draggingSource = $state('');
	let draggingIndex = $state(-1);
	let dragOverIndex = $state(-1);

	const allProducts = $derived(Array.isArray(data?.products) ? data.products : []);
	const productMap = $derived.by(() => {
		const map = new Map();
		allProducts.forEach((product) => {
			if (product?._id) map.set(String(product._id), product);
		});
		return map;
	});

	const formatPrice = (value) => {
		const numeric = Number(value);
		if (Number.isNaN(numeric)) return '--';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return new Intl.NumberFormat(localeValue).format(numeric);
	};

	const resolveThumb = (product) => {
		const thumb = product?.product_thumb;
		if (typeof thumb === 'string' && thumb.trim()) return thumb;
		return '/images/optimized/product-item1-640.webp';
	};

	const moveItem = (from, to) => {
		if (to < 0 || to >= bestSelling.length) return;
		const updated = [...bestSelling];
		const [moved] = updated.splice(from, 1);
		updated.splice(to, 0, moved);
		bestSelling = updated;
	};

	const insertItemAt = (product, index) => {
		if (!product?._id) return;
		if (bestSelling.some((item) => item._id === product._id)) return;
		const updated = [...bestSelling];
		const safeIndex = Math.max(0, Math.min(index, updated.length));
		updated.splice(safeIndex, 0, product);
		bestSelling = updated;
	};

	const removeItem = (productId) => {
		bestSelling = bestSelling.filter((item) => item._id !== productId);
	};

	const addItem = (product) => {
		if (!product?._id) return;
		if (bestSelling.some((item) => item._id === product._id)) return;
		bestSelling = [...bestSelling, product];
	};

	const handleDragStart = (event, product, index, source) => {
		if (!product?._id) return;
		draggingId = String(product._id);
		draggingSource = source;
		draggingIndex = Number.isFinite(index) ? index : -1;
		event.dataTransfer?.setData('text/plain', draggingId);
		event.dataTransfer?.setData('application/x-inoxpran-source', source);
		event.dataTransfer?.setData('application/x-inoxpran-index', String(draggingIndex));
		event.dataTransfer?.setDragImage?.(event.currentTarget, 12, 12);
	};

	const handleDragEnd = () => {
		draggingId = '';
		draggingSource = '';
		draggingIndex = -1;
		dragOverIndex = -1;
	};

	const handleListDragOver = (event) => {
		event.preventDefault();
		const items = Array.from(
			event.currentTarget?.querySelectorAll('.best-selling-item') || []
		);
		if (!items.length) {
			dragOverIndex = 0;
			return;
		}
		const pointerY = event.clientY;
		let nextIndex = items.findIndex((item) => {
			const rect = item.getBoundingClientRect();
			return pointerY < rect.top + rect.height / 2;
		});
		if (nextIndex === -1) {
			nextIndex = items.length;
		}
		dragOverIndex = nextIndex;
	};

	const handleDropOnList = (event) => {
		event.preventDefault();
		const id = event.dataTransfer?.getData('text/plain') || draggingId;
		const source = event.dataTransfer?.getData('application/x-inoxpran-source') || draggingSource;
		if (!id) return;
		if (source === 'available') {
			const product = productMap.get(String(id));
			if (product) {
				const targetIndex = dragOverIndex >= 0 ? dragOverIndex : bestSelling.length;
				insertItemAt(product, targetIndex);
			}
		} else if (source === 'best') {
			const fromIndex = Number(event.dataTransfer?.getData('application/x-inoxpran-index'));
			if (Number.isFinite(fromIndex)) {
				const targetIndex = dragOverIndex >= 0 ? dragOverIndex : bestSelling.length - 1;
				const adjustedIndex = targetIndex > fromIndex ? targetIndex - 1 : targetIndex;
				moveItem(fromIndex, adjustedIndex);
			}
		}
		handleDragEnd();
	};

	const handleDropOnItem = (event, index) => {
		event.preventDefault();
		const id = event.dataTransfer?.getData('text/plain') || draggingId;
		const source = event.dataTransfer?.getData('application/x-inoxpran-source') || draggingSource;
		if (!id) return;
		if (source === 'available') {
			const product = productMap.get(String(id));
			if (product) insertItemAt(product, index);
		} else if (source === 'best') {
			const fromIndex = Number(event.dataTransfer?.getData('application/x-inoxpran-index'));
			if (Number.isFinite(fromIndex)) moveItem(fromIndex, index);
		}
		handleDragEnd();
	};

	const handleItemDragOver = (event, index) => {
		event.preventDefault();
		dragOverIndex = index;
	};

	const handleItemDragLeave = (event) => {
		if (!event.currentTarget?.contains(event.relatedTarget)) {
			dragOverIndex = -1;
		}
	};

	const availableProducts = $derived(() => {
		const selected = new Set(bestSelling.map((item) => item._id));
		const keyword = searchTerm.trim().toLowerCase();
		let a = allProducts.filter((product) => {
			if (!product?._id || selected.has(product._id)) return false;
			if (product.isPublished === false) return false;
			if (!keyword) return true;
			return String(product.product_name || '').toLowerCase().includes(keyword);
		});
		return a;
	});

	const orderPayload = $derived(
		JSON.stringify(bestSelling.map((item) => item._id).filter(Boolean))
	);

	onMount(() => {
		availableProducts();
		if (form?.error) {
			pushToast({ tone: 'error', message: form.error });
		}
	});
</script>

<svelte:head>
	<title>{$t('admin.bestSelling.title')} | Admin</title>
</svelte:head>

<section class="best-selling-page">
	<header class="page-header">
		<div>
			<h2>{$t('admin.bestSelling.title')}</h2>
			<p class="text-muted">{$t('admin.bestSelling.lede')}</p>
		</div>
	</header>

	{#if data?.apiError}
		<div class="alert alert-danger">{data.apiError}</div>
	{/if}

	<form method="post" action="?/save" class="best-selling-grid">
		<input type="hidden" name="best_selling_order" value={orderPayload} />

		<div class="panel">
			<div class="panel-header">
				<h3>{$t('admin.bestSelling.listTitle')}</h3>
				<button class="btn btn-dark" type="submit">
					{$t('admin.bestSelling.save')}
				</button>
			</div>
			<p class="panel-hint">{$t('admin.bestSelling.hint')}</p>

			<ul
				class="best-selling-list"
				class:is-drop-target={draggingSource === 'available'}
				ondragover={handleListDragOver}
				ondrop={handleDropOnList}
			>
				{#if bestSelling.length}
					{#each bestSelling as product, index (product._id)}
						<li
							class="best-selling-item"
							class:is-dragging={draggingId === String(product._id)}
							class:is-drop-over={dragOverIndex === index && draggingId !== String(product._id)}
							draggable="true"
							ondragstart={(event) => handleDragStart(event, product, index, 'best')}
							ondragend={handleDragEnd}
							ondragover={(event) => handleItemDragOver(event, index)}
							ondragleave={handleItemDragLeave}
							ondrop={(event) => handleDropOnItem(event, index)}
						>
							<div class="order-badge">{index + 1}</div>
							<img src={resolveThumb(product)} alt={product.product_name} />
							<div class="item-info">
								<div class="item-title">{product.product_name}</div>
								<div class="item-meta">
									<span>{product.product_type}</span>
									<span>{formatPrice(product.product_price)}{$t('common.currency')}</span>
								</div>
							</div>
							<div class="item-actions">
								<button
									type="button"
									class="btn btn-outline-dark btn-sm"
									onclick={() => moveItem(index, index - 1)}
									disabled={index === 0}
									title={$t('admin.bestSelling.moveUp')}
									aria-label={$t('admin.bestSelling.moveUp')}
								>
									↑
								</button>
								<button
									type="button"
									class="btn btn-outline-dark btn-sm"
									onclick={() => moveItem(index, index + 1)}
									disabled={index === bestSelling.length - 1}
									title={$t('admin.bestSelling.moveDown')}
									aria-label={$t('admin.bestSelling.moveDown')}
								>
									↓
								</button>
								<button
									type="button"
									class="btn btn-outline-danger btn-sm"
									onclick={() => removeItem(product._id)}
								>
									{$t('admin.bestSelling.remove')}
								</button>
							</div>
						</li>
					{/each}
				{:else}
					<li class="empty-state">{$t('admin.bestSelling.empty')}</li>
				{/if}
			</ul>
		</div>

		<div class="panel">
			<div class="panel-header">
				<h3>{$t('admin.bestSelling.addTitle')}</h3>
			</div>
			<div class="search-box">
				<input
					class="form-control"
					type="text"
					placeholder={$t('admin.bestSelling.searchPlaceholder')}
					bind:value={searchTerm}
				/>
			</div>
			<div class="available-list">
				{#if availableProducts().length}
					{#each availableProducts() as product (product._id)}
						<div
							class="available-item"
							draggable="true"
							ondragstart={(event) => handleDragStart(event, product, -1, 'available')}
							ondragend={handleDragEnd}
						>
							<img src={resolveThumb(product)} alt={product.product_name} />
							<div class="item-info">
								<div class="item-title">{product.product_name}</div>
								<div class="item-meta">
									<span>{product.product_type}</span>
									<span>{formatPrice(product.product_price)} {$t('common.currency')}</span>
								</div>
							</div>
							<button
								type="button"
								class="btn btn-outline-dark btn-sm"
								onclick={() => addItem(product)}
							>
								{$t('admin.bestSelling.add')}
							</button>
						</div>
					{/each}
				{:else}
					<div class="empty-state">{$t('admin.bestSelling.noResults')}</div>
				{/if}
			</div>
		</div>
	</form>
</section>

<style>
	.best-selling-page {
		display: grid;
		gap: 24px;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.page-header h2 {
		margin: 0;
	}

	.text-muted {
		color: #6c757d;
		margin: 0;
	}

	.best-selling-grid {
		display: grid;
		gap: 20px;
		grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
	}

	.panel {
		background: #fff;
		border: 1px solid rgba(0, 0, 0, 0.08);
		border-radius: 16px;
		padding: 20px;
		display: grid;
		gap: 16px;
		min-height: 520px;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}

	.panel-header h3 {
		margin: 0;
	}

	.panel-hint {
		margin: -6px 0 4px;
		color: #6c757d;
		font-size: 0.9rem;
	}

	.best-selling-list,
	.available-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 12px;
		max-height: 520px;
		overflow: auto;
		padding-right: 6px;
	}

	.best-selling-list.is-drop-target {
		min-height: 120px;
		border: 2px dashed rgba(31, 26, 20, 0.2);
		border-radius: 14px;
		padding: 12px;
		background: rgba(31, 26, 20, 0.03);
	}

	.best-selling-item,
	.available-item {
		display: grid;
		grid-template-columns: auto auto 1fr auto;
		align-items: center;
		gap: 12px;
		padding: 14px 12px;
		border-radius: 12px;
		border: 1px solid rgba(0, 0, 0, 0.08);
		background: #fafafa;
		margin-bottom: 6px;
	}

	.best-selling-item.is-dragging {
		opacity: 0.5;
	}

	.best-selling-item.is-drop-over {
		border-color: rgba(11, 135, 153, 0.6);
		box-shadow: 0 0 0 2px rgba(11, 135, 153, 0.2);
		background: #f5fbfc;
		transform: translateY(2px);
	}

	.available-item {
		grid-template-columns: auto 1fr auto;
	}

	.available-item[draggable='true'],
	.best-selling-item[draggable='true'] {
		cursor: grab;
	}

	.available-item[draggable='true']:active,
	.best-selling-item[draggable='true']:active {
		cursor: grabbing;
	}

	.best-selling-item img,
	.available-item img {
		width: 54px;
		height: 54px;
		border-radius: 10px;
		object-fit: cover;
		background: #fff;
		border: 1px solid rgba(0, 0, 0, 0.05);
	}

	.order-badge {
		width: 32px;
		height: 32px;
		border-radius: 10px;
		background: #1f1a14;
		color: #fff;
		display: grid;
		place-items: center;
		font-weight: 600;
	}

	.item-info {
		display: grid;
		gap: 4px;
	}

	.item-title {
		font-weight: 600;
	}

	.item-meta {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 0.85rem;
		color: #6c757d;
	}

	.item-actions {
		display: grid;
		gap: 6px;
	}

	.best-selling-item::before {
		content: '';
		display: block;
		grid-column: 1 / -1;
		height: 8px;
		margin-top: -8px;
	}

	.search-box {
		margin-bottom: 8px;
	}

	.empty-state {
		color: #6c757d;
		font-size: 0.95rem;
		text-align: center;
		padding: 12px 0;
	}

	@media (max-width: 768px) {
		.best-selling-grid {
			grid-template-columns: 1fr;
		}

		.panel {
			min-height: auto;
		}

		.best-selling-list,
		.available-list {
			max-height: none;
			padding-right: 0;
		}

		.best-selling-item {
			grid-template-columns: auto 1fr;
			grid-template-rows: auto auto;
		}

		.best-selling-item img {
			grid-row: span 2;
		}

		.item-actions {
			grid-column: 1 / -1;
			display: flex;
			justify-content: flex-end;
		}
	}
</style>
