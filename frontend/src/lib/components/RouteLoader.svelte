<script>
	import { beforeNavigate, afterNavigate } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { t } from '$lib/i18n/index.js';
	import {
		endFullPageNavigation,
		fullPageNavigationPending
	} from '$lib/stores/navigationProgress.js';

	let isLoading = $state(false);
	let showTimer;

	// Two sources, deliberately different in timing. A client-side navigation is
	// debounced so a fast one does not flash the overlay; a full page navigation is
	// shown at once, because there the delay being covered is the whole point.
	const visible = $derived(isLoading || $fullPageNavigationPending);

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
		// A client-side navigation can interrupt one that was about to leave the page
		// (a link tapped while the previous target was still resolving), so the full
		// page flag has to be cleared here too or the overlay would outlive it.
		endFullPageNavigation();
	});

	onDestroy(() => {
		clearTimeout(showTimer);
	});
</script>

{#if visible}
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
		/* The site header sits at 999999 and the mobile menu lives inside it, so
		   at 2000 this spinner rendered underneath an open menu: tapping a menu
		   item looked like nothing happened for the two or three seconds the
		   next page took to load. Nothing may cover the only feedback the tap
		   produces. */
		z-index: 1000000;
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
