<script>
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { locale, t } from '$lib/i18n/admin/index.js';

	let { data, form } = $props();
	let lastToastKey = '';

	const reviews = $derived(data?.items ?? []);
	const targets = $derived(data?.targets ?? []);
	const pagination = $derived(data?.pagination ?? { page: 1, limit: 20, total: 0 });
	const filters = $derived(data?.filters ?? { status: 'all', q: '' });
	const manualDraft = $derived(form?.manualDraft ?? {});
	const createError = $derived(form?.createError || '');
	const apiError = $derived(data?.apiError || '');
	const totalPages = $derived(Math.max(1, Math.ceil(pagination.total / pagination.limit)));

	const statusOptions = $derived([
		{ value: 'all', label: $t('admin.productReviews.filters.statusAll') },
		{ value: 'pending', label: $t('admin.productReviews.status.pending') },
		{ value: 'approved', label: $t('admin.productReviews.status.approved') },
		{ value: 'rejected', label: $t('admin.productReviews.status.rejected') }
	]);

	const statusBadge = (status) => {
		switch (status) {
			case 'approved':
				return 'badge--approved';
			case 'rejected':
				return 'badge--rejected';
			default:
				return 'badge--pending';
		}
	};

	const statusLabel = (status) =>
		statusOptions.find((option) => option.value === status)?.label || status;

	const formatDate = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		return date.toLocaleString($locale === 'en' ? 'en-US' : 'vi-VN');
	};

	const truncate = (value, limit = 220) => {
		const text = String(value || '').replace(/\s+/g, ' ').trim();
		if (text.length <= limit) return text;
		return `${text.slice(0, limit).trim()}...`;
	};

	const buildProductHref = (item) => {
		const slug = String(item?.productSlug || '').trim();
		if (!slug) return '#';
		return `/product/${slug}`;
	};

	const buildPageHref = (page) => {
		const params = new URLSearchParams();
		if (filters?.q) params.set('q', filters.q);
		if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
		params.set('page', String(page));
		params.set('limit', String(pagination.limit));
		return `?${params.toString()}`;
	};

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
	<title>{$t('admin.productReviews.pageTitle')} | Inoxpran</title>
</svelte:head>

