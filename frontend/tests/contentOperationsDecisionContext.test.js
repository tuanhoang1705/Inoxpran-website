import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decisionArtifactContext,
	entityId,
	normalizePreview
} from '../src/lib/contentOperations/contracts.js';

test('a dry-run preview cannot inherit runnable artifacts from an older run', () => {
	const latestPersistedRun = normalizePreview({
		dryRun: false,
		action: 'update',
		contentOpportunityDecisionId: 'decision-old',
		contentWorkOrderId: 'work-order-old'
	});
	const displayedPreview = normalizePreview({
		dryRun: true,
		action: 'new',
		topic: 'A newly previewed topic'
	});

	assert.equal(decisionArtifactContext(latestPersistedRun).runnable, true);
	assert.deepEqual(decisionArtifactContext(displayedPreview), {
		decisionId: '',
		workOrderId: '',
		persisted: false,
		runnable: false
	});
});

test('missing artifact objects never become synthetic object-string identifiers', () => {
	assert.equal(entityId({}), '');
	assert.equal(normalizePreview({ dryRun: true, action: 'new' }).workOrderId, '');
});

test('only a persisted, internally complete, non-skip decision is runnable', () => {
	assert.deepEqual(
		decisionArtifactContext(
			normalizePreview({
				dryRun: false,
				action: 'expand',
				contentOpportunityDecisionId: 'decision-current',
				contentWorkOrderId: 'work-order-current'
			})
		),
		{
			decisionId: 'decision-current',
			workOrderId: 'work-order-current',
			persisted: true,
			runnable: true
		}
	);

	assert.equal(
		decisionArtifactContext({
			dryRun: false,
			action: 'expand',
			decisionId: 'decision-without-work-order'
		}).runnable,
		false
	);
	assert.equal(
		decisionArtifactContext({
			dryRun: false,
			action: 'skip',
			decisionId: 'decision-skip',
			workOrderId: 'work-order-skip'
		}).runnable,
		false
	);
});

test('a terminal matching work order is no longer presented as runnable', () => {
	const decision = normalizePreview({
		dryRun: false,
		action: 'update',
		contentOpportunityDecisionId: 'decision-current',
		contentWorkOrderId: 'work-order-current'
	});

	assert.equal(
		decisionArtifactContext(decision, {
			_id: 'work-order-current',
			status: 'completed'
		}).runnable,
		false
	);
	assert.equal(
		decisionArtifactContext(decision, {
			_id: 'work-order-current',
			status: 'brief_ready'
		}).runnable,
		true
	);
	assert.equal(
		decisionArtifactContext(decision, {
			_id: 'an-older-work-order',
			status: 'completed'
		}).runnable,
		true
	);
});
