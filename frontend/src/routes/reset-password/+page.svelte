<script>
	import { t } from '$lib/i18n/index.js';
	let { data, form } = $props();

	let token = $derived(form?.token ?? data?.token ?? '');
</script>

<svelte:head>
	<title>{$t('auth.resetPassword')} | Inoxpran</title>
</svelte:head>

<section class="padding-large">
	<div class="container" style="max-width: 560px;">
		<div class="card border-0 shadow-sm rounded-3 p-4">
			<h2 class="mb-2 text-center">{$t('auth.resetPassword')}</h2>
			<p class="text-center text-black-50 mb-4">
				{$t('auth.resetPasswordDesc')}
			</p>

			{#if form?.error}
				<div class="alert alert-danger" role="alert">{form.error}</div>
			{/if}
			{#if form?.success}
				<div class="alert alert-success" role="alert">{form.message}</div>
				<p class="text-center mb-0"><a href="/login">{$t('auth.login')}</a></p>
			{:else}
				{#if !token}
					<div class="alert alert-warning" role="alert">
						{$t('auth.resetInvalid')}
					</div>
				{:else}
					<form method="post" class="d-grid gap-3">
						<input type="hidden" name="token" value={token} />
						<div>
							<label class="form-label" for="password">{$t('account.newPassword')}</label>
							<input
								class="form-control"
								id="password"
								name="password"
								type="password"
								placeholder={$t('auth.newPasswordPlaceholder')}
								required
								autocomplete="new-password"
							/>
						</div>
						<div>
							<label class="form-label" for="confirmPassword">{$t('account.confirmPassword')}</label>
							<input
								class="form-control"
								id="confirmPassword"
								name="confirmPassword"
								type="password"
								placeholder={$t('auth.confirmPasswordPlaceholder')}
								required
								autocomplete="new-password"
							/>
						</div>
						<button class="btn btn-dark" type="submit">{$t('auth.resetPassword')}</button>
					</form>
				{/if}
			{/if}
		</div>
	</div>
</section>
