<script>
	import { onDestroy, onMount } from 'svelte';
	import { locale } from '$lib/i18n/admin/index.js';
	import { openClawActivityStore } from '$lib/openclaw/activityCenter.js';

	let open = $state(false);
	let toast = $state(null);
	let toastTimer = null;
	let lastToastKey = '';
	const isEn = $derived($locale === 'en');
	const activities = $derived($openClawActivityStore);
	const runningCount = $derived(
		activities.filter((activity) => activity.status === 'running').length
	);
	const unreadCount = $derived(activities.filter((activity) => activity.unread).length);

	const copy = $derived({
		title: isEn ? 'OpenClaw activity' : 'Hoạt động OpenClaw',
		running: isEn ? 'Running' : 'Đang chạy',
		succeeded: isEn ? 'Succeeded' : 'Thành công',
		failed: isEn ? 'Failed' : 'Thất bại',
		empty: isEn ? 'No activity in this browser session.' : 'Chưa có hoạt động trong phiên này.',
		clear: isEn ? 'Clear completed' : 'Xoá mục đã xong',
		close: isEn ? 'Close activity center' : 'Đóng trung tâm hoạt động',
		open: isEn ? 'Open activity center' : 'Mở trung tâm hoạt động',
		justNow: isEn ? 'just now' : 'vừa xong'
	});

	const formatTime = (value) => {
		const date = new Date(Number(value));
		if (Number.isNaN(date.getTime())) return copy.justNow;
		return new Intl.DateTimeFormat(isEn ? 'en-GB' : 'vi-VN', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		}).format(date);
	};

	const statusLabel = (status) => copy[status] || copy.succeeded;

	const dismissToast = () => {
		if (toast?.key) openClawActivityStore.markRead(toast.key);
		toast = null;
		if (toastTimer) window.clearTimeout(toastTimer);
		toastTimer = null;
	};

	$effect(() => {
		const next = activities.find(
			(activity) =>
				activity.unread && activity.status !== 'running' && activity.key !== lastToastKey
		);
		if (!next || typeof window === 'undefined') return;
		lastToastKey = next.key;
		toast = next;
		if (toastTimer) window.clearTimeout(toastTimer);
		toastTimer = window.setTimeout(dismissToast, 6500);
	});

	onMount(() => {
		openClawActivityStore.hydrate();
	});
	onDestroy(() => {
		if (toastTimer) window.clearTimeout(toastTimer);
	});
</script>

