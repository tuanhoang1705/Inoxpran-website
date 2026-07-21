<script>
	import { locale, t } from '$lib/i18n/admin/index.js';
	import {
		actionTranslationKey,
		asArray,
		entityId,
		firstList
	} from '$lib/contentOperations/contracts.js';
	import StatusBadge from './StatusBadge.svelte';

	let { inventory = {}, onMonitor = () => {}, onRebuild = () => {}, busy = false } = $props();
	let query = $state('');
	const allItems = $derived(firstList(inventory, ['items', 'articles', 'inventory']));
	const items = $derived(
		allItems.filter((item) =>
			`${item.title || ''} ${item.slug || ''}`.toLowerCase().includes(query.trim().toLowerCase())
		)
	);
	const formatDate = (value) => {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return String(value);
		return new Intl.DateTimeFormat($locale === 'en' ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium'
		}).format(date);
	};
	const warnings = (item) => asArray(item?.warnings);
	const performanceStatus = (item) =>
		item?.performanceSummary?.status || (item?.performanceSummary ? 'available' : 'unavailable');
	const recommendationFor = (item) => {
		const itemWarnings = new Set(warnings(item));
		if (itemWarnings.has('duplicate_intent_candidate')) return 'merge';
		if (
			itemWarnings.has('broken_product_link') ||
			itemWarnings.has('inactive_product_link') ||
			itemWarnings.has('stale_product_evidence')
		) {
			return 'content_maintenance';
		}
		if (item?.reviewStatus === 'stale' || item?.reviewStatus === 'review_due') {
			return Number(item?.wordCount || 0) < 650 ? 'expand' : 'update';
		}
		if (
			itemWarnings.has('broken_blog_link') ||
			itemWarnings.has('no_outbound_blog_links') ||
			itemWarnings.has('orphan_content')
		) {
			return 'internal_link_maintenance';
		}
		return 'skip';
	};
	const warningText = (item) => String(item?.message || item?.reason || item?.title || item || '');
</script>

