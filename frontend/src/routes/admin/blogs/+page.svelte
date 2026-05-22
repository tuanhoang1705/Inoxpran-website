<script>
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { locale, t } from '$lib/i18n/admin/index.js';

	let { data } = $props();

	const categories = $derived.by(() => [
		{ value: 'all', label: $t('admin.blogs.filters.categoryAll') },
		{ value: 'guide', label: $t('blog.categoryGuide') },
		{ value: 'care', label: $t('blog.categoryCare') },
		{ value: 'knowledge', label: $t('blog.categoryKnowledge') },
		{ value: 'trend', label: $t('blog.categoryTrend') },
		{ value: 'product', label: $t('blog.categoryProduct') },
		{ value: 'design', label: $t('blog.categoryDesign') }
	]);

	const items = $derived(Array.isArray(data?.items) ? data.items : []);
	const pagination = $derived(data?.pagination ?? null);
	const totalPages = $derived.by(() => {
		const total = Number(pagination?.total || 0);
		const limit = Number(pagination?.limit || 20);
		return Math.max(1, Math.ceil(total / limit));
	});
	const totalItems = $derived.by(() => Number(pagination?.total || items.length || 0));

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

	const buildPageHref = (targetPage) => {
		const url = new URL($page.url);
		url.searchParams.set('page', String(targetPage));
		return `${url.pathname}${url.search}`;
	};

	const statusLabel = (item) =>
		item?.isPublished ? $t('admin.blogs.status.published') : $t('admin.blogs.status.draft');

	const statusTone = (item) => (item?.isPublished ? 'status-published' : 'status-draft');

	const getCategoryLabel = (categoryKey) =>
		categories.find((category) => category.value === categoryKey)?.label || '--';

	const getViews = (item) => Number(item?.views || 0);

	const getReadTime = (item) => $t('blog.readTime', { minutes: item?.readTimeMinutes || 1 });

	const getUpdatedLabel = (item) => formatDate(item?.updatedAt || item?.createdAt);

	const getSlug = (item) => String(item?.slug || '').trim();

	const truncate = (value, limit = 180) => {
		const text = String(value || '').replace(/\s+/g, ' ').trim();
		if (!text) return '';
		return text.length <= limit ? text : `${text.slice(0, limit).trim()}...`;
	};

	const hasPrevPage = $derived.by(() => Boolean(pagination && pagination.page > 1));
	const hasNextPage = $derived.by(() => Boolean(pagination && pagination.page < totalPages));
</script>

<svelte:head>
	<title>{$t('admin.blogs.title')} | Inoxpran</title>
</svelte:head>

