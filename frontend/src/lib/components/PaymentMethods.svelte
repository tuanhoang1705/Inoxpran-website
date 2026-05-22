<script>
	import { locale } from '$lib/i18n/index.js';

	let { compact = false } = $props();

	const methods = $derived(
		$locale === 'en'
			? ['COD', 'Bank transfer', 'Visa / Mastercard', 'ZaloPay / MoMo']
			: ['COD', 'Chuyển khoản', 'Visa / Mastercard', 'ZaloPay / MoMo']
	);
</script>

<div class="payment-methods" class:compact aria-label={$locale === 'en' ? 'Payment methods' : 'Phương thức thanh toán'}>
	{#each methods as method}
		<span>{method}</span>
	{/each}
</div>

<style>
	.payment-methods {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 14px;
	}

	.payment-methods span {
		display: inline-flex;
		align-items: center;
		min-height: 34px;
		border-radius: 999px;
		border: 1px solid rgba(15, 23, 42, 0.14);
		background: #ffffff;
		color: #111827;
		padding: 6px 12px;
		font-size: 0.78rem;
		font-weight: 700;
		white-space: nowrap;
		box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
	}

	.payment-methods.compact {
		margin-top: 10px;
		gap: 6px;
	}

	.payment-methods.compact span {
		min-height: 30px;
		padding: 5px 10px;
		font-size: 0.72rem;
	}
</style>
