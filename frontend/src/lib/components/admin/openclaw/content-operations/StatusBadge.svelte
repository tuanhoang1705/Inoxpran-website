<script>
	import { t } from '$lib/i18n/admin/index.js';
	import { statusTone, statusTranslationKey } from '$lib/contentOperations/contracts.js';

	let { status = 'unknown', label = '', tone = '' } = $props();
	const resolvedTone = $derived(tone || statusTone(status));
	const resolvedLabel = $derived(label || $t(statusTranslationKey(status)));
</script>

<span class={`co-status co-status--${resolvedTone}`}>
	<span class="co-status__dot" aria-hidden="true"></span>
	{resolvedLabel}
</span>

<style>
	.co-status {
		display: inline-flex;
		align-items: center;
		gap: 0.42rem;
		width: fit-content;
		max-width: 100%;
		padding: 0.38rem 0.62rem;
		border: 1px solid var(--admin-border);
		border-radius: 999px;
		background: #f7f9f8;
		color: var(--admin-muted);
		font-size: 0.72rem;
		font-weight: 800;
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.045em;
		overflow-wrap: anywhere;
	}

	.co-status__dot {
		width: 0.43rem;
		height: 0.43rem;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent);
		flex: none;
	}

	.co-status--good {
		border-color: color-mix(in srgb, var(--admin-success) 28%, white);
		background: color-mix(in srgb, var(--admin-success) 8%, white);
		color: var(--admin-success);
	}

	.co-status--warn {
		border-color: color-mix(in srgb, var(--admin-warning) 30%, white);
		background: color-mix(in srgb, var(--admin-warning) 9%, white);
		color: #a35f08;
	}

	.co-status--danger {
		border-color: color-mix(in srgb, var(--admin-danger) 25%, white);
		background: color-mix(in srgb, var(--admin-danger) 7%, white);
		color: var(--admin-danger);
	}
</style>
