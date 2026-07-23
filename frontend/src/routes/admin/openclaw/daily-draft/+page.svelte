<script>
	import { resolve } from '$app/paths';
	import { onDestroy } from 'svelte';
	import { locale } from '$lib/i18n/admin/index.js';
	import {
		decisionArtifactContext,
		entityId,
		normalizePreview
	} from '$lib/contentOperations/contracts.js';
	import {
		dailyDraftStatusLabel,
		isDailyDraftRunActive,
		isDailyDraftRunFailed,
		isDailyDraftRunSuccessful,
		normalizeDailyDraftExecution,
		selectDefaultDailyDraftSchedule,
		selectQueuedDailyDraftExecution
	} from '$lib/openclaw/dailyDraft.js';
	import BlogSchedulesPanel from '$lib/components/admin/openclaw/BlogSchedulesPanel.svelte';

	let { data } = $props();

	const isEn = $derived($locale === 'en');

	// svelte-ignore state_referenced_locally
	let dashboard = $state(data?.dashboard || {});
	// svelte-ignore state_referenced_locally
	let pageError = $state(data?.loadError || '');
	// svelte-ignore state_referenced_locally
	let contentOperations = $state(data?.contentOperations || {});
	// svelte-ignore state_referenced_locally
	let runtimeControls = $state(data?.runtimeControls || {});
	let operationsPreview = $state(null);
	let operationsBusy = $state('');
	let operationsMessage = $state('');

	const automation = $derived(dashboard?.automation || {});
	const scheduleData = $derived(data?.schedules || {});
	// svelte-ignore state_referenced_locally
	let scheduleRuntimeState = $state(scheduleData?.runtime || {});
	const scheduleRuntime = $derived(scheduleRuntimeState);
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
	const initialSchedules = $derived(
		Array.isArray(scheduleData?.schedules) ? scheduleData.schedules : []
	);
	// svelte-ignore state_referenced_locally
	let runSchedules = $state(
		Array.isArray(scheduleData?.schedules) ? [...scheduleData.schedules] : []
	);
	// svelte-ignore state_referenced_locally
	let selectedRunScheduleId = $state(selectDefaultDailyDraftSchedule(runSchedules)?.id || '');
	const selectedRunSchedule = $derived(
		selectDefaultDailyDraftSchedule(runSchedules, selectedRunScheduleId)
	);
	const enabledScheduleCount = $derived(
		runSchedules.filter((schedule) => schedule?.enabled).length
	);
	const gatewayHealth = $derived(dashboard?.openclaw?.health || {});
	const operationsStatus = $derived(contentOperations?.status || contentOperations || {});
	const latestOperationsRun = $derived(operationsStatus?.latestRun || {});
	const latestRunDecision = $derived.by(() => {
		const candidates = Array.isArray(latestOperationsRun?.candidates)
			? latestOperationsRun.candidates
			: [];
		const selectedOpportunity = candidates.find(
			(candidate) =>
				(candidate?.recommendedAction || candidate?.decisionType) ===
				latestOperationsRun?.selectedDecision
		);
		return normalizePreview({
			...latestOperationsRun,
			dryRun: latestOperationsRun?.trigger === 'preview',
			action: latestOperationsRun?.selectedDecision,
			selectedOpportunity
		});
	});
	const operationsDecision = $derived(operationsPreview || latestRunDecision);
	const operationsSchedule = $derived(operationsStatus?.schedule || {});
	const operationsArtifactContext = $derived(
		decisionArtifactContext(operationsDecision, operationsStatus?.activeWorkOrder)
	);
	const operationsWorkOrderId = $derived(operationsArtifactContext.workOrderId);
	const operationsDecisionId = $derived(operationsArtifactContext.decisionId);
	const hasRunnableSelection = $derived(operationsArtifactContext.runnable);
	const canPersistPreview = $derived(
		Boolean(
			operationsPreview &&
			operationsPreview.dryRun !== false &&
			!entityId(operationsPreview.workOrderId) &&
			operationsPreview.action !== 'skip' &&
			operationsPreview.blocked !== true
		)
	);

	let confirmOpen = $state(false);
	let openingConfirmation = $state(false);
	let running = $state(false);
	let activeRun = $state(null);
	let runError = $state('');
	let pollTimer = null;
	let pollStartedAt = 0;
	let pollInFlight = false;
	let runIdempotency = $state({ scheduleId: '', key: '' });
	let controlDialog = $state(null);
	let controlReason = $state('');
	let controlAcknowledged = $state(false);
	let controlBusy = $state('');
	let controlMessage = $state('');

	const createIdempotencyKey = () =>
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: `daily-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

	const idempotencyKeyForSchedule = (scheduleId) => {
		if (runIdempotency.scheduleId === scheduleId && runIdempotency.key) {
			return runIdempotency.key;
		}
		const key = createIdempotencyKey();
		runIdempotency = { scheduleId, key };
		return key;
	};

	const clearRunIdempotency = (scheduleId) => {
		if (!scheduleId || runIdempotency.scheduleId === scheduleId) {
			runIdempotency = { scheduleId: '', key: '' };
		}
	};

	const t = $derived({
		back: isEn ? 'Back to OpenClaw' : 'Quay lại OpenClaw',
		title: 'Daily Draft',
		operationsTitle: isEn ? 'Content Operations V3' : 'Vận hành nội dung V3',
		operationsHint: isEn
			? 'Preview the evidence-led decision, persist and convert it, then run the draft-only work order.'
			: 'Xem trước quyết định dựa trên dữ liệu, lưu và chuyển đổi quyết định, sau đó chạy work order ở chế độ bản nháp.',
		previewBest: isEn ? 'Preview best action' : 'Xem trước hành động tốt nhất',
		persistBest: isEn ? 'Persist best action' : 'Lưu hành động tốt nhất',
		runSelected: isEn ? 'Run selected work order' : 'Chạy work order đã chọn',
		runFixed: isEn ? 'Run fixed brief' : 'Chạy brief cố định',
		fixedBriefMissing: isEn
			? 'Configure a fixed topic in Content Operations before running this mode.'
			: 'Hãy cấu hình chủ đề cố định trong Content Operations trước khi chạy chế độ này.',
		runMaintenance: isEn ? 'Maintenance only' : 'Chỉ bảo trì',
		openOperations: isEn ? 'Open control room' : 'Mở trung tâm vận hành',
		previewSafety: isEn
			? "Preview may refresh today's intelligence snapshot, but creates no planning artifact, blog, writer run, image, Telegram message, or schedule write."
			: 'Bản xem trước có thể làm mới snapshot thông tin hôm nay nhưng không tạo artifact kế hoạch, blog, lượt chạy writer, ảnh, tin Telegram hoặc ghi lịch.',
		skipResult: isEn
			? 'Skip selected — no production run or draft was started.'
			: 'Đã chọn bỏ qua — không khởi chạy sản xuất hoặc tạo bản nháp.',
		persistedBest: isEn
			? 'Best action persisted and converted. The work order is ready to run.'
			: 'Đã lưu và chuyển đổi hành động tốt nhất. Work order đã sẵn sàng để chạy.',
		persistMissing: isEn
			? 'Preview a non-skip best action before persisting it.'
			: 'Hãy xem trước một hành động khác skip trước khi lưu.',
		workOrderMissing: isEn
			? 'No persisted work order is available to run.'
			: 'Chưa có work order đã lưu để chạy.',
		subtitle: isEn
			? 'Run the blog workflow now or configure automated schedules.'
			: 'Chạy ngay quy trình tạo bài hoặc thiết lập lịch tự động.',
		runSectionTitle: isEn ? 'Run Daily Draft Now' : 'Chạy Daily Draft ngay',
		runSectionHint: isEn
			? 'Run one saved blog schedule through the audited Content Operations pipeline.'
			: 'Chạy một lịch blog đã lưu qua pipeline Content Operations có lịch sử kiểm tra.',
		runNow: isEn ? 'Run daily draft now' : 'Chạy daily draft ngay',
		running: isEn ? 'Running…' : 'Đang chạy…',
		loadingSchedules: isEn ? 'Loading schedules…' : 'Đang tải lịch…',
		confirmTitle: isEn ? 'Confirm daily draft run' : 'Xác nhận chạy daily draft',
		confirmDescription: isEn
			? 'This starts the selected schedule once and records a real execution in run history.'
			: 'Thao tác này chạy lịch đã chọn một lần và ghi execution thật vào lịch sử chạy.',
		schedule: isEn ? 'Blog schedule' : 'Lịch tạo bài',
		scheduleDisabled: isEn
			? 'Schedule automation is off; this one-time manual run is still allowed.'
			: 'Tự động chạy lịch đang tắt; lần chạy thủ công này vẫn được phép.',
		noSchedule: isEn
			? 'Create and save a blog schedule before running Daily Draft.'
			: 'Hãy tạo và lưu một lịch tạo bài trước khi chạy Daily Draft.',
		automationDisabled: isEn
			? 'SEO Agent is disabled. Enable SEO_AGENT_ENABLED before starting a draft.'
			: 'SEO Agent đang tắt. Hãy bật SEO_AGENT_ENABLED trước khi tạo bản nháp.',
		publishingMode: isEn ? 'Publishing mode' : 'Chế độ xuất bản',
		autoPublish: isEn ? 'Auto publish' : 'Tự động publish',
		draftOnly: isEn ? 'Draft only' : 'Chỉ tạo bản nháp',
		autoPublishWarning: isEn
			? 'Warning: Auto Publish is ON. A successful run may publish the post live.'
			: 'Cảnh báo: Auto Publish đang BẬT. Nếu chạy thành công bài có thể được publish trực tiếp.',
		imagePipeline: isEn ? 'Image pipeline' : 'Pipeline ảnh',
		imageSearch: isEn ? 'Image search' : 'Tìm ảnh',
		aiImage: isEn ? 'AI image' : 'Ảnh AI',
		minSeo: isEn ? 'Min SEO score' : 'Điểm SEO tối thiểu',
		wordRange: isEn ? 'Word range' : 'Số từ',
		scheduleMode: isEn ? 'Schedule mode' : 'Chế độ lịch',
		topic: isEn ? 'Topic' : 'Chủ đề',
		configNote: isEn
			? 'Topic, mode and language come from the selected saved schedule. This manual run does not enable its automatic schedule.'
			: 'Chủ đề, chế độ và ngôn ngữ lấy từ lịch đã lưu. Lần chạy thủ công này không tự bật lịch định kỳ.',
		cancel: isEn ? 'Cancel' : 'Huỷ',
		confirmRun: isEn ? 'Confirm run' : 'Xác nhận chạy',
		on: isEn ? 'On' : 'Bật',
		off: isEn ? 'Off' : 'Tắt',
		statusTitle: isEn ? 'System status' : 'Trạng thái hệ thống',
		controlHint: isEn
			? 'Protected runtime controls · changes are audited'
			: 'Điều khiển runtime có bảo vệ · mọi thay đổi đều được lưu audit',
		viewOnly: isEn ? 'View only' : 'Chỉ xem',
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
		},
		seoAgent: isEn ? 'SEO agent' : 'SEO agent',
		blogCron: isEn ? 'Blog cron' : 'Blog cron',
		telegram: isEn ? 'Telegram approval' : 'Duyệt qua Telegram',
		gateway: isEn ? 'OpenClaw gateway' : 'OpenClaw gateway',
		enabled: isEn ? 'Enabled' : 'Đang bật',
		disabled: isEn ? 'Disabled' : 'Tắt',
		missingConfig: isEn ? 'Missing config' : 'Thiếu cấu hình',
		configured: isEn ? 'Configured' : 'Đã cấu hình',
		notConfigured: isEn ? 'Not configured' : 'Chưa cấu hình',
		runStarted: isEn ? 'Run queued' : 'Đã xếp lịch chạy',
		runStatus: isEn ? 'Status' : 'Trạng thái',
		executionId: isEn ? 'Execution ID' : 'Mã phiên chạy',
		output: isEn ? 'Output' : 'Nhật ký',
		openBlogs: isEn ? 'Open blog list' : 'Mở danh sách bài viết',
		openDraft: isEn ? 'Open generated draft' : 'Mở bản nháp vừa tạo',
		draftHint: isEn
			? 'The execution is persisted. When finished, open the generated draft or inspect the run history below.'
			: 'Execution được lưu lại. Khi hoàn tất, hãy mở bản nháp vừa tạo hoặc xem lịch sử chạy bên dưới.'
	});

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com') {
			return path;
		}
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
	};

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
		const controls = Object.fromEntries(
			(Array.isArray(payload?.controls) ? payload.controls : []).map((control) => [
				control.controlKey,
				control
			])
		);
		const nextBlogCron = Boolean(controls.blog_cron?.enabled);
		const nextAutoPublish = Boolean(controls.auto_publish?.enabled);
		const nextTelegram = Boolean(controls.telegram_approval?.enabled);
		const nextImagePipeline = Boolean(controls.image_pipeline?.enabled);
		scheduleRuntimeState = { ...scheduleRuntimeState, cronEnabled: nextBlogCron };
		dashboard = {
			...dashboard,
			automation: {
				...(dashboard?.automation || {}),
				blogCronEnabled: nextBlogCron,
				autoPublish: nextAutoPublish,
				telegramEnabled: nextTelegram,
				imagePipelineEnabled: nextImagePipeline
			}
		};
	};

	const refreshRuntimeControls = async () => {
		const response = await fetch(resolveAdminPath('/admin/api/openclaw/runtime-controls'));
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			throw new Error(
				payload?.error ||
					(isEn ? 'Unable to refresh runtime controls' : 'Không thể làm mới công tắc runtime')
			);
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
		controlDialog = {
			...control,
			targetEnabled: control.enabled !== true
		};
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
				throw new Error(
					payload?.error ||
						(isEn ? 'Runtime control update failed' : 'Cập nhật công tắc runtime thất bại')
				);
			}
			applyRuntimeControlState(payload);
			controlDialog = null;
			controlReason = '';
			controlAcknowledged = false;
			controlMessage = t.controlSuccess;
		} catch (error) {
			controlMessage = error.message;
		} finally {
			controlBusy = '';
		}
	};

	const contentOperationsRequest = async (path, body) => {
		const response = await fetch(
			resolveAdminPath(`/admin/api/openclaw/content-operations/${path}`),
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			}
		);
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(
				payload?.error ||
					(isEn ? 'Content Operations request failed' : 'Yêu cầu Content Operations thất bại')
			);
		}
		return payload;
	};

	const mergeOperationsStatus = (patch) => {
		const nextStatus = { ...operationsStatus, ...patch };
		contentOperations = contentOperations?.status
			? { ...contentOperations, status: nextStatus }
			: nextStatus;
	};

	const previewContentOperation = async () => {
		operationsBusy = 'preview';
		operationsMessage = '';
		try {
			operationsPreview = normalizePreview(
				await contentOperationsRequest('preview', {
					dryRun: true,
					draftOnly: true,
					includeCandidates: true
				})
			);
			operationsMessage =
				operationsPreview.action === 'skip'
					? t.skipResult
					: isEn
						? 'Preview ready. No planning or production artifact was created.'
						: 'Bản xem trước đã sẵn sàng. Không có artifact kế hoạch hoặc sản xuất nào được tạo.';
		} catch (error) {
			operationsMessage = error.message;
		} finally {
			operationsBusy = '';
		}
	};

	const persistPreviewSelection = async () => {
		operationsBusy = 'persist_best_action';
		operationsMessage = '';
		try {
			if (!canPersistPreview) throw new Error(t.persistMissing);
			const planned = normalizePreview(
				await contentOperationsRequest('run-now', {
					mode: 'best_action',
					draftOnly: true,
					allowSkip: true
				})
			);
			const decisionId = entityId(planned.decisionId || planned.contentOpportunityDecisionId);
			const plannedWorkOrderId = entityId(
				planned.workOrderId || planned.contentWorkOrderId || planned.workOrder
			);

			if (planned.action === 'skip') {
				operationsPreview = planned;
				mergeOperationsStatus({
					latestRun: {
						...latestOperationsRun,
						...planned,
						selectedDecision: 'skip'
					}
				});
				operationsMessage = t.skipResult;
				return;
			}
			if (!decisionId || !plannedWorkOrderId) throw new Error(t.workOrderMissing);

			const converted = await contentOperationsRequest(
				`opportunities/${encodeURIComponent(decisionId)}/convert`,
				{ reason: 'Administrator confirmed the previewed best action.' }
			);
			const workOrder = converted?.workOrder || planned.workOrder;
			const workOrderId = entityId(workOrder || plannedWorkOrderId);
			if (!workOrderId) throw new Error(t.workOrderMissing);

			operationsPreview = normalizePreview({
				...planned,
				contentOpportunityDecisionId: decisionId,
				contentWorkOrderId: workOrderId,
				selectedOpportunity: converted?.opportunity || planned.selectedOpportunity,
				workOrder
			});
			mergeOperationsStatus({
				latestRun: {
					...latestOperationsRun,
					...planned,
					contentOpportunityDecisionId: decisionId,
					contentWorkOrderId: workOrderId,
					selectedDecision: planned.action
				},
				activeWorkOrder: workOrder
			});
			operationsMessage = t.persistedBest;
		} catch (error) {
			operationsMessage = error.message;
		} finally {
			operationsBusy = '';
		}
	};

	const runContentOperation = async (mode) => {
		operationsBusy = mode;
		operationsMessage = '';
		try {
			const selectedWorkOrder = mode === 'selected_work_order';
			let selectedWorkOrderId = operationsWorkOrderId;
			if (
				mode === 'fixed_brief' &&
				!String(operationsSchedule.topic || operationsSchedule.primaryKeyword || '').trim()
			) {
				throw new Error(t.fixedBriefMissing);
			}
			if (selectedWorkOrder && !hasRunnableSelection) throw new Error(t.workOrderMissing);
			if (selectedWorkOrder && operationsDecisionId) {
				const converted = await contentOperationsRequest(
					`opportunities/${encodeURIComponent(operationsDecisionId)}/convert`,
					{ reason: 'Administrator confirmed the selected Work Order for a draft-only run.' }
				);
				selectedWorkOrderId = entityId(converted?.workOrder || selectedWorkOrderId);
			}
			const path = selectedWorkOrder
				? `work-orders/${encodeURIComponent(selectedWorkOrderId)}/run`
				: 'run-now';
			const result = await contentOperationsRequest(path, {
				mode: selectedWorkOrder ? undefined : mode,
				topic: mode === 'fixed_brief' ? operationsSchedule.topic || undefined : undefined,
				primaryKeyword:
					mode === 'fixed_brief' ? operationsSchedule.primaryKeyword || undefined : undefined,
				draftOnly: true,
				workOrderId: selectedWorkOrder ? selectedWorkOrderId : undefined
			});
			const resultDecision = selectedWorkOrder ? operationsDecision : normalizePreview(result);
			if (!selectedWorkOrder) operationsPreview = resultDecision;
			mergeOperationsStatus({
				...result,
				latestRun: selectedWorkOrder
					? latestOperationsRun
					: {
							...latestOperationsRun,
							...result,
							contentOpportunityDecisionId: resultDecision.decisionId,
							contentWorkOrderId: resultDecision.workOrderId,
							selectedDecision: resultDecision.action
						},
				activeWorkOrder: result?.workOrder || operationsStatus?.activeWorkOrder
			});
			operationsMessage = isEn
				? 'Draft-only operation started.'
				: 'Đã bắt đầu tác vụ ở chế độ bản nháp.';
		} catch (error) {
			operationsMessage = error.message;
		} finally {
			operationsBusy = '';
		}
	};

	const formatDateTime = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		return new Intl.DateTimeFormat(isEn ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium',
			timeStyle: 'medium'
		}).format(date);
	};

	const telegramStatus = $derived.by(() => {
		const telegram = dashboard?.telegram || {};
		const enabled = telegramApprovalEnabled;
		const complete = Boolean(
			telegram.tokenConfigured &&
			telegram.webhookSecretConfigured &&
			telegram.allowlistConfigured &&
			telegram.adminBaseUrlConfigured
		);
		if (enabled && !complete) return { key: 'missing', label: t.missingConfig, tone: 'warn' };
		if (!enabled && complete) {
			return {
				key: 'configured_off',
				label: isEn ? 'Off · configured' : 'Tắt · đã cấu hình',
				tone: 'neutral'
			};
		}
		if (!enabled) return { key: 'disabled', label: t.disabled, tone: 'neutral' };
		return { key: 'enabled', label: t.enabled, tone: 'good' };
	});

	const generatedBlogEditPath = $derived(
		activeRun?.blogId ? `/admin/blogs/${activeRun.blogId}` : ''
	);

	const refreshRunSchedules = async () => {
		const response = await fetch(
			resolveAdminPath('/admin/api/openclaw/blog-schedules?limit=50&page=1')
		);
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			throw new Error(
				payload?.error || (isEn ? 'Unable to load blog schedules' : 'Không tải được lịch tạo bài')
			);
		}
		runSchedules = Array.isArray(payload?.schedules) ? payload.schedules : [];
		scheduleRuntimeState = payload?.runtime || scheduleRuntimeState;
		selectedRunScheduleId =
			selectDefaultDailyDraftSchedule(runSchedules, selectedRunScheduleId)?.id || '';
		return runSchedules;
	};

	const openRunConfirmation = async () => {
		if (running || openingConfirmation) return;
		openingConfirmation = true;
		runError = '';
		try {
			await refreshRunSchedules();
			if (!automation.enabled) throw new Error(t.automationDisabled);
			if (!selectedRunSchedule) throw new Error(t.noSchedule);
			confirmOpen = true;
		} catch (error) {
			runError = error.message;
		} finally {
			openingConfirmation = false;
		}
	};

	const stopPolling = () => {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	};

	const pollDailyDraftExecution = async (queuedRun) => {
		if (pollInFlight) return;
		pollInFlight = true;
		try {
			const response = await fetch(
				resolveAdminPath(
					`/admin/api/openclaw/blog-schedules/${encodeURIComponent(queuedRun.scheduleId)}/executions?limit=20`
				)
			);
			const payload = await response.json().catch(() => null);
			if (!response.ok) return;
			const match = selectQueuedDailyDraftExecution(payload?.executions, queuedRun);
			if (!match) return;
			activeRun = normalizeDailyDraftExecution(match, queuedRun);
			if (!isDailyDraftRunActive(match.status)) {
				running = false;
				clearRunIdempotency(queuedRun.scheduleId);
				stopPolling();
				await refreshRunSchedules().catch(() => null);
			}
		} catch {
			/* A transient polling failure must not start a duplicate draft. */
		} finally {
			pollInFlight = false;
		}
	};

	const startPolling = (queuedRun) => {
		stopPolling();
		pollStartedAt = Date.now();
		void pollDailyDraftExecution(queuedRun);
		pollTimer = setInterval(() => {
			if (Date.now() - pollStartedAt > 35 * 60 * 1000) {
				activeRun = normalizeDailyDraftExecution(
					{},
					{
						...queuedRun,
						...activeRun,
						status: 'tracking_timeout',
						error: isEn
							? 'Live tracking ended. The backend run may still be active; inspect run history before retrying.'
							: 'Đã dừng theo dõi trực tiếp. Backend có thể vẫn đang chạy; hãy kiểm tra lịch sử trước khi chạy lại.'
					}
				);
				running = false;
				stopPolling();
				return;
			}
			void pollDailyDraftExecution(queuedRun);
		}, 2500);
	};

	const confirmRun = async () => {
		if (running) return;
		running = true;
		runError = '';
		confirmOpen = false;
		activeRun = null;
		try {
			if (!automation.enabled) throw new Error(t.automationDisabled);
			const schedule = selectDefaultDailyDraftSchedule(runSchedules, selectedRunScheduleId);
			if (!schedule?.id) throw new Error(t.noSchedule);
			const queuedAt = new Date().toISOString();
			const idempotencyKey = idempotencyKeyForSchedule(schedule.id);
			const response = await fetch(
				resolveAdminPath(
					`/admin/api/openclaw/blog-schedules/${encodeURIComponent(schedule.id)}/run-now`
				),
				{
					method: 'POST',
					headers: { 'Idempotency-Key': idempotencyKey }
				}
			);
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				throw new Error(
					payload?.error ||
						(isEn ? 'Unable to start daily draft run' : 'Không thể bắt đầu chạy daily draft')
				);
			}
			const queuedRun = {
				id: payload?.executionId || '',
				executionId: payload?.executionId || '',
				scheduleId: payload?.scheduleId || schedule.id,
				status: 'queued',
				queuedAt: payload?.startedAt || queuedAt,
				startedAt: payload?.startedAt || queuedAt,
				output: payload?.message || t.runStarted
			};
			activeRun = normalizeDailyDraftExecution({}, queuedRun);
			startPolling(queuedRun);
		} catch (error) {
			runError =
				error?.message || (isEn ? 'Network error while starting run' : 'Lỗi mạng khi bắt đầu chạy');
			running = false;
		}
	};

	onDestroy(stopPolling);
</script>

<svelte:head>
	<title>Daily Draft | OpenClaw | Inoxpran</title>
</svelte:head>

<section class="openclaw-console daily-draft">
	<a class="oc-back" href={resolve('/admin/openclaw')}>
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"
			><path
				d="M15 18l-6-6 6-6"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/></svg
		>
		<span>{t.back}</span>
	</a>

	<header class="oc-header dd-header">
		<div class="oc-header__intro">
			<p class="oc-eyebrow">OpenClaw</p>
			<h1>{t.title}</h1>
			<p class="oc-header__sub">{t.subtitle}</p>
		</div>
		<span
			class="oc-badge dd-header__badge"
			class:is-good={automation.enabled}
			class:is-muted={!automation.enabled}
		>
			<span class="oc-dot"></span>{t.seoAgent}: {automation.enabled ? t.enabled : t.disabled}
		</span>
	</header>

	{#if pageError}
		<div class="oc-alert" role="alert">{pageError}</div>
	{/if}

	<section class="oc-panel dd-operations">
		<div class="dd-operations__head">
			<div>
				<p class="oc-eyebrow">Decision layer</p>
				<h2>{t.operationsTitle}</h2>
				<p class="oc-muted">{t.operationsHint}</p>
			</div>
			<a
				class="oc-btn oc-btn--ghost oc-btn--sm"
				href={resolve(resolveAdminPath('/admin/openclaw/content-operations'))}>{t.openOperations}</a
			>
		</div>
		<div class="dd-operations__safety">{t.previewSafety}</div>
		<div class="dd-operations__decision">
			<div>
				<span>{isEn ? 'Selected action' : 'Hành động được chọn'}</span><strong
					>{operationsDecision?.action || 'skip'}</strong
				>
			</div>
			<div>
				<span>{isEn ? 'Topic' : 'Chủ đề'}</span><strong>{operationsDecision?.topic || '--'}</strong>
			</div>
			<div>
				<span>{isEn ? 'Work order' : 'Work order'}</span><code>{operationsWorkOrderId || '--'}</code
				>
			</div>
		</div>
		<div class="dd-operations__actions">
			<button
				class="oc-btn oc-btn--ghost oc-btn--sm"
				type="button"
				onclick={previewContentOperation}
				disabled={Boolean(operationsBusy)}>{t.previewBest}</button
			>
			<button
				class="oc-btn oc-btn--ghost oc-btn--sm"
				type="button"
				onclick={persistPreviewSelection}
				disabled={Boolean(operationsBusy) || !canPersistPreview}>{t.persistBest}</button
			>
			<button
				class="oc-btn oc-btn--primary oc-btn--sm"
				type="button"
				onclick={() => runContentOperation('selected_work_order')}
				disabled={Boolean(operationsBusy) || !hasRunnableSelection}>{t.runSelected}</button
			>
			<button
				class="oc-btn oc-btn--ghost oc-btn--sm"
				type="button"
				onclick={() => runContentOperation('fixed_brief')}
				disabled={Boolean(operationsBusy)}>{t.runFixed}</button
			>
			<button
				class="oc-btn oc-btn--ghost oc-btn--sm"
				type="button"
				onclick={() => runContentOperation('maintenance_only')}
				disabled={Boolean(operationsBusy)}>{t.runMaintenance}</button
			>
		</div>
		{#if operationsMessage}<p
				class="dd-operations__message"
				class:is-skip={operationsDecision?.action === 'skip'}
				role="status"
				aria-live="polite"
			>
				{operationsMessage}
			</p>{/if}
	</section>

	<div class="dd-grid">
		<section class="oc-panel dd-run">
			<div class="dd-run__intro">
				<span class="dd-run__icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none"
						><path
							d="M8 5.5v13l11-6.5-11-6.5Z"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linejoin="round"
						/></svg
					>
				</span>
				<div>
					<h2>{t.runSectionTitle}</h2>
					<p class="oc-muted">{t.runSectionHint}</p>
				</div>
			</div>

			<div class="dd-run__mode">
				<span class="oc-muted">{t.publishingMode}</span>
				<span
					class="oc-badge"
					class:is-warn={autoPublishEnabled}
					class:is-good={!autoPublishEnabled}
				>
					<span class="oc-dot"></span>{autoPublishEnabled ? t.autoPublish : t.draftOnly}
				</span>
			</div>

			<div class="dd-run__cta">
				<button
					type="button"
					class="oc-btn oc-btn--primary"
					onclick={openRunConfirmation}
					disabled={running || openingConfirmation || !automation.enabled || !runSchedules.length}
				>
					{running ? t.running : openingConfirmation ? t.loadingSchedules : t.runNow}
				</button>
			</div>
			{#if !automation.enabled || !runSchedules.length}
				<p class="dd-run__prerequisite">
					{!automation.enabled ? t.automationDisabled : t.noSchedule}
				</p>
			{/if}

			{#if runError}
				<div class="oc-alert" role="alert">{runError}</div>
			{/if}

			{#if activeRun}
				<div class="dd-result">
					<div class="dd-result__row">
						<span>{t.runStatus}</span>
						<b
							class="oc-badge"
							class:is-good={isDailyDraftRunSuccessful(activeRun.status)}
							class:is-danger={isDailyDraftRunFailed(activeRun.status)}
							class:is-muted={isDailyDraftRunActive(activeRun.status)}
						>
							{dailyDraftStatusLabel(activeRun.status, isEn)}
						</b>
					</div>
					<div class="dd-result__row">
						<span>{t.executionId}</span>
						<code>{activeRun.id || (isEn ? 'Waiting for execution…' : 'Đang tạo execution…')}</code>
					</div>
					<div class="dd-result__row">
						<span>{isEn ? 'Started' : 'Bắt đầu'}</span>
						<strong>{formatDateTime(activeRun.startedAt)}</strong>
					</div>
					<div class="dd-result__links">
						{#if generatedBlogEditPath}
							<a
								class="oc-btn oc-btn--ghost oc-btn--sm"
								href={resolve(generatedBlogEditPath)}
								target="_blank"
								rel="noreferrer"
							>
								{t.openDraft}
							</a>
						{/if}
						<a
							class="oc-btn oc-btn--ghost oc-btn--sm"
							href={resolve('/admin/blogs')}
							target="_blank"
							rel="noreferrer"
						>
							{t.openBlogs}
						</a>
					</div>
					<small class="oc-muted">{t.draftHint}</small>
					{#if activeRun.output || activeRun.error}
						<details class="dd-result__log">
							<summary>{t.output}</summary>
							<pre class="oc-log">{activeRun.output || activeRun.error}</pre>
						</details>
					{/if}
				</div>
			{/if}
		</section>

		<aside class="oc-panel dd-status">
			<div class="oc-panel__head">
				<div>
					<h2>{t.statusTitle}</h2>
					<p class="dd-status__hint">{t.controlHint}</p>
				</div>
				{#if !canManageRuntimeControls}
					<span class="dd-status__readonly">{t.viewOnly}</span>
				{/if}
			</div>
			<div class="dd-status__list">
				<div class="dd-status__row">
					<span>{t.seoAgent}</span>
					<b
						class="oc-badge"
						class:is-good={automation.enabled}
						class:is-muted={!automation.enabled}
					>
						<span class="oc-dot"></span>{automation.enabled ? t.enabled : t.disabled}
					</b>
				</div>
				<div class="dd-status__row">
					<span>{t.blogCron}</span>
					<div class="dd-status__value">
						<button
							type="button"
							class="dd-control-toggle"
							class:is-on={blogCronEnabled}
							role="switch"
							aria-checked={blogCronEnabled}
							aria-label={`${blogCronEnabled ? t.controlDisable : t.controlEnable} ${t.blogCron}`}
							disabled={!canManageRuntimeControls || Boolean(controlBusy)}
							onclick={() => openRuntimeControlDialog('blog_cron')}
						>
							<span class="dd-control-toggle__state"
								>{blogCronEnabled ? t.enabled : t.disabled}</span
							>
							<span class="dd-control-toggle__track"><span></span></span>
						</button>
						<small>{enabledScheduleCount} {isEn ? 'enabled schedule(s)' : 'lịch đang bật'}</small>
					</div>
				</div>
				<div class="dd-status__row">
					<span>{t.autoPublish}</span>
					<button
						type="button"
						class="dd-control-toggle"
						class:is-on={autoPublishEnabled}
						class:is-critical={autoPublishEnabled}
						role="switch"
						aria-checked={autoPublishEnabled}
						aria-label={`${autoPublishEnabled ? t.controlDisable : t.controlEnable} ${t.autoPublish}`}
						disabled={!canManageRuntimeControls || Boolean(controlBusy)}
						onclick={() => openRuntimeControlDialog('auto_publish')}
					>
						<span class="dd-control-toggle__state"
							>{autoPublishEnabled ? t.autoPublish : t.draftOnly}</span
						>
						<span class="dd-control-toggle__track"><span></span></span>
					</button>
				</div>
				<div class="dd-status__row">
					<span>{t.telegram}</span>
					<button
						type="button"
						class="dd-control-toggle"
						class:is-on={telegramApprovalEnabled}
						role="switch"
						aria-checked={telegramApprovalEnabled}
						aria-label={`${telegramApprovalEnabled ? t.controlDisable : t.controlEnable} ${t.telegram}`}
						disabled={!canManageRuntimeControls || Boolean(controlBusy)}
						onclick={() => openRuntimeControlDialog('telegram_approval')}
					>
						<span class="dd-control-toggle__state">{telegramStatus.label}</span>
						<span class="dd-control-toggle__track"><span></span></span>
					</button>
				</div>
				<div class="dd-status__row">
					<span>{t.imagePipeline}</span>
					<button
						type="button"
						class="dd-control-toggle"
						class:is-on={imagePipelineEnabled}
						role="switch"
						aria-checked={imagePipelineEnabled}
						aria-label={`${imagePipelineEnabled ? t.controlDisable : t.controlEnable} ${t.imagePipeline}`}
						disabled={!canManageRuntimeControls || Boolean(controlBusy)}
						onclick={() => openRuntimeControlDialog('image_pipeline')}
					>
						<span class="dd-control-toggle__state"
							>{imagePipelineEnabled ? t.enabled : t.disabled}</span
						>
						<span class="dd-control-toggle__track"><span></span></span>
					</button>
				</div>
				<div class="dd-status__row">
					<span>{t.gateway}</span>
					<div class="dd-status__value">
						<b
							class="oc-badge"
							class:is-good={gatewayHealth.ready}
							class:is-warn={gatewayHealth.live && !gatewayHealth.ready}
							class:is-danger={gatewayHealth.reachable === false}
						>
							<span class="oc-dot"></span>{gatewayHealth.ready
								? isEn
									? 'Ready'
									: 'Sẵn sàng'
								: gatewayHealth.live
									? isEn
										? 'Starting'
										: 'Đang khởi động'
									: isEn
										? 'Unavailable'
										: 'Không khả dụng'}</b
						>
						{#if gatewayHealth.checkedAt}<small>{formatDateTime(gatewayHealth.checkedAt)}</small
							>{/if}
					</div>
				</div>
			</div>
			{#if controlMessage}
				<p class="dd-status__message" aria-live="polite">{controlMessage}</p>
			{/if}
		</aside>
	</div>

	<BlogSchedulesPanel {initialSchedules} initialRuntime={scheduleRuntime} />
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
					<p class="oc-eyebrow">LIVE RUNTIME / AUDITED</p>
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
					class="oc-btn oc-btn--ghost"
					onclick={closeRuntimeControlDialog}
					disabled={Boolean(controlBusy)}>{t.cancel}</button
				>
				<button
					type="button"
					class="oc-btn"
					class:oc-btn--primary={controlDialog.risk !== 'public_publish'}
					class:oc-btn--danger={controlDialog.risk === 'public_publish'}
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

{#if confirmOpen}
	<div
		class="dd-modal"
		role="button"
		tabindex="0"
		aria-label={t.cancel}
		onclick={(event) => {
			if (event.target === event.currentTarget) confirmOpen = false;
		}}
		onkeydown={(event) => {
			if (event.key === 'Escape') confirmOpen = false;
		}}
	>
		<div class="dd-modal__box" role="dialog" aria-modal="true" aria-label={t.confirmTitle}>
			<h3>{t.confirmTitle}</h3>
			<p class="oc-muted">{t.confirmDescription}</p>
			<label class="dd-schedule-choice">
				<span>{t.schedule}</span>
				<select bind:value={selectedRunScheduleId}>
					{#each runSchedules as schedule (schedule.id)}
						<option value={schedule.id}>
							{schedule.name} · {schedule.enabled ? t.enabled : t.disabled}
						</option>
					{/each}
				</select>
			</label>
			{#if selectedRunSchedule && !selectedRunSchedule.enabled}
				<p class="dd-confirm__notice">{t.scheduleDisabled}</p>
			{/if}

			<div class="dd-confirm">
				<div class="dd-confirm__item">
					<span>{t.scheduleMode}</span>
					<b>{selectedRunSchedule?.mode || 'fixed_brief'}</b>
				</div>
				<div class="dd-confirm__item">
					<span>{t.topic}</span>
					<b
						>{selectedRunSchedule?.agentConfig?.topic ||
							selectedRunSchedule?.agentConfig?.primaryKeyword ||
							'--'}</b
					>
				</div>
				<div class="dd-confirm__item">
					<span>{t.publishingMode}</span>
					<b
						class="oc-badge"
						class:is-warn={autoPublishEnabled}
						class:is-good={!autoPublishEnabled}
					>
						{autoPublishEnabled ? t.autoPublish : t.draftOnly}
					</b>
				</div>
				<div class="dd-confirm__item">
					<span>{t.imagePipeline}</span>
					<b>{imagePipelineEnabled ? t.on : t.off}</b>
				</div>
				<div class="dd-confirm__item">
					<span>{t.imageSearch}</span>
					<b>{automation.imageSearchProvider || 'disabled'}</b>
				</div>
				<div class="dd-confirm__item">
					<span>{t.aiImage}</span>
					<b>{automation.aiImageProvider || 'disabled'}</b>
				</div>
				<div class="dd-confirm__item">
					<span>{t.minSeo}</span>
					<b>{automation.minSeoScore || 85}+</b>
				</div>
				<div class="dd-confirm__item">
					<span>{t.wordRange}</span>
					<b>{automation.minWords || 800}–{automation.maxWords || 1800}</b>
				</div>
			</div>

			{#if autoPublishEnabled}
				<div class="dd-confirm__warning">{t.autoPublishWarning}</div>
			{/if}

			<small class="oc-muted">{t.configNote}</small>

			<div class="dd-modal__actions">
				<button type="button" class="oc-btn oc-btn--ghost" onclick={() => (confirmOpen = false)}
					>{t.cancel}</button
				>
				<button
					type="button"
					class="oc-btn oc-btn--primary"
					onclick={confirmRun}
					disabled={!selectedRunSchedule || running}>{t.confirmRun}</button
				>
			</div>
		</div>
	</div>
{/if}

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
		gap: clamp(14px, 1.8vw, 20px);
		color: var(--oc-text);
		min-width: 0;
	}

	.openclaw-console h1,
	.openclaw-console h2 {
		margin: 0;
	}

	/* ── Back link ── */
	.oc-back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		width: fit-content;
		color: var(--oc-primary);
		font-weight: 700;
		font-size: 0.86rem;
		text-decoration: none;
	}

	.oc-back svg {
		width: 16px;
		height: 16px;
	}

	.oc-back:hover {
		color: var(--oc-primary-strong);
	}

	.oc-back:focus-visible {
		outline: 2px solid var(--oc-primary);
		outline-offset: 3px;
		border-radius: 4px;
	}

	/* ── Header ── */
	.oc-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
		padding: clamp(16px, 2vw, 22px) clamp(18px, 2vw, 24px);
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

	.dd-header__badge {
		font-size: 0.78rem;
		padding: 5px 12px;
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
		margin-bottom: 14px;
	}

	.oc-panel__head h2 {
		font-size: 1rem;
		font-weight: 700;
	}

	.oc-muted {
		color: var(--oc-muted);
		font-size: 0.88rem;
	}

	.dd-operations {
		display: grid;
		gap: 12px;
		border-left: 3px solid var(--oc-primary);
	}
	.dd-operations__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}
	.dd-operations__head h2 {
		font-size: 1.05rem;
	}
	.dd-operations__head p:last-child {
		margin: 6px 0 0;
	}
	.dd-operations__safety {
		padding: 9px 11px;
		border: 1px solid rgba(15, 118, 110, 0.18);
		border-radius: 8px;
		background: var(--oc-primary-soft);
		color: var(--oc-primary-strong);
		font-size: 0.76rem;
		line-height: 1.45;
	}
	.dd-operations__decision {
		display: grid;
		grid-template-columns: 0.7fr 1.5fr 1fr;
		border: 1px solid var(--oc-border);
		border-radius: 9px;
		overflow: hidden;
	}
	.dd-operations__decision > div {
		display: grid;
		gap: 5px;
		min-width: 0;
		padding: 10px 12px;
		border-right: 1px solid var(--oc-border);
	}
	.dd-operations__decision > div:last-child {
		border-right: 0;
	}
	.dd-operations__decision span {
		color: var(--oc-muted);
		font-size: 0.66rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.dd-operations__decision strong,
	.dd-operations__decision code {
		overflow-wrap: anywhere;
		font-size: 0.78rem;
	}
	.dd-operations__actions {
		display: flex;
		gap: 7px;
		flex-wrap: wrap;
	}
	.dd-operations__message {
		margin: 0;
		color: var(--oc-primary-strong);
		font-size: 0.78rem;
		font-weight: 700;
	}
	.dd-operations__message.is-skip {
		color: var(--oc-warning);
	}

	/* ── Buttons ── */
	.oc-btn {
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
		text-decoration: none;
		transition:
			background 0.18s ease,
			border-color 0.18s ease,
			box-shadow 0.18s ease,
			transform 0.18s ease;
	}

	.oc-btn--sm {
		min-height: 34px;
		padding: 0 12px;
		font-size: 0.82rem;
	}

	.oc-btn--primary {
		background: var(--oc-primary);
		border-color: var(--oc-primary);
		color: #fff;
		box-shadow: 0 2px 8px rgba(15, 118, 110, 0.16);
	}

	.oc-btn--primary:hover:not(:disabled) {
		background: var(--oc-primary-strong);
		border-color: var(--oc-primary-strong);
		transform: translateY(-1px);
	}

	.oc-btn--ghost {
		background: var(--oc-surface);
		border-color: var(--oc-border);
		color: var(--oc-text);
	}

	.oc-btn--ghost:hover:not(:disabled) {
		border-color: var(--oc-primary);
		background: var(--oc-primary-soft);
		color: var(--oc-primary-strong);
	}

	.oc-btn--danger {
		background: #b42318;
		border-color: #b42318;
		color: #fff;
		box-shadow: 0 2px 8px rgba(180, 35, 24, 0.18);
	}

	.oc-btn--danger:hover:not(:disabled) {
		background: #8f1c13;
		border-color: #8f1c13;
		transform: translateY(-1px);
	}

	.oc-btn:disabled {
		opacity: 0.62;
		cursor: wait;
	}

	.oc-btn:focus-visible {
		outline: 2px solid var(--oc-primary);
		outline-offset: 2px;
	}

	/* ── Grid ── */
	.dd-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
		gap: clamp(14px, 1.8vw, 20px);
		align-items: start;
	}

	/* ── Run now ── */
	.dd-run {
		display: grid;
		gap: 16px;
		align-content: start;
	}

	.dd-run__intro {
		display: flex;
		align-items: flex-start;
		gap: 13px;
	}

	.dd-run__icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		flex-shrink: 0;
		border-radius: 11px;
		background: var(--oc-primary-soft);
		color: var(--oc-primary);
	}

	.dd-run__icon svg {
		width: 20px;
		height: 20px;
	}

	.dd-run__intro h2 {
		font-size: 1.02rem;
		font-weight: 700;
	}

	.dd-run__intro p {
		margin: 4px 0 0;
	}

	.dd-run__mode {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 11px 14px;
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface-2);
	}

	.dd-run__mode > span {
		font-size: 0.82rem;
	}

	.dd-run__cta {
		display: flex;
		justify-content: flex-end;
	}

	.dd-run__prerequisite {
		margin: 0;
		padding: 10px 12px;
		border: 1px solid rgba(217, 119, 6, 0.24);
		border-radius: var(--oc-radius-sm);
		background: rgba(217, 119, 6, 0.07);
		color: #9a5a08;
		font-size: 0.82rem;
	}

	/* ── Run result ── */
	.dd-result {
		display: grid;
		gap: 10px;
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface-2);
		padding: 14px;
	}

	.dd-result__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.dd-result__row span {
		color: var(--oc-muted);
		font-size: 0.8rem;
	}

	.dd-result__row code {
		overflow-wrap: anywhere;
		color: var(--oc-text);
		font-size: 0.78rem;
	}

	.dd-result__links {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 2px;
	}

	.dd-result__log summary {
		cursor: pointer;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--oc-primary);
	}

	.oc-log {
		margin: 8px 0 0;
		max-height: 320px;
		overflow: auto;
		padding: 14px;
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface);
		color: #334155;
		border: 1px solid var(--oc-border);
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.78rem;
		line-height: 1.55;
		font-family: 'Monaco', 'Courier New', monospace;
	}

	/* ── System status ── */
	.dd-status {
		align-self: start;
	}

	.dd-status__hint {
		margin: 5px 0 0;
		max-width: 260px;
		color: var(--oc-muted);
		font-size: 0.68rem;
		line-height: 1.4;
	}

	.dd-status__readonly {
		padding: 3px 8px;
		border: 1px solid var(--oc-border);
		border-radius: 999px;
		color: var(--oc-muted);
		font-size: 0.68rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.dd-status__list {
		display: grid;
		gap: 0;
	}

	.dd-status__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--oc-border-soft);
	}

	.dd-status__row:last-child {
		border-bottom: 0;
	}

	.dd-status__row > span {
		color: var(--oc-muted);
		font-size: 0.85rem;
	}

	.dd-status__value {
		display: grid;
		justify-items: end;
		gap: 4px;
		text-align: right;
	}

	.dd-status__value small {
		color: var(--oc-muted);
		font-size: 0.7rem;
	}

	.dd-control-toggle {
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
		transition:
			border-color 0.16s ease,
			background 0.16s ease,
			box-shadow 0.16s ease,
			transform 0.16s ease;
	}

	.dd-control-toggle:hover:not(:disabled) {
		border-color: rgba(15, 118, 110, 0.42);
		box-shadow: 0 3px 10px rgba(15, 118, 110, 0.1);
		transform: translateY(-1px);
	}

	.dd-control-toggle:focus-visible {
		outline: 2px solid var(--oc-primary);
		outline-offset: 2px;
	}

	.dd-control-toggle:disabled {
		cursor: not-allowed;
		opacity: 0.62;
	}

	.dd-control-toggle.is-on {
		border-color: rgba(5, 150, 105, 0.28);
		background: rgba(5, 150, 105, 0.1);
		color: #047857;
	}

	.dd-control-toggle.is-critical {
		border-color: rgba(217, 119, 6, 0.34);
		background: rgba(217, 119, 6, 0.1);
		color: #a74f05;
	}

	.dd-control-toggle__state {
		max-width: 130px;
		text-align: right;
	}

	.dd-control-toggle__track {
		position: relative;
		width: 30px;
		height: 18px;
		flex: 0 0 auto;
		border-radius: 999px;
		background: #cbd0d8;
		box-shadow: inset 0 0 0 1px rgba(17, 24, 39, 0.08);
		transition: background 0.16s ease;
	}

	.dd-control-toggle__track span {
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

	.dd-control-toggle.is-on .dd-control-toggle__track {
		background: var(--oc-primary);
	}

	.dd-control-toggle.is-critical .dd-control-toggle__track {
		background: var(--oc-warning);
	}

	.dd-control-toggle.is-on .dd-control-toggle__track span {
		transform: translateX(12px);
	}

	.dd-status__message {
		margin: 12px 0 0;
		padding: 9px 10px;
		border: 1px solid rgba(15, 118, 110, 0.18);
		border-radius: 8px;
		background: var(--oc-primary-soft);
		color: var(--oc-primary-strong);
		font-size: 0.74rem;
		line-height: 1.45;
	}

	/* ── Modal ── */
	.dd-modal {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(15, 23, 42, 0.5);
	}

	.dd-modal__box {
		width: min(560px, 100%);
		background: var(--oc-surface);
		border-radius: var(--oc-radius);
		border: 1px solid var(--oc-border);
		padding: 22px;
		display: grid;
		gap: 12px;
		box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
	}

	.dd-modal__box h3 {
		font-size: 1.1rem;
		font-weight: 700;
	}

	.dd-schedule-choice {
		display: grid;
		gap: 6px;
		color: var(--oc-muted);
		font-size: 0.8rem;
	}

	.dd-schedule-choice select {
		width: 100%;
		min-height: 40px;
		padding: 0 10px;
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface);
		color: var(--oc-text);
		font: inherit;
	}

	.dd-confirm__notice {
		margin: 0;
		padding: 9px 11px;
		border-radius: var(--oc-radius-sm);
		background: rgba(15, 118, 110, 0.07);
		color: var(--oc-primary-strong);
		font-size: 0.8rem;
	}

	.dd-confirm {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px 16px;
		padding: 14px;
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface-2);
	}

	.dd-confirm__item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.dd-confirm__item span {
		color: var(--oc-muted);
		font-size: 0.8rem;
	}

	.dd-confirm__item b {
		font-size: 0.84rem;
		text-align: right;
	}

	.dd-confirm__warning {
		padding: 12px 14px;
		border-radius: var(--oc-radius-sm);
		background: rgba(217, 119, 6, 0.09);
		border: 1px solid rgba(217, 119, 6, 0.28);
		color: #b45309;
		font-weight: 600;
		font-size: 0.88rem;
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

	.dd-control-modal__heading .oc-eyebrow {
		margin-bottom: 5px;
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

	.dd-control-reason textarea:focus {
		outline: 2px solid rgba(15, 118, 110, 0.2);
		border-color: var(--oc-primary);
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

	.dd-modal__actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 4px;
	}

	/* ── Responsive ── */
	@media (max-width: 1080px) {
		.dd-grid {
			grid-template-columns: 1fr;
		}
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

		.dd-operations__decision {
			grid-template-columns: 1fr;
		}

		.dd-operations__decision > div {
			border-right: 0;
			border-bottom: 1px solid var(--oc-border);
		}

		.dd-operations__decision > div:last-child {
			border-bottom: 0;
		}

		.dd-confirm {
			grid-template-columns: 1fr;
		}

		.dd-run__cta .oc-btn {
			width: 100%;
		}

		.dd-modal__actions .oc-btn {
			flex: 1 1 auto;
		}
	}
</style>
