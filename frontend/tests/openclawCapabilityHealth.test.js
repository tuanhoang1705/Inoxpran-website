import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	capabilityTone,
	findCapability,
	normalizeCapabilityHealth,
	sanitizeDashboardUrl,
	upsertCapability
} from '../src/lib/openclaw/capabilityHealth.js';
import {
	sanitizeOpenClawClientPayload,
	sanitizeOpenClawErrorMessage
} from '../src/lib/server/openclawClientPayload.js';
import {
	MAX_EMPTY_JSON_BODY_BYTES,
	isExactEmptyJsonBody
} from '../src/lib/server/exactEmptyJsonBody.js';
import { messages } from '../src/lib/i18n/admin/messages.js';

const dashboardLoaderSource = readFileSync(
	new URL('../src/routes/admin/openclaw/+page.server.js', import.meta.url),
	'utf8'
);
const capabilityProxySource = readFileSync(
	new URL(
		'../src/routes/admin/api/openclaw/capabilities/[...segments]/+server.js',
		import.meta.url
	),
	'utf8'
);
const qaProxySource = readFileSync(
	new URL('../src/routes/admin/api/openclaw/qa-batches/[...segments]/+server.js', import.meta.url),
	'utf8'
);
const contentOperationsPageSource = readFileSync(
	new URL('../src/routes/admin/openclaw/content-operations/+page.svelte', import.meta.url),
	'utf8'
);
const contentOperationsLoaderSource = readFileSync(
	new URL('../src/routes/admin/openclaw/content-operations/+page.server.js', import.meta.url),
	'utf8'
);
const qaPageSource = readFileSync(
	new URL('../src/routes/admin/openclaw/content-operations/qa/+page.svelte', import.meta.url),
	'utf8'
);
const capabilityPanelSource = readFileSync(
	new URL('../src/lib/components/admin/openclaw/CapabilityHealthPanel.svelte', import.meta.url),
	'utf8'
);

test('normalizes the canonical capability contract without treating configuration as readiness', () => {
	const health = normalizeCapabilityHealth({
		checkedAt: '2026-07-22T04:00:00.000Z',
		healthEnabled: true,
		actions: { check: true },
		capabilities: {
			seoAgent: {
				featureKey: 'seo_agent',
				enabled: true,
				configured: true,
				checked: false,
				status: 'unknown'
			}
		}
	});

	assert.equal(findCapability(health, 'seoAgent').status, 'unknown');
	assert.equal(capabilityTone(findCapability(health, 'seo_agent')), 'warn');
	assert.equal(health.actions.check, true);
});

test('capability checks fail closed when access metadata is absent', () => {
	const health = normalizeCapabilityHealth({ capabilities: {} });
	assert.equal(health.healthEnabled, false);
	assert.equal(health.actions.check, false);
});

test('distinguishes expected disabled, missing configuration, degraded, and failed states', () => {
	const health = normalizeCapabilityHealth({
		capabilities: {
			a: { enabled: false, configured: true, expectedState: 'disabled' },
			b: { enabled: true, configured: false },
			c: { enabled: true, configured: true, checked: true, status: 'degraded' },
			d: { enabled: true, configured: true, checked: true, status: 'failed' }
		}
	});

	assert.equal(findCapability(health, 'a').status, 'expected_disabled');
	assert.equal(findCapability(health, 'b').status, 'missing_config');
	assert.equal(findCapability(health, 'c').status, 'degraded');
	assert.equal(findCapability(health, 'd').status, 'failed');
});

test('upserts a single retry result without losing other capability results', () => {
	const initial = normalizeCapabilityHealth({
		capabilities: {
			seo_agent: { checked: true, status: 'healthy' },
			telegram: { checked: false, status: 'pending_check' }
		}
	});
	const next = upsertCapability(initial, {
		featureKey: 'telegram',
		checked: true,
		status: 'healthy',
		lastCheckedAt: '2026-07-22T04:05:00.000Z'
	});

	assert.equal(findCapability(next, 'seo_agent').status, 'healthy');
	assert.equal(findCapability(next, 'telegram').status, 'healthy');
});

test('preserves canonical unavailable, disabled, and expected-disabled as distinct states', () => {
	const health = normalizeCapabilityHealth({
		capabilities: {
			unavailable: { enabled: true, configured: true, checked: true, status: 'unavailable' },
			disabled: {
				enabled: false,
				configured: true,
				expectedState: 'disabled',
				status: 'disabled'
			},
			expected: { enabled: false, status: 'expected_disabled' }
		}
	});
	assert.equal(findCapability(health, 'unavailable').status, 'unavailable');
	assert.equal(findCapability(health, 'disabled').status, 'disabled');
	assert.equal(findCapability(health, 'expected').status, 'expected_disabled');
	assert.equal(capabilityTone(findCapability(health, 'unavailable')), 'danger');
});

