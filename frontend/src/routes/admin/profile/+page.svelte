<script>
	import { onMount } from 'svelte';
	import { pushToast } from '$lib/stores/adminToast.js';
	import { t } from '$lib/i18n/admin/index.js';

	let { data, form } = $props();


	const profile = form?.profile || data?.profile;
	const loadError = data?.apiError;

	onMount(() => {
		if (form?.toast) {
			pushToast(form.toast);
		}
	});
</script>

<svelte:head>
	<title>{$t('admin.profile.title')} | Inoxpran</title>
</svelte:head>

<section>
	<h2 class="mb-4">{$t('admin.profile.heading')}</h2>

	{#if loadError}
		<div class="alert alert-danger">{loadError}</div>
	{/if}

	<div class="border rounded-3 p-4 bg-white">
		<form method="post" enctype="multipart/form-data" action="?/update" class="row g-3">
			<div class="col-md-6">
				<label class="form-label" for="admin-profile-name">{$t('admin.profile.name')}</label>
				<input
					class="form-control"
					id="admin-profile-name"
					name="name"
					value={profile?.name || ''}
				/>
			</div>
			<div class="col-md-6">
				<label class="form-label" for="admin-profile-phone">{$t('admin.profile.phone')}</label>
				<input
					class="form-control"
					id="admin-profile-phone"
					name="phone"
					value={profile?.phone || ''}
				/>
			</div>
			<div class="col-md-6">
				<label class="form-label" for="admin-profile-avatar-url">
					{$t('admin.profile.avatarUrl')}
				</label>
				<input
					class="form-control"
					id="admin-profile-avatar-url"
					name="avatar_url"
					value={profile?.avatar || ''}
				/>
			</div>
			<div class="col-md-6">
				<label class="form-label" for="admin-profile-avatar-file">
					{$t('admin.profile.avatarFile')}
				</label>
				<input
					class="form-control"
					id="admin-profile-avatar-file"
					name="avatar_file"
					type="file"
				/>
			</div>
			<div class="col-12">
				<button class="btn btn-dark" type="submit">{$t('admin.profile.update')}</button>
			</div>
		</form>
	</div>
</section>
