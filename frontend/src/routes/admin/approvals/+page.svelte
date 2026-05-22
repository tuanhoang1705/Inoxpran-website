<script>
	import { browser } from '$app/environment';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { locale, t } from '$lib/i18n/admin/index.js';

	let { data, form } = $props();
	let lastToastKey = '';
	const pendingAdmins = $derived(data?.pendingAdmins ?? []);
	const apiError = $derived(form?.error || data?.apiError || '');
	const approvalRoleOptions = $derived.by(() =>
		$locale === 'en'
			? [
					{ value: 'ADMIN', label: 'Admin' },
					{ value: 'CHAT_MANAGER', label: 'Chat manager' },
					{ value: 'LEAD_MANAGER', label: 'Lead manager' },
					{ value: 'CONTACT_MANAGER', label: 'Contact manager' }
				]
			: [
					{ value: 'ADMIN', label: 'Quản trị' },
					{ value: 'CHAT_MANAGER', label: 'Quản lý chatbox' },
					{ value: 'LEAD_MANAGER', label: 'Quản lý lead' },
					{ value: 'CONTACT_MANAGER', label: 'Quản lý liên hệ' }
				]
	);

	const formatDate = (dateString) => {
		if (!dateString) return '--';
		const localeValue = $locale === 'en' ? 'en-US' : 'vi-VN';
		return new Date(dateString).toLocaleString(localeValue);
	};

	const handleApproveSubmit = (event) => {
		const note = prompt($t('admin.approvals.approvePrompt'));
		if (note === null) {
			event.preventDefault();
			return;
		}
		const input = event.currentTarget.querySelector('input[name="note"]');
		if (input) input.value = note.trim();
	};

	const handleRejectSubmit = (event) => {
		const reason = prompt($t('admin.approvals.rejectPrompt'));
		if (reason === null) {
			event.preventDefault();
			return;
		}
		const input = event.currentTarget.querySelector('input[name="reason"]');
		if (input) input.value = reason.trim();
	};

	$effect(() => {
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
	<title>{$t('admin.approvals.pageTitle')}</title>
</svelte:head>

<section class="admin-approvals">
	<header class="admin-header">
		<div>
			<h1>{$t('admin.approvals.title')}</h1>
			<p class="lead">{$t('admin.approvals.lede')}</p>
		</div>
	</header>

	{#if apiError}
		<div class="alert alert-danger mb-4">{apiError}</div>
	{/if}

	{#if pendingAdmins.length === 0}
		<div class="card border-0 shadow-sm p-5 text-center">
			<h5 class="text-black-50">{$t('admin.approvals.emptyTitle')}</h5>
			<p class="text-black-50 mb-0">{$t('admin.approvals.emptyDesc')}</p>
		</div>
	{:else}
		<div class="admin-table-container">
			<table class="admin-table">
				<thead>
					<tr>
						<th>{$t('admin.approvals.name')}</th>
						<th>{$t('admin.approvals.email')}</th>
						<th>{$t('admin.approvals.phone')}</th>
						<th>{$t('admin.approvals.created')}</th>
						<th>{$t('admin.approvals.roles')}</th>
						<th>{$t('admin.approvals.actions')}</th>
					</tr>
				</thead>
				<tbody>
					{#each pendingAdmins as admin (admin._id)}
						<tr>
							<td>
								<strong>{admin.name}</strong>
							</td>
							<td>{admin.email}</td>
							<td>{admin.phone || '--'}</td>
							<td class="small text-black-50">{formatDate(admin.createdAt)}</td>
							<td>
								<div class="approval-role-group" role="group" aria-label={$t('admin.approvals.roles')}>
									{#each approvalRoleOptions as role (role.value)}
										<label class="approval-role-option">
											<input
												type="checkbox"
												name="roles"
												value={role.value}
												form={`approve-${admin._id}`}
												checked={role.value === 'ADMIN'}
											/>
											<span>{role.label}</span>
										</label>
									{/each}
								</div>
								<div class="approval-role-help">{$t('admin.approvals.rolesHelp')}</div>
							</td>
							<td>
								<div class="action-buttons">
									<form
										id={`approve-${admin._id}`}
										method="post"
										action="?/approve"
										onsubmit={handleApproveSubmit}
									>
										<input type="hidden" name="adminId" value={admin._id} />
										<input type="hidden" name="note" value="" />
										<button
											class="btn btn-sm btn-success"
											type="submit"
											title={$t('admin.approvals.approveTitle')}
										>
											{$t('admin.approvals.approve')}
										</button>
									</form>
									<form method="post" action="?/reject" onsubmit={handleRejectSubmit}>
										<input type="hidden" name="adminId" value={admin._id} />
										<input type="hidden" name="reason" value="" />
										<button
											class="btn btn-sm btn-danger"
											type="submit"
											title={$t('admin.approvals.rejectTitle')}
										>
											{$t('admin.approvals.reject')}
										</button>
									</form>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<style>
	.admin-approvals {
		padding: 0;
		background: transparent;
		color: var(--admin-ink);
	}

	.admin-header {
		margin-bottom: 32px;
	}

	.admin-header h1 {
		font-size: 2rem;
		margin-bottom: 8px;
	}

	.lead {
		color: var(--admin-muted);
		max-width: 520px;
		margin-bottom: 0;
	}

	.admin-table-container {
		background: var(--admin-surface);
		border-radius: var(--admin-radius);
		padding: 24px;
		box-shadow: var(--admin-shadow);
		border: 1px solid var(--admin-border);
		overflow-x: auto;
	}

	.admin-table {
		width: 100%;
		border-collapse: collapse;
		margin: 0;
	}

	.admin-table thead {
		background: #f1f4f8;
		border-bottom: 1px solid var(--admin-border);
	}

	.admin-table th {
		padding: 16px;
		text-align: left;
		font-weight: 600;
		font-size: 0.75rem;
		color: var(--admin-ink);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.admin-table td {
		padding: 16px;
		border-bottom: 1px solid var(--admin-border);
		vertical-align: middle;
	}

	.admin-table tbody tr:hover {
		background: #f9fbfd;
	}

	.admin-table tbody tr:last-child td {
		border-bottom: none;
	}

	.action-buttons {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.approval-role-group {
		display: grid;
		gap: 8px;
	}

	.approval-role-option {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.92rem;
		color: var(--admin-ink);
	}

	.approval-role-option input {
		margin: 0;
	}

	.approval-role-help {
		margin-top: 8px;
		font-size: 0.78rem;
		color: var(--admin-muted);
		max-width: 240px;
	}

	.alert {
		padding: 16px;
		border-radius: 12px;
		margin-bottom: 24px;
	}

	.alert-danger {
		background: rgba(239, 68, 68, 0.08);
		color: #b91c1c;
		border: 1px solid rgba(239, 68, 68, 0.2);
	}

	@media (max-width: 768px) {
		.admin-header h1 {
			font-size: 1.5rem;
		}

		.admin-table-container {
			padding: 16px;
			font-size: 0.9rem;
		}

		.admin-table th,
		.admin-table td {
			padding: 12px 8px;
		}

		.action-buttons {
			flex-direction: column;
		}

		.btn {
			width: 100%;
		}
	}
</style>
