<script>
	import { onMount } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { t } from '$lib/i18n/admin/index.js';

	export let form;

	onMount(() => {
		if (form?.toast) {
			pushToast(form.toast);
		}
	});
</script>

<svelte:head>
	<title>{$t('admin.auth.loginTitle')} | Inoxpran</title>
</svelte:head>

<section class="py-5">
	<div class="container" style="max-width: 520px;">
		<div class="card border-0 shadow-sm rounded-3 p-4">
			<h2 class="mb-2 text-center">{$t('admin.auth.loginTitle')}</h2>
			<p class="text-center text-black-50 mb-4">{$t('admin.auth.loginDesc')}</p>

			<form method="post" class="d-grid gap-3">
				<div>
					<label class="form-label" for="admin-login-email">{$t('admin.auth.email')}</label>
					<input class="form-control" id="admin-login-email" name="email" type="email" required />
				</div>
				<div>
					<label class="form-label" for="admin-login-password">{$t('admin.auth.password')}</label>
					<input
						class="form-control"
						id="admin-login-password"
						name="password"
						type="password"
						required
					/>
				</div>
				<button class="btn btn-dark" type="submit">{$t('admin.auth.loginButton')}</button>
			</form>

			<p class="text-center mt-3 mb-0">
				{$t('admin.auth.noAccount')} <a href="/admin/register">{$t('admin.auth.createAccount')}</a>
			</p>
		</div>
	</div>
</section>
