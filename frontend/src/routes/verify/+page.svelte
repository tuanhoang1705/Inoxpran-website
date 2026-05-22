<script>
	import { t } from '$lib/i18n/index.js';

	export let data;
</script>

<svelte:head>
	<title>{$t('auth.verifyEmail')} | Inoxpran</title>
</svelte:head>

<section class="padding-large">
	<div class="container" style="max-width: 560px;">
		<div class="card border-0 shadow-sm rounded-3 p-4 text-center">
			<h2 class="mb-2">{$t('auth.verifyEmail')}</h2>
			<p class="text-black-50 mb-4">{data.message}</p>

			{#if data.status === 'success'}
				<a class="btn btn-dark" href="/login">{$t('auth.login')}</a>
			{:else}
				<a class="btn btn-outline-dark" href="/register">{$t('auth.registerAgain')}</a>
			{/if}
		</div>
	</div>
</section>
