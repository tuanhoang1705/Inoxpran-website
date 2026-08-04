const STATUS_ALIASES = Object.freeze({
	available: 'healthy',
	complete: 'healthy',
	completed: 'healthy',
	ready: 'healthy'
});

const SCHEDULER_CAPABILITY_KEYS = new Set([
	'blog_cron',
	'content_operations_cron',
	'google_intelligence',
	'content_performance_monitoring'
]);
const DEFAULT_SCHEDULER_POLL_INTERVAL_MS = 30_000;
const MINIMUM_SCHEDULER_FRESHNESS_MS = 60_000;

const SENSITIVE_URL_KEY = /(token|secret|api[_-]?key|authorization|credential|password)/i;

const containsControlCharacter = (value) => {
	for (const character of String(value)) {
		const codePoint = character.codePointAt(0);
		if (codePoint <= 0x1f || codePoint === 0x7f) return true;
	}
	return false;
};

export const CAPABILITY_ENV_KEYS = Object.freeze({
	seo_agent: [
		'SEO_AGENT_ENABLED',
		'API_KEY',
		'SEO_AGENT_API_KEY',
		'SEO_AGENT_HMAC_SECRET',
		'OPENAI_API_KEY'
	],
	openclaw_gateway: ['OPENCLAW_GATEWAY_TOKEN'],
	blog_cron: ['OPENCLAW_BLOG_CRON_ENABLED'],
	content_operations: ['CONTENT_OPERATIONS_ENABLED'],
	content_operations_cron: ['CONTENT_OPERATIONS_CRON_ENABLED'],
	content_performance_monitoring: ['CONTENT_PERFORMANCE_MONITORING_ENABLED'],
	content_learning: ['CONTENT_LEARNING_ENABLED'],
	google_intelligence: ['GOOGLE_INTELLIGENCE_ENABLED'],
	search_console: [
		'SEARCH_CONSOLE_ENABLED',
		'SEARCH_CONSOLE_PROPERTY',
		'GOOGLE_SEARCH_CONSOLE_PROPERTY',
		'SEARCH_CONSOLE_SITE_URL',
		'GOOGLE_APPLICATION_CREDENTIALS'
	],
	content_analytics: ['CONTENT_ANALYTICS_ENABLED'],
	market_trends: ['CONTENT_TRENDS_ENABLED', 'CONTENT_TRENDS_PROVIDER'],
	content_inventory: ['CONTENT_INVENTORY_ENABLED'],
	content_signals: ['CONTENT_SIGNALS_ENABLED'],
	image_pipeline: ['OPENCLAW_IMAGE_PIPELINE_ENABLED', 'IMAGE_SEARCH_PROVIDER', 'AI_IMAGE_PROVIDER'],
	image_search: ['IMAGE_SEARCH_PROVIDER', 'IMAGE_SEARCH_API_KEY'],
	ai_image: ['AI_IMAGE_PROVIDER', 'AI_IMAGE_API_KEY', 'OPENAI_API_KEY'],
	telegram_bot: [
		'TELEGRAM_BOT_ENABLED',
		'TELEGRAM_MODE',
		'TELEGRAM_BOT_TOKEN',
		'TELEGRAM_WEBHOOK_SECRET',
		'TELEGRAM_ALLOWED_CHAT_IDS',
		'TELEGRAM_ALLOWED_USER_IDS',
		'TELEGRAM_NOTIFY_CHAT_IDS',
		'ADMIN_BASE_URL'
	]
});

export const normalizeFeatureKey = (value) =>
	String(value || '')
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[^A-Za-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();

export const humanizeCapabilityToken = (value) => {
	const text = String(value || '')
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_:.-]+/g, ' ')
		.replace(/\s+/g, ' ');
	return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

const normalizeStatus = (value) => {
	const status = normalizeFeatureKey(value || 'unknown');
	return STATUS_ALIASES[status] || status || 'unknown';
};

const isExpectedDisabled = (value) =>
	value === false ||
	['disabled', 'off', 'false', 'not_applicable'].includes(normalizeFeatureKey(value));

