<script>
	import { locale, t } from '$lib/i18n/admin/index.js';
	import {
		actionTranslationKey,
		asArray,
		entityId,
		firstList,
		statusTranslationKey
	} from '$lib/contentOperations/contracts.js';
	import StatusBadge from './StatusBadge.svelte';

	let { workOrders = {}, onUpdate = () => {}, onRun = () => {}, busyId = '' } = $props();
	const items = $derived(firstList(workOrders, ['workOrders', 'orders', 'items']));

	const formatDate = (value) => {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return String(value);
		return new Intl.DateTimeFormat($locale === 'en' ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(parsed);
	};
	const artifactEntries = (item) =>
		Object.entries(item?.artifactIds || {}).filter(([, value]) => value);
	const audienceText = (item) => asArray(item?.targetAudience).join(', ') || '—';
	const isTerminal = (item) => ['completed', 'cancelled'].includes(item?.status);
	const canPause = (item) =>
		['planned', 'approved', 'brief_ready', 'researching', 'drafting', 'reviewing'].includes(
			item?.status
		);
	const canApprove = (item) => item?.status === 'planned';
	const canRun = (item) =>
		['planned', 'approved', 'brief_ready'].includes(item?.status) && item?.decision !== 'skip';
	const canReopen = (item) => ['blocked', 'paused'].includes(item?.status);
	const messageText = (item) => String(item?.message || item?.reason || item || '');
	const reasonFor = (message) => {
		if (typeof window === 'undefined') return '';
		return String(window.prompt(message, '') || '').trim();
	};
	const updatePriority = (item, priority) => {
		if (priority === item.priority) return;
		const reason = reasonFor(
			$locale === 'en'
				? 'Reason for changing priority (required):'
				: 'Lý do đổi mức ưu tiên (bắt buộc):'
		);
		if (reason.length < 8) return;
		onUpdate(item, { priority, overrideReason: reason });
	};
	const toggleTopicLock = (item) => {
		const reason = reasonFor(
			$locale === 'en'
				? 'Reason for changing the topic lock (required):'
				: 'Lý do thay đổi khóa chủ đề (bắt buộc):'
		);
		if (reason.length < 8) return;
		onUpdate(item, { topicLocked: item.topicLocked !== true, overrideReason: reason });
	};
	const reopen = (item) => {
		const reason = reasonFor(
			$locale === 'en'
				? 'Reason for reopening this work order (required):'
				: 'Lý do mở lại work order (bắt buộc):'
		);
		if (reason.length < 8) return;
		onUpdate(item, { status: 'planned', overrideReason: reason });
	};
</script>

<section class="co-card" aria-labelledby="co-work-orders-title">
	<div class="co-section-head">
		<div>
			<p class="co-kicker">03 / {$t('admin.contentOperations.views.workOrders')}</p>
			<h2 id="co-work-orders-title">{$t('admin.contentOperations.workOrders.title')}</h2>
			<p>{$t('admin.contentOperations.workOrders.description')}</p>
		</div>
		<span class="co-count">{items.length}</span>
	</div>

	{#if items.length}
		<div class="orders-grid">
			{#each items as item, index (entityId(item) || index)}
				{@const id = entityId(item)}
				{@const action = item.decision || 'skip'}
				<article class="order-card">
					<header>
						<div>
							<span class="order-card__action">{$t(actionTranslationKey(action))}</span>
							<h3>{item.topic || '—'}</h3>
						</div>
						<StatusBadge status={item.status || 'draft'} />
					</header>

					<dl>
						<div>
							<dt>{$t('admin.contentOperations.fields.businessGoal')}</dt>
							<dd>{item.primaryBusinessGoal || '—'}</dd>
						</div>
						<div>
							<dt>{$t('admin.contentOperations.fields.audience')}</dt>
							<dd>{audienceText(item)}</dd>
						</div>
						<div>
							<dt>{$t('admin.contentOperations.fields.intent')}</dt>
							<dd>{item.primarySearchIntent || '—'}</dd>
						</div>
						<div>
							<dt>{$t('admin.contentOperations.fields.targetArticle')}</dt>
							<dd>{entityId(item.targetBlogId) || '—'}</dd>
						</div>
						<div>
							<dt>{$t('admin.contentOperations.fields.scheduledAt')}</dt>
							<dd>{formatDate(item.targetPublishDate)}</dd>
						</div>
						<div>
							<dt>{$t('admin.contentOperations.fields.owner')}</dt>
							<dd>{entityId(item.owner) || '—'}</dd>
						</div>
						<div>
							<dt>{$t('admin.contentOperations.fields.priority')}</dt>
							<dd>
								<select
									class="order-select"
									value={item.priority || 'medium'}
									onchange={(event) => updatePriority(item, event.currentTarget.value)}
									disabled={busyId === id || isTerminal(item)}
									><option value="low">{$t('admin.contentOperations.priority.low')}</option><option
										value="medium">{$t('admin.contentOperations.priority.medium')}</option
									><option value="high">{$t('admin.contentOperations.priority.high')}</option
									><option value="critical"
										>{$t('admin.contentOperations.priority.critical')}</option
									></select
								>
							</dd>
						</div>
						<div>
							<dt>{$locale === 'en' ? 'Topic lock' : 'Khóa chủ đề'}</dt>
							<dd>
								{item.topicLocked
									? $locale === 'en'
										? 'Locked'
										: 'Đã khóa'
									: $locale === 'en'
										? 'Open'
										: 'Đang mở'}
							</dd>
						</div>
					</dl>

					<div class="pipeline">
						<span>{$t('admin.contentOperations.fields.currentStep')}</span>
						<strong>{$t(statusTranslationKey(item.status))}</strong>
					</div>

					{#if artifactEntries(item).length}
						<details>
							<summary>{$t('admin.contentOperations.fields.artifacts')}</summary>
							<div class="artifacts">
								{#each artifactEntries(item) as [key, value] (key)}
									<div><span>{key.replaceAll('_', ' ')}</span><code>{String(value)}</code></div>
								{/each}
							</div>
						</details>
					{/if}

					{#if asArray(item.warnings).length}
						<div class="order-alerts">
							{#each asArray(item.warnings).slice(0, 4) as warning, warningIndex (`${messageText(warning)}-${warningIndex}`)}<span
									>{messageText(warning)}</span
								>{/each}
						</div>
					{/if}

					<footer>
						{#if !isTerminal(item)}
							<button
								class="co-button co-button--quiet"
								type="button"
								onclick={() => toggleTopicLock(item)}
								disabled={busyId === id}
							>
								{item.topicLocked
									? $locale === 'en'
										? 'Unlock topic'
										: 'Mở khóa chủ đề'
									: $locale === 'en'
										? 'Lock topic'
										: 'Khóa chủ đề'}
							</button>
						{/if}
						{#if canPause(item)}
							<button
								class="co-button co-button--quiet"
								type="button"
								onclick={() => onUpdate(item, { status: 'paused' })}
								disabled={busyId === id}
							>
								{$t('admin.contentOperations.common.pause')}
							</button>
						{/if}
						{#if canReopen(item)}
							<button
								class="co-button co-button--quiet"
								type="button"
								onclick={() => reopen(item)}
								disabled={busyId === id}
							>
								{$t('admin.contentOperations.common.reopen')}
							</button>
						{/if}
						{#if canApprove(item)}
							<button
								class="co-button co-button--secondary"
								type="button"
								onclick={() => onUpdate(item, { status: 'approved' })}
								disabled={busyId === id}
							>
								{$t('admin.contentOperations.common.approve')}
							</button>
						{/if}
						{#if canRun(item)}
							<button
								class="co-button co-button--primary"
								type="button"
								onclick={() => onRun(item)}
								disabled={busyId === id}
							>
								{$t('admin.contentOperations.common.runWorkOrder')}
							</button>
						{/if}
					</footer>
				</article>
			{/each}
		</div>
	{:else}
		<div class="co-empty">
			<strong>{$t('admin.contentOperations.workOrders.empty')}</strong>
			<p>{$t('admin.contentOperations.workOrders.emptyHint')}</p>
		</div>
	{/if}
</section>

<style>
	.orders-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem;
	}
	.order-card {
		display: grid;
		align-content: start;
		gap: 0.8rem;
		padding: 1rem;
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		background: linear-gradient(180deg, #fff, #fbfcfc);
		min-width: 0;
	}
	.order-card header {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		align-items: flex-start;
	}
	.order-card h3 {
		margin: 0.3rem 0 0;
		font-size: 0.98rem;
		line-height: 1.38;
	}
	.order-card__action {
		color: var(--admin-accent);
		font-size: 0.66rem;
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	dl {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.62rem;
		margin: 0;
	}
	dl > div {
		min-width: 0;
		padding: 0.65rem;
		border-radius: 8px;
		background: #f4f7f5;
	}
	dt {
		color: var(--admin-muted);
		font-size: 0.62rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	dd {
		margin: 0.35rem 0 0;
		font-size: 0.77rem;
		font-weight: 700;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.order-select {
		width: 100%;
		min-height: 32px;
		border: 1px solid var(--admin-border);
		border-radius: 7px;
		background: #fff;
		color: var(--admin-ink);
		font: inherit;
	}
	.pipeline {
		display: flex;
		justify-content: space-between;
		gap: 0.7rem;
		padding: 0.7rem 0.8rem;
		border-left: 3px solid var(--admin-accent);
		background: #eef7f4;
		font-size: 0.75rem;
	}
	.pipeline span {
		color: var(--admin-muted);
	}
	details {
		border: 1px solid var(--admin-border);
		border-radius: 9px;
		padding: 0.65rem 0.75rem;
	}
	summary {
		cursor: pointer;
		font-size: 0.72rem;
		font-weight: 800;
		color: var(--admin-muted);
	}
	.artifacts {
		display: grid;
		gap: 0.38rem;
		margin-top: 0.6rem;
	}
	.artifacts > div {
		display: grid;
		grid-template-columns: minmax(110px, 0.65fr) 1fr;
		gap: 0.6rem;
		align-items: center;
	}
	.artifacts span {
		color: var(--admin-muted);
		font-size: 0.65rem;
		text-transform: capitalize;
	}
	.artifacts code {
		overflow-wrap: anywhere;
		font-size: 0.67rem;
	}
	.order-alerts {
		display: grid;
		gap: 0.35rem;
	}
	.order-alerts span {
		padding: 0.55rem 0.65rem;
		border-radius: 7px;
		background: #fff6e9;
		color: #8b570c;
		font-size: 0.72rem;
	}
	.order-card footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.42rem;
		flex-wrap: wrap;
		padding-top: 0.75rem;
		border-top: 1px dashed var(--admin-border);
	}
	@media (max-width: 900px) {
		.orders-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 520px) {
		dl {
			grid-template-columns: 1fr;
		}
		.order-card footer .co-button {
			flex: 1;
		}
	}
</style>
