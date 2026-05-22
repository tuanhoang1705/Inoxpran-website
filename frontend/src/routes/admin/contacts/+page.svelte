<script>
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { locale, t } from '$lib/i18n/admin/index.js';

	let { data, form } = $props();
	let lastToastKey = '';
	let selectedContactIds = $state(new Set());

	const contacts = $derived(data?.contacts ?? []);
	const pagination = $derived(data?.pagination ?? { page: 1, limit: 20, total: 0 });
	const filters = $derived(data?.filters ?? { status: '', q: '' });
	const apiError = $derived(form?.error || data?.apiError || '');
	const returnTo = $derived(data?.returnTo || '/admin/contacts');
	const visibleContactIds = $derived(
		contacts.map((contact) => String(contact?._id || '').trim()).filter(Boolean)
	);
	const selectedContactCount = $derived(selectedContactIds.size);
	const selectedVisibleContactCount = $derived(
		visibleContactIds.reduce((count, id) => count + (selectedContactIds.has(id) ? 1 : 0), 0)
	);
	const allVisibleContactsSelected = $derived(
		visibleContactIds.length > 0 && selectedVisibleContactCount === visibleContactIds.length
	);
	const selectedContactIdsPayload = $derived(JSON.stringify(Array.from(selectedContactIds)));

	const statusOptions = $derived([
		{ value: '', label: $t('admin.contacts.filters.statusAll') },
		{ value: 'new', label: $t('admin.contacts.status.new') },
		{ value: 'processing', label: $t('admin.contacts.status.processing') },
		{ value: 'contacted', label: $t('admin.contacts.status.contacted') },
		{ value: 'closed', label: $t('admin.contacts.status.closed') }
	]);

	const statusBadge = (status) => {
		switch (status) {
			case 'processing':
				return 'badge--processing';
			case 'contacted':
				return 'badge--contacted';
			case 'closed':
				return 'badge--closed';
			default:
				return 'badge--new';
		}
	};

	const formatDate = (dateString) => {
		if (!dateString) return '--';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return new Date(dateString).toLocaleString(localeValue);
	};

	const totalPages = $derived(Math.max(1, Math.ceil(pagination.total / pagination.limit)));

	const makePageLink = (page) => {
		const params = new URLSearchParams();
		if (filters?.q) params.set('q', filters.q);
		if (filters?.status) params.set('status', filters.status);
		params.set('page', String(page));
		params.set('limit', String(pagination.limit));
		return `?${params.toString()}`;
	};

	const toggleContactSelection = (contactId) => {
		const id = String(contactId || '').trim();
		if (!id) return;
		const next = new Set(selectedContactIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selectedContactIds = next;
	};

	const toggleSelectAllVisibleContacts = () => {
		const next = new Set(selectedContactIds);
		if (allVisibleContactsSelected) {
			for (const id of visibleContactIds) next.delete(id);
		} else {
			for (const id of visibleContactIds) next.add(id);
		}
		selectedContactIds = next;
	};

	const clearSelectedContacts = () => {
		selectedContactIds = new Set();
	};

	const confirmDeleteSelectedContacts = (event) => {
		if (selectedContactCount <= 0) {
			event.preventDefault();
			return;
		}
		const confirmed = window.confirm(
			$t('admin.contacts.bulk.confirmDeleteSelected', { count: selectedContactCount })
		);
		if (!confirmed) event.preventDefault();
	};

	const confirmDeleteAllContacts = (event) => {
		const confirmed = window.confirm($t('admin.contacts.bulk.confirmDeleteAll'));
		if (!confirmed) event.preventDefault();
	};

	$effect(() => {
		const visibleSet = new Set(visibleContactIds);
		const next = new Set();
		for (const id of selectedContactIds) {
			if (visibleSet.has(id)) next.add(id);
		}
		if (next.size !== selectedContactIds.size) {
			selectedContactIds = next;
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
	<title>{$t('admin.contacts.pageTitle')} | Inoxpran</title>
</svelte:head>

<section class="admin-contacts">
	<header class="admin-header">
		<div>
			<h1>{$t('admin.contacts.title')}</h1>
			<p class="lead">{$t('admin.contacts.lede')}</p>
		</div>
		<div class="summary">
			<strong>{$t('admin.contacts.summaryLabel')}</strong>
			<span>{$t('admin.contacts.summaryValue', { count: pagination.total })}</span>
		</div>
	</header>

	{#if apiError}
		<div class="alert alert-danger mb-4">{apiError}</div>
	{/if}

	<form method="get" class="filter-bar">
		<div class="filter-field">
			<label for="contacts-search">{$t('admin.contacts.filters.search')}</label>
			<input
				id="contacts-search"
				name="q"
				value={filters.q}
				class="form-control"
				placeholder={$t('admin.contacts.filters.searchPlaceholder')}
			/>
		</div>
		<div class="filter-field">
			<label for="contacts-status">{$t('admin.contacts.filters.status')}</label>
			<select id="contacts-status" name="status" class="form-select">
				{#each statusOptions as option}
					<option value={option.value} selected={option.value === filters.status}>
						{option.label}
					</option>
				{/each}
			</select>
		</div>
		<div class="filter-actions">
			<button class="btn btn-dark" type="submit">{$t('admin.contacts.filters.apply')}</button>
			<a class="btn btn-outline-dark" href="/admin/contacts">{$t('admin.contacts.filters.reset')}</a>
		</div>
	</form>

	<div class="bulk-toolbar">
		<div class="bulk-toolbar__left">
			<label class="bulk-check">
				<input
					type="checkbox"
					checked={allVisibleContactsSelected}
					disabled={contacts.length === 0}
					onclick={toggleSelectAllVisibleContacts}
				/>
				<span>{$t('admin.contacts.bulk.selectPage')}</span>
			</label>
			<span class="bulk-toolbar__summary">
				{$t('admin.contacts.bulk.selectedCount', { count: selectedContactCount })}
			</span>
			{#if selectedContactCount > 0}
				<button type="button" class="btn btn-sm btn-outline-dark" onclick={clearSelectedContacts}>
					{$t('admin.contacts.bulk.clearSelection')}
				</button>
			{/if}
		</div>
		<div class="bulk-toolbar__actions">
			<form method="post" action="?/deleteSelected">
				<input type="hidden" name="selected_ids" value={selectedContactIdsPayload} />
				<input type="hidden" name="return_to" value={returnTo} />
				<button
					type="submit"
					class="btn btn-sm btn-outline-danger"
					disabled={selectedContactCount === 0}
					onclick={confirmDeleteSelectedContacts}
				>
					{$t('admin.contacts.bulk.deleteSelected')}
				</button>
			</form>
			<form method="post" action="?/deleteAll">
				<input type="hidden" name="return_to" value={returnTo} />
				<input type="hidden" name="status" value={filters.status} />
				<input type="hidden" name="q" value={filters.q} />
				<button
					type="submit"
					class="btn btn-sm btn-danger"
					disabled={contacts.length === 0}
					onclick={confirmDeleteAllContacts}
				>
					{$t('admin.contacts.bulk.deleteAllFiltered')}
				</button>
			</form>
		</div>
	</div>

	{#if contacts.length === 0}
		<div class="empty-state">
			<h4>{$t('admin.contacts.emptyTitle')}</h4>
			<p>{$t('admin.contacts.emptyDesc')}</p>
		</div>
	{:else}
			<div class="contacts-grid">
				{#each contacts as contact (contact._id)}
					<article class="contact-card">
						<header>
							<label class="row-check">
								<input
									type="checkbox"
									checked={selectedContactIds.has(String(contact?._id || ''))}
									aria-label={$t('admin.contacts.bulk.selectItem')}
									onclick={() => toggleContactSelection(contact?._id)}
								/>
							</label>
							<div>
								<h3>{contact.fullName}</h3>
								<p class="muted">
								{contact.phone || contact.email || '--'}
							</p>
						</div>
						<span class={`status-badge ${statusBadge(contact.status)}`}>
							{$t(`admin.contacts.status.${contact.status || 'new'}`)}
						</span>
					</header>

					<div class="contact-meta">
						<div>
							<span>{$t('admin.contacts.fields.createdAt')}</span>
							<strong>{formatDate(contact.createdAt)}</strong>
						</div>
						<div>
							<span>{$t('admin.contacts.fields.company')}</span>
							<strong>{contact.company || '--'}</strong>
						</div>
						<div>
							<span>{$t('admin.contacts.fields.city')}</span>
							<strong>{contact.city || '--'}</strong>
						</div>
						<div>
							<span>{$t('admin.contacts.fields.assignedTo')}</span>
							<strong>
								{contact.assignedTo?.name || contact.assignedTo?.email || '--'}
							</strong>
						</div>
					</div>

					<div class="contact-details">
						<p><strong>{$t('admin.contacts.fields.email')}:</strong> {contact.email || '--'}</p>
						<p><strong>{$t('admin.contacts.fields.address')}:</strong> {contact.address || '--'}</p>
						<p>
							<strong>{$t('admin.contacts.fields.interest')}:</strong>
							{contact.productInterest || '--'}
						</p>
						<p>
							<strong>{$t('admin.contacts.fields.budget')}:</strong>
							{contact.budgetRange || '--'}
						</p>
						<p>
							<strong>{$t('admin.contacts.fields.timeline')}:</strong>
							{contact.timeline || '--'}
						</p>
						<p>
							<strong>{$t('admin.contacts.fields.preferredContact')}:</strong>
							{contact.preferredContactMethod || '--'}
							{contact.preferredContactTime ? ` · ${contact.preferredContactTime}` : ''}
						</p>
						<p>
							<strong>{$t('admin.contacts.fields.message')}:</strong>
							{contact.message}
						</p>
						<p class="small muted">
							{$t('admin.contacts.fields.sourcePage')}: {contact.sourcePage || '--'}
						</p>
					</div>

					<form method="post" action="?/update" class="contact-actions">
						<input type="hidden" name="contactId" value={contact._id} />
						<div class="field">
							<label>{$t('admin.contacts.fields.status')}</label>
							<select class="form-select" name="status">
								{#each statusOptions.slice(1) as option}
									<option value={option.value} selected={option.value === contact.status}>
										{option.label}
									</option>
								{/each}
							</select>
						</div>
						<div class="field">
							<label>{$t('admin.contacts.fields.internalNote')}</label>
							<textarea
								name="internalNote"
								rows="2"
								class="form-control"
								placeholder={$t('admin.contacts.fields.internalNotePlaceholder')}
							>{contact.internalNote || ''}</textarea>
						</div>
						<label class="assign-toggle">
							<input type="checkbox" name="assignToMe" />
							<span>{$t('admin.contacts.fields.assignToMe')}</span>
						</label>
						<button class="btn btn-primary" type="submit">
							{$t('admin.contacts.actions.update')}
						</button>
					</form>
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
				{$t('admin.contacts.pagination.prev')}
			</a>
			<span>{$t('admin.contacts.pagination.page', { page: pagination.page, total: totalPages })}</span>
			<a
				class={`page-link ${pagination.page >= totalPages ? 'disabled' : ''}`}
				href={pagination.page >= totalPages ? '#' : makePageLink(pagination.page + 1)}
				aria-disabled={pagination.page >= totalPages}
			>
				{$t('admin.contacts.pagination.next')}
			</a>
		</nav>
	{/if}
</section>

<style>
	.admin-contacts {
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

	.bulk-toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px 16px;
		flex-wrap: wrap;
		margin-bottom: 20px;
		padding: 12px 14px;
		background: var(--admin-surface);
		border-radius: var(--admin-radius);
		border: 1px solid var(--admin-border);
		box-shadow: var(--admin-shadow);
	}

	.bulk-toolbar__left {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.bulk-toolbar__summary {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--admin-ink);
	}

	.bulk-toolbar__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.bulk-toolbar__actions form {
		margin: 0;
	}

	.bulk-check,
	.row-check {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		color: var(--admin-ink);
	}

	.bulk-check input,
	.row-check input {
		width: 16px;
		height: 16px;
		margin: 0;
	}

	.contacts-grid {
		display: grid;
		gap: 20px;
	}

	.contact-card {
		background: var(--admin-surface);
		border-radius: var(--admin-radius);
		padding: 24px;
		border: 1px solid var(--admin-border);
		box-shadow: var(--admin-shadow);
	}

	.contact-card header {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: start;
		gap: 16px;
		margin-bottom: 16px;
	}

	.contact-card h3 {
		margin: 0;
		font-size: 1.3rem;
		overflow-wrap: anywhere;
	}

	.status-badge {
		padding: 6px 12px;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.badge--new {
		background: rgba(245, 158, 11, 0.18);
		color: #b45309;
	}

	.badge--processing {
		background: rgba(37, 99, 235, 0.16);
		color: #1d4ed8;
	}

	.badge--contacted {
		background: rgba(22, 163, 74, 0.18);
		color: #15803d;
	}

	.badge--closed {
		background: rgba(148, 163, 184, 0.25);
		color: #475569;
	}

	.contact-meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 12px;
		margin-bottom: 12px;
	}

	.contact-meta span {
		display: block;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--admin-muted);
	}

	.contact-meta strong {
		font-size: 0.95rem;
		color: var(--admin-ink);
	}

	.contact-details {
		background: #f8fafc;
		border-radius: 12px;
		padding: 16px;
		border: 1px dashed rgba(148, 163, 184, 0.4);
		margin-bottom: 16px;
	}

	.contact-details p {
		margin: 0 0 6px;
		font-size: 0.9rem;
		color: var(--admin-ink);
	}

	.contact-details p:last-child {
		margin-bottom: 0;
	}

	.muted {
		color: var(--admin-muted);
	}

	.contact-actions {
		display: grid;
		gap: 12px;
	}

	.assign-toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		color: var(--admin-ink);
	}

	.btn-primary {
		background: var(--admin-accent);
		border-color: var(--admin-accent);
		color: #fff;
	}

	.btn-primary:hover {
		background: var(--admin-accent-strong);
		border-color: var(--admin-accent-strong);
	}

	.empty-state {
		background: var(--admin-surface);
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

		.contact-card header {
			grid-template-columns: 1fr;
			gap: 10px;
		}
	}
</style>
