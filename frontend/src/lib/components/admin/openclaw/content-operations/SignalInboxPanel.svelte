<script>
	import { locale, t } from '$lib/i18n/admin/index.js';
	import { entityId, firstList } from '$lib/contentOperations/contracts.js';
	import StatusBadge from './StatusBadge.svelte';

	let { signals = {}, onCreate = () => {}, onUpdate = () => {}, busyId = '' } = $props();
	let form = $state({
		sourceType: 'manual',
		title: '',
		summary: '',
		priority: 'medium',
		confidence: 'medium',
		productIds: '',
		categoryIds: '',
		expiresAt: ''
	});

	const items = $derived(firstList(signals, ['signals', 'items']));
	const sourceKey = (value) =>
		({
			sales: 'salesSignals',
			customer_support: 'customerSupportSignals',
			product: 'products',
			inventory: 'inventory',
			campaign: 'campaignSignals',
			internal_search: 'internalSearchSignals',
			manual: 'manual'
		})[value] || 'manual';
	const splitCsv = (value) =>
		String(value || '')
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
	const formatDate = (value) => {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return String(value);
		return new Intl.DateTimeFormat($locale === 'en' ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium'
		}).format(parsed);
	};
	const submit = async (event) => {
		event.preventDefault();
		const accepted = await onCreate({
			...form,
			productIds: splitCsv(form.productIds),
			categoryIds: splitCsv(form.categoryIds),
			expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null
		});
		if (accepted !== false) {
			form = { ...form, title: '', summary: '', productIds: '', categoryIds: '' };
		}
	};
</script>

