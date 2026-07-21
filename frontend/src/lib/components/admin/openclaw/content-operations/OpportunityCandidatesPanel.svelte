<script>
	import { t } from '$lib/i18n/admin/index.js';
	import {
		actionTranslationKey,
		asArray,
		entityId,
		firstList
	} from '$lib/contentOperations/contracts.js';
	import ScoreRail from './ScoreRail.svelte';

	let { opportunities = {}, onAction = () => {}, busyId = '' } = $props();
	let reasons = $state({});

	const items = $derived(firstList(opportunities, ['opportunities', 'candidates', 'items']));
	const itemText = (item) => {
		if (!item || typeof item !== 'object') return String(item || '');
		return String(
			item.summary ||
				item.reason ||
				item.detail ||
				item.title ||
				item.claim ||
				item.code ||
				item.source ||
				''
		);
	};
	const breakdown = (item) =>
		Object.entries(item?.scoreBreakdown || item?.scores || {})
			.map(([key, value]) => [key, value?.raw ?? value?.contribution ?? value])
			.filter(([, value]) => Number.isFinite(Number(value)));
	const execute = (item, operation) => {
		const id = entityId(item);
		onAction(item, operation, {
			reason: String(reasons[id] || '').trim()
		});
	};
</script>

<section class="co-card" aria-labelledby="co-opportunity-title">
	<div class="co-section-head">
		<div>
			<p class="co-kicker">02 / {$t('admin.contentOperations.views.opportunities')}</p>
			<h2 id="co-opportunity-title">{$t('admin.contentOperations.opportunities.title')}</h2>
			<p>{$t('admin.contentOperations.opportunities.description')}</p>
		</div>
		<span class="co-count">{items.length}</span>
	</div>

	{#if items.length}
		<div class="candidate-list">
			{#each items as item, index (entityId(item) || index)}
				{@const id = entityId(item)}
				{@const action =
					item.recommendedAction || item.decisionType || item.action || item.decision || 'skip'}
				<article class="candidate" class:candidate--skip={action === 'skip'}>
					<div class="candidate__index">{String(index + 1).padStart(2, '0')}</div>
					<div class="candidate__body">
						<div class="candidate__heading">
							<div>
								<span class="action-label">{$t(actionTranslationKey(action))}</span>
								<h3>{item.topic || item.title || '—'}</h3>
								{#if item.targetTitle || item.targetUrl}
									<p class="target">{item.targetTitle || item.targetUrl}</p>
								{/if}
							</div>
							<div class="candidate__score">
								<span>{$t('admin.contentOperations.fields.totalScore')}</span>
								<ScoreRail value={item.totalScore ?? item.opportunityScore} compact />
							</div>
						</div>

						{#if item.decisionReason || item.reason}
							<p class="candidate__reason">{item.decisionReason || item.reason}</p>
						{/if}

						<div class="candidate__details">
							{#if breakdown(item).length}
								<details open={index === 0}>
									<summary>{$t('admin.contentOperations.fields.scoreBreakdown')}</summary>
									<div class="breakdown">
										{#each breakdown(item) as [key, value] (key)}
											<div>
												<span>{key.replaceAll('_', ' ')}</span><ScoreRail {value} compact />
											</div>
										{/each}
									</div>
								</details>
							{/if}
							{#if asArray(item.positiveEvidence || item.evidence).length}
								<details>
									<summary>{$t('admin.contentOperations.fields.evidence')}</summary>
									<ul>
										{#each asArray(item.positiveEvidence || item.evidence).slice(0, 8) as evidence, evidenceIndex (`${itemText(evidence)}-${evidenceIndex}`)}<li
											>
												{itemText(evidence)}
											</li>{/each}
									</ul>
								</details>
							{/if}
							{#if asArray(item.penalties).length || asArray(item.risks).length}
								<details>
									<summary>{$t('admin.contentOperations.fields.risks')}</summary>
									<ul>
										{#each [...asArray(item.penalties), ...asArray(item.risks)].slice(0, 8) as risk, riskIndex (`${itemText(risk)}-${riskIndex}`)}<li
											>
												{itemText(risk)}
											</li>{/each}
									</ul>
								</details>
							{/if}
						</div>

						<div class="candidate__decision">
							<label class="reason-field">
								<span>{$t('admin.contentOperations.fields.reason')}</span>
								<input
									bind:value={reasons[id]}
									maxlength="1000"
									placeholder={$t('admin.contentOperations.opportunities.reasonPlaceholder')}
								/>
							</label>
							<div class="candidate__actions">
								<button
									class="co-button co-button--quiet"
									type="button"
									onclick={() => execute(item, 'dismiss')}
									disabled={busyId === id}
								>
									{$t('admin.contentOperations.common.dismiss')}
								</button>
								<button
									class="co-button co-button--secondary"
									type="button"
									onclick={() => execute(item, 'accept')}
									disabled={busyId === id}
								>
									{$t('admin.contentOperations.common.accept')}
								</button>
								<button
									class="co-button co-button--primary"
									type="button"
									onclick={() => execute(item, 'convert')}
									disabled={busyId === id || action === 'skip'}
								>
									{$t('admin.contentOperations.common.convert')}
								</button>
							</div>
						</div>
					</div>
				</article>
			{/each}
		</div>
	{:else}
		<div class="co-empty">
			<strong>{$t('admin.contentOperations.opportunities.empty')}</strong>
			<p>{$t('admin.contentOperations.opportunities.emptyHint')}</p>
		</div>
	{/if}
</section>

<style>
	.candidate-list {
		display: grid;
		gap: 0.8rem;
	}
	.candidate {
		display: grid;
		grid-template-columns: 3.3rem minmax(0, 1fr);
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		overflow: hidden;
		background: #fff;
	}
	.candidate--skip {
		border-style: dashed;
	}
	.candidate__index {
		display: grid;
		place-items: start center;
		padding: 1rem 0.4rem;
		background: #f2f6f4;
		color: var(--admin-accent);
		font:
			800 0.75rem/1 ui-monospace,
			'Cascadia Mono',
			monospace;
		border-right: 1px solid var(--admin-border);
	}
	.candidate__body {
		display: grid;
		gap: 0.85rem;
		padding: 1rem;
		min-width: 0;
	}
	.candidate__heading {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
	}
	.candidate__heading h3 {
		margin: 0.4rem 0 0;
		font-size: 1rem;
	}
	.action-label {
		color: var(--admin-accent);
		font-size: 0.68rem;
		font-weight: 900;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.target,
	.candidate__reason {
		margin: 0.32rem 0 0;
		color: var(--admin-muted);
		font-size: 0.8rem;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.candidate__score {
		display: grid;
		gap: 0.42rem;
		min-width: 165px;
	}
	.candidate__score > span {
		color: var(--admin-muted);
		font-size: 0.65rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.candidate__details {
		display: flex;
		gap: 0.55rem;
		flex-wrap: wrap;
	}
	details {
		flex: 1 1 180px;
		border: 1px solid var(--admin-border);
		border-radius: 9px;
		padding: 0.65rem 0.75rem;
		background: #fafbfb;
		min-width: 0;
	}
	summary {
		cursor: pointer;
		color: #4e5d58;
		font-size: 0.73rem;
		font-weight: 800;
	}
	details ul {
		margin: 0.65rem 0 0;
		padding-left: 1rem;
		color: var(--admin-muted);
		font-size: 0.75rem;
		line-height: 1.5;
	}
	.breakdown {
		display: grid;
		gap: 0.45rem;
		margin-top: 0.65rem;
	}
	.breakdown > div {
		display: grid;
		grid-template-columns: minmax(90px, 0.8fr) minmax(120px, 1fr);
		gap: 0.6rem;
		align-items: center;
		color: var(--admin-muted);
		font-size: 0.68rem;
		text-transform: capitalize;
	}
	.candidate__decision {
		display: grid;
		grid-template-columns: minmax(180px, 1fr) auto;
		gap: 0.65rem;
		align-items: end;
		padding-top: 0.8rem;
		border-top: 1px dashed var(--admin-border);
	}
	.candidate__decision label {
		display: grid;
		gap: 0.35rem;
		color: var(--admin-muted);
		font-size: 0.68rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.candidate__decision input {
		width: 100%;
		min-height: 38px;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		padding: 0.5rem 0.65rem;
		background: #fff;
		color: var(--admin-ink);
		font: inherit;
		text-transform: none;
		letter-spacing: 0;
	}
	.candidate__actions {
		display: flex;
		gap: 0.4rem;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
	@media (max-width: 900px) {
		.candidate__decision {
			grid-template-columns: 1fr 2fr;
		}
		.candidate__actions {
			grid-column: 1/-1;
		}
		.candidate__score {
			min-width: 130px;
		}
	}
	@media (max-width: 620px) {
		.candidate {
			grid-template-columns: 1fr;
		}
		.candidate__index {
			display: none;
		}
		.candidate__heading {
			display: grid;
		}
		.candidate__score {
			min-width: 0;
		}
		.candidate__decision {
			grid-template-columns: 1fr;
		}
		.reason-field,
		.candidate__actions {
			grid-column: auto;
		}
		.candidate__actions .co-button {
			flex: 1;
		}
	}
</style>
