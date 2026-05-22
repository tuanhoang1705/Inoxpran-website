<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { pushToast } from '$lib/stores/adminToast.js';

	let { data, form } = $props();
	let lastToastKey = '';

	const comments = $derived(data?.items ?? []);
	const pagination = $derived(data?.pagination ?? { page: 1, limit: 20, total: 0 });
	const filters = $derived(data?.filters ?? { status: 'all', q: '', blogId: '' });
	const apiError = $derived(form?.error || data?.apiError || '');

	const statusOptions = [
		{ value: 'all', label: 'Tất cả' },
		{ value: 'pending', label: 'Chờ duyệt' },
		{ value: 'approved', label: 'Đã duyệt' },
		{ value: 'rejected', label: 'Đã ẩn' }
	];

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

	const formatDate = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		return date.toLocaleString('vi-VN');
	};

	const truncate = (value, limit = 120) => {
		const text = String(value || '').replace(/\s+/g, ' ').trim();
		if (text.length <= limit) return text;
		return `${text.slice(0, limit).trim()}...`;
	};

	const totalPages = $derived(Math.max(1, Math.ceil(pagination.total / pagination.limit)));

	const makePageLink = (page) => {
		const params = new URLSearchParams();
		if (filters?.q) params.set('q', filters.q);
		if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
		if (filters?.blogId) params.set('blogId', filters.blogId);
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
	<title>Quản lý bình luận | Inoxpran</title>
</svelte:head>

<section class="admin-comments">
	<header class="admin-header">
		<div>
			<h1>Quản lý bình luận</h1>
			<p class="lead">Duyệt và kiểm soát các bình luận blog trước khi hiển thị.</p>
		</div>
		<div class="summary">
			<strong>Tổng bình luận</strong>
			<span>{pagination.total}</span>
		</div>
	</header>

	{#if apiError}
		<div class="alert alert-danger mb-4">{apiError}</div>
	{/if}

	<form method="get" class="filter-bar">
		<div class="filter-field">
			<label for="comments-search">Tìm kiếm</label>
			<input
				id="comments-search"
				name="q"
				value={filters.q}
				class="form-control"
				placeholder="Từ khóa, email, nội dung..."
			/>
		</div>
		<div class="filter-field">
			<label for="comments-status">Trạng thái</label>
			<select id="comments-status" name="status" class="form-select">
				{#each statusOptions as option}
					<option value={option.value} selected={option.value === filters.status}>
						{option.label}
					</option>
				{/each}
			</select>
		</div>
		<div class="filter-field">
			<label for="comments-blog">Blog ID</label>
			<input
				id="comments-blog"
				name="blogId"
				value={filters.blogId}
				class="form-control"
				placeholder="Nhập blogId nếu cần"
			/>
		</div>
		<div class="filter-actions">
			<button class="btn btn-dark" type="submit">Lọc</button>
			<a class="btn btn-outline-dark" href="/admin/blogs/comments">Xóa lọc</a>
		</div>
	</form>

	{#if comments.length === 0}
		<div class="empty-state">
			<h4>Chưa có bình luận</h4>
			<p>Không tìm thấy bình luận phù hợp bộ lọc.</p>
		</div>
	{:else}
		<div class="comments-grid">
			{#each comments as comment (comment.id)}
				<article class="comment-card">
					<header>
						<div>
							<h3>{comment.authorName}</h3>
							<p class="muted">{comment.authorEmail}</p>
						</div>
						<span class={`status-badge ${statusBadge(comment.status)}`}>
							{statusOptions.find((s) => s.value === comment.status)?.label || comment.status}
						</span>
					</header>

					<div class="comment-meta">
						<div>
							<span>Ngày gửi</span>
							<strong>{formatDate(comment.createdAt)}</strong>
						</div>
						<div>
							<span>Blog</span>
							<strong>{comment.blogTitle || comment.blogSlug || '--'}</strong>
						</div>
						{#if comment.parentId}
							<div>
								<span>Loại</span>
								<strong>Trả lời</strong>
							</div>
						{/if}
					</div>

					<div class="comment-body">
						<p>{truncate(comment.content)}</p>
					</div>

					<div class="comment-actions">
						<form method="post" action="?/approve">
							<input type="hidden" name="commentId" value={comment.id} />
							<button
								class="btn btn-success"
								type="submit"
								disabled={comment.status === 'approved'}
							>
								Duyệt
							</button>
						</form>
						<form method="post" action="?/reject">
							<input type="hidden" name="commentId" value={comment.id} />
							<button
								class="btn btn-outline-secondary"
								type="submit"
								disabled={comment.status === 'rejected'}
							>
								Ẩn
							</button>
						</form>
						<form method="post" action="?/delete">
							<input type="hidden" name="commentId" value={comment.id} />
							<button class="btn btn-outline-danger" type="submit">Xóa</button>
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
				href={pagination.page <= 1 ? '#' : makePageLink(pagination.page - 1)}
				aria-disabled={pagination.page <= 1}
			>
				Trang trước
			</a>
			<span>Trang {pagination.page} / {totalPages}</span>
			<a
				class={`page-link ${pagination.page >= totalPages ? 'disabled' : ''}`}
				href={pagination.page >= totalPages ? '#' : makePageLink(pagination.page + 1)}
				aria-disabled={pagination.page >= totalPages}
			>
				Trang sau
			</a>
		</nav>
	{/if}
</section>

<style>
	.admin-comments {
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
		font-size: 2rem;
		margin-bottom: 8px;
	}

	.lead {
		color: var(--admin-muted);
		max-width: 520px;
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
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)) auto;
		gap: 16px;
		margin-bottom: 24px;
		align-items: end;
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

	.comments-grid {
		display: grid;
		gap: 20px;
	}

	.comment-card {
		background: var(--admin-card);
		border-radius: var(--admin-radius);
		padding: 24px;
		border: 1px solid var(--admin-border);
		box-shadow: var(--admin-shadow);
	}

	.comment-card header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		margin-bottom: 16px;
	}

	.comment-card h3 {
		margin: 0;
		font-size: 1.2rem;
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
		color: #9a581b;
	}

	.badge--approved {
		background: #def4e5;
		color: #1c6b3a;
	}

	.badge--rejected {
		background: #f2f2f2;
		color: #5d5d5d;
	}

	.comment-meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 12px;
		margin-bottom: 12px;
	}

	.comment-meta span {
		display: block;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--admin-muted);
	}

	.comment-meta strong {
		font-size: 0.95rem;
		color: var(--admin-ink);
	}

	.comment-body {
		background: #fdfbf8;
		border-radius: 12px;
		padding: 16px;
		border: 1px dashed #eadfce;
		margin-bottom: 16px;
	}

	.comment-body p {
		margin: 0;
		font-size: 0.95rem;
		color: #2d2620;
	}

	.comment-actions {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}

	.muted {
		color: var(--admin-muted);
	}

	.empty-state {
		background: #fff;
		border-radius: 16px;
		padding: 40px 24px;
		text-align: center;
		border: 1px solid var(--admin-border);
		box-shadow: var(--admin-shadow);
	}

	.pagination {
		display: flex;
		justify-content: center;
		gap: 16px;
		align-items: center;
		margin-top: 24px;
		font-weight: 600;
	}

	.page-link {
		padding: 6px 12px;
		border-radius: 8px;
		border: 1px solid var(--admin-border);
		text-decoration: none;
		color: var(--admin-ink);
	}

	.page-link.disabled {
		pointer-events: none;
		opacity: 0.5;
	}

	@media (max-width: 768px) {
		.admin-header {
			flex-direction: column;
		}

		.filter-bar {
			grid-template-columns: 1fr;
		}
	}
</style>
