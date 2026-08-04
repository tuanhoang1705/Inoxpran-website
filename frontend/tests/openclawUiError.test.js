import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	normalizeOpenClawUiError,
	openClawUiErrorText,
	safeOpenClawUiErrorCode,
	safeOpenClawUiRequestId
} from '../src/lib/openclaw/uiError.js';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const loaderSources = [
	'src/routes/admin/openclaw/blogs/settings/+page.server.js',
	'src/routes/admin/openclaw/blogs/settings/console/+page.server.js',
	'src/routes/admin/openclaw/blogs/settings/operations/+page.server.js',
	'src/routes/admin/openclaw/blogs/settings/operations/qa/+page.server.js',
	'src/routes/admin/openclaw/google-intelligence/+page.server.js'
].map(read);

const uiSources = [
	'src/routes/admin/openclaw/blogs/settings/+page.svelte',
	'src/routes/admin/openclaw/blogs/settings/console/+page.svelte',
	'src/routes/admin/openclaw/blogs/settings/operations/+page.svelte',
	'src/routes/admin/openclaw/blogs/settings/operations/qa/+page.svelte',
	'src/routes/admin/openclaw/google-intelligence/+page.svelte',
	'src/lib/components/admin/openclaw/CapabilityHealthPanel.svelte'
].map(read);

test('OpenClaw UI errors accept only allowlisted codes and safe request ids', () => {
	assert.equal(safeOpenClawUiErrorCode('OPENCLAW_BACKEND_TIMEOUT'), 'OPENCLAW_BACKEND_TIMEOUT');
	assert.equal(safeOpenClawUiErrorCode('RAW_STACK_TRACE'), '');
	assert.equal(safeOpenClawUiRequestId('request-1:worker.2'), 'request-1:worker.2');
	assert.equal(safeOpenClawUiRequestId('bad id/with?query=secret'), '');
	assert.equal(safeOpenClawUiRequestId('a'.repeat(129)), '');

	assert.deepEqual(
		normalizeOpenClawUiError(
			{
				errorCode: 'RAW_STACK_TRACE',
				requestId: 'bad id',
				message: 'token=secret https://internal.example/stack'
			},
			'OPENCLAW_QA_LOAD_FAILED'
		),
		{ errorCode: 'OPENCLAW_QA_LOAD_FAILED', requestId: '' }
	);
});

test('OpenClaw UI error copy is localized and includes only a validated reference', () => {
	const value = { errorCode: 'OPENCLAW_BACKEND_TIMEOUT', requestId: 'req-2026.07.29' };
	const vi = openClawUiErrorText(value, { isEn: false });
	const en = openClawUiErrorText(value, { isEn: true });

	assert.match(vi, /Dịch vụ phản hồi quá thời gian/);
	assert.match(vi, /Mã tra cứu: req-2026\.07\.29/);
	assert.match(en, /service took too long/i);
	assert.match(en, /Reference: req-2026\.07\.29/);
	assert.doesNotMatch(
		openClawUiErrorText(
			{ errorCode: 'UNKNOWN', requestId: 'bad id', message: 'Authorization: Bearer secret' },
			{ isEn: true }
		),
		/UNKNOWN|Authorization|Bearer|secret|bad id/
	);
});

test('OpenClaw admin loaders never serialize raw upstream error text', () => {
	for (const source of loaderSources) {
		assert.match(source, /normalizeOpenClawUiError/);
		assert.doesNotMatch(source, /Internal Server Error/);
		assert.doesNotMatch(source, /payload\?\.message/);
		assert.doesNotMatch(source, /sanitizeOpenClawErrorMessage/);
	}
});

test('OpenClaw admin request failures are mapped before reaching visible UI', () => {
	for (const source of uiSources) {
		assert.match(source, /openClawUiErrorText/);
		assert.doesNotMatch(source, /payload\?\.error/);
		assert.doesNotMatch(source, /cause\.message/);
		assert.doesNotMatch(source, /error instanceof Error[\s\S]{0,100}error\.message/);
	}

	const consoleSource = uiSources[1];
	const googleIntelligenceSource = uiSources[4];
	assert.doesNotMatch(consoleSource, /selectedRun\.output\s*\|\|\s*selectedRun\.error/);
	assert.doesNotMatch(googleIntelligenceSource, /source\.lastError\s*\|\|/);
	assert.doesNotMatch(googleIntelligenceSource, /\$\{execution\.error\}/);
});
