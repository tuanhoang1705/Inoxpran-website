<script>
	import { resolve } from '$app/paths';
	import { locale, t } from '$lib/i18n/admin/index.js';
	import { untrack } from 'svelte';
	import StatusBadge from '$lib/components/admin/openclaw/content-operations/StatusBadge.svelte';
	import { statusTranslationKey } from '$lib/contentOperations/contracts.js';
	import {
		canResumeArticleQaRemediation,
		canUseQaAction,
		latestQaReportForCase,
		normalizeQaBatch,
		normalizeQaBatchDetail,
		normalizeQaReport,
		persistedQaScore,
		qaAcceptanceStatus,
		qaBatchList,
		qaDraftAdminPath,
		qaEntityId,
		qaFeatureAccess
	} from '$lib/openclaw/blogQa.js';

	let { data } = $props();
	const initialData = untrack(() => data);
	const initialBatches = qaBatchList(initialData?.batches);
	const initialSelectedBatch = initialData?.batch
		? normalizeQaBatch(initialData.batch)
		: initialBatches[0] || null;
	let batches = $state(initialBatches);
	let selectedBatch = $state(initialSelectedBatch);
	let reports = $state(
		(Array.isArray(initialData?.reports) ? initialData.reports : []).map(normalizeQaReport)
	);
	let accessPayload = $state({
		featureEnabled: initialData?.qaAccess?.enabled === true,
		actions: initialData?.qaAccess?.actions || []
	});
	let selectedCaseId = $state(initialSelectedBatch?.cases?.[0]?.id || '');
	let createEnvironment = $state(
		['local', 'staging'].includes(initialData?.qaAccess?.environment)
			? initialData.qaAccess.environment
			: ''
	);
	let busyAction = $state('');
	let notice = $state(null);
	let pageError = $state(initialData?.loadError || '');
	let idempotencyKeys = $state({});

	const access = $derived(qaFeatureAccess(accessPayload));
	const qaEnabled = $derived(access.enabled === true);
	const selectedCase = $derived(
		selectedBatch?.cases?.find((item) => item.id === selectedCaseId) ||
			selectedBatch?.cases?.[0] ||
			null
	);
	const combinedReports = $derived(reports.length ? reports : selectedBatch?.reports || []);
	const selectedReport = $derived(latestQaReportForCase(combinedReports, selectedCase?.id || ''));
	const isEn = $derived($locale === 'en');

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com') {
			return path;
		}
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
	};

	const canAction = (action) =>
		canUseQaAction(access, action) || canUseQaAction(access, `agentic_blog_qa.${action}`);

	const translated = (key, fallback) => {
		const value = $t(key);
		return value === key ? fallback : value;
	};

	const statusLabel = (status) =>
		translated(statusTranslationKey(status), String(status || '--').replaceAll('_', ' '));

	const executionModeLabel = (mode) =>
		translated(
			`admin.contentOperations.qa.executionModes.${String(mode || '').toLowerCase()}`,
			String(mode || '--').replaceAll('_', ' ')
		);

	const rubricLabel = (category) =>
		translated(
			`admin.contentOperations.qa.rubric.${category?.key || ''}`,
			String(category?.label || category?.key || '--')
		);

	const remediationLabel = (attempt = {}) => {
		const classification = String(attempt.classification || '')
			.trim()
			.toLowerCase();
		if (classification) {
			return translated(
				`admin.contentOperations.qa.remediationTypes.${classification}`,
				classification.replaceAll('_', ' ')
			);
		}
		return statusLabel(attempt.status || 'remediating');
	};

	const remediationNeedsVerifiedCodeEvidence = (attempt = {}) =>
		attempt.status === 'awaiting_action' &&
		['shared_stage', 'systemic_workflow'].includes(attempt.classification);

	const batchCaseCount = (batch = {}) =>
		Number.isFinite(Number(batch.caseCount)) ? Number(batch.caseCount) : batch.cases?.length || 0;

	const formatDateTime = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		return new Intl.DateTimeFormat(isEn ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	};

	const displayIssue = (value) => {
		if (typeof value === 'string') return value.slice(0, 500);
		return String(value?.message || value?.description || value?.code || '').slice(0, 500);
	};

	const idempotencyKeyFor = (operation) => {
		if (idempotencyKeys[operation]) return idempotencyKeys[operation];
		const generated =
			typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
		idempotencyKeys = { ...idempotencyKeys, [operation]: generated };
		return generated;
	};

	const clearIdempotencyKey = (operation) => {
		const next = { ...idempotencyKeys };
		delete next[operation];
		idempotencyKeys = next;
	};

	const api = async (path = '', options = {}) => {
		const suffix = path ? `/${path}` : '';
		const response = await fetch(
			resolveAdminPath(`/admin/api/openclaw/qa-batches${suffix}${options.query || ''}`),
			{
				method: options.method || 'GET',
				headers: options.body
					? {
							'content-type': 'application/json',
							...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {})
						}
					: undefined,
				body: options.body ? JSON.stringify(options.body) : undefined
			}
		);
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(
				String(payload?.error || $t('admin.contentOperations.qa.feedback.requestFailed')).slice(
					0,
					300
				)
			);
		}
		return payload || {};
	};

	const showSuccess = (key) => {
		notice = { tone: 'success', text: $t(`admin.contentOperations.qa.feedback.${key}`) };
	};

	const showError = (error) => {
		notice = {
			tone: 'danger',
			text:
				error instanceof Error
					? error.message
					: $t('admin.contentOperations.qa.feedback.requestFailed')
		};
	};

	const applyBatchPayload = (payload) => {
		const next = normalizeQaBatchDetail(payload);
		if (!next.id) return;
		selectedBatch = next;
		selectedCaseId = next.cases.some((item) => item.id === selectedCaseId)
			? selectedCaseId
			: next.cases[0]?.id || '';
		const index = batches.findIndex((batch) => batch.id === next.id);
		batches =
			index >= 0
				? [...batches.slice(0, index), next, ...batches.slice(index + 1)]
				: [next, ...batches];
	};

	const fetchBatchDetail = async (batchId) => {
		const id = qaEntityId(batchId);
		if (!id) return;
		const [detail, reportPayload] = await Promise.all([
			api(encodeURIComponent(id)),
			api(`${encodeURIComponent(id)}/reports`)
		]);
		applyBatchPayload(detail);
		const reportItems = Array.isArray(reportPayload)
			? reportPayload
			: reportPayload?.reports || reportPayload?.items || [];
		reports = (Array.isArray(reportItems) ? reportItems : []).map(normalizeQaReport);
	};

	const loadBatch = async (batchId) => {
		const id = qaEntityId(batchId);
		if (!id || busyAction) return;
		busyAction = `load:${id}`;
		pageError = '';
		try {
			await fetchBatchDetail(id);
		} catch (error) {
			showError(error);
		} finally {
			busyAction = '';
		}
	};

	const refresh = async () => {
		if (busyAction) return;
		busyAction = 'refresh';
		try {
			const payload = await api('', { query: '?limit=20&page=1' });
			batches = qaBatchList(payload);
			accessPayload = payload;
			const refreshedEnvironment = String(payload?.environment || '').trim();
			if (['local', 'staging'].includes(refreshedEnvironment)) {
				createEnvironment = refreshedEnvironment;
			}
			if (selectedBatch?.id) {
				await fetchBatchDetail(selectedBatch.id);
			}
			showSuccess('refreshed');
		} catch (error) {
			showError(error);
		} finally {
			busyAction = '';
		}
	};

	const createBatch = async () => {
		if (!canAction('create') || busyAction) return;
		const operation = `create:${createEnvironment}`;
		busyAction = 'create';
		try {
			const payload = await api('', {
				method: 'POST',
				idempotencyKey: idempotencyKeyFor(operation),
				body: { environment: createEnvironment }
			});
			applyBatchPayload(payload);
			await fetchBatchDetail(normalizeQaBatchDetail(payload).id);
			clearIdempotencyKey(operation);
			showSuccess('created');
		} catch (error) {
			showError(error);
		} finally {
			busyAction = '';
		}
	};

	const performBatchAction = async (action) => {
		if (!selectedBatch?.id || !canAction(action) || busyAction) return;
		if (!window.confirm($t(`admin.contentOperations.qa.confirm.${action}`))) return;
		const operation = `${selectedBatch.id}:${action}`;
		busyAction = action;
		try {
			const payload = await api(`${encodeURIComponent(selectedBatch.id)}/${action}`, {
				method: 'POST',
				idempotencyKey: idempotencyKeyFor(operation),
				body: {}
			});
			const batchId = normalizeQaBatchDetail(payload).id || selectedBatch.id;
			await fetchBatchDetail(batchId);
			clearIdempotencyKey(operation);
			showSuccess(
				action === 'run' ? 'runQueued' : action === 'review' ? 'reviewQueued' : 'remediationQueued'
			);
		} catch (error) {
			showError(error);
		} finally {
			busyAction = '';
		}
	};

	const resumeArticleRemediation = async (attempt) => {
		const batchId = qaEntityId(selectedBatch?.id);
		const attemptId = qaEntityId(attempt?.id);
		if (
			!batchId ||
			!attemptId ||
			selectedBatch?.status !== 'awaiting_remediation_action' ||
			!canAction('remediate') ||
			!canResumeArticleQaRemediation(attempt) ||
			busyAction
		) {
			return;
		}
		if (!window.confirm($t('admin.contentOperations.qa.confirm.resumeArticle'))) return;
		busyAction = `resume:${attemptId}`;
		try {
			await api(
				`${encodeURIComponent(batchId)}/remediation/${encodeURIComponent(attemptId)}/resume`,
				{ method: 'POST', body: {} }
			);
			await fetchBatchDetail(batchId);
			showSuccess('remediationResumed');
		} catch (error) {
			showError(error);
		} finally {
			busyAction = '';
		}
	};