<section class="co-card" aria-labelledby="co-inventory-title">
	<div class="co-section-head">
		<div>
			<p class="co-kicker">05 / {$t('admin.contentOperations.views.inventory')}</p>
			<h2 id="co-inventory-title">{$t('admin.contentOperations.inventory.title')}</h2>
			<p>{$t('admin.contentOperations.inventory.description')}</p>
		</div>
		<div class="inventory-actions">
			<label
				><span class="sr-only">{$t('common.search')}</span><input
					type="search"
					bind:value={query}
					placeholder={$t('admin.contentOperations.inventory.search')}
				/></label
			><button
				class="co-button co-button--secondary"
				type="button"
				onclick={onRebuild}
				disabled={busy}>{$t('admin.contentOperations.common.rebuild')}</button
			>
		</div>
	</div>

	<div class="inventory-summary">
		<div>
			<span>{$t('admin.contentOperations.inventory.totalPublished')}</span><strong
				>{inventory?.summary?.totalPublished ??
					inventory?.totalPublished ??
					allItems.length}</strong
			>
		</div>
		<div>
			<span>{$t('admin.contentOperations.inventory.stale')}</span><strong
				>{inventory?.summary?.staleArticles ?? '—'}</strong
			>
		</div>
		<div>
			<span>{$t('admin.contentOperations.inventory.orphans')}</span><strong
				>{inventory?.summary?.orphanArticles ?? '—'}</strong
			>
		</div>
		<div>
			<span>{$t('admin.contentOperations.inventory.productWarnings')}</span><strong
				>{inventory?.summary?.outdatedProductReferences ?? '—'}</strong
			>
		</div>
	</div>

	{#if items.length}
		<div class="inventory-table-wrap">
			<table>
				<thead
					><tr
						><th>{$t('admin.contentOperations.fields.article')}</th><th
							>{$t('admin.contentOperations.fields.status')}</th
						><th>{$t('admin.contentOperations.fields.lastReview')}</th><th
							>{$t('admin.contentOperations.fields.performance')}</th
						><th>{$t('admin.contentOperations.fields.warnings')}</th><th
							>{$t('admin.contentOperations.fields.recommendedAction')}</th
						><th></th></tr
					></thead
				><tbody>
					{#each items as item, index (entityId(item.blogId || item) || index)}
						<tr
							><td><strong>{item.title || '—'}</strong><small>/{item.slug || '—'}</small></td><td
								><StatusBadge status={item.reviewStatus || 'unknown'} /></td
							><td>{formatDate(item.lastReviewedAt)}</td><td
								><StatusBadge status={performanceStatus(item)} /></td
							><td
								>{#if warnings(item).length}<details>
										<summary>{warnings(item).length}</summary>
										<ul>
											{#each warnings(item).slice(0, 6) as warning, warningIndex (`${warningText(warning)}-${warningIndex}`)}<li
												>
													{warningText(warning)}
												</li>{/each}
										</ul>
									</details>{:else}—{/if}</td
							><td
								><span class="recommended">{$t(actionTranslationKey(recommendationFor(item)))}</span
								></td
							><td
								><button
									class="co-button co-button--quiet"
									type="button"
									onclick={() => onMonitor(item)}
									>{$t('admin.contentOperations.common.inspect')}</button
								></td
							></tr
						>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}<div class="co-empty">
			<strong>{$t('admin.contentOperations.inventory.empty')}</strong>
		</div>{/if}
</section>

<style>
	.inventory-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.inventory-actions input {
		min-height: 40px;
		width: min(300px, 60vw);
		border: 1px solid var(--admin-border);
		border-radius: 9px;
		padding: 0.55rem 0.7rem;
		background: #fff;
		color: var(--admin-ink);
	}
	.inventory-summary {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		border: 1px solid var(--admin-border);
		border-radius: 11px;
		overflow: hidden;
	}
	.inventory-summary > div {
		display: grid;
		gap: 0.45rem;
		padding: 0.85rem;
		border-right: 1px solid var(--admin-border);
		background: #f8faf9;
	}
	.inventory-summary > div:last-child {
		border: 0;
	}
	.inventory-summary span {
		color: var(--admin-muted);
		font-size: 0.65rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.055em;
	}
	.inventory-summary strong {
		font:
			800 1.25rem/1 ui-monospace,
			'Cascadia Mono',
			monospace;
	}
	.inventory-table-wrap {
		overflow: auto;
		border: 1px solid var(--admin-border);
		border-radius: 11px;
	}
	.inventory-table-wrap table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.74rem;
	}
	.inventory-table-wrap th {
		padding: 0.7rem;
		background: #f2f6f4;
		color: var(--admin-muted);
		font-size: 0.62rem;
		text-align: left;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		white-space: nowrap;
	}
	.inventory-table-wrap td {
		padding: 0.75rem;
		border-top: 1px solid var(--admin-border);
		vertical-align: middle;
		min-width: 95px;
	}
	.inventory-table-wrap td:first-child {
		min-width: 200px;
	}
	.inventory-table-wrap td > small {
		display: block;
		margin-top: 0.3rem;
		color: var(--admin-muted);
		overflow-wrap: anywhere;
	}
	.inventory-table-wrap details summary {
		cursor: pointer;
		color: var(--admin-warning);
		font-weight: 800;
	}
	.inventory-table-wrap ul {
		width: 250px;
		margin: 0.5rem 0 0;
		padding-left: 1rem;
		line-height: 1.5;
	}
	.recommended {
		color: var(--admin-accent);
		font-size: 0.68rem;
		font-weight: 800;
		text-transform: uppercase;
	}
	@media (max-width: 850px) {
		.inventory-summary {
			grid-template-columns: 1fr 1fr;
		}
	}
	@media (max-width: 520px) {
		.inventory-summary {
			grid-template-columns: 1fr;
		}
		.inventory-summary > div {
			border-right: 0;
			border-bottom: 1px solid var(--admin-border);
		}
		.inventory-actions,
		.inventory-actions label,
		.inventory-actions input,
		.inventory-actions .co-button {
			width: 100%;
		}
	}
</style>