<section class="admin-blogs">
	<header class="admin-blogs-header card-shell">
		<div>
			<h1>{$t('admin.blogs.title')}</h1>
			<p class="lead">{$t('admin.blogs.lede')}</p>
		</div>
		<div class="header-actions">
			<a class="btn btn-outline-dark" href={resolve('/admin/blogs/comments')}>
				{$t('admin.blogs.manageComments')}
			</a>
			<a class="btn btn-dark" href={resolve('/admin/blogs/new')}>{$t('admin.blogs.newPost')}</a>
		</div>
	</header>

	{#if data?.apiError}
		<div class="alert alert-danger mb-0">{data.apiError}</div>
	{/if}

	<form method="get" class="filter-card card-shell">
		<div class="filter-grid">
			<div class="field field-search">
				<label for="admin-blog-search">{$t('common.search')}</label>
				<input
					id="admin-blog-search"
					type="text"
					class="form-control"
					name="q"
					value={data?.filters?.q || ''}
					placeholder={$t('admin.blogs.filters.searchPlaceholder')}
				/>
			</div>

			<div class="field">
				<label for="admin-blog-status">{$t('admin.blogs.table.status')}</label>
				<select
					id="admin-blog-status"
					class="form-select"
					name="status"
					value={data?.filters?.status || 'all'}
				>
					<option value="all">{$t('admin.blogs.filters.statusAll')}</option>
					<option value="published">{$t('admin.blogs.filters.statusPublished')}</option>
					<option value="draft">{$t('admin.blogs.filters.statusDraft')}</option>
				</select>
			</div>

			<div class="field">
				<label for="admin-blog-category">{$t('admin.blogs.table.category')}</label>
				<select
					id="admin-blog-category"
					class="form-select"
					name="category"
					value={data?.filters?.category || 'all'}
				>
					{#each categories as category (category.value)}
						<option value={category.value}>{category.label}</option>
					{/each}
				</select>
			</div>

			<div class="field field-actions">
				<button class="btn btn-outline-dark" type="submit">{$t('admin.blogs.filters.apply')}</button>
			</div>
		</div>
	</form>

	<div class="toolbar card-shell">
		<div class="toolbar__summary">
			<strong>{totalItems}</strong>
			<span>{$t('admin.blogs.title')}</span>
		</div>
		{#if pagination}
			<div class="toolbar__page">
				{$t('common.pageLabel', { page: pagination.page })} / {totalPages}
			</div>
		{/if}
	</div>

	{#if items.length === 0}
		<div class="empty-state card-shell">
			<h4>{$t('admin.blogs.empty')}</h4>
			<p>{$t('admin.blogs.lede')}</p>
		</div>
	{:else}
		<div class="blogs-list">
			{#each items as item (item._id)}
				<article class="blog-card card-shell">
					<div class="blog-card__head">
						<div class="blog-card__title-wrap">
							<div class="eyebrow">{$t('admin.blogs.table.title')}</div>
							<h3 class="blog-title break-anywhere">{item?.title || '--'}</h3>
							<div class="blog-slug break-anywhere">
								{#if getSlug(item)}
									/{getSlug(item)}
								{:else}
									--
								{/if}
							</div>
						</div>
						<div class="blog-card__status">
							<span class={`status-chip ${statusTone(item)}`}>{statusLabel(item)}</span>
						</div>
					</div>

					<div class="blog-meta-grid">
						<div class="meta-box">
							<span>{$t('admin.blogs.table.category')}</span>
							<strong>{getCategoryLabel(item?.categoryKey)}</strong>
						</div>
						<div class="meta-box">
							<span>{$t('admin.blogs.table.updated')}</span>
							<strong>{getUpdatedLabel(item)}</strong>
						</div>
						<div class="meta-box">
							<span>{$t('admin.blogs.table.views')}</span>
							<strong>{getViews(item)}</strong>
						</div>
						<div class="meta-box">
							<span>{$t('admin.blogs.table.readTime')}</span>
							<strong>{getReadTime(item)}</strong>
						</div>
					</div>

					{#if item?.excerpt}
						<p class="blog-excerpt">{truncate(item.excerpt)}</p>
					{/if}

					<div class="blog-actions">
						<div class="blog-actions__left">
							<a class="btn btn-sm btn-outline-dark" href={resolve(`/admin/blogs/${item._id}`)}>
								{$t('admin.blogs.edit')}
							</a>
							{#if item?.isPublished && getSlug(item)}
								<a
									class="btn btn-sm btn-outline-secondary"
									href={resolve(`/blog/${getSlug(item)}`)}
									target="_blank"
									rel="noreferrer"
								>
									{$t('common.view')}
								</a>
							{/if}
						</div>

						<div class="blog-actions__right">
							{#if item?.isPublished}
								<form method="post" action="?/unpublish">
									<input type="hidden" name="blog_id" value={item._id} />
									<button class="btn btn-sm btn-outline-secondary" type="submit">
										{$t('admin.blogEditor.unpublish')}
									</button>
								</form>
							{:else}
								<form method="post" action="?/publish">
									<input type="hidden" name="blog_id" value={item._id} />
									<button class="btn btn-sm btn-success" type="submit">
										{$t('admin.blogEditor.publish')}
									</button>
								</form>
							{/if}
						</div>
					</div>
				</article>
			{/each}
		</div>
	{/if}

	{#if pagination}
		<nav class="pagination-wrap" aria-label={$t('admin.blogs.title')}>
			<a
				class={`page-link ${hasPrevPage ? '' : 'disabled'}`}
				href={resolve(buildPageHref(Math.max(pagination.page - 1, 1)))}
				aria-disabled={!hasPrevPage}
			>
				{$t('common.paginationPrev')}
			</a>
			<span class="page-summary">{$t('common.pageLabel', { page: pagination.page })} / {totalPages}</span>
			<a
				class={`page-link ${hasNextPage ? '' : 'disabled'}`}
				href={resolve(buildPageHref(Math.min(pagination.page + 1, totalPages)))}
				aria-disabled={!hasNextPage}
			>
				{$t('common.paginationNext')}
			</a>
		</nav>
	{/if}
</section>

<style>
	.admin-blogs {
		display: grid;
		gap: 16px;
		color: var(--admin-ink);
	}

	.card-shell {
		background: #fff;
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius);
		box-shadow: var(--admin-shadow);
	}

	.admin-blogs-header {
		padding: 18px;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 14px;
		flex-wrap: wrap;
	}

	.admin-blogs-header h1 {
		margin: 0 0 6px;
		font-size: 2rem;
	}

	.admin-blogs-header .lead {
		margin: 0;
		color: var(--admin-muted);
		max-width: 760px;
	}

	.header-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.filter-card {
		padding: 14px;
	}

	.filter-grid {
		display: grid;
		grid-template-columns: 1.8fr 1fr 1fr auto;
		gap: 12px;
		align-items: end;
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
		justify-content: flex-end;
	}

	.field-actions .btn {
		white-space: nowrap;
	}

	.toolbar {
		padding: 12px 14px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.toolbar__summary {
		display: inline-flex;
		align-items: baseline;
		gap: 8px;
	}

	.toolbar__summary strong {
		font-size: 1.1rem;
	}

	.toolbar__summary span,
	.toolbar__page {
		color: #6d6256;
		font-size: 0.9rem;
	}

	.empty-state {
		padding: 36px 20px;
		text-align: center;
	}

	.empty-state h4 {
		margin: 0 0 8px;
	}

	.empty-state p {
		margin: 0;
		color: var(--admin-muted);
	}

	.blogs-list {
		display: grid;
		gap: 14px;
	}

	.blog-card {
		padding: 14px;
		display: grid;
		gap: 12px;
		overflow: hidden;
	}

	.blog-card__head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}

	.blog-card__title-wrap {
		min-width: 0;
	}

	.eyebrow {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #7e7264;
	}

	.blog-title {
		margin: 4px 0 0;
		font-size: 1rem;
		line-height: 1.35;
		font-weight: 700;
		color: #272018;
	}

	.blog-slug {
		margin-top: 4px;
		font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
		font-size: 0.78rem;
		color: #6f6458;
	}

	.blog-card__status {
		flex-shrink: 0;
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

	.status-chip.status-published {
		background: rgba(45, 138, 69, 0.18);
		color: #2d8a45;
	}

	.status-chip.status-draft {
		background: rgba(255, 196, 87, 0.24);
		color: #8a5a00;
	}

	.blog-meta-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 10px;
	}

	.meta-box {
		border: 1px solid #efe9df;
		background: #fbf8f3;
		border-radius: 12px;
		padding: 10px;
		display: grid;
		gap: 4px;
		min-width: 0;
	}

	.meta-box span {
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #7e7264;
		font-weight: 700;
	}

	.meta-box strong {
		font-size: 0.88rem;
		line-height: 1.35;
		color: #2d2620;
		word-break: break-word;
	}

	.blog-excerpt {
		margin: 0;
		color: #564b3f;
		line-height: 1.45;
		background: #fffaf2;
		border: 1px dashed #eadfcd;
		border-radius: 12px;
		padding: 10px 12px;
	}

	.blog-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.blog-actions__left,
	.blog-actions__right {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}

	.blog-actions form {
		margin: 0;
	}

	.pagination-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 14px;
		flex-wrap: wrap;
		margin-top: 2px;
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

	.page-summary {
		color: #6d6256;
		font-weight: 600;
	}

	.break-anywhere {
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	@media (max-width: 1100px) {
		.filter-grid {
			grid-template-columns: 1fr 1fr;
		}

		.field-search {
			grid-column: 1 / -1;
		}

		.field-actions {
			grid-column: 1 / -1;
			justify-content: stretch;
		}

		.field-actions .btn {
			width: 100%;
		}
	}

	@media (max-width: 768px) {
		.admin-blogs-header h1 {
			font-size: 1.55rem;
		}

		.filter-grid {
			grid-template-columns: 1fr;
		}

		.blog-card__head {
			flex-direction: column;
		}

		.blog-card__status {
			width: 100%;
		}

		.blog-actions {
			flex-direction: column;
			align-items: stretch;
		}

		.blog-actions__left,
		.blog-actions__right {
			width: 100%;
		}

		.blog-actions__left :global(.btn),
		.blog-actions__right :global(.btn),
		.blog-actions__right form {
			flex: 1 1 auto;
		}

		.blog-actions__left :global(.btn),
		.blog-actions__right :global(.btn) {
			width: 100%;
		}
	}

	@media (max-width: 576px) {
		.header-actions {
			width: 100%;
		}

		.header-actions .btn {
			width: 100%;
		}

		.blog-meta-grid {
			grid-template-columns: 1fr;
		}

		.page-link {
			width: 100%;
			text-align: center;
		}

		.pagination-wrap {
			align-items: stretch;
		}
	}
</style>
