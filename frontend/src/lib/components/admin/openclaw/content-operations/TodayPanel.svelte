<script>
	import { locale, t } from '$lib/i18n/admin/index.js';
	import {
		CONTENT_SOURCE_KEYS,
		actionTranslationKey,
		asArray,
		firstList,
		sourceState
	} from '$lib/contentOperations/contracts.js';
	import ScoreRail from './ScoreRail.svelte';
	import StatusBadge from './StatusBadge.svelte';

	let {
		status = {},
		snapshots = {},
		preview = null,
		onPreview = () => {},
		busy = false
	} = $props();

	const snapshotItems = $derived(firstList(snapshots, ['snapshots', 'items']));
	const latest = $derived(status?.snapshot || status?.latestSnapshot || snapshotItems[0] || {});
	const latestRun = $derived(status?.latestRun || {});
	const latestRunCandidates = $derived(asArray(latestRun?.candidates));
	const persistedSelection = $derived(
		latestRunCandidates.find(
			(candidate) =>
				(candidate?.recommendedAction || candidate?.decisionType || candidate?.action) ===
				latestRun?.selectedDecision
		) || {}
	);
	const selected = $derived(
		preview?.selectedOpportunity || preview?.contentAction || persistedSelection
	);
	const selectedAction = $derived(preview?.action || latestRun?.selectedDecision || 'skip');
	const sourceHealthItems = $derived(
		asArray(preview?.sourceHealth).length
			? asArray(preview.sourceHealth)
			: asArray(latest?.sourceHealth).length
				? asArray(latest.sourceHealth)
				: asArray(latestRun?.sourceHealth)
	);
	const sourceHealth = $derived(
		new Map(
			sourceHealthItems
				.filter((source) => source && typeof source === 'object' && source.source)
				.map((source) => [String(source.source), source])
		)
	);
	const googleGate = $derived(sourceState(sourceHealth.get('google_intelligence')));
	const warnings = $derived(
		[
			...asArray(preview?.warnings),
			...asArray(selected?.warnings),
			...asArray(latestRun?.warnings),
			...asArray(latest?.warnings),
			...asArray(latest?.risks)
		].slice(0, 6)
	);

	const formatDate = (value) => {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return String(value);
		return new Intl.DateTimeFormat($locale === 'en' ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(parsed);
	};

	const sourceLabel = (key) => $t(`admin.contentOperations.sources.${key}`);
	const warningText = (item) => String(item?.message || item?.reason || item?.title || item || '');
</script>

<section class="today-grid" aria-labelledby="co-today-title">
	<article class="today-primary co-card">
		<div class="co-section-head">
			<div>
				<p class="co-kicker">01 / {$t('admin.contentOperations.views.today')}</p>
				<h2 id="co-today-title">{$t('admin.contentOperations.today.title')}</h2>
				<p>{$t('admin.contentOperations.today.description')}</p>
			</div>
			<button
				class="co-button co-button--primary"
				type="button"
				onclick={onPreview}
				disabled={busy}
			>
				{busy
					? $t('admin.contentOperations.common.previewing')
					: $t('admin.contentOperations.common.previewBest')}
			</button>
		</div>

		<div class="decision-strip">
			<div class="decision-strip__action">
				<span>{$t('admin.contentOperations.fields.selectedAction')}</span>
				<strong>{$t(actionTranslationKey(selectedAction))}</strong>
			</div>
			<div>
				<span>{$t('admin.contentOperations.fields.topic')}</span>
				<b>{preview?.topic || selected?.topic || '—'}</b>
			</div>
			<div>
				<span>{$t('admin.contentOperations.fields.businessGoal')}</span>
				<b>{selected?.primaryBusinessGoal || selected?.businessGoal || '—'}</b>
			</div>
			<div>
				<span>{$t('admin.contentOperations.fields.opportunityScore')}</span>
				<ScoreRail
					value={preview?.opportunityScore ?? selected?.totalScore ?? selected?.opportunityScore}
				/>
			</div>
		</div>

		<div class="gate-grid">
			<div>
				<span>{$t('admin.contentOperations.fields.googleGate')}</span>
				<StatusBadge status={googleGate} />
			</div>
			<div>
				<span>{$t('admin.contentOperations.fields.snapshot')}</span>
				<StatusBadge status={latest?.status || 'unavailable'} />
			</div>
			<div>
				<span>{$t('admin.contentOperations.fields.checkedAt')}</span>
				<strong
					>{formatDate(latest?.checkedAt || latestRun?.completedAt || latestRun?.startedAt)}</strong
				>
			</div>
			<div>
				<span>{$t('admin.contentOperations.fields.targetArticle')}</span>
				<strong
					>{selected?.targetTitle ||
						selected?.primaryTargetBlogId ||
						selected?.targetBlogIds?.[0] ||
						'—'}</strong
				>
			</div>
		</div>
	</article>

	<aside class="co-card source-card">
		<div class="co-section-head co-section-head--compact">
			<div>
				<p class="co-kicker">{$t('admin.contentOperations.today.sourceHealth')}</p>
				<h2>{$t('admin.contentOperations.fields.sourceFreshness')}</h2>
			</div>
		</div>
		<div class="source-list">
			{#each CONTENT_SOURCE_KEYS as key (key)}
				{@const source = sourceHealth.get(key)}
				<div class="source-row">
					<span>{sourceLabel(key)}</span>
					<div>
						<StatusBadge status={sourceState(source)} />
						<small>{formatDate(source?.checkedAt || source?.freshAt)}</small>
					</div>
				</div>
			{/each}
		</div>
	</aside>

	{#if warnings.length}
		<aside class="co-card warning-card">
			<p class="co-kicker">{$t('admin.contentOperations.fields.warnings')}</p>
			<ul>
				{#each warnings as item, index (`${warningText(item)}-${index}`)}
					<li>{warningText(item)}</li>
				{/each}
			</ul>
		</aside>
	{/if}
</section>

<style>
	.today-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.65fr) minmax(270px, 0.72fr);
		gap: 1rem;
		align-items: start;
	}

	.today-primary {
		position: relative;
		overflow: hidden;
	}

	.today-primary::after {
		content: '';
		position: absolute;
		right: -6rem;
		top: -7rem;
		width: 14rem;
		height: 14rem;
		border: 1px solid color-mix(in srgb, var(--admin-accent) 15%, transparent);
		border-radius: 50%;
		box-shadow: 0 0 0 2.3rem color-mix(in srgb, var(--admin-accent) 3%, transparent);
		pointer-events: none;
	}

	.decision-strip {
		display: grid;
		grid-template-columns: 0.72fr 1.35fr 1fr 0.9fr;
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		overflow: hidden;
		background: #fff;
	}

	.decision-strip > div {
		display: grid;
		align-content: start;
		gap: 0.48rem;
		min-width: 0;
		padding: 1rem;
		border-right: 1px solid var(--admin-border);
	}

	.decision-strip > div:last-child {
		border-right: 0;
	}

	.decision-strip span,
	.gate-grid span {
		color: var(--admin-muted);
		font-size: 0.68rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}

	.decision-strip b,
	.decision-strip strong,
	.gate-grid strong {
		font-size: 0.86rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.decision-strip__action {
		background: var(--admin-accent);
		color: #fff;
	}

	.decision-strip__action span {
		color: rgba(255, 255, 255, 0.72);
	}

	.decision-strip__action strong {
		font-size: 1.02rem;
	}

	.gate-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.7rem;
		margin-top: 0.85rem;
	}

	.gate-grid > div {
		display: grid;
		gap: 0.5rem;
		padding: 0.85rem;
		border-radius: 10px;
		background: #f7f9f8;
		min-width: 0;
	}

	.source-card {
		grid-row: span 2;
	}

	.source-list {
		display: grid;
	}

	.source-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.65rem 0;
		border-bottom: 1px solid var(--admin-border);
		font-size: 0.79rem;
	}

	.source-row:last-child {
		border-bottom: 0;
	}

	.source-row > div {
		display: grid;
		justify-items: end;
		gap: 0.3rem;
	}

	.source-row small {
		color: var(--admin-muted);
		font-size: 0.65rem;
	}

	.warning-card {
		border-left: 3px solid var(--admin-warning);
	}

	.warning-card ul {
		margin: 0.65rem 0 0;
		padding-left: 1.1rem;
		color: #75500d;
		font-size: 0.8rem;
		line-height: 1.55;
	}

	@media (max-width: 1120px) {
		.today-grid {
			grid-template-columns: 1fr;
		}

		.source-card {
			grid-row: auto;
		}
	}

	@media (max-width: 780px) {
		.decision-strip,
		.gate-grid {
			grid-template-columns: 1fr 1fr;
		}

		.decision-strip > div:nth-child(2) {
			border-right: 0;
		}
	}

	@media (max-width: 520px) {
		.decision-strip,
		.gate-grid {
			grid-template-columns: 1fr;
		}

		.decision-strip > div {
			border-right: 0;
			border-bottom: 1px solid var(--admin-border);
		}
	}
</style>
