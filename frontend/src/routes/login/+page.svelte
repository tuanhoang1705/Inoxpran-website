<script>
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { t } from '$lib/i18n/index.js';
	import { getStoredTelemetrySessionId, getTelemetryTracker } from '$lib/client/telemetry.js';
	import { canTrackTelemetry, initCookieConsent } from '$lib/stores/cookieConsent.js';

	let { form } = $props();
	let isSubmitting = $state(false);
	let telemetrySessionId = $state('');
	let telemetryAnalyticsConsent = $state(false);

	const notice = $derived(page.url.searchParams.get('notice') || '');
	const noticeMessage = $derived(
		notice === 'password-changed'
			? $t('auth.passwordChangedNotice')
			: notice === 'session-expired'
				? $t('auth.sessionExpiredNotice')
				: ''
	);
	const noticeVariant = $derived(notice === 'session-expired' ? 'danger' : 'success');
	const redirectTarget = $derived(page.url.searchParams.get('redirect') || '');

	const handleLoginSubmit = () => {
		void getTelemetryTracker().flush?.({ keepalive: true, preferBeacon: true });
		isSubmitting = true;
	};

	onMount(() => {
		const consent = initCookieConsent();
		telemetryAnalyticsConsent = canTrackTelemetry(consent);
		telemetrySessionId = telemetryAnalyticsConsent ? getStoredTelemetrySessionId() || '' : '';
	});
</script>

<svelte:head>
	<title>{$t('auth.login')} | Inoxpran</title>
</svelte:head>

<section class="padding-large">
	<div class="container" style="max-width: 720px;">
		<div class="card border-0 shadow-sm rounded-3 p-4 p-md-5">
			<h2 class="mb-3 text-center">{$t('auth.login')}</h2>
			<p class="text-center text-black-50 mb-4">
				{$t('auth.loginDesc')}
			</p>

			{#if form?.error}
				<div class="alert alert-danger" role="alert">{form.error}</div>
			{/if}
			{#if noticeMessage}
				<div class={`alert alert-${noticeVariant}`} role="alert">{noticeMessage}</div>
			{/if}

			<form method="post" class="login-form" onsubmit={handleLoginSubmit}>
				{#if redirectTarget}
					<input type="hidden" name="redirect" value={redirectTarget} />
				{/if}
				<input
					type="hidden"
					name="telemetryConsentAnalytics"
					value={telemetryAnalyticsConsent ? '1' : '0'}
				/>
				{#if telemetrySessionId}
					<input type="hidden" name="telemetrySessionId" value={telemetrySessionId} />
				{/if}
				<div class="mb-3">
					<label class="form-label" for="email">{$t('auth.email')}</label>
					<input
						class="form-control rounded-3 p-3"
						id="email"
						name="email"
						type="email"
						placeholder={$t('auth.emailPlaceholder')}
						required
						autocomplete="email"
					/>
				</div>

				<div class="mb-3">
					<label class="form-label" for="password">{$t('auth.password')}</label>
					<input
						class="form-control rounded-3 p-3"
						id="password"
						name="password"
						type="password"
						placeholder={$t('auth.passwordPlaceholder')}
						required
						autocomplete="current-password"
					/>
				</div>

				<div class="row align-items-center mb-3 g-2">
					<div class="col-6">
						<div class="form-check mb-0">
							<input
								class="form-check-input"
								type="checkbox"
								id="rememberMe"
								name="remember"
								value="1"
							/>
							<label class="form-check-label" for="rememberMe">{$t('auth.rememberMe')}</label>
						</div>
					</div>
					<div class="col-6 text-end">
						<a href="/forgot-password" class="text-primary small">{$t('auth.forgotPassword')}</a>
					</div>
				</div>

				<button
					type="submit"
					class="btn btn-dark w-100 py-3 rounded-3 text-uppercase d-inline-flex align-items-center justify-content-center gap-2"
					disabled={isSubmitting}
					aria-busy={isSubmitting}
				>
					{#if isSubmitting}
						<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
						<span>{$t('common.loading')}</span>
					{:else}
						{$t('auth.login')}
					{/if}
				</button>
			</form>

			<div class="text-center mt-4">
				<span class="text-black-50">{$t('auth.noAccount')}</span>
				<a class="fw-semibold ms-1" href="/register">{$t('auth.registerNow')}</a>
			</div>
		</div>
	</div>
</section>
