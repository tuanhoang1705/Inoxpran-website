<script>
	import { t } from '$lib/i18n/index.js';
</script>

<svelte:head>
	<title>{$t('orders.title')} | Inoxpran</title>
</svelte:head>

<section class="padding-large">
	<div class="container">
		<h1 class="section-title">{$t('orders.heading')}</h1>
		<p class="mb-4">{$t('orders.lede')}</p>
		<div class="text-center">
			<p>{$t('orders.empty')}</p>
		</div>
	</div>
</section>
