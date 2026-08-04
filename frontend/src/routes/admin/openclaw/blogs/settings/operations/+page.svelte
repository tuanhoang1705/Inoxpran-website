<script>
	import { resolve } from '$app/paths';
	import { locale, t } from '$lib/i18n/admin/index.js';
	import { onMount, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { hasQaActionPermission, qaFeatureAccess } from '$lib/openclaw/blogQa.js';
	import { openClawActivityStatus, openClawActivityStore } from '$lib/openclaw/activityCenter.js';
	import { createSmartPoller } from '$lib/openclaw/smartPolling.js';
	import { normalizeOpenClawUiError, openClawUiErrorText } from '$lib/openclaw/uiError.js';
	import {
		CONTENT_OPERATION_VIEWS,
		entityId,
		firstList,
		isSafeEntityId,
		normalizePreview,
		viewTranslationKey
	} from '$lib/contentOperations/contracts.js';
	import InventoryPanel from '$lib/components/admin/openclaw/content-operations/InventoryPanel.svelte';
	import CapabilityHealthPanel from '$lib/components/admin/openclaw/CapabilityHealthPanel.svelte';
	import MonitoringPanel from '$lib/components/admin/openclaw/content-operations/MonitoringPanel.svelte';
	import OpportunityCandidatesPanel from '$lib/components/admin/openclaw/content-operations/OpportunityCandidatesPanel.svelte';
	import OperationsSchedulePanel from '$lib/components/admin/openclaw/content-operations/OperationsSchedulePanel.svelte';
	import SignalInboxPanel from '$lib/components/admin/openclaw/content-operations/SignalInboxPanel.svelte';
	import TodayPanel from '$lib/components/admin/openclaw/content-operations/TodayPanel.svelte';
	import WorkOrdersPanel from '$lib/components/admin/openclaw/content-operations/WorkOrdersPanel.svelte';

	let { data } = $props();
	const initialData = untrack(() => data);
	let activeView = $state('today');
	let status = $state(initialData?.status || {});
	let capabilityHealth = $state(initialData?.capabilityHealth || { capabilities: {} });
	let snapshots = $state(initialData?.snapshots || {});
	let opportunities = $state(initialData?.opportunities || {});
	let workOrders = $state(initialData?.workOrders || {});
	let signals = $state(initialData?.signals || {});
	let inventory = $state(initialData?.inventory || {});
	let schedule = $state(initialData?.schedule || {});
	let preview = $state(null);
	let performance = $state(null);
	let learning = $state(null);
	let selectedBlogId = $state('');
	let busyId = $state('');
	let notice = $state(null);
	let liveSyncMessage = $state('');
	const workOrderActivityKeys = new SvelteMap();
	let operationsPoller = null;
	const isEn = $derived($locale === 'en');

	const opportunityItems = $derived(
		firstList(opportunities, ['opportunities', 'candidates', 'items'])
	);
	const workOrderItems = $derived(firstList(workOrders, ['workOrders', 'orders', 'items']));
	const signalItems = $derived(firstList(signals, ['signals', 'items']));
	const inventoryItems = $derived(firstList(inventory, ['items', 'inventory', 'articles']));
	const failedLoads = $derived(Object.keys(data?.loadErrors || {}));
	const loadErrorText = $derived(
		failedLoads.length
			? openClawUiErrorText(Object.values(data?.loadErrors || {})[0], {
					isEn,
					fallbackCode: 'OPENCLAW_OPERATIONS_LOAD_FAILED'
				})
			: ''
	);
	const qaAccess = $derived(qaFeatureAccess(data?.qaAccess));
	const canViewQa = $derived(
		hasQaActionPermission(qaAccess, 'view') ||
			hasQaActionPermission(qaAccess, 'agentic_blog_qa.view')
	);
	const counts = $derived({
		today: preview ? 1 : firstList(snapshots, ['snapshots', 'items']).length,
		opportunities: opportunityItems.length,
		workOrders: workOrderItems.length,
		signals: signalItems.length,
		inventory: inventoryItems.length,
		monitoring: performance || learning ? 1 : 0,
		schedule: schedule?.enabled || schedule?.schedule?.enabled ? 1 : 0
	});

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com')
			return path;
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
	};

	const api = async (path, options = {}) => {
		const response = await fetch(
			resolveAdminPath(`/admin/api/openclaw/content-operations/${path}`),
			{
				...options,
				headers: options.body
					? { 'content-type': 'application/json', ...(options.headers || {}) }
					: options.headers,
				body:
					options.body && typeof options.body !== 'string'
						? JSON.stringify(options.body)
						: options.body
			}
		);
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw normalizeOpenClawUiError(payload, 'OPENCLAW_REQUEST_FAILED', response.headers);
		}
		return payload || {};
	};

	const requestErrorText = (error) =>
		openClawUiErrorText(error, { isEn, fallbackCode: 'OPENCLAW_REQUEST_FAILED' });
	const showError = (error) => {
		notice = {
			tone: 'danger',
			text: requestErrorText(error)
		};
	};
	const showInvalidId = () => {
		notice = { tone: 'danger', text: $t('admin.contentOperations.feedback.invalidId') };
	};
	const showSuccess = (key = 'updated') => {
		notice = { tone: 'success', text: $t(`admin.contentOperations.feedback.${key}`) };
	};

	const beginMutationActivity = (action, entityId = '') => {
		const key = `content-operations:${entityId || 'system'}:${action}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
		openClawActivityStore.upsert({
			key,
			domain: 'content-operations-action',
			entityId,
			action,
			title: `Content Operations · ${action.replaceAll('-', ' ')}`,
			status: 'running',
			message: 'Đang xử lý yêu cầu…'
		});
		return key;
	};

	const finishMutationActivity = (key, status, message) => {
		const current = openClawActivityStore.find((item) => item.key === key);
		if (!current || current.status !== 'running') return;
		openClawActivityStore.upsert({ key, status, rawStatus: status, message });
	};

	const ACTIVE_WORK_ORDER_STATUSES = new Set(['researching', 'drafting', 'reviewing']);
	const isActiveWorkOrder = (value) => ACTIVE_WORK_ORDER_STATUSES.has(String(value || ''));

	const syncOperationsRunActivity = (run, wasActive = false) => {
		if (!run?.id) return false;
		const rawStatus = String(run.status || '');
		const active = rawStatus === 'running';
		const existing = openClawActivityStore.find(
			(item) => item.domain === 'content-operations-run' && item.runId === String(run.id)
		);
		if (!active && !wasActive && existing?.status !== 'running') return false;
		openClawActivityStore.upsert({
			key: existing?.key || `content-operations-run:${run.id}`,
			domain: 'content-operations-run',
			entityId: run.contentWorkOrderId || run.id,
			runId: run.id,
			action: 'planning-run',
			title: 'Content Operations · planning run',
			status: openClawActivityStatus(rawStatus),
			rawStatus,
			message: rawStatus.replaceAll('_', ' ') || 'Đã cập nhật trạng thái'
		});
		return wasActive && !active;
	};

	const syncWorkOrderActivity = (item, previousStatus = '') => {
		const id = entityId(item);
		if (!id) return false;
		const rawStatus = String(item.status || '');
		const active = isActiveWorkOrder(rawStatus);
		const wasActive = isActiveWorkOrder(previousStatus);
		const existing = openClawActivityStore.find(
			(activity) => activity.domain === 'content-work-order' && activity.entityId === id
		);
		if (!active && !wasActive && existing?.status !== 'running') return false;
		const key = workOrderActivityKeys.get(id) || existing?.key || `content-work-order:${id}`;
		workOrderActivityKeys.set(id, key);
		openClawActivityStore.upsert({
			key,
			domain: 'content-work-order',
			entityId: id,
			action: 'run',
			title: item.topic || `Work order ${id}`,
			status: openClawActivityStatus(rawStatus),
			rawStatus,
			message: rawStatus.replaceAll('_', ' ') || 'Đã cập nhật trạng thái'
		});
		return wasActive && !active;
	};

	const handleCapabilityUpdate = (nextHealth) => {
		capabilityHealth = nextHealth;
	};

	const replaceById = (items, id, patch) =>
		items.map((item) => (entityId(item) === id ? { ...item, ...patch } : item));

	const handlePreview = async () => {
		busyId = 'preview';
		notice = null;
		const activityKey = beginMutationActivity('preview');
		try {
			const result = await api('preview', {
				method: 'POST',
				body: { dryRun: true, draftOnly: true, includeCandidates: true }
			});
			preview = normalizePreview(result);
			showSuccess(preview.action === 'skip' ? 'skipSelected' : 'previewReady');
			finishMutationActivity(activityKey, 'succeeded', notice?.text || 'Preview completed');
		} catch (error) {
			showError(error);
			finishMutationActivity(activityKey, 'failed', notice?.text || requestErrorText(error));
		} finally {
			busyId = '';
		}
	};

	const handleOpportunity = async (item, operation, details = {}) => {
		const id = entityId(item);
		if (!isSafeEntityId(id)) return showInvalidId();
		busyId = id;
		const activityKey = beginMutationActivity(`opportunity-${operation}`, id);
		try {
			const result = await api(`opportunities/${encodeURIComponent(id)}/${operation}`, {
				method: 'POST',
				body: details
			});
			const nextStatus =
				operation === 'dismiss' ? 'dismissed' : operation === 'accept' ? 'accepted' : 'converted';
			const updated = result?.opportunity ||
				result?.candidate || { status: nextStatus, ...details };
			opportunities = {
				...opportunities,
				opportunities: replaceById(opportunityItems, id, updated)
			};
			const createdOrder = result?.workOrder || result?.order;
			if (createdOrder)
				workOrders = { ...workOrders, workOrders: [createdOrder, ...workOrderItems] };
			showSuccess(operation === 'convert' ? 'converted' : 'updated');
			finishMutationActivity(activityKey, 'succeeded', notice?.text || 'Opportunity updated');
		} catch (error) {
			showError(error);
			finishMutationActivity(activityKey, 'failed', notice?.text || requestErrorText(error));
		} finally {
			busyId = '';
		}
	};

	const handleWorkOrderUpdate = async (item, patch) => {
		const id = entityId(item);
		if (!isSafeEntityId(id)) return showInvalidId();
		busyId = id;
		const activityKey = beginMutationActivity('work-order-update', id);
		try {
			const approving = patch?.status === 'approved';
			const result = await api(
				`work-orders/${encodeURIComponent(id)}${approving ? '/approve' : ''}`,
				{
					method: approving ? 'POST' : 'PATCH',
					body: approving ? { overrideReason: patch.overrideReason || undefined } : patch
				}
			);
			workOrders = {
				...workOrders,
				workOrders: replaceById(workOrderItems, id, result?.workOrder || result?.order || patch)
			};
			showSuccess();
			finishMutationActivity(activityKey, 'succeeded', notice?.text || 'Work order updated');
		} catch (error) {
			showError(error);
			finishMutationActivity(activityKey, 'failed', notice?.text || requestErrorText(error));
		} finally {
			busyId = '';
		}
	};

	const handleWorkOrderRun = async (item) => {
		const id = entityId(item);
		if (!isSafeEntityId(id)) return showInvalidId();
		busyId = id;
		const activityKey = beginMutationActivity('work-order-run', id);
		workOrderActivityKeys.set(id, activityKey);
		openClawActivityStore.upsert({
			key: activityKey,
			domain: 'content-work-order',
			entityId: id,
			title: item.topic || `Work order ${id}`
		});
		try {
			const result = await api(`work-orders/${encodeURIComponent(id)}/run`, {
				method: 'POST',
				body: { draftOnly: true, workOrderId: id }
			});
			const nextWorkOrder = result?.workOrder || { status: 'researching' };
			workOrders = {
				...workOrders,
				workOrders: replaceById(workOrderItems, id, nextWorkOrder)
			};
			showSuccess('runStarted');
			if (isActiveWorkOrder(nextWorkOrder.status)) {
				openClawActivityStore.upsert({
					key: activityKey,
					status: 'running',
					rawStatus: nextWorkOrder.status,
					message: notice?.text || 'Work order is running'
				});
				operationsPoller?.poke('work-order-run');
			} else {
				finishMutationActivity(
					activityKey,
					openClawActivityStatus(nextWorkOrder.status),
					notice?.text || String(nextWorkOrder.status || 'completed')
				);
			}
		} catch (error) {
			showError(error);
			finishMutationActivity(activityKey, 'failed', notice?.text || requestErrorText(error));
		} finally {
			busyId = '';
		}
	};

	const handleSignalCreate = async (payload) => {
		busyId = 'create-signal';
		const activityKey = beginMutationActivity('signal-create');
		try {
			const result = await api('signals', { method: 'POST', body: payload });
			const created = result?.signal || result;
			if (entityId(created)) signals = { ...signals, signals: [created, ...signalItems] };
			showSuccess('signalAdded');
			finishMutationActivity(activityKey, 'succeeded', notice?.text || 'Signal added');
			return true;
		} catch (error) {
			showError(error);
			finishMutationActivity(activityKey, 'failed', notice?.text || requestErrorText(error));
			return false;
		} finally {
			busyId = '';
		}
	};

	const handleSignalUpdate = async (item, patch) => {
		const id = entityId(item);
		if (!isSafeEntityId(id)) return showInvalidId();
		busyId = id;
		const activityKey = beginMutationActivity('signal-update', id);
		try {
			const result = await api(`signals/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				body: patch
			});
			signals = { ...signals, signals: replaceById(signalItems, id, result?.signal || patch) };
			showSuccess();
			finishMutationActivity(activityKey, 'succeeded', notice?.text || 'Signal updated');
		} catch (error) {
			showError(error);
			finishMutationActivity(activityKey, 'failed', notice?.text || requestErrorText(error));
		} finally {
			busyId = '';
		}
	};

	const handleInventoryRebuild = async () => {
		busyId = 'inventory-rebuild';
		const activityKey = beginMutationActivity('inventory-rebuild');
		try {
			const result = await api('inventory/rebuild', { method: 'POST', body: { full: false } });
			inventory = result?.inventory || result || inventory;
			showSuccess('inventoryQueued');
			finishMutationActivity(activityKey, 'succeeded', notice?.text || 'Inventory rebuild queued');
		} catch (error) {
			showError(error);
			finishMutationActivity(activityKey, 'failed', notice?.text || requestErrorText(error));
		} finally {
			busyId = '';
		}
	};

	const handleInventoryMonitor = (item) => {
		const blogId = entityId(item?.blogId || item);
		activeView = 'monitoring';
		if (blogId) handleMonitoringLoad(blogId);
	};

	const handleMonitoringLoad = async (blogId) => {
		if (!isSafeEntityId(blogId)) return showInvalidId();
		busyId = 'monitoring';
		selectedBlogId = blogId;
		try {
			[performance, learning] = await Promise.all([
				api(`performance/${encodeURIComponent(blogId)}`),
				api(`learning/${encodeURIComponent(blogId)}`)
			]);
			showSuccess('monitoringLoaded');
		} catch (error) {
			showError(error);
		} finally {
			busyId = '';
		}
	};

	const handleScheduleSave = async (payload) => {
		busyId = 'schedule';
		const activityKey = beginMutationActivity('schedule-save');
		try {
			const result = await api('schedule', { method: 'PATCH', body: payload });
			schedule = result?.schedule || result || payload;
			showSuccess('scheduleSaved');
			finishMutationActivity(activityKey, 'succeeded', notice?.text || 'Schedule saved');
		} catch (error) {
			showError(error);
			finishMutationActivity(activityKey, 'failed', notice?.text || requestErrorText(error));
		} finally {
			busyId = '';
		}
	};

	const handleScheduleToggle = async (enabled) => {
		busyId = 'schedule';
		const activityKey = beginMutationActivity(enabled ? 'schedule-enable' : 'schedule-disable');
		try {
			const result = await api(`schedule/${enabled ? 'enable' : 'disable'}`, {
				method: 'POST',
				body: { enabled }
			});
			schedule = { ...(result?.schedule || schedule), enabled };
			showSuccess(enabled ? 'scheduleEnabled' : 'scheduleDisabled');
			finishMutationActivity(activityKey, 'succeeded', notice?.text || 'Schedule updated');
			return true;
		} catch (error) {
			showError(error);
			finishMutationActivity(activityKey, 'failed', notice?.text || requestErrorText(error));
			return false;
		} finally {
			busyId = '';
		}
	};

	const refreshOperationsSupportingData = async () => {
		const [nextSnapshots, nextOpportunities, nextSignals, nextInventory, nextSchedule] =
			await Promise.all([
				api('snapshots?limit=14&page=1'),
				api('opportunities?limit=20&page=1'),
				api('signals?limit=20&page=1&status=active'),
				api('inventory?limit=24&page=1'),
				api('schedule')
			]);
		snapshots = nextSnapshots;
		opportunities = nextOpportunities;
		signals = nextSignals;
		inventory = nextInventory;
		schedule = nextSchedule;
	};

	const pollOperations = async () => {
		const previousRun = status?.latestRun || null;
		const previousOrders = new Map(
			workOrderItems.map((item) => [entityId(item), String(item.status || '')])
		);
		const [nextStatus, nextWorkOrders] = await Promise.all([
			api('status'),
			api('work-orders?limit=20&page=1')
		]);
		const nextItems = firstList(nextWorkOrders, ['workOrders', 'orders', 'items']);
		let settled = syncOperationsRunActivity(
			nextStatus?.latestRun,
			String(previousRun?.status || '') === 'running'
		);
		for (const item of nextItems) {
			settled = syncWorkOrderActivity(item, previousOrders.get(entityId(item)) || '') || settled;
		}
		status = nextStatus;
		workOrders = nextWorkOrders;
		if (settled) await refreshOperationsSupportingData();
		liveSyncMessage = '';
		return {
			active:
				String(nextStatus?.latestRun?.status || '') === 'running' ||
				nextItems.some((item) => isActiveWorkOrder(item.status))
		};
	};

	const refreshOperationsCanonical = async () => {
		const [nextStatus, nextWorkOrders] = await Promise.all([
			api('status'),
			api('work-orders?limit=20&page=1')
		]);
		status = nextStatus;
		workOrders = nextWorkOrders;
		await refreshOperationsSupportingData();
	};

	onMount(() => {
		openClawActivityStore.hydrate();
		operationsPoller = createSmartPoller({
			poll: pollOperations,
			activeIntervalMs: 3000,
			idleIntervalMs: 15000,
			onSettled: refreshOperationsCanonical,
			onSyncError: () => {
				const hasActive =
					String(status?.latestRun?.status || '') === 'running' ||
					workOrderItems.some((item) => isActiveWorkOrder(item.status));
				if (hasActive) {
					liveSyncMessage = 'Cập nhật trạng thái đang tạm chậm. Tác vụ vẫn được theo dõi.';
				}
			}
		});
		operationsPoller.start();
		return () => operationsPoller?.stop();
	});