<section class="signal-layout" aria-labelledby="co-signal-title">
	<form class="co-card signal-form" onsubmit={submit}>
		<div class="co-section-head">
			<div>
				<p class="co-kicker">04 / {$t('admin.contentOperations.views.signals')}</p>
				<h2 id="co-signal-title">{$t('admin.contentOperations.signals.title')}</h2>
				<p>{$t('admin.contentOperations.signals.description')}</p>
			</div>
		</div>

		<div class="privacy-note">
			<strong>{$t('admin.contentOperations.signals.privacyTitle')}</strong>
			<span>{$t('admin.contentOperations.signals.privacyText')}</span>
		</div>

		<div class="form-grid">
			<label
				><span>{$t('admin.contentOperations.fields.sourceType')}</span><select
					bind:value={form.sourceType}
					><option value="manual">{$t('admin.contentOperations.sources.manual')}</option><option
						value="sales">{$t('admin.contentOperations.sources.salesSignals')}</option
					><option value="customer_support"
						>{$t('admin.contentOperations.sources.customerSupportSignals')}</option
					><option value="product">{$t('admin.contentOperations.sources.products')}</option><option
						value="inventory">{$t('admin.contentOperations.sources.inventory')}</option
					><option value="campaign">{$t('admin.contentOperations.sources.campaignSignals')}</option
					><option value="internal_search"
						>{$t('admin.contentOperations.sources.internalSearchSignals')}</option
					></select
				></label
			>
			<label class="wide"
				><span>{$t('admin.contentOperations.fields.title')}</span><input
					bind:value={form.title}
					maxlength="180"
					required
				/></label
			>
			<label class="wide"
				><span>{$t('admin.contentOperations.fields.summary')}</span><textarea
					bind:value={form.summary}
					rows="5"
					maxlength="2000"
					required
				></textarea><small>{form.summary.length}/2000</small></label
			>
			<label
				><span>{$t('admin.contentOperations.fields.priority')}</span><select
					bind:value={form.priority}
					><option value="low">{$t('admin.contentOperations.priority.low')}</option><option
						value="medium">{$t('admin.contentOperations.priority.medium')}</option
					><option value="high">{$t('admin.contentOperations.priority.high')}</option><option
						value="critical">{$t('admin.contentOperations.priority.critical')}</option
					></select
				></label
			>
			<label
				><span>{$t('admin.contentOperations.fields.confidence')}</span><select
					bind:value={form.confidence}
					><option value="low">{$t('admin.contentOperations.priority.low')}</option><option
						value="medium">{$t('admin.contentOperations.priority.medium')}</option
					><option value="high">{$t('admin.contentOperations.priority.high')}</option></select
				></label
			>
			<label
				><span>{$t('admin.contentOperations.fields.productIds')}</span><input
					bind:value={form.productIds}
					placeholder="id-1, id-2"
				/></label
			>
			<label
				><span>{$t('admin.contentOperations.fields.categoryIds')}</span><input
					bind:value={form.categoryIds}
					placeholder="category-1"
				/></label
			>
			<label
				><span>{$t('admin.contentOperations.fields.expiresAt')}</span><input
					type="date"
					bind:value={form.expiresAt}
				/></label
			>
		</div>
		<div class="form-actions">
			<button
				class="co-button co-button--primary"
				type="submit"
				disabled={busyId === 'create-signal'}
				>{$t('admin.contentOperations.common.addSignal')}</button
			>
		</div>
	</form>

	<aside class="co-card inbox-card">
		<div class="co-section-head co-section-head--compact">
			<div>
				<p class="co-kicker">{$t('admin.contentOperations.signals.inbox')}</p>
				<h2>{$t('admin.contentOperations.signals.recent')}</h2>
			</div>
			<span class="co-count">{items.length}</span>
		</div>
		{#if items.length}
			<div class="signal-list">
				{#each items as item, index (entityId(item) || index)}
					{@const id = entityId(item)}
					<article>
						<header>
							<div>
								<small
									>{$t(`admin.contentOperations.sources.${sourceKey(item.sourceType)}`)} · {formatDate(
										item.createdAt
									)}</small
								>
								<h3>{item.title || '—'}</h3>
							</div>
							<StatusBadge status={item.status || 'new'} />
						</header>
						<p>{item.summary || item.question || item.painPoint || '—'}</p>
						{#if Array.isArray(item.usedByWorkOrderIds) && item.usedByWorkOrderIds.length}
							<details class="signal-history">
								<summary
									>{$locale === 'en'
										? `Used by ${item.usedByWorkOrderIds.length} work order(s)`
										: `Đã dùng trong ${item.usedByWorkOrderIds.length} work order`}</summary
								>
								{#each item.usedByWorkOrderIds as workOrderId, workOrderIndex (`${String(workOrderId)}-${workOrderIndex}`)}<code
										>{String(workOrderId)}</code
									>{/each}
							</details>
						{/if}
						<footer>
							<span
								>{$t(`admin.contentOperations.priority.${item.priority || 'medium'}`)} · {$t(
									`admin.contentOperations.priority.${item.confidence || 'medium'}`
								)}</span
							>
							<div>
								<button
									class="co-button co-button--quiet"
									type="button"
									onclick={() => onUpdate(item, { status: 'dismissed' })}
									disabled={busyId === id}>{$t('admin.contentOperations.common.dismiss')}</button
								><button
									class="co-button co-button--secondary"
									type="button"
									onclick={() => onUpdate(item, { status: 'reviewed' })}
									disabled={busyId === id}
									>{$t('admin.contentOperations.common.markReviewed')}</button
								>
							</div>
						</footer>
					</article>
				{/each}
			</div>
		{:else}<div class="co-empty">
				<strong>{$t('admin.contentOperations.signals.empty')}</strong>
			</div>{/if}
	</aside>
</section>

<style>
	.signal-layout {
		display: grid;
		grid-template-columns: minmax(0, 1.05fr) minmax(310px, 0.95fr);
		gap: 1rem;
		align-items: start;
	}
	.privacy-note {
		display: grid;
		gap: 0.25rem;
		padding: 0.75rem 0.85rem;
		border-left: 3px solid var(--admin-info);
		background: #eef5ff;
		color: #24466d;
		font-size: 0.75rem;
		line-height: 1.45;
	}
	.form-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}
	.form-grid label {
		display: grid;
		align-content: start;
		gap: 0.38rem;
		color: var(--admin-muted);
		font-size: 0.67rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.form-grid label.wide {
		grid-column: 1/-1;
	}
	.form-grid input,
	.form-grid select,
	.form-grid textarea {
		width: 100%;
		border: 1px solid var(--admin-border);
		border-radius: 9px;
		padding: 0.65rem 0.72rem;
		background: #fff;
		color: var(--admin-ink);
		font: inherit;
		text-transform: none;
		letter-spacing: 0;
	}
	.form-grid textarea {
		resize: vertical;
	}
	.form-grid small {
		text-align: right;
		font-size: 0.62rem;
	}
	.form-actions {
		display: flex;
		justify-content: flex-end;
	}
	.signal-list {
		display: grid;
		max-height: 720px;
		overflow: auto;
	}
	.signal-list article {
		display: grid;
		gap: 0.55rem;
		padding: 0.85rem 0;
		border-bottom: 1px solid var(--admin-border);
	}
	.signal-list article:last-child {
		border: 0;
	}
	.signal-list header,
	.signal-list footer {
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
		align-items: flex-start;
	}
	.signal-list h3 {
		margin: 0.25rem 0 0;
		font-size: 0.86rem;
	}
	.signal-list small,
	.signal-list footer > span {
		color: var(--admin-muted);
		font-size: 0.66rem;
	}
	.signal-list p {
		margin: 0;
		color: #4f5d59;
		font-size: 0.76rem;
		line-height: 1.5;
	}
	.signal-history {
		display: grid;
		gap: 0.3rem;
		padding: 0.5rem;
		border: 1px solid var(--admin-border);
		border-radius: 7px;
	}
	.signal-history summary {
		cursor: pointer;
		color: var(--admin-muted);
		font-size: 0.68rem;
		font-weight: 800;
	}
	.signal-history code {
		display: block;
		overflow-wrap: anywhere;
		font-size: 0.65rem;
	}
	.signal-list footer {
		align-items: center;
	}
	.signal-list footer div {
		display: flex;
		gap: 0.35rem;
	}
	@media (max-width: 980px) {
		.signal-layout {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 560px) {
		.form-grid {
			grid-template-columns: 1fr;
		}
		.form-grid label.wide {
			grid-column: auto;
		}
		.signal-list footer {
			display: grid;
		}
		.signal-list footer div {
			width: 100%;
		}
		.signal-list footer .co-button {
			flex: 1;
		}
	}
</style>