export const normalizeCapability = (value = {}, fallbackKey = '') => {
	const source = value && typeof value === 'object' ? value : {};
	const featureKey = normalizeFeatureKey(source.featureKey || source.key || fallbackKey);
	const enabled = source.enabled !== false;
	const configured = source.configured !== false;
	const checked = source.checked === true || Boolean(source.lastCheckedAt || source.checkedAt);
	const hasExplicitStatus = Boolean(String(source.status || '').trim());
	let status = normalizeStatus(hasExplicitStatus ? source.status : source.availability);

	if (!hasExplicitStatus) {
		if (!enabled) {
			status = isExpectedDisabled(source.expectedState) ? 'expected_disabled' : 'disabled';
		} else if (!configured) {
			status = 'missing_config';
		} else if ((!status || status === 'unknown') && !checked) {
			status = 'pending_check';
		}
	}

	return {
		featureKey,
		labelKey: String(source.labelKey || '').trim(),
		enabled,
		configured,
		checked,
		status,
		expectedState: source.expectedState ?? null,
		reasonCode: normalizeFeatureKey(source.reasonCode || ''),
		messageKey: String(source.messageKey || '').trim(),
		lastCheckedAt: source.lastCheckedAt || source.checkedAt || null,
		latencyMs:
			source.latencyMs !== null &&
			source.latencyMs !== undefined &&
			Number.isFinite(Number(source.latencyMs))
				? Math.max(0, Number(source.latencyMs))
				: null,
		runtime: source.runtime && typeof source.runtime === 'object' ? source.runtime : {},
		warnings: Array.isArray(source.warnings)
			? source.warnings.map((warning) => String(warning).slice(0, 240)).slice(0, 8)
			: [],
		safeDetails:
			source.safeDetails && typeof source.safeDetails === 'object' ? source.safeDetails : {}
	};
};

export const normalizeCapabilityHealth = (payload = {}) => {
	const root = payload?.metadata ?? payload ?? {};
	const source = root?.capabilityHealth ?? root?.health ?? root;
	const rawCapabilities = source?.capabilities ?? source?.items ?? {};
	const capabilities = {};

	if (Array.isArray(rawCapabilities)) {
		for (const item of rawCapabilities) {
			const normalized = normalizeCapability(item);
			if (normalized.featureKey) capabilities[normalized.featureKey] = normalized;
		}
	} else if (rawCapabilities && typeof rawCapabilities === 'object') {
		for (const [key, item] of Object.entries(rawCapabilities)) {
			const normalized = normalizeCapability(item, key);
			if (normalized.featureKey) capabilities[normalized.featureKey] = normalized;
		}
	}

	return {
		checkedAt: source?.checkedAt || source?.lastCheckedAt || null,
		healthEnabled: source?.healthEnabled === true,
		actions: {
			check:
				source?.actions?.check === true ||
				(Array.isArray(source?.actions) && source.actions.includes('check'))
		},
		cacheSeconds: Number.isFinite(Number(source?.cacheSeconds))
			? Number(source.cacheSeconds)
			: null,
		timeoutMs: Number.isFinite(Number(source?.timeoutMs)) ? Number(source.timeoutMs) : null,
		capabilities
	};
};

const triStateBoolean = (value) => (value === true ? true : value === false ? false : null);

/**
 * `workerActive` on scheduler capabilities is a busy flag for the current tick,
 * not a liveness flag. Derive an operator-facing state from scheduler authority
 * and its heartbeat while keeping unknown values unknown.
 */
export const schedulerWorkerReadiness = (capability = {}, { now = Date.now() } = {}) => {
	const normalized = normalizeCapability(capability);
	if (!SCHEDULER_CAPABILITY_KEYS.has(normalized.featureKey)) {
		return { applies: false, state: 'not_applicable', reasonCode: '' };
	}

	if (!normalized.checked) {
		return { applies: true, state: 'unknown', reasonCode: 'health_not_checked' };
	}

	const runtime = normalized.runtime || {};
	const schedulerActive = triStateBoolean(runtime.schedulerActive);
	if (schedulerActive === null) {
		return { applies: true, state: 'unknown', reasonCode: 'scheduler_state_unknown' };
	}
	if (!schedulerActive) {
		return { applies: true, state: 'unavailable', reasonCode: 'scheduler_disabled' };
	}

	const heartbeatAt = runtime.lastHeartbeatAt ? new Date(runtime.lastHeartbeatAt).getTime() : NaN;
	if (!Number.isFinite(heartbeatAt)) {
		return { applies: true, state: 'unavailable', reasonCode: 'heartbeat_missing' };
	}

	const nowMs = now instanceof Date ? now.getTime() : Number(now);
	if (!Number.isFinite(nowMs)) {
		return { applies: true, state: 'unknown', reasonCode: 'clock_unknown' };
	}
	const configuredPollMs = Number(runtime.pollIntervalMs);
	const pollIntervalMs =
		Number.isFinite(configuredPollMs) && configuredPollMs > 0
			? Math.max(1_000, configuredPollMs)
			: DEFAULT_SCHEDULER_POLL_INTERVAL_MS;
	const freshnessLimitMs = Math.max(MINIMUM_SCHEDULER_FRESHNESS_MS, pollIntervalMs * 3);
	if (nowMs - heartbeatAt > freshnessLimitMs) {
		return { applies: true, state: 'unavailable', reasonCode: 'heartbeat_stale' };
	}

	const workerActive = triStateBoolean(runtime.workerActive);
	if (workerActive === true) {
		return { applies: true, state: 'processing', reasonCode: 'tick_in_progress' };
	}
	if (workerActive === false) {
		return { applies: true, state: 'ready_idle', reasonCode: 'waiting_for_work' };
	}
	return { applies: true, state: 'ready', reasonCode: 'tick_state_unknown' };
};

