import assert from 'node:assert/strict';
import test from 'node:test';

import { sourceState, statusTone } from '../src/lib/contentOperations/contracts.js';

test('source health distinguishes disabled, configuration, degradation, and failure', () => {
	assert.equal(sourceState({ enabled: false, configured: true, status: 'failed' }), 'disabled');
	assert.equal(
		sourceState({ enabled: true, configured: false, status: 'unavailable' }),
		'not_configured'
	);
	assert.equal(sourceState({ enabled: true, configured: true, status: 'partial' }), 'degraded');
	assert.equal(sourceState({ enabled: true, configured: true, status: 'failed' }), 'failed');
	assert.equal(sourceState({ enabled: true, configured: true, status: 'available' }), 'ready');
});

test('missing sources and legacy snapshots remain backward compatible', () => {
	assert.equal(sourceState(), 'unknown');
	assert.equal(sourceState({ configured: true, status: 'available' }), 'ready');
	assert.equal(sourceState({ configured: true, status: 'partial' }), 'degraded');
	assert.equal(sourceState({ configured: true, status: 'unavailable' }), 'unavailable');
});

test('status tones recognize healthy source vocabulary', () => {
	for (const status of ['available', 'fresh', 'enabled', 'active', 'stable', 'verified', 'ready']) {
		assert.equal(statusTone(status), 'good');
	}
	assert.equal(statusTone('degraded'), 'warn');
	assert.equal(statusTone('not_configured'), 'warn');
	assert.equal(statusTone('failed'), 'danger');
	assert.equal(statusTone('disabled'), 'muted');
	assert.equal(statusTone('unknown'), 'muted');
});
