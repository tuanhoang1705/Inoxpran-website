<script>
	import { locale, t } from '$lib/i18n/admin/index.js';
	import { asArray, entityId } from '$lib/contentOperations/contracts.js';
	import StatusBadge from './StatusBadge.svelte';

	let {
		performance = null,
		learning = null,
		selectedBlogId = '',
		onLoad = () => {},
		busy = false
	} = $props();

	// Writable derived state follows a newly selected inventory article while still allowing input edits.
	let blogId = $derived(String(selectedBlogId || ''));
	const technical = $derived(performance?.technicalVerification || {});
	const windows = $derived(asArray(performance?.windows));
	const learningTasks = $derived(asArray(learning?.maintenanceTasks));
	const tasks = $derived(
		learningTasks.length ? learningTasks : asArray(performance?.maintenanceTasks)
	);
	const recommendation = $derived(learning?.recommendation || null);
	const recommendationReasons = $derived(asArray(recommendation?.reasons));

	const formatDate = (value) => {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return String(value);
		return new Intl.DateTimeFormat($locale === 'en' ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(parsed);
	};

	const metric = (value, options = {}) => {
		if (value === null || value === undefined || value === '') {
			return $t('admin.contentOperations.monitoring.unavailable');
		}
		const number = Number(value);
		if (!Number.isFinite(number)) return String(value);
		return new Intl.NumberFormat($locale === 'en' ? 'en-US' : 'vi-VN', options).format(number);
	};
	const percent = (value) => {
		if (value === null || value === undefined || value === '') {
			return $t('admin.contentOperations.monitoring.unavailable');
		}
		const number = Number(value);
		if (!Number.isFinite(number)) return String(value);
		return metric(number > 1 ? number / 100 : number, {
			style: 'percent',
			maximumFractionDigits: 1
		});
	};

	const windowLabel = (item) => String(item?.window || '—');
	const searchData = (item) => item?.searchConsole || {};
	const analyticsData = (item) => item?.analytics || {};
	const taskText = (item) => String(item?.summary || '');
	const recommendationText = (item) => String(item?.recommendation || '');
	const hasTechnicalIssue = (code) =>
		asArray(technical?.issues).some((issue) => issue?.code === code);
	const technicalCheckStatus = (check) => {
		if (check === 'overall') {
			if (technical?.pass === true || technical?.verified === true) return 'passed';
			if (technical?.pass === false || technical?.verified === false) return 'failed';
			return 'unknown';
		}
		if (check === 'canonical') {
			if (hasTechnicalIssue('canonical_mismatch')) return 'failed';
			return technical?.canonical ? 'complete' : 'unknown';
		}
		if (check === 'titlePresent') {
			return technical?.titlePresent === true
				? 'complete'
				: hasTechnicalIssue('page_title_missing')
					? 'warning'
					: 'unknown';
		}
		if (check === 'metaDescriptionPresent') {
			return technical?.metaDescriptionPresent === true
				? 'complete'
				: hasTechnicalIssue('meta_description_missing')
					? 'warning'
					: 'unknown';
		}
		if (check === 'revisionHash') {
			if (hasTechnicalIssue('approved_revision_hash_mismatch')) return 'failed';
			return technical?.revisionHash ? 'complete' : 'unknown';
		}
		return 'unknown';
	};
	const submit = () => {
		const value = entityId(blogId);
		if (value) onLoad(value);
	};
</script>

<section class="co-card" aria-labelledby="co-monitoring-title">
	<div class="co-section-head">
		<div>
			<p class="co-kicker">06 / {$t('admin.contentOperations.views.monitoring')}</p>
			<h2 id="co-monitoring-title">{$t('admin.contentOperations.monitoring.title')}</h2>
			<p>{$t('admin.contentOperations.monitoring.description')}</p>
		</div>
	</div>

	<form
		class="monitor-lookup"
		onsubmit={(event) => {
			event.preventDefault();
			submit();
		}}
	>
		<label>
			<span>{$t('admin.contentOperations.monitoring.blogId')}</span>
			<input
				bind:value={blogId}
				maxlength="128"
				autocomplete="off"
				placeholder={$t('admin.contentOperations.monitoring.blogIdPlaceholder')}
			/>
		</label>
		<button class="co-button co-button--primary" type="submit" disabled={busy || !entityId(blogId)}>
			{busy
				? $t('admin.contentOperations.common.loading')
				: $t('admin.contentOperations.common.inspect')}
		</button>
	</form>

	{#if performance || learning}
		<div class="monitor-summary">
			<div>
				<span>{$t('admin.contentOperations.fields.article')}</span>
				<strong>{performance?.blogTitle || learning?.blogTitle || entityId(blogId)}</strong>
			</div>
			<div>
				<span>{$t('admin.contentOperations.monitoring.technicalVerification')}</span>
				<StatusBadge
					status={technical?.status ||
						(technical?.verified === true
							? 'passed'
							: technical?.verified === false
								? 'failed'
								: 'unavailable')}
				/>
			</div>
			<div>
				<span>{$t('admin.contentOperations.fields.lastReview')}</span>
				<strong>{formatDate(learning?.lastReviewedAt || performance?.lastReviewedAt)}</strong>
			</div>
			<div>
				<span>{$t('admin.contentOperations.monitoring.nextReview')}</span>
				<strong>{formatDate(learning?.nextReviewAt || performance?.nextReviewAt)}</strong>
			</div>
		</div>

		{#if technical && Object.keys(technical).length}
			<div class="verification-grid">
				{#each ['overall', 'canonical', 'titlePresent', 'metaDescriptionPresent', 'revisionHash'] as check (check)}
					<div>
						<span>{$t(`admin.contentOperations.monitoring.checks.${check}`)}</span>
						<StatusBadge status={technicalCheckStatus(check)} />
					</div>
				{/each}
			</div>
		{/if}

		{#if windows.length}
			<div class="window-grid">
				{#each windows as item, index (entityId(item) || `${windowLabel(item)}-${index}`)}
					{@const search = searchData(item)}
					{@const analytics = analyticsData(item)}
					<article class="window-card">
						<header>
							<span>{$t('admin.contentOperations.monitoring.window')}</span><strong
								>{windowLabel(item)}</strong
							>
						</header>
						<div class="metric-group">
							<p>{$t('admin.contentOperations.sources.searchConsole')}</p>
							<dl>
								<div>
									<dt>{$t('admin.contentOperations.monitoring.metrics.clicks')}</dt>
									<dd>{metric(search.clicks)}</dd>
								</div>
								<div>
									<dt>{$t('admin.contentOperations.monitoring.metrics.impressions')}</dt>
									<dd>{metric(search.impressions)}</dd>
								</div>
								<div>
									<dt>{$t('admin.contentOperations.monitoring.metrics.ctr')}</dt>
									<dd>{percent(search.ctr)}</dd>
								</div>
								<div>
									<dt>{$t('admin.contentOperations.monitoring.metrics.position')}</dt>
									<dd>{metric(search.averagePosition, { maximumFractionDigits: 1 })}</dd>
								</div>
							</dl>
						</div>
						<div class="metric-group">
							<p>{$t('admin.contentOperations.sources.analytics')}</p>
							<dl>
								<div>
									<dt>{$t('admin.contentOperations.monitoring.metrics.views')}</dt>
									<dd>{metric(analytics.views)}</dd>
								</div>
								<div>
									<dt>{$t('admin.contentOperations.monitoring.metrics.engagedSessions')}</dt>
									<dd>{metric(analytics.engagedSessions)}</dd>
								</div>
								<div>
									<dt>{$t('admin.contentOperations.monitoring.metrics.productClicks')}</dt>
									<dd>{metric(analytics.productLinkClicks)}</dd>
								</div>
							</dl>
						</div>
					</article>
				{/each}
			</div>
		{:else}
			<div class="co-empty co-empty--small">
				<p>{$t('admin.contentOperations.monitoring.noWindows')}</p>
			</div>
		{/if}

		<div class="learning-grid">
			<article>
				<p class="co-kicker">{$t('admin.contentOperations.fields.recommendedAction')}</p>
				<strong
					>{recommendation
						? recommendationText(recommendation)
						: $t('admin.contentOperations.monitoring.noRecommendation')}</strong
				>
				{#if recommendationReasons.length}<p>{recommendationReasons.join(', ')}</p>{/if}
			</article>
			<article>
				<p class="co-kicker">{$t('admin.contentOperations.monitoring.maintenanceTasks')}</p>
				{#if tasks.length}
					<ul>
						{#each tasks.slice(0, 8) as task, index (entityId(task) || `${taskText(task)}-${index}`)}<li
							>
								{taskText(task)}
							</li>{/each}
					</ul>
				{:else}<p>{$t('admin.contentOperations.monitoring.noTasks')}</p>{/if}
			</article>
		</div>
	{:else}
		<div class="co-empty">
			<strong>{$t('admin.contentOperations.monitoring.empty')}</strong>
			<p>{$t('admin.contentOperations.monitoring.emptyHint')}</p>
		</div>
	{/if}
</section>

<style>
	.monitor-lookup {
		display: grid;
		grid-template-columns: minmax(220px, 420px) auto;
		gap: 0.65rem;
		align-items: end;
		margin-bottom: 1rem;
	}
	.monitor-lookup label {
		display: grid;
		gap: 0.35rem;
		color: var(--admin-muted);
		font-size: 0.68rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.monitor-lookup input {
		min-height: 40px;
		border: 1px solid var(--admin-border);
		border-radius: 9px;
		padding: 0.55rem 0.7rem;
		background: #fff;
		color: var(--admin-ink);
		font: inherit;
		text-transform: none;
		letter-spacing: 0;
	}
	.monitor-summary {
		display: grid;
		grid-template-columns: 1.5fr repeat(3, minmax(0, 1fr));
		border: 1px solid var(--admin-border);
		border-radius: 11px;
		overflow: hidden;
	}
	.monitor-summary > div {
		display: grid;
		align-content: start;
		gap: 0.45rem;
		padding: 0.85rem;
		border-right: 1px solid var(--admin-border);
		min-width: 0;
	}
	.monitor-summary > div:last-child {
		border-right: 0;
	}
	.monitor-summary span,
	.verification-grid span {
		color: var(--admin-muted);
		font-size: 0.65rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.monitor-summary strong {
		font-size: 0.8rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.verification-grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 0.55rem;
		margin-top: 0.75rem;
	}
	.verification-grid > div {
		display: grid;
		gap: 0.42rem;
		padding: 0.65rem;
		border-radius: 9px;
		background: #f6f8f7;
	}
	.window-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.7rem;
		margin-top: 1rem;
	}
	.window-card {
		border: 1px solid var(--admin-border);
		border-radius: 11px;
		overflow: hidden;
	}
	.window-card header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.68rem 0.8rem;
		background: #edf4f1;
		color: var(--admin-accent);
		font-size: 0.7rem;
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.metric-group {
		padding: 0.7rem 0.8rem;
		border-top: 1px solid var(--admin-border);
	}
	.metric-group > p {
		margin: 0 0 0.48rem;
		color: var(--admin-muted);
		font-size: 0.66rem;
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	dl {
		display: grid;
		gap: 0.35rem;
		margin: 0;
	}
	dl > div {
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
		color: var(--admin-muted);
		font-size: 0.73rem;
	}
	dt,
	dd {
		margin: 0;
	}
	dd {
		color: var(--admin-ink);
		font-weight: 800;
	}
	.learning-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.7rem;
		margin-top: 1rem;
	}
	.learning-grid article {
		padding: 0.9rem;
		border: 1px solid var(--admin-border);
		border-left: 3px solid var(--admin-accent);
		border-radius: 10px;
	}
	.learning-grid strong {
		display: block;
		font-size: 0.88rem;
		line-height: 1.5;
	}
	.learning-grid p:not(.co-kicker),
	.learning-grid ul {
		margin: 0.45rem 0 0;
		color: var(--admin-muted);
		font-size: 0.76rem;
		line-height: 1.55;
	}
	.learning-grid ul {
		padding-left: 1rem;
	}
	@media (max-width: 980px) {
		.monitor-summary {
			grid-template-columns: 1fr 1fr;
		}
		.monitor-summary > div:nth-child(2) {
			border-right: 0;
		}
		.verification-grid,
		.window-grid {
			grid-template-columns: 1fr 1fr;
		}
		.window-card:last-child {
			grid-column: 1/-1;
		}
	}
	@media (max-width: 620px) {
		.monitor-lookup,
		.monitor-summary,
		.verification-grid,
		.window-grid,
		.learning-grid {
			grid-template-columns: 1fr;
		}
		.monitor-summary > div {
			border-right: 0;
			border-bottom: 1px solid var(--admin-border);
		}
		.window-card:last-child {
			grid-column: auto;
		}
	}
</style>
