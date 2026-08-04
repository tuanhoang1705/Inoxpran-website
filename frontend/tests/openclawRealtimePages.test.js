import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
const layout = read('src/routes/admin/openclaw/blogs/+layout.svelte');
const consolePage = read('src/routes/admin/openclaw/blogs/settings/console/+page.svelte');
const operationsPage = read('src/routes/admin/openclaw/blogs/settings/operations/+page.svelte');
const qaPage = read('src/routes/admin/openclaw/blogs/settings/operations/qa/+page.svelte');

test('Blog OpenClaw layout owns one session activity center', () => {
	assert.match(layout, /OpenClawActivityCenter/);
	assert.match(layout, /\{@render children\(\)\}/);
});

test('BOS console uses smart polling for durable running commands', () => {
	assert.match(consolePage, /createSmartPoller/);
	assert.match(consolePage, /activeIntervalMs: 2500/);
	assert.match(consolePage, /idleIntervalMs: 15000/);
	for (const status of ['queued', 'running', 'completed', 'failed', 'timed_out']) {
		assert.ok(consolePage.includes(status), `console must map ${status}`);
	}
	assert.ok(!consolePage.includes('setInterval('));
});

test('Content Operations polls active runs and work-order stages', () => {
	assert.match(operationsPage, /createSmartPoller/);
	assert.match(operationsPage, /ACTIVE_WORK_ORDER_STATUSES/);
	for (const status of ['researching', 'drafting', 'reviewing']) {
		assert.ok(operationsPage.includes(status), `operations must track ${status}`);
	}
	assert.match(operationsPage, /refreshOperationsSupportingData/);
	assert.match(operationsPage, /onSettled: refreshOperationsCanonical/);
});

test('QA polls active batches, cases, and remediation attempts', () => {
	assert.match(qaPage, /createSmartPoller/);
	for (const status of [
		'reserved',
		'queued',
		'running',
		'draft_created',
		'reviewing',
		'remediating',
		'in_progress',
		'awaiting_remediation_action',
		'passed',
		'failed',
		'blocked'
	]) {
		assert.ok(qaPage.includes(status), `QA must map ${status}`);
	}
	assert.match(qaPage, /activeIntervalMs: 3000/);
	assert.match(qaPage, /idleIntervalMs: 15000/);
});
