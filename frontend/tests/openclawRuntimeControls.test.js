import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
	safeRuntimeControlBody,
	safeRuntimeControlIdempotencyKey,
	safeRuntimeControlKey
} from '../src/lib/server/openclawRuntimeControlRequest.js';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('runtime control request helpers enforce exact fail-closed contracts', () => {
	assert.equal(safeRuntimeControlKey('blog_cron'), 'blog_cron');
	assert.equal(safeRuntimeControlKey('seo_agent'), '');
	assert.equal(safeRuntimeControlIdempotencyKey('runtime-request-001'), 'runtime-request-001');
	assert.equal(safeRuntimeControlIdempotencyKey('short'), '');

	const valid = {
		enabled: true,
		expectedRevision: 0,
		reason: 'Controlled production rollout approved',
		acknowledgement: 'ACKNOWLEDGE BLOG_CRON ENABLE'
	};
	assert.deepEqual(safeRuntimeControlBody(valid), valid);
	assert.equal(safeRuntimeControlBody({ ...valid, unexpected: true }), null);
	assert.equal(safeRuntimeControlBody({ ...valid, reason: 'short' }), null);
	assert.equal(safeRuntimeControlBody({ ...valid, expectedRevision: -1 }), null);
});

test('Daily Draft exposes four audited switches and a guarded confirmation dialog', () => {
	const source = read('src/routes/admin/openclaw/daily-draft/+page.svelte');
	for (const key of ['blog_cron', 'auto_publish', 'telegram_approval', 'image_pipeline']) {
		assert.match(source, new RegExp(`openRuntimeControlDialog\\('${key}'\\)`));
	}
	assert.match(source, /role="switch"/);
	assert.match(source, /expectedRevision/);
	assert.match(source, /Idempotency-Key/);
	assert.match(source, /controlAcknowledged/);
	assert.match(source, /readyToEnable/);
	assert.match(source, /LIVE RUNTIME \/ AUDITED/);
	assert.doesNotMatch(source, /openRuntimeControlDialog\('openclaw_gateway'\)/);
	assert.doesNotMatch(source, /openRuntimeControlDialog\('seo_agent'\)/);
});

test('runtime-control proxy permits only GET root and PATCH allowlisted controls', () => {
	const source = read('src/routes/admin/api/openclaw/runtime-controls/[...segments]/+server.js');
	assert.match(source, /safeRuntimeControlKey/);
	assert.match(source, /safeRuntimeControlBody/);
	assert.match(source, /safeRuntimeControlIdempotencyKey/);
	assert.match(source, /export const GET/);
	assert.match(source, /export const PATCH/);
	assert.doesNotMatch(source, /export const POST/);
	assert.match(source, /\/admin\/openclaw\/runtime-controls/);
});

test('Daily Draft server load includes runtime controls without exposing raw backend errors', () => {
	const source = read('src/routes/admin/openclaw/daily-draft/+page.server.js');
	assert.match(source, /path: '\/admin\/openclaw\/runtime-controls'/);
	assert.match(source, /sanitizeOpenClawClientPayload/);
	assert.match(source, /runtimeControls:/);
});