<section class="admin-reviews">
	<header class="admin-header">
		<div>
			<h1>{$t('admin.productReviews.title')}</h1>
			<p class="lead">{$t('admin.productReviews.lede')}</p>
		</div>
		<div class="summary">
			<strong>{$t('admin.productReviews.summaryLabel')}</strong>
			<span>{pagination.total}</span>
		</div>
	</header>

	<section class="review-create-layout">
		<form method="post" action="?/create" class="review-create-card">
			<h2>{$t('admin.productReviews.create.title')}</h2>
			<p class="create-lede">{$t('admin.productReviews.create.lede')}</p>

			{#if createError}
				<div class="alert alert-danger">{createError}</div>
			{/if}

			<div class="create-grid">
				<div class="filter-field create-grid-full">
					<label for="review-product-lookup">{$t('admin.productReviews.create.productLookup')}</label>
					<input
						id="review-product-lookup"
						name="productLookup"
						class="form-control"
						list="review-product-targets"
						value={manualDraft.productLookup || ''}
						placeholder={$t('admin.productReviews.create.productLookupPlaceholder')}
					/>
					<datalist id="review-product-targets">
						{#each targets as target}
							<option value={target.lookup}>
								{target.productName} ({target.productSlug || target.id})
							</option>
						{/each}
					</datalist>
					<small>{$t('admin.productReviews.create.productLookupHint')}</small>
				</div>

				<div class="filter-field">
					<label for="review-author-name">{$t('admin.productReviews.create.authorName')}</label>
					<input
						id="review-author-name"
						name="authorName"
						class="form-control"
						value={manualDraft.authorName || ''}
					/>
				</div>

				<div class="filter-field">
					<label for="review-author-email">{$t('admin.productReviews.create.authorEmail')}</label>
					<input
						id="review-author-email"
						name="authorEmail"
						type="email"
						class="form-control"
						value={manualDraft.authorEmail || ''}
					/>
				</div>

				<div class="filter-field">
					<label for="review-rating-input">{$t('admin.productReviews.create.rating')}</label>
					<select
						id="review-rating-input"
						name="rating"
						class="form-select"
					>
						<option value="5" selected={(manualDraft.rating || '5') === '5'}>5/5</option>
						<option value="4" selected={manualDraft.rating === '4'}>4/5</option>
						<option value="3" selected={manualDraft.rating === '3'}>3/5</option>
						<option value="2" selected={manualDraft.rating === '2'}>2/5</option>
						<option value="1" selected={manualDraft.rating === '1'}>1/5</option>
					</select>
				</div>

				<div class="filter-field">
					<label for="review-status-input">{$t('admin.productReviews.create.status')}</label>
					<select
						id="review-status-input"
						name="status"
						class="form-select"
					>
						<option value="approved" selected={(manualDraft.status || 'approved') === 'approved'}>
							{$t('admin.productReviews.status.approved')}
						</option>
						<option value="pending" selected={manualDraft.status === 'pending'}>
							{$t('admin.productReviews.status.pending')}
						</option>
					</select>
				</div>

				<div class="filter-field create-grid-full">
					<label for="review-title-input">{$t('admin.productReviews.create.titleField')}</label>
					<input
						id="review-title-input"
						name="title"
						class="form-control"
						value={manualDraft.title || ''}
						placeholder={$t('admin.productReviews.create.titlePlaceholder')}
					/>
				</div>

				<div class="filter-field create-grid-full">
					<label for="review-content-input">{$t('admin.productReviews.create.content')}</label>
					<textarea
						id="review-content-input"
						name="content"
						rows="5"
						class="form-control"
						placeholder={$t('admin.productReviews.create.contentPlaceholder')}
					>{manualDraft.content || ''}</textarea>
				</div>

				<div class="filter-field">
					<label for="review-submitted-at">{$t('admin.productReviews.create.submittedAt')}</label>
					<input
						id="review-submitted-at"
						name="submittedAt"
						type="date"
						class="form-control"
						value={manualDraft.submittedAt || ''}
					/>
				</div>

				<label class="checkbox-field">
					<input
						type="checkbox"
						name="verifiedPurchase"
						value="true"
						checked={manualDraft.verifiedPurchase === 'true'}
					/>
					<span>{$t('admin.productReviews.create.verifiedPurchase')}</span>
				</label>
			</div>

			<div class="filter-actions">
				<button class="btn btn-dark" type="submit">{$t('admin.productReviews.create.submit')}</button>
			</div>
		</form>

		<aside class="review-targets-card">
			<h2>{$t('admin.productReviews.targets.title')}</h2>
			<p class="create-lede">{$t('admin.productReviews.targets.lede')}</p>
			{#if targets.length === 0}
				<p class="muted">{$t('admin.productReviews.targets.empty')}</p>
			{:else}
				<div class="target-list">
					{#each targets as target (target.id)}
						<article class="target-item">
							<div>
								<h3>{target.productName || '--'}</h3>
								<p class="muted">{target.productSlug || target.id}</p>
							</div>
							<div class="target-metrics">
								<span>
									{$t('admin.productReviews.targets.aggregateCount')}: <strong>{target.aggregateCount}</strong>
								</span>
								<span>
									{$t('admin.productReviews.targets.approvedReviewCount')}: <strong>{target.approvedReviewCount}</strong>
								</span>
							</div>
							<a class="btn btn-outline-dark btn-sm" href={buildProductHref(target)} target="_blank" rel="noreferrer">
								{$t('admin.productReviews.targets.openProduct')}
							</a>
						</article>
					{/each}
				</div>
			{/if}
		</aside>
	</section>

	{#if apiError}
		<div class="alert alert-danger mb-4">{apiError}</div>
	{/if}

	<form method="get" class="filter-bar">
		<div class="filter-field">
			<label for="review-search">{$t('admin.productReviews.filters.search')}</label>
			<input
				id="review-search"
				name="q"
				value={filters.q}
				class="form-control"
				placeholder={$t('admin.productReviews.filters.searchPlaceholder')}
			/>
		</div>
		<div class="filter-field">
			<label for="review-status">{$t('admin.productReviews.filters.status')}</label>
			<select id="review-status" name="status" class="form-select">
				{#each statusOptions as option}
					<option value={option.value} selected={option.value === filters.status}>
						{option.label}
					</option>
				{/each}
			</select>
		</div>
		<div class="filter-actions">
			<button class="btn btn-dark" type="submit">{$t('admin.productReviews.filters.apply')}</button>
			<a class="btn btn-outline-dark" href="/admin/reviews">{$t('admin.productReviews.filters.reset')}</a>
		</div>
	</form>

	{#if reviews.length === 0}
		<div class="empty-state">
			<h4>{$t('admin.productReviews.emptyTitle')}</h4>
			<p>{$t('admin.productReviews.emptyDesc')}</p>
		</div>
	{:else}
		<div class="reviews-grid">
			{#each reviews as review (review.id)}
				<article class="review-card">
					<header class="review-card-head">
						<div>
							<p class="review-product-kicker">{$t('admin.productReviews.fields.product')}</p>
							<h3>{review.productName || '--'}</h3>
							<p class="muted">{review.productSlug || review.productId}</p>
						</div>
						<span class={`status-badge ${statusBadge(review.status)}`}>
							{statusLabel(review.status)}
						</span>
					</header>

					<div class="review-meta">
						<div>
							<span>{$t('admin.productReviews.fields.customer')}</span>
							<strong>{review.authorName || '--'}</strong>
							<small>{review.authorEmail || '--'}</small>
						</div>
						<div>
							<span>{$t('admin.productReviews.fields.rating')}</span>
							<strong>{review.rating}/5</strong>
							<small>
								{review.verifiedPurchase
									? $t('admin.productReviews.fields.verified')
									: '--'}
							</small>
						</div>
						<div>
							<span>{$t('admin.productReviews.fields.submitted')}</span>
							<strong>{formatDate(review.createdAt)}</strong>
							<small>
								{$t('admin.productReviews.fields.reviewed')}: {formatDate(review.reviewedAt)}
							</small>
						</div>
					</div>

					{#if review.title}
						<h4 class="review-title">{review.title}</h4>
					{/if}
					<p class="review-body">{truncate(review.content)}</p>
					{#if review.images?.length}
						<div class="review-gallery">
							{#each review.images as image, index (`${review.id}-${image.path || image.url || index}`)}
								<a href={image.url} target="_blank" rel="noreferrer">
									<img src={image.url} alt={review.title || review.authorName || review.productName} />
								</a>
							{/each}
						</div>
					{/if}

					<div class="review-actions">
						<form method="post" action="?/approve">
							<input type="hidden" name="reviewId" value={review.id} />
							<button
								class="btn btn-success"
								type="submit"
								disabled={review.status === 'approved'}
							>
								{$t('admin.productReviews.actions.approve')}
							</button>
						</form>
						<form method="post" action="?/reject">
							<input type="hidden" name="reviewId" value={review.id} />
							<button
								class="btn btn-outline-secondary"
								type="submit"
								disabled={review.status === 'rejected'}
							>
								{$t('admin.productReviews.actions.reject')}
							</button>
						</form>
						<form method="post" action="?/delete">
							<input type="hidden" name="reviewId" value={review.id} />
							<button class="btn btn-outline-danger" type="submit">
								{$t('admin.productReviews.actions.delete')}
							</button>
						</form>
					</div>
				</article>
			{/each}
		</div>
	{/if}

	{#if totalPages > 1}
		<nav class="pagination">
			<a
				class={`page-link ${pagination.page <= 1 ? 'disabled' : ''}`}
				href={pagination.page <= 1 ? '#' : buildPageHref(pagination.page - 1)}
				aria-disabled={pagination.page <= 1}
			>
				{$t('admin.productReviews.pagination.prev')}
			</a>
			<span>{$t('admin.productReviews.pagination.page', { page: pagination.page, total: totalPages })}</span>
			<a
				class={`page-link ${pagination.page >= totalPages ? 'disabled' : ''}`}
				href={pagination.page >= totalPages ? '#' : buildPageHref(pagination.page + 1)}
				aria-disabled={pagination.page >= totalPages}
			>
				{$t('admin.productReviews.pagination.next')}
			</a>
		</nav>
	{/if}
</section>

<style>
	.admin-reviews {
		padding: 0;
		background: transparent;
		color: var(--admin-ink);
	}

	.admin-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 24px;
		margin-bottom: 28px;
	}

	.admin-header h1 {
		margin: 0 0 8px;
		font-size: 2rem;
	}

	.lead {
		color: var(--admin-muted);
		max-width: 640px;
	}

	.summary {
		background: var(--admin-surface);
		border-radius: 16px;
		padding: 12px 16px;
		border: 1px solid var(--admin-border);
		box-shadow: var(--admin-shadow);
		text-align: right;
	}

	.summary strong {
		display: block;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--admin-accent-strong);
	}

	.summary span {
		font-weight: 700;
		font-size: 1.4rem;
	}

	.filter-bar {
		display: grid;
		grid-template-columns: minmax(260px, 1.6fr) minmax(180px, 0.8fr) auto;
		gap: 16px;
		margin-bottom: 24px;
		align-items: end;
	}

	.review-create-layout {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
		gap: 20px;
		margin-bottom: 24px;
	}

	.review-create-card,
	.review-targets-card {
		background: var(--admin-card);
		border-radius: var(--admin-radius);
		padding: 24px;
		border: 1px solid var(--admin-border);
		box-shadow: var(--admin-shadow);
	}

	.review-create-card h2,
	.review-targets-card h2 {
		margin: 0 0 8px;
		font-size: 1.25rem;
	}

	.create-lede {
		margin: 0 0 18px;
		color: var(--admin-muted);
		line-height: 1.6;
	}

	.create-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px;
		margin-bottom: 18px;
	}

	.create-grid-full {
		grid-column: 1 / -1;
	}

	.checkbox-field {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding-top: 28px;
		font-weight: 600;
	}

	.checkbox-field input {
		width: 16px;
		height: 16px;
	}

	.target-list {
		display: grid;
		gap: 12px;
	}

	.target-item {
		display: grid;
		gap: 10px;
		padding: 14px 16px;
		border-radius: 14px;
		border: 1px solid var(--admin-border);
		background: rgba(255, 255, 255, 0.72);
	}

	.target-item h3 {
		margin: 0;
		font-size: 1rem;
	}

	.target-metrics {
		display: grid;
		gap: 4px;
		color: var(--admin-muted);
		font-size: 0.92rem;
	}

	.target-metrics strong {
		color: var(--admin-ink);
	}

	.filter-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.filter-actions {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}

	.reviews-grid {
		display: grid;
		gap: 20px;
	}

	.review-card {
		background: var(--admin-card);
		border-radius: var(--admin-radius);
		padding: 24px;
		border: 1px solid var(--admin-border);
		box-shadow: var(--admin-shadow);
	}

	.review-card-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 16px;
		margin-bottom: 16px;
	}

	.review-product-kicker {
		margin: 0 0 6px;
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--admin-accent-strong);
	}

	.review-card h3 {
		margin: 0;
		font-size: 1.2rem;
	}

	.muted {
		margin: 6px 0 0;
		color: var(--admin-muted);
	}

	.status-badge {
		padding: 6px 12px;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.badge--pending {
		background: #ffe7c7;
		color: #9a5b07;
	}

	.badge--approved {
		background: #d8f3df;
		color: #18794e;
	}

	.badge--rejected {
		background: #ffe1e1;
		color: #b42318;
	}

	.review-meta {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 16px;
		margin-bottom: 18px;
	}

	.review-meta div {
		display: grid;
		gap: 4px;
		padding: 14px 16px;
		background: rgba(255, 255, 255, 0.75);
		border: 1px solid var(--admin-border);
		border-radius: 14px;
	}

	.review-meta span,
	.review-meta small {
		color: var(--admin-muted);
	}

	.review-meta strong {
		font-size: 1rem;
	}

	.review-title {
		margin: 0 0 10px;
		font-size: 1rem;
	}

	.review-body {
		margin: 0;
		color: #23303d;
		line-height: 1.7;
	}

	.review-actions {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		margin-top: 18px;
	}

	.review-gallery {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
		gap: 10px;
		margin-top: 14px;
	}

	.review-gallery a {
		display: block;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid var(--admin-border);
		background: rgba(255, 255, 255, 0.9);
	}

	.review-gallery img {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
	}

	.empty-state {
		padding: 40px 24px;
		text-align: center;
		border-radius: var(--admin-radius);
		border: 1px dashed var(--admin-border);
		background: rgba(255, 255, 255, 0.55);
	}

	.pagination {
		margin-top: 24px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
	}

	.page-link.disabled {
		pointer-events: none;
		opacity: 0.45;
	}

	@media (max-width: 960px) {
		.admin-header,
		.review-card-head,
		.pagination {
			flex-direction: column;
			align-items: stretch;
		}

		.review-create-layout,
		.filter-bar,
		.review-meta {
			grid-template-columns: 1fr;
		}

		.summary {
			text-align: left;
		}

		.create-grid {
			grid-template-columns: 1fr;
		}

		.checkbox-field {
			padding-top: 0;
		}
	}
</style>