test('removes gateway tokens, credentials, and sensitive query parameters from dashboard URLs', () => {
	assert.equal(
		sanitizeDashboardUrl('https://admin.inoxpran.com/openclaw-dashboard/#token=super-secret'),
		'https://admin.inoxpran.com/openclaw-dashboard/'
	);
	assert.equal(
		sanitizeDashboardUrl('/openclaw-dashboard/?view=agents&access_token=super-secret'),
		'/openclaw-dashboard/?view=agents'
	);
	assert.equal(sanitizeDashboardUrl('https://user:secret@admin.inoxpran.com/dashboard'), '');
	assert.equal(sanitizeDashboardUrl('javascript:alert(1)'), '');
});

test('redacts structured secrets while preserving safe configuration flags', () => {
	assert.deepEqual(
		sanitizeOpenClawClientPayload({
			gatewayToken: ['secret-a', 'secret-b'],
			apiKey: { value: 'secret-c' },
			apiKeyConfigured: true,
			secretConfigured: 1
		}),
		{
			gatewayToken: '[redacted]',
			apiKey: '[redacted]',
			apiKeyConfigured: true,
			secretConfigured: 1
		}
	);
});

test('redacts credentials embedded in safe-looking backend error strings', () => {
	const safe = sanitizeOpenClawErrorMessage(
		'gatewayToken=secret-a Authorization: Bearer secret-b https://admin.inoxpran.com/?password=secret-c&view=agents'
	);
	assert.doesNotMatch(safe, /secret-[abc]/);
	assert.match(safe, /gatewayToken=\[redacted\]/);
	assert.match(safe, /Authorization=\[redacted\]/);
	assert.match(safe, /password=\[redacted\]/);
});

test('dashboard bootstrap reuses embedded capability health without a duplicate status request', () => {
	assert.match(dashboardLoaderSource, /path:\s*'\/admin\/openclaw'/);
	assert.match(dashboardLoaderSource, /payload\?\.metadata\?\.capabilityHealth/);
	assert.doesNotMatch(dashboardLoaderSource, /\/admin\/openclaw\/capabilities\/status/);
});

