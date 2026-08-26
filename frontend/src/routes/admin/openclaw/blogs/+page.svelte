<script>
	import { onDestroy, onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { locale } from '$lib/i18n/admin/index.js';
	import BlogTopicRoadmapPanel from '$lib/components/admin/openclaw/BlogTopicRoadmapPanel.svelte';
	import { openClawActivityStatus, openClawActivityStore } from '$lib/openclaw/activityCenter.js';
	import {
		createOpenClawActionIdempotencyManager,
		shouldRetainOpenClawActionKey
	} from '$lib/openclaw/actionIdempotency.js';
	import { buildExecutionSummariesRequest } from '$lib/openclaw/executionSummaries.js';
	import { createSmartPoller } from '$lib/openclaw/smartPolling.js';
	import {
		SIMPLE_SCHEDULE_TIMEZONE,
		buildSimpleSchedulePayload,
		dateInVietnam,
		dateTimeInVietnam,
		scheduleRunTimes,
		scheduleToSimpleForm,
		simpleDecisionReasonLabel,
		simpleExecutionDisplayStatus,
		simpleExecutionErrorLabel,
		simpleResultLabel,
		simpleExecutionTone,
		validateSimpleScheduleForm
	} from '$lib/openclaw/simpleSchedule.js';

	let { data } = $props();

	const isEn = $derived($locale === 'en');

	// svelte-ignore state_referenced_locally
	let schedules = $state(Array.isArray(data?.schedules?.schedules) ? data.schedules.schedules : []);
	// svelte-ignore state_referenced_locally
	let pageError = $state(data?.loadErrorCode || '');

	const emptyForm = () => ({
		id: '',
		name: '',
		direction: '',
		times: '',
		startDate: '',
		endDate: '',
		enabled: true
	});

	let form = $state(emptyForm());
	let formOpen = $state(false);
	let formErrors = $state({});
	let saving = $state(false);
	let formMessage = $state('');
	let busyScheduleId = $state('');
	let runNowBusyId = $state('');
	let confirmDeleteId = $state('');
	let detailScheduleId = $state('');
	let resultsOpen = $state(false);
	let roadmapOpen = $state(false);
	let expandedExecutions = $state([]);
	let expandedLoading = $state(false);
	let expandedError = $state('');
	let pollingNotice = $state('');
	let uncertainRunNowIds = $state([]);
	let lastSuccessfulSyncAt = $state(0);
	// Ids of schedules whose latest manual run is still in-flight (queued/running/committing).
	// Drives the live "running" indicator on each card and is cleared when polling settles.
	let liveRunningIds = $state([]);
	let executionSummaries = $state([]);

	const ACTIVE_EXECUTION_STATUSES = new Set(['queued', 'running', 'committing', 'retry_wait']);
	const TERMINAL_EXECUTION_STATUSES = new Set([
		'draft_created',
		'maintenance_created',
		'published',
		'completed',
		'blocked',
		'failed',
		'skipped'
	]);
	const isActiveStatus = (status) => ACTIVE_EXECUTION_STATUSES.has(String(status || ''));
	const isTerminalStatus = (status) => TERMINAL_EXECUTION_STATUSES.has(String(status || ''));
	const trackedExecutionIds = new SvelteMap();
	const executionActivityKeys = new SvelteMap();
	const runNowIdempotency = createOpenClawActionIdempotencyManager();
	let schedulePoller = null;

	const isEditing = $derived(Boolean(form.id));
	const detailSchedule = $derived(
		schedules.find((schedule) => schedule.id === detailScheduleId) || null
	);
	const activeScheduleCount = $derived(schedules.filter((schedule) => schedule.enabled).length);
	const issueScheduleCount = $derived(
		schedules.filter((schedule) => ['failed', 'blocked'].includes(schedule.lastRunStatus)).length
	);
	const nextSchedule = $derived.by(() => {
		const scheduled = schedules
			.filter((schedule) => schedule.enabled && schedule.nextRunAt)
			.toSorted((left, right) => new Date(left.nextRunAt) - new Date(right.nextRunAt));
		return scheduled[0] || null;
	});
	const executionRows = $derived(
		executionSummaries.flatMap((summary) => {
			const schedule = schedules.find((item) => item.id === summary.scheduleId);
			return (summary.executions || []).map((execution) => ({ execution, schedule }));
		})
	);
	const latestExecutionRows = $derived(
		executionSummaries
			.map((summary) => ({
				execution: summary.executions?.[0],
				schedule: schedules.find((item) => item.id === summary.scheduleId)
			}))
			.filter(({ execution }) => Boolean(execution))
	);
	const activeExecutionRows = $derived(
		latestExecutionRows.filter(({ execution }) => isActiveStatus(execution.status))
	);
	const latestSuccessfulExecution = $derived.by(() => {
		const successful = executionRows
			.filter(({ execution }) =>
				['draft_created', 'maintenance_created', 'completed', 'published'].includes(
					execution.status
				)
			)
			.toSorted(
				(left, right) =>
					new Date(right.execution.completedAt || right.execution.createdAt || 0) -
					new Date(left.execution.completedAt || left.execution.createdAt || 0)
			);
		return successful[0] || null;
	});
	const operatorIncidents = $derived(
		latestExecutionRows.filter(({ execution }) => ['failed', 'blocked'].includes(execution.status))
	);

	const t = $derived({
		title: isEn ? 'Blog Autopilot' : 'Trạm điều hành Blog',
		subtitle: isEn
			? 'OpenClaw researches, decides and creates safe drafts on your schedule. You only step in when the system asks.'
			: 'OpenClaw tự nghiên cứu, ra quyết định và tạo bản nháp an toàn theo lịch. Bạn chỉ cần can thiệp khi hệ thống yêu cầu.',
		settingsLink: isEn ? 'Blog OpenClaw Settings (BOS)' : 'Lõi Blog OpenClaw (BOS)',
		createTitle: isEn ? 'Create schedule' : 'Tạo lịch mới',
		editTitle: isEn ? 'Edit schedule' : 'Sửa lịch',
		basicsLegend: isEn ? 'Basic information' : 'Thông tin cơ bản',
		nameLabel: isEn ? 'Schedule name' : 'Tên lịch',
		namePlaceholder: isEn ? 'e.g. Summer blog schedule' : 'Ví dụ: Lịch blog mùa hè',
		directionLegend: isEn ? 'Topic / direction' : 'Chủ đề / định hướng',
		directionLabel: isEn ? 'Topic / direction' : 'Chủ đề / định hướng',
		directionPlaceholder: isEn
			? 'e.g. Helpful articles for Vietnamese families about choosing, using and caring for kitchenware in summer.'
			: 'Ví dụ: Viết các bài hữu ích cho gia đình Việt về cách lựa chọn, sử dụng và bảo quản đồ gia dụng trong mùa hè.',
		directionHint: isEn
			? 'This is a manager brief, not a fixed title. A broad direction expands across categories and products; a narrow direction drills into child topics. OpenClaw compares it with existing articles and may create, update, expand or skip.'
			: 'Đây là brief của quản lý, không phải tiêu đề cố định. Định hướng rộng sẽ mở ra nhiều danh mục và sản phẩm; định hướng hẹp sẽ đi sâu vào các chủ đề con. OpenClaw đối chiếu với bài đã có và có thể tạo mới, cập nhật, mở rộng hoặc bỏ qua.',
		timesLegend: isEn ? 'Run times' : 'Giờ chạy',
		timesLabel: isEn ? 'Run times' : 'Giờ chạy',
		timesHelper: isEn
			? 'Use HH:mm format. Separate multiple times with commas. Example: 08:30, 14:00, 20:15.'
			: 'Nhập theo định dạng HH:mm. Có thể nhập nhiều giờ, phân cách bằng dấu phẩy. Ví dụ: 08:30, 14:00, 20:15.',
		timezoneHelper: isEn
			? `Default timezone: Vietnam (${SIMPLE_SCHEDULE_TIMEZONE})`
			: `Múi giờ mặc định: Việt Nam (${SIMPLE_SCHEDULE_TIMEZONE})`,
		windowLegend: isEn ? 'Active period' : 'Thời gian áp dụng',
		startLabel: isEn ? 'Start date' : 'Ngày bắt đầu',
		endLabel: isEn ? 'End date' : 'Ngày kết thúc',
		endHint: isEn
			? 'Leave empty for an open-ended schedule.'
			: 'Để trống nếu muốn lịch chạy không giới hạn ngày kết thúc.',
		save: isEn ? 'Save schedule' : 'Lưu lịch',
		saving: isEn ? 'Saving…' : 'Đang lưu…',
		cancel: isEn ? 'Cancel' : 'Huỷ',
		reset: isEn ? 'Reset' : 'Nhập lại',
		listTitle: isEn ? 'Blog schedules' : 'Danh sách lịch Blog',
		empty: isEn ? 'No blog schedules yet.' : 'Chưa có lịch Blog.',
		emptyHint: isEn
			? 'Create the first schedule so OpenClaw can find suitable topics and create drafts on schedule.'
			: 'Tạo lịch đầu tiên để OpenClaw tự tìm chủ đề phù hợp và tạo bản nháp theo lịch.',
		active: isEn ? 'Active' : 'Đang bật',
		paused: isEn ? 'Paused' : 'Tạm dừng',
		runTimes: isEn ? 'Run times' : 'Giờ chạy',
		period: isEn ? 'Period' : 'Thời gian',
		openEnded: isEn ? 'open-ended' : 'không giới hạn',
		nextRun: isEn ? 'Next run' : 'Lần chạy kế tiếp',
		lastResult: isEn ? 'Latest result' : 'Kết quả gần nhất',
		notScheduled: isEn ? 'Not scheduled' : 'Chưa xếp lịch',
		overview: isEn ? 'Today at a glance' : 'Tình hình hôm nay',
		systemState: isEn ? 'Autopilot' : 'Chế độ tự vận hành',
		workingNormally: isEn ? 'Working normally' : 'Đang làm việc bình thường',
		needsAttention: isEn ? 'Needs attention' : 'Cần bạn xem',
		activeSchedules: isEn ? 'Active schedules' : 'Lịch đang hoạt động',
		lastSuccess: isEn ? 'Last successful output' : 'Kết quả tốt gần nhất',
		noSuccessYet: isEn ? 'No successful output yet' : 'Chưa có kết quả thành công',
		nextWork: isEn ? 'Next scheduled work' : 'Lượt làm việc kế tiếp',
		noUpcomingWork: isEn ? 'No upcoming run' : 'Chưa có lượt sắp tới',
		draftSafety: isEn ? 'Publishing policy' : 'Chính sách xuất bản',
		draftOnly: isEn ? 'Draft only — you stay in control' : 'Chỉ tạo bản nháp — bạn luôn kiểm soát',
		todayQueue: isEn ? 'OpenClaw work queue' : 'Hàng đợi công việc OpenClaw',
		todayQueueHint: isEn
			? 'Running and retrying work updates here automatically.'
			: 'Các lượt đang chạy hoặc tự thử lại sẽ cập nhật tự động tại đây.',
		noActiveWork: isEn ? 'No work is running right now.' : 'Hiện không có lượt nào đang chạy.',
		attentionTitle: isEn ? 'Needs your attention' : 'Cần bạn xử lý',
		noIncidents: isEn ? 'Nothing needs your attention.' : 'Không có sự cố nào cần bạn can thiệp.',
		retrying: isEn ? 'Retrying automatically' : 'Đang tự thử lại',
		retryHint: isEn
			? 'The same run is kept; no duplicate draft is created.'
			: 'Hệ thống giữ nguyên lượt chạy, không tạo bản nháp trùng.',
		newSchedule: isEn ? 'New schedule' : 'Tạo lịch',
		closeComposer: isEn ? 'Close form' : 'Đóng biểu mẫu',
		edit: isEn ? 'Edit' : 'Sửa',
		runNow: isEn ? 'Run now' : 'Chạy ngay',
		running: isEn ? 'Running…' : 'Đang chạy…',
		liveRunning: isEn ? 'Running now…' : 'Đang chạy…',
		liveRunningHint: isEn ? 'Live — updating automatically' : 'Đang cập nhật tự động',
		recoverRunNow: isEn ? 'Recover run request' : 'Khôi phục yêu cầu chạy',
		syncDelayed: isEn
			? 'Status sync is temporarily delayed. The information below may be stale.'
			: 'Đồng bộ trạng thái đang tạm chậm. Thông tin bên dưới có thể chưa mới nhất.',
		lastSynced: isEn ? 'Last successful sync' : 'Đồng bộ thành công gần nhất',
		longRunning: isEn
			? 'This run has taken more than 90 minutes. Status checks continue every 30 seconds.'
			: 'Lần chạy đã kéo dài hơn 90 phút. Hệ thống tiếp tục kiểm tra mỗi 30 giây.',
		runStarted: isEn
			? 'Run started. The draft will appear in recent results when it finishes.'
			: 'Đã bắt đầu chạy. Bản nháp sẽ xuất hiện trong kết quả gần đây khi hoàn tất.',
		runNowDisabled: isEn
			? 'The SEO Agent is off. Enable it in Blog OpenClaw Settings (BOS) before running now.'
			: 'SEO Agent đang tắt. Hãy bật trong Lõi Blog OpenClaw (BOS) trước khi chạy ngay.',
		pause: isEn ? 'Pause' : 'Tạm dừng',
		resume: isEn ? 'Resume' : 'Chạy lại',
		remove: isEn ? 'Delete' : 'Xoá',
		confirmDelete: isEn ? 'Delete this schedule?' : 'Xoá lịch này?',
		confirmDeleteYes: isEn ? 'Delete' : 'Xoá lịch',
		confirmDeleteNo: isEn ? 'Keep' : 'Giữ lại',
		recentResults: isEn ? 'Recent results' : 'Kết quả gần đây',
		hideResults: isEn ? 'Hide results' : 'Ẩn kết quả',
		loadingResults: isEn ? 'Loading results…' : 'Đang tải kết quả…',
		noResults: isEn ? 'No runs recorded yet.' : 'Chưa có lần chạy nào.',
		topicRoadmap: isEn ? 'Topic roadmap' : 'Kế hoạch chủ đề',
		hideRoadmap: isEn ? 'Hide roadmap' : 'Ẩn kế hoạch chủ đề',
		openDraft: isEn ? 'Open draft' : 'Mở bản nháp',
		saved: isEn ? 'Schedule saved.' : 'Đã lưu lịch.',
		deleted: isEn ? 'Schedule deleted.' : 'Đã xoá lịch.',
		loadFailed: isEn
			? 'Unable to load blog schedules. Please try again shortly.'
			: 'Không thể tải lịch Blog. Vui lòng thử lại sau.',
		requestFailed: isEn
			? 'The request failed. Please try again.'
			: 'Yêu cầu không thành công. Vui lòng thử lại.',
		reference: isEn ? 'Reference' : 'Mã tra cứu',
		errors: {
			name: {
				required: isEn ? 'Schedule name is required.' : 'Vui lòng nhập tên lịch.',
				too_long: isEn
					? 'Schedule name is too long (max 120).'
					: 'Tên lịch quá dài (tối đa 120 ký tự).'
			},
			direction: {
				required: isEn ? 'Topic / direction is required.' : 'Vui lòng nhập chủ đề / định hướng.',
				too_long: isEn
					? 'Topic / direction is too long (max 500).'
					: 'Chủ đề / định hướng quá dài (tối đa 500 ký tự).'
			},
			times: {
				required: isEn ? 'Enter at least one HH:mm time.' : 'Vui lòng nhập ít nhất một giờ HH:mm.',
				invalid: isEn
					? 'Times must use the HH:mm format, separated by commas.'
					: 'Giờ chạy phải theo định dạng HH:mm, phân cách bằng dấu phẩy.',
				too_many: isEn ? 'At most 12 times per day.' : 'Tối đa 12 giờ chạy mỗi ngày.'
			},
			startDate: {
				required: isEn ? 'Start date is required.' : 'Vui lòng chọn ngày bắt đầu.',
				invalid: isEn ? 'Start date is invalid.' : 'Ngày bắt đầu không hợp lệ.'
			},
			endDate: {
				invalid: isEn ? 'End date is invalid.' : 'Ngày kết thúc không hợp lệ.',
				before_start: isEn
					? 'End date cannot be earlier than start date.'
					: 'Ngày kết thúc không được sớm hơn ngày bắt đầu.'
			}
		}
	});

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com') {
			return path;
		}
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
	};

	const errorText = (field) => {
		const code = formErrors?.[field];
		if (!code) return '';
		return t.errors[field]?.[code] || '';
	};

	const apiRequest = async (path, options = {}) => {
		let response;
		try {
			response = await fetch(resolveAdminPath(path), {
				...options,
				headers: {
					...(options.body ? { 'content-type': 'application/json' } : {}),
					...(options.headers || {})
				}
			});
		} catch (cause) {
			throw Object.assign(
				new Error(isEn ? 'The request could not be delivered.' : 'Không thể gửi yêu cầu.'),
				{ status: 0, code: 'OPENCLAW_BACKEND_UNAVAILABLE', cause }
			);
		}
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			throw Object.assign(
				new Error(payload?.error || (isEn ? 'The request failed.' : 'Yêu cầu không thành công.')),
				{
					status: response.status,
					code: String(payload?.errorCode || ''),
					requestId: String(payload?.requestId || '')
				}
			);
		}
		return payload;
	};

	const safeRequestId = (value) => {
		const candidate = String(value || '').trim();
		return /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : '';
	};

	const withRequestReference = (message, requestId) => {
		const safeId = safeRequestId(requestId);
		return safeId ? `${message} · ${t.reference}: ${safeId}` : message;
	};

	const requestErrorText = (caught) => {
		const code = String(caught?.code || caught?.errorCode || '').trim();
		const rawMessage = String(caught?.message || caught || '')
			.trim()
			.slice(0, 260);
		const isTransportFailure = new Set([
			'OPENCLAW_BACKEND_UNAVAILABLE',
			'OPENCLAW_BACKEND_TIMEOUT',
			'OPENCLAW_BACKEND_ERROR',
			'OPENCLAW_BACKEND_INVALID_RESPONSE',
			'OPENCLAW_UPSTREAM_FAILURE',
			'OPENCLAW_MALFORMED_RESPONSE'
		]).has(code);
		const isGenericFailure =
			!rawMessage ||
			/^(?:Internal Server Error|Unable to load blog schedules|The request failed\.?|Request failed\.?)$/i.test(
				rawMessage
			);
		const message = isTransportFailure || isGenericFailure ? t.requestFailed : rawMessage;
		return withRequestReference(message, caught?.requestId);
	};

	const pageErrorText = $derived(
		pageError === 'BLOG_SCHEDULES_LOAD_FAILED'
			? withRequestReference(t.loadFailed, data?.loadRequestId)
			: pageError
	);

	const refreshSchedules = async (signal) => {
		const payload = await apiRequest('/admin/api/openclaw/blog-schedules?limit=50&page=1', {
			signal
		});
		const nextSchedules = Array.isArray(payload?.schedules) ? payload.schedules : [];
		schedules = nextSchedules;
		uncertainRunNowIds = nextSchedules
			.filter((schedule) =>
				runNowIdempotency.peek({ action: 'schedule-run-now', profile: String(schedule.id) })
			)
			.map((schedule) => schedule.id);
		return nextSchedules;
	};

	const startUiActivity = ({ action, title, entityId = '' }) => {
		const key = `blog-schedule:${entityId || 'collection'}:${action}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
		openClawActivityStore.upsert({
			key,
			domain: 'blog-schedule',
			entityId,
			action,
			title,
			status: 'running',
			message: isEn ? 'Request in progress…' : 'Đang xử lý yêu cầu…'
		});
		return key;
	};

	const finishUiActivity = (key, status, message) => {
		const current = openClawActivityStore.find((item) => item.key === key);
		if (!current || current.status !== 'running') return;
		openClawActivityStore.upsert({ key, status, rawStatus: status, message });
	};

	const startCreate = () => {
		form = emptyForm();
		formErrors = {};
		formMessage = '';
		formOpen = true;
	};

	const startEdit = (schedule) => {
		form = scheduleToSimpleForm(schedule);
		formErrors = {};
		formMessage = '';
		formOpen = true;
	};

	const closeForm = () => {
		form = emptyForm();
		formErrors = {};
		formOpen = false;
	};

	const submitForm = async (event) => {
		event.preventDefault();
		if (saving) return;
		formMessage = '';
		const result = validateSimpleScheduleForm(form);
		formErrors = result.errors;
		if (!result.valid) return;
		saving = true;
		pageError = '';
		const activityKey = startUiActivity({
			action: form.id ? 'update' : 'create',
			entityId: form.id,
			title: `${form.id ? t.editTitle : t.createTitle}: ${form.name}`
		});
		try {
			const payload = buildSimpleSchedulePayload(form);
			if (form.id) {
				await apiRequest(`/admin/api/openclaw/blog-schedules/${encodeURIComponent(form.id)}`, {
					method: 'PATCH',
					body: JSON.stringify(payload)
				});
			} else {
				await apiRequest('/admin/api/openclaw/blog-schedules', {
					method: 'POST',
					body: JSON.stringify(payload)
				});
			}
			finishUiActivity(activityKey, 'succeeded', t.saved);
			await refreshSchedules();
			form = emptyForm();
			formErrors = {};
			formOpen = false;
			formMessage = t.saved;
		} catch (error) {
			pageError = requestErrorText(error);
			finishUiActivity(activityKey, 'failed', pageError);
		} finally {
			saving = false;
		}
	};

	const setEnabled = async (schedule, enabled) => {
		if (busyScheduleId) return;
		busyScheduleId = schedule.id;
		pageError = '';
		const activityKey = startUiActivity({
			action: enabled ? 'resume' : 'pause',
			entityId: schedule.id,
			title: `${enabled ? t.resume : t.pause}: ${schedule.name}`
		});
		try {
			await apiRequest(
				`/admin/api/openclaw/blog-schedules/${encodeURIComponent(schedule.id)}/${enabled ? 'resume' : 'pause'}`,
				{ method: 'POST' }
			);
			finishUiActivity(activityKey, 'succeeded', enabled ? t.resume : t.pause);
			await refreshSchedules();
		} catch (error) {
			pageError = requestErrorText(error);
			finishUiActivity(activityKey, 'failed', pageError);
		} finally {
			busyScheduleId = '';
		}
	};

	const deleteSchedule = async (schedule) => {
		if (busyScheduleId) return;
		busyScheduleId = schedule.id;
		pageError = '';
		const activityKey = startUiActivity({
			action: 'delete',
			entityId: schedule.id,
			title: `${t.remove}: ${schedule.name}`
		});
		try {
			await apiRequest(`/admin/api/openclaw/blog-schedules/${encodeURIComponent(schedule.id)}`, {
				method: 'DELETE'
			});
			finishUiActivity(activityKey, 'succeeded', t.deleted);
			confirmDeleteId = '';
			if (form.id === schedule.id) form = emptyForm();
			if (detailScheduleId === schedule.id) {
				detailScheduleId = '';
				resultsOpen = false;
				roadmapOpen = false;
				expandedExecutions = [];
				expandedError = '';
			}
			await refreshSchedules();
			formMessage = t.deleted;
		} catch (error) {
			pageError = requestErrorText(error);
			finishUiActivity(activityKey, 'failed', pageError);
		} finally {
			busyScheduleId = '';
		}
	};

	const fetchExecutions = async (scheduleId, limit = 5, signal) => {
		const payload = await apiRequest(
			`/admin/api/openclaw/blog-schedules/${encodeURIComponent(scheduleId)}/executions?limit=${limit}`,
			{ signal }
		);
		return Array.isArray(payload?.executions) ? payload.executions : [];
	};

	const fetchExecutionSummaries = async (scheduleIds, limit = 1, signal) => {
		const request = buildExecutionSummariesRequest(scheduleIds, limit);
		if (!request) return [];
		const payload = await apiRequest(request.url, { signal });
		return Array.isArray(payload?.summaries) ? payload.summaries : [];
	};

	const loadExecutions = async (scheduleId) => {
		expandedError = '';
		expandedLoading = true;
		try {
			expandedExecutions = await fetchExecutions(scheduleId);
		} catch (error) {
			expandedError = requestErrorText(error);
		} finally {
			expandedLoading = false;
		}
	};

	const executionActivity = (schedule, execution, wasLive = false) => {
		if (!execution?.id) return;
		const existing = openClawActivityStore.find(
			(item) => item.domain === 'blog-schedule' && item.runId === String(execution.id)
		);
		const activityKey =
			executionActivityKeys.get(String(execution.id)) ||
			existing?.key ||
			`blog-schedule:${schedule.id}:${execution.id}`;
		executionActivityKeys.set(String(execution.id), activityKey);

		const running = isActiveStatus(execution.status);
		if (!running && !wasLive && existing?.status !== 'running') return;
		const resultStatus = openClawActivityStatus(execution.status);
		const outcomeCode = execution.metadata?.outcomeCode || '';
		const errorCode = execution.errorCode || execution.error || schedule.lastError || '';
		const displayCode = outcomeCode || errorCode;
		const decisionReason = execution.metadata?.decisionReason || '';
		openClawActivityStore.upsert({
			key: activityKey,
			domain: 'blog-schedule',
			entityId: schedule.id,
			runId: execution.id,
			action: 'run',
			title: schedule.name || t.title,
			status: resultStatus,
			rawStatus: execution.status,
			message: displayCode
				? simpleExecutionErrorLabel(displayCode, isEn)
				: decisionReason
					? simpleDecisionReasonLabel(decisionReason, isEn)
					: simpleResultLabel(execution.status, isEn)
		});
	};

	const pollSchedules = async ({ signal }) => {
		const previousLive = new SvelteSet(liveRunningIds);
		const freshSchedules = await refreshSchedules(signal);
		// Five bounded summaries per schedule are enough to recover the last
		// successful artifact even when a newer run is retrying or failed.
		const summaryLimit = 5;
		const probes = await fetchExecutionSummaries(
			freshSchedules.map((schedule) => schedule.id),
			summaryLimit,
			signal
		);
		executionSummaries = probes;

		const nextLive = new SvelteSet();
		const activeStartTimes = [];
		for (const { scheduleId, executions } of probes) {
			const schedule = freshSchedules.find((item) => item.id === scheduleId);
			if (!schedule) {
				nextLive.delete(scheduleId);
				continue;
			}
			if (resultsOpen && detailScheduleId === scheduleId) {
				expandedExecutions = executions;
				expandedError = '';
				expandedLoading = false;
			}

			const trackedId = trackedExecutionIds.get(scheduleId);
			const execution =
				(trackedId && executions.find((item) => String(item.id) === String(trackedId))) ||
				executions[0];
			if (execution && isActiveStatus(execution.status)) {
				nextLive.add(scheduleId);
				const startedAt = new Date(
					execution.startedAt || execution.queuedAt || execution.createdAt || 0
				).getTime();
				if (Number.isFinite(startedAt) && startedAt > 0) activeStartTimes.push(startedAt);
				trackedExecutionIds.set(scheduleId, execution.id);
				executionActivity(schedule, execution, previousLive.has(scheduleId));
			} else if (runNowBusyId === scheduleId && !trackedId) {
				nextLive.add(scheduleId);
			} else {
				nextLive.delete(scheduleId);
				if (execution && isTerminalStatus(execution.status)) {
					executionActivity(schedule, execution, previousLive.has(scheduleId));
				}
				trackedExecutionIds.delete(scheduleId);
			}
		}

		liveRunningIds = [...nextLive];
		pollingNotice = '';
		lastSuccessfulSyncAt = Date.now();
		return {
			active: nextLive.size > 0,
			activeSince: activeStartTimes.length ? Math.min(...activeStartTimes) : undefined
		};
	};

	const finalScheduleRefresh = async () => {
		const freshSchedules = await refreshSchedules();
		if (resultsOpen && detailScheduleId) {
			const summaries = await fetchExecutionSummaries(
				freshSchedules.map((schedule) => schedule.id),
				5
			);
			expandedExecutions =
				summaries.find((summary) => summary.scheduleId === detailScheduleId)?.executions || [];
			expandedError = '';
		}
	};

	onMount(() => {
		schedulePoller = createSmartPoller({
			poll: pollSchedules,
			activeIntervalMs: 3000,
			idleIntervalMs: 30000,
			longRunningIntervalMs: 30000,
			onResult: (_result, meta) => {
				pollingNotice = meta.slow ? t.longRunning : '';
			},
			onSettled: finalScheduleRefresh,
			onSyncError: () => {
				pollingNotice = t.syncDelayed;
			}
		});
		schedulePoller.start();
	});

	onDestroy(() => schedulePoller?.stop());

	const selectDetailSchedule = (schedule) => {
		if (detailScheduleId === schedule.id) return;
		detailScheduleId = schedule.id;
		resultsOpen = false;
		roadmapOpen = false;
		expandedExecutions = [];
		expandedError = '';
	};

	const toggleResults = async (schedule) => {
		selectDetailSchedule(schedule);
		resultsOpen = !resultsOpen;
		if (!resultsOpen) {
			expandedExecutions = [];
			expandedError = '';
			return;
		}
		await loadExecutions(schedule.id);
	};

	const toggleRoadmap = (schedule) => {
		selectDetailSchedule(schedule);
		roadmapOpen = !roadmapOpen;
	};

	// One-off, draft-only execution of a specific schedule. The backend claims a
	// lease and enforces idempotency, so a retry or double-click cannot create a
	// duplicate run; the schedule's direction still flows through the full
	// duplicate/skip decision.
	const runScheduleNow = async (schedule) => {
		if (runNowBusyId) return;
		const actionSlot = { action: 'schedule-run-now', profile: String(schedule.id) };
		const idempotencyKey = runNowIdempotency.acquire(actionSlot);
		runNowBusyId = schedule.id;
		pageError = '';
		formMessage = '';
		if (!liveRunningIds.includes(schedule.id)) {
			liveRunningIds = [...liveRunningIds, schedule.id];
		}
		const activityKey = `blog-schedule:${schedule.id}:manual:${Date.now()}`;
		openClawActivityStore.upsert({
			key: activityKey,
			domain: 'blog-schedule',
			entityId: schedule.id,
			action: 'run',
			title: schedule.name || t.title,
			status: 'running',
			rawStatus: 'queued',
			message: t.runStarted
		});
		schedulePoller?.poke('run-requested');
		try {
			const result = await apiRequest(
				`/admin/api/openclaw/blog-schedules/${encodeURIComponent(schedule.id)}/run-now`,
				{ method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } }
			);
			runNowIdempotency.clear({ ...actionSlot, key: idempotencyKey });
			uncertainRunNowIds = uncertainRunNowIds.filter((id) => id !== schedule.id);
			formMessage = t.runStarted;
			detailScheduleId = schedule.id;
			resultsOpen = true;
			expandedLoading = true;
			if (result?.executionId) {
				trackedExecutionIds.set(schedule.id, result.executionId);
				executionActivityKeys.set(String(result.executionId), activityKey);
				openClawActivityStore.upsert({
					key: activityKey,
					runId: result.executionId,
					status: 'running',
					rawStatus: result.status || 'queued'
				});
			}
			schedulePoller?.poke('run-now');
		} catch (error) {
			const uncertain = shouldRetainOpenClawActionKey(error?.status);
			if (uncertain) {
				if (!uncertainRunNowIds.includes(schedule.id)) {
					uncertainRunNowIds = [...uncertainRunNowIds, schedule.id];
				}
			} else {
				runNowIdempotency.clear({ ...actionSlot, key: idempotencyKey });
				uncertainRunNowIds = uncertainRunNowIds.filter((id) => id !== schedule.id);
			}
			const isSeoAgentDisabled = /SEO_AGENT_ENABLED/i.test(
				`${error?.code || ''} ${error?.message || ''}`
			);
			pageError = isSeoAgentDisabled
				? withRequestReference(t.runNowDisabled, error?.requestId)
				: requestErrorText(error);
			liveRunningIds = liveRunningIds.filter((id) => id !== schedule.id);
			trackedExecutionIds.delete(schedule.id);
			openClawActivityStore.upsert({
				key: activityKey,
				status: uncertain ? 'running' : 'failed',
				rawStatus: uncertain ? 'delivery_uncertain' : 'failed',
				message: pageError
			});
		} finally {
			runNowBusyId = '';
		}
	};

	const periodText = (schedule) => {
		const start = dateInVietnam(schedule.startAt);
		const end = dateInVietnam(schedule.endAt);
		if (!start && !end) return t.openEnded;
		return `${start || '…'} → ${end || t.openEnded}`;
	};

	const retryDetail = (execution) => {
		const attempt = Number(execution?.attemptCount || execution?.metadata?.attemptCount || 0);
		const maximum = Number(execution?.maxAttempts || execution?.metadata?.maxAttempts || 0);
		if (!attempt || !maximum) return t.retryHint;
		return isEn
			? `Attempt ${attempt}/${maximum}. ${t.retryHint}`
			: `Lần thử ${attempt}/${maximum}. ${t.retryHint}`;
	};
</script>

<svelte:head>
	<title>{t.title} · INOXPRAN Admin</title>
</svelte:head>

<div class="bs-page">
	<header class="bs-hero">
		<div class="bs-hero__copy">
			<p class="bs-kicker">OPENCLAW · BLOG AUTOPILOT</p>
			<h1>{t.title}</h1>
			<p>{t.subtitle}</p>
		</div>
		<div class="bs-hero__actions">
			<button type="button" class="bs-btn bs-btn--primary" onclick={startCreate}>
				<span aria-hidden="true">＋</span>
				{t.newSchedule}
			</button>
			<a
				class="bs-btn bs-btn--quiet"
				href={resolve(resolveAdminPath('/admin/openclaw/blogs/settings'))}
			>
				<span aria-hidden="true">⌁</span>
				{t.settingsLink}
			</a>
		</div>
	</header>

	{#if pageErrorText}
		<div class="bs-alert" role="alert">{pageErrorText}</div>
	{/if}
	{#if formMessage}
		<div class="bs-notice" role="status">{formMessage}</div>
	{/if}
	{#if pollingNotice}
		<div class="bs-notice bs-notice--sync" role="status">
			{pollingNotice}
			{#if lastSuccessfulSyncAt}
				<small>
					{t.lastSynced}: {dateTimeInVietnam(lastSuccessfulSyncAt, isEn ? 'en-GB' : 'vi-VN')}
				</small>
			{/if}
		</div>
	{/if}

	<section class="bs-overview" aria-label={t.overview}>
		<div class="bs-section-heading">
			<div>
				<p class="bs-section-heading__eyebrow">{t.overview}</p>
				<h2>{isEn ? 'You can leave this running.' : 'Bạn có thể yên tâm rời máy.'}</h2>
			</div>
			<span class="bs-live-stamp">
				<span class="bs-live-dot" class:is-warning={issueScheduleCount > 0}></span>
				{issueScheduleCount > 0 ? t.needsAttention : t.workingNormally}
			</span>
		</div>

		<div class="bs-metrics">
			<article class="bs-metric bs-metric--state">
				<p>{t.systemState}</p>
				<strong>{issueScheduleCount > 0 ? t.needsAttention : t.workingNormally}</strong>
				<span>
					{#if liveRunningIds.length}
						{liveRunningIds.length} {isEn ? 'run(s) in progress' : 'lượt đang xử lý'}
					{:else}
						{isEn ? 'Monitoring schedules continuously' : 'Theo dõi lịch liên tục'}
					{/if}
				</span>
			</article>
			<article class="bs-metric">
				<p>{t.activeSchedules}</p>
				<strong>{activeScheduleCount}</strong>
				<span>{schedules.length} {isEn ? 'configured' : 'lịch đã cấu hình'}</span>
			</article>
			<article class="bs-metric">
				<p>{t.lastSuccess}</p>
				{#if latestSuccessfulExecution}
					<strong class="bs-metric__time">
						{dateTimeInVietnam(
							latestSuccessfulExecution.execution.completedAt ||
								latestSuccessfulExecution.execution.createdAt,
							isEn ? 'en-GB' : 'vi-VN'
						)}
					</strong>
					{#if latestSuccessfulExecution.execution.blogId}
						<a
							href={resolve(
								resolveAdminPath(`/admin/blogs/${latestSuccessfulExecution.execution.blogId}`)
							)}>{t.openDraft} →</a
						>
					{:else}
						<span>{latestSuccessfulExecution.schedule?.name || t.lastResult}</span>
					{/if}
				{:else}
					<strong class="bs-metric__empty">—</strong>
					<span>{t.noSuccessYet}</span>
				{/if}
			</article>
			<article class="bs-metric">
				<p>{t.nextWork}</p>
				{#if nextSchedule}
					<strong class="bs-metric__time">
						{dateTimeInVietnam(nextSchedule.nextRunAt, isEn ? 'en-GB' : 'vi-VN')}
					</strong>
					<span>{nextSchedule.name}</span>
				{:else}
					<strong class="bs-metric__empty">—</strong>
					<span>{t.noUpcomingWork}</span>
				{/if}
			</article>
		</div>

		<div class="bs-safety-note">
			<span aria-hidden="true">✓</span>
			<div>
				<strong>{t.draftSafety}</strong>
				<p>{t.draftOnly}</p>
			</div>
		</div>
	</section>

	<div class="bs-operator-grid">
		<section class="bs-operator-card" aria-label={t.todayQueue}>
			<header>
				<div>
					<p class="bs-section-heading__eyebrow">{t.todayQueue}</p>
					<h2>{activeExecutionRows.length ? t.liveRunning : t.noActiveWork}</h2>
				</div>
				<span class="bs-count">{activeExecutionRows.length}</span>
			</header>
			<p class="bs-card-hint">{t.todayQueueHint}</p>

			{#if activeExecutionRows.length}
				<ul class="bs-work-list">
					{#each activeExecutionRows as row (row.execution.id)}
						<li>
							<span class="bs-work-icon">
								<span class="bs-spinner" aria-hidden="true"></span>
							</span>
							<div>
								<strong>{row.schedule?.name || t.title}</strong>
								<p>
									{row.execution.status === 'retry_wait'
										? t.retrying
										: simpleResultLabel(row.execution.status, isEn)}
								</p>
								{#if row.execution.status === 'retry_wait'}
									<small>{retryDetail(row.execution)}</small>
								{/if}
							</div>
							<time>
								{dateTimeInVietnam(
									row.execution.startedAt || row.execution.createdAt,
									isEn ? 'en-GB' : 'vi-VN'
								)}
							</time>
						</li>
					{/each}
				</ul>
			{:else}
				<div class="bs-calm-empty">
					<span aria-hidden="true">✓</span>
					<p>
						{isEn
							? 'OpenClaw is ready for the next scheduled run.'
							: 'OpenClaw đang sẵn sàng cho lượt tiếp theo.'}
					</p>
				</div>
			{/if}
		</section>

		<section class="bs-operator-card bs-operator-card--attention" aria-label={t.attentionTitle}>
			<header>
				<div>
					<p class="bs-section-heading__eyebrow">{t.attentionTitle}</p>
					<h2>{operatorIncidents.length ? t.needsAttention : t.noIncidents}</h2>
				</div>
				<span class="bs-count" class:is-alert={operatorIncidents.length > 0}>
					{operatorIncidents.length}
				</span>
			</header>
			{#if operatorIncidents.length}
				<ul class="bs-incident-list">
					{#each operatorIncidents as row (row.execution.id)}
						<li>
							<div>
								<strong>{row.schedule?.name || t.title}</strong>
								<p>
									{simpleExecutionErrorLabel(
										row.execution.errorCode ||
											row.execution.error ||
											row.execution.metadata?.outcomeCode,
										isEn
									)}
								</p>
								<small>
									{dateTimeInVietnam(
										row.execution.completedAt || row.execution.createdAt,
										isEn ? 'en-GB' : 'vi-VN'
									)}
								</small>
							</div>
							{#if row.schedule}
								<button
									type="button"
									class="bs-btn bs-btn--small"
									onclick={() => toggleResults(row.schedule)}
								>
									{isEn ? 'Inspect' : 'Xem lượt chạy'}
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<div class="bs-calm-empty">
					<span aria-hidden="true">✓</span>
					<p>
						{isEn
							? 'Retries and safety checks are handled automatically.'
							: 'Retry và các chốt an toàn đang được xử lý tự động.'}
					</p>
				</div>
			{/if}
		</section>
	</div>

	{#if formOpen}
		<section class="bs-composer" aria-label={isEditing ? t.editTitle : t.createTitle}>
			<header class="bs-composer__head">
				<div>
					<p class="bs-section-heading__eyebrow">{isEn ? 'Simple brief' : 'Brief đơn giản'}</p>
					<h2>{isEditing ? t.editTitle : t.createTitle}</h2>
					<p>
						{isEn
							? 'Give OpenClaw a direction and time. The agents handle topic research, originality and drafting.'
							: 'Bạn chỉ nhập định hướng và giờ chạy. Các agent tự lo nghiên cứu, kiểm tra trùng lặp và viết bài.'}
					</p>
				</div>
				<button type="button" class="bs-icon-btn" onclick={closeForm} aria-label={t.closeComposer}>
					×
				</button>
			</header>

			<form class="bs-form" onsubmit={submitForm} novalidate>
				<fieldset class="bs-fieldset">
					<legend>{t.basicsLegend}</legend>
					<label class="bs-field">
						<span class="bs-field__label">{t.nameLabel} *</span>
						<input
							type="text"
							name="name"
							maxlength="120"
							bind:value={form.name}
							placeholder={t.namePlaceholder}
							aria-invalid={Boolean(errorText('name'))}
							aria-describedby={errorText('name') ? 'blog-schedule-name-error' : undefined}
							required
						/>
						{#if errorText('name')}<span id="blog-schedule-name-error" class="bs-field__error"
								>{errorText('name')}</span
							>{/if}
					</label>
				</fieldset>

				<fieldset class="bs-fieldset bs-fieldset--wide">
					<legend>{t.directionLegend}</legend>
					<label class="bs-field">
						<span class="bs-field__label">{t.directionLabel} *</span>
						<textarea
							name="direction"
							rows="4"
							maxlength="500"
							bind:value={form.direction}
							placeholder={t.directionPlaceholder}
							aria-invalid={Boolean(errorText('direction'))}
							aria-describedby={errorText('direction')
								? 'blog-schedule-direction-error'
								: undefined}
							required
						></textarea>
						<span class="bs-field__hint">{t.directionHint}</span>
						{#if errorText('direction')}
							<span id="blog-schedule-direction-error" class="bs-field__error"
								>{errorText('direction')}</span
							>
						{/if}
					</label>
				</fieldset>

				<fieldset class="bs-fieldset">
					<legend>{t.timesLegend}</legend>
					<label class="bs-field">
						<span class="bs-field__label">{t.timesLabel} *</span>
						<input
							type="text"
							name="times"
							bind:value={form.times}
							placeholder="08:30, 14:00, 20:15"
							aria-invalid={Boolean(errorText('times'))}
							aria-describedby={errorText('times') ? 'blog-schedule-times-error' : undefined}
							required
						/>
						<span class="bs-field__hint">{t.timesHelper}</span>
						<span class="bs-field__hint">{t.timezoneHelper}</span>
						{#if errorText('times')}<span id="blog-schedule-times-error" class="bs-field__error"
								>{errorText('times')}</span
							>{/if}
					</label>
				</fieldset>

				<fieldset class="bs-fieldset">
					<legend>{t.windowLegend}</legend>
					<div class="bs-field-row">
						<label class="bs-field">
							<span class="bs-field__label">{t.startLabel} *</span>
							<input
								type="date"
								name="startDate"
								bind:value={form.startDate}
								aria-invalid={Boolean(errorText('startDate'))}
								aria-describedby={errorText('startDate') ? 'blog-schedule-start-error' : undefined}
								required
							/>
							{#if errorText('startDate')}
								<span id="blog-schedule-start-error" class="bs-field__error"
									>{errorText('startDate')}</span
								>
							{/if}
						</label>
						<label class="bs-field">
							<span class="bs-field__label">{t.endLabel}</span>
							<input
								type="date"
								name="endDate"
								bind:value={form.endDate}
								aria-invalid={Boolean(errorText('endDate'))}
								aria-describedby={errorText('endDate') ? 'blog-schedule-end-error' : undefined}
							/>
							<span class="bs-field__hint">{t.endHint}</span>
							{#if errorText('endDate')}
								<span id="blog-schedule-end-error" class="bs-field__error"
									>{errorText('endDate')}</span
								>
							{/if}
						</label>
					</div>
				</fieldset>

				<div class="bs-form__actions">
					<button type="submit" class="bs-btn bs-btn--primary" disabled={saving}>
						{saving ? t.saving : t.save}
					</button>
					<button
						type="button"
						class="bs-btn"
						onclick={isEditing ? closeForm : startCreate}
						disabled={saving}
					>
						{isEditing ? t.cancel : t.reset}
					</button>
				</div>
			</form>
		</section>
	{/if}

	<section class="bs-panel bs-panel--list" aria-label={t.listTitle}>
		<div class="bs-panel__head">
			<div>
				<p class="bs-section-heading__eyebrow">{isEn ? 'Automation plan' : 'Kế hoạch tự động'}</p>
				<h2>{t.listTitle}</h2>
			</div>
			<span class="bs-count">{schedules.length}</span>
		</div>

		{#if !schedules.length}
			<div class="bs-empty">
				<p class="bs-empty__title">{t.empty}</p>
				<p class="bs-empty__hint">{t.emptyHint}</p>
				<button type="button" class="bs-btn bs-btn--primary" onclick={startCreate}
					>{t.newSchedule}</button
				>
			</div>
		{:else}
			<ul class="bs-list">
				{#each schedules as schedule (schedule.id)}
					<li class="bs-item" class:is-paused={!schedule.enabled}>
						<div class="bs-item__main">
							<div class="bs-item__top">
								<div>
									<p class="bs-item__name">{schedule.name}</p>
									<p class="bs-item__direction">{schedule.direction || schedule.description}</p>
								</div>
								<span
									class="bs-badge"
									class:is-good={schedule.enabled}
									class:is-muted={!schedule.enabled}
								>
									{schedule.enabled ? t.active : t.paused}
								</span>
							</div>
							<div class="bs-item__timeline">
								<span>
									<small>{t.runTimes}</small>
									<strong>{scheduleRunTimes(schedule).join(' · ') || '—'}</strong>
								</span>
								<span>
									<small>{t.nextRun}</small>
									<strong>
										{schedule.enabled && schedule.nextRunAt
											? dateTimeInVietnam(schedule.nextRunAt, isEn ? 'en-GB' : 'vi-VN')
											: t.notScheduled}
									</strong>
								</span>
								<span>
									<small>{t.period}</small>
									<strong>{periodText(schedule)}</strong>
								</span>
							</div>
						</div>

						<div class="bs-item__outcome">
							<small>{t.lastResult}</small>
							{#if liveRunningIds.includes(schedule.id)}
								<span class="bs-result bs-result--live">
									<span class="bs-spinner" aria-hidden="true"></span>
									{t.liveRunning}
								</span>
								<p>{t.liveRunningHint}</p>
							{:else}
								<span
									class="bs-result bs-result--{simpleExecutionTone(
										schedule.lastRunStatus,
										schedule.lastOutcomeCode || schedule.lastError
									)}"
								>
									{simpleResultLabel(
										simpleExecutionDisplayStatus(
											schedule.lastRunStatus,
											schedule.lastOutcomeCode || schedule.lastError
										),
										isEn
									)}
								</span>
								{#if schedule.lastOutcomeCode || schedule.lastError}
									<p>
										{simpleExecutionErrorLabel(
											schedule.lastOutcomeCode || schedule.lastError,
											isEn
										)}
									</p>
								{/if}
							{/if}
						</div>

						<div class="bs-item__actions">
							<button
								type="button"
								class="bs-btn bs-btn--run"
								disabled={runNowBusyId === schedule.id ||
									(liveRunningIds.includes(schedule.id) &&
										!uncertainRunNowIds.includes(schedule.id))}
								onclick={() => runScheduleNow(schedule)}
							>
								{runNowBusyId === schedule.id
									? t.running
									: uncertainRunNowIds.includes(schedule.id)
										? t.recoverRunNow
										: liveRunningIds.includes(schedule.id)
											? t.running
											: t.runNow}
							</button>
							<button
								type="button"
								class="bs-btn"
								onclick={() => toggleResults(schedule)}
								aria-expanded={detailScheduleId === schedule.id && resultsOpen}
							>
								{detailScheduleId === schedule.id && resultsOpen ? t.hideResults : t.recentResults}
							</button>
							<button
								type="button"
								class="bs-btn bs-btn--roadmap"
								onclick={() => toggleRoadmap(schedule)}
								aria-expanded={detailScheduleId === schedule.id && roadmapOpen}
							>
								{detailScheduleId === schedule.id && roadmapOpen ? t.hideRoadmap : t.topicRoadmap}
							</button>
							<button
								type="button"
								class="bs-btn bs-btn--quiet"
								onclick={() => startEdit(schedule)}
							>
								{t.edit}
							</button>
							<button
								type="button"
								class="bs-btn bs-btn--quiet"
								disabled={busyScheduleId === schedule.id}
								onclick={() => setEnabled(schedule, !schedule.enabled)}
							>
								{schedule.enabled ? t.pause : t.resume}
							</button>
							{#if confirmDeleteId === schedule.id}
								<span class="bs-confirm">
									{t.confirmDelete}
									<button
										type="button"
										class="bs-btn bs-btn--danger"
										disabled={busyScheduleId === schedule.id}
										onclick={() => deleteSchedule(schedule)}>{t.confirmDeleteYes}</button
									>
									<button type="button" class="bs-btn" onclick={() => (confirmDeleteId = '')}>
										{t.confirmDeleteNo}
									</button>
								</span>
							{:else}
								<button
									type="button"
									class="bs-btn bs-btn--danger-ghost"
									onclick={() => (confirmDeleteId = schedule.id)}>{t.remove}</button
								>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if detailSchedule}
		<section class="bs-detail" aria-label={detailSchedule.name}>
			<header class="bs-detail__head">
				<div>
					<p class="bs-detail__eyebrow">{detailSchedule.name}</p>
					<p>{detailSchedule.direction || detailSchedule.description}</p>
				</div>
				<button
					type="button"
					class="bs-btn bs-btn--ghost"
					onclick={() => {
						detailScheduleId = '';
						resultsOpen = false;
						roadmapOpen = false;
					}}>{isEn ? 'Close details' : 'Đóng chi tiết'}</button
				>
			</header>

			<details class="bs-disclosure" open={resultsOpen}>
				<summary
					onclick={(event) => {
						event.preventDefault();
						toggleResults(detailSchedule);
					}}>{t.recentResults}</summary
				>
				<div class="bs-results">
					{#if expandedLoading}
						<p class="bs-results__hint">{t.loadingResults}</p>
					{:else if expandedError}
						<p class="bs-results__error">{expandedError}</p>
					{:else if !expandedExecutions.length}
						<p class="bs-results__hint">{t.noResults}</p>
					{:else}
						<ul class="bs-results__list">
							{#each expandedExecutions as execution (execution.id)}
								{@const displayCode =
									execution.metadata?.outcomeCode || execution.errorCode || execution.error}
								<li>
									<span
										class="bs-result bs-result--{simpleExecutionTone(
											execution.status,
											displayCode
										)}"
									>
										{simpleResultLabel(
											simpleExecutionDisplayStatus(execution.status, displayCode),
											isEn
										)}
									</span>
									{#if execution.status === 'retry_wait'}
										<span class="bs-result-detail">{retryDetail(execution)}</span>
									{:else if displayCode}
										<span class="bs-result-detail">
											{simpleExecutionErrorLabel(displayCode, isEn)}
										</span>
									{:else if execution.metadata?.decisionReason}
										<span class="bs-result-detail bs-result-detail--decision">
											{simpleDecisionReasonLabel(execution.metadata.decisionReason, isEn)}
										</span>
									{/if}
									<span class="bs-results__time">
										{dateTimeInVietnam(
											execution.completedAt || execution.startedAt || execution.createdAt,
											isEn ? 'en-GB' : 'vi-VN'
										)}
									</span>
									{#if execution.blogId}
										<a
											class="bs-results__link"
											href={resolve(resolveAdminPath(`/admin/blogs/${execution.blogId}`))}
											>{t.openDraft}</a
										>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</details>

			<details class="bs-disclosure" open={roadmapOpen}>
				<summary
					onclick={(event) => {
						event.preventDefault();
						toggleRoadmap(detailSchedule);
					}}>{t.topicRoadmap}</summary
				>
				{#if roadmapOpen}
					{#key detailSchedule.id}
						<BlogTopicRoadmapPanel scheduleId={detailSchedule.id} />
					{/key}
				{/if}
			</details>
		</section>
	{/if}
</div>

<style>
	.bs-page {
		display: grid;
		gap: 18px;
		color: var(--admin-ink, #1a1f2e);
	}

	.bs-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.bs-subtitle {
		margin: 0;
		max-width: 560px;
		color: var(--admin-muted, #6b7280);
	}

	.bs-settings-link {
		font-size: 0.85rem;
		color: var(--admin-muted, #6b7280);
		text-decoration: none;
		border: 1px solid var(--admin-border, #e5e7eb);
		border-radius: 999px;
		padding: 6px 12px;
		white-space: nowrap;
	}

	.bs-settings-link:hover {
		color: var(--admin-accent, #0f766e);
		border-color: var(--admin-accent, #0f766e);
	}

	.bs-alert {
		border: 1px solid var(--admin-danger, #dc2626);
		background: rgba(220, 38, 38, 0.06);
		color: var(--admin-danger, #dc2626);
		border-radius: var(--admin-radius, 12px);
		padding: 10px 14px;
	}

	.bs-notice {
		border: 1px solid var(--admin-accent, #0f766e);
		background: var(--admin-accent-soft, rgba(15, 118, 110, 0.08));
		color: var(--admin-accent-strong, #065f5a);
		border-radius: var(--admin-radius, 12px);
		padding: 10px 14px;
	}

	.bs-notice--sync {
		border-color: #c89732;
		background: rgba(200, 151, 50, 0.08);
		color: #795817;
	}

	.bs-notice--sync small {
		display: block;
		margin-top: 3px;
		color: inherit;
		opacity: 0.8;
	}

	.bs-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(300px, 420px);
		gap: 18px;
		align-items: start;
		container-type: inline-size;
	}

	.bs-panel {
		background: var(--admin-surface, #ffffff);
		border: 1px solid var(--admin-border, #e5e7eb);
		border-radius: var(--admin-radius, 12px);
		padding: 18px;
		display: grid;
		gap: 14px;
	}

	.bs-panel__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.bs-panel__head h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.bs-count {
		font-size: 0.8rem;
		color: var(--admin-muted, #6b7280);
		border: 1px solid var(--admin-border, #e5e7eb);
		border-radius: 999px;
		padding: 2px 10px;
	}

	.bs-empty {
		text-align: center;
		padding: 28px 12px;
		border: 1px dashed var(--admin-border, #e5e7eb);
		border-radius: var(--admin-radius, 12px);
	}

	.bs-empty__title {
		margin: 0 0 6px;
		font-weight: 600;
	}

	.bs-empty__hint {
		margin: 0;
		color: var(--admin-muted, #6b7280);
	}

	.bs-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 12px;
	}

	.bs-item {
		border: 1px solid var(--admin-border, #e5e7eb);
		border-radius: var(--admin-radius, 12px);
		padding: 14px;
		display: grid;
		gap: 10px;
	}

	.bs-item.is-paused {
		background: #f9fafb;
	}

	.bs-item__top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 10px;
	}

	.bs-item__name {
		margin: 0;
		font-weight: 600;
	}

	.bs-item__direction {
		margin: 4px 0 0;
		color: var(--admin-muted, #6b7280);
		font-size: 0.9rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.bs-badge {
		font-size: 0.75rem;
		border-radius: 999px;
		padding: 3px 10px;
		border: 1px solid var(--admin-border, #e5e7eb);
		white-space: nowrap;
	}

	.bs-badge.is-good {
		color: var(--admin-accent-strong, #065f5a);
		border-color: var(--admin-accent, #0f766e);
		background: var(--admin-accent-soft, rgba(15, 118, 110, 0.08));
	}

	.bs-badge.is-muted {
		color: var(--admin-muted, #6b7280);
	}

	.bs-item__meta {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 8px 14px;
	}

	.bs-result {
		font-size: 0.85rem;
	}

	.bs-result--good {
		color: var(--admin-accent-strong, #065f5a);
	}

	.bs-result--danger {
		color: var(--admin-danger, #dc2626);
	}

	.bs-result--warning {
		color: #8a5a09;
		background: rgba(200, 151, 50, 0.12);
	}

	.bs-result--muted {
		color: var(--admin-muted, #6b7280);
	}

	.bs-result--live {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
		color: var(--admin-accent-strong, #065f5a);
	}

	.bs-result--live + .bs-result-detail {
		color: var(--admin-muted, #6b7280);
	}

	.bs-spinner {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
		border-top-color: currentColor;
		animation: bs-spin 0.7s linear infinite;
	}

	@keyframes bs-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bs-spinner {
			animation-duration: 2.4s;
		}
	}

	.bs-result-detail {
		display: block;
		margin-top: 4px;
		font-size: 0.76rem;
		line-height: 1.35;
		color: var(--admin-danger, #dc2626);
	}

	.bs-result-detail--decision {
		color: var(--admin-muted, #6b7280);
	}

	.bs-item__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.bs-btn {
		border: 1px solid var(--admin-border, #e5e7eb);
		background: var(--admin-surface, #ffffff);
		color: inherit;
		border-radius: 9px;
		padding: 6px 12px;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.bs-btn:hover:not(:disabled) {
		border-color: var(--admin-accent, #0f766e);
		color: var(--admin-accent, #0f766e);
	}

	.bs-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.bs-btn--primary {
		background: var(--admin-accent, #0f766e);
		border-color: var(--admin-accent, #0f766e);
		color: #ffffff;
		font-weight: 600;
	}

	.bs-btn--primary:hover:not(:disabled) {
		background: var(--admin-accent-strong, #065f5a);
		color: #ffffff;
	}

	.bs-btn--run {
		border-color: var(--admin-accent, #0f766e);
		color: var(--admin-accent, #0f766e);
		font-weight: 600;
	}

	.bs-btn--run:hover:not(:disabled) {
		background: var(--admin-accent-soft, rgba(15, 118, 110, 0.08));
	}

	.bs-btn--run:disabled {
		opacity: 0.55;
		cursor: wait;
	}

	.bs-btn--ghost {
		border-color: transparent;
		color: var(--admin-muted, #6b7280);
	}

	.bs-btn--roadmap {
		border-color: rgba(15, 118, 110, 0.28);
		background: var(--admin-accent-soft, rgba(15, 118, 110, 0.08));
		color: var(--admin-accent-strong, #065f5a);
		font-weight: 600;
	}

	.bs-btn--danger {
		background: var(--admin-danger, #dc2626);
		border-color: var(--admin-danger, #dc2626);
		color: #ffffff;
	}

	.bs-btn--danger-ghost {
		border-color: transparent;
		color: var(--admin-danger, #dc2626);
	}

	.bs-confirm {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 0.85rem;
		color: var(--admin-danger, #dc2626);
	}

	.bs-detail {
		min-width: 0;
		border: 1px solid var(--admin-border, #e5e7eb);
		border-radius: var(--admin-radius, 12px);
		background: var(--admin-surface, #fff);
		padding: 18px;
		display: grid;
		gap: 12px;
	}

	.bs-detail__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 14px;
		min-width: 0;
	}

	.bs-detail__head p {
		margin: 3px 0 0;
		color: var(--admin-muted, #6b7280);
		font-size: 0.86rem;
		overflow-wrap: anywhere;
	}

	.bs-detail__eyebrow {
		margin: 0 !important;
		color: var(--admin-ink, #1a1f2e) !important;
		font-weight: 700;
	}

	.bs-disclosure {
		min-width: 0;
		border: 1px solid var(--admin-border, #e5e7eb);
		border-radius: 10px;
		background: #fff;
		overflow: clip;
	}

	.bs-disclosure > summary {
		cursor: pointer;
		list-style: none;
		padding: 11px 14px;
		font-size: 0.9rem;
		font-weight: 700;
		background: #f9fafb;
	}

	.bs-disclosure > summary::-webkit-details-marker {
		display: none;
	}

	.bs-disclosure > summary::after {
		content: '+';
		float: right;
		color: var(--admin-muted, #6b7280);
	}

	.bs-disclosure[open] > summary::after {
		content: '–';
	}

	.bs-disclosure > :not(summary) {
		margin: 14px;
	}

	.bs-results {
		padding-top: 0;
	}

	.bs-results__hint {
		margin: 0;
		color: var(--admin-muted, #6b7280);
		font-size: 0.85rem;
	}

	.bs-results__error {
		margin: 0;
		color: var(--admin-danger, #dc2626);
		font-size: 0.85rem;
	}

	.bs-results__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}

	.bs-results__list li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 10px;
	}

	.bs-results__time {
		font-size: 0.78rem;
		color: var(--admin-muted, #6b7280);
	}

	.bs-results__link {
		font-size: 0.82rem;
		color: var(--admin-accent, #0f766e);
	}

	.bs-form {
		display: grid;
		gap: 14px;
	}

	.bs-fieldset {
		border: 1px solid var(--admin-border, #e5e7eb);
		border-radius: var(--admin-radius, 12px);
		padding: 12px 14px 14px;
		display: grid;
		gap: 10px;
		margin: 0;
	}

	.bs-fieldset legend {
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--admin-muted, #6b7280);
		padding: 0 6px;
	}

	.bs-field {
		display: grid;
		gap: 6px;
	}

	.bs-field__label {
		font-size: 0.88rem;
		font-weight: 500;
	}

	.bs-field input,
	.bs-field textarea {
		border: 1px solid var(--admin-border, #e5e7eb);
		border-radius: 9px;
		padding: 8px 10px;
		font: inherit;
		background: var(--admin-surface, #ffffff);
		color: inherit;
		width: 100%;
	}

	.bs-field input:focus,
	.bs-field textarea:focus {
		outline: 2px solid var(--admin-accent-soft, rgba(15, 118, 110, 0.25));
		border-color: var(--admin-accent, #0f766e);
	}

	.bs-field__hint {
		font-size: 0.78rem;
		color: var(--admin-muted, #6b7280);
	}

	.bs-field__error {
		font-size: 0.8rem;
		color: var(--admin-danger, #dc2626);
	}

	.bs-field-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	.bs-form__actions {
		display: flex;
		gap: 10px;
	}

	@container (max-width: 860px) {
		.bs-layout {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 1100px) {
		.bs-layout {
			grid-template-columns: 1fr;
		}

		.bs-detail__head {
			align-items: stretch;
			flex-direction: column;
		}
	}

	@media (max-width: 640px) {
		.bs-field-row {
			grid-template-columns: 1fr;
		}

		.bs-form__actions {
			flex-direction: column;
		}

		.bs-form__actions .bs-btn {
			width: 100%;
		}
	}

	/* Autopilot cockpit ----------------------------------------------------- */
	.bs-page {
		--bs-ink: #172421;
		--bs-muted: #64706d;
		--bs-line: #dce4e1;
		--bs-soft: #f3f7f5;
		--bs-teal: #087d70;
		--bs-teal-dark: #055f56;
		--bs-mint: #e7f4ef;
		gap: 22px;
		color: var(--bs-ink);
	}

	.bs-hero {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 32px;
		padding: 10px 2px 4px;
	}

	.bs-hero__copy {
		max-width: 720px;
	}

	.bs-kicker,
	.bs-section-heading__eyebrow {
		margin: 0 0 8px;
		color: var(--bs-teal);
		font-size: 0.69rem;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.bs-hero h1 {
		margin: 0;
		font-size: clamp(2rem, 4vw, 3.45rem);
		font-weight: 650;
		line-height: 0.98;
		letter-spacing: -0.045em;
	}

	.bs-hero__copy > p:last-child {
		max-width: 650px;
		margin: 16px 0 0;
		color: var(--bs-muted);
		font-size: 0.98rem;
		line-height: 1.6;
	}

	.bs-hero__actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 9px;
	}

	.bs-btn {
		min-height: 36px;
		border-color: var(--bs-line);
		border-radius: 7px;
		padding: 7px 12px;
		font-weight: 650;
		transition:
			border-color 120ms ease,
			background 120ms ease,
			color 120ms ease,
			transform 120ms ease;
	}

	.bs-btn:hover:not(:disabled) {
		transform: translateY(-1px);
	}

	.bs-btn--primary {
		background: var(--bs-teal);
		border-color: var(--bs-teal);
	}

	.bs-btn--primary:hover:not(:disabled) {
		background: var(--bs-teal-dark);
		border-color: var(--bs-teal-dark);
	}

	.bs-btn--quiet {
		background: transparent;
		color: var(--bs-muted);
	}

	.bs-btn--small {
		min-height: 31px;
		padding: 5px 9px;
		font-size: 0.76rem;
		white-space: nowrap;
	}

	.bs-overview {
		position: relative;
		overflow: hidden;
		border: 1px solid var(--bs-line);
		background: linear-gradient(135deg, rgba(8, 125, 112, 0.06), transparent 38%), #fff;
		padding: clamp(18px, 3vw, 30px);
	}

	.bs-overview::after {
		position: absolute;
		top: -90px;
		right: -110px;
		width: 250px;
		height: 250px;
		border: 1px solid rgba(8, 125, 112, 0.12);
		border-radius: 50%;
		content: '';
		pointer-events: none;
	}

	.bs-section-heading {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
	}

	.bs-section-heading h2,
	.bs-operator-card h2,
	.bs-panel__head h2,
	.bs-composer__head h2 {
		margin: 0;
		font-size: 1.1rem;
		letter-spacing: -0.015em;
	}

	.bs-live-stamp {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--bs-teal-dark);
		font-size: 0.78rem;
		font-weight: 750;
		white-space: nowrap;
	}

	.bs-live-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #12a574;
		box-shadow: 0 0 0 5px rgba(18, 165, 116, 0.12);
	}

	.bs-live-dot.is-warning {
		background: #d98b19;
		box-shadow: 0 0 0 5px rgba(217, 139, 25, 0.12);
	}

	.bs-metrics {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: 1.15fr 0.72fr 1fr 1fr;
		margin-top: 24px;
		border-top: 1px solid var(--bs-line);
		border-bottom: 1px solid var(--bs-line);
	}

	.bs-metric {
		min-width: 0;
		padding: 20px 22px;
		border-left: 1px solid var(--bs-line);
	}

	.bs-metric:first-child {
		padding-left: 0;
		border-left: 0;
	}

	.bs-metric p {
		margin: 0 0 12px;
		color: var(--bs-muted);
		font-size: 0.72rem;
		font-weight: 750;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.bs-metric strong {
		display: block;
		overflow: hidden;
		margin: 0 0 6px;
		font-size: 1.55rem;
		font-weight: 650;
		line-height: 1.1;
		text-overflow: ellipsis;
	}

	.bs-metric--state strong {
		color: var(--bs-teal-dark);
		font-size: 1.15rem;
	}

	.bs-metric .bs-metric__time {
		font-size: 0.98rem;
		line-height: 1.35;
	}

	.bs-metric .bs-metric__empty {
		color: #a0aaa7;
	}

	.bs-metric span,
	.bs-metric a {
		display: block;
		overflow: hidden;
		color: var(--bs-muted);
		font-size: 0.78rem;
		line-height: 1.35;
		text-overflow: ellipsis;
	}

	.bs-metric a {
		color: var(--bs-teal-dark);
		font-weight: 700;
		text-decoration: none;
	}

	.bs-safety-note {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 11px;
		margin-top: 18px;
		color: var(--bs-teal-dark);
	}

	.bs-safety-note > span {
		display: grid;
		width: 25px;
		height: 25px;
		flex: 0 0 auto;
		place-items: center;
		border: 1px solid rgba(8, 125, 112, 0.35);
		border-radius: 50%;
		background: var(--bs-mint);
		font-weight: 800;
	}

	.bs-safety-note strong,
	.bs-safety-note p {
		margin: 0;
		font-size: 0.8rem;
	}

	.bs-safety-note p {
		margin-top: 2px;
		color: var(--bs-muted);
	}

	.bs-operator-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	.bs-operator-card {
		min-width: 0;
		border-top: 3px solid var(--bs-teal);
		background: #fff;
		box-shadow: 0 0 0 1px var(--bs-line);
		padding: 18px 20px;
	}

	.bs-operator-card--attention {
		border-top-color: #cfd8d5;
	}

	.bs-operator-card > header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	.bs-count {
		min-width: 28px;
		border: 0;
		border-radius: 5px;
		background: var(--bs-soft);
		padding: 4px 8px;
		color: var(--bs-muted);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	.bs-count.is-alert {
		background: #fff0ed;
		color: #b34335;
	}

	.bs-card-hint {
		margin: 8px 0 0;
		color: var(--bs-muted);
		font-size: 0.79rem;
	}

	.bs-work-list,
	.bs-incident-list {
		margin: 16px 0 0;
		padding: 0;
		list-style: none;
	}

	.bs-work-list li,
	.bs-incident-list li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: start;
		gap: 12px;
		padding: 14px 0;
		border-top: 1px solid var(--bs-line);
	}

	.bs-work-icon {
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		color: var(--bs-teal);
	}

	.bs-work-list strong,
	.bs-incident-list strong {
		font-size: 0.86rem;
	}

	.bs-work-list p,
	.bs-incident-list p,
	.bs-work-list small,
	.bs-incident-list small,
	.bs-work-list time {
		margin: 3px 0 0;
		color: var(--bs-muted);
		font-size: 0.76rem;
		line-height: 1.45;
	}

	.bs-work-list time {
		white-space: nowrap;
	}

	.bs-incident-list li {
		grid-template-columns: minmax(0, 1fr) auto;
	}

	.bs-incident-list p {
		color: #a33d33;
	}

	.bs-calm-empty {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 72px;
		margin-top: 12px;
		border-top: 1px solid var(--bs-line);
		color: var(--bs-muted);
	}

	.bs-calm-empty > span {
		display: grid;
		width: 22px;
		height: 22px;
		place-items: center;
		border-radius: 50%;
		background: var(--bs-mint);
		color: var(--bs-teal);
		font-size: 0.75rem;
		font-weight: 800;
	}

	.bs-calm-empty p {
		margin: 0;
		font-size: 0.82rem;
	}

	.bs-composer {
		border: 1px solid var(--bs-line);
		background: #fff;
		box-shadow: 0 18px 44px rgba(31, 54, 50, 0.09);
	}

	.bs-composer__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
		padding: 22px 24px 18px;
		border-bottom: 1px solid var(--bs-line);
		background: linear-gradient(90deg, var(--bs-soft), #fff);
	}

	.bs-composer__head p:last-child {
		max-width: 650px;
		margin: 7px 0 0;
		color: var(--bs-muted);
		font-size: 0.83rem;
	}

	.bs-icon-btn {
		display: grid;
		width: 34px;
		height: 34px;
		place-items: center;
		border: 1px solid var(--bs-line);
		border-radius: 50%;
		background: #fff;
		color: var(--bs-muted);
		font-size: 1.35rem;
		line-height: 1;
		cursor: pointer;
	}

	.bs-composer .bs-form {
		grid-template-columns: 1fr 1.3fr;
		gap: 15px;
		padding: 20px 24px 24px;
	}

	.bs-composer .bs-fieldset {
		min-width: 0;
		border-radius: 8px;
	}

	.bs-fieldset--wide {
		grid-row: span 2;
	}

	.bs-form__actions {
		grid-column: 1 / -1;
	}

	.bs-panel {
		border-color: var(--bs-line);
		border-radius: 0;
		padding: 0;
	}

	.bs-panel__head {
		padding: 20px 22px;
		border-bottom: 1px solid var(--bs-line);
		background: #fff;
	}

	.bs-list {
		gap: 0;
	}

	.bs-item {
		grid-template-columns: minmax(0, 1.7fr) minmax(210px, 0.65fr);
		gap: 18px 24px;
		border: 0;
		border-bottom: 1px solid var(--bs-line);
		border-radius: 0;
		padding: 20px 22px;
	}

	.bs-item:last-child {
		border-bottom: 0;
	}

	.bs-item.is-paused {
		background: #fafbfb;
	}

	.bs-item__name {
		font-size: 1rem;
	}

	.bs-item__direction {
		max-width: 700px;
		line-height: 1.45;
	}

	.bs-badge {
		border-radius: 5px;
	}

	.bs-item__timeline {
		display: grid;
		grid-template-columns: repeat(3, minmax(120px, 1fr));
		gap: 16px;
		margin-top: 18px;
	}

	.bs-item__timeline span {
		min-width: 0;
	}

	.bs-item__timeline small,
	.bs-item__outcome > small {
		display: block;
		margin-bottom: 5px;
		color: var(--bs-muted);
		font-size: 0.67rem;
		font-weight: 750;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.bs-item__timeline strong {
		display: block;
		overflow: hidden;
		font-size: 0.78rem;
		font-weight: 620;
		text-overflow: ellipsis;
	}

	.bs-item__outcome {
		align-self: center;
		padding-left: 20px;
		border-left: 1px solid var(--bs-line);
	}

	.bs-item__outcome .bs-result {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 700;
	}

	.bs-item__outcome p {
		margin: 6px 0 0;
		color: var(--bs-muted);
		font-size: 0.73rem;
		line-height: 1.4;
	}

	.bs-item__actions {
		grid-column: 1 / -1;
		padding-top: 14px;
		border-top: 1px dashed var(--bs-line);
	}

	.bs-detail {
		border-color: var(--bs-line);
		border-radius: 0;
	}

	.bs-disclosure {
		border-color: var(--bs-line);
		border-radius: 7px;
	}

	.bs-alert,
	.bs-notice {
		border-radius: 7px;
	}

	@media (max-width: 1050px) {
		.bs-metrics {
			grid-template-columns: 1fr 1fr;
		}

		.bs-metric:nth-child(3) {
			padding-left: 0;
			border-left: 0;
			border-top: 1px solid var(--bs-line);
		}

		.bs-metric:nth-child(4) {
			border-top: 1px solid var(--bs-line);
		}

		.bs-operator-grid {
			grid-template-columns: 1fr;
		}

		.bs-item {
			grid-template-columns: 1fr;
		}

		.bs-item__outcome {
			padding: 0;
			border-left: 0;
		}
	}

	@media (max-width: 720px) {
		.bs-hero {
			align-items: stretch;
			flex-direction: column;
		}

		.bs-hero__actions {
			justify-content: flex-start;
		}

		.bs-section-heading {
			align-items: flex-start;
			flex-direction: column;
		}

		.bs-metrics {
			grid-template-columns: 1fr;
		}

		.bs-metric,
		.bs-metric:first-child,
		.bs-metric:nth-child(3) {
			padding: 16px 0;
			border-top: 1px solid var(--bs-line);
			border-left: 0;
		}

		.bs-composer .bs-form {
			grid-template-columns: 1fr;
			padding: 16px;
		}

		.bs-fieldset--wide {
			grid-row: auto;
		}

		.bs-item__timeline {
			grid-template-columns: 1fr;
			gap: 11px;
		}

		.bs-item__actions {
			align-items: stretch;
			flex-direction: column;
		}

		.bs-item__actions .bs-btn {
			width: 100%;
		}

		.bs-confirm {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
