import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createRoadmapRegenerationRequestState,
	matchesTrackedRoadmapRegeneration,
	regenerationPhase,
	roadmapPolicy,
	roadmapPollResult,
	shouldReplaceRoadmapItems
} from '../src/lib/openclaw/roadmapLifecycle.js';
import {
	roadmapOutcomeLabel,
	roadmapPolicyLabel,
	roadmapRegenerationErrorLabel,
	roadmapScoreAccepted
} from '../src/lib/openclaw/simpleSchedule.js';

const roadmap = (activeEpoch = 'epoch-old') => ({ lineage: { activeEpoch } });
const regeneration = (status, overrides = {}) => ({
	id: 'regen-1',
	status,
	baseEpoch: 'epoch-old',
	targetEpoch: 'epoch-new',
	...overrides
});

test('regeneration lifecycle covers queued, research, commit, replacement, no-change and failures', () => {
	assert.deepEqual(regenerationPhase(regeneration('queued'), roadmap()), {
		phase: 'queued',
		active: true,
		terminal: false,
		committed: false
	});
	assert.equal(regenerationPhase(regeneration('running'), roadmap()).phase, 'researching');
	assert.equal(regenerationPhase(regeneration('committing'), roadmap()).phase, 'committing');
	assert.deepEqual(
		regenerationPhase(
			regeneration('completed', { outcome: 'replacement_committed' }),
			roadmap('epoch-new')
		),
		{ phase: 'completed', active: false, terminal: true, committed: true }
	);
	assert.equal(
		regenerationPhase(regeneration('completed', { outcome: 'no_change' }), roadmap()).phase,
		'no_change'
	);
	assert.equal(regenerationPhase(regeneration('failed'), roadmap()).phase, 'failed');
	assert.equal(
		regenerationPhase(regeneration('completed', { outcome: 'superseded' }), roadmap()).phase,
		'superseded'
	);
	assert.equal(regenerationPhase(regeneration('cancelled'), roadmap()).phase, 'cancelled');
});

test('reload restoration identifies persisted active regeneration for polling', () => {
	const payload = {
		roadmap: roadmap(),
		items: [{ id: 'old-1', topic: 'Old active topic' }],
		regeneration: regeneration('running', { startedAt: '2026-07-28T01:00:00.000Z' })
	};
	assert.deepEqual(roadmapPollResult(payload), {
		payload,
		active: true,
		activeSince: '2026-07-28T01:00:00.000Z'
	});
});

test('uncertain regeneration delivery state survives component recreation', () => {
	const values = new Map();
	const storage = {
		getItem: (key) => values.get(key) || null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key)
	};
	const first = createRoadmapRegenerationRequestState({
		getStorage: () => storage,
		now: () => 123
	});
	assert.equal(
		first.write('schedule-1', {
			pending: true,
			uncertain: true,
			regenerationId: ''
		}),
		true
	);

	const reloaded = createRoadmapRegenerationRequestState({
		getStorage: () => storage,
		now: () => 456
	});
	assert.deepEqual(reloaded.read('schedule-1'), {
		pending: true,
		uncertain: true,
		regenerationId: '',
		updatedAt: 123
	});
	assert.equal(reloaded.clear('schedule-1'), true);
	assert.equal(reloaded.read('schedule-1'), null);
});

test('stale uncertain request state expires instead of blocking a schedule forever', () => {
	const values = new Map();
	const storage = {
		getItem: (key) => values.get(key) || null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key)
	};
	const state = createRoadmapRegenerationRequestState({
		getStorage: () => storage,
		now: () => 1000
	});
	state.write('schedule-stale', { pending: true, uncertain: true });
	const expired = createRoadmapRegenerationRequestState({
		getStorage: () => storage,
		now: () => 1000 + 24 * 60 * 60 * 1000 + 1
	});

	assert.equal(expired.read('schedule-stale'), null);
});

test('old items remain visible while replacement runs and switch only with active epoch', () => {
	const current = {
		roadmap: roadmap('epoch-old'),
		items: [{ id: 'old-1', topic: 'Old active topic' }],
		regeneration: regeneration('queued')
	};
	const running = {
		roadmap: roadmap('epoch-old'),
		items: [{ id: 'new-hidden', topic: 'Uncommitted topic' }],
		regeneration: regeneration('running')
	};
	assert.equal(shouldReplaceRoadmapItems(current, running), false);

	const committed = {
		roadmap: roadmap('epoch-new'),
		items: [{ id: 'new-1', topic: 'Committed topic' }],
		regeneration: regeneration('completed', { outcome: 'replacement_committed' })
	};
	assert.equal(shouldReplaceRoadmapItems(current, committed), true);

	const noChange = {
		roadmap: roadmap('epoch-old'),
		items: [{ id: 'old-1', topic: 'Old active topic' }],
		regeneration: regeneration('completed', { outcome: 'no_change' })
	};
	assert.equal(shouldReplaceRoadmapItems(current, noChange), true);
});

test('an uncertain request never adopts an unrelated latest regeneration', () => {
	assert.equal(matchesTrackedRoadmapRegeneration('', 'older-regeneration'), false);
	assert.equal(matchesTrackedRoadmapRegeneration('requested-1', 'older-regeneration'), false);
	assert.equal(matchesTrackedRoadmapRegeneration('requested-1', 'requested-1'), true);
});

test('dynamic roadmap policy drives score acceptance and copy', () => {
	const payload = {
		policy: { acceptanceScore: 90, minimumNoveltySubtotal: 55 },
		items: []
	};
	const policy = roadmapPolicy(payload);
	assert.deepEqual(policy, { acceptanceScore: 90, minimumNoveltySubtotal: 55 });
	assert.equal(
		roadmapScoreAccepted(
			{ scores: { totalScore: 91, noveltySubtotal: 54, hardGatesPassed: true } },
			policy
		),
		false
	);
	assert.equal(
		roadmapScoreAccepted(
			{ scores: { totalScore: 91, noveltySubtotal: 55, hardGatesPassed: true } },
			policy
		),
		true
	);
	assert.equal(roadmapPolicyLabel(policy, true), 'Acceptance ≥ 90; novelty subtotal ≥ 55');
	assert.match(roadmapOutcomeLabel('ROADMAP_NO_ACCEPTABLE_TOPIC', true, policy), /90-point/);
});

test('source degradation and model failure stay separate in panel messaging helpers', () => {
	assert.match(
		roadmapRegenerationErrorLabel('OPENCLAW_AGENT_INVALID_JSON', true),
		/replacement was not committed/i
	);
	assert.doesNotMatch(
		roadmapRegenerationErrorLabel('OPENCLAW_AGENT_INVALID_JSON', true),
		/some sources are unavailable/i
	);
});
