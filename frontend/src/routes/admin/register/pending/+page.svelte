<script>
	import { onMount } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { t } from '$lib/i18n/admin/index.js';

	let { data, form } = $props();


	onMount(() => {
		if (form?.toast) {
			pushToast(form.toast);
		}
	});
</script>

<svelte:head>
	<title>{$t('admin.pending.title')} | Inoxpran Admin</title>
</svelte:head>

<section class="py-5">
	<div class="container" style="max-width: 560px;">
		<div class="card border-0 shadow-sm rounded-3 p-5">
			<div class="text-center mb-4">
				<div style="font-size: 48px; margin-bottom: 16px;">&#x23F3;</div>
				<h2 class="mb-2">{$t('admin.pending.title')}</h2>
				<p class="text-black-50 mb-0">{$t('admin.pending.success')}</p>
			</div>

			<div class="alert alert-info" role="alert">
				<strong>{$t('admin.pending.nextTitle')}</strong>
				<p class="mb-0 mt-2">{$t('admin.pending.nextDesc')}</p>
			</div>

			<div class="card border-0 bg-light p-3 mb-4">
				<div class="small text-black-50">
					<strong>{$t('admin.pending.statusLabel')}:</strong> {$t('admin.pending.statusValue')}
				</div>
				{#if data?.pendingEmail}
					<div class="small text-black-50 mt-2">
						<strong>{$t('admin.pending.emailLabel')}:</strong> {data.pendingEmail}
					</div>
				{/if}
				<div class="small text-black-50 mt-2">{$t('admin.pending.notify')}</div>
			</div>

			<a href="/admin/login" class="btn btn-dark w-100 mb-2">{$t('admin.pending.backToLogin')}</a>
			<p class="text-center text-black-50 small mb-0">{$t('admin.pending.loginHint')}</p>
		</div>
	</div>
</section>

<style>
	:global(body) {
		background: #f6f2ea;
	}
</style>
