<script>
	import { t } from '$lib/i18n/index.js';

	let { data, form } = $props();

	const profile = $derived(form?.profile ?? data?.profile ?? null);
	const apiError = $derived(form?.error || data?.profileError || '');
	const profileNotice = $derived(form?.section === 'profile' ? form : null);
	const avatarNotice = $derived(form?.section === 'avatar' ? form : null);
	const passwordNotice = $derived(form?.section === 'password' ? form : null);

	const displayName = $derived(profile?.name || $t('common.customer'));
	const email = $derived(profile?.email || '');
	const phone = $derived(profile?.phone || '');
	const avatarUrl = $derived(profile?.avatar || '');
	const verifyLabel = $derived(profile?.verify ? $t('account.verified') : $t('account.unverified'));
	const addressesValue = $derived(
		Array.isArray(profile?.addresses) ? profile.addresses.join('\n') : ''
	);

	const initials = $derived.by(() => {
		const name = profile?.name || '';
		const parts = name.trim().split(/\s+/).filter(Boolean);
		const letters = parts.slice(0, 2).map((part) => part[0]).join('');
		return letters || 'U';
	});
</script>

<svelte:head>
	<title>{$t('account.title')} | Inoxpran</title>
</svelte:head>

<section class="padding-large account-page">
	<div class="container">
		<div class="account-hero">
			<div class="account-hero-main">
				<p class="eyebrow">{$t('account.title')}</p>
				<h1 class="account-title">{$t('account.greeting', { name: displayName })}</h1>
				<p class="account-lede">{$t('account.lede')}</p>
				{#if apiError}
					<div class="alert alert-warning" role="alert">{apiError}</div>
				{/if}
				
			</div>
			<div class="account-hero-card">
				<div class="hero-line">
					<span class="hero-label">{$t('account.email')}</span>
					<span class="hero-value">{email || '--'}</span>
				</div>
				<div class="hero-line">
					<span class="hero-label">{$t('account.status')}</span>
					<span class={`hero-badge ${profile?.verify ? 'ok' : 'warn'}`}>{verifyLabel}</span>
				</div>
				<div class="hero-line">
					<span class="hero-label">{$t('account.phone')}</span>
					<span class="hero-value">{phone || '--'}</span>
				</div>
			</div>
		</div>

		<div class="row g-4 mt-4">
			<aside class="col-lg-4">
				<div class="card account-card p-4">
					<h3 class="account-card-title">{$t('account.avatar')}</h3>
					<div class="avatar-block">
						{#if avatarUrl}
							<img
								src={avatarUrl}
								alt={$t('account.avatar')}
								width="84"
								height="84"
								class="avatar-image"
							/>
						{:else}
							<div class="avatar-fallback">{initials}</div>
						{/if}
						<div>
							<p class="avatar-name">{displayName}</p>
							<p class="avatar-email">{email || 'email@example.com'}</p>
							<span class={`hero-badge ${profile?.verify ? 'ok' : 'warn'}`}>{verifyLabel}</span>
						</div>
					</div>

					{#if avatarNotice?.error}
						<div class="alert alert-danger mt-3" role="alert">{avatarNotice.error}</div>
					{/if}
					{#if avatarNotice?.success}
						<div class="alert alert-success mt-3" role="alert">{avatarNotice.message}</div>
					{/if}

					<form
						method="post"
						action="?/updateAvatar"
						enctype="multipart/form-data"
						class="d-grid gap-2 mt-3"
					>
						<label class="form-label" for="account-avatar">{$t('account.newAvatar')}</label>
						<input
							class="form-control"
							id="account-avatar"
							type="file"
							name="avatar"
							accept="image/*"
						/>
						<button type="submit" class="btn btn-dark">{$t('account.updateAvatar')}</button>
						<p class="form-hint">{$t('account.avatarHint')}</p>
					</form>
				</div>

				<div class="card account-card p-4 mt-4">
					<h3 class="account-card-title">{$t('account.security')}</h3>
					<ul class="account-list">
						<li><span>{$t('account.status')}</span><strong>{verifyLabel}</strong></li>
						<li><span>{$t('account.recentLogin')}</span><strong>{$t('common.today')}</strong></li>
						<li><span>{$t('account.accountStatus')}</span><strong>{$t('account.active')}</strong></li>
					</ul>
					<p class="small text-black-50 mb-0">{$t('account.reloginHint')}</p>
				</div>
			</aside>

			<main class="col-lg-8">
				<div class="card account-card p-4">
					<div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
						<div>
							<h3 class="account-card-title">{$t('account.personalInfo')}</h3>
							<p class="text-black-50 mb-0">{$t('account.personalDesc')}</p>
						</div>
					</div>

					{#if profileNotice?.error}
						<div class="alert alert-danger mt-3" role="alert">{profileNotice.error}</div>
					{/if}
					{#if profileNotice?.success}
						<div class="alert alert-success mt-3" role="alert">{profileNotice.message}</div>
					{/if}

					<form method="post" action="?/updateProfile" class="mt-3">
						<div class="row g-3">
							<div class="col-md-6">
								<label class="form-label" for="name">{$t('account.fullName')}</label>
								<input
									class="form-control"
									id="name"
									name="name"
									type="text"
									value={profile?.name || ''}
									placeholder={$t('account.fullNamePlaceholder')}
								/>
							</div>
							<div class="col-md-6">
								<label class="form-label" for="phone">{$t('account.phone')}</label>
								<input
									class="form-control"
									id="phone"
									name="phone"
									type="tel"
									value={profile?.phone || ''}
									placeholder={$t('account.phonePlaceholder')}
								/>
							</div>
						</div>

						<div class="mt-3">
							<label class="form-label" for="email">{$t('account.email')}</label>
							<input
								class="form-control"
								id="email"
								name="email"
								type="email"
								value={profile?.email || ''}
								disabled
								readonly
							/>
						</div>

						<div class="mt-3">
							<label class="form-label" for="addresses">{$t('account.addresses')}</label>
							<textarea
								class="form-control"
								id="addresses"
								name="addresses"
								rows="4"
								placeholder={$t('account.addressPlaceholder')}
								value={addressesValue}
							></textarea>
							<p class="form-hint">{$t('account.addressHint')}</p>
						</div>

						<div class="mt-4 d-flex flex-wrap gap-2">
							<button type="submit" class="btn btn-primary">{$t('account.saveChanges')}</button>
							<button type="reset" class="btn btn-outline-dark">{$t('common.reset')}</button>
						</div>
					</form>
				</div>

				<div class="card account-card p-4 mt-4">
					<h3 class="account-card-title">{$t('account.changePassword')}</h3>
					<p class="text-black-50">{$t('account.passwordHint')}</p>

					{#if passwordNotice?.error}
						<div class="alert alert-danger" role="alert">{passwordNotice.error}</div>
					{/if}

					<form method="post" action="?/changePassword" class="mt-3">
						<div class="row g-3">
							<div class="col-md-6">
								<label class="form-label" for="currentPassword">
									{$t('account.currentPassword')}
								</label>
								<input
									class="form-control"
									id="currentPassword"
									name="currentPassword"
									type="password"
									autocomplete="current-password"
									required
								/>
							</div>
							<div class="col-md-6">
								<label class="form-label" for="newPassword">{$t('account.newPassword')}</label>
								<input
									class="form-control"
									id="newPassword"
									name="newPassword"
									type="password"
									autocomplete="new-password"
									required
								/>
							</div>
							<div class="col-md-6">
								<label class="form-label" for="confirmPassword">
									{$t('account.confirmPassword')}
								</label>
								<input
									class="form-control"
									id="confirmPassword"
									name="confirmPassword"
									type="password"
									autocomplete="new-password"
									required
								/>
							</div>
						</div>
						<div class="mt-4 d-flex flex-wrap gap-2">
							<button type="submit" class="btn btn-dark">
								{$t('account.updatePassword')}
							</button>
							<button type="reset" class="btn btn-outline-dark">{$t('common.reset')}</button>
						</div>
					</form>
				</div>
			</main>
		</div>
	</div>
</section>

<style>
	.account-hero {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
		gap: 24px;
		padding: 32px;
		border-radius: 28px;
		box-shadow: 0 18px 45px rgba(33, 24, 10, 0.08);
	}

	.account-hero-main {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.account-title {
		font-size: 2.2rem;
		font-weight: 700;
		color: #1f1a14;
		margin-bottom: 4px;
	}

	.account-lede {
		color: #4c3f32;
		max-width: 520px;
		margin-bottom: 0;
	}

	.account-hero-card {
		background: #1f1a14;
		color: #fef7ea;
		border-radius: 22px;
		padding: 24px;
		display: grid;
		gap: 14px;
		align-content: start;
	}

	.hero-line {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.hero-label {
		font-size: 0.78rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.6);
	}

	.hero-value {
		font-size: 1rem;
		font-weight: 600;
		color: #fff3e2;
		word-break: break-word;
	}

	.hero-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.hero-badge.ok {
		background: rgba(79, 199, 152, 0.2);
		color: #9bf3c8;
	}

	.hero-badge.warn {
		background: rgba(255, 193, 7, 0.2);
		color: #ffd27b;
	}

	.account-card {
		border-radius: 20px;
		border: none;
		box-shadow: 0 14px 30px rgba(21, 14, 6, 0.08);
	}

	.account-card-title {
		font-size: 1.25rem;
		font-weight: 700;
		margin-bottom: 4px;
	}

	.avatar-block {
		display: grid;
		grid-template-columns: 84px 1fr;
		gap: 16px;
		align-items: center;
	}

	.avatar-image,
	.avatar-fallback {
		width: 84px;
		height: 84px;
		border-radius: 22px;
		object-fit: cover;
	}

	.avatar-image {
		border: 3px solid #f4d6a2;
		background: #fff3e2;
	}

	.avatar-fallback {
		background: linear-gradient(135deg, #1f1a14, #3a2f24);
		color: #fff1da;
		font-size: 1.6rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.avatar-name {
		font-weight: 700;
		margin-bottom: 4px;
	}

	.avatar-email {
		color: #6d5c4b;
		font-size: 0.9rem;
		margin-bottom: 6px;
		word-break: break-word;
	}

	.account-list {
		list-style: none;
		padding: 0;
		margin: 16px 0 0;
		display: grid;
		gap: 10px;
	}

	.account-list li {
		display: flex;
		justify-content: space-between;
		color: #3b2f24;
		font-size: 0.95rem;
	}

	.account-list span {
		color: #7b6b5b;
		font-size: 0.85rem;
	}

	.form-hint {
		font-size: 0.85rem;
		color: #8b7b6b;
		margin: 0;
	}

	@media (max-width: 991px) {
		.account-hero {
			grid-template-columns: 1fr;
			padding: 24px;
		}

		.account-title {
			font-size: 1.9rem;
		}
	}
</style>