</script>

<svelte:head>
	<title>{$t('admin.contentOperations.pageTitle')}</title>
	<meta name="description" content={$t('admin.contentOperations.pageDescription')} />
</svelte:head>

<div class="operations-page">
	<header class="operations-hero">
		<div class="hero-copy">
			<div class="breadcrumb">
				<a href={resolve(resolveAdminPath('/admin/openclaw/blogs/settings'))}>BOS</a><span>/</span
				><strong>{$t('admin.contentOperations.shortTitle')}</strong>
			</div>
			<p class="eyebrow">CONTENT OPS / V3</p>
			<h1>{$t('admin.contentOperations.title')}</h1>
			<p>{$t('admin.contentOperations.description')}</p>
		</div>
		<div class="hero-actions">
			{#if canViewQa}
				<a
					class="co-button co-button--quiet"
					href={resolve(resolveAdminPath('/admin/openclaw/blogs/settings/operations/qa'))}
					>{$t('admin.contentOperations.qa.openQa')}</a
				>
			{/if}
			<a
				class="co-button co-button--quiet"
				href={resolve(resolveAdminPath('/admin/openclaw/blogs'))}
				>{$t('admin.contentOperations.dailyDraft')}</a
			>
			<button
				class="co-button co-button--primary"
				type="button"
				onclick={handlePreview}
				disabled={busyId === 'preview'}
			>
				{busyId === 'preview'
					? $t('admin.contentOperations.common.previewing')
					: $t('admin.contentOperations.common.previewBest')}
			</button>
		</div>
		<div class="hero-rule" aria-hidden="true"><span>01</span><i></i><span>07</span></div>
	</header>

	<div class="safety-note">
		<div aria-hidden="true">DRY</div>
		<p>
			<strong>{$t('admin.contentOperations.previewSafety.title')}</strong><span
				>{$t('admin.contentOperations.previewSafety.description')}</span
			>
		</p>
	</div>

	<CapabilityHealthPanel health={capabilityHealth} onUpdated={handleCapabilityUpdate} />

	{#if failedLoads.length}
		<div class="load-warning" role="status">
			<p>{$t('admin.contentOperations.feedback.partialLoad', { count: failedLoads.length })}</p>
			<small>{loadErrorText}</small>
		</div>
	{/if}
	{#if liveSyncMessage}
		<div class="load-warning" role="status">{liveSyncMessage}</div>
	{/if}
	{#if notice}
		<div
			class="page-notice"
			class:page-notice--danger={notice.tone === 'danger'}
			role={notice.tone === 'danger' ? 'alert' : 'status'}
		>
			<span>{notice.tone === 'danger' ? '!' : '✓'}</span>
			<p>{notice.text}</p>
			<button type="button" aria-label={$t('common.close')} onclick={() => (notice = null)}
				>×</button
			>
		</div>
	{/if}
	{#if preview?.action === 'skip'}
		<div class="skip-result" role="status">
			<span>SKIP</span>
			<p>
				<strong>{$t('admin.contentOperations.skip.title')}</strong>{$t(
					'admin.contentOperations.skip.description'
				)}
			</p>
		</div>
	{/if}

	<nav class="view-rail" aria-label={$t('admin.contentOperations.viewNavigation')}>
		{#each CONTENT_OPERATION_VIEWS as view, index (view)}
			<button
				type="button"
				class:active={activeView === view}
				onclick={() => (activeView = view)}
				aria-current={activeView === view ? 'page' : undefined}
			>
				<span>{String(index + 1).padStart(2, '0')}</span>
				<strong>{$t(viewTranslationKey(view))}</strong>
				<em>{counts[view] || 0}</em>
			</button>
		{/each}
	</nav>

	<main class="view-stage">
		{#if activeView === 'today'}
			<TodayPanel
				{status}
				{snapshots}
				{preview}
				onPreview={handlePreview}
				busy={busyId === 'preview'}
			/>
		{:else if activeView === 'opportunities'}
			<OpportunityCandidatesPanel {opportunities} onAction={handleOpportunity} {busyId} />
		{:else if activeView === 'workOrders'}
			<WorkOrdersPanel
				{workOrders}
				onUpdate={handleWorkOrderUpdate}
				onRun={handleWorkOrderRun}
				{busyId}
			/>
		{:else if activeView === 'signals'}
			<SignalInboxPanel
				{signals}
				onCreate={handleSignalCreate}
				onUpdate={handleSignalUpdate}
				{busyId}
			/>
		{:else if activeView === 'inventory'}
			<InventoryPanel
				{inventory}
				onMonitor={handleInventoryMonitor}
				onRebuild={handleInventoryRebuild}
				busy={busyId === 'inventory-rebuild'}
			/>
		{:else if activeView === 'monitoring'}
			<MonitoringPanel
				{performance}
				{learning}
				{selectedBlogId}
				onLoad={handleMonitoringLoad}
				busy={busyId === 'monitoring'}
			/>
		{:else if activeView === 'schedule'}
			<OperationsSchedulePanel
				{schedule}
				onSave={handleScheduleSave}
				onToggle={handleScheduleToggle}
				busy={busyId === 'schedule'}
			/>
		{/if}
	</main>
</div>

<style>
	.operations-page {
		--co-grid: rgba(16, 92, 75, 0.055);
		display: grid;
		gap: 1rem;
		min-width: 0;
		color: var(--admin-ink);
	}
	.operations-hero {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 1.5rem;
		align-items: end;
		overflow: hidden;
		padding: 1.35rem 1.45rem 1.55rem;
		border: 1px solid var(--admin-border);
		border-radius: 14px;
		background-color: #f8fbfa;
		background-image:
			linear-gradient(var(--co-grid) 1px, transparent 1px),
			linear-gradient(90deg, var(--co-grid) 1px, transparent 1px);
		background-size: 22px 22px;
	}
	.hero-copy {
		position: relative;
		z-index: 1;
		max-width: 780px;
	}
	.breadcrumb {
		display: flex;
		gap: 0.45rem;
		align-items: center;
		margin-bottom: 1rem;
		color: var(--admin-muted);
		font-size: 0.7rem;
	}
	.breadcrumb a {
		color: var(--admin-accent);
		font-weight: 800;
		text-decoration: none;
	}
	.eyebrow {
		margin: 0 0 0.45rem;
		color: var(--admin-accent);
		font:
			800 0.68rem/1 ui-monospace,
			'Cascadia Mono',
			monospace;
		letter-spacing: 0.13em;
	}
	.operations-hero h1 {
		margin: 0;
		max-width: 720px;
		font-size: clamp(1.65rem, 3.1vw, 2.75rem);
		line-height: 1.02;
		letter-spacing: -0.04em;
	}
	.operations-hero .hero-copy > p:last-child {
		max-width: 700px;
		margin: 0.8rem 0 0;
		color: var(--admin-muted);
		font-size: 0.86rem;
		line-height: 1.6;
	}
	.hero-actions {
		position: relative;
		z-index: 1;
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.hero-rule {
		position: absolute;
		right: 1.4rem;
		top: 1rem;
		display: flex;
		gap: 0.45rem;
		align-items: center;
		color: color-mix(in srgb, var(--admin-accent) 55%, transparent);
		font:
			700 0.58rem/1 ui-monospace,
			monospace;
	}
	.hero-rule i {
		display: block;
		width: 56px;
		height: 1px;
		background: currentColor;
	}
	.safety-note {
		display: grid;
		grid-template-columns: 3rem minmax(0, 1fr);
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.85rem;
		border: 1px solid #d8e6e0;
		border-left: 3px solid var(--admin-accent);
		border-radius: 10px;
		background: #f4faf7;
	}
	.safety-note > div {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 1px solid #b9d2c8;
		border-radius: 50%;
		color: var(--admin-accent);
		font:
			900 0.65rem/1 ui-monospace,
			monospace;
	}
	.safety-note p {
		display: grid;
		gap: 0.22rem;
		margin: 0;
		font-size: 0.76rem;
	}
	.safety-note span {
		color: var(--admin-muted);
		line-height: 1.5;
	}
	.load-warning,
	.page-notice,
	.skip-result {
		border-radius: 9px;
		font-size: 0.76rem;
	}
	.load-warning {
		padding: 0.65rem 0.8rem;
		border: 1px solid #eed9ad;
		background: #fff8e9;
		color: #805817;
	}
	.page-notice {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.6rem;
		align-items: center;
		padding: 0.65rem 0.8rem;
		border: 1px solid #b7dccf;
		background: #effaf6;
		color: #1b664f;
	}
	.page-notice--danger {
		border-color: #efc4c4;
		background: #fff3f3;
		color: #9c2929;
	}
	.page-notice p {
		margin: 0;
	}
	.page-notice button {
		border: 0;
		background: transparent;
		color: inherit;
		font-size: 1rem;
		cursor: pointer;
	}
	.skip-result {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.75rem;
		align-items: center;
		padding: 0.75rem 0.85rem;
		border: 1px dashed var(--admin-border);
		background: #fafbfb;
	}
	.skip-result > span {
		color: var(--admin-muted);
		font:
			900 0.65rem/1 ui-monospace,
			monospace;
		letter-spacing: 0.08em;
	}
	.skip-result p {
		display: grid;
		gap: 0.2rem;
		margin: 0;
		color: var(--admin-muted);
	}
	.skip-result strong {
		color: var(--admin-ink);
	}
	.view-rail {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		overflow: auto;
		border: 1px solid var(--admin-border);
		border-radius: 11px;
		background: #fff;
	}
	.view-rail button {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.5rem;
		align-items: center;
		min-width: 145px;
		padding: 0.75rem 0.8rem;
		border: 0;
		border-right: 1px solid var(--admin-border);
		background: #fff;
		color: var(--admin-muted);
		text-align: left;
		cursor: pointer;
	}
	.view-rail button:last-child {
		border-right: 0;
	}
	.view-rail button:hover {
		background: #f5f9f7;
	}
	.view-rail button.active {
		background: var(--admin-accent);
		color: #fff;
	}
	.view-rail span {
		font:
			700 0.58rem/1 ui-monospace,
			monospace;
		opacity: 0.66;
	}
	.view-rail strong {
		font-size: 0.72rem;
		white-space: nowrap;
	}
	.view-rail em {
		display: grid;
		place-items: center;
		min-width: 1.35rem;
		height: 1.35rem;
		border-radius: 999px;
		background: #eef4f2;
		color: var(--admin-accent);
		font: normal 800 0.62rem/1 sans-serif;
	}
	.view-rail button.active em {
		background: rgba(255, 255, 255, 0.18);
		color: #fff;
	}
	.view-stage {
		min-width: 0;
	}
	:global(.co-card) {
		display: grid;
		gap: 1rem;
		min-width: 0;
		padding: 1.05rem;
		border: 1px solid var(--admin-border);
		border-radius: 13px;
		background: #fff;
		box-shadow: 0 1px 0 rgba(22, 45, 37, 0.02);
	}
	:global(.co-section-head) {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}
	:global(.co-section-head--compact) {
		align-items: center;
	}
	:global(.co-section-head h2) {
		margin: 0.2rem 0 0;
		font-size: 1.05rem;
		line-height: 1.25;
	}
	:global(.co-section-head p:not(.co-kicker)) {
		max-width: 680px;
		margin: 0.4rem 0 0;
		color: var(--admin-muted);
		font-size: 0.77rem;
		line-height: 1.5;
	}
	:global(.co-kicker) {
		margin: 0;
		color: var(--admin-accent);
		font:
			800 0.64rem/1.2 ui-monospace,
			'Cascadia Mono',
			monospace;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}
	:global(.co-button) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 36px;
		padding: 0.48rem 0.75rem;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		background: #fff;
		color: var(--admin-ink);
		font: 800 0.7rem/1.2 inherit;
		text-decoration: none;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			transform 0.15s ease;
	}
	:global(.co-button:hover:not(:disabled)) {
		transform: translateY(-1px);
		border-color: color-mix(in srgb, var(--admin-accent) 45%, var(--admin-border));
	}
	:global(.co-button:disabled) {
		opacity: 0.52;
		cursor: not-allowed;
	}
	:global(.co-button--primary) {
		border-color: var(--admin-accent);
		background: var(--admin-accent);
		color: #fff;
	}
	:global(.co-button--secondary) {
		border-color: #a9c9bd;
		background: #edf7f3;
		color: var(--admin-accent);
	}
	:global(.co-button--quiet) {
		background: #fff;
	}
	:global(.co-count) {
		display: grid;
		place-items: center;
		min-width: 2rem;
		height: 2rem;
		padding: 0 0.45rem;
		border-radius: 999px;
		background: #edf5f2;
		color: var(--admin-accent);
		font:
			900 0.68rem/1 ui-monospace,
			monospace;
	}
	:global(.co-empty) {
		display: grid;
		place-items: center;
		gap: 0.3rem;
		min-height: 160px;
		padding: 1rem;
		border: 1px dashed var(--admin-border);
		border-radius: 10px;
		background: #fafbfb;
		color: var(--admin-muted);
		text-align: center;
	}
	:global(.co-empty--small) {
		min-height: 72px;
	}
	:global(.co-empty p) {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.45;
	}
	@media (max-width: 800px) {
		.operations-hero {
			grid-template-columns: 1fr;
		}
		.hero-actions {
			justify-content: flex-start;
		}
		.view-rail {
			grid-template-columns: repeat(7, minmax(145px, 1fr));
		}
	}
	@media (max-width: 520px) {
		.operations-hero {
			padding: 1.05rem;
		}
		.hero-actions {
			display: grid;
		}
		.hero-rule {
			display: none;
		}
		:global(.co-section-head) {
			display: grid;
		}
	}
</style>
