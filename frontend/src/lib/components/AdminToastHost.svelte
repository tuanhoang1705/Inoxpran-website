<script>
	import { toasts, removeToast } from '$lib/stores/adminToast.js';
	import { t } from '$lib/i18n/admin/index.js';

	const toneLabels = $derived({
		success: $t('admin.toast.success'),
		error: $t('admin.toast.error'),
		info: $t('admin.toast.info'),
		warning: $t('admin.toast.warning')
	});
</script>

<div class="admin-toast-host" aria-live="polite" aria-atomic="true">
	{#each $toasts as toast (toast.id)}
		<div class={`admin-toast ${toast.tone || 'info'}`} role="status">
			<div class="admin-toast-content">
				<div class="admin-toast-title">{toneLabels[toast.tone] || $t('admin.toast.title')}</div>
				<div class="admin-toast-message">{toast.message}</div>
			</div>
			<button
				class="admin-toast-close"
				type="button"
				aria-label={$t('admin.toast.closeLabel')}
				onclick={() => removeToast(toast.id)}
			>
				x
			</button>
		</div>
	{/each}
</div>

<style>
	.admin-toast-host {
		position: fixed;
		top: 1.25rem;
		right: 1.25rem;
		display: grid;
		gap: 12px;
		z-index: 2000;
		max-width: min(360px, calc(100vw - 2.5rem));
	}

	.admin-toast {
		background: #ffffff;
		border-radius: 14px;
		padding: 12px 14px;
		border: 1px solid #e6e2d9;
		border-left-width: 4px;
		box-shadow: 0 16px 32px rgba(0, 0, 0, 0.12);
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 12px;
		align-items: start;
	}

	.admin-toast.success {
		border-left-color: #2d8a45;
	}

	.admin-toast.error {
		border-left-color: #b23b3b;
	}

	.admin-toast.info {
		border-left-color: #2f6da1;
	}

	.admin-toast.warning {
		border-left-color: #b7832d;
	}

	.admin-toast-title {
		font-weight: 700;
		font-size: 0.9rem;
		margin-bottom: 4px;
	}

	.admin-toast-message {
		font-size: 0.95rem;
		line-height: 1.35;
		color: #2c2c2c;
	}

	.admin-toast-close {
		border: none;
		background: transparent;
		color: #666666;
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
		padding: 4px;
	}

	.admin-toast-close:hover {
		color: #1f1f1f;
	}

	@media (max-width: 576px) {
		.admin-toast-host {
			right: 0.75rem;
			left: 0.75rem;
			max-width: none;
		}
	}
</style>