<div class="activity-dock" class:activity-dock--open={open}>
	{#if toast}
		<div class="activity-toast activity-toast--{toast.status}" role="status" aria-live="polite">
			<span class="activity-dot" aria-hidden="true"></span>
			<div>
				<strong>{toast.title}</strong>
				<p>{toast.message || statusLabel(toast.status)}</p>
			</div>
			<button type="button" onclick={dismissToast} aria-label={copy.close}>×</button>
		</div>
	{/if}

	{#if open}
		<section class="activity-panel" aria-label={copy.title}>
			<header>
				<div>
					<p>LIVE / SESSION</p>
					<h2>{copy.title}</h2>
				</div>
				<button
					type="button"
					class="activity-close"
					onclick={() => (open = false)}
					aria-label={copy.close}>×</button
				>
			</header>

			<div class="activity-summary">
				<span class:activity-summary--active={runningCount > 0}>
					<i aria-hidden="true"></i>{runningCount}
					{copy.running.toLowerCase()}
				</span>
				{#if activities.some((activity) => activity.status !== 'running')}
					<button type="button" onclick={() => openClawActivityStore.clearCompleted()}
						>{copy.clear}</button
					>
				{/if}
			</div>

			<div class="activity-list">
				{#if activities.length}
					{#each activities as activity (activity.key)}
						<article class="activity-item activity-item--{activity.status}">
							<span class="activity-rail" aria-hidden="true"></span>
							<div class="activity-item__body">
								<div>
									<strong>{activity.title}</strong>
									<time datetime={new Date(activity.updatedAt).toISOString()}
										>{formatTime(activity.updatedAt)}</time
									>
								</div>
								<p>{activity.message || statusLabel(activity.status)}</p>
								<span class="activity-state">
									<i aria-hidden="true"></i>{statusLabel(activity.status)}
								</span>
							</div>
						</article>
					{/each}
				{:else}
					<p class="activity-empty">{copy.empty}</p>
				{/if}
			</div>
		</section>
	{/if}

	<button
		type="button"
		class="activity-trigger"
		class:activity-trigger--busy={runningCount > 0}
		onclick={() => (open = !open)}
		aria-expanded={open}
		aria-label={open ? copy.close : copy.open}
	>
		<span class="activity-trigger__pulse" aria-hidden="true"></span>
		<span>{runningCount > 0 ? `${runningCount} ${copy.running}` : copy.title}</span>
		{#if unreadCount > 0}<b aria-label={`${unreadCount}`}>{unreadCount}</b>{/if}
	</button>
</div>

<style>
	.activity-dock {
		--activity-ink: #17342f;
		--activity-teal: #0c8077;
		--activity-success: #19734d;
		--activity-danger: #c33c36;
		position: fixed;
		right: clamp(0.75rem, 2vw, 1.5rem);
		bottom: clamp(0.75rem, 2vw, 1.5rem);
		z-index: 80;
		display: grid;
		justify-items: end;
		gap: 0.65rem;
		font-family: inherit;
	}

	.activity-trigger {
		min-height: 42px;
		max-width: min(88vw, 320px);
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid color-mix(in srgb, var(--activity-teal) 45%, #d7e3df);
		border-radius: 999px;
		background: rgba(250, 253, 252, 0.96);
		box-shadow: 0 10px 32px rgba(18, 55, 48, 0.16);
		color: var(--activity-ink);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 700;
		cursor: pointer;
		backdrop-filter: blur(12px);
	}

	.activity-trigger:hover,
	.activity-trigger:focus-visible {
		border-color: var(--activity-teal);
		transform: translateY(-1px);
	}

	.activity-trigger b {
		display: grid;
		min-width: 1.25rem;
		height: 1.25rem;
		place-items: center;
		border-radius: 999px;
		background: var(--activity-danger);
		color: white;
		font-size: 0.66rem;
	}

	.activity-trigger__pulse,
	.activity-summary i,
	.activity-state i,
	.activity-dot {
		width: 0.55rem;
		height: 0.55rem;
		flex: 0 0 auto;
		border-radius: 50%;
		background: #95aaa5;
	}

	.activity-trigger--busy .activity-trigger__pulse,
	.activity-summary--active i {
		background: var(--activity-teal);
		box-shadow: 0 0 0 5px rgba(12, 128, 119, 0.12);
		animation: activity-pulse 1.8s ease-out infinite;
	}

	.activity-panel {
		width: min(92vw, 390px);
		max-height: min(72vh, 650px);
		display: grid;
		grid-template-rows: auto auto minmax(0, 1fr);
		overflow: hidden;
		border: 1px solid #d8e3df;
		border-radius: 18px;
		background: rgba(253, 254, 253, 0.98);
		box-shadow: 0 24px 70px rgba(16, 48, 42, 0.22);
		color: var(--activity-ink);
		animation: activity-enter 160ms ease-out;
	}

	.activity-panel header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 1rem 1.05rem 0.85rem;
		border-bottom: 1px solid #e4ebe8;
		background:
			linear-gradient(110deg, rgba(12, 128, 119, 0.08), transparent 60%),
			repeating-linear-gradient(90deg, transparent 0 19px, rgba(23, 52, 47, 0.025) 20px);
	}

	.activity-panel header p {
		margin: 0 0 0.2rem;
		color: var(--activity-teal);
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.16em;
	}

	.activity-panel h2 {
		margin: 0;
		font-size: 1rem;
		letter-spacing: -0.01em;
	}

	.activity-close,
	.activity-toast button {
		border: 0;
		background: transparent;
		color: #647a75;
		font: inherit;
		font-size: 1.35rem;
		line-height: 1;
		cursor: pointer;
	}

	.activity-summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.65rem 1.05rem;
		border-bottom: 1px solid #e9efed;
		font-size: 0.7rem;
	}

	.activity-summary span {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-weight: 700;
	}

	.activity-summary button {
		border: 0;
		background: transparent;
		color: #657a75;
		font: inherit;
		font-size: 0.68rem;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 0.2rem;
	}

	.activity-list {
		overflow: auto;
		overscroll-behavior: contain;
	}

	.activity-item {
		display: grid;
		grid-template-columns: 3px minmax(0, 1fr);
		border-bottom: 1px solid #edf2f0;
	}

	.activity-rail {
		background: #9aaea9;
	}

	.activity-item--running .activity-rail,
	.activity-item--running .activity-state i {
		background: var(--activity-teal);
	}

	.activity-item--succeeded .activity-rail,
	.activity-item--succeeded .activity-state i,
	.activity-toast--succeeded .activity-dot {
		background: var(--activity-success);
	}

	.activity-item--failed .activity-rail,
	.activity-item--failed .activity-state i,
	.activity-toast--failed .activity-dot {
		background: var(--activity-danger);
	}

	.activity-item__body {
		display: grid;
		gap: 0.38rem;
		padding: 0.78rem 0.95rem 0.82rem;
	}

	.activity-item__body > div {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
	}

	.activity-item strong {
		font-size: 0.78rem;
		line-height: 1.35;
	}

	.activity-item time {
		flex: 0 0 auto;
		color: #82938f;
		font-size: 0.63rem;
	}

	.activity-item p,
	.activity-toast p {
		margin: 0;
		color: #61736f;
		font-size: 0.7rem;
		line-height: 1.45;
	}

	.activity-state {
		display: inline-flex;
		width: fit-content;
		align-items: center;
		gap: 0.36rem;
		font-size: 0.64rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.activity-empty {
		margin: 0;
		padding: 2rem 1rem;
		color: #778984;
		font-size: 0.76rem;
		text-align: center;
	}

	.activity-toast {
		width: min(88vw, 350px);
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: start;
		gap: 0.7rem;
		padding: 0.78rem 0.85rem;
		border: 1px solid #dce6e2;
		border-radius: 14px;
		background: rgba(253, 254, 253, 0.98);
		box-shadow: 0 16px 42px rgba(20, 55, 48, 0.18);
		animation: activity-enter 180ms ease-out;
	}

	.activity-toast strong {
		display: block;
		margin-bottom: 0.2rem;
		color: var(--activity-ink);
		font-size: 0.76rem;
	}

	.activity-toast .activity-dot {
		margin-top: 0.26rem;
	}

	@keyframes activity-pulse {
		0% {
			box-shadow: 0 0 0 0 rgba(12, 128, 119, 0.28);
		}
		70%,
		100% {
			box-shadow: 0 0 0 7px rgba(12, 128, 119, 0);
		}
	}

	@keyframes activity-enter {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.985);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.activity-trigger--busy .activity-trigger__pulse,
		.activity-summary--active i,
		.activity-panel,
		.activity-toast {
			animation: none;
		}
	}

	@media (max-width: 520px) {
		.activity-dock {
			right: 0.6rem;
			bottom: 0.6rem;
		}
		.activity-panel {
			max-height: 76vh;
		}
	}
</style>
