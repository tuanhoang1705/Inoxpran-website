<script>
	import { beforeNavigate, afterNavigate } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { t } from '$lib/i18n/index.js';

	let isLoading = $state(false);
	let showTimer;

	const shouldTrackNavigation = (navigation) => {
		if (typeof window === 'undefined') return false;
		if (navigation?.type === 'popstate') return false;
		const to = navigation?.to;
		if (!to?.url) return false;
		const protocol = String(to.url.protocol || '').toLowerCase();
		if (protocol !== 'http:' && protocol !== 'https:') return false;
		if (to.url.origin !== window.location.origin) return false;
		return Boolean(to.route?.id);
	};

	const start = () => {
		clearTimeout(showTimer);
		showTimer = setTimeout(() => {
			isLoading = true;
		}, 120);
	};

	const stop = () => {
		clearTimeout(showTimer);
		isLoading = false;
	};

	beforeNavigate((navigation) => {
		if (!shouldTrackNavigation(navigation)) {
			stop();
			return;
		}
		start();
	});

	afterNavigate(() => {
		stop();
	});

	onDestroy(() => {
		clearTimeout(showTimer);
	});
</script>

{#if isLoading}
	<div class="route-loader" aria-live="polite" aria-busy="true">
		<div class="route-loader-panel">
			<div class="route-loader-spinner" aria-hidden="true"></div>
			<div class="route-loader-label">{$t('common.loading')}</div>
		</div>
	</div>
{/if}

<style>
	.route-loader {
		position: fixed;
		inset: 0;
		z-index: 2000;
		display: grid;
		place-items: center;
		background: rgba(255, 255, 255, 0.75);
		backdrop-filter: blur(6px);
	}

	.route-loader-panel {
		display: grid;
		justify-items: center;
		gap: 12px;
		padding: 18px 22px;
		border-radius: 16px;
		background: #1f1a14;
		color: #fff7e8;
		box-shadow: 0 22px 45px rgba(15, 20, 24, 0.18);
		text-transform: uppercase;
		letter-spacing: 0.14em;
		font-size: 0.7rem;
	}

	.route-loader-spinner {
		width: 34px;
		height: 34px;
		border-radius: 999px;
		border: 3px solid rgba(255, 247, 232, 0.3);
		border-top-color: #fff7e8;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (hover: none) and (pointer: coarse) {
		.route-loader {
			pointer-events: none;
			backdrop-filter: none;
			background: rgba(255, 255, 255, 0.9);
		}
	}
</style>
