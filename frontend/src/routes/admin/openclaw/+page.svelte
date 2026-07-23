<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { locale } from '$lib/i18n/admin/index.js';
	import CapabilityHealthPanel from '$lib/components/admin/openclaw/CapabilityHealthPanel.svelte';
	import {
		createOpenClawActionIdempotencyManager,
		shouldRetainOpenClawActionKey
	} from '$lib/openclaw/actionIdempotency.js';
	import {
		capabilityTone,
		findCapability,
		humanizeCapabilityToken,
		normalizeCapability,
		normalizeCapabilityHealth,
		sanitizeDashboardUrl
	} from '$lib/openclaw/capabilityHealth.js';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let dashboard = $state(data?.dashboard || {});
	// svelte-ignore state_referenced_locally
	let runs = $state(Array.isArray(dashboard?.runs) ? dashboard.runs : []);
	// svelte-ignore state_referenced_locally
	let selectedRunId = $state(runs[0]?.id || '');
	let busyAction = $state('');
	let refreshingDashboard = $state(false);
	let refreshingRuns = $state(false);
	// svelte-ignore state_referenced_locally
	let pageError = $state(data?.loadError || '');
	// svelte-ignore state_referenced_locally
	let capabilityHealth = $state(
		normalizeCapabilityHealth(
			data?.capabilityHealth || { capabilities: dashboard?.capabilities || {} }
		)
	);
	// svelte-ignore state_referenced_locally
	let lastUpdatedAt = $state(
		capabilityHealth.checkedAt || dashboard?.checkedAt || dashboard?.updatedAt || null
	);
	// svelte-ignore state_referenced_locally
	let schedulesData = $state(data?.schedules || {});
	// svelte-ignore state_referenced_locally
	let scheduleRuntime = $state(schedulesData?.runtime || {});
	const actionIdempotency = createOpenClawActionIdempotencyManager();

	const isEn = $derived($locale === 'en');
	const automation = $derived(dashboard?.automation || {});
	const env = $derived(dashboard?.env || {});
	const featureFlags = $derived(dashboard?.featureFlags || {});
	const capabilities = $derived(dashboard?.capabilities || {});
	const actions = $derived(Array.isArray(dashboard?.actions) ? dashboard.actions : []);
	const agents = $derived(Array.isArray(dashboard?.agents) ? dashboard.agents : []);
	const localSkills = $derived(Array.isArray(dashboard?.localSkills) ? dashboard.localSkills : []);
	const skillReport = $derived(dashboard?.skillReport || {});
	const telegramConfigured = $derived(
		Boolean(
			env.TELEGRAM_BOT_TOKEN &&
			env.TELEGRAM_WEBHOOK_SECRET &&
			(env.TELEGRAM_ALLOWED_CHAT_IDS || env.TELEGRAM_ALLOWED_USER_IDS)
		)
	);
	const enabledScheduleCount = $derived(
		(Array.isArray(schedulesData?.schedules) ? schedulesData.schedules : []).filter(
			(schedule) => schedule?.enabled
		).length
	);
	const resolvedCapability = (canonicalKey, legacyKey = canonicalKey) =>
		findCapability(capabilityHealth, canonicalKey, legacyKey) ||
		normalizeCapability(capabilities?.[legacyKey] || {}, canonicalKey);
	const seoCapability = $derived(resolvedCapability('seo_agent', 'seoAgent'));
	const gatewayCapability = $derived(resolvedCapability('openclaw_gateway', 'openclawGateway'));
	const telegramCapability = $derived(resolvedCapability('telegram_bot', 'telegram'));
	const cronCapability = $derived(
		resolvedCapability('content_operations_cron', 'contentOperationsCron')
	);
	const blogCronCapability = $derived(resolvedCapability('blog_cron', 'blogCron'));
	const imagePipelineCapability = $derived(resolvedCapability('image_pipeline', 'imagePipeline'));
	const dataCapabilityRows = $derived([
		[
			isEn ? 'Google Intelligence' : 'Google Intelligence',
			'GOOGLE_INTELLIGENCE_ENABLED',
			resolvedCapability('google_intelligence', 'googleIntelligence')
		],
		[
			isEn ? 'Search Console' : 'Search Console',
			'SEARCH_CONSOLE_ENABLED',
			resolvedCapability('search_console', 'searchConsole')
		],
		[
			isEn ? 'Aggregate analytics' : 'Analytics tổng hợp',
			'CONTENT_ANALYTICS_ENABLED',
			resolvedCapability('content_analytics', 'aggregateAnalytics')
		],
		[
			isEn ? 'Market trends' : 'Xu hướng thị trường',
			'CONTENT_TRENDS_ENABLED',
			resolvedCapability('market_trends', 'trends')
		],
		[
			isEn ? 'Content inventory' : 'Kho nội dung',
			'CONTENT_INVENTORY_ENABLED',
			resolvedCapability('content_inventory', 'inventory')
		],
		[
			isEn ? 'Content signals' : 'Tín hiệu nội dung',
			'CONTENT_SIGNALS_ENABLED',
			resolvedCapability('content_signals', 'contentSignals')
		]
	]);
	const operationsCapabilityRows = $derived([
		[
			isEn ? 'Content operations' : 'Vận hành nội dung',
			'CONTENT_OPERATIONS_ENABLED',
			resolvedCapability('content_operations', 'contentOperations')
		],
		[
			isEn ? 'Operations schedule' : 'Lịch vận hành',
			'CONTENT_OPERATIONS_CRON_ENABLED',
			cronCapability
		],
		[
			isEn ? 'Performance monitoring' : 'Theo dõi hiệu quả',
			'CONTENT_PERFORMANCE_MONITORING_ENABLED',
			resolvedCapability('content_performance_monitoring', 'performanceMonitoring')
		],
		[
			isEn ? 'Content learning' : 'Vòng học nội dung',
			'CONTENT_LEARNING_ENABLED',
			resolvedCapability('content_learning', 'learning')
		]
	]);
	const activeRuns = $derived(
		runs.filter((run) => ['queued', 'running'].includes(String(run.status || '').toLowerCase()))
	);
	const actionIsActive = (action) =>
		action !== 'status' && activeRuns.some((run) => run.action === action);
	const selectedRun = $derived(runs.find((run) => run.id === selectedRunId) || runs[0] || null);
	const dashboardUrl = $derived(
		sanitizeDashboardUrl(
			selectedRun?.dashboardUrl ||
				runs.find((run) => run.dashboardUrl)?.dashboardUrl ||
				dashboard?.openclaw?.dashboardUrl ||
				''
		)
	);

	const copy = $derived({
		title: isEn ? 'OpenClaw AI Console' : 'OpenClaw AI Console',
		contentOperations: isEn ? 'Content operations' : 'Vận hành nội dung',
		subtitle: isEn
			? 'Daily SEO blog agent operations'
			: 'Vận hành hệ thống agent tạo blog SEO hàng ngày',
		automation: isEn ? 'Automation API' : 'Automation API',
		autoPublish: isEn ? 'Auto publish' : 'Tự động publish',
		profile: isEn ? 'Profile' : 'Profile',
		gateway: isEn ? 'Gateway' : 'Gateway',
		commandCenter: isEn ? 'Command center' : 'Bảng điều khiển',
		runMonitor: isEn ? 'Run monitor' : 'Tiến trình',
		agents: isEn ? 'Agents' : 'Agents',
		skills: isEn ? 'Local skills' : 'Local skills',
		coreSkills: isEn ? 'ClawHub core' : 'ClawHub core',
		safety: isEn ? 'Safety gates' : 'Chốt an toàn',
		output: isEn ? 'Output' : 'Output',
		refresh: isEn ? 'Refresh' : 'Làm mới',
		dashboard: isEn ? 'Open dashboard' : 'Mở dashboard',
		noRuns: isEn ? 'No runs yet.' : 'Chưa có run nào.',
		noRunsHint: isEn
			? 'Trigger a command to see activity here.'
			: 'Chạy một lệnh để xem hoạt động tại đây.',
		noOutput: isEn ? 'No output yet.' : 'Chưa có output.',
		noOutputHint: isEn ? 'Select a run to view its log.' : 'Chọn một run để xem nhật ký.',
		loadFailed: isEn ? 'Load failed' : 'Tải dữ liệu lỗi',
		statusAria: isEn ? 'OpenClaw status overview' : 'Tổng quan trạng thái OpenClaw',
		updated: isEn ? 'Updated' : 'Cập nhật',
		running: isEn ? 'running' : 'đang chạy',
		runs: isEn ? 'runs' : 'run',
		groupGateway: isEn ? 'Gateway control' : 'Điều khiển Gateway',
		groupSetup: isEn ? 'Agent setup' : 'Thiết lập agent',
		groupAutomation: isEn ? 'Testing & automation' : 'Kiểm thử & tự động',
		groupOther: isEn ? 'Other actions' : 'Thao tác khác',
		gateAutomation: isEn ? 'Automation' : 'Tự động hoá',
		gateImages: isEn ? 'Images' : 'Hình ảnh',
		gateScheduling: isEn ? 'Scheduling & Telegram' : 'Lịch & Telegram',
		capabilities: isEn ? 'Capabilities' : 'Năng lực hệ thống',
		noReport: isEn ? 'No install report yet.' : 'Chưa có report cài đặt.',
		starting: isEn ? 'Starting' : 'Đang khởi tạo',
		refreshing: isEn ? 'Refreshing' : 'Đang làm mới'
	});

	const actionMeta = $derived({
		'start-openclaw': {
			label: isEn ? 'Start gateway' : 'Bật OpenClaw',
			detail: isEn ? 'Start local Gateway service' : 'Khởi động Gateway local'
		},
		'stop-openclaw': {
			label: isEn ? 'Stop gateway' : 'Tắt OpenClaw',
			detail: isEn ? 'Stop local Gateway service' : 'Dừng Gateway local'
		},
		status: {
			label: isEn ? 'Status' : 'Kiểm tra status',
			detail: isEn ? 'Gateway, model, profile' : 'Gateway, model, profile'
		},
		'update-openclaw': {
			label: isEn ? 'Update OpenClaw' : 'Cập nhật OpenClaw',
			detail: isEn
				? 'Pull stable image, health-check, auto rollback'
				: 'Tải bản stable, kiểm tra health, tự rollback'
		},
		'install-skills': {
			label: isEn ? 'Install skills' : 'Cài skills',
			detail: isEn ? 'Inspect, verify, install' : 'Inspect, verify, install'
		},
		'sync-agents': {
			label: isEn ? 'Sync agents' : 'Đồng bộ agents',
			detail: isEn ? 'Register local agent ids' : 'Đăng ký agent local'
		},
		'smoke-test': {
			label: isEn ? 'Smoke draft' : 'Tạo draft test',
			detail: isEn ? 'Backend API draft test' : 'Test API backend ở chế độ draft'
		},
		'daily-draft': {
			label: isEn ? 'Daily draft' : 'Chạy daily draft',
			detail: isEn ? 'Run now or manage blog schedules' : 'Chạy ngay hoặc quản lý lịch tạo bài'
		}
	});

	const formatDateTime = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		return new Intl.DateTimeFormat(isEn ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium',
			timeStyle: 'medium'
		}).format(date);
	};

	const formatDuration = (value) => {
		if (!value) return '--';
		const seconds = Math.max(1, Math.round(value / 1000));
		if (seconds < 60) return `${seconds}s`;
		return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	};

	const statusLabel = (status) => {
		if (status === 'completed') return isEn ? 'Completed' : 'Hoàn tất';
		if (status === 'failed') return isEn ? 'Failed' : 'Lỗi';
		if (status === 'timed_out') return isEn ? 'Timed out' : 'Quá thời gian';
		return isEn ? 'Running' : 'Đang chạy';
	};

	const capabilityLabel = (capability = {}) => {
		const normalized = normalizeCapability(capability);
		const labels = isEn
			? {
					healthy: 'Ready',
					degraded: 'Degraded',
					unavailable: 'Unavailable',
					failed: 'Failed',
					expected_disabled: 'Expected off',
					missing_config: 'Missing config',
					pending_check: 'Pending check',
					manual_review: 'Manual review',
					not_applicable: 'Not applicable',
					disabled: 'Off',
					unknown: 'Unknown'
				}
			: {
					healthy: 'Sẵn sàng',
					degraded: 'Suy giảm',
					unavailable: 'Không khả dụng',
					failed: 'Thất bại',
					expected_disabled: 'Tắt theo thiết kế',
					missing_config: 'Thiếu cấu hình',
					pending_check: 'Chờ kiểm tra',
					manual_review: 'Kiểm tra thủ công',
					not_applicable: 'Không áp dụng',
					disabled: 'Tắt',
					unknown: 'Chưa rõ'
				};
		return labels[normalized.status] || humanizeCapabilityToken(normalized.status);
	};

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com') {
			return path;
		}
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
	};

	const upsertRun = (run) => {
		if (!run?.id) return;
		const safeDashboardUrl = sanitizeDashboardUrl(run.dashboardUrl);
		const safeRun = { ...run, dashboardUrl: safeDashboardUrl || undefined };
		const index = runs.findIndex((item) => item.id === safeRun.id);
		if (index >= 0) {
			runs = [...runs.slice(0, index), safeRun, ...runs.slice(index + 1)];
		} else {
			runs = [safeRun, ...runs].slice(0, 30);
		}
		if (!selectedRunId) selectedRunId = safeRun.id;
		if (safeDashboardUrl) {
			dashboard = {
				...dashboard,
				openclaw: {
					...(dashboard?.openclaw || {}),
					dashboardUrl: safeDashboardUrl
				}
			};
		}
	};

	const refreshDashboard = async () => {
		if (refreshingDashboard) return;
		refreshingDashboard = true;
		pageError = '';
		try {
			const [response, schedulesResponse] = await Promise.all([
				fetch(resolveAdminPath('/admin/api/openclaw')),
				fetch(resolveAdminPath('/admin/api/openclaw/blog-schedules?limit=50&page=1'))
			]);
			const [payload, schedulesPayload] = await Promise.all([
				response.json().catch(() => null),
				schedulesResponse.json().catch(() => null)
			]);
			if (!response.ok) {
				pageError = payload?.error || copy.loadFailed;
				return;
			}
			dashboard = payload || {};
			runs = Array.isArray(payload?.runs) ? payload.runs : runs;
			if (schedulesResponse.ok) {
				schedulesData = schedulesPayload || {};
				scheduleRuntime = schedulesPayload?.runtime || {};
			}
			capabilityHealth = normalizeCapabilityHealth(
				payload?.capabilityHealth || { capabilities: payload?.capabilities || {} }
			);
			lastUpdatedAt =
				capabilityHealth.checkedAt || payload?.checkedAt || payload?.updatedAt || lastUpdatedAt;
		} catch {
			pageError = copy.loadFailed;
		} finally {
			refreshingDashboard = false;
		}
	};

	const refreshRuns = async () => {
		if (refreshingRuns) return;
		refreshingRuns = true;
		try {
			const response = await fetch(resolveAdminPath('/admin/api/openclaw/runs'));
			const payload = await response.json().catch(() => null);
			if (!response.ok) return;
			runs = Array.isArray(payload?.runs) ? payload.runs : runs;
			const latestDashboardRun = runs.find((run) => sanitizeDashboardUrl(run.dashboardUrl));
			const nextDashboardUrl = sanitizeDashboardUrl(latestDashboardRun?.dashboardUrl);
			if (nextDashboardUrl) {
				dashboard = {
					...dashboard,
					openclaw: {
						...(dashboard?.openclaw || {}),
						dashboardUrl: nextDashboardUrl
					}
				};
			}
		} finally {
			refreshingRuns = false;
		}
	};

	const handleCapabilityUpdate = (nextHealth) => {
		capabilityHealth = normalizeCapabilityHealth(nextHealth);
		lastUpdatedAt = capabilityHealth.checkedAt || lastUpdatedAt;
	};

	const startRun = async (action) => {
		if (busyAction) return;
		if (
			action === 'update-openclaw' &&
			!window.confirm(
				isEn
					? 'Update OpenClaw to the latest stable Docker image now? The Gateway may be unavailable briefly and will roll back automatically if health checks fail.'
					: 'Cập nhật OpenClaw lên Docker image stable mới nhất ngay bây giờ? Gateway có thể gián đoạn ngắn và sẽ tự rollback nếu health check thất bại.'
			)
		)
			return;
		busyAction = action;
		pageError = '';
		const profile = dashboard?.profile || 'inoxpran';
		const idempotencyKey = actionIdempotency.acquire({ action, profile });

		try {
			const response = await fetch(resolveAdminPath('/admin/api/openclaw/runs'), {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'Idempotency-Key': idempotencyKey
				},
				body: JSON.stringify({
					action,
					profile
				})
			});
			const payload = await response.json().catch(() => null);
			if (!shouldRetainOpenClawActionKey(response.status)) {
				actionIdempotency.clear({ action, profile, key: idempotencyKey });
			}
			if (!response.ok) {
				pageError = payload?.error || 'Unable to start OpenClaw run';
				return;
			}
			upsertRun(payload);
			selectedRunId = payload.id;
		} catch {
			pageError = isEn
				? 'The response was interrupted. Retry the same action to safely check the original request.'
				: 'Phản hồi bị gián đoạn. Hãy thử lại đúng hành động này để kiểm tra an toàn yêu cầu ban đầu.';
		} finally {
			busyAction = '';
		}
	};

	onMount(() => {
		const timer = window.setInterval(() => {
			if (activeRuns.length) {
				refreshRuns();
			}
		}, 2500);

		return () => window.clearInterval(timer);
	});
