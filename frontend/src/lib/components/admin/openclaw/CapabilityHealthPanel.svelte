<script>
	import { locale, t } from '$lib/i18n/admin/index.js';
	import {
		capabilityEnvKeys,
		capabilityFeatureTranslationKey,
		capabilityList,
		capabilityReasonTranslationKey,
		capabilityStatusTranslationKey,
		capabilityTone,
		humanizeCapabilityToken,
		normalizeCapabilityHealth,
		upsertCapability
	} from '$lib/openclaw/capabilityHealth.js';

	let {
		health = {},
		title = '',
		description = '',
		compact = false,
		onUpdated = () => {}
	} = $props();

	let currentHealth = $derived(normalizeCapabilityHealth(health));
	let checkingAll = $state(false);
	let checkingKey = $state('');
	let requestError = $state('');
	const capabilities = $derived(capabilityList(currentHealth));
	const canCheck = $derived(currentHealth.actions?.check === true);
	const isEn = $derived($locale === 'en');

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com') {
			return path;
		}
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
	};

	const translated = (key, fallback) => {
		if (!key) return fallback;
		const value = $t(key);
		return value === key ? fallback : value;
	};

	const featureLabel = (capability) => {
		const localKey = capabilityFeatureTranslationKey(capability.featureKey);
		const localLabel = translated(localKey, humanizeCapabilityToken(capability.featureKey));
		return translated(capability.labelKey, localLabel);
	};

	const statusLabel = (capability) =>
		translated(
			capabilityStatusTranslationKey(capability.status),
			humanizeCapabilityToken(capability.status)
		);

	const reasonLabel = (capability) => {
		if (capability.messageKey) {
			const message = translated(capability.messageKey, '');
			if (message) return message;
		}
		return capability.reasonCode
			? translated(
					capabilityReasonTranslationKey(capability.reasonCode),
					humanizeCapabilityToken(capability.reasonCode)
				)
			: '';
	};

	const warningLabel = (warning) =>
		translated(capabilityReasonTranslationKey(warning), humanizeCapabilityToken(warning));

	const formatDateTime = (value) => {
		if (!value) return $t('admin.contentOperations.capabilities.notChecked');
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return $t('admin.contentOperations.capabilities.notChecked');
		return new Intl.DateTimeFormat(isEn ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	};

	const runtimeFacts = (capability) => {
		const runtime = capability.runtime || {};
		const safe = capability.safeDetails || {};
		const definitions = [
			['lastSuccessfulRunAt', runtime.lastSuccessfulRunAt, true],
			['nextRunAt', runtime.nextRunAt, true],
			['latestArtifactStatus', runtime.latestArtifactStatus, false],
			['lastHeartbeatAt', runtime.lastHeartbeatAt, true],
			['dueTaskCount', runtime.dueTaskCount, false],
			['persistedScheduleEnabled', runtime.persistedScheduleEnabled, false],
			['workerActive', runtime.workerActive, false],
			['schedulerActive', runtime.schedulerActive, false],
			['activeRuns', runtime.activeRuns ?? safe.activeRuns, false],
			['provider', safe.provider, false],
			['mode', safe.mode, false],
			['profile', safe.profile, false],
			['enabledSchedules', safe.enabledSchedules, false]
		];
		return definitions
			.filter(([, value]) => value !== undefined && value !== null && value !== '')
			.map(([key, value, isDate]) => ({
				key,
				label: $t(`admin.contentOperations.capabilities.runtime.${key}`),
				value: isDate ? formatDateTime(value) : String(value).slice(0, 120)
			}));
	};

	const request = async (path) => {
		const response = await fetch(resolveAdminPath(`/admin/api/openclaw/capabilities/${path}`), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(
				String(payload?.error || $t('admin.contentOperations.capabilities.checkFailed')).slice(
					0,
					300
				)
			);
		}
		return payload || {};
	};

	const pendingHealth = (sourceHealth, featureKey = '') => {
		const normalized = normalizeCapabilityHealth(sourceHealth);
		const capabilities = Object.fromEntries(
			Object.entries(normalized.capabilities).map(([key, capability]) => [
				key,
				!featureKey || key === featureKey
					? { ...capability, checked: false, status: 'pending_check' }
					: capability
			])
		);
		return { ...normalized, capabilities };
	};

	const refreshAll = async () => {
		if (!currentHealth.healthEnabled || !canCheck || checkingAll || checkingKey) return;
		const previousHealth = currentHealth;
		checkingAll = true;
		requestError = '';
		currentHealth = pendingHealth(currentHealth);
		try {
			currentHealth = normalizeCapabilityHealth(await request('check'));
			onUpdated(currentHealth);
		} catch (error) {
			currentHealth = previousHealth;
			requestError =
				error instanceof Error
					? error.message
					: $t('admin.contentOperations.capabilities.checkFailed');
		} finally {
			checkingAll = false;
		}
	};

	const retryOne = async (capability) => {
		if (
			!currentHealth.healthEnabled ||
			!canCheck ||
			checkingAll ||
			checkingKey ||
			!capability.featureKey
		)
			return;
		const previousHealth = currentHealth;
		checkingKey = capability.featureKey;
		requestError = '';
		currentHealth = pendingHealth(currentHealth, capability.featureKey);
		try {
			const payload = await request(`${encodeURIComponent(capability.featureKey)}/check`);
			currentHealth = upsertCapability(
				currentHealth,
				payload?.capability || payload?.metadata || payload
			);
			onUpdated(currentHealth);
		} catch (error) {
			currentHealth = previousHealth;
			requestError =
				error instanceof Error
					? error.message
					: $t('admin.contentOperations.capabilities.checkFailed');
		} finally {
			checkingKey = '';
		}
	};
</script>

<section
	class:capability-panel--compact={compact}
	class="capability-panel"
	aria-labelledby="capability-health-heading"
	aria-busy={checkingAll || Boolean(checkingKey)}
>
	<header class="capability-panel__header">
		<div>
			<p class="capability-panel__kicker">{$t('admin.contentOperations.capabilities.kicker')}</p>
			<h2 id="capability-health-heading">
				{title || $t('admin.contentOperations.capabilities.title')}
			</h2>
			<p>{description || $t('admin.contentOperations.capabilities.description')}</p>
		</div>
		<div class="capability-panel__actions">
			<span>
				{$t('admin.contentOperations.capabilities.lastChecked')}:
				<strong>{formatDateTime(currentHealth.checkedAt)}</strong>
			</span>
			{#if canCheck}
				<button
					type="button"
					onclick={refreshAll}
					disabled={!currentHealth.healthEnabled || checkingAll || Boolean(checkingKey)}
				>
					<span class:capability-panel__spinner={checkingAll} aria-hidden="true">&#x21bb;</span>
					{checkingAll
						? $t('admin.contentOperations.capabilities.checking')
						: $t('admin.contentOperations.capabilities.refreshAll')}
				</button>
			{/if}
		</div>
	</header>

	{#if requestError}
		<p class="capability-panel__error" role="alert">{requestError}</p>
	{/if}
	{#if !currentHealth.healthEnabled}
		<p class="capability-panel__disabled" role="status">
			{$t('admin.contentOperations.capabilities.checksDisabled')}
		</p>
	{/if}

	{#if capabilities.length}
		<div class="capability-panel__grid">
			{#each capabilities as capability (capability.featureKey)}
				<article class="capability-card" class:capability-card--compact={compact}>
					<div class="capability-card__topline">
						<div>
							<h3>{featureLabel(capability)}</h3>
							<code>{capability.featureKey}</code>
						</div>
						<span class={`capability-card__badge is-${capabilityTone(capability)}`}>
							<i aria-hidden="true"></i>{statusLabel(capability)}
						</span>
					</div>

					{#if reasonLabel(capability)}
						<p class="capability-card__reason">{reasonLabel(capability)}</p>
					{/if}

					<dl class="capability-card__facts">
						<div>
							<dt>{$t('admin.contentOperations.capabilities.checkedAt')}</dt>
							<dd>{formatDateTime(capability.lastCheckedAt)}</dd>
						</div>
						{#if capability.latencyMs !== null}
							<div>
								<dt>{$t('admin.contentOperations.capabilities.latency')}</dt>
								<dd>{Math.round(capability.latencyMs)} ms</dd>
							</div>
						{/if}
						{#each runtimeFacts(capability) as fact (fact.key)}
							<div>
								<dt>{fact.label}</dt>
								<dd>{fact.value}</dd>
							</div>
						{/each}
					</dl>

					{#if capability.warnings.length}
						<ul class="capability-card__warnings">
							{#each capability.warnings as warning, index (`${capability.featureKey}-${index}`)}
								<li>{warningLabel(warning)}</li>
							{/each}
						</ul>
					{/if}

					<footer>
						<div
							class="capability-card__env"
							aria-label={$t('admin.contentOperations.capabilities.configKeys')}
						>
							{#each capabilityEnvKeys(capability.featureKey) as envKey (envKey)}
								<code>{envKey}</code>
							{/each}
						</div>
						{#if canCheck}
							<button
								type="button"
								onclick={() => retryOne(capability)}
								disabled={!currentHealth.healthEnabled || checkingAll || Boolean(checkingKey)}
								aria-label={`${$t('admin.contentOperations.capabilities.retry')} ${featureLabel(capability)}`}
							>
								<span
									class:capability-panel__spinner={checkingKey === capability.featureKey}
									aria-hidden="true">&#x21bb;</span
								>
								{$t('admin.contentOperations.capabilities.retry')}
							</button>
						{/if}
					</footer>
				</article>
			{/each}
		</div>
	{:else}
		<div class="capability-panel__empty" role="status">
			<strong>{$t('admin.contentOperations.capabilities.empty')}</strong>
			<span>{$t('admin.contentOperations.capabilities.emptyHint')}</span>
		</div>
	{/if}
</section>

<style>
	.capability-panel {
		display: grid;
		gap: 1rem;
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--admin-border, #e1e7e4);
		border-radius: 13px;
		background:
			linear-gradient(rgba(15, 113, 91, 0.035) 1px, transparent 1px),
			linear-gradient(90deg, rgba(15, 113, 91, 0.035) 1px, transparent 1px), #fff;
		background-size: 22px 22px;
		color: var(--admin-ink, #1f2937);
	}
	.capability-panel__header {
		display: flex;
		justify-content: space-between;
		gap: 1.25rem;
		align-items: flex-start;
	}
	.capability-panel__kicker {
		margin: 0 0 0.35rem !important;
		color: var(--admin-accent, #087f6a) !important;
		font:
			800 0.62rem/1.2 ui-monospace,
			'Cascadia Mono',
			monospace !important;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.capability-panel h2 {
		margin: 0;
		font-size: 1rem;
		line-height: 1.25;
	}
	.capability-panel__header > div > p:last-child {
		max-width: 670px;
		margin: 0.35rem 0 0;
		color: var(--admin-muted, #64748b);
		font-size: 0.76rem;
		line-height: 1.5;
	}
	.capability-panel__actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.7rem;
		flex-wrap: wrap;
		color: var(--admin-muted, #64748b);
		font-size: 0.67rem;
		text-align: right;
	}
	.capability-panel__actions span {
		display: grid;
		gap: 0.1rem;
	}
	.capability-panel button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-height: 34px;
		padding: 0.45rem 0.65rem;
		border: 1px solid color-mix(in srgb, var(--admin-accent, #087f6a) 35%, #dbe4e0);
		border-radius: 8px;
		background: #fff;
		color: var(--admin-accent, #087f6a);
		font: 800 0.68rem/1.2 inherit;
		cursor: pointer;
	}
	.capability-panel button:hover:not(:disabled) {
		background: #f0f8f5;
	}
	.capability-panel button:focus-visible {
		outline: 3px solid color-mix(in srgb, var(--admin-accent, #087f6a) 24%, transparent);
		outline-offset: 2px;
	}
	.capability-panel button:disabled {
		opacity: 0.55;
		cursor: wait;
	}
	.capability-panel__spinner {
		display: inline-block !important;
		animation: capability-spin 0.75s linear infinite;
	}
	.capability-panel__error {
		margin: 0;
		padding: 0.65rem 0.75rem;
		border: 1px solid #efc4c4;
		border-radius: 8px;
		background: #fff4f4;
		color: #9c2929;
		font-size: 0.73rem;
	}
	.capability-panel__disabled {
		margin: 0;
		padding: 0.65rem 0.75rem;
		border: 1px solid #dce4e1;
		border-radius: 8px;
		background: #f7f9f8;
		color: var(--admin-muted, #64748b);
		font-size: 0.72rem;
	}
	.capability-panel__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 265px), 1fr));
		gap: 0.65rem;
	}
	.capability-card {
		display: grid;
		align-content: start;
		gap: 0.65rem;
		min-width: 0;
		padding: 0.8rem;
		border: 1px solid var(--admin-border, #e1e7e4);
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.94);
	}
	.capability-card__topline {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.65rem;
	}
	.capability-card h3 {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.3;
	}
	.capability-card code {
		color: var(--admin-muted, #64748b);
		font-size: 0.58rem;
		overflow-wrap: anywhere;
	}
	.capability-card__badge {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		flex: none;
		max-width: 50%;
		padding: 0.32rem 0.48rem;
		border: 1px solid #dce4e1;
		border-radius: 999px;
		background: #f7f9f8;
		color: #64748b;
		font-size: 0.6rem;
		font-weight: 850;
		line-height: 1.15;
		text-transform: uppercase;
		letter-spacing: 0.035em;
	}
	.capability-card__badge i {
		width: 0.38rem;
		height: 0.38rem;
		border-radius: 50%;
		background: currentColor;
		flex: none;
	}
	.capability-card__badge.is-good {
		border-color: #b5ddcf;
		background: #eef9f5;
		color: #0b765f;
	}
	.capability-card__badge.is-warn {
		border-color: #efd5a9;
		background: #fff7e9;
		color: #9a5d0d;
	}
	.capability-card__badge.is-danger {
		border-color: #efc4c4;
		background: #fff2f2;
		color: #a32d2d;
	}
	.capability-card__reason {
		margin: 0;
		color: var(--admin-muted, #64748b);
		font-size: 0.69rem;
		line-height: 1.45;
	}
	.capability-card__facts {
		display: grid;
		gap: 0.28rem;
		margin: 0;
	}
	.capability-card__facts div {
		display: grid;
		grid-template-columns: minmax(90px, 0.8fr) minmax(0, 1.2fr);
		gap: 0.45rem;
		padding-top: 0.28rem;
		border-top: 1px solid rgba(15, 49, 40, 0.07);
		font-size: 0.64rem;
	}
	.capability-card dt {
		color: var(--admin-muted, #64748b);
	}
	.capability-card dd {
		margin: 0;
		font-weight: 750;
		text-align: right;
		overflow-wrap: anywhere;
	}
	.capability-card__warnings {
		display: grid;
		gap: 0.2rem;
		margin: 0;
		padding-left: 1rem;
		color: #8a580f;
		font-size: 0.65rem;
		line-height: 1.4;
	}
	.capability-card footer {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.55rem;
		margin-top: auto;
	}
	.capability-card__env {
		display: flex;
		gap: 0.22rem;
		min-width: 0;
		flex-wrap: wrap;
	}
	.capability-card__env code {
		padding: 0.18rem 0.3rem;
		border-radius: 4px;
		background: #f2f5f4;
	}
	.capability-card footer button {
		min-height: 29px;
		padding: 0.3rem 0.48rem;
		flex: none;
	}
	.capability-panel__empty {
		display: grid;
		gap: 0.25rem;
		place-items: center;
		min-height: 110px;
		padding: 1rem;
		border: 1px dashed var(--admin-border, #dbe4e0);
		border-radius: 9px;
		background: rgba(255, 255, 255, 0.75);
		color: var(--admin-muted, #64748b);
		font-size: 0.72rem;
		text-align: center;
	}
	.capability-panel--compact .capability-panel__grid {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr));
	}
	.capability-card--compact .capability-card__facts div:nth-child(n + 3) {
		display: none;
	}
	@keyframes capability-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.capability-panel__spinner {
			animation: none;
		}
	}
	@media (max-width: 720px) {
		.capability-panel__header {
			display: grid;
		}
		.capability-panel__actions {
			justify-content: space-between;
			text-align: left;
		}
	}
	@media (max-width: 420px) {
		.capability-panel {
			padding: 0.75rem;
		}
		.capability-card__topline,
		.capability-card footer {
			align-items: flex-start;
			flex-direction: column;
		}
		.capability-card__badge {
			max-width: 100%;
		}
		.capability-card footer button {
			width: 100%;
		}
	}
</style>
