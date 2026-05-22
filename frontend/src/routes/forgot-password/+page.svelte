<script>
	import { t } from '$lib/i18n/index.js';

	export let form;
</script>

<svelte:head>
	<title>{$t('auth.forgotPassword')} | Inoxpran</title>
</svelte:head>

<section class="padding-large">
	<div class="container" style="max-width: 560px;">
		<div class="card border-0 shadow-sm rounded-3 p-4">
			<h2 class="mb-2 text-center">{$t('auth.forgotPassword')}</h2>
			<p class="text-center text-black-50 mb-4">
				{$t('auth.forgotPasswordDesc')}
			</p>

			{#if form?.error}
				<div class="alert alert-danger" role="alert">{form.error}</div>
			{/if}
			{#if form?.success}
				<div class="alert alert-success" role="alert">{form.message}</div>
			{/if}

			<form method="post" class="d-grid gap-3">
				<div>
					<label class="form-label" for="email">{$t('auth.email')}</label>
					<input
						class="form-control"
						id="email"
						name="email"
						type="email"
						placeholder={$t('auth.emailPlaceholder')}
						required
						autocomplete="email"
					/>
				</div>
				<button class="btn btn-dark" type="submit">{$t('auth.sendRequest')}</button>
			</form>

			<p class="text-center mt-3 mb-0">
				{$t('auth.rememberPassword')} <a href="/login">{$t('auth.login')}</a>
			</p>
		</div>
	</div>
</section>
