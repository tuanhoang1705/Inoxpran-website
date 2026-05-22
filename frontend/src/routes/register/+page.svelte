<script>
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/index.js';
	import { getStoredTelemetrySessionId, getTelemetryTracker } from '$lib/client/telemetry.js';
	import { canTrackTelemetry, initCookieConsent } from '$lib/stores/cookieConsent.js';

	export let form;
	let isSubmitting = false;
	let telemetrySessionId = '';
	let telemetryAnalyticsConsent = false;

	const handleRegisterSubmit = () => {
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
	<title>{$t('auth.register')} | Inoxpran</title>
</svelte:head>

<section class="padding-large">
	<div class="container" style="max-width: 720px;">
		<div class="card border-0 shadow-sm rounded-3 p-4 p-md-5">
			<h2 class="mb-3 text-center">{$t('auth.registerTitle')}</h2>
			<p class="text-center text-black-50 mb-4">
				{$t('auth.registerDesc')}
			</p>

			{#if form?.error}
				<div class="alert alert-danger" role="alert">{form.error}</div>
			{/if}
			{#if form?.success}
				<div class="alert alert-success" role="alert">{form.message}</div>
			{/if}

			<form method="post" class="register-form" onsubmit={handleRegisterSubmit}>
				<input
					type="hidden"
					name="telemetryConsentAnalytics"
					value={telemetryAnalyticsConsent ? '1' : '0'}
				/>
				{#if telemetrySessionId}
					<input type="hidden" name="telemetrySessionId" value={telemetrySessionId} />
				{/if}
				<div class="row g-3">
					<div class="col-md-6">
						<label class="form-label" for="name">{$t('auth.name')}</label>
						<input
							class="form-control rounded-3 p-3"
							id="name"
							name="name"
							type="text"
							placeholder={$t('auth.namePlaceholder')}
							required
							autocomplete="name"
						/>
					</div>
					<div class="col-md-6">
						<label class="form-label" for="phone">{$t('auth.phone')}</label>
						<input
							class="form-control rounded-3 p-3"
							id="phone"
							name="phone"
							type="tel"
							placeholder={$t('auth.phonePlaceholder')}
							autocomplete="tel"
						/>
					</div>
				</div>

				<div class="mt-3">
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
				<div class="row g-3 mt-1">
					<div class="col-md-6">
						<label class="form-label" for="password">{$t('auth.password')}</label>
						<input
							class="form-control rounded-3 p-3"
							id="password"
							name="password"
							type="password"
							placeholder={$t('auth.passwordPlaceholder')}
							required
							autocomplete="new-password"
						/>
					</div>
					<div class="col-md-6">
						<label class="form-label" for="confirmPassword">{$t('auth.confirmPassword')}</label>
						<input
							class="form-control rounded-3 p-3"
							id="confirmPassword"
							name="confirmPassword"
							type="password"
							placeholder={$t('auth.confirmPasswordPlaceholder')}
							required
							autocomplete="new-password"
						/>
					</div>
				</div>

				<div class="form-check mt-3 mb-4">
					<input class="form-check-input" type="checkbox" id="policy" required />
					<label class="form-check-label" for="policy">
						{$t('auth.agreePolicy')}
						<a href="/policies" class="fw-semibold">{$t('auth.policyLink')}</a>.
					</label>
				</div>

				<button
					type="submit"
					class={`btn ${isSubmitting ? 'btn-dark' : 'btn-primary'} w-100 py-3 rounded-3 text-uppercase d-inline-flex align-items-center justify-content-center gap-2`}
					disabled={isSubmitting}
					aria-busy={isSubmitting}
				>
					{#if isSubmitting}
						<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
						<span>{$t('common.loading')}</span>
					{:else}
						{$t('auth.register')}
					{/if}
				</button>
			</form>

			<div class="text-center mt-4">
				<span class="text-black-50">{$t('auth.haveAccount')}</span>
				<a class="fw-semibold ms-1" href="/login">{$t('auth.login')}</a>
			</div>
		</div>
	</div>
</section>