</script>

<svelte:head>
	<title>{$t('admin.contentOperations.qa.pageTitle')}</title>
	<meta name="description" content={$t('admin.contentOperations.qa.pageDescription')} />
</svelte:head>

<div class="qa-page">
	<header class="qa-hero">
		<div>
			<nav aria-label={$t('admin.contentOperations.qa.breadcrumbLabel')}>
				<a href={resolve(resolveAdminPath('/admin/openclaw'))}>OpenClaw</a><span>/</span>
				<a href={resolve(resolveAdminPath('/admin/openclaw/content-operations'))}
					>{$t('admin.contentOperations.qa.back')}</a
				><span>/</span><strong>{$t('admin.contentOperations.qa.shortTitle')}</strong>
			</nav>
			<p class="qa-kicker">{$t('admin.contentOperations.qa.kicker')}</p>
			<h1>{$t('admin.contentOperations.qa.title')}</h1>
			<p>{$t('admin.contentOperations.qa.description')}</p>
		</div>
		<div class="qa-hero__aside">
			<span>{$t('admin.contentOperations.qa.badge')}</span>
			<button type="button" onclick={refresh} disabled={Boolean(busyAction)}>
				{busyAction === 'refresh'
					? $t('admin.contentOperations.qa.refreshing')
					: $t('admin.contentOperations.qa.refresh')}
			</button>
		</div>
	</header>

	<section class="qa-safety" aria-labelledby="qa-safety-title">
		<div aria-hidden="true">81</div>
		<p>
			<strong id="qa-safety-title">{$t('admin.contentOperations.qa.safetyTitle')}</strong>
			<span>{$t('admin.contentOperations.qa.safetyDescription')}</span>
			<small>{$t('admin.contentOperations.qa.thresholdNote')}</small>
		</p>
	</section>

	{#if pageError}
		<p class="qa-alert qa-alert--danger" role="alert">{pageError}</p>
	{/if}
	{#if notice}
		<div
			class:qa-alert--danger={notice.tone === 'danger'}
			class="qa-alert"
			role={notice.tone === 'danger' ? 'alert' : 'status'}
		>
			<p>{notice.text}</p>
			<button type="button" aria-label={$t('common.close')} onclick={() => (notice = null)}
				>x</button
			>
		</div>
	{/if}

	{#if !qaEnabled}
		<section class="qa-disabled" role="status">
			<StatusBadge status="expected_disabled" />
			<div>
				<strong>{$t('admin.contentOperations.qa.noBatches')}</strong>
				<p>{$t('admin.contentOperations.qa.noBatchesHint')}</p>
			</div>
		</section>
	{/if}

	{#if qaEnabled && canAction('create')}
		<section class="qa-create" aria-label={$t('admin.contentOperations.qa.createBatch')}>
			<div>
				<span>{$t('admin.contentOperations.qa.fields.environment')}</span>
				<strong>{createEnvironment || '--'}</strong>
			</div>
			<button
				type="button"
				onclick={createBatch}
				disabled={Boolean(busyAction) || !createEnvironment}
			>
				{busyAction === 'create'
					? $t('admin.contentOperations.qa.creating')
					: $t('admin.contentOperations.qa.createBatch')}
			</button>
		</section>
	{/if}

	<div class="qa-layout">
		<aside class="qa-batches" aria-label={$t('admin.contentOperations.qa.batchList')}>
			<header>
				<h2>{$t('admin.contentOperations.qa.batchList')}</h2>
				<span>{batches.length}</span>
			</header>
			{#if batches.length}
				<div class="qa-batches__list">
					{#each batches as batch (batch.id)}
						<button
							type="button"
							class:active={selectedBatch?.id === batch.id}
							aria-pressed={selectedBatch?.id === batch.id}
							onclick={() => loadBatch(batch.id)}
							disabled={Boolean(busyAction)}
						>
							<span>{batch.environment}</span>
							<strong>{batch.id}</strong>
							<small
								>{statusLabel(batch.status)} &middot; {$t('admin.contentOperations.qa.caseCount', {
									count: batchCaseCount(batch)
								})}</small
							>
						</button>
					{/each}
				</div>
			{:else}
				<div class="qa-empty">
					<strong>{$t('admin.contentOperations.qa.noBatches')}</strong><span
						>{$t('admin.contentOperations.qa.noBatchesHint')}</span
					>
				</div>
			{/if}
		</aside>

		<main class="qa-detail">
			{#if selectedBatch}
				<section class="qa-card qa-summary">
					<header class="qa-section-head">
						<div>
							<p class="qa-kicker">{$t('admin.contentOperations.qa.batchDetail')}</p>
							<h2>{selectedBatch.id}</h2>
						</div>
						<StatusBadge status={selectedBatch.status} />
					</header>
					<dl>
						<div>
							<dt>{$t('admin.contentOperations.qa.fields.environment')}</dt>
							<dd>{selectedBatch.environment}</dd>
						</div>
						<div>
							<dt>{$t('admin.contentOperations.qa.fields.iteration')}</dt>
							<dd>{selectedBatch.iteration ?? '--'} / {selectedBatch.maxIterations ?? '--'}</dd>
						</div>
						<div>
							<dt>{$t('admin.contentOperations.qa.fields.threshold')}</dt>
							<dd>{persistedQaScore(selectedBatch.acceptanceThreshold)} / 100</dd>
						</div>
						<div>
							<dt>{$t('admin.contentOperations.qa.fields.seoThreshold')}</dt>
							<dd>{persistedQaScore(selectedBatch.existingSeoThreshold)} / 100</dd>
						</div>
						<div>
							<dt>{$t('admin.contentOperations.qa.fields.startedAt')}</dt>
							<dd>{formatDateTime(selectedBatch.startedAt)}</dd>
						</div>
						<div>
							<dt>{$t('admin.contentOperations.qa.fields.completedAt')}</dt>
							<dd>{formatDateTime(selectedBatch.completedAt)}</dd>
						</div>
					</dl>
					{#if qaEnabled && (canAction('run') || canAction('review') || canAction('remediate'))}
						<div class="qa-summary__actions">
							{#if canAction('run')}
								<button
									type="button"
									onclick={() => performBatchAction('run')}
									disabled={Boolean(busyAction)}>{$t('admin.contentOperations.qa.runBatch')}</button
								>
							{/if}
							{#if canAction('review')}
								<button
									type="button"
									onclick={() => performBatchAction('review')}
									disabled={Boolean(busyAction)}
									>{$t('admin.contentOperations.qa.reviewBatch')}</button
								>
							{/if}
							{#if canAction('remediate') && Number.isFinite(selectedBatch.iteration) && Number.isFinite(selectedBatch.maxIterations) && selectedBatch.iteration < selectedBatch.maxIterations}
								<button
									class="warn"
									type="button"
									onclick={() => performBatchAction('remediate')}
									disabled={Boolean(busyAction)}
									>{$t('admin.contentOperations.qa.remediateBatch')}</button
								>
							{/if}
						</div>
					{/if}
				</section>

				<section class="qa-card">
					<header class="qa-section-head">
						<div>
							<p class="qa-kicker">01 / {$t('admin.contentOperations.qa.sectionLabels.cases')}</p>
							<h2>{$t('admin.contentOperations.qa.cases')}</h2>
						</div>
						<span class="qa-count">{selectedBatch.cases.length}</span>
					</header>
					{#if selectedBatch.cases.length}
						<div class="qa-case-list">
							{#each selectedBatch.cases as item (item.id)}
								<article class:active={selectedCase?.id === item.id}>
									<button
										class="qa-case-list__select"
										type="button"
										aria-pressed={selectedCase?.id === item.id}
										onclick={() => (selectedCaseId = item.id)}
									>
										<span>{executionModeLabel(item.executionMode)}</span><strong
											>{item.topic || item.id}</strong
										><small>{item.articleType || '--'}</small>
									</button>
									<div>
										<StatusBadge status={item.status} /><b
											>{persistedQaScore(item.seniorScore)} / 100</b
										>
									</div>
									{#if qaDraftAdminPath(item.blogId)}
										<a href={resolve(resolveAdminPath(qaDraftAdminPath(item.blogId)))}
											>{$t('admin.contentOperations.qa.draftLink')}</a
										>
									{:else}<span class="qa-no-draft">{$t('admin.contentOperations.qa.noDraft')}</span
										>{/if}
								</article>
							{/each}
						</div>
					{:else}
						<div class="qa-empty">{$t('admin.contentOperations.qa.noCases')}</div>
					{/if}
				</section>

				{#if selectedCase}
					<section class="qa-card qa-case-detail">
						<header class="qa-section-head">
							<div>
								<p class="qa-kicker">
									02 / {$t('admin.contentOperations.qa.sectionLabels.caseDetail')}
								</p>
								<h2>{selectedCase.topic || selectedCase.id}</h2>
							</div>
							<StatusBadge status={selectedCase.status} />
						</header>
						<div class="qa-metrics">
							<div>
								<span>{$t('admin.contentOperations.qa.fields.seniorScore')}</span><strong
									>{persistedQaScore(selectedCase.seniorScore)}</strong
								>
							</div>
							<div>
								<span>{$t('admin.contentOperations.qa.fields.seoScore')}</span><strong
									>{persistedQaScore(selectedCase.existingSeoScore)}</strong
								>
							</div>
							<div>
								<span>{$t('admin.contentOperations.qa.fields.hardGates')}</span><StatusBadge
									status={qaAcceptanceStatus(selectedCase.hardGateStatus)}
								/>
							</div>
							<div>
								<span>{$t('admin.contentOperations.qa.fields.draftAcceptance')}</span><StatusBadge
									status={qaAcceptanceStatus(selectedCase.draftAcceptance)}
								/>
							</div>
							<div>
								<span>{$t('admin.contentOperations.qa.fields.publishAcceptance')}</span><StatusBadge
									status={qaAcceptanceStatus(selectedCase.publishAcceptance)}
								/>
							</div>
						</div>
						<dl class="qa-case-facts">
							<div>
								<dt>{$t('admin.contentOperations.qa.fields.executionMode')}</dt>
								<dd>{executionModeLabel(selectedCase.executionMode)}</dd>
							</div>
							<div>
								<dt>{$t('admin.contentOperations.qa.fields.schedule')}</dt>
								<dd>{selectedCase.scheduleId || '--'}</dd>
							</div>
							<div>
								<dt>{$t('admin.contentOperations.qa.fields.expectedRunAt')}</dt>
								<dd>{formatDateTime(selectedCase.expectedRunAt)}</dd>
							</div>
							<div>
								<dt>{$t('admin.contentOperations.qa.fields.actualRunAt')}</dt>
								<dd>{formatDateTime(selectedCase.actualRunAt)}</dd>
							</div>
							<div>
								<dt>{$t('admin.contentOperations.qa.fields.executionId')}</dt>
								<dd>{selectedCase.executionId || '--'}</dd>
							</div>
						</dl>
						<div class="qa-issue-grid">
							<div>
								<h3>{$t('admin.contentOperations.qa.issues')}</h3>
								{#if selectedCase.issues.length}<ul>
										{#each selectedCase.issues as issue, index (`case-issue-${selectedCase.id}-${index}`)}<li
											>
												{displayIssue(issue)}
											</li>{/each}
									</ul>{:else}<p>--</p>{/if}
							</div>
							<div>
								<h3>{$t('admin.contentOperations.qa.requiredFixes')}</h3>
								{#if selectedCase.requiredFixes.length}<ul>
										{#each selectedCase.requiredFixes as fix, index (`case-fix-${selectedCase.id}-${index}`)}<li
											>
												{displayIssue(fix)}
											</li>{/each}
									</ul>{:else}<p>--</p>{/if}
							</div>
						</div>
					</section>
				{/if}

				<section class="qa-card">
					<header class="qa-section-head">
						<div>
							<p class="qa-kicker">03 / {$t('admin.contentOperations.qa.sectionLabels.reports')}</p>
							<h2>{$t('admin.contentOperations.qa.reports')}</h2>
						</div>
						<span class="qa-count">{combinedReports.length}</span>
					</header>
					{#if combinedReports.length}
						<div class="qa-report-list">
							{#each combinedReports as report, index (report.id || index)}<article>
									<div>
										<StatusBadge
											status={report.status || qaAcceptanceStatus(report.draftAcceptance)}
										/><strong>{persistedQaScore(report.seniorScore)} / 100</strong>
									</div>
									<code>{report.id || '--'}</code><small
										>{formatDateTime(
											report.evaluatedAt || report.createdAt || report.checkedAt
										)}</small
									>
								</article>{/each}
						</div>
					{:else}<div class="qa-empty">{$t('admin.contentOperations.qa.noReports')}</div>{/if}
					{#if selectedReport}
						<div class="qa-scorecard">
							<header>
								<div>
									<span>{$t('admin.contentOperations.qa.finalVerdict')}</span><StatusBadge
										status={selectedReport.verdict}
									/>
								</div>
								<strong>{persistedQaScore(selectedReport.seniorScore)} / 100</strong>
							</header>
							<div class="qa-scorecard__head">
								<span>{$t('admin.contentOperations.qa.fields.category')}</span><span
									>{$t('admin.contentOperations.qa.fields.seniorScore')} / {$t(
										'admin.contentOperations.qa.fields.maximum'
									)}</span
								><span
									>{$t('admin.contentOperations.qa.issues')} / {$t(
										'admin.contentOperations.qa.requiredFixes'
									)}</span
								>
							</div>
							{#each selectedReport.categories as category, index (category.key || index)}
								<div class="qa-scorecard__row">
									<strong>{rubricLabel(category)}</strong>
									<code
										>{persistedQaScore(category.score)} / {persistedQaScore(category.maximum)}</code
									>
									<div>
										{#each (Array.isArray(category.issues) ? category.issues : []).slice(0, 2) as issue, issueIndex (`category-issue-${category.key || index}-${issueIndex}`)}<span
												>{displayIssue(issue)}</span
											>{/each}
										{#each (Array.isArray(category.requiredFixes) ? category.requiredFixes : []).slice(0, 2) as fix, fixIndex (`category-fix-${category.key || index}-${fixIndex}`)}<em
												>{displayIssue(fix)}</em
											>{/each}
										{#if !(category.issues?.length || category.requiredFixes?.length)}<span>--</span
											>{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<section class="qa-card">
					<header class="qa-section-head">
						<div>
							<p class="qa-kicker">
								04 / {$t('admin.contentOperations.qa.sectionLabels.remediation')}
							</p>
							<h2>{$t('admin.contentOperations.qa.remediation')}</h2>
						</div>
						<span class="qa-count">{selectedBatch.remediationAttempts.length}</span>
					</header>
					{#if selectedBatch.remediationAttempts.length}
						<ol class="qa-remediation">
							{#each selectedBatch.remediationAttempts as attempt, index (attempt.id || index)}<li>
									<span>{attempt.iteration || index + 1}</span>
									<div>
										<strong>{remediationLabel(attempt)}</strong>
										<p>
											{displayIssue(
												attempt.summary ||
													attempt.reason ||
													attempt.failedLayer ||
													attempt.issueCodes?.join(', ') ||
													attempt.plan?.[0] ||
													attempt
											)}
										</p>
									</div>
									<div class="qa-remediation__actions">
										<small>{formatDateTime(attempt.createdAt)}</small>
										{#if selectedBatch.status === 'awaiting_remediation_action' && canAction('remediate') && canResumeArticleQaRemediation(attempt)}
											<button
												type="button"
												onclick={() => resumeArticleRemediation(attempt)}
												disabled={Boolean(busyAction)}
											>
												{busyAction === `resume:${attempt.id}`
													? $t('admin.contentOperations.qa.resumingArticle')
													: $t('admin.contentOperations.qa.resumeArticle')}
											</button>
										{:else if remediationNeedsVerifiedCodeEvidence(attempt)}
											<em>{$t('admin.contentOperations.qa.verifiedEvidenceRequired')}</em>
										{/if}
									</div>
								</li>{/each}
						</ol>
					{:else}<div class="qa-empty">{$t('admin.contentOperations.qa.noRemediation')}</div>{/if}
				</section>
			{:else}
				<div class="qa-empty qa-empty--large">{$t('admin.contentOperations.qa.selectBatch')}</div>
			{/if}
		</main>
	</div>
</div>

<style>
	.qa-page {
		display: grid;
		gap: 1rem;
		min-width: 0;
		color: var(--admin-ink);
	}
	.qa-hero {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 1.25rem;
		padding: 1.35rem 1.45rem;
		border: 1px solid var(--admin-border);
		border-radius: 14px;
		background: linear-gradient(120deg, #f8fbfa 0%, #eef7f3 100%);
	}
	.qa-hero nav {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		margin-bottom: 0.9rem;
		color: var(--admin-muted);
		font-size: 0.68rem;
	}
	.qa-hero nav a {
		color: var(--admin-accent);
		font-weight: 800;
		text-decoration: none;
	}
	.qa-kicker {
		margin: 0 0 0.35rem;
		color: var(--admin-accent);
		font:
			800 0.62rem/1.2 ui-monospace,
			'Cascadia Mono',
			monospace;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.qa-hero h1 {
		margin: 0;
		font-size: clamp(1.65rem, 3vw, 2.55rem);
		line-height: 1.05;
		letter-spacing: -0.035em;
	}
	.qa-hero > div > p:last-child {
		max-width: 760px;
		margin: 0.7rem 0 0;
		color: var(--admin-muted);
		font-size: 0.82rem;
		line-height: 1.55;
	}
	.qa-hero__aside {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.65rem;
		flex-direction: column;
	}
	.qa-hero__aside > span {
		padding: 0.42rem 0.6rem;
		border: 1px solid #acd5c7;
		border-radius: 999px;
		background: #ecf8f4;
		color: var(--admin-accent);
		font:
			900 0.65rem/1 ui-monospace,
			monospace;
	}
	.qa-page button {
		min-height: 36px;
		padding: 0.48rem 0.7rem;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		background: #fff;
		color: var(--admin-ink);
		font: 800 0.7rem/1.2 inherit;
		cursor: pointer;
	}
	.qa-page button:hover:not(:disabled) {
		border-color: var(--admin-accent);
	}
	.qa-page button:focus-visible,
	.qa-page a:focus-visible {
		outline: 3px solid color-mix(in srgb, var(--admin-accent) 25%, transparent);
		outline-offset: 2px;
	}
	.qa-page button:disabled {
		opacity: 0.5;
		cursor: wait;
	}
	.qa-safety {
		display: grid;
		grid-template-columns: 3rem minmax(0, 1fr);
		gap: 0.75rem;
		align-items: center;
		padding: 0.8rem 0.9rem;
		border: 1px solid #e5d39f;
		border-left: 3px solid #b37a14;
		border-radius: 10px;
		background: #fffaf0;
	}
	.qa-safety > div {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 1px solid #dcbf75;
		border-radius: 50%;
		color: #8c5b0b;
		font:
			900 0.72rem/1 ui-monospace,
			monospace;
	}
	.qa-safety p {
		display: grid;
		gap: 0.18rem;
		margin: 0;
		font-size: 0.73rem;
		line-height: 1.45;
	}
	.qa-safety span,
	.qa-safety small {
		color: var(--admin-muted);
	}
	.qa-alert {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.7rem;
		padding: 0.65rem 0.8rem;
		border: 1px solid #b7dccf;
		border-radius: 9px;
		background: #effaf6;
		color: #1b664f;
		font-size: 0.74rem;
	}
	.qa-alert p {
		margin: 0;
	}
	.qa-alert--danger {
		border-color: #efc4c4;
		background: #fff3f3;
		color: #9c2929;
	}
	.qa-alert button {
		min-height: auto;
		padding: 0.1rem 0.35rem;
		border: 0;
		background: transparent;
		color: inherit;
	}
	.qa-disabled,
	.qa-create {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.85rem;
		border: 1px solid var(--admin-border);
		border-radius: 10px;
		background: #fff;
	}
	.qa-disabled div {
		min-width: 0;
	}
	.qa-disabled p {
		margin: 0.2rem 0 0;
		color: var(--admin-muted);
		font-size: 0.73rem;
	}
	.qa-create > div {
		display: grid;
		gap: 0.25rem;
		color: var(--admin-muted);
		font-size: 0.65rem;
		font-weight: 800;
	}
	.qa-create > div strong {
		color: var(--admin-ink);
		font:
			900 0.72rem/1 ui-monospace,
			monospace;
	}
	.qa-create button,
	.qa-summary__actions button {
		border-color: var(--admin-accent);
		background: var(--admin-accent);
		color: #fff;
	}
	.qa-summary__actions button.warn {
		border-color: #a66a0b;
		background: #fff7e9;
		color: #8a5608;
	}
	.qa-layout {
		display: grid;
		grid-template-columns: minmax(220px, 0.28fr) minmax(0, 1fr);
		gap: 1rem;
		align-items: start;
	}
	.qa-batches {
		position: sticky;
		top: 1rem;
		display: grid;
		gap: 0.7rem;
		min-width: 0;
		padding: 0.85rem;
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		background: #fff;
	}
	.qa-batches > header,
	.qa-section-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.7rem;
	}
	.qa-batches h2,
	.qa-section-head h2 {
		margin: 0;
		font-size: 0.95rem;
		overflow-wrap: anywhere;
	}
	.qa-batches > header span,
	.qa-count {
		display: grid;
		place-items: center;
		min-width: 1.6rem;
		height: 1.6rem;
		border-radius: 999px;
		background: #edf5f2;
		color: var(--admin-accent);
		font:
			900 0.62rem/1 ui-monospace,
			monospace;
	}
	.qa-batches__list {
		display: grid;
		gap: 0.4rem;
		max-height: 68vh;
		overflow: auto;
	}
	.qa-batches__list button {
		display: grid;
		gap: 0.22rem;
		min-width: 0;
		height: auto;
		padding: 0.65rem;
		text-align: left;
	}
	.qa-batches__list button.active {
		border-color: var(--admin-accent);
		background: #edf7f3;
	}
	.qa-batches__list button span {
		color: var(--admin-accent);
		font:
			800 0.58rem/1 ui-monospace,
			monospace;
		text-transform: uppercase;
	}
	.qa-batches__list button strong,
	.qa-batches__list button small {
		overflow-wrap: anywhere;
	}
	.qa-batches__list button small {
		color: var(--admin-muted);
	}
	.qa-detail {
		display: grid;
		gap: 1rem;
		min-width: 0;
	}
	.qa-card {
		display: grid;
		gap: 1rem;
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		background: #fff;
	}
	.qa-summary dl,
	.qa-case-facts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0;
	}
	.qa-summary dl div,
	.qa-case-facts div {
		display: grid;
		gap: 0.18rem;
		padding: 0.65rem;
		border: 1px solid #edf0ef;
		border-radius: 8px;
		background: #fafbfb;
		min-width: 0;
	}
	.qa-summary dt,
	.qa-case-facts dt {
		color: var(--admin-muted);
		font-size: 0.62rem;
	}
	.qa-summary dd,
	.qa-case-facts dd {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 800;
		overflow-wrap: anywhere;
	}
	.qa-summary__actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.qa-case-list {
		display: grid;
		gap: 0.45rem;
	}
	.qa-case-list article {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 0.65rem;
		align-items: center;
		padding: 0.55rem;
		border: 1px solid var(--admin-border);
		border-radius: 9px;
	}
	.qa-case-list article.active {
		border-color: #91c5b4;
		background: #f4faf7;
	}
	.qa-case-list__select {
		display: grid !important;
		gap: 0.15rem !important;
		min-width: 0;
		height: auto !important;
		border: 0 !important;
		padding: 0.15rem !important;
		background: transparent !important;
		text-align: left;
	}
	.qa-case-list__select span,
	.qa-case-list__select small {
		color: var(--admin-muted);
		font-size: 0.61rem;
	}
	.qa-case-list__select strong {
		overflow-wrap: anywhere;
	}
	.qa-case-list article > div {
		display: grid;
		justify-items: end;
		gap: 0.25rem;
	}
	.qa-case-list article > div b {
		font-size: 0.72rem;
	}
	.qa-case-list article > a {
		color: var(--admin-accent);
		font-size: 0.67rem;
		font-weight: 850;
		text-decoration: none;
	}
	.qa-no-draft {
		color: var(--admin-muted);
		font-size: 0.64rem;
	}
	.qa-metrics {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.qa-metrics > div {
		display: grid;
		align-content: space-between;
		gap: 0.5rem;
		min-height: 74px;
		padding: 0.65rem;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
	}
	.qa-metrics span {
		color: var(--admin-muted);
		font-size: 0.62rem;
	}
	.qa-metrics strong {
		font-size: 1.1rem;
	}
	.qa-issue-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.65rem;
	}
	.qa-issue-grid > div {
		padding: 0.75rem;
		border: 1px solid var(--admin-border);
		border-radius: 9px;
		background: #fafbfb;
	}
	.qa-issue-grid h3 {
		margin: 0 0 0.5rem;
		font-size: 0.76rem;
	}
	.qa-issue-grid ul {
		display: grid;
		gap: 0.28rem;
		margin: 0;
		padding-left: 1rem;
		color: var(--admin-muted);
		font-size: 0.69rem;
		line-height: 1.45;
	}
	.qa-issue-grid p {
		margin: 0;
		color: var(--admin-muted);
	}
	.qa-report-list {
		display: grid;
		gap: 0.4rem;
	}
	.qa-report-list article {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(120px, 0.5fr) auto;
		gap: 0.7rem;
		align-items: center;
		padding: 0.6rem;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
	}
	.qa-report-list article > div {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.qa-report-list code,
	.qa-report-list small {
		color: var(--admin-muted);
		font-size: 0.62rem;
		overflow-wrap: anywhere;
	}
	.qa-scorecard {
		display: grid;
		gap: 0;
		overflow: hidden;
		border: 1px solid var(--admin-border);
		border-radius: 9px;
	}
	.qa-scorecard > header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
		padding: 0.7rem;
		background: #eef7f3;
	}
	.qa-scorecard > header > div {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--admin-muted);
		font-size: 0.65rem;
		font-weight: 800;
	}
	.qa-scorecard > header > strong {
		color: var(--admin-accent);
		font-size: 1rem;
	}
	.qa-scorecard__head,
	.qa-scorecard__row {
		display: grid;
		grid-template-columns: minmax(150px, 0.8fr) minmax(100px, 0.35fr) minmax(0, 1.4fr);
		gap: 0.7rem;
		align-items: start;
		padding: 0.6rem 0.7rem;
	}
	.qa-scorecard__head {
		background: #f7f9f8;
		color: var(--admin-muted);
		font-size: 0.58rem;
		font-weight: 850;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.qa-scorecard__row {
		border-top: 1px solid var(--admin-border);
		font-size: 0.67rem;
	}
	.qa-scorecard__row > strong {
		font-size: 0.68rem;
		line-height: 1.4;
	}
	.qa-scorecard__row code {
		color: var(--admin-ink);
		font-weight: 800;
	}
	.qa-scorecard__row > div {
		display: grid;
		gap: 0.2rem;
		color: var(--admin-muted);
	}
	.qa-scorecard__row span,
	.qa-scorecard__row em {
		overflow-wrap: anywhere;
	}
	.qa-scorecard__row em {
		color: #945b0a;
		font-style: normal;
	}
	.qa-remediation {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.qa-remediation li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.7rem;
		align-items: start;
		padding: 0.65rem;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
	}
	.qa-remediation li > span {
		display: grid;
		place-items: center;
		width: 1.7rem;
		height: 1.7rem;
		border-radius: 50%;
		background: #edf5f2;
		color: var(--admin-accent);
		font-weight: 900;
	}
	.qa-remediation p {
		margin: 0.2rem 0 0;
		color: var(--admin-muted);
		font-size: 0.69rem;
	}
	.qa-remediation small {
		color: var(--admin-muted);
		font-size: 0.62rem;
	}
	.qa-remediation__actions {
		display: grid;
		gap: 0.4rem;
		justify-items: end;
		max-width: 220px;
		text-align: right;
	}
	.qa-remediation__actions button {
		min-height: 30px;
		border-color: var(--admin-accent);
		background: #eff8f5;
		color: var(--admin-accent);
		white-space: nowrap;
	}
	.qa-remediation__actions em {
		max-width: 210px;
		color: #8a5608;
		font-size: 0.62rem;
		font-style: normal;
		line-height: 1.4;
	}
	.qa-empty {
		display: grid;
		gap: 0.25rem;
		place-items: center;
		min-height: 100px;
		padding: 0.8rem;
		border: 1px dashed var(--admin-border);
		border-radius: 9px;
		background: #fafbfb;
		color: var(--admin-muted);
		font-size: 0.7rem;
		text-align: center;
	}
	.qa-empty--large {
		min-height: 260px;
	}
	@media (max-width: 1050px) {
		.qa-layout {
			grid-template-columns: 1fr;
		}
		.qa-batches {
			position: static;
		}
		.qa-batches__list {
			grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
			max-height: none;
		}
		.qa-metrics {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 720px) {
		.qa-hero {
			grid-template-columns: 1fr;
		}
		.qa-hero__aside {
			align-items: flex-start;
			flex-direction: row;
		}
		.qa-summary dl,
		.qa-case-facts,
		.qa-metrics {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.qa-case-list article {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.qa-case-list article > a,
		.qa-no-draft {
			grid-column: 1 / -1;
		}
		.qa-issue-grid {
			grid-template-columns: 1fr;
		}
		.qa-report-list article,
		.qa-scorecard__head,
		.qa-scorecard__row {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 460px) {
		.qa-hero {
			padding: 1rem;
		}
		.qa-hero__aside,
		.qa-create,
		.qa-disabled {
			align-items: stretch;
			flex-direction: column;
		}
		.qa-summary dl,
		.qa-case-facts,
		.qa-metrics {
			grid-template-columns: 1fr;
		}
		.qa-case-list article {
			grid-template-columns: 1fr;
		}
		.qa-case-list article > div {
			justify-items: start;
		}
		.qa-summary__actions {
			display: grid;
		}
		.qa-summary__actions button {
			width: 100%;
		}
		.qa-remediation li {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.qa-remediation__actions {
			grid-column: 2;
			justify-items: start;
			max-width: none;
			text-align: left;
		}
	}
</style>