export const capabilityList = (health) =>
	Object.values(normalizeCapabilityHealth(health).capabilities).sort((a, b) =>
		a.featureKey.localeCompare(b.featureKey)
	);

export const findCapability = (health, ...keys) => {
	const capabilities = normalizeCapabilityHealth(health).capabilities;
	for (const key of keys) {
		const normalizedKey = normalizeFeatureKey(key);
		if (capabilities[normalizedKey]) return capabilities[normalizedKey];
	}
	return null;
};

export const upsertCapability = (health, capability) => {
	const normalizedHealth = normalizeCapabilityHealth(health);
	const normalizedCapability = normalizeCapability(capability);
	if (!normalizedCapability.featureKey) return normalizedHealth;
	return {
		...normalizedHealth,
		checkedAt: normalizedCapability.lastCheckedAt || normalizedHealth.checkedAt,
		capabilities: {
			...normalizedHealth.capabilities,
			[normalizedCapability.featureKey]: normalizedCapability
		}
	};
};

export const capabilityTone = (capability = {}) => {
	const normalized = normalizeCapability(capability);
	if (
		normalized.status === 'healthy' &&
		normalized.enabled &&
		normalized.configured &&
		normalized.checked
	)
		return 'good';
	if (['failed', 'unavailable', 'missing_config'].includes(normalized.status)) return 'danger';
	if (normalized.status === 'degraded') return 'warn';
	return 'muted';
};

export const capabilityHealthOverallTone = (health = {}) => {
	const normalizedHealth = normalizeCapabilityHealth(health);
	const capabilities = Object.values(normalizedHealth.capabilities);
	const tones = capabilities.map((capability) => capabilityTone(capability));
	if (tones.includes('danger')) return 'danger';
	if (tones.includes('warn')) return 'warn';
	if (!normalizedHealth.healthEnabled) return 'muted';

	const enabledCapabilities = capabilities.filter((capability) => capability.enabled);
	const allEnabledVerifiedHealthy =
		enabledCapabilities.length > 0 &&
		enabledCapabilities.every(
			(capability) => capability.checked && capability.configured && capability.status === 'healthy'
		);
	const allOtherCapabilitiesIntentional = capabilities
		.filter((capability) => !capability.enabled)
		.every((capability) =>
			['disabled', 'expected_disabled', 'not_applicable'].includes(capability.status)
		);

	return allEnabledVerifiedHealthy && allOtherCapabilitiesIntentional ? 'good' : 'muted';
};

export const capabilityStatusTranslationKey = (status) =>
	`admin.contentOperations.status.${normalizeStatus(status)}`;

export const capabilityFeatureTranslationKey = (featureKey) =>
	`admin.contentOperations.capabilities.features.${normalizeFeatureKey(featureKey)}`;

export const capabilityReasonTranslationKey = (reasonCode) =>
	`admin.contentOperations.capabilities.reasons.${normalizeFeatureKey(reasonCode)}`;

export const capabilityEnvKeys = (featureKey) =>
	CAPABILITY_ENV_KEYS[normalizeFeatureKey(featureKey)] || [];

export const sanitizeDashboardUrl = (value, baseUrl = 'https://admin.inoxpran.com') => {
	const raw = String(value || '').trim();
	if (!raw || containsControlCharacter(raw)) return '';

	try {
		const relative = raw.startsWith('/');
		const parsed = new URL(raw, baseUrl);
		if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
			return '';
		parsed.hash = '';
		for (const key of [...parsed.searchParams.keys()]) {
			if (SENSITIVE_URL_KEY.test(key)) parsed.searchParams.delete(key);
		}
		return relative ? `${parsed.pathname}${parsed.search}` : parsed.toString();
	} catch {
		return '';
	}
};
