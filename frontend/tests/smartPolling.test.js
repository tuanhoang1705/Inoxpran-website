import assert from 'node:assert/strict';
import test from 'node:test';
import { createSmartPoller, mapWithConcurrency } from '../src/lib/openclaw/smartPolling.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

const fakeRuntime = () => {
	let timerId = 0;
	let now = 0;
	let online = true;
	let visible = true;
	const timers = new Map();
	const listeners = new Map();
	const target = {
		addEventListener(type, callback) {
			const entries = listeners.get(type) || new Set();
			entries.add(callback);
			listeners.set(type, entries);
		},
		removeEventListener(type, callback) {
			listeners.get(type)?.delete(callback);
		}
	};
	const environment = {
		now: () => now,
		setTimeout(callback, delay) {
			timerId += 1;
			timers.set(timerId, { callback, delay });
			return timerId;
		},
		clearTimeout(id) {
			timers.delete(id);
		},
		random: () => 0.5,
		isOnline: () => online,
		isVisible: () => visible,
		windowTarget: target,
		documentTarget: target,
		createAbortController: () => new AbortController()
	};
	return {
		environment,
		timers,
		setNow(value) {
			now = value;
		},
		setOnline(value) {
			online = value;
		},
		setVisible(value) {
			visible = value;
		},
		emit(type) {
			for (const callback of listeners.get(type) || []) callback();
		},
		async runNext() {
			const entry = timers.entries().next().value;
			assert.ok(entry, 'expected a scheduled timer');
			const [id, timer] = entry;
			timers.delete(id);
			timer.callback();
			await flush();
			return timer.delay;
		},
		nextDelay() {
			return timers.values().next().value?.delay;
		}
	};
};

test('smart polling switches between active and idle cadence and refreshes once on settle', async () => {
	const runtime = fakeRuntime();
	const results = [{ active: true }, { active: false }];
	let settled = 0;
	const poller = createSmartPoller({
		poll: async () => results.shift(),
		environment: runtime.environment,
		activeIntervalMs: 2000,
		idleIntervalMs: 15000,
		onSettled: async () => {
			settled += 1;
		}
	});
	poller.start();
	assert.equal(await runtime.runNext(), 0);
	assert.equal(runtime.nextDelay(), 2000);
	assert.equal(await runtime.runNext(), 2000);
	assert.equal(settled, 1);
	assert.equal(runtime.nextDelay(), 15000);
	poller.stop();
});

test('smart polling never overlaps requests and coalesces an immediate poke', async () => {
	const runtime = fakeRuntime();
	let calls = 0;
	let release;
	const first = new Promise((resolve) => {
		release = resolve;
	});
	const poller = createSmartPoller({
		poll: async () => {
			calls += 1;
			if (calls === 1) await first;
			return { active: true };
		},
		environment: runtime.environment
	});
	poller.start();
	const firstTimer = runtime.timers.entries().next().value;
	runtime.timers.delete(firstTimer[0]);
	firstTimer[1].callback();
	await flush();
	poller.poke('mutation');
	assert.equal(calls, 1);
	release();
	await flush();
	assert.equal(runtime.nextDelay(), 0);
	await runtime.runNext();
	assert.equal(calls, 2);
	poller.stop();
});

test('smart polling backs off without converting sync errors into task results', async () => {
	const runtime = fakeRuntime();
	const failures = [];
	const poller = createSmartPoller({
		poll: async () => {
			throw new Error('network down');
		},
		environment: runtime.environment,
		onSyncError: (_error, meta) => failures.push(meta.failureCount)
	});
	poller.start();
	await runtime.runNext();
	assert.equal(runtime.nextDelay(), 3000);
	await runtime.runNext();
	assert.equal(runtime.nextDelay(), 6000);
	assert.deepEqual(failures, [1, 2]);
	poller.stop();
});

test('a recovered 90-minute run switches to the slow discovery cadence', async () => {
	const runtime = fakeRuntime();
	runtime.setNow(90 * 60 * 1000 + 2);
	let slow = false;
	const poller = createSmartPoller({
		poll: async () => ({ active: true, activeSince: 1 }),
		environment: runtime.environment,
		activeIntervalMs: 2000,
		longRunningAfterMs: 90 * 60 * 1000,
		longRunningIntervalMs: 15000,
		onResult: (_result, meta) => {
			slow = meta.slow;
		}
	});
	poller.start();
	await runtime.runNext();
	assert.equal(slow, true);
	assert.equal(runtime.nextDelay(), 15000);
	poller.stop();
});

test('smart polling pauses while hidden or offline and resumes immediately', async () => {
	const runtime = fakeRuntime();
	runtime.setVisible(false);
	let calls = 0;
	const poller = createSmartPoller({
		poll: async () => ({ active: ++calls > 0 }),
		environment: runtime.environment
	});
	poller.start();
	assert.equal(runtime.timers.size, 0);
	runtime.setVisible(true);
	runtime.emit('visibilitychange');
	assert.equal(runtime.nextDelay(), 0);
	await runtime.runNext();
	assert.equal(calls, 1);
	runtime.setOnline(false);
	runtime.emit('online');
	assert.equal(runtime.timers.size, 0);
	runtime.setOnline(true);
	runtime.emit('online');
	assert.equal(runtime.nextDelay(), 0);
	poller.stop();
});

test('stopping aborts an in-flight request and removes scheduled work', async () => {
	const runtime = fakeRuntime();
	let capturedSignal;
	const poller = createSmartPoller({
		poll: ({ signal }) => {
			capturedSignal = signal;
			return new Promise(() => {});
		},
		environment: runtime.environment
	});
	poller.start();
	const entry = runtime.timers.entries().next().value;
	runtime.timers.delete(entry[0]);
	entry[1].callback();
	await flush();
	poller.stop();
	assert.equal(capturedSignal.aborted, true);
	assert.equal(runtime.timers.size, 0);
});

test('mapWithConcurrency preserves order and enforces its ceiling', async () => {
	let active = 0;
	let peak = 0;
	const output = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
		active += 1;
		peak = Math.max(peak, active);
		await flush();
		active -= 1;
		return value * 2;
	});
	assert.equal(peak, 2);
	assert.deepEqual(output, [2, 4, 6, 8, 10]);
});
