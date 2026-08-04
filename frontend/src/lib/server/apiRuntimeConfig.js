const REQUIRED_API_CONFIG_NAMES = Object.freeze([
	'API_BASE_URL',
	'PUBLIC_API_KEY',
	'USER_API_KEY',
	'ADMIN_BFF_API_KEY',
	'OPENAI_API_KEY'
]);

const normalizeValue = (value) => String(value || '').trim();

const createConfigError = (message) => {
	const error = new Error(message);
	error.code = 'FRONTEND_RUNTIME_CONFIG_INVALID';
	return error;
};

export const resolveApiRuntimeConfig = ({
	runtimeEnv = {},
	localEnv = {},
	production = false
} = {}) => {
	const legacyLocalApiKey = production
		? ''
		: normalizeValue(runtimeEnv.API_KEY) || normalizeValue(localEnv.API_KEY);
	const readScopedValue = (name) =>
		normalizeValue(runtimeEnv[name]) ||
		(production ? '' : normalizeValue(localEnv[name]) || legacyLocalApiKey);

	return Object.freeze({
		production: Boolean(production),
		apiBaseUrl:
			normalizeValue(runtimeEnv.API_BASE_URL) ||
			(production ? '' : normalizeValue(localEnv.API_BASE_URL)),
		publicApiKey: readScopedValue('PUBLIC_API_KEY'),
		userApiKey: readScopedValue('USER_API_KEY'),
		adminBffApiKey: readScopedValue('ADMIN_BFF_API_KEY'),
		openAiApiKey:
			normalizeValue(runtimeEnv.OPENAI_API_KEY) ||
			(production ? '' : normalizeValue(localEnv.OPENAI_API_KEY))
	});
};

export const resolveApiBaseForExecution = ({
	apiBaseUrl,
	developmentFallback,
	development = false
} = {}) => {
	const configured = normalizeValue(apiBaseUrl);
	const fallback = normalizeValue(developmentFallback);
	if (!development || !configured || !fallback) return configured;

	try {
		// The Compose service name is valid inside Docker but cannot resolve when
		// `vite dev` runs directly on the host. Compose injects its own value into
		// the production build, so this guard is intentionally development-only.
		if (new URL(configured).hostname.toLowerCase() === 'backend') {
			return fallback;
		}
	} catch {
		return configured;
	}

	return configured;
};

export const assertApiRuntimeConfig = (config) => {
	const valuesByName = {
		API_BASE_URL: normalizeValue(config?.apiBaseUrl),
		PUBLIC_API_KEY: normalizeValue(config?.publicApiKey),
		USER_API_KEY: normalizeValue(config?.userApiKey),
		ADMIN_BFF_API_KEY: normalizeValue(config?.adminBffApiKey),
		OPENAI_API_KEY: normalizeValue(config?.openAiApiKey)
	};
	const missing = REQUIRED_API_CONFIG_NAMES.filter((name) => !valuesByName[name]);
	if (missing.length) {
		throw createConfigError(
			`Missing required frontend runtime configuration: ${missing.join(', ')}`
		);
	}

	let parsedBase;
	try {
		parsedBase = new URL(valuesByName.API_BASE_URL);
	} catch {
		throw createConfigError('API_BASE_URL must be an absolute HTTP(S) URL');
	}
	if (
		!['http:', 'https:'].includes(parsedBase.protocol) ||
		parsedBase.username ||
		parsedBase.password
	) {
		throw createConfigError(
			'API_BASE_URL must be an absolute HTTP(S) URL without embedded credentials'
		);
	}

	const scopedKeyNames = ['PUBLIC_API_KEY', 'USER_API_KEY', 'ADMIN_BFF_API_KEY'];
	const distinctKeys = new Set(scopedKeyNames.map((name) => valuesByName[name]));
	if (distinctKeys.size !== scopedKeyNames.length) {
		throw createConfigError('Frontend scoped API keys must use three distinct values');
	}

	return config;
};

export { REQUIRED_API_CONFIG_NAMES };
