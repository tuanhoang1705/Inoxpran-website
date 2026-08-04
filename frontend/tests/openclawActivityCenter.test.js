import assert from 'node:assert/strict';
import test from 'node:test';
import {
	OPENCLAW_ACTIVITY_STORAGE_KEY,
	createOpenClawActivityStore,
	openClawActivityStatus
} from '../src/lib/openclaw/activityCenter.js';

const memoryStorage = () => {
	const values = new Map();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key),
		values
	};
};

test('activity status exposes only running, succeeded, and failed', () => {
	assert.equal(openClawActivityStatus('queued'), 'running');
	assert.equal(openClawActivityStatus('retry_wait'), 'running');
	assert.equal(openClawActivityStatus('completed'), 'succeeded');
	assert.equal(openClawActivityStatus('skipped'), 'succeeded');
	assert.equal(openClawActivityStatus('awaiting_remediation_action'), 'succeeded');
	assert.equal(openClawActivityStatus('partial'), 'failed');
	assert.equal(openClawActivityStatus('timed_out'), 'failed');
});

test('activity store deduplicates by key and marks a terminal transition unread', () => {
	let now = 10;
	const storage = memoryStorage();
	const store = createOpenClawActivityStore({ getStorage: () => storage, now: () => now });
	store.upsert({ key: 'schedule:1', title: 'Schedule 1', status: 'running' });
	now = 20;
	store.upsert({ key: 'schedule:1', status: 'completed', message: 'Done' });
	const items = store.getItems();
	assert.equal(items.length, 1);
	assert.equal(items[0].status, 'succeeded');
	assert.equal(items[0].unread, true);
	assert.equal(items[0].createdAt, 10);
	assert.equal(items[0].completedAt, 20);
	assert.ok(storage.values.has(OPENCLAW_ACTIVITY_STORAGE_KEY));
});

test('activity store persists across recreation and keeps only the configured limit', () => {
	let now = 0;
	const storage = memoryStorage();
	const first = createOpenClawActivityStore({
		getStorage: () => storage,
		now: () => ++now,
		limit: 3
	});
	for (let index = 0; index < 5; index += 1) {
		first.upsert({ key: `item:${index}`, title: `Item ${index}`, status: 'running' });
	}
	assert.deepEqual(
		first.getItems().map((item) => item.key),
		['item:4', 'item:3', 'item:2']
	);

	const recreated = createOpenClawActivityStore({ getStorage: () => storage, limit: 3 });
	recreated.hydrate();
	assert.deepEqual(
		recreated.getItems().map((item) => item.key),
		['item:4', 'item:3', 'item:2']
	);
});

test('clearCompleted retains running activities', () => {
	const store = createOpenClawActivityStore({ getStorage: () => null });
	store.upsert({ key: 'running', status: 'running' });
	store.upsert({ key: 'done', status: 'running' });
	store.upsert({ key: 'done', status: 'completed' });
	store.clearCompleted();
	assert.deepEqual(
		store.getItems().map((item) => item.key),
		['running']
	);
});
