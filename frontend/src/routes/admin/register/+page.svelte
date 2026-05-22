<script>
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { t } from '$lib/i18n/admin/index.js';

	export let form;

	let lastToastKey = '';
	let redirecting = false;
	let redirectTimer;

	$: if (browser && form?.toast?.message) {
		const key = form.toast.id || `${form.toast.tone || 'info'}:${form.toast.message}`;
		if (key !== lastToastKey) {
			lastToastKey = key;
			pushToast(form.toast);
		}
	}

	$: if (browser && form?.success && !redirecting) {
		redirecting = true;
		redirectTimer = setTimeout(() => {
			goto('/admin/register/pending');
		}, 1500);
	}

	onDestroy(() => {
		if (redirectTimer) {
			clearTimeout(redirectTimer);
		}
	});
</script>

<svelte:head>
	<title>{$t('admin.auth.registerTitle')} | Inoxpran</title>
</svelte:head>

<section class="py-5">
	<div class="container" style="max-width: 560px;">
		<div class="card border-0 shadow-sm rounded-3 p-4">
			<h2 class="mb-2 text-center">{$t('admin.auth.registerTitle')}</h2>
			<p class="text-center text-black-50 mb-4">
				{$t('admin.auth.registerDesc')}
			</p>

			<form method="post" class="d-grid gap-3">
				<div>
					<label class="form-label" for="admin-register-name">{$t('admin.auth.name')}</label>
					<input class="form-control" id="admin-register-name" name="name" type="text" required />
				</div>
				<div>
					<label class="form-label" for="admin-register-email">{$t('admin.auth.email')}</label>
					<input
						class="form-control"
						id="admin-register-email"
						name="email"
						type="email"
						required
					/>
				</div>
				<div>
					<label class="form-label" for="admin-register-phone">{$t('admin.auth.phone')}</label>
					<input class="form-control" id="admin-register-phone" name="phone" type="text" />
				</div>
				<div>
					<label class="form-label" for="admin-register-password">{$t('admin.auth.password')}</label>
					<input
						class="form-control"
						id="admin-register-password"
						name="password"
						type="password"
						required
					/>
				</div>
				<button class="btn btn-dark" type="submit" disabled={redirecting}>
					{redirecting ? $t('admin.auth.redirecting') : $t('admin.auth.createAccount')}
				</button>
			</form>
			{#if redirecting}
				<p class="text-center text-black-50 small mt-3 mb-0">
					{$t('admin.auth.redirectingHint')}
				</p>
			{/if}

			<p class="text-center mt-3 mb-0">
				{$t('admin.auth.haveAccount')} <a href="/admin/login">{$t('admin.auth.loginButton')}</a>
			</p>
		</div>
	</div>
</section>
