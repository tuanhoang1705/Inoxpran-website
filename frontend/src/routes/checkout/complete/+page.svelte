<script>
	import { onMount } from 'svelte';
	import { locale } from '$lib/i18n/index.js';
	import { localizeInternalHref } from '$lib/utils/localePath.js';

	let { data } = $props();

	const isEnglish = $derived($locale === 'en');
	const orderId = $derived(data?.orderId || '');
	const cartCount = $derived(data?.cartCount);
	const ordersHref = $derived(localizeInternalHref('/account/purchase', $locale));
	const homeHref = $derived(localizeInternalHref('/', $locale));

	onMount(() => {
		const count = Number(cartCount);
		if (!Number.isFinite(count) || count < 0) return;
		window.dispatchEvent(
			new CustomEvent('cart:change', {
				detail: { count: Math.floor(count) }
			})
		);
	});
</script>

<svelte:head>
	<title>{isEnglish ? 'Checkout complete' : 'Hoàn tất đặt hàng'} | Inoxpran</title>
</svelte:head>

<section class="checkout-complete-shell">
	<div class="checkout-complete-container">
		<div class="complete-mark" aria-hidden="true">
			<svg viewBox="0 0 24 24" role="img">
				<path d="M20 6 9 17l-5-5" />
			</svg>
		</div>

		<p class="complete-kicker">Inoxpran Checkout</p>
		<h1>{isEnglish ? 'Order placed successfully' : 'Đặt hàng thành công'}</h1>
		<p class="complete-lede">
			{isEnglish
				? 'Your order has been received. Inoxpran will confirm and prepare delivery shortly.'
				: 'Đơn hàng của bạn đã được ghi nhận. Inoxpran sẽ xác nhận và chuẩn bị giao hàng trong thời gian sớm nhất.'}
		</p>

		{#if orderId}
			<div class="complete-order-id">
				<span>{isEnglish ? 'Order ID' : 'Mã đơn hàng'}</span>
				<strong>{orderId}</strong>
			</div>
		{/if}

		<div class="complete-actions">
			<a class="complete-primary" href={ordersHref}>
				{isEnglish ? 'View my orders' : 'Quay lại đơn hàng'}
			</a>
			<a class="complete-secondary" href={homeHref}>
				{isEnglish ? 'Back to home' : 'Về trang chủ'}
			</a>
		</div>
	</div>
</section>

<style>
	.checkout-complete-shell {
		min-height: calc(100vh - 120px);
		display: grid;
		place-items: center;
		padding: clamp(48px, 8vw, 96px) 18px;
		background:
			linear-gradient(180deg, rgba(245, 250, 250, 0.82), rgba(255, 255, 255, 0.96)),
			#fff;
		color: #17202a;
	}

	.checkout-complete-container {
		width: min(100%, 720px);
		text-align: center;
		border: 1px solid rgba(15, 118, 110, 0.14);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.94);
		padding: clamp(30px, 5vw, 54px);
		box-shadow: 0 24px 70px rgba(15, 23, 42, 0.1);
	}

	.complete-mark {
		width: 68px;
		height: 68px;
		margin: 0 auto 20px;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: #0f766e;
		color: #fff;
		box-shadow: 0 12px 28px rgba(15, 118, 110, 0.28);
	}

	.complete-mark svg {
		width: 34px;
		height: 34px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.complete-kicker {
		margin: 0 0 10px;
		color: #0f766e;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 5vw, 3.4rem);
		line-height: 1.05;
		font-weight: 800;
		letter-spacing: 0;
	}

	.complete-lede {
		max-width: 560px;
		margin: 18px auto 0;
		color: #5f6b76;
		font-size: 1rem;
		line-height: 1.7;
	}

	.complete-order-id {
		display: grid;
		gap: 6px;
		width: min(100%, 420px);
		margin: 28px auto 0;
		padding: 14px 16px;
		border: 1px solid rgba(15, 118, 110, 0.16);
		border-radius: 8px;
		background: #f7fbfb;
	}

	.complete-order-id span {
		color: #6b7280;
		font-size: 0.82rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.complete-order-id strong {
		color: #17202a;
		font-size: 0.98rem;
		word-break: break-all;
	}

	.complete-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 12px;
		margin-top: 32px;
	}

	.complete-actions a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 46px;
		padding: 0 20px;
		border-radius: 8px;
		font-weight: 800;
		text-decoration: none;
		transition:
			transform 0.18s ease,
			border-color 0.18s ease,
			background-color 0.18s ease;
	}

	.complete-actions a:hover {
		transform: translateY(-1px);
	}

	.complete-primary {
		border: 1px solid #0f766e;
		background: #0f766e;
		color: #fff;
	}

	.complete-secondary {
		border: 1px solid rgba(15, 23, 42, 0.16);
		background: #fff;
		color: #17202a;
	}

	@media (max-width: 520px) {
		.checkout-complete-container {
			padding: 28px 18px;
		}

		.complete-actions {
			display: grid;
		}
	}
</style>
