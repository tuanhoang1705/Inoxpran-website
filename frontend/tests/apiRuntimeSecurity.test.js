import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertApiRuntimeConfig,
	resolveApiBaseForExecution,
	resolveApiRuntimeConfig
} from '../src/lib/server/apiRuntimeConfig.js';
import {
	buildHostOnlyCookieOptions,
	resolveLegacyCookieDomain,
	shouldUseSecureCookies
} from '../src/lib/server/cookieSecurity.js';

test('local API config supports the legacy key only as a development fallback', () => {
	const config = resolveApiRuntimeConfig({
		runtimeEnv: {},
		localEnv: {
			API_BASE_URL: 'http://localhost:3056/v1/api',
			API_KEY: 'local-legacy-key',
			OPENAI_API_KEY: 'local-openai-key'
		},
		production: false
	});

	assert.equal(config.publicApiKey, 'local-legacy-key');
	assert.equal(config.userApiKey, 'local-legacy-key');
	assert.equal(config.adminBffApiKey, 'local-legacy-key');
	assert.equal(config.openAiApiKey, 'local-openai-key');
});

test('host Vite development never tries to resolve the Docker-only backend hostname', () => {
	assert.equal(
		resolveApiBaseForExecution({
			apiBaseUrl: 'http://backend:3056/v1/api',
			developmentFallback: 'http://localhost:3056/v1/api',
			development: true
		}),
		'http://localhost:3056/v1/api'
	);
	assert.equal(
		resolveApiBaseForExecution({
			apiBaseUrl: 'http://backend:3056/v1/api',
			developmentFallback: 'http://localhost:3056/v1/api',
			development: false
		}),
		'http://backend:3056/v1/api'
	);
});

test('production ignores legacy and local-file API key values', () => {
	const config = resolveApiRuntimeConfig({
		runtimeEnv: { API_KEY: 'legacy-production-secret' },
		localEnv: {
			API_BASE_URL: 'https://local.invalid/v1/api',
			PUBLIC_API_KEY: 'local-public-secret',
			USER_API_KEY: 'local-user-secret',
			ADMIN_BFF_API_KEY: 'local-admin-secret',
			OPENAI_API_KEY: 'local-openai-secret'
		},
		production: true
	});

	assert.equal(config.apiBaseUrl, '');
	assert.equal(config.publicApiKey, '');
	assert.equal(config.userApiKey, '');
	assert.equal(config.adminBffApiKey, '');
	assert.equal(config.openAiApiKey, '');
});

test('runtime validation fails closed without leaking configured secret values', () => {
	const configuredSecret = 'do-not-echo-this-secret';
	const config = resolveApiRuntimeConfig({
		runtimeEnv: {
			API_BASE_URL: 'https://backend.internal/v1/api',
			PUBLIC_API_KEY: configuredSecret
		},
		production: true
	});

	assert.throws(
		() => assertApiRuntimeConfig(config),
		(error) => {
			assert.equal(error.code, 'FRONTEND_RUNTIME_CONFIG_INVALID');
			assert.match(error.message, /USER_API_KEY/);
			assert.match(error.message, /ADMIN_BFF_API_KEY/);
			assert.doesNotMatch(error.message, new RegExp(configuredSecret));
			return true;
		}
	);
});

test('runtime validation accepts a credential-free base URL and distinct scoped keys', () => {
	const config = resolveApiRuntimeConfig({
		runtimeEnv: {
			API_BASE_URL: 'http://backend:3056/v1/api',
			PUBLIC_API_KEY: 'public-key',
			USER_API_KEY: 'user-key',
			ADMIN_BFF_API_KEY: 'admin-key',
			OPENAI_API_KEY: 'openai-key'
		},
		production: true
	});

	assert.equal(assertApiRuntimeConfig(config), config);
});

test('runtime validation rejects key reuse and URL credentials without echoing either', () => {
	const sharedSecret = 'shared-secret-value';
	const duplicateConfig = resolveApiRuntimeConfig({
		runtimeEnv: {
			API_BASE_URL: 'https://backend.internal/v1/api',
			PUBLIC_API_KEY: sharedSecret,
			USER_API_KEY: sharedSecret,
			ADMIN_BFF_API_KEY: 'admin-key',
			OPENAI_API_KEY: 'openai-key'
		},
		production: true
	});
	assert.throws(
		() => assertApiRuntimeConfig(duplicateConfig),
		(error) => {
			assert.match(error.message, /distinct values/);
			assert.doesNotMatch(error.message, new RegExp(sharedSecret));
			return true;
		}
	);

	const credentialUrlConfig = resolveApiRuntimeConfig({
		runtimeEnv: {
			API_BASE_URL: 'https://operator:password@backend.internal/v1/api',
			PUBLIC_API_KEY: 'public-key',
			USER_API_KEY: 'user-key',
			ADMIN_BFF_API_KEY: 'admin-key',
			OPENAI_API_KEY: 'openai-key'
		},
		production: true
	});
	assert.throws(
		() => assertApiRuntimeConfig(credentialUrlConfig),
		(error) => {
			assert.doesNotMatch(error.message, /operator|password/);
			return true;
		}
	);
});

test('session cookies are Secure in production or HTTPS, but remain usable on localhost dev', () => {
	assert.equal(
		shouldUseSecureCookies({ siteUrl: 'http://localhost:5173', nodeEnv: 'development' }),
		false
	);
	assert.equal(
		shouldUseSecureCookies({ siteUrl: 'https://staging.inoxpran.com', nodeEnv: 'development' }),
		true
	);
	assert.equal(
		shouldUseSecureCookies({ siteUrl: 'http://localhost:5173', nodeEnv: 'production' }),
		true
	);

	const productionOptions = buildHostOnlyCookieOptions({
		siteUrl: 'https://inoxpran.com',
		nodeEnv: 'production',
		maxAge: 3600
	});
	assert.equal(productionOptions.secure, true);
	assert.equal(productionOptions.httpOnly, true);
	assert.equal(productionOptions.sameSite, 'lax');
	assert.equal(productionOptions.maxAge, 3600);
	assert.equal(Object.hasOwn(productionOptions, 'domain'), false);
});

test('legacy domain cookies can be expired without making new session cookies domain-wide', () => {
	assert.equal(resolveLegacyCookieDomain('https://inoxpran.com'), 'inoxpran.com');
	assert.equal(resolveLegacyCookieDomain('http://localhost:5173'), undefined);
	assert.equal(resolveLegacyCookieDomain('not a URL'), undefined);
});