test('content operations bootstrap reuses embedded capability health without a duplicate request', () => {
	assert.match(contentOperationsLoaderSource, /path:\s*`\$\{base\}\/status`/);
	assert.match(contentOperationsLoaderSource, /status\?\.capabilityHealth/);
	assert.match(contentOperationsLoaderSource, /sanitizeOpenClawClientPayload\(capabilityHealth\)/);
	assert.doesNotMatch(
		contentOperationsLoaderSource,
		/path:\s*['"]\/admin\/openclaw\/capabilities\/status['"]/
	);
});

test('QA navigation remains permission-gated but visible when production execution is disabled', () => {
	assert.match(contentOperationsPageSource, /qaFeatureAccess\(data\?\.qaAccess\)/);
	assert.match(contentOperationsPageSource, /hasQaActionPermission\(qaAccess, 'view'\)/);
	assert.match(contentOperationsPageSource, /\{#if canViewQa\}/);
});

test('capability panel explains green, amber, and red states in both locales', () => {
	assert.match(capabilityPanelSource, /capabilities\.legend\.good/);
	assert.match(capabilityPanelSource, /capabilities\.legend\.warn/);
	assert.match(capabilityPanelSource, /capabilities\.legend\.danger/);
	for (const locale of ['vi', 'en']) {
		assert.match(messages[locale].admin.contentOperations.capabilities.legend.good, /\S/);
		assert.match(messages[locale].admin.contentOperations.capabilities.legend.warn, /\S/);
		assert.match(messages[locale].admin.contentOperations.capabilities.legend.danger, /\S/);
	}
});

test('new capability and QA proxies keep narrow path allowlists and sanitize responses', () => {
	for (const source of [capabilityProxySource, qaProxySource]) {
		assert.match(source, /const ALLOWED = Object\.freeze/);
		assert.match(source, /sanitizeOpenClawClientPayload/);
		assert.match(source, /sanitizeOpenClawErrorMessage/);
	}
	assert.match(capabilityProxySource, /GET:\s*\[\/\^status\$\/\]/);
	assert.match(capabilityProxySource, /POST:\s*\[\/\^check\$\//);
	assert.match(capabilityProxySource, /Unsupported capability health query/);
	assert.match(capabilityProxySource, /hasExactEmptyBody\(request\)/);
	assert.match(capabilityProxySource, /body:\s*'\{\}'/);
	assert.match(qaProxySource, /new RegExp\(`\^\$\{ID\}\/reports\$`\)/);
	assert.match(qaProxySource, /new RegExp\(`\^\$\{ID\}\/(run|review|remediate)\$`\)/);
	assert.match(qaProxySource, /new RegExp\(`\^\$\{ID\}\/remediation\/\$\{ID\}\/resume\$`\)/);
	assert.match(qaProxySource, /safeQaResumeBody\(body\)/);
	assert.match(qaProxySource, /safeQaEmptyActionBody\(body\)/);
	assert.match(qaProxySource, /const safeListSearch/);
	assert.match(qaProxySource, /new Set\(\['page', 'limit', 'environment'\]\)/);
	assert.match(qaProxySource, /Unsupported Agentic Blog QA query/);
	assert.doesNotMatch(qaProxySource, /\+\s*\(url\.search\s*\|\|\s*''\)/);
});

test('capability proxy accepts only an omitted or exact empty bounded JSON body', () => {
	for (const rawBody of ['', '   ', '{}', '{ }']) {
		assert.equal(isExactEmptyJsonBody({ rawBody }), true);
	}
	for (const rawBody of ['null', '[]', 'true', '{"force":true}', '{broken']) {
		assert.equal(isExactEmptyJsonBody({ rawBody }), false);
	}
	assert.equal(
		isExactEmptyJsonBody({
			rawBody: '{}',
			contentLength: MAX_EMPTY_JSON_BODY_BYTES + 1
		}),
		false
	);
	assert.equal(
		isExactEmptyJsonBody({
			rawBody: ' '.repeat(MAX_EMPTY_JSON_BODY_BYTES + 1)
		}),
		false
	);
});

test('QA UI exposes empty-body resume only through the article-specific eligibility guard', () => {
	assert.match(qaPageSource, /canResumeArticleQaRemediation\(attempt\)/);
	assert.match(qaPageSource, /\/remediation\/\$\{encodeURIComponent\(attemptId\)\}\/resume/);
	assert.match(qaPageSource, /\{ method: 'POST', body: \{\} \}/);
	assert.match(qaPageSource, /remediationNeedsVerifiedCodeEvidence\(attempt\)/);
	assert.match(qaPageSource, /verifiedEvidenceRequired/);
});

test('ships VI and EN labels for every capability status and emitted diagnostic code', () => {
	const statuses = [
		'disabled',
		'expected_disabled',
		'missing_config',
		'pending_check',
		'healthy',
		'degraded',
		'failed',
		'unavailable',
		'manual_review',
		'not_applicable'
	];
	const diagnostics = [
		'capability_health_disabled',
		'capability_health_checks_disabled',
		'safe_rollout_disabled',
		'latest_execution_failed',
		'latest_execution_not_terminal_success',
		'latest_execution_not_successful',
		'persisted_source_stale',
		'source_adapter_not_registered',
		'source_snapshot_not_complete',
		'missing_configuration',
		'disabled_by_configuration',
		'probe_timeout',
		'capability_probe_timeout',
		'invalid_boolean_configuration',
		'invalid_probe_result',
		'database_unavailable',
		'probe_failed',
		'runtime_verified',
		'no_execution_history',
		'latest_snapshot_not_complete',
		'no_snapshot',
		'persisted_snapshot_warning',
		'no_content_operations_snapshot',
		'persisted_source_partial',
		'persisted_source_unavailable',
		'no_persisted_source_check',
		'persisted_source_error',
		'parent_feature_disabled',
		'manual_review_required',
		'no_learning_record',
		'content_operations_disabled',
		'content_learning_auto_apply_disabled',
		'latest_pipeline_failed',
		'no_image_pipeline_history',
		'external_provider_not_probed',
		'external_delivery_not_probed',
		'telegram_bot_api_not_called_by_health_check',
		'external_provider_not_called_by_health_check',
		'gateway_not_ready',
		'probe_not_registered',
		'scheduler_runtime_not_registered',
		'scheduler_workload_inactive',
		'scheduler_workload_overdue',
		'no_enabled_schedule',
		'scheduler_last_run_error',
		'persisted_schedule_disabled',
		'persisted_schedule_missing',
		'snapshot_stale',
		'latest_snapshot_degraded',
		'strict_mode_disabled',
		'no_performance_snapshot',
		'persisted_performance_warning',
		'persisted_inventory_warning',
		'no_inventory_snapshot',
		'no_content_signal_records',
		'latest_content_signal_inactive',
		'gateway_unreachable',
		'gateway_health_timeout',
		'gateway_url_invalid',
		'authentication_failed',
		'permission_denied',
		'runtime_unavailable',
		'stale_runtime',
		'manual_verification_required'
	];

	for (const locale of ['vi', 'en']) {
		const contentOperations = messages[locale].admin.contentOperations;
		for (const status of statuses) {
			assert.equal(typeof contentOperations.status[status], 'string', `${locale}:${status}`);
		}
		for (const code of diagnostics) {
			assert.equal(
				typeof contentOperations.capabilities.reasons[code],
				'string',
				`${locale}:${code}`
			);
		}
	}
	assert.deepEqual(
		Object.keys(messages.vi.admin.contentOperations.capabilities.reasons).sort(),
		Object.keys(messages.en.admin.contentOperations.capabilities.reasons).sort()
	);
});