</script>

<svelte:head>
	<title>OpenClaw AI Console | Inoxpran</title>
</svelte:head>

<section class="openclaw-console">
	<header class="oc-header">
		<div class="oc-header__intro">
			<p class="oc-eyebrow">Agentic SEO Operations</p>
			<h1>{copy.title}</h1>
			<p class="oc-header__sub">{copy.subtitle}</p>
		</div>
		<div class="oc-header__actions">
			<a
				class="oc-btn oc-btn--ghost"
				href={resolve(resolveAdminPath('/admin/openclaw/content-operations'))}
			>
				<span>{copy.contentOperations}</span>
			</a>
			<button
				type="button"
				class="oc-btn oc-btn--ghost"
				onclick={refreshDashboard}
				disabled={refreshingDashboard}
				aria-busy={refreshingDashboard}
			>
				<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"
					><path
						d="M3 12a9 9 0 0 1 15.5-6.3M21 12a9 9 0 0 1-15.5 6.3"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/><path
						d="M18 3v3.5H14.5M6 21v-3.5H9.5"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
				<span>{refreshingDashboard ? copy.refreshing : copy.refresh}</span>
			</button>
			{#if dashboardUrl}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a class="oc-btn oc-btn--primary" href={dashboardUrl} target="_blank" rel="noreferrer">
					<span>{copy.dashboard}</span>
					<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"
						><path
							d="M14 4h6v6M20 4l-9 9M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/></svg
					>
				</a>
			{:else}
				<button
					class="oc-btn oc-btn--primary"
					type="button"
					disabled
					title="OpenClaw Control UI chỉ được mở qua SSH tunnel hoặc mạng riêng"
				>
					<span>{isEn ? 'Private dashboard' : 'Dashboard nội bộ'}</span>
				</button>
			{/if}
		</div>
	</header>

	{#if pageError}
		<div class="oc-alert" role="alert">{pageError}</div>
	{/if}

	<section class="oc-status" aria-label={copy.statusAria}>
		<div class="oc-status__grid">
			<div class="oc-status__item">
				<span class="oc-status__label">{copy.automation}</span>
				<span
					class="oc-badge"
					class:is-good={capabilityTone(seoCapability) === 'good'}
					class:is-warn={capabilityTone(seoCapability) === 'warn'}
					class:is-danger={capabilityTone(seoCapability) === 'danger'}
					class:is-muted={capabilityTone(seoCapability) === 'muted'}
				>
					<span class="oc-dot"></span>{capabilityLabel(seoCapability)}
				</span>
			</div>
			<div class="oc-status__item">
				<span class="oc-status__label">{copy.autoPublish}</span>
				<span
					class="oc-badge"
					class:is-warn={automation.autoPublish}
					class:is-good={!automation.autoPublish}
				>
					<span class="oc-dot"></span>{automation.autoPublish ? 'ON' : 'DRAFT'}
				</span>
			</div>
			<div class="oc-status__item">
				<span class="oc-status__label" title={`${enabledScheduleCount} enabled schedule(s)`}
					>Blog cron · {enabledScheduleCount}</span
				>
				<span
					class="oc-badge"
					class:is-good={capabilityTone(blogCronCapability) === 'good'}
					class:is-warn={capabilityTone(blogCronCapability) === 'warn'}
					class:is-danger={capabilityTone(blogCronCapability) === 'danger'}
					class:is-muted={capabilityTone(blogCronCapability) === 'muted'}
				>
					<span class="oc-dot"></span>{capabilityLabel(blogCronCapability)}
				</span>
			</div>
			<div class="oc-status__item">
				<span class="oc-status__label">Telegram</span>
				<span
					class="oc-badge"
					class:is-good={capabilityTone(telegramCapability) === 'good'}
					class:is-warn={capabilityTone(telegramCapability) === 'warn'}
					class:is-danger={capabilityTone(telegramCapability) === 'danger'}
					class:is-muted={capabilityTone(telegramCapability) === 'muted'}
				>
					<span class="oc-dot"></span>{capabilityLabel(telegramCapability)}
				</span>
			</div>
			<div class="oc-status__item">
				<span class="oc-status__label">{copy.profile}</span>
				<span class="oc-status__value">{dashboard?.profile || 'inoxpran'}</span>
			</div>
			<div class="oc-status__item">
				<span class="oc-status__label">{copy.gateway}</span>
				<span
					class="oc-badge"
					class:is-good={capabilityTone(gatewayCapability) === 'good'}
					class:is-warn={capabilityTone(gatewayCapability) === 'warn'}
					class:is-danger={capabilityTone(gatewayCapability) === 'danger'}
					class:is-muted={capabilityTone(gatewayCapability) === 'muted'}
				>
					<span class="oc-dot"></span>{capabilityLabel(gatewayCapability)}
				</span>
			</div>
			<div class="oc-status__item">
				<span class="oc-status__label">{copy.updated}</span>
				<span class="oc-status__value">{formatDateTime(lastUpdatedAt)}</span>
			</div>
		</div>
	</section>

	<CapabilityHealthPanel health={capabilityHealth} onUpdated={handleCapabilityUpdate} />

	<div class="oc-grid oc-grid--main">
		<section class="oc-panel oc-panel--command">
			<div class="oc-panel__head">
				<h2>{copy.commandCenter}</h2>
				<span class="oc-count">{activeRuns.length} {copy.running}</span>
			</div>

			<div class="oc-actions">
				<div class="oc-actions__group">
					<p class="oc-actions__label">{copy.groupGateway}</p>
					<div class="oc-actions__grid">
						{#each actions.filter( (a) => ['start-openclaw', 'stop-openclaw', 'status', 'update-openclaw'].includes(a.id) ) as action (action.id)}
							<button
								type="button"
								class="oc-action"
								class:oc-action--warn={action.id === 'stop-openclaw'}
								class:oc-action--update={action.id === 'update-openclaw'}
								disabled={action.id !== 'daily-draft' &&
									(Boolean(busyAction) || actionIsActive(action.id))}
								onclick={() =>
									action.id === 'daily-draft'
										? goto(resolve(resolveAdminPath('/admin/openclaw/daily-draft')))
										: startRun(action.id)}
							>
								<span class="oc-action__title">{actionMeta[action.id]?.label || action.label}</span>
								<span class="oc-action__detail"
									>{actionMeta[action.id]?.detail || action.label}</span
								>
								{#if busyAction === action.id}
									<span class="oc-action__state">{copy.starting}…</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>

				<div class="oc-actions__group">
					<p class="oc-actions__label">{copy.groupSetup}</p>
					<div class="oc-actions__grid">
						{#each actions.filter( (a) => ['install-skills', 'sync-agents'].includes(a.id) ) as action (action.id)}
							<button
								type="button"
								class="oc-action"
								disabled={action.id !== 'daily-draft' &&
									(Boolean(busyAction) || actionIsActive(action.id))}
								onclick={() =>
									action.id === 'daily-draft'
										? goto(resolve(resolveAdminPath('/admin/openclaw/daily-draft')))
										: startRun(action.id)}
							>
								<span class="oc-action__title">{actionMeta[action.id]?.label || action.label}</span>
								<span class="oc-action__detail"
									>{actionMeta[action.id]?.detail || action.label}</span
								>
								{#if busyAction === action.id}
									<span class="oc-action__state">{copy.starting}…</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>

				<div class="oc-actions__group">
					<p class="oc-actions__label">{copy.groupAutomation}</p>
					<div class="oc-actions__grid">
						{#each actions.filter( (a) => ['smoke-test', 'daily-draft'].includes(a.id) ) as action (action.id)}
							<button
								type="button"
								class="oc-action"
								class:oc-action--link={action.id === 'daily-draft'}
								disabled={action.id !== 'daily-draft' &&
									(Boolean(busyAction) || actionIsActive(action.id))}
								onclick={() =>
									action.id === 'daily-draft'
										? goto(resolve(resolveAdminPath('/admin/openclaw/daily-draft')))
										: startRun(action.id)}
							>
								<span class="oc-action__title">{actionMeta[action.id]?.label || action.label}</span>
								<span class="oc-action__detail"
									>{actionMeta[action.id]?.detail || action.label}</span
								>
								{#if busyAction === action.id}
									<span class="oc-action__state">{copy.starting}…</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>

				{#if actions.filter((a) => !['start-openclaw', 'stop-openclaw', 'status', 'update-openclaw', 'install-skills', 'sync-agents', 'smoke-test', 'daily-draft'].includes(a.id)).length}
					<div class="oc-actions__group">
						<p class="oc-actions__label">{copy.groupOther}</p>
						<div class="oc-actions__grid">
							{#each actions.filter((a) => !['start-openclaw', 'stop-openclaw', 'status', 'update-openclaw', 'install-skills', 'sync-agents', 'smoke-test', 'daily-draft'].includes(a.id)) as action (action.id)}
								<button
									type="button"
									class="oc-action"
									disabled={action.id !== 'daily-draft' &&
										(Boolean(busyAction) || actionIsActive(action.id))}
									onclick={() =>
										action.id === 'daily-draft'
											? goto(resolve(resolveAdminPath('/admin/openclaw/daily-draft')))
											: startRun(action.id)}
								>
									<span class="oc-action__title"
										>{actionMeta[action.id]?.label || action.label}</span
									>
									<span class="oc-action__detail"
										>{actionMeta[action.id]?.detail || action.label}</span
									>
									{#if busyAction === action.id}
										<span class="oc-action__state">{copy.starting}…</span>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</section>

		<aside class="oc-panel oc-panel--safety">
			<div class="oc-panel__head">
				<h2>{copy.safety}</h2>
				<span class="oc-count">{automation.minSeoScore || 85}+ SEO</span>
			</div>

			<div class="oc-gate-group">
				<p class="oc-gate-group__label">{copy.gateAutomation}</p>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'SEO agent automation' : 'Tự động hóa SEO agent'}</strong><code
							>SEO_AGENT_ENABLED</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={automation.enabled}
						class:is-muted={!automation.enabled}>{automation.enabled ? 'true' : 'false'}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Automatic publication' : 'Tự động xuất bản'}</strong><code
							>SEO_AGENT_AUTO_PUBLISH</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={!automation.autoPublish}
						class:is-warn={automation.autoPublish}
						>{automation.autoPublish ? 'enabled' : 'draft review'}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Backend API credential' : 'Khóa API backend'}</strong><code
							>API_KEY</code
						></span
					>
					<b class="oc-badge" class:is-good={env.API_KEY} class:is-warn={!env.API_KEY}
						>{env.API_KEY ? 'set' : 'missing'}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'SEO agent API credential' : 'Khóa API SEO agent'}</strong><code
							>SEO_AGENT_API_KEY</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={env.SEO_AGENT_API_KEY}
						class:is-warn={!env.SEO_AGENT_API_KEY}>{env.SEO_AGENT_API_KEY ? 'set' : 'missing'}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Request signature secret' : 'Bí mật ký request'}</strong><code
							>SEO_AGENT_HMAC_SECRET</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={env.SEO_AGENT_HMAC_SECRET}
						class:is-warn={!env.SEO_AGENT_HMAC_SECRET}
						>{env.SEO_AGENT_HMAC_SECRET ? 'set' : 'missing'}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'OpenAI provider credential' : 'Khóa nhà cung cấp OpenAI'}</strong
						><code>OPENAI_API_KEY</code></span
					>
					<b class="oc-badge" class:is-good={env.OPENAI_API_KEY} class:is-warn={!env.OPENAI_API_KEY}
						>{env.OPENAI_API_KEY ? 'set' : 'missing'}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Private gateway credential' : 'Khóa Gateway nội bộ'}</strong><code
							>OPENCLAW_GATEWAY_TOKEN</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={gatewayCapability.configured}
						class:is-warn={!gatewayCapability.configured}
						>{gatewayCapability.configured ? 'set' : 'missing'}</b
					>
				</div>
			</div>

			<div class="oc-gate-group">
				<p class="oc-gate-group__label">
					{isEn ? 'Content Ops & data sources' : 'Content Ops & nguồn dữ liệu'}
				</p>
				{#each operationsCapabilityRows as [label, name, capability] (name)}
					<div class="oc-gate__row">
						<span class="oc-gate__identity"><strong>{label}</strong><code>{name}</code></span>
						<b
							class="oc-badge"
							class:is-good={capabilityTone(capability) === 'good'}
							class:is-warn={capabilityTone(capability) === 'warn'}
							class:is-danger={capabilityTone(capability) === 'danger'}
							class:is-muted={capabilityTone(capability) === 'muted'}
							>{capabilityLabel(capability)}</b
						>
					</div>
				{/each}
				{#each dataCapabilityRows as [label, name, capability] (name)}
					<div class="oc-gate__row">
						<span class="oc-gate__identity"><strong>{label}</strong><code>{name}</code></span>
						<b
							class="oc-badge"
							class:is-good={capabilityTone(capability) === 'good'}
							class:is-warn={capabilityTone(capability) === 'warn'}
							class:is-danger={capabilityTone(capability) === 'danger'}
							class:is-muted={capabilityTone(capability) === 'muted'}
							>{capabilityLabel(capability)}</b
						>
					</div>
				{/each}
			</div>

			<div class="oc-gate-group">
				<p class="oc-gate-group__label">{copy.gateImages}</p>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Image pipeline' : 'Pipeline hình ảnh'}</strong><code
							>OPENCLAW_IMAGE_PIPELINE_ENABLED</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={capabilityTone(imagePipelineCapability) === 'good'}
						class:is-warn={capabilityTone(imagePipelineCapability) === 'warn'}
						class:is-danger={capabilityTone(imagePipelineCapability) === 'danger'}
						class:is-muted={capabilityTone(imagePipelineCapability) === 'muted'}
						>{capabilityLabel(imagePipelineCapability)}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Cover requirement' : 'Yêu cầu ảnh bìa'}</strong><code
							>REQUIRE_COVER</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={automation.requireCoverForPublish}
						class:is-muted={!automation.requireCoverForPublish}
						>{automation.requireCoverForPublish ? 'true' : 'false'}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Image search provider' : 'Nhà cung cấp tìm ảnh'}</strong><code
							>IMAGE_SEARCH_PROVIDER</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={capabilities.imageSearch?.configured}
						class:is-muted={!capabilities.imageSearch?.configured}
						>{capabilities.imageSearch?.configured
							? `${automation.imageSearchProvider} / set`
							: 'disabled / missing'}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'AI image provider' : 'Nhà cung cấp ảnh AI'}</strong><code
							>AI_IMAGE_PROVIDER</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={capabilities.aiImage?.configured}
						class:is-muted={!capabilities.aiImage?.configured}
						>{capabilities.aiImage?.configured
							? `${automation.aiImageProvider} / set`
							: 'disabled / missing'}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Optional Firecrawl credential' : 'Khóa Firecrawl tùy chọn'}</strong
						><code>FIRECRAWL_API_KEY</code></span
					>
					<b
						class="oc-badge"
						class:is-good={env.FIRECRAWL_API_KEY}
						class:is-muted={!env.FIRECRAWL_API_KEY}>{env.FIRECRAWL_API_KEY ? 'set' : 'optional'}</b
					>
				</div>
			</div>

			<div class="oc-gate-group">
				<p class="oc-gate-group__label">{copy.gateScheduling}</p>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Blog schedule' : 'Lịch tạo blog'}</strong><code
							>OPENCLAW_BLOG_CRON_ENABLED</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={capabilityTone(blogCronCapability) === 'good'}
						class:is-warn={capabilityTone(blogCronCapability) === 'warn'}
						class:is-danger={capabilityTone(blogCronCapability) === 'danger'}
						class:is-muted={capabilityTone(blogCronCapability) === 'muted'}
						>{capabilityLabel(blogCronCapability)} &middot; {enabledScheduleCount}
						{isEn ? 'schedule(s)' : 'lịch'}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Telegram approval' : 'Duyệt qua Telegram'}</strong><code
							>TELEGRAM_BOT_ENABLED</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={capabilityTone(telegramCapability) === 'good'}
						class:is-warn={capabilityTone(telegramCapability) === 'warn'}
						class:is-danger={capabilityTone(telegramCapability) === 'danger'}
						class:is-muted={capabilityTone(telegramCapability) === 'muted'}
						>{capabilityLabel(telegramCapability)}</b
					>
				</div>
				{#if scheduleRuntime.telegramEnabled || telegramConfigured}
					<div class="oc-gate__row">
						<span class="oc-gate__identity"
							><strong>{isEn ? 'Telegram bot credential' : 'Khóa Telegram bot'}</strong><code
								>TELEGRAM_BOT_TOKEN</code
							></span
						>
						<b
							class="oc-badge"
							class:is-good={env.TELEGRAM_BOT_TOKEN}
							class:is-warn={!env.TELEGRAM_BOT_TOKEN}
							>{env.TELEGRAM_BOT_TOKEN ? 'set' : 'missing'}</b
						>
					</div>
					<div class="oc-gate__row">
						<span class="oc-gate__identity"
							><strong>{isEn ? 'Telegram webhook signature' : 'Chữ ký webhook Telegram'}</strong
							><code>TELEGRAM_WEBHOOK_SECRET</code></span
						>
						<b
							class="oc-badge"
							class:is-good={env.TELEGRAM_WEBHOOK_SECRET}
							class:is-warn={!env.TELEGRAM_WEBHOOK_SECRET}
							>{env.TELEGRAM_WEBHOOK_SECRET ? 'set' : 'missing'}</b
						>
					</div>
					<div class="oc-gate__row">
						<span class="oc-gate__identity"
							><strong>{isEn ? 'Telegram allowlist' : 'Danh sách Telegram được phép'}</strong><code
								>TELEGRAM_ALLOWLIST</code
							></span
						>
						<b
							class="oc-badge"
							class:is-good={env.TELEGRAM_ALLOWED_CHAT_IDS || env.TELEGRAM_ALLOWED_USER_IDS}
							class:is-warn={!(env.TELEGRAM_ALLOWED_CHAT_IDS || env.TELEGRAM_ALLOWED_USER_IDS)}
							>{env.TELEGRAM_ALLOWED_CHAT_IDS || env.TELEGRAM_ALLOWED_USER_IDS
								? 'set'
								: 'missing'}</b
						>
					</div>
				{:else}
					<div class="oc-gate__row">
						<span class="oc-gate__identity"
							><strong>{isEn ? 'Telegram approval' : 'Duyệt qua Telegram'}</strong><code
								>TELEGRAM_APPROVAL</code
							></span
						>
						<b class="oc-badge is-muted"
							>{isEn ? 'optional / not configured' : 'tùy chọn / chưa cấu hình'}</b
						>
					</div>
				{/if}
			</div>

			<div class="oc-gate-group">
				<p class="oc-gate-group__label">{isEn ? 'Review safety' : 'An toàn kiểm duyệt'}</p>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Automatic learning changes' : 'Tự áp dụng thay đổi học được'}</strong
						><code>CONTENT_LEARNING_AUTO_APPLY</code></span
					>
					<b
						class="oc-badge"
						class:is-good={!featureFlags.CONTENT_LEARNING_AUTO_APPLY}
						class:is-warn={featureFlags.CONTENT_LEARNING_AUTO_APPLY}
						>{featureFlags.CONTENT_LEARNING_AUTO_APPLY ? 'automatic' : 'manual review'}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Publish readiness gate' : 'Cổng sẵn sàng xuất bản'}</strong><code
							>CONTENT_PUBLISH_READINESS_ENABLED</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={featureFlags.CONTENT_PUBLISH_READINESS_ENABLED}
						class:is-danger={!featureFlags.CONTENT_PUBLISH_READINESS_ENABLED}
						>{featureFlags.CONTENT_PUBLISH_READINESS_ENABLED ? 'true' : 'false'}</b
					>
				</div>
				<div class="oc-gate__row">
					<span class="oc-gate__identity"
						><strong>{isEn ? 'Post-publish verification' : 'Xác minh sau xuất bản'}</strong><code
							>CONTENT_POST_PUBLISH_VERIFY_ENABLED</code
						></span
					>
					<b
						class="oc-badge"
						class:is-good={featureFlags.CONTENT_POST_PUBLISH_VERIFY_ENABLED}
						class:is-danger={!featureFlags.CONTENT_POST_PUBLISH_VERIFY_ENABLED}
						>{featureFlags.CONTENT_POST_PUBLISH_VERIFY_ENABLED ? 'true' : 'false'}</b
					>
				</div>
			</div>
		</aside>
	</div>

	<section class="oc-panel oc-runtime">
		<div class="oc-panel__head">
			<h2>{copy.runMonitor}</h2>
			<span class="oc-count">{runs.length} {copy.runs}</span>
		</div>

		<div class="oc-run-layout">
			<div class="oc-run-list">
				{#if runs.length}
					{#each runs as run (run.id)}
						<button
							type="button"
							class="oc-run-row"
							class:is-selected={selectedRun?.id === run.id}
							onclick={() => (selectedRunId = run.id)}
						>
							<span class={`oc-run-status ${run.status}`}>{statusLabel(run.status)}</span>
							<strong>{run.label}</strong>
							<small>{formatDateTime(run.startedAt)} · {formatDuration(run.durationMs)}</small>
						</button>
					{/each}
				{:else}
					<div class="oc-empty">
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"
							><path
								d="M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
								stroke="currentColor"
								stroke-width="1.7"
								stroke-linecap="round"
								stroke-linejoin="round"
							/></svg
						>
						<p>{copy.noRuns}</p>
						<small>{copy.noRunsHint}</small>
					</div>
				{/if}
			</div>

			<div class="oc-run-output">
				{#if selectedRun}
					<div class="oc-run-output__meta">
						<div>
							<span>{selectedRun.label}</span>
							<strong class={`oc-run-status ${selectedRun.status}`}
								>{statusLabel(selectedRun.status)}</strong
							>
						</div>
						<code>{selectedRun.command}</code>
					</div>
					<pre class="oc-log">{selectedRun.output || selectedRun.error || copy.noOutput}</pre>
				{:else}
					<div class="oc-empty">
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"
							><path
								d="M4 5h16M4 12h16M4 19h10"
								stroke="currentColor"
								stroke-width="1.7"
								stroke-linecap="round"
							/></svg
						>
						<p>{copy.noOutput}</p>
						<small>{copy.noOutputHint}</small>
					</div>
				{/if}
			</div>
		</div>
	</section>

	<div class="oc-grid oc-grid--caps">
		<section class="oc-panel">
			<div class="oc-panel__head">
				<h2>{copy.agents}</h2>
				<span class="oc-count">{agents.length}</span>
			</div>
			<div class="oc-chips">
				{#each agents as agent (agent)}
					<span class="oc-chip">{agent}</span>
				{/each}
			</div>
		</section>

		<section class="oc-panel">
			<div class="oc-panel__head">
				<h2>{copy.skills}</h2>
				<span class="oc-count">{localSkills.length}</span>
			</div>
			<div class="oc-chips">
				{#each localSkills as skill (skill)}
					<span class="oc-chip">{skill}</span>
				{/each}
			</div>
		</section>

		<section class="oc-panel">
			<div class="oc-panel__head">
				<h2>{copy.coreSkills}</h2>
				<span class="oc-count">{skillReport?.installed?.length || 0}</span>
			</div>
			{#if (skillReport?.installed || []).length}
				<div class="oc-skill-report">
					{#each skillReport?.installed || [] as skill (skill)}
						<div class="oc-skill-report__row"><b>installed</b><span>{skill}</span></div>
					{/each}
				</div>
			{:else}
				<div class="oc-empty">
					<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"
						><path
							d="M20 7 9 18l-5-5"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
							stroke-linejoin="round"
						/></svg
					>
					<p>{copy.noReport}</p>
				</div>
			{/if}
		</section>
	</div>
</section>

<style>
	.openclaw-console {
		--oc-surface: var(--admin-surface, #ffffff);
		--oc-surface-2: #f9fafb;
		--oc-border: var(--admin-border, #e5e7eb);
		--oc-border-soft: rgba(17, 24, 39, 0.07);
		--oc-text: var(--admin-ink, #1a1f2e);
		--oc-muted: var(--admin-muted, #6b7280);
		--oc-primary: var(--admin-accent, #0f766e);
		--oc-primary-strong: var(--admin-accent-strong, #065f5a);
		--oc-primary-soft: var(--admin-accent-soft, rgba(15, 118, 110, 0.08));
		--oc-warning: var(--admin-warning, #d97706);
		--oc-danger: var(--admin-danger, #dc2626);
		--oc-radius: var(--admin-radius, 12px);
		--oc-radius-sm: 9px;
		--oc-shadow: var(--admin-shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.05));
		display: grid;
		gap: clamp(16px, 2vw, 22px);
		color: var(--oc-text);
		min-width: 0;
	}

	.openclaw-console h1,
	.openclaw-console h2 {
		margin: 0;
	}

	/* ── Header ── */
	.oc-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
		padding: clamp(18px, 2vw, 22px) clamp(18px, 2vw, 24px);
		background: var(--oc-surface);
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius);
		box-shadow: var(--oc-shadow);
	}

	.oc-eyebrow {
		margin: 0 0 6px;
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--oc-primary);
	}

	.oc-header__intro h1 {
		font-size: clamp(1.4rem, 2vw, 1.85rem);
		font-weight: 700;
		line-height: 1.15;
	}

	.oc-header__sub {
		margin: 6px 0 0;
		color: var(--oc-muted);
		font-size: 0.92rem;
	}

	.oc-header__actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}

	/* ── Buttons ── */
	.oc-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 40px;
		padding: 0 16px;
		border-radius: 10px;
		border: 1px solid transparent;
		font: inherit;
		font-weight: 600;
		font-size: 0.88rem;
		cursor: pointer;
		text-decoration: none;
		transition:
			background 0.18s ease,
			border-color 0.18s ease,
			box-shadow 0.18s ease,
			transform 0.18s ease;
	}

	.oc-btn svg {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.oc-btn--primary {
		background: var(--oc-primary);
		border-color: var(--oc-primary);
		color: #fff;
		box-shadow: 0 2px 8px rgba(15, 118, 110, 0.16);
	}

	.oc-btn--primary:hover {
		background: var(--oc-primary-strong);
		border-color: var(--oc-primary-strong);
		transform: translateY(-1px);
	}

	.oc-btn--ghost {
		background: var(--oc-surface);
		border-color: var(--oc-border);
		color: var(--oc-text);
	}

	.oc-btn--ghost:hover {
		border-color: var(--oc-primary);
		background: var(--oc-primary-soft);
		color: var(--oc-primary-strong);
	}

	.oc-btn:focus-visible,
	.oc-action:focus-visible,
	.oc-run-row:focus-visible {
		outline: 2px solid var(--oc-primary);
		outline-offset: 2px;
	}

	/* ── Alert ── */
	.oc-alert {
		padding: 12px 16px;
		border-radius: var(--oc-radius);
		border: 1px solid rgba(220, 38, 38, 0.2);
		background: rgba(220, 38, 38, 0.08);
		color: #991b1b;
		font-size: 0.9rem;
	}

	/* ── Panels ── */
	.oc-panel {
		min-width: 0;
		background: var(--oc-surface);
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius);
		box-shadow: var(--oc-shadow);
		padding: clamp(16px, 1.6vw, 20px);
	}

	.oc-panel__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
	}

	.oc-panel__head h2 {
		font-size: 1rem;
		font-weight: 700;
	}

	.oc-count {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--oc-muted);
		background: var(--oc-surface-2);
		border: 1px solid var(--oc-border);
		padding: 3px 9px;
		border-radius: 999px;
		white-space: nowrap;
	}

	/* ── Status overview ── */
	.oc-status {
		background: var(--oc-surface);
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius);
		box-shadow: var(--oc-shadow);
		padding: 6px;
	}

	.oc-status__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
		gap: 2px;
	}

	.oc-status__item {
		display: grid;
		gap: 7px;
		padding: 12px 14px;
		border-radius: var(--oc-radius-sm);
		min-width: 0;
		transition: background 0.18s ease;
	}

	.oc-status__item:hover {
		background: var(--oc-surface-2);
	}

	.oc-status__item--wide {
		grid-column: span 2;
	}

	.oc-status__label {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--oc-muted);
	}

	.oc-status__value {
		font-weight: 600;
		font-size: 0.92rem;
		overflow-wrap: anywhere;
	}

	.oc-status__value--mono {
		font-family: 'Monaco', 'Courier New', monospace;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--oc-muted);
	}

	/* ── Badges & dots ── */
	.oc-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		width: fit-content;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
		font-style: normal;
		background: rgba(107, 114, 128, 0.12);
		color: #4b5563;
		border: 1px solid rgba(107, 114, 128, 0.16);
	}

	.oc-badge .oc-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
		flex-shrink: 0;
	}

	.oc-badge.is-good {
		background: rgba(5, 150, 105, 0.12);
		color: #047857;
		border-color: rgba(5, 150, 105, 0.22);
	}

	.oc-badge.is-warn {
		background: rgba(217, 119, 6, 0.12);
		color: #b45309;
		border-color: rgba(217, 119, 6, 0.22);
	}

	.oc-badge.is-danger {
		background: rgba(220, 38, 38, 0.12);
		color: #b91c1c;
		border-color: rgba(220, 38, 38, 0.22);
	}

	.oc-badge.is-muted {
		background: rgba(107, 114, 128, 0.1);
		color: #4b5563;
		border-color: rgba(107, 114, 128, 0.18);
	}

	/* ── Grids ── */
	.oc-grid {
		display: grid;
		gap: clamp(16px, 2vw, 22px);
	}

	.oc-grid--main {
		grid-template-columns: minmax(0, 1.6fr) minmax(300px, 0.92fr);
		align-items: start;
	}

	.oc-grid--caps {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	/* ── Command actions ── */
	.oc-actions {
		display: grid;
		gap: 16px;
	}

	.oc-actions__group {
		display: grid;
		gap: 9px;
	}

	.oc-actions__label,
	.oc-gate-group__label {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--oc-muted);
	}

	.oc-actions__grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(178px, 1fr));
		gap: 10px;
	}

	.oc-action {
		display: grid;
		gap: 3px;
		align-content: start;
		text-align: left;
		padding: 13px 14px;
		min-height: 76px;
		border-radius: var(--oc-radius-sm);
		border: 1px solid var(--oc-border);
		background: var(--oc-surface);
		color: var(--oc-text);
		cursor: pointer;
		transition:
			border-color 0.18s ease,
			background 0.18s ease,
			box-shadow 0.18s ease,
			transform 0.18s ease;
	}

	.oc-action:hover {
		border-color: var(--oc-primary);
		background: var(--oc-primary-soft);
		transform: translateY(-1px);
		box-shadow: var(--oc-shadow);
	}

	.oc-action:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
		background: var(--oc-surface-2);
	}

	.oc-action__title {
		font-weight: 700;
		font-size: 0.9rem;
	}

	.oc-action__detail {
		font-size: 0.78rem;
		color: var(--oc-muted);
		line-height: 1.35;
	}

	.oc-action__state {
		margin-top: 4px;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--oc-primary);
	}

	.oc-action--warn:hover {
		border-color: var(--oc-warning);
		background: rgba(217, 119, 6, 0.07);
	}

	.oc-action--update {
		border-color: color-mix(in srgb, var(--oc-primary) 42%, var(--oc-border));
		background: var(--oc-primary-soft);
	}

	.oc-action--link {
		border-color: rgba(15, 118, 110, 0.3);
		background: var(--oc-primary-soft);
	}

	/* ── Safety gates ── */
	.oc-panel--safety {
		align-self: start;
	}

	.oc-gate-group {
		display: grid;
		gap: 0;
	}

	.oc-gate-group + .oc-gate-group {
		margin-top: 14px;
	}

	.oc-gate-group__label {
		margin-bottom: 5px;
	}

	.oc-gate__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--oc-border-soft);
	}

	.oc-gate__row:last-child {
		border-bottom: 0;
	}

	.oc-gate__row > span {
		color: var(--oc-muted);
		font-family: 'Monaco', 'Courier New', monospace;
		font-size: 0.73rem;
		overflow-wrap: anywhere;
	}

	.oc-gate__identity {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.oc-gate__identity strong {
		color: var(--oc-text);
		font-family: inherit;
		font-size: 0.74rem;
	}

	.oc-gate__identity code {
		color: var(--oc-muted);
		font-size: 0.6rem;
		overflow-wrap: anywhere;
	}

	/* ── Runtime ── */
	.oc-run-layout {
		display: grid;
		grid-template-columns: minmax(230px, 0.4fr) minmax(0, 1fr);
		gap: 16px;
	}

	.oc-run-list {
		display: grid;
		align-content: start;
		gap: 8px;
		max-height: 520px;
		overflow: auto;
	}

	.oc-run-row {
		display: grid;
		gap: 5px;
		text-align: left;
		padding: 11px 12px;
		border-radius: var(--oc-radius-sm);
		border: 1px solid var(--oc-border);
		background: var(--oc-surface);
		cursor: pointer;
		transition:
			border-color 0.18s ease,
			background 0.18s ease;
	}

	.oc-run-row:hover {
		border-color: var(--oc-primary);
		background: var(--oc-primary-soft);
	}

	.oc-run-row.is-selected {
		border-color: var(--oc-primary);
		background: var(--oc-primary-soft);
		box-shadow: inset 3px 0 0 var(--oc-primary);
	}

	.oc-run-row strong {
		font-size: 0.86rem;
		overflow-wrap: anywhere;
	}

	.oc-run-row small {
		color: var(--oc-muted);
		font-size: 0.75rem;
	}

	.oc-run-status {
		width: fit-content;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		background: rgba(37, 99, 235, 0.12);
		color: #1e40af;
	}

	.oc-run-status.completed {
		background: rgba(5, 150, 105, 0.12);
		color: #047857;
	}

	.oc-run-status.failed,
	.oc-run-status.timed_out {
		background: rgba(220, 38, 38, 0.12);
		color: #b91c1c;
	}

	.oc-run-output {
		min-width: 0;
		display: grid;
		grid-template-rows: auto 1fr;
		gap: 10px;
	}

	.oc-run-output__meta {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.oc-run-output__meta > div {
		display: grid;
		gap: 3px;
	}

	.oc-run-output__meta span {
		color: var(--oc-muted);
		font-size: 0.78rem;
	}

	.oc-run-output__meta code {
		font-size: 0.75rem;
		color: var(--oc-muted);
		overflow-wrap: anywhere;
		max-width: 48%;
		background: none;
		padding: 0;
	}

	.oc-log {
		margin: 0;
		min-height: 220px;
		max-height: 520px;
		overflow: auto;
		padding: 14px;
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface-2);
		color: #334155;
		border: 1px solid var(--oc-border);
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.78rem;
		line-height: 1.55;
		font-family: 'Monaco', 'Courier New', monospace;
	}

	/* ── Empty state ── */
	.oc-empty {
		display: grid;
		gap: 6px;
		justify-items: center;
		align-content: center;
		text-align: center;
		padding: 26px 16px;
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface-2);
		border: 1px dashed var(--oc-border);
		color: var(--oc-muted);
	}

	.oc-empty svg {
		width: 26px;
		height: 26px;
		opacity: 0.55;
	}

	.oc-empty p {
		margin: 0;
		font-weight: 600;
		color: var(--oc-text);
		font-size: 0.9rem;
	}

	.oc-empty small {
		font-size: 0.78rem;
	}

	/* ── Capability chips ── */
	.oc-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		max-height: 264px;
		overflow: auto;
	}

	.oc-chip {
		padding: 5px 11px;
		border-radius: 999px;
		border: 1px solid var(--oc-border);
		background: var(--oc-surface-2);
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--oc-text);
	}

	.oc-skill-report {
		display: grid;
		gap: 4px;
	}

	.oc-skill-report__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 0;
		border-bottom: 1px solid var(--oc-border-soft);
		font-size: 0.82rem;
	}

	.oc-skill-report__row:last-child {
		border-bottom: 0;
	}

	.oc-skill-report__row b {
		color: var(--oc-primary);
		font-size: 0.68rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.oc-skill-report__row span {
		overflow-wrap: anywhere;
	}

	/* ── Responsive ── */
	@media (max-width: 1080px) {
		.oc-grid--main,
		.oc-grid--caps,
		.oc-run-layout {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.oc-header {
			align-items: stretch;
		}

		.oc-header__actions .oc-btn {
			flex: 1 1 auto;
		}

		.oc-status__item--wide {
			grid-column: span 1;
		}

		.oc-run-output__meta code {
			max-width: 100%;
		}
	}
</style>
