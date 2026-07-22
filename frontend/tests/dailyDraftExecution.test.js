import assert from 'node:assert/strict';
import test from 'node:test';

import {
	dailyDraftStatusLabel,
	isDailyDraftRunActive,
	isDailyDraftRunFailed,
	isDailyDraftRunSuccessful,
	normalizeDailyDraftExecution,
	selectDefaultDailyDraftSchedule,
	selectQueuedDailyDraftExecution
} from '../src/lib/openclaw/dailyDraft.js';

test('selects an explicitly chosen schedule, then an enabled schedule, then the first schedule', () => {
	const schedules = [
		{ id: 'disabled', enabled: false },
		{ id: 'enabled', enabled: true }
	];
	assert.equal(selectDefaultDailyDraftSchedule(schedules, 'disabled').id, 'disabled');
	assert.equal(selectDefaultDailyDraftSchedule(schedules).id, 'enabled');
	assert.equal(selectDefaultDailyDraftSchedule([{ id: 'only', enabled: false }]).id, 'only');
	assert.equal(selectDefaultDailyDraftSchedule([]), null);
});

test('matches only the new execution for the queued schedule', () => {
	const queuedAt = '2026-07-22T02:00:00.000Z';
	const executions = [
		{ id: 'other', scheduleId: 'schedule-b', createdAt: '2026-07-22T02:00:02.000Z' },
		{ id: 'old', scheduleId: 'schedule-a', createdAt: '2026-07-22T01:50:00.000Z' },
		{ id: 'new', scheduleId: 'schedule-a', createdAt: '2026-07-22T02:00:01.000Z' }
	];
	assert.equal(
		selectQueuedDailyDraftExecution(executions, { scheduleId: 'schedule-a', queuedAt }).id,
		'new'
	);
	assert.equal(
		selectQueuedDailyDraftExecution(executions, {
			scheduleId: 'schedule-a',
			queuedAt,
			executionId: 'old'
		}).id,
		'old'
	);
});

test('normalizes auditable execution fields and classifies terminal statuses', () => {
	const run = normalizeDailyDraftExecution({
		id: 'execution-1',
		status: 'draft_created',
		blogId: 'blog-1',
		blogTitle: 'Bản nháp mới',
		contentAction: 'new',
		telegramNotificationStatus: 'sent'
	});
	assert.equal(run.blogId, 'blog-1');
	assert.match(run.output, /content_action=new/);
	assert.equal(isDailyDraftRunActive('queued'), true);
	assert.equal(isDailyDraftRunActive('running'), true);
	assert.equal(isDailyDraftRunSuccessful(run.status), true);
	assert.equal(isDailyDraftRunFailed('blocked'), true);
	assert.equal(dailyDraftStatusLabel('draft_created', false), 'Đã tạo bản nháp');
});
