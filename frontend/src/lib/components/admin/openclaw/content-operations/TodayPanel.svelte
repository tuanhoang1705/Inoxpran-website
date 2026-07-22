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

	const SOURCE_STATE_COPY = {
		vi: {
			unknown: 'Chưa kiểm tra',
			disabled: 'Đã tắt',
			not_configured: 'Thiếu cấu hình',
			degraded: 'Suy giảm',
			failed: 'Thất bại',
			ready: 'Sẵn sàng',
			unavailable: 'Không khả dụng'
		},
		en: {
			unknown: 'Not checked',
			disabled: 'Disabled',
			not_configured: 'Not configured',
			degraded: 'Degraded',
			failed: 'Failed',
			ready: 'Ready',
			unavailable: 'Unavailable'
		}
	};

	const REASON_COPY = {
		vi: {
			not_checked: 'Nguồn này chưa được kiểm tra.',
			search_console_disabled: 'Search Console đang tắt theo cấu hình.',
			search_console_property_missing: 'Chưa thiết lập thuộc tính Search Console.',
			search_console_adapter_not_configured: 'Bộ kết nối Search Console chưa được cấu hình.',
			search_console_token_timeout: 'Xác thực Search Console quá thời gian chờ.',
			search_console_token_unavailable: 'Không lấy được quyền truy cập Search Console.',
			search_console_request_timeout: 'Search Console phản hồi quá thời gian chờ.',
			search_console_request_failed: 'Không đọc được dữ liệu Search Console.',
			aggregate_analytics_disabled: 'Analytics tổng hợp đang tắt theo cấu hình.',
			aggregate_analytics_provider_missing: 'Nguồn Analytics tổng hợp chưa được cấu hình.',
			aggregate_analytics_query_timeout: 'Truy vấn Analytics quá thời gian chờ.',
			aggregate_analytics_query_failed: 'Không đọc được dữ liệu Analytics tổng hợp.',
			trends_disabled: 'Nguồn xu hướng đang tắt theo cấu hình.',
			trends_provider_missing: 'Chưa cấu hình nhà cung cấp dữ liệu xu hướng.',
			trends_provider_timeout: 'Nguồn xu hướng phản hồi quá thời gian chờ.',
			trends_provider_failed: 'Không đọc được dữ liệu xu hướng.',
			content_signals_disabled: 'Tín hiệu nội dung đang tắt theo cấu hình.',
			content_signals_service_missing: 'Dịch vụ tín hiệu nội dung chưa sẵn sàng.',
			content_signals_read_failed: 'Không đọc được tín hiệu nội dung.',
			product_catalog_read_failed: 'Không đọc được danh mục sản phẩm.',
			inventory_build_failed: 'Không thể tạo snapshot kho nội dung.',
			orphan_content: 'Có nội dung chưa được liên kết nội bộ.'
		},
		en: {
			not_checked: 'This source has not been checked yet.',
			search_console_disabled: 'Search Console is disabled by configuration.',
			search_console_property_missing: 'The Search Console property is not configured.',
			search_console_adapter_not_configured: 'The Search Console connector is not configured.',
			search_console_token_timeout: 'Search Console authentication timed out.',
			search_console_token_unavailable: 'Search Console access could not be obtained.',
			search_console_request_timeout: 'The Search Console request timed out.',
			search_console_request_failed: 'Search Console data could not be read.',
			aggregate_analytics_disabled: 'Aggregate analytics is disabled by configuration.',
			aggregate_analytics_provider_missing: 'The aggregate analytics source is not configured.',
			aggregate_analytics_query_timeout: 'The analytics query timed out.',
			aggregate_analytics_query_failed: 'Aggregate analytics data could not be read.',
			trends_disabled: 'The trends source is disabled by configuration.',
			trends_provider_missing: 'The trends provider is not configured.',
			trends_provider_timeout: 'The trends provider timed out.',
			trends_provider_failed: 'Trends data could not be read.',
			content_signals_disabled: 'Content signals are disabled by configuration.',
			content_signals_service_missing: 'The content signals service is not ready.',
			content_signals_read_failed: 'Content signals could not be read.',
			product_catalog_read_failed: 'The product catalog could not be read.',
			inventory_build_failed: 'The content inventory snapshot could not be built.',
			orphan_content: 'Some content has no internal links.'
		}
	};

	const NEUTRAL_DISABLED_REASONS = new Set([
		'search_console_disabled',
		'aggregate_analytics_disabled',
		'trends_disabled',
		'content_signals_disabled'
	]);
	const language = () => ($locale === 'en' ? 'en' : 'vi');
	const reasonCode = (item) =>
		String(
			item?.errorCode ||
				item?.reason ||
				item?.code ||
				(typeof item === 'string' ? item : '') ||
				''
		)
			.trim()
			.slice(0, 120);
	const localizedReason = (value) => {
		const code = String(value || '').trim();
		if (!code) return '';
		const copy = REASON_COPY[language()][code.toLowerCase()];
		if (copy) return copy;
		if (/^SEARCH_CONSOLE_HTTP_/i.test(code)) {
			return language() === 'en'
				? `Search Console returned ${code.replace(/^SEARCH_CONSOLE_HTTP_/i, 'HTTP ')}.`
				: `Search Console trả về lỗi ${code.replace(/^SEARCH_CONSOLE_HTTP_/i, 'HTTP ')}.`;
		}
		if (!/^[A-Za-z0-9_-]+$/.test(code)) return code;
		return language() === 'en' ? `Diagnostic code: ${code}` : `Mã chẩn đoán: ${code}`;
	};
	const sourceStateLabel = (state) =>
		SOURCE_STATE_COPY[language()][state] || SOURCE_STATE_COPY[language()].unknown;
	const sourceReason = (source) => {
		if (!source || typeof source !== 'object') return localizedReason('not_checked');
		const code = reasonCode(source);
		if (code) return localizedReason(code);
		const state = sourceState(source);
		if (state === 'unknown') return localizedReason('not_checked');
		if (state === 'disabled') {
			return language() === 'en'
				? 'This optional source is disabled.'
				: 'Nguồn tùy chọn này đang tắt.';
		}
		if (state === 'not_configured') {
			return language() === 'en'
				? 'This source is enabled but its prerequisites are missing.'
				: 'Nguồn đã bật nhưng còn thiếu điều kiện cấu hình.';
		}
		if (state === 'degraded') {
			return language() === 'en'
				? 'Only part of this source was read successfully.'
				: 'Chỉ một phần dữ liệu nguồn được đọc thành công.';
		}
		return '';
	};
	const isNeutralDisabledWarning = (item) =>
		NEUTRAL_DISABLED_REASONS.has(reasonCode(item).toLowerCase());

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
		]
			.filter((item) => !isNeutralDisabledWarning(item))
			.slice(0, 6)
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
	const warningText = (item) => {
		const code = reasonCode(item);
		if (code) return localizedReason(code);
		return String(item?.message || item?.title || '');
	};
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
				{@const state = sourceState(source)}
				{@const reason = sourceReason(source)}
				<div class="source-row">
					<span>{sourceLabel(key)}</span>
					<div>
						<StatusBadge status={state} label={sourceStateLabel(state)} />
						{#if reason}<small class="source-reason">{reason}</small>{/if}
						{#if source?.checkedAt || source?.freshAt}
							<small>{formatDate(source.checkedAt || source.freshAt)}</small>
						{/if}
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

	.source-row .source-reason {
		max-width: 15rem;
		color: color-mix(in srgb, var(--admin-text) 72%, var(--admin-muted));
		line-height: 1.4;
		text-align: right;
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
