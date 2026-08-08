<script>
	import { resolve } from '$app/paths';
	import { locale } from '$lib/i18n/admin/index.js';
	import CapabilityHealthPanel from '$lib/components/admin/openclaw/CapabilityHealthPanel.svelte';
	import {
		capabilityHealthOverallTone,
		capabilityTone,
		findCapability,
		normalizeCapability,
		normalizeCapabilityHealth
	} from '$lib/openclaw/capabilityHealth.js';
	import { openClawActivityStore } from '$lib/openclaw/activityCenter.js';
	import { dateTimeInVietnam, simpleResultLabel } from '$lib/openclaw/simpleSchedule.js';
	import { normalizeOpenClawUiError, openClawUiErrorText } from '$lib/openclaw/uiError.js';

	let { data } = $props();

	const isEn = $derived($locale === 'en');

	// svelte-ignore state_referenced_locally
	let dashboard = $state(data?.dashboard || {});
	// svelte-ignore state_referenced_locally
	let runtimeControls = $state(data?.runtimeControls || {});
	// svelte-ignore state_referenced_locally
	let capabilityHealth = $state(normalizeCapabilityHealth(data?.capabilityHealth || {}));
	// svelte-ignore state_referenced_locally
	let pageError = $state(data?.loadError || '');
	const availability = $derived(data?.availability || {});
	const unavailableResources = $derived(
		Object.entries(availability)
			.filter(([, available]) => available === false)
			.map(([resource]) => resource)
	);
	const schedulesKnown = $derived(availability.schedules !== false);
	const executionHistoryKnown = $derived(availability.executionHistory !== false);
	const runtimeControlsKnown = $derived(availability.runtimeControls !== false);

	const contentOperations = $derived(
		data?.contentOperations?.status || data?.contentOperations || {}
	);
	const scheduleData = $derived(data?.schedules || {});
	const schedules = $derived(Array.isArray(scheduleData?.schedules) ? scheduleData.schedules : []);
	const executionSummaries = $derived(
		Array.isArray(data?.executionSummaries) ? data.executionSummaries : []
	);
	const scheduleRuntime = $derived(scheduleData?.runtime || {});
	const automation = $derived(dashboard?.automation || {});
	const gatewayCapability = $derived(
		findCapability(capabilityHealth, 'openclaw_gateway', 'openclawGateway') ||
			normalizeCapability({}, 'openclaw_gateway')
	);

	const runtimeControlMap = $derived.by(() =>
		Object.fromEntries(
			(Array.isArray(runtimeControls?.controls) ? runtimeControls.controls : []).map((control) => [
				control.controlKey,
				control
			])
		)
	);
	const canManageRuntimeControls = $derived(runtimeControls?.actions?.manage === true);
	const blogCronEnabled = $derived(
		runtimeControlMap.blog_cron?.enabled ?? Boolean(scheduleRuntime.cronEnabled)
	);
	const autoPublishEnabled = $derived(
		runtimeControlMap.auto_publish?.enabled ?? Boolean(automation.autoPublish)
	);
	const telegramApprovalEnabled = $derived(
		runtimeControlMap.telegram_approval?.enabled ?? Boolean(automation.telegramEnabled)
	);
	const imagePipelineEnabled = $derived(
		runtimeControlMap.image_pipeline?.enabled ?? Boolean(automation.imagePipelineEnabled)
	);

	// The two audited switches already express three publishing postures. Naming
	// them here keeps the operator choosing an outcome instead of reasoning about
	// which combination of switches produces it.
	const publishMode = $derived(
		autoPublishEnabled ? 'direct' : telegramApprovalEnabled ? 'telegram' : 'draft'
	);
	// Each move flips exactly one switch, so it stays inside the existing audited
	// dialog. Leaving direct publishing hands back to Telegram when it is armed,
	// so a second step is only needed to fall all the way back to draft-only.
	const publishModeControl = (mode) => {
		if (mode === 'direct') return autoPublishEnabled ? null : 'auto_publish';
		if (mode === 'telegram') {
			if (autoPublishEnabled) return 'auto_publish';
			return telegramApprovalEnabled ? null : 'telegram_approval';
		}
		if (autoPublishEnabled) return 'auto_publish';
		return telegramApprovalEnabled ? 'telegram_approval' : null;
	};

	const enabledSchedules = $derived(schedules.filter((schedule) => schedule?.enabled));
	const nextRunAt = $derived.by(() => {
		const upcoming = enabledSchedules
			.map((schedule) => schedule.nextRunAt)
			.filter(Boolean)
			.map((value) => new Date(value).getTime())
			.filter((value) => Number.isFinite(value));
		return upcoming.length ? new Date(Math.min(...upcoming)) : null;
	});
	const lastSuccessfulRun = $derived.by(() => {
		const successStatuses = new Set([
			'draft_created',
			'maintenance_created',
			'completed',
			'published',
			'skipped'
		]);
		const historical = executionSummaries
			.flatMap((summary) => summary?.executions || [])
			.filter((execution) => successStatuses.has(execution?.status))
			.map((execution) =>
				new Date(execution.completedAt || execution.createdAt || execution.startedAt).getTime()
			)
			.filter((value) => Number.isFinite(value));
		const scheduleFallback = schedules
			.filter((schedule) => schedule.lastRunAt && successStatuses.has(schedule.lastRunStatus))
			.map((schedule) => new Date(schedule.lastRunAt).getTime())
			.filter((value) => Number.isFinite(value));
		const finished = [...historical, ...scheduleFallback];
		return finished.length ? new Date(Math.max(...finished)) : null;
	});
	const capabilityItems = $derived(Object.values(capabilityHealth?.capabilities || {}));
	const blockingIssues = $derived(
		capabilityItems.filter((capability) => capabilityTone(capability) === 'danger').length
	);
	const degradedIssues = $derived(
		capabilityItems.filter((capability) => capabilityTone(capability) === 'warn').length
	);
	const overallState = $derived.by(() => {
		if (pageError) return { label: isEn ? 'Unavailable' : 'Không tải được', tone: 'danger' };
		if (unavailableResources.length)
			return { label: isEn ? 'Partially verified' : 'Chỉ xác minh được một phần', tone: 'warn' };
		const tone = capabilityHealthOverallTone(capabilityHealth);
		if (tone === 'danger') return { label: isEn ? 'Action required' : 'Cần xử lý', tone };
		if (tone === 'warn') return { label: isEn ? 'Degraded' : 'Đang suy giảm', tone };
		if (tone === 'good')
			return { label: isEn ? 'Verified healthy' : 'Đã xác minh khỏe mạnh', tone };
		return {
			label: capabilityHealth.healthEnabled
				? isEn
					? 'Pending or manual review'
					: 'Chờ hoặc kiểm tra thủ công'
				: isEn
					? 'Monitoring disabled'
					: 'Giám sát đang tắt',
			tone: 'muted'
		};
	});

	let controlDialog = $state(null);
	let controlReason = $state('');
	let controlAcknowledged = $state(false);
	let controlBusy = $state('');
	let controlMessage = $state('');

	const t = $derived({
		title: isEn ? 'Blog OpenClaw Settings' : 'Lõi Blog OpenClaw',
		abbrev: 'BOS',
		subtitle: isEn
			? 'The internal control board of Blog OpenClaw. Normal operation happens on the Blog Scheduling page; this console is for administrators.'
			: 'Bo mạch điều khiển nội bộ của Blog OpenClaw. Vận hành hằng ngày dùng trang Lên lịch Blog; trang này dành cho quản trị viên.',
		backToScheduling: isEn ? '← Blog Scheduling' : '← Lên lịch Blog',
		overallState: isEn ? 'Overall state' : 'Trạng thái chung',
		lastSuccess: isEn ? 'Last successful run' : 'Lần chạy thành công gần nhất',
		nextRun: isEn ? 'Next execution' : 'Lần chạy kế tiếp',
		blocking: isEn ? 'Blocking / degraded' : 'Chặn / suy giảm',
		draftOnly: isEn ? 'Draft only' : 'Chỉ tạo bản nháp',
		on: isEn ? 'On' : 'Bật',
		off: isEn ? 'Off' : 'Tắt',
		none: isEn ? 'None' : 'Không có',
		never: isEn ? 'Not yet' : 'Chưa có',
		notScheduled: isEn ? 'Not scheduled' : 'Chưa xếp lịch',
		coreHealth: isEn ? 'Core health' : 'Sức khoẻ lõi',
		coreHealthHint: isEn
			? 'Gateway, agents, skills, capability probes.'
			: 'Gateway, agents, skills và kiểm tra năng lực.',
		schedulingEngine: isEn ? 'Scheduling engine' : 'Bộ máy lịch chạy',
		schedulingEngineHint: isEn
			? 'Persisted schedules, Mongo leases, execution ownership.'
			: 'Lịch đã lưu, Mongo lease và quyền sở hữu execution.',
		contentIntelligence: isEn ? 'Content intelligence' : 'Trí tuệ nội dung',
		contentIntelligenceHint: isEn
			? 'Inventory, opportunity scoring, work orders, briefs, research.'
			: 'Inventory, chấm điểm cơ hội, work order, brief và nghiên cứu.',
		qualityGates: isEn ? 'Quality gates & publishing safety' : 'Chốt chất lượng & an toàn xuất bản',
		qualityGatesHint: isEn
			? 'Audited runtime switches. Draft-only remains the production default.'
			: 'Các công tắc runtime có audit. Mặc định production vẫn là chỉ tạo bản nháp.',
		diagnostics: isEn ? 'Logs & diagnostics' : 'Nhật ký & chẩn đoán',
		diagnosticsHint: isEn
			? 'Deep consoles for operations history and QA fixtures.'
			: 'Console chuyên sâu cho lịch sử vận hành và QA.',
		openConsole: isEn ? 'Open OpenClaw console' : 'Mở console OpenClaw',
		openOperations: isEn ? 'Open Content Operations' : 'Mở trung tâm vận hành nội dung',
		openQa: isEn ? 'Open Agentic Blog QA' : 'Mở phòng QA Agentic Blog',
		openScheduling: isEn ? 'Open Blog Scheduling' : 'Mở trang Lên lịch Blog',
		gateway: 'OpenClaw gateway',
		gatewayReady: isEn ? 'Ready' : 'Sẵn sàng',
		gatewayStarting: isEn ? 'Starting' : 'Đang khởi động',
		gatewayDown: isEn ? 'Unavailable' : 'Không khả dụng',
		agents: 'Agents',
		skills: isEn ? 'Local skills' : 'Skills cục bộ',
		seoAgent: 'SEO agent',
		blogCron: 'Blog cron',
		autoPublish: isEn ? 'Auto publish' : 'Tự động publish',
		telegram: isEn ? 'Telegram approval' : 'Duyệt qua Telegram',
		publishMode: isEn ? 'Publishing mode' : 'Chế độ xuất bản',
		publishModeHint: isEn
			? 'Both publishing modes approve the article images for you.'
			: 'Cả hai chế độ xuất bản đều tự duyệt ảnh của bài cho bạn.',
		modeDraft: isEn ? 'Draft only' : 'Chỉ tạo bản nháp',
		modeDraftHint: isEn
			? 'Nothing goes live. You approve each image by hand.'
			: 'Không có gì lên web. Bạn tự duyệt từng ảnh.',
		modeTelegram: isEn ? 'Publish after Telegram approval' : 'Publish sau khi duyệt Telegram',
		modeTelegramHint: isEn
			? 'The bot sends each draft; approving it publishes the article.'
			: 'Bot gửi từng bản nháp; bạn bấm duyệt là bài lên web.',
		modeDirect: isEn ? 'Publish directly' : 'Publish thẳng',
		modeDirectHint: isEn
			? 'Articles go live with no one in between.'
			: 'Bài lên web luôn, không ai chặn ở giữa.',
		imagePipeline: isEn ? 'Image pipeline' : 'Pipeline ảnh',
		enabled: isEn ? 'Enabled' : 'Đang bật',
		disabled: isEn ? 'Disabled' : 'Tắt',
		optionalOff: isEn ? 'Optional feature disabled' : 'Tính năng tuỳ chọn đang tắt',
		unknown: isEn ? 'Not verified' : 'Chưa xác minh',
		partialLoad: isEn
			? 'Some status sources could not be verified. Unknown values are shown as “Not verified”, never as disabled.'
			: 'Một số nguồn trạng thái chưa thể xác minh. Giá trị chưa biết được hiển thị là “Chưa xác minh”, không bị coi nhầm là đang tắt.',
		missingConfig: isEn ? 'Missing config' : 'Thiếu cấu hình',
		schedulesEnabled: isEn ? 'Enabled schedules' : 'Lịch đang bật',
		schedulesTotal: isEn ? 'Total schedules' : 'Tổng số lịch',
		latestDecision: isEn ? 'Latest decision' : 'Quyết định gần nhất',
		latestRun: isEn ? 'Latest operations run' : 'Lượt vận hành gần nhất',
		scheduleName: isEn ? 'Schedule' : 'Lịch',
		scheduleResult: isEn ? 'Latest result' : 'Kết quả gần nhất',
		scheduleNext: isEn ? 'Next run' : 'Lần chạy kế tiếp',
		viewOnly: isEn ? 'View only' : 'Chỉ xem',
		controlHint: isEn
			? 'Protected runtime controls · changes are audited'
			: 'Điều khiển runtime có bảo vệ · mọi thay đổi đều được lưu audit',
		controlTitle: isEn ? 'Confirm runtime change' : 'Xác nhận thay đổi runtime',
		controlEnable: isEn ? 'Enable' : 'Bật',
		controlDisable: isEn ? 'Disable' : 'Tắt',
		controlReason: isEn ? 'Operational reason' : 'Lý do vận hành',
		controlReasonPlaceholder: isEn
			? 'Describe why this change is required (at least 10 characters).'
			: 'Mô tả lý do cần thay đổi (ít nhất 10 ký tự).',
		controlAcknowledge: isEn
			? 'I understand this changes the live backend runtime and is recorded in the audit log.'
			: 'Tôi hiểu thao tác này thay đổi runtime backend đang chạy và được ghi vào audit log.',
		controlReady: isEn ? 'Ready to enable' : 'Đủ điều kiện bật',
		controlBlocked: isEn ? 'Blocked by safety checks' : 'Đang bị chặn bởi chốt an toàn',
		controlSuccess: isEn
			? 'Runtime control updated successfully.'
			: 'Đã cập nhật công tắc runtime thành công.',
		controlNoPermission: isEn
			? 'Super Admin or the runtime-control permission is required.'
			: 'Cần quyền Super Admin hoặc quyền điều khiển runtime.',
		controlApply: isEn ? 'Apply change' : 'Áp dụng thay đổi',
		cancel: isEn ? 'Cancel' : 'Huỷ',
		controlRisk: {
			scheduled_writes: isEn
				? 'Enabling lets the scheduler claim due schedules and create real executions.'
				: 'Khi bật, scheduler có thể nhận lịch đến hạn và tạo execution thật.',
			public_publish: isEn
				? 'Enabling permits eligible, fully gated runs to publish publicly.'
				: 'Khi bật, lượt chạy đủ toàn bộ chốt có thể xuất bản công khai.',
			external_notification: isEn
				? 'Enabling permits approval messages to configured Telegram targets.'
				: 'Khi bật, hệ thống có thể gửi yêu cầu duyệt đến Telegram đã cấu hình.',
			paid_external_provider: isEn
				? 'Enabling permits external image providers and may incur cost.'
				: 'Khi bật, hệ thống có thể gọi nhà cung cấp ảnh bên ngoài và phát sinh chi phí.'
		},
		controlPrecondition: {
			seo_agent_enabled: isEn ? 'SEO Agent is enabled' : 'SEO Agent đang bật',
			enabled_schedule_exists: isEn
				? 'At least one production schedule is enabled'
				: 'Có ít nhất một lịch production đang bật',
			no_active_runs: isEn
				? 'No active execution or lease'
				: 'Không có execution hoặc lease đang chạy',
			publish_readiness_enabled: isEn
				? 'Publish-readiness gate is enabled'
				: 'Chốt sẵn sàng xuất bản đang bật',
			post_publish_verification_enabled: isEn
				? 'Post-publish verification is enabled'
				: 'Xác minh sau xuất bản đang bật',
			image_pipeline_enabled: isEn ? 'Image pipeline is enabled' : 'Pipeline ảnh đang bật',
			telegram_configured: isEn
				? 'Telegram token, allowlist, target and webhook are configured'
				: 'Telegram đã đủ token, allowlist, đích nhận và webhook',
			image_provider_configured: isEn
				? 'At least one image provider is configured'
				: 'Có ít nhất một nhà cung cấp ảnh đã cấu hình'
		}
	});
	const pageErrorText = $derived(
		pageError
			? openClawUiErrorText(pageError, {
					isEn,
					fallbackCode: 'OPENCLAW_CORE_LOAD_FAILED'
				})
			: ''
	);
	const requestErrorText = (value, fallbackCode = 'OPENCLAW_REQUEST_FAILED') =>
		openClawUiErrorText(value, { isEn, fallbackCode });

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com') {
			return path;
		}
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
	};

	const telegramStatus = $derived.by(() => {
		const telegram = dashboard?.telegram || {};
		const complete = Boolean(
			telegram.tokenConfigured &&
			telegram.webhookSecretConfigured &&
			telegram.allowlistConfigured &&
			telegram.adminBaseUrlConfigured
		);
		if (telegramApprovalEnabled && !complete) return t.missingConfig;
		if (!telegramApprovalEnabled) return t.optionalOff;
		return t.enabled;
	});

	const runtimeControlLabel = (controlKey) =>
		({
			blog_cron: t.blogCron,
			auto_publish: t.autoPublish,
			telegram_approval: t.telegram,
			image_pipeline: t.imagePipeline
		})[controlKey] || controlKey;

	const createControlIdempotencyKey = () =>
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? `runtime-${crypto.randomUUID()}`
			: `runtime-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;

	const applyRuntimeControlState = (payload) => {
		runtimeControls = payload && typeof payload === 'object' ? payload : {};
	};

	const refreshRuntimeControls = async () => {
		const response = await fetch(resolveAdminPath('/admin/api/openclaw/runtime-controls'));
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			throw normalizeOpenClawUiError(payload, 'OPENCLAW_RUNTIME_CONTROL_FAILED', response.headers);
		}
		applyRuntimeControlState(payload);
		return payload;
	};

	const openRuntimeControlDialog = (controlKey) => {
		controlMessage = '';
		const control = runtimeControlMap[controlKey];
		if (!control) {
			controlMessage = isEn
				? 'Runtime control status is unavailable.'
				: 'Chưa tải được trạng thái công tắc runtime.';
			return;
		}
		if (!canManageRuntimeControls) {
			controlMessage = t.controlNoPermission;
			return;
		}
		controlDialog = { ...control, targetEnabled: control.enabled !== true };
		controlReason = '';
		controlAcknowledged = false;
	};

	const closeRuntimeControlDialog = () => {
		if (controlBusy) return;
		controlDialog = null;
		controlReason = '';
		controlAcknowledged = false;
	};

	const submitRuntimeControl = async () => {
		if (!controlDialog || controlBusy) return;
		const reason = controlReason.trim();
		if (reason.length < 10 || !controlAcknowledged) return;
		if (controlDialog.targetEnabled && controlDialog.readyToEnable !== true) return;
		const controlKey = controlDialog.controlKey;
		controlBusy = controlKey;
		controlMessage = '';
		const activityKey = `bos-runtime:${controlKey}:${Date.now()}`;
		openClawActivityStore.upsert({
			key: activityKey,
			domain: 'bos-runtime',
			entityId: controlKey,
			action: controlDialog.targetEnabled ? 'enable' : 'disable',
			title: runtimeControlLabel(controlKey),
			status: 'running',
			message: isEn ? 'Updating runtime control…' : 'Đang cập nhật công tắc runtime…'
		});
		try {
			const response = await fetch(
				resolveAdminPath(`/admin/api/openclaw/runtime-controls/${encodeURIComponent(controlKey)}`),
				{
					method: 'PATCH',
					headers: {
						'content-type': 'application/json',
						'Idempotency-Key': createControlIdempotencyKey()
					},
					body: JSON.stringify({
						enabled: controlDialog.targetEnabled,
						expectedRevision: Number(controlDialog.revision || 0),
						reason,
						acknowledgement: controlDialog.acknowledgement
					})
				}
			);
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				if (response.status === 409) await refreshRuntimeControls().catch(() => null);
				throw normalizeOpenClawUiError(
					payload,
					'OPENCLAW_RUNTIME_CONTROL_FAILED',
					response.headers
				);
			}
			applyRuntimeControlState(payload);
			controlDialog = null;
			controlReason = '';
			controlAcknowledged = false;
			controlMessage = t.controlSuccess;
			openClawActivityStore.upsert({
				key: activityKey,
				status: 'succeeded',
				rawStatus: 'completed',
				message: t.controlSuccess
			});
		} catch (error) {
			controlMessage = requestErrorText(error, 'OPENCLAW_RUNTIME_CONTROL_FAILED');
			openClawActivityStore.upsert({
				key: activityKey,
				status: 'failed',
				rawStatus: 'failed',
				message: controlMessage
			});
		} finally {
			controlBusy = '';
		}
	};

	const handleCapabilityUpdate = (nextHealth) => {
		capabilityHealth = normalizeCapabilityHealth(nextHealth || {});
	};

	const formatDateTime = (value) => dateTimeInVietnam(value, isEn ? 'en-GB' : 'vi-VN') || '--';

	const sourceFreshness = $derived(contentOperations?.sourceFreshness || {});
	const latestRun = $derived(contentOperations?.latestRun || {});
</script>

<svelte:head>
	<title>{t.title} (BOS) · INOXPRAN Admin</title>
</svelte:head>

<section class="bos-page">
	<header class="bos-header">
		<div>
			<p class="bos-eyebrow">{t.abbrev} · BLOG OPENCLAW SETTINGS</p>
			<h1>{t.title}</h1>
			<p class="bos-subtitle">{t.subtitle}</p>
		</div>
		<a class="bos-back" href={resolve(resolveAdminPath('/admin/openclaw/blogs'))}>
			{t.backToScheduling}
		</a>
	</header>

	{#if pageErrorText}
		<div class="bos-alert" role="alert">{pageErrorText}</div>
	{/if}
	{#if unavailableResources.length && !pageErrorText}
		<div class="bos-alert bos-alert--warning" role="status">
			{t.partialLoad}
			<small>{unavailableResources.join(' · ')}</small>
		</div>
	{/if}

	<div class="bos-summary" role="list">
		<div class="bos-summary__item" role="listitem">
			<span>{t.overallState}</span>
			<b class="bos-state bos-state--{overallState.tone}">{overallState.label}</b>
		</div>
		<div class="bos-summary__item" role="listitem">
			<span>{t.lastSuccess}</span>
			<b>{schedulesKnown && executionHistoryKnown ? (lastSuccessfulRun ? formatDateTime(lastSuccessfulRun) : t.never) : t.unknown}</b>
		</div>
		<div class="bos-summary__item" role="listitem">
			<span>{t.nextRun}</span>
			<b>{schedulesKnown ? (nextRunAt ? formatDateTime(nextRunAt) : t.notScheduled) : t.unknown}</b>
		</div>
		<div class="bos-summary__item" role="listitem">
			<span>{t.blocking}</span>
			<b
				class="bos-state bos-state--{blockingIssues ? 'danger' : degradedIssues ? 'warn' : 'muted'}"
			>
				{blockingIssues ? `${blockingIssues} ${isEn ? 'blocking' : 'chặn'}` : ''}{blockingIssues &&
				degradedIssues
					? ' · '
					: ''}{degradedIssues
					? `${degradedIssues} ${isEn ? 'degraded' : 'suy giảm'}`
					: ''}{!blockingIssues && !degradedIssues ? t.none : ''}
			</b>
		</div>
		<div class="bos-summary__item" role="listitem">
			<span>{t.draftOnly}</span>
			<b class="bos-state bos-state--{autoPublishEnabled ? 'danger' : 'good'}">
				{autoPublishEnabled ? t.off : t.on}
			</b>
		</div>
	</div>

	<details class="bos-group">
		<summary>
			<span class="bos-group__title">{t.coreHealth}</span>
			<span class="bos-group__hint">{t.coreHealthHint}</span>
		</summary>
		<div class="bos-group__body">
			<div class="bos-facts">
				<div class="bos-facts__item">
					<span>{t.gateway}</span>
					<b
						class="bos-state"
						class:bos-state--good={capabilityTone(gatewayCapability) === 'good'}
						class:bos-state--warn={capabilityTone(gatewayCapability) === 'warn'}
						class:bos-state--danger={capabilityTone(gatewayCapability) === 'danger'}
						class:bos-state--muted={capabilityTone(gatewayCapability) === 'muted'}
					>
						{gatewayCapability.status === 'healthy'
							? t.gatewayReady
							: gatewayCapability.status === 'degraded'
								? t.gatewayStarting
								: gatewayCapability.status === 'failed' ||
									  gatewayCapability.status === 'unavailable' ||
									  gatewayCapability.status === 'missing_config'
									? t.gatewayDown
									: isEn
										? 'Pending verification'
										: 'Chờ xác minh'}
					</b>
				</div>
				<div class="bos-facts__item">
					<span>{t.agents}</span>
					<b>{Array.isArray(dashboard?.agents) ? dashboard.agents.length : '--'}</b>
				</div>
				<div class="bos-facts__item">
					<span>{t.skills}</span>
					<b>{Array.isArray(dashboard?.localSkills) ? dashboard.localSkills.length : '--'}</b>
				</div>
			</div>
			<CapabilityHealthPanel health={capabilityHealth} onUpdated={handleCapabilityUpdate} />
			<a
				class="bos-link"
				href={resolve(resolveAdminPath('/admin/openclaw/blogs/settings/console'))}
			>
				{t.openConsole} →
			</a>
		</div>
	</details>

	<details class="bos-group">
		<summary>
			<span class="bos-group__title">{t.schedulingEngine}</span>
			<span class="bos-group__hint">{t.schedulingEngineHint}</span>
		</summary>
		<div class="bos-group__body">
			<div class="bos-facts">
				<div class="bos-facts__item">
					<span>{t.schedulesEnabled}</span>
					<b>{schedulesKnown ? enabledSchedules.length : t.unknown}</b>
				</div>
				<div class="bos-facts__item">
					<span>{t.schedulesTotal}</span>
					<b>{schedulesKnown ? schedules.length : t.unknown}</b>
				</div>
				<div class="bos-facts__item">
					<span>{t.blogCron}</span>
					<b class="bos-state bos-state--{runtimeControlsKnown && blogCronEnabled ? 'good' : 'muted'}">
						{runtimeControlsKnown ? (blogCronEnabled ? t.enabled : t.disabled) : t.unknown}
					</b>
				</div>
			</div>
			{#if schedulesKnown && schedules.length}
				<div class="bos-table-wrap">
					<table class="bos-table">
						<thead>
							<tr>
								<th>{t.scheduleName}</th>
								<th>{t.scheduleResult}</th>
								<th>{t.scheduleNext}</th>
							</tr>
						</thead>
						<tbody>
							{#each schedules as schedule (schedule.id)}
								<tr>
									<td>{schedule.name}</td>
									<td>{simpleResultLabel(schedule.lastRunStatus, isEn)}</td>
									<td>
										{schedule.enabled && schedule.nextRunAt
											? formatDateTime(schedule.nextRunAt)
											: t.notScheduled}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			<a class="bos-link" href={resolve(resolveAdminPath('/admin/openclaw/blogs'))}>
				{t.openScheduling} →
			</a>
		</div>
	</details>

	<details class="bos-group">
		<summary>
			<span class="bos-group__title">{t.contentIntelligence}</span>
			<span class="bos-group__hint">{t.contentIntelligenceHint}</span>
		</summary>
		<div class="bos-group__body">
			<div class="bos-facts">
				{#if latestRun?.selectedDecision}
					<div class="bos-facts__item">
						<span>{t.latestDecision}</span>
						<b><code>{latestRun.selectedDecision}</code></b>
					</div>
				{/if}
				{#if latestRun?.completedAt || latestRun?.createdAt}
					<div class="bos-facts__item">
						<span>{t.latestRun}</span>
						<b>{formatDateTime(latestRun.completedAt || latestRun.createdAt)}</b>
					</div>
				{/if}
				{#each Object.entries(sourceFreshness).slice(0, 4) as [sourceKey, freshness] (sourceKey)}
					<div class="bos-facts__item">
						<span><code>{sourceKey}</code></span>
						<b>{typeof freshness === 'string' ? freshness : (freshness?.status ?? '--')}</b>
					</div>
				{/each}
			</div>
			<a
				class="bos-link"
				href={resolve(resolveAdminPath('/admin/openclaw/blogs/settings/operations'))}
			>
				{t.openOperations} →
			</a>
		</div>
	</details>

	<details class="bos-group">
		<summary>
			<span class="bos-group__title">{t.qualityGates}</span>
			<span class="bos-group__hint">{t.qualityGatesHint}</span>
		</summary>
		<div class="bos-group__body">
			<div class="bos-controls">
				<p class="bos-controls__hint">
					{t.controlHint}
					{#if !canManageRuntimeControls}
						· <em>{t.viewOnly}</em>
					{/if}
				</p>
				<div class="bos-controls__row">
					<span>{t.seoAgent}</span>
					<b class="bos-state bos-state--{automation.enabled ? 'good' : 'muted'}">
						{automation.enabled ? t.enabled : t.disabled}
					</b>
				</div>
				<div class="bos-controls__row">
					<span>{t.blogCron}</span>
					<button
						type="button"
						class="bos-toggle"
						class:is-on={blogCronEnabled}
						role="switch"
						aria-checked={blogCronEnabled}
						aria-label={`${blogCronEnabled ? t.controlDisable : t.controlEnable} ${t.blogCron}`}
						disabled={!canManageRuntimeControls || Boolean(controlBusy)}
						onclick={() => openRuntimeControlDialog('blog_cron')}
					>
						<span>{blogCronEnabled ? t.enabled : t.disabled}</span>
						<span class="bos-toggle__track"><span></span></span>
					</button>
				</div>
				<div class="bos-controls__mode" role="radiogroup" aria-label={t.publishMode}>
					<p class="bos-controls__mode-title">{t.publishMode}</p>
					<p class="bos-controls__mode-hint">{t.publishModeHint}</p>
					{#each [{ id: 'draft', label: t.modeDraft, hint: t.modeDraftHint }, { id: 'telegram', label: t.modeTelegram, hint: t.modeTelegramHint }, { id: 'direct', label: t.modeDirect, hint: t.modeDirectHint }] as mode (mode.id)}
						<button
							type="button"
							class="bos-mode"
							class:is-active={publishMode === mode.id}
							class:is-critical={mode.id === 'direct'}
							role="radio"
							aria-checked={publishMode === mode.id}
							disabled={!canManageRuntimeControls ||
								Boolean(controlBusy) ||
								publishModeControl(mode.id) === null}
							onclick={() => {
								const controlKey = publishModeControl(mode.id);
								if (controlKey) openRuntimeControlDialog(controlKey);
							}}
						>
							<span class="bos-mode__label">{mode.label}</span>
							<span class="bos-mode__hint">{mode.hint}</span>
						</button>
					{/each}
					<p class="bos-controls__mode-state">{t.telegram}: {telegramStatus}</p>
				</div>
				<div class="bos-controls__row">
					<span>{t.imagePipeline}</span>
					<button
						type="button"
						class="bos-toggle"
						class:is-on={imagePipelineEnabled}
						role="switch"
						aria-checked={imagePipelineEnabled}
						aria-label={`${imagePipelineEnabled ? t.controlDisable : t.controlEnable} ${t.imagePipeline}`}
						disabled={!canManageRuntimeControls || Boolean(controlBusy)}
						onclick={() => openRuntimeControlDialog('image_pipeline')}
					>
						<span>{imagePipelineEnabled ? t.enabled : t.optionalOff}</span>
						<span class="bos-toggle__track"><span></span></span>
					</button>
				</div>
				{#if controlMessage}
					<p class="bos-controls__message" aria-live="polite">{controlMessage}</p>
				{/if}
			</div>
		</div>
	</details>

	<details class="bos-group">
		<summary>
			<span class="bos-group__title">{t.diagnostics}</span>
			<span class="bos-group__hint">{t.diagnosticsHint}</span>
		</summary>
		<div class="bos-group__body">
			<div class="bos-links">
				<a
					class="bos-link"
					href={resolve(resolveAdminPath('/admin/openclaw/blogs/settings/console'))}
				>
					{t.openConsole} →
				</a>
				<a
					class="bos-link"
					href={resolve(resolveAdminPath('/admin/openclaw/blogs/settings/operations'))}
				>
					{t.openOperations} →
				</a>
				<a
					class="bos-link"
					href={resolve(resolveAdminPath('/admin/openclaw/blogs/settings/operations/qa'))}
				>
					{t.openQa} →
				</a>
			</div>
		</div>
	</details>
</section>

{#if controlDialog}
	<div
		class="dd-modal"
		role="button"
		tabindex="0"
		aria-label={t.cancel}
		onclick={(event) => {
			if (event.target === event.currentTarget) closeRuntimeControlDialog();
		}}
		onkeydown={(event) => {
			if (event.key === 'Escape') closeRuntimeControlDialog();
		}}
	>
		<div
			class="dd-modal__box dd-control-modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="runtime-control-title"
		>
			<div class="dd-control-modal__heading">
				<div>
					<p class="bos-eyebrow">LIVE RUNTIME / AUDITED</p>
					<h3 id="runtime-control-title">{t.controlTitle}</h3>
				</div>
				<span
					class="dd-control-modal__intent"
					class:is-enable={controlDialog.targetEnabled}
					class:is-disable={!controlDialog.targetEnabled}
				>
					{controlDialog.targetEnabled ? t.controlEnable : t.controlDisable}
				</span>
			</div>

			<div class="dd-control-modal__target">
				<span>{runtimeControlLabel(controlDialog.controlKey)}</span>
				<code>{controlDialog.envKey}</code>
			</div>

			<div
				class="dd-control-modal__risk"
				class:is-critical={controlDialog.risk === 'public_publish'}
			>
				{t.controlRisk[controlDialog.risk] || controlDialog.risk}
			</div>

			{#if controlDialog.targetEnabled}
				<div class="dd-control-checks">
					<div class="dd-control-checks__head">
						<strong>{controlDialog.readyToEnable ? t.controlReady : t.controlBlocked}</strong>
						<span
							>{controlDialog.preconditions?.filter((check) => check.pass).length ||
								0}/{controlDialog.preconditions?.length || 0}</span
						>
					</div>
					<ul>
						{#each controlDialog.preconditions || [] as check (check.key)}
							<li class:is-pass={check.pass} class:is-fail={!check.pass}>
								<span aria-hidden="true">{check.pass ? '✓' : '!'}</span>
								{t.controlPrecondition[check.key] || check.key}
								{#if Number.isFinite(Number(check.value))}
									<small>({check.value})</small>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<p class="dd-control-modal__disable-note">
					{isEn
						? 'Disabling applies to subsequent runtime decisions and does not cancel an execution already in progress.'
						: 'Tắt áp dụng cho các quyết định runtime tiếp theo và không hủy execution đã bắt đầu.'}
				</p>
			{/if}

			<label class="dd-control-reason">
				<span>{t.controlReason}</span>
				<textarea
					rows="3"
					maxlength="500"
					bind:value={controlReason}
					placeholder={t.controlReasonPlaceholder}
				></textarea>
				<small>{controlReason.trim().length}/500</small>
			</label>

			<label class="dd-control-ack">
				<input type="checkbox" bind:checked={controlAcknowledged} />
				<span>{t.controlAcknowledge}</span>
			</label>

			<div class="dd-modal__actions">
				<button
					type="button"
					class="bos-btn bos-btn--ghost"
					onclick={closeRuntimeControlDialog}
					disabled={Boolean(controlBusy)}>{t.cancel}</button
				>
				<button
					type="button"
					class="bos-btn"
					class:bos-btn--primary={controlDialog.risk !== 'public_publish'}
					class:bos-btn--danger={controlDialog.risk === 'public_publish'}
					onclick={submitRuntimeControl}
					disabled={Boolean(controlBusy) ||
						controlReason.trim().length < 10 ||
						!controlAcknowledged ||
						(controlDialog.targetEnabled && controlDialog.readyToEnable !== true)}
				>
					{controlBusy ? (isEn ? 'Applying…' : 'Đang áp dụng…') : t.controlApply}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.bos-page {
		display: grid;
		gap: 16px;
		color: var(--admin-ink, #1a1f2e);
	}

	.bos-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.bos-eyebrow {
		margin: 0 0 6px;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--admin-accent, #0f766e);
	}

	.bos-header h1 {
		margin: 0 0 6px;
		font-size: 1.4rem;
	}

	.bos-subtitle {
		margin: 0;
		max-width: 640px;
		color: var(--admin-muted, #6b7280);
	}

	.bos-back {
		font-size: 0.85rem;
		color: var(--admin-muted, #6b7280);
		text-decoration: none;
		border: 1px solid var(--admin-border, #e5e7eb);
		border-radius: 999px;
		padding: 6px 12px;
		white-space: nowrap;
	}

	.bos-back:hover {
		color: var(--admin-accent, #0f766e);
		border-color: var(--admin-accent, #0f766e);
	}

	.bos-alert {
		border: 1px solid var(--admin-danger, #dc2626);
		background: rgba(220, 38, 38, 0.06);
		color: var(--admin-danger, #dc2626);
		border-radius: var(--admin-radius, 12px);
		padding: 10px 14px;
	}

	.bos-alert--warning {
		border-color: #d29a35;
		background: #fff9eb;
		color: #75520f;
	}

	.bos-alert small {
		display: block;
		margin-top: 4px;
		opacity: 0.78;
	}

	.bos-summary {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 10px;
	}

	.bos-summary__item {
		background: var(--admin-surface, #ffffff);
		border: 1px solid var(--admin-border, #e5e7eb);
		border-radius: var(--admin-radius, 12px);
		padding: 12px 14px;
		display: grid;
		gap: 6px;
	}

	.bos-summary__item > span {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--admin-muted, #6b7280);
	}

	.bos-state {
		font-size: 0.92rem;
	}

	.bos-state--good {
		color: #047857;
	}

	.bos-state--danger {
		color: var(--admin-danger, #dc2626);
	}

	.bos-state--warn {
		color: var(--admin-warning, #b45309);
	}

	.bos-state--muted {
		color: var(--admin-muted, #6b7280);
	}

	.bos-group {
		background: var(--admin-surface, #ffffff);
		border: 1px solid var(--admin-border, #e5e7eb);
		border-radius: var(--admin-radius, 12px);
	}

	.bos-group summary {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 10px;
		padding: 14px 16px;
		cursor: pointer;
		list-style: none;
	}

	.bos-group summary::-webkit-details-marker {
		display: none;
	}

	.bos-group summary::before {
		content: '▸';
		color: var(--admin-muted, #6b7280);
		font-size: 0.8rem;
	}

	.bos-group[open] summary::before {
		content: '▾';
	}

	.bos-group__title {
		font-weight: 700;
	}

	.bos-group__hint {
		color: var(--admin-muted, #6b7280);
		font-size: 0.8rem;
	}

	.bos-group__body {
		border-top: 1px solid var(--admin-border, #e5e7eb);
		padding: 14px 16px 16px;
		display: grid;
		gap: 14px;
	}

	.bos-facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 10px;
	}

	.bos-facts__item {
		display: grid;
		gap: 4px;
		border: 1px solid var(--admin-border, #e5e7eb);
		border-radius: 10px;
		padding: 10px 12px;
	}

	.bos-facts__item > span {
		font-size: 0.72rem;
		color: var(--admin-muted, #6b7280);
	}

	.bos-table-wrap {
		overflow-x: auto;
	}

	.bos-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.bos-table th,
	.bos-table td {
		text-align: left;
		padding: 8px 10px;
		border-bottom: 1px solid var(--admin-border, #e5e7eb);
	}

	.bos-table th {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--admin-muted, #6b7280);
	}

	.bos-link {
		color: var(--admin-accent, #0f766e);
		font-size: 0.88rem;
		text-decoration: none;
		width: fit-content;
	}

	.bos-link:hover {
		text-decoration: underline;
	}

	.bos-links {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
	}

	.bos-controls {
		display: grid;
		gap: 0;
	}

	.bos-controls__hint {
		margin: 0 0 8px;
		color: var(--admin-muted, #6b7280);
		font-size: 0.75rem;
	}

	.bos-controls__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid rgba(17, 24, 39, 0.07);
	}

	.bos-controls__row:last-of-type {
		border-bottom: 0;
	}

	.bos-controls__mode {
		display: grid;
		gap: 8px;
		padding: 14px 0;
		border-bottom: 1px solid rgba(17, 24, 39, 0.07);
	}

	.bos-controls__mode-title {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--admin-text, #111827);
	}

	.bos-controls__mode-hint,
	.bos-controls__mode-state {
		margin: 0;
		font-size: 0.78rem;
		color: var(--admin-muted, #6b7280);
	}

	.bos-mode {
		display: grid;
		gap: 2px;
		width: 100%;
		padding: 10px 12px;
		text-align: left;
		border: 1px solid rgba(17, 24, 39, 0.14);
		border-radius: 10px;
		background: transparent;
		cursor: pointer;
	}

	.bos-mode:disabled {
		cursor: default;
	}

	.bos-mode.is-active {
		border-color: #0f766e;
		background: rgba(15, 118, 110, 0.08);
	}

	.bos-mode.is-active.is-critical {
		border-color: #b91c1c;
		background: rgba(185, 28, 28, 0.08);
	}

	.bos-mode__label {
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--admin-text, #111827);
	}

	.bos-mode__hint {
		font-size: 0.76rem;
		color: var(--admin-muted, #6b7280);
	}

	.bos-controls__row > span {
		color: var(--admin-muted, #6b7280);
		font-size: 0.85rem;
	}

	.bos-controls__message {
		margin: 12px 0 0;
		padding: 9px 10px;
		border: 1px solid rgba(15, 118, 110, 0.18);
		border-radius: 8px;
		background: var(--admin-accent-soft, rgba(15, 118, 110, 0.08));
		color: var(--admin-accent-strong, #065f5a);
		font-size: 0.78rem;
	}

	.bos-toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 30px;
		padding: 3px 5px 3px 10px;
		border: 1px solid rgba(107, 114, 128, 0.2);
		border-radius: 999px;
		background: rgba(107, 114, 128, 0.08);
		color: #4b5563;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 750;
		cursor: pointer;
	}

	.bos-toggle:disabled {
		cursor: not-allowed;
		opacity: 0.62;
	}

	.bos-toggle.is-on {
		border-color: rgba(5, 150, 105, 0.28);
		background: rgba(5, 150, 105, 0.1);
		color: #047857;
	}

	.bos-toggle.is-critical {
		border-color: rgba(217, 119, 6, 0.34);
		background: rgba(217, 119, 6, 0.1);
		color: #a74f05;
	}

	.bos-toggle__track {
		position: relative;
		width: 30px;
		height: 18px;
		flex: 0 0 auto;
		border-radius: 999px;
		background: #cbd0d8;
		box-shadow: inset 0 0 0 1px rgba(17, 24, 39, 0.08);
	}

	.bos-toggle__track span {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.3);
		transition: transform 0.18s ease;
	}

	.bos-toggle.is-on .bos-toggle__track {
		background: var(--admin-accent, #0f766e);
	}

	.bos-toggle.is-critical .bos-toggle__track {
		background: var(--admin-warning, #d97706);
	}

	.bos-toggle.is-on .bos-toggle__track span {
		transform: translateX(12px);
	}

	.bos-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 40px;
		padding: 0 18px;
		border-radius: 10px;
		border: 1px solid transparent;
		font: inherit;
		font-weight: 600;
		font-size: 0.88rem;
		cursor: pointer;
	}

	.bos-btn--primary {
		background: var(--oc-primary, #0f766e);
		border-color: var(--oc-primary, #0f766e);
		color: #fff;
	}

	.bos-btn--ghost {
		background: var(--oc-surface, #ffffff);
		border-color: var(--oc-border, #e5e7eb);
		color: var(--oc-text, #1a1f2e);
	}

	.bos-btn--danger {
		background: #b42318;
		border-color: #b42318;
		color: #fff;
	}

	.bos-btn:disabled {
		opacity: 0.62;
		cursor: wait;
	}

	/* ── Modal ── */
	.dd-modal {
		/*
		 * Dialogs are rendered next to .bos-page, not inside it.
		 * Own the theme tokens here so the dialog surface cannot become
		 * transparent when a var() declaration has no inherited value.
		 */
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
		position: fixed;
		inset: 0;
		z-index: 1900;
		display: grid;
		place-items: center;
		padding: 1rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: rgba(15, 23, 42, 0.5);
		color: var(--oc-text, #1a1f2e);
		isolation: isolate;
	}

	.dd-modal__box {
		position: relative;
		z-index: 1;
		width: min(560px, 100%);
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		background: var(--oc-surface, #ffffff);
		color: var(--oc-text, #1a1f2e);
		border-radius: var(--oc-radius);
		border: 1px solid var(--oc-border);
		padding: 22px;
		display: grid;
		gap: 12px;
		box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
		pointer-events: auto;
	}

	.dd-modal__box h3 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 700;
	}

	.dd-modal__actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 4px;
	}

	.dd-control-modal {
		width: min(620px, 100%);
		gap: 14px;
	}

	.dd-control-modal__heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	.dd-control-modal__intent {
		padding: 5px 10px;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}

	.dd-control-modal__intent.is-enable {
		background: rgba(5, 150, 105, 0.12);
		color: #047857;
	}

	.dd-control-modal__intent.is-disable {
		background: rgba(107, 114, 128, 0.12);
		color: #4b5563;
	}

	.dd-control-modal__target {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface-2);
	}

	.dd-control-modal__target span {
		font-weight: 750;
	}

	.dd-control-modal__target code {
		overflow-wrap: anywhere;
		color: var(--oc-muted);
		font-size: 0.7rem;
		text-align: right;
	}

	.dd-control-modal__risk,
	.dd-control-modal__disable-note {
		margin: 0;
		padding: 11px 13px;
		border: 1px solid rgba(217, 119, 6, 0.24);
		border-radius: var(--oc-radius-sm);
		background: rgba(217, 119, 6, 0.07);
		color: #9a5a08;
		font-size: 0.8rem;
		line-height: 1.5;
	}

	.dd-control-modal__risk.is-critical {
		border-color: rgba(180, 35, 24, 0.28);
		background: rgba(180, 35, 24, 0.07);
		color: #9f2117;
	}

	.dd-control-modal__disable-note {
		border-color: rgba(107, 114, 128, 0.2);
		background: rgba(107, 114, 128, 0.06);
		color: #4b5563;
	}

	.dd-control-checks {
		overflow: hidden;
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius-sm);
	}

	.dd-control-checks__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 9px 12px;
		border-bottom: 1px solid var(--oc-border);
		background: var(--oc-surface-2);
		font-size: 0.78rem;
	}

	.dd-control-checks__head span {
		color: var(--oc-muted);
		font-variant-numeric: tabular-nums;
	}

	.dd-control-checks ul {
		display: grid;
		gap: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.dd-control-checks li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--oc-border-soft);
		color: #9f2117;
		font-size: 0.76rem;
	}

	.dd-control-checks li:last-child {
		border-bottom: 0;
	}

	.dd-control-checks li > span {
		display: inline-grid;
		width: 18px;
		height: 18px;
		place-items: center;
		flex: 0 0 auto;
		border-radius: 50%;
		background: rgba(180, 35, 24, 0.1);
		font-weight: 900;
	}

	.dd-control-checks li.is-pass {
		color: #047857;
	}

	.dd-control-checks li.is-pass > span {
		background: rgba(5, 150, 105, 0.12);
	}

	.dd-control-checks li small {
		margin-left: auto;
		color: inherit;
		font-variant-numeric: tabular-nums;
	}

	.dd-control-reason {
		position: relative;
		display: grid;
		gap: 6px;
		color: var(--oc-text);
		font-size: 0.78rem;
		font-weight: 700;
	}

	.dd-control-reason textarea {
		width: 100%;
		resize: vertical;
		min-height: 88px;
		padding: 10px 12px 22px;
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface);
		color: var(--oc-text);
		font: inherit;
		font-size: 0.82rem;
		line-height: 1.5;
	}

	.dd-control-reason small {
		position: absolute;
		right: 9px;
		bottom: 7px;
		color: var(--oc-muted);
		font-size: 0.66rem;
		font-weight: 500;
	}

	.dd-control-ack {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 10px 12px;
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface-2);
		color: #4b5563;
		font-size: 0.75rem;
		line-height: 1.45;
		cursor: pointer;
	}

	.dd-control-ack input {
		width: 16px;
		height: 16px;
		margin: 1px 0 0;
		accent-color: var(--oc-primary);
	}

	@media (max-width: 640px) {
		.dd-control-modal__heading,
		.dd-control-modal__target {
			align-items: flex-start;
			flex-direction: column;
		}

		.dd-control-modal__target code {
			text-align: left;
		}

		.dd-modal__actions .bos-btn {
			flex: 1 1 auto;
		}
	}
</style>
