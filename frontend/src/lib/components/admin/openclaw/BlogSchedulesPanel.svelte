<script>
	import { resolve } from '$app/paths';
	import { onMount, onDestroy } from 'svelte';
	import { locale } from '$lib/i18n/admin/index.js';
	import {
		CONTENT_SCHEDULE_MODES,
		hasProductPlanningContext
	} from '$lib/contentOperations/contracts.js';

	let { initialSchedules = [] } = $props();

	const isEn = $derived($locale === 'en');

	const makeDefaultScheduleForm = () => ({
		name: 'Daily OpenClaw SEO draft',
		description: '',
		enabled: true,
		scheduleType: 'daily',
		timezone: 'Asia/Ho_Chi_Minh',
		dailyTimes: '09:00',
		daysOfWeek: [1, 2, 3, 4, 5],
		weeklyTimes: '09:00',
		intervalValue: 24,
		intervalUnit: 'hours',
		runLimit: 0,
		startAt: '',
		endAt: '',
		autoPublish: false,
		contentOperationsMode: 'fixed_brief',
		sourceRequirements: 'content_inventory',
		minimumOpportunityScore: 0.65,
		allowSkip: true,
		draftOnly: true,
		maxTasksPerDay: 1,
		monitoringWindows: '1d, 7d, 14d, 30d, 90d',
		selectedAction: '',
		selectedWorkOrderId: '',
		topic: 'noi inox cho gia dinh Viet',
		primaryKeyword: 'noi inox',
		secondaryKeywords: 'noi inox 304, noi inox dung bep tu',
		categoryKey: 'guide',
		articleType: 'how-to',
		language: 'vi',
		prompt: '',
		productSeedingEnabled: true,
		productSeedingMode: 'auto',
		productSeedingIntensity: 'light',
		maxPrimaryProducts: 1,
		maxSupportingProducts: 2,
		preferredCategoryIds: '',
		preferredProductIds: '',
		excludedProductIds: '',
		allowOutOfStock: false,
		productRelevanceThreshold: 0.72,
		allowInformationalFallback: true,
		productPlacementEnabled: true,
		productPlacementStyle: 'auto',
		rankingPositionMode: 'auto',
		minSectionsBeforeProduct: 2,
		minWordsBeforeProduct: 350,
		minProgressPercent: 35,
		productImagePlacement: 'auto',
		disclosureMode: 'required'
	});

	// svelte-ignore state_referenced_locally
	let schedules = $state(Array.isArray(initialSchedules) ? [...initialSchedules] : []);
	// svelte-ignore state_referenced_locally
	let selectedScheduleId = $state(schedules[0]?.id || '');
	let scheduleExecutions = $state([]);
	let scheduleForm = $state(makeDefaultScheduleForm());
	let editingScheduleId = $state('');
	let busyScheduleAction = $state('');
	let pageError = $state('');
	let productPreview = $state(null);
	let previewBusy = $state(false);
	let runNowIdempotencyKeys = $state({});
	const activeExecutionStatuses = ['queued', 'running'];

	const createIdempotencyKey = () =>
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

	const runNowIdempotencyKey = (scheduleId) => {
		if (runNowIdempotencyKeys[scheduleId]) return runNowIdempotencyKeys[scheduleId];
		const key = createIdempotencyKey();
		runNowIdempotencyKeys = { ...runNowIdempotencyKeys, [scheduleId]: key };
		return key;
	};

	const clearRunNowIdempotencyKey = (scheduleId) => {
		const next = { ...runNowIdempotencyKeys };
		delete next[scheduleId];
		runNowIdempotencyKeys = next;
	};
	const productPreviewReady = $derived(
		hasProductPlanningContext({
			mode: scheduleForm.contentOperationsMode,
			topic: scheduleForm.topic,
			action: scheduleForm.selectedAction,
			workOrderId: scheduleForm.selectedWorkOrderId
		})
	);

	const selectedSchedule = $derived(
		schedules.find((schedule) => schedule.id === selectedScheduleId) || schedules[0] || null
	);

	const t = $derived({
		secOperations: isEn ? 'Content Operations V3' : 'Vận hành nội dung V3',
		operationsMode: isEn ? 'Decision mode' : 'Chế độ quyết định',
		modeBest: isEn ? 'Best action' : 'Hành động tốt nhất',
		modeFixed: isEn ? 'Fixed brief' : 'Brief cố định',
		modeMaintenance: isEn ? 'Maintenance only' : 'Chỉ bảo trì',
		sourceRequirements: isEn
			? 'Required sources (comma-separated)'
			: 'Nguồn bắt buộc (phân cách bằng dấu phẩy)',
		minimumScore: isEn ? 'Minimum opportunity score (0–1)' : 'Điểm cơ hội tối thiểu (0–1)',
		allowSkip: isEn ? 'Allow an explicit skip' : 'Cho phép bỏ qua rõ ràng',
		draftOnlyGuard: isEn
			? 'Draft only — preserve editorial review'
			: 'Chỉ tạo bản nháp — giữ bước duyệt biên tập',
		maxTasks: isEn ? 'Maximum tasks per day' : 'Tác vụ tối đa mỗi ngày',
		monitoringWindows: isEn ? 'Monitoring windows in days' : 'Cửa sổ theo dõi theo ngày',
		selectedAction: isEn ? 'Selected action context' : 'Hành động đã chọn',
		selectedWorkOrder: isEn ? 'Selected work order ID' : 'ID work order đã chọn',
		productPreviewGate: isEn
			? 'Best-action product preview requires a topic, a non-skip action, and a work order.'
			: 'Preview sản phẩm ở chế độ hành động tốt nhất cần chủ đề, hành động không phải skip và work order.',
		title: isEn ? 'Blog schedules' : 'Lịch tạo bài',
		refresh: isEn ? 'Refresh' : 'Làm mới',
		new: isEn ? 'New' : 'Tạo mới',
		empty: isEn ? 'No schedules yet.' : 'Chưa có lịch nào.',
		edit: isEn ? 'Edit' : 'Sửa',
		enable: isEn ? 'Enable' : 'Bật',
		disable: isEn ? 'Disable' : 'Tạm dừng',
		runThis: isEn ? 'Run this schedule now' : 'Chạy lịch này ngay',
		delete: isEn ? 'Delete' : 'Xoá',
		next: isEn ? 'Next' : 'Kế tiếp',
		last: isEn ? 'Last' : 'Gần nhất',
		runCount: isEn ? 'Runs' : 'Số lần chạy',
		enabledLabel: isEn ? 'Enabled' : 'Đang bật',
		disabledLabel: isEn ? 'Disabled' : 'Tạm dừng',
		executions: isEn ? 'Executions' : 'Lịch sử chạy',
		reload: isEn ? 'Reload' : 'Tải lại',
		noExecutions: isEn ? 'No executions for this schedule.' : 'Lịch này chưa có lần chạy nào.',
		openDraft: isEn ? 'Open draft' : 'Mở bản nháp',
		createTitle: isEn ? 'Create schedule' : 'Tạo lịch',
		editTitle: isEn ? 'Edit schedule' : 'Sửa lịch',
		createHint: isEn ? 'New persisted schedule' : 'Lịch mới sẽ được lưu',
		editHint: isEn ? 'Updating existing schedule' : 'Đang cập nhật lịch hiện có',
		name: isEn ? 'Name' : 'Tên',
		topic: isEn ? 'Topic / positioning prompt' : 'Chủ đề / định hướng',
		type: isEn ? 'Type' : 'Loại lịch',
		daily: isEn ? 'Daily' : 'Hằng ngày',
		weekly: isEn ? 'Weekly' : 'Hằng tuần',
		interval: isEn ? 'Interval' : 'Theo chu kỳ',
		timezone: isEn ? 'Timezone' : 'Múi giờ',
		dailyTimes: isEn
			? 'Daily times, HH:mm comma-separated'
			: 'Giờ chạy (HH:mm, phân cách bằng dấu phẩy)',
		weeklyTimes: isEn
			? 'Weekly times, HH:mm comma-separated'
			: 'Giờ chạy tuần (HH:mm, phân cách bằng dấu phẩy)',
		every: isEn ? 'Every' : 'Mỗi',
		unit: isEn ? 'Unit' : 'Đơn vị',
		minutes: isEn ? 'Minutes' : 'Phút',
		hours: isEn ? 'Hours' : 'Giờ',
		days: isEn ? 'Days' : 'Ngày',
		runLimit: isEn ? 'Run limit' : 'Giới hạn số lần chạy',
		category: isEn ? 'Category' : 'Danh mục',
		startAt: isEn ? 'Start at' : 'Bắt đầu',
		endAt: isEn ? 'End at' : 'Kết thúc',
		primaryKeyword: isEn ? 'Primary keyword' : 'Từ khoá chính',
		secondaryKeywords: isEn ? 'Secondary keywords' : 'Từ khoá phụ',
		extra: isEn ? 'Extra instructions' : 'Hướng dẫn thêm',
		enabledSwitch: isEn ? 'Enabled' : 'Kích hoạt',
		autoPublishSwitch: isEn
			? 'Request publish when global auto-publish allows it'
			: 'Yêu cầu publish khi auto-publish toàn cục cho phép',
		reset: isEn ? 'Reset' : 'Đặt lại',
		save: isEn ? 'Save schedule' : 'Lưu lịch',
		saving: isEn ? 'Saving' : 'Đang lưu',
		confirmDelete: isEn ? 'Delete this schedule?' : 'Xoá lịch này?',
		secBasic: isEn ? 'Basic information' : 'Thông tin cơ bản',
		secSchedule: isEn ? 'Schedule' : 'Lịch chạy',
		secContent: isEn ? 'Content configuration' : 'Cấu hình nội dung',
		secPublishing: isEn ? 'Publishing' : 'Xuất bản',
		frequency: isEn ? 'Frequency' : 'Tần suất',
		weekdays: isEn
			? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
			: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
		dailyTimesHint: isEn
			? 'Time of day the post is generated, every day.'
			: 'Giờ trong ngày sẽ tạo bài, lặp lại mỗi ngày.',
		weeklyTimesHint: isEn
			? 'Time of day on the selected weekdays above.'
			: 'Giờ trong ngày, theo các thứ đã chọn ở trên.',
		windowHint: isEn
			? 'Active window for this schedule — leave empty to run indefinitely.'
			: 'Khoảng thời gian lịch có hiệu lực — để trống nếu muốn chạy vô thời hạn.'
	});

	const productT = $derived({
		section: isEn ? 'Product Integration' : 'Tích hợp sản phẩm',
		enabled: isEn ? 'Enable Product Integration' : 'Bật tích hợp sản phẩm',
		mode: isEn ? 'Mode' : 'Chế độ',
		modeOff: isEn ? 'Off — pure informational content' : 'Tắt — nội dung thuần thông tin',
		modeAuto: isEn ? 'Auto — only when genuinely relevant' : 'Tự động — chỉ khi thật sự liên quan',
		modeRequired: isEn
			? 'Required — block without a suitable product'
			: 'Bắt buộc — chặn khi không có sản phẩm phù hợp',
		intensity: isEn ? 'Intensity' : 'Mức độ thương mại',
		light: isEn ? 'Light' : 'Nhẹ',
		balanced: isEn ? 'Balanced' : 'Cân bằng',
		commercial: isEn ? 'Commercial' : 'Thương mại',
		maxPrimary: isEn ? 'Maximum primary products' : 'Số sản phẩm chính tối đa',
		maxSupporting: isEn ? 'Maximum supporting products' : 'Số sản phẩm hỗ trợ tối đa',
		preferredCategories: isEn
			? 'Preferred categories (comma-separated)'
			: 'Danh mục ưu tiên (phân cách bằng dấu phẩy)',
		preferredProducts: isEn
			? 'Preferred product IDs (comma-separated)'
			: 'ID sản phẩm ưu tiên (phân cách bằng dấu phẩy)',
		excludedProducts: isEn
			? 'Excluded product IDs (comma-separated)'
			: 'ID sản phẩm loại trừ (phân cách bằng dấu phẩy)',
		allowOutOfStock: isEn
			? 'Allow out-of-stock products as technical examples'
			: 'Cho phép sản phẩm hết hàng làm ví dụ kỹ thuật',
		threshold: isEn ? 'Product relevance threshold' : 'Ngưỡng liên quan sản phẩm',
		fallback: isEn
			? 'Allow pure informational fallback in Auto mode'
			: 'Cho phép chuyển sang bài thuần thông tin ở chế độ Tự động',
		preview: isEn ? 'Preview suitable products' : 'Xem trước sản phẩm phù hợp',
		previewing: isEn ? 'Matching…' : 'Đang đối chiếu…',
		decision: isEn ? 'Decision' : 'Quyết định',
		selected: isEn ? 'Selected products' : 'Sản phẩm được chọn',
		candidates: isEn ? 'Top candidates' : 'Ứng viên hàng đầu',
		rejected: isEn ? 'Rejected candidates' : 'Ứng viên bị loại',
		warnings: isEn ? 'Warnings' : 'Cảnh báo',
		placementMode: isEn ? 'Editorial placement style' : 'Kiểu đặt sản phẩm biên tập',
		rankingPosition: isEn
			? 'Owned product ranking position'
			: 'Vị trí sản phẩm sở hữu trong xếp hạng',
		firstMentionSections: isEn
			? 'Minimum sections before product'
			: 'Số mục tối thiểu trước sản phẩm',
		firstMentionWords: isEn ? 'Minimum words before product' : 'Số từ tối thiểu trước sản phẩm',
		firstMentionProgress: isEn ? 'Minimum article progress (%)' : 'Tiến độ bài tối thiểu (%)',
		productImagePlacement: isEn ? 'Product image placement' : 'Vị trí hình sản phẩm',
		disclosure: isEn ? 'Ownership disclosure' : 'Công khai quan hệ sở hữu',
		outline: isEn ? 'Editorial outline preview' : 'Xem trước dàn ý biên tập'
	});

	const formatDateTime = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		return new Intl.DateTimeFormat(isEn ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	};

	const executionStatusLabel = (status) => {
		if (status === 'draft_created') return 'Draft';
		if (status === 'published') return 'Published';
		if (status === 'failed') return isEn ? 'Failed' : 'Lỗi';
		if (status === 'skipped') return 'Skipped';
		return status || '--';
	};

	const toInputDateTime = (value) => {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		const offsetMs = date.getTimezoneOffset() * 60 * 1000;
		return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
	};

	const fromInputDateTime = (value) => {
		if (!value) return null;
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return null;
		return date.toISOString();
	};

	const splitCsv = (value) =>
		String(value || '')
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);

	const scheduleTimes = (schedule) => {
		if (!schedule) return '--';
		if (schedule.scheduleType === 'daily') return (schedule.daily?.times || []).join(', ');
		if (schedule.scheduleType === 'weekly') {
			return `${(schedule.weekly?.daysOfWeek || []).join(', ')} / ${(schedule.weekly?.times || []).join(', ')}`;
		}
		return `${schedule.interval?.value || 1} ${schedule.interval?.unit || 'hours'}`;
	};

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com') {
			return path;
		}
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
	};

	const upsertSchedule = (schedule) => {
		if (!schedule?.id) return;
		const index = schedules.findIndex((item) => item.id === schedule.id);
		if (index >= 0) {
			schedules = [...schedules.slice(0, index), schedule, ...schedules.slice(index + 1)];
		} else {
			schedules = [schedule, ...schedules];
		}
		selectedScheduleId = schedule.id;
	};

	const fillScheduleForm = (schedule) => {
		if (!schedule) {
			scheduleForm = makeDefaultScheduleForm();
			editingScheduleId = '';
			return;
		}
		const contentOperations =
			schedule.contentOperations || schedule.agentConfig?.contentOperations || {};
		scheduleForm = {
			name: schedule.name || '',
			description: schedule.description || '',
			enabled: Boolean(schedule.enabled),
			scheduleType: schedule.scheduleType || 'daily',
			timezone: schedule.timezone || 'Asia/Ho_Chi_Minh',
			dailyTimes: (schedule.daily?.times || []).join(', '),
			daysOfWeek: schedule.weekly?.daysOfWeek || [],
			weeklyTimes: (schedule.weekly?.times || []).join(', '),
			intervalValue: schedule.interval?.value || 24,
			intervalUnit: schedule.interval?.unit || 'hours',
			runLimit: schedule.runLimit || 0,
			startAt: toInputDateTime(schedule.startAt),
			endAt: toInputDateTime(schedule.endAt),
			autoPublish: Boolean(schedule.autoPublish),
			contentOperationsMode: CONTENT_SCHEDULE_MODES.includes(
				contentOperations.mode || schedule.mode
			)
				? contentOperations.mode || schedule.mode
				: 'fixed_brief',
			sourceRequirements: (
				schedule.sourceRequirements ||
				contentOperations.sourceRequirements ||
				[]
			).join(', '),
			minimumOpportunityScore:
				schedule.minimumOpportunityScore ?? contentOperations.minimumOpportunityScore ?? 0.65,
			allowSkip: (schedule.allowSkip ?? contentOperations.allowSkip) !== false,
			draftOnly:
				(schedule.draftOnly ?? contentOperations.draftOnly) !== false &&
				schedule.autoPublish !== true,
			maxTasksPerDay:
				schedule.maximumTasksPerDay ??
				contentOperations.maximumTasksPerDay ??
				contentOperations.maxTasksPerDay ??
				1,
			monitoringWindows: (
				schedule.monitoringWindows ||
				contentOperations.monitoringWindows || ['1d', '7d', '14d', '30d', '90d']
			).join(', '),
			selectedAction: schedule.agentConfig?.contentAction || contentOperations.selectedAction || '',
			selectedWorkOrderId:
				schedule.agentConfig?.workOrderId || contentOperations.selectedWorkOrderId || '',
			topic: schedule.agentConfig?.topic || '',
			primaryKeyword: schedule.agentConfig?.primaryKeyword || '',
			secondaryKeywords: (schedule.agentConfig?.secondaryKeywords || []).join(', '),
			categoryKey: schedule.agentConfig?.categoryKey || 'guide',
			articleType: schedule.agentConfig?.articleType || 'how-to',
			language: schedule.agentConfig?.language || 'vi',
			prompt: schedule.agentConfig?.prompt || '',
			productSeedingEnabled: schedule.agentConfig?.productSeeding?.enabled !== false,
			productSeedingMode: schedule.agentConfig?.productSeeding?.mode || 'auto',
			productSeedingIntensity: schedule.agentConfig?.productSeeding?.intensity || 'light',
			maxPrimaryProducts: schedule.agentConfig?.productSeeding?.maxPrimaryProducts ?? 1,
			maxSupportingProducts: schedule.agentConfig?.productSeeding?.maxSupportingProducts ?? 2,
			preferredCategoryIds: (schedule.agentConfig?.productSeeding?.preferredCategoryIds || []).join(
				', '
			),
			preferredProductIds: (schedule.agentConfig?.productSeeding?.preferredProductIds || []).join(
				', '
			),
			excludedProductIds: (schedule.agentConfig?.productSeeding?.excludedProductIds || []).join(
				', '
			),
			allowOutOfStock: Boolean(schedule.agentConfig?.productSeeding?.allowOutOfStock),
			productRelevanceThreshold: schedule.agentConfig?.productSeeding?.relevanceThreshold ?? 0.72,
			allowInformationalFallback:
				schedule.agentConfig?.productSeeding?.allowInformationalFallback !== false,
			productPlacementEnabled: schedule.agentConfig?.productPlacement?.enabled !== false,
			productPlacementStyle: schedule.agentConfig?.productPlacement?.style || 'auto',
			rankingPositionMode: schedule.agentConfig?.productPlacement?.rankingPositionMode || 'auto',
			minSectionsBeforeProduct:
				schedule.agentConfig?.productPlacement?.minSectionsBeforeProduct ?? 2,
			minWordsBeforeProduct: schedule.agentConfig?.productPlacement?.minWordsBeforeProduct ?? 350,
			minProgressPercent: schedule.agentConfig?.productPlacement?.minProgressPercent ?? 35,
			productImagePlacement:
				schedule.agentConfig?.productPlacement?.productImagePlacement || 'auto',
			disclosureMode: schedule.agentConfig?.productPlacement?.disclosureMode || 'required'
		};
		editingScheduleId = schedule.id;
	};

	const buildSchedulePayload = () => ({
		name: scheduleForm.name,
		description: scheduleForm.description,
		enabled: scheduleForm.enabled,
		scheduleType: scheduleForm.scheduleType,
		timezone: scheduleForm.timezone,
		daily: { times: splitCsv(scheduleForm.dailyTimes) },
		weekly: {
			daysOfWeek: scheduleForm.daysOfWeek,
			times: splitCsv(scheduleForm.weeklyTimes)
		},
		interval: {
			value: Number(scheduleForm.intervalValue) || 1,
			unit: scheduleForm.intervalUnit
		},
		runLimit: Number(scheduleForm.runLimit) || 0,
		startAt: fromInputDateTime(scheduleForm.startAt),
		endAt: fromInputDateTime(scheduleForm.endAt),
		autoPublish: scheduleForm.draftOnly ? false : scheduleForm.autoPublish,
		mode: scheduleForm.contentOperationsMode,
		sourceRequirements: splitCsv(scheduleForm.sourceRequirements),
		minimumOpportunityScore: Math.min(
			1,
			Math.max(0, Number(scheduleForm.minimumOpportunityScore) || 0)
		),
		allowSkip: scheduleForm.allowSkip,
		draftOnly: scheduleForm.draftOnly,
		maximumTasksPerDay: Math.min(24, Math.max(1, Number(scheduleForm.maxTasksPerDay) || 1)),
		monitoringWindows: splitCsv(scheduleForm.monitoringWindows),
		agentConfig: {
			topic: scheduleForm.topic,
			primaryKeyword: scheduleForm.primaryKeyword,
			secondaryKeywords: splitCsv(scheduleForm.secondaryKeywords),
			categoryKey: scheduleForm.categoryKey,
			articleType: scheduleForm.articleType,
			language: scheduleForm.language,
			prompt: scheduleForm.prompt,
			contentAction: scheduleForm.selectedAction || '',
			workOrderId: scheduleForm.selectedWorkOrderId || '',
			productSeeding: {
				enabled: scheduleForm.productSeedingEnabled,
				mode: scheduleForm.productSeedingEnabled ? scheduleForm.productSeedingMode : 'off',
				intensity: scheduleForm.productSeedingIntensity,
				maxPrimaryProducts: Number(scheduleForm.maxPrimaryProducts) || 0,
				maxSupportingProducts: Number(scheduleForm.maxSupportingProducts) || 0,
				preferredCategoryIds: splitCsv(scheduleForm.preferredCategoryIds),
				preferredProductIds: splitCsv(scheduleForm.preferredProductIds),
				excludedProductIds: splitCsv(scheduleForm.excludedProductIds),
				allowOutOfStock: scheduleForm.allowOutOfStock,
				relevanceThreshold: Number(scheduleForm.productRelevanceThreshold) || 0.72,
				allowInformationalFallback: scheduleForm.allowInformationalFallback
			},
			productPlacement: {
				enabled: scheduleForm.productPlacementEnabled,
				style: scheduleForm.productPlacementEnabled
					? scheduleForm.productPlacementStyle
					: 'no-product',
				rankingPositionMode: scheduleForm.rankingPositionMode,
				minSectionsBeforeProduct: Number(scheduleForm.minSectionsBeforeProduct) || 0,
				minWordsBeforeProduct: Number(scheduleForm.minWordsBeforeProduct) || 0,
				minProgressPercent: Number(scheduleForm.minProgressPercent) || 0,
				productImagePlacement: scheduleForm.productImagePlacement,
				disclosureMode: scheduleForm.disclosureMode
			}
		}
	});

	const previewProductMatching = async () => {
		if (previewBusy || !productPreviewReady) return;
		previewBusy = true;
		pageError = '';
		productPreview = null;
		try {
			const schedulePayload = buildSchedulePayload();
			const response = await fetch(
				resolveAdminPath('/admin/api/openclaw/product-seeding/preview'),
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						topic: schedulePayload.agentConfig.topic,
						primaryKeyword: schedulePayload.agentConfig.primaryKeyword,
						secondaryKeywords: schedulePayload.agentConfig.secondaryKeywords,
						articleType: schedulePayload.agentConfig.articleType,
						categoryKey: schedulePayload.agentConfig.categoryKey,
						language: schedulePayload.agentConfig.language,
						productSeeding: schedulePayload.agentConfig.productSeeding,
						productPlacement: schedulePayload.agentConfig.productPlacement
					})
				}
			);
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				pageError =
					payload?.error ||
					(isEn ? 'Unable to preview product matching' : 'Không thể xem trước đối chiếu sản phẩm');
				return;
			}
			productPreview = payload;
		} finally {
			previewBusy = false;
		}
	};

	const refreshSchedules = async () => {
		pageError = '';
		const response = await fetch(
			resolveAdminPath('/admin/api/openclaw/blog-schedules?limit=50&page=1')
		);
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			pageError =
				payload?.error || (isEn ? 'Unable to load blog schedules' : 'Không tải được lịch tạo bài');
			return;
		}
		schedules = Array.isArray(payload?.schedules) ? payload.schedules : [];
		if (!selectedScheduleId && schedules[0]?.id) selectedScheduleId = schedules[0].id;
	};

	const loadScheduleExecutions = async (scheduleId = selectedScheduleId) => {
		if (!scheduleId) {
			scheduleExecutions = [];
			return;
		}
		const response = await fetch(
			resolveAdminPath(`/admin/api/openclaw/blog-schedules/${scheduleId}/executions?limit=20`)
		);
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			pageError =
				payload?.error ||
				(isEn ? 'Unable to load schedule executions' : 'Không tải được lịch sử chạy');
			return;
		}
		scheduleExecutions = Array.isArray(payload?.executions) ? payload.executions : [];
		if (scheduleExecutions.some((item) => activeExecutionStatuses.includes(item.status))) {
			ensureExecutionPolling(scheduleId);
		}
	};

	const saveSchedule = async (event) => {
		event?.preventDefault();
		if (busyScheduleAction) return;
		busyScheduleAction = 'save';
		pageError = '';
		try {
			const response = await fetch(
				resolveAdminPath(
					editingScheduleId
						? `/admin/api/openclaw/blog-schedules/${editingScheduleId}`
						: '/admin/api/openclaw/blog-schedules'
				),
				{
					method: editingScheduleId ? 'PATCH' : 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(buildSchedulePayload())
				}
			);
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				pageError =
					payload?.error || (isEn ? 'Unable to save blog schedule' : 'Không lưu được lịch tạo bài');
				return;
			}
			upsertSchedule(payload);
			fillScheduleForm(payload);
		} finally {
			busyScheduleAction = '';
		}
	};

	let executionPollTimer = null;
	let executionPollStartedAt = 0;
	let executionPollInFlight = false;

	const stopExecutionPolling = () => {
		if (executionPollTimer) {
			clearInterval(executionPollTimer);
			executionPollTimer = null;
		}
	};

	const ensureExecutionPolling = (scheduleId) => {
		if (executionPollTimer || !scheduleId) return;
		executionPollStartedAt = Date.now();
		executionPollTimer = setInterval(async () => {
			if (executionPollInFlight) return;
			if (
				Date.now() - executionPollStartedAt > 35 * 60 * 1000 ||
				selectedScheduleId !== scheduleId
			) {
				stopExecutionPolling();
				return;
			}
			executionPollInFlight = true;
			try {
				await loadScheduleExecutions(scheduleId);
				if (!scheduleExecutions.some((item) => activeExecutionStatuses.includes(item.status))) {
					clearRunNowIdempotencyKey(scheduleId);
					stopExecutionPolling();
					await refreshSchedules();
				}
			} finally {
				executionPollInFlight = false;
			}
		}, 6000);
	};

	const scheduleOperation = async (scheduleId, operation) => {
		if (!scheduleId || busyScheduleAction) return;
		busyScheduleAction = `${operation}:${scheduleId}`;
		pageError = '';
		try {
			const idempotencyKey = operation === 'run-now' ? runNowIdempotencyKey(scheduleId) : '';
			const response = await fetch(
				resolveAdminPath(`/admin/api/openclaw/blog-schedules/${scheduleId}/${operation}`),
				{
					method: 'POST',
					headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined
				}
			);
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				pageError =
					payload?.error ||
					(isEn ? 'Unable to run schedule operation' : 'Không thực hiện được thao tác lịch');
				return;
			}
			if (operation === 'run-now') {
				await loadScheduleExecutions(scheduleId);
				await refreshSchedules();
				ensureExecutionPolling(scheduleId);
				return;
			}
			upsertSchedule(payload);
		} finally {
			busyScheduleAction = '';
		}
	};

	const deleteSchedule = async (scheduleId) => {
		if (!scheduleId || busyScheduleAction) return;
		if (!window.confirm(t.confirmDelete)) return;
		busyScheduleAction = `delete:${scheduleId}`;
		pageError = '';
		try {
			const response = await fetch(
				resolveAdminPath(`/admin/api/openclaw/blog-schedules/${scheduleId}`),
				{
					method: 'DELETE'
				}
			);
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				pageError = payload?.error || (isEn ? 'Unable to delete schedule' : 'Không xoá được lịch');
				return;
			}
			schedules = schedules.filter((item) => item.id !== scheduleId);
			if (selectedScheduleId === scheduleId) selectedScheduleId = schedules[0]?.id || '';
			if (editingScheduleId === scheduleId) fillScheduleForm(null);
		} finally {
			busyScheduleAction = '';
		}
	};

	const toggleWeekday = (day) => {
		const current = (scheduleForm.daysOfWeek || []).filter((item) => item !== day);
		if (!(scheduleForm.daysOfWeek || []).includes(day)) current.push(day);
		scheduleForm = {
			...scheduleForm,
			daysOfWeek: current.sort((a, b) => a - b)
		};
	};

	onMount(() => {
		if (selectedScheduleId) loadScheduleExecutions(selectedScheduleId);
	});

	onDestroy(() => {
		stopExecutionPolling();
	});
</script>

<section class="oc-schedules">
	<div class="oc-panel__head">
		<h2>{t.title}</h2>
		<span class="oc-count">{schedules.length}</span>
	</div>

	{#if pageError}
		<div class="oc-alert" role="alert">{pageError}</div>
	{/if}

	<div class="oc-sched-layout">
		<div class="oc-sched-side">
			<div class="oc-sched-toolbar">
				<button type="button" class="oc-btn oc-btn--ghost oc-btn--sm" onclick={refreshSchedules}
					>{t.refresh}</button
				>
				<button
					type="button"
					class="oc-btn oc-btn--primary oc-btn--sm"
					onclick={() => fillScheduleForm(null)}>{t.new}</button
				>
			</div>
			{#if schedules.length}
				<div class="oc-sched-list">
					{#each schedules as schedule (schedule.id)}
						<article class="oc-sched-card" class:is-selected={selectedSchedule?.id === schedule.id}>
							<button
								type="button"
								class="oc-sched-card__main"
								onclick={() => {
									selectedScheduleId = schedule.id;
									loadScheduleExecutions(schedule.id);
								}}
							>
								<div class="oc-sched-card__top">
									<strong>{schedule.name}</strong>
									<span
										class="oc-badge"
										class:is-good={schedule.enabled}
										class:is-muted={!schedule.enabled}
									>
										<span class="oc-dot"></span>{schedule.enabled
											? t.enabledLabel
											: t.disabledLabel}
									</span>
								</div>
								<dl class="oc-sched-card__meta">
									<div>
										<dt>{t.frequency}</dt>
										<dd>{scheduleTimes(schedule)}</dd>
									</div>
									<div>
										<dt>{t.next}</dt>
										<dd>{formatDateTime(schedule.nextRunAt)}</dd>
									</div>
									<div>
										<dt>{t.last}</dt>
										<dd>
											{formatDateTime(schedule.lastRunAt)}
											{#if schedule.lastRunStatus}· {executionStatusLabel(
													schedule.lastRunStatus
												)}{/if}
											· {t.runCount}: {schedule.runCount ?? 0}
										</dd>
									</div>
								</dl>
							</button>
							<div class="oc-sched-card__actions">
								<button type="button" class="oc-chip-btn" onclick={() => fillScheduleForm(schedule)}
									>{t.edit}</button
								>
								<button
									type="button"
									class="oc-chip-btn"
									onclick={() =>
										scheduleOperation(schedule.id, schedule.enabled ? 'disable' : 'enable')}
									disabled={Boolean(busyScheduleAction)}
								>
									{schedule.enabled ? t.disable : t.enable}
								</button>
								<button
									type="button"
									class="oc-chip-btn oc-chip-btn--run"
									onclick={() => scheduleOperation(schedule.id, 'run-now')}
									disabled={Boolean(busyScheduleAction)}
								>
									{busyScheduleAction === `run-now:${schedule.id}`
										? isEn
											? 'Running…'
											: 'Đang chạy…'
										: t.runThis}
								</button>
								<button
									type="button"
									class="oc-chip-btn oc-chip-btn--danger"
									onclick={() => deleteSchedule(schedule.id)}>{t.delete}</button
								>
							</div>
						</article>
					{/each}
				</div>
			{:else}
				<div class="oc-empty">
					<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"
						><path
							d="M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
							stroke="currentColor"
							stroke-width="1.7"
							stroke-linecap="round"
							stroke-linejoin="round"
						/></svg
					>
					<p>{t.empty}</p>
				</div>
			{/if}

			<div class="oc-exec">
				<div class="oc-exec__head">
					<h3>{t.executions}</h3>
					<button
						type="button"
						class="oc-chip-btn"
						onclick={() => loadScheduleExecutions(selectedScheduleId)}>{t.reload}</button
					>
				</div>
				{#if scheduleExecutions.length}
					<div class="oc-exec__list">
						{#each scheduleExecutions as execution (execution.executionKey || execution.createdAt)}
							<div class="oc-exec__row">
								<b
									class="oc-badge"
									class:is-good={execution.status === 'published' ||
										execution.status === 'draft_created'}
									class:is-danger={execution.status === 'failed'}
									class:is-muted={execution.status !== 'published' &&
										execution.status !== 'draft_created' &&
										execution.status !== 'failed'}
								>
									{executionStatusLabel(execution.status)}
								</b>
								<span class="oc-exec__title">{execution.blogTitle || execution.executionKey}</span>
								<small>{formatDateTime(execution.createdAt)}</small>
								{#if execution.blogId}
									<a
										href={resolve(resolveAdminPath(`/admin/blogs/${execution.blogId}`))}
										target="_blank"
										rel="noreferrer">{t.openDraft}</a
									>
								{/if}
								{#if execution.telegramNotificationStatus}
									<small>Telegram: {execution.telegramNotificationStatus}</small>
								{/if}
								{#if execution.productSeedPlanId}
									<details class="oc-exec__product">
										<summary
											>{productT.section}: {execution.productSeedingMode} / {execution.productSeedingDecision}</summary
										>
										<small>Catalog: {execution.productCatalogSnapshotId || '--'}</small>
										<small>Plan: {execution.productSeedPlanId}</small>
										{#if execution.editorialProductPlacementPlanId}<small
												>Editorial placement: {execution.editorialProductPlacementPlanId} · {execution
													.metadata?.productSeeding?.placementStyle || '--'}</small
											>{/if}
										{#if execution.seededProductIds?.length}<small
												>Product IDs: {execution.seededProductIds.join(', ')}</small
											>{/if}
										{#if execution.metadata?.productSeeding?.candidateScores?.length}
											<ul>
												{#each execution.metadata.productSeeding.candidateScores.slice(0, 5) as item (item.productId || item.id || item.name)}<li
													>
														{item.name}: {Math.round((item.totalScore || 0) * 100)}% — {(
															item.matchedEvidence || []
														).join(', ')}
													</li>{/each}
											</ul>
										{/if}
										{#if execution.metadata?.productSeeding?.rejectedCandidates?.length}
											<small
												>{productT.rejected}: {execution.metadata.productSeeding.rejectedCandidates
													.map((item) => `${item.name}: ${(item.rejectionReasons || []).join('/')}`)
													.join('; ')}</small
											>
										{/if}
										{#if execution.metadata?.productSeeding?.placementPlan?.length}<small
												>Placement: {execution.metadata.productSeeding.placementPlan
													.map((item) => item.placementType)
													.join(', ')}</small
											>{/if}
										{#if execution.productClaimReview}<small
												>Claims: {execution.productClaimReview.pass ? 'pass' : 'fail'} — rejected {(
													execution.productClaimReview.rejectedClaims || []
												).length}</small
											>{/if}
										{#if execution.productSeedingReview}<small
												>Naturalness: {execution.productSeedingReview.naturalnessScore ?? '--'} · pressure
												{execution.productSeedingReview.commercialPressure || '--'} · mentions {execution
													.productSeedingReview.metrics?.productMentions ?? 0} · links {execution
													.productSeedingReview.metrics?.productLinks ?? 0}</small
											>{/if}
										{#if execution.editorialProductPlacementReview}<small
												>Placement gate: {execution.editorialProductPlacementReview.pass
													? 'pass'
													: 'rewrite'} · risk {execution.editorialProductPlacementReview
													.riskLevel || '--'} · first mention {execution
													.editorialProductPlacementReview.firstProductMention?.progressPercent ??
													0}%</small
											>{/if}
									</details>
								{/if}
								{#if execution.error}
									<small class="oc-exec__error">{execution.error}</small>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="oc-empty oc-empty--sm">
						<p>{t.noExecutions}</p>
					</div>
				{/if}
			</div>
		</div>

		<form class="oc-form" onsubmit={saveSchedule}>
			<div class="oc-form__head">
				<h3>{editingScheduleId ? t.editTitle : t.createTitle}</h3>
				<span>{editingScheduleId ? t.editHint : t.createHint}</span>
			</div>

			<fieldset class="oc-form__section">
				<legend>{t.secBasic}</legend>
				<label class="oc-field">
					<span>{t.name}</span>
					<input bind:value={scheduleForm.name} required />
				</label>
				<label class="oc-field">
					<span>{t.topic}</span>
					<textarea bind:value={scheduleForm.topic} rows="2" maxlength="300" required></textarea>
					<small
						class="oc-topic-count"
						class:is-over-limit={(scheduleForm.topic || '').length > 300}
						>{(scheduleForm.topic || '').length}/300</small
					>
				</label>
			</fieldset>

			<fieldset class="oc-form__section oc-form__section--operations">
				<legend>{t.secOperations}</legend>
				<div class="oc-form__grid">
					<label class="oc-field">
						<span>{t.operationsMode}</span>
						<select bind:value={scheduleForm.contentOperationsMode}>
							<option value="best_action">{t.modeBest}</option>
							<option value="fixed_brief">{t.modeFixed}</option>
							<option value="maintenance_only">{t.modeMaintenance}</option>
						</select>
					</label>
					<label class="oc-field">
						<span>{t.minimumScore}</span>
						<input
							type="number"
							min="0"
							max="1"
							step="0.05"
							bind:value={scheduleForm.minimumOpportunityScore}
						/>
					</label>
				</div>
				<label class="oc-field">
					<span>{t.sourceRequirements}</span>
					<input
						bind:value={scheduleForm.sourceRequirements}
						placeholder="searchConsole, analytics, trends"
					/>
				</label>
				<div class="oc-form__grid">
					<label class="oc-field"
						><span>{t.maxTasks}</span><input
							type="number"
							min="1"
							max="10"
							bind:value={scheduleForm.maxTasksPerDay}
						/></label
					>
					<label class="oc-field"
						><span>{t.monitoringWindows}</span><input
							bind:value={scheduleForm.monitoringWindows}
							placeholder="7, 14, 30"
						/></label
					>
				</div>
				{#if scheduleForm.contentOperationsMode !== 'fixed_brief'}
					<div class="oc-form__grid">
						<label class="oc-field"
							><span>{t.selectedAction}</span><select bind:value={scheduleForm.selectedAction}
								><option value="">--</option><option value="new">new</option><option value="update"
									>update</option
								><option value="expand">expand</option><option value="merge">merge</option><option
									value="metadata_refresh">metadata_refresh</option
								><option value="internal_link_maintenance">internal_link_maintenance</option><option
									value="content_maintenance">content_maintenance</option
								><option value="skip">skip</option></select
							></label
						>
						<label class="oc-field"
							><span>{t.selectedWorkOrder}</span><input
								bind:value={scheduleForm.selectedWorkOrderId}
								maxlength="128"
							/></label
						>
					</div>
				{/if}
				<label class="oc-check"
					><input type="checkbox" bind:checked={scheduleForm.allowSkip} /><span>{t.allowSkip}</span
					></label
				>
				<label class="oc-check"
					><input type="checkbox" bind:checked={scheduleForm.draftOnly} /><span
						>{t.draftOnlyGuard}</span
					></label
				>
			</fieldset>

			<fieldset class="oc-form__section">
				<legend>{t.secSchedule}</legend>
				<div class="oc-form__grid">
					<label class="oc-field">
						<span>{t.type}</span>
						<select bind:value={scheduleForm.scheduleType}>
							<option value="daily">{t.daily}</option>
							<option value="weekly">{t.weekly}</option>
							<option value="interval">{t.interval}</option>
						</select>
					</label>
					<label class="oc-field">
						<span>{t.timezone}</span>
						<input bind:value={scheduleForm.timezone} />
					</label>
				</div>
				{#if scheduleForm.scheduleType === 'daily'}
					<label class="oc-field">
						<span>{t.dailyTimes}</span>
						<input bind:value={scheduleForm.dailyTimes} placeholder="09:00, 15:30" />
						<small class="oc-field__hint">{t.dailyTimesHint}</small>
					</label>
				{:else if scheduleForm.scheduleType === 'weekly'}
					<div class="oc-field">
						<span>{t.weekly}</span>
						<div class="oc-weekdays">
							{#each [0, 1, 2, 3, 4, 5, 6] as day (day)}
								<button
									type="button"
									class="oc-weekday"
									class:is-active={scheduleForm.daysOfWeek.includes(day)}
									onclick={() => toggleWeekday(day)}
								>
									{t.weekdays[day]}
								</button>
							{/each}
						</div>
					</div>
					<label class="oc-field">
						<span>{t.weeklyTimes}</span>
						<input bind:value={scheduleForm.weeklyTimes} placeholder="09:00" />
						<small class="oc-field__hint">{t.weeklyTimesHint}</small>
					</label>
				{:else}
					<div class="oc-form__grid">
						<label class="oc-field">
							<span>{t.every}</span>
							<input type="number" min="1" bind:value={scheduleForm.intervalValue} />
						</label>
						<label class="oc-field">
							<span>{t.unit}</span>
							<select bind:value={scheduleForm.intervalUnit}>
								<option value="minutes">{t.minutes}</option>
								<option value="hours">{t.hours}</option>
								<option value="days">{t.days}</option>
							</select>
						</label>
					</div>
				{/if}
				<div class="oc-form__grid">
					<label class="oc-field">
						<span>{t.startAt}</span>
						<input type="datetime-local" bind:value={scheduleForm.startAt} />
					</label>
					<label class="oc-field">
						<span>{t.endAt}</span>
						<input type="datetime-local" bind:value={scheduleForm.endAt} />
					</label>
				</div>
				<small class="oc-field__hint oc-field__hint--block">{t.windowHint}</small>
				<label class="oc-field oc-field--narrow">
					<span>{t.runLimit}</span>
					<input type="number" min="0" bind:value={scheduleForm.runLimit} />
				</label>
			</fieldset>

			<fieldset class="oc-form__section">
				<legend>{t.secContent}</legend>
				<label class="oc-field">
					<span>{t.category}</span>
					<select bind:value={scheduleForm.categoryKey}>
						<option value="guide">guide</option>
						<option value="care">care</option>
						<option value="knowledge">knowledge</option>
						<option value="trend">trend</option>
						<option value="product">product</option>
						<option value="design">design</option>
					</select>
				</label>
				<label class="oc-field">
					<span>{t.primaryKeyword}</span>
					<input bind:value={scheduleForm.primaryKeyword} />
				</label>
				<label class="oc-field">
					<span>{t.secondaryKeywords}</span>
					<input bind:value={scheduleForm.secondaryKeywords} />
				</label>
				<label class="oc-field">
					<span>{t.extra}</span>
					<textarea bind:value={scheduleForm.prompt} rows="3"></textarea>
				</label>
			</fieldset>

			<fieldset class="oc-form__section">
				<legend>{productT.section}</legend>
				<label class="oc-check">
					<input type="checkbox" bind:checked={scheduleForm.productSeedingEnabled} />
					<span>{productT.enabled}</span>
				</label>
				<div class="oc-form__grid">
					<label class="oc-field">
						<span>{productT.mode}</span>
						<select
							bind:value={scheduleForm.productSeedingMode}
							disabled={!scheduleForm.productSeedingEnabled}
						>
							<option value="off">{productT.modeOff}</option>
							<option value="auto">{productT.modeAuto}</option>
							<option value="required">{productT.modeRequired}</option>
						</select>
					</label>
					<label class="oc-field">
						<span>{productT.intensity}</span>
						<select
							bind:value={scheduleForm.productSeedingIntensity}
							disabled={!scheduleForm.productSeedingEnabled}
						>
							<option value="light">{productT.light}</option>
							<option value="balanced">{productT.balanced}</option>
							<option value="commercial">{productT.commercial}</option>
						</select>
					</label>
				</div>
				<div class="oc-form__grid">
					<label class="oc-field"
						><span>{productT.maxPrimary}</span><input
							type="number"
							min="0"
							max="5"
							bind:value={scheduleForm.maxPrimaryProducts}
						/></label
					>
					<label class="oc-field"
						><span>{productT.maxSupporting}</span><input
							type="number"
							min="0"
							max="10"
							bind:value={scheduleForm.maxSupportingProducts}
						/></label
					>
				</div>
				<label class="oc-field"
					><span>{productT.preferredCategories}</span><input
						bind:value={scheduleForm.preferredCategoryIds}
						placeholder="Electronics, Inoxs"
					/></label
				>
				<label class="oc-field"
					><span>{productT.preferredProducts}</span><input
						bind:value={scheduleForm.preferredProductIds}
					/></label
				>
				<label class="oc-field"
					><span>{productT.excludedProducts}</span><input
						bind:value={scheduleForm.excludedProductIds}
					/></label
				>
				<label class="oc-field">
					<span>{productT.threshold}</span>
					<input
						type="number"
						min="0"
						max="1"
						step="0.01"
						bind:value={scheduleForm.productRelevanceThreshold}
					/>
				</label>
				<label class="oc-check"
					><input type="checkbox" bind:checked={scheduleForm.allowOutOfStock} /><span
						>{productT.allowOutOfStock}</span
					></label
				>
				<label class="oc-check"
					><input type="checkbox" bind:checked={scheduleForm.allowInformationalFallback} /><span
						>{productT.fallback}</span
					></label
				>
				<label class="oc-check"
					><input
						type="checkbox"
						bind:checked={scheduleForm.productPlacementEnabled}
						disabled={!scheduleForm.productSeedingEnabled}
					/><span>{productT.placementMode}</span></label
				>
				<div class="oc-form__grid">
					<label class="oc-field">
						<span>{productT.placementMode}</span>
						<select
							bind:value={scheduleForm.productPlacementStyle}
							disabled={!scheduleForm.productPlacementEnabled}
						>
							<option value="auto">auto</option>
							<option value="ranked-list-owned-first">ranked-list-owned-first</option>
							<option value="ranked-list-owned-last">ranked-list-owned-last</option>
							<option value="criteria-first-recommendation">criteria-first-recommendation</option>
							<option value="problem-solution-late-reveal">problem-solution-late-reveal</option>
							<option value="knowledge-soft-endcap">knowledge-soft-endcap</option>
							<option value="comparison-matrix-contextual">comparison-matrix-contextual</option>
							<option value="scenario-product-matching">scenario-product-matching</option>
							<option value="editorial-pick-disclosed">editorial-pick-disclosed</option>
							<option value="inline-contextual-example">inline-contextual-example</option>
							<option value="product-led-editorial">product-led-editorial</option>
							<option value="no-product">no-product</option>
						</select>
					</label>
					<label class="oc-field">
						<span>{productT.rankingPosition}</span>
						<select
							bind:value={scheduleForm.rankingPositionMode}
							disabled={!scheduleForm.productPlacementEnabled}
						>
							<option value="auto">auto</option><option value="first">first</option><option
								value="last">last</option
							>
						</select>
					</label>
				</div>
				<div class="oc-form__grid">
					<label class="oc-field"
						><span>{productT.firstMentionSections}</span><input
							type="number"
							min="0"
							max="20"
							bind:value={scheduleForm.minSectionsBeforeProduct}
						/></label
					>
					<label class="oc-field"
						><span>{productT.firstMentionWords}</span><input
							type="number"
							min="0"
							max="5000"
							bind:value={scheduleForm.minWordsBeforeProduct}
						/></label
					>
					<label class="oc-field"
						><span>{productT.firstMentionProgress}</span><input
							type="number"
							min="0"
							max="100"
							bind:value={scheduleForm.minProgressPercent}
						/></label
					>
				</div>
				<div class="oc-form__grid">
					<label class="oc-field"
						><span>{productT.productImagePlacement}</span><select
							bind:value={scheduleForm.productImagePlacement}
							><option value="auto">auto</option><option value="none">none</option><option
								value="contextual">contextual</option
							><option value="after-product">after-product</option></select
						></label
					>
					<label class="oc-field"
						><span>{productT.disclosure}</span><select bind:value={scheduleForm.disclosureMode}
							><option value="required">required</option><option value="auto">auto</option><option
								value="off">off</option
							></select
						></label
					>
				</div>
				<button
					type="button"
					class="oc-btn oc-btn--ghost"
					onclick={previewProductMatching}
					disabled={previewBusy || !productPreviewReady}
				>
					{previewBusy ? productT.previewing : productT.preview}
				</button>
				{#if !productPreviewReady}
					<small class="oc-field__hint oc-field__hint--block">{t.productPreviewGate}</small>
				{/if}
				{#if productPreview}
					<div class="oc-product-preview">
						<p>
							<strong>{productT.decision}:</strong>
							{productPreview.decision} — {productPreview.decisionReason}
						</p>
						{#if productPreview.selectedProducts?.length}
							<h4>{productT.selected}</h4>
							<ul>
								{#each productPreview.selectedProducts as item (item.productId || item.id || item._id || item.name)}<li
									>
										{item.name} — {Math.round((item.relevanceScore || 0) * 100)}%
									</li>{/each}
							</ul>
						{/if}
						{#if productPreview.topCandidates?.length}
							<h4>{productT.candidates}</h4>
							<ul>
								{#each productPreview.topCandidates as item (item.productId || item.id || item._id || item.name)}<li
									>
										<strong>{item.name}</strong> — {Math.round((item.totalScore || 0) * 100)}% · {Object.entries(
											item.scoreBreakdown || {}
										)
											.map(([key, value]) => `${key}: ${Math.round(value * 100)}%`)
											.join(', ')}
									</li>{/each}
							</ul>
						{/if}
						{#if productPreview.rejectedCandidates?.length}
							<h4>{productT.rejected}</h4>
							<ul>
								{#each productPreview.rejectedCandidates as item (item.productId || item.id || item._id || item.name)}<li
									>
										{item.name}: {(item.rejectionReasons || []).join(', ')}
									</li>{/each}
							</ul>
						{/if}
						{#if productPreview.warnings?.length}<p>
								<strong>{productT.warnings}:</strong>
								{productPreview.warnings.join(', ')}
							</p>{/if}
						{#if productPreview.editorialOutline}
							<h4>{productT.outline}</h4>
							<p>
								<strong>{productPreview.editorialProductPlacement?.placementStyle}</strong> · {productPreview
									.editorialProductPlacement?.ownedProductPositionPolicy || 'none'} · {productPreview
									.editorialProductPlacement?.firstProductMention?.minimumSectionsBeforeProduct ||
									0} sections / {productPreview.editorialProductPlacement?.firstProductMention
									?.minimumProgressPercent || 0}%
							</p>
							<ul>
								{#each productPreview.editorialOutline.prerequisites || [] as item (item.sectionKey)}<li
									>
										{item.sectionKey}: {item.purpose}
									</li>{/each}
								{#each productPreview.editorialOutline.placements || [] as item (item.placementId)}<li
									>
										{item.placementId}: {item.sectionKey} — {item.rankPosition}
									</li>{/each}
							</ul>
						{/if}
					</div>
				{/if}
			</fieldset>

			<fieldset class="oc-form__section">
				<legend>{t.secPublishing}</legend>
				<label class="oc-check">
					<input type="checkbox" bind:checked={scheduleForm.enabled} />
					<span>{t.enabledSwitch}</span>
				</label>
				<label class="oc-check">
					<input type="checkbox" bind:checked={scheduleForm.autoPublish} />
					<span>{t.autoPublishSwitch}</span>
				</label>
			</fieldset>

			<div class="oc-form__footer">
				<button type="button" class="oc-btn oc-btn--ghost" onclick={() => fillScheduleForm(null)}
					>{t.reset}</button
				>
				<button
					type="submit"
					class="oc-btn oc-btn--primary"
					disabled={busyScheduleAction === 'save'}
				>
					{busyScheduleAction === 'save' ? t.saving : t.save}
				</button>
			</div>
		</form>
	</div>
</section>

<style>
	.oc-schedules {
		--oc-surface: var(--admin-surface, #ffffff);
		--oc-surface-2: #f9fafb;
		--oc-border: var(--admin-border, #e5e7eb);
		--oc-border-soft: rgba(17, 24, 39, 0.07);
		--oc-text: var(--admin-ink, #1a1f2e);
		--oc-muted: var(--admin-muted, #6b7280);
		--oc-primary: var(--admin-accent, #0f766e);
		--oc-primary-strong: var(--admin-accent-strong, #065f5a);
		--oc-primary-soft: var(--admin-accent-soft, rgba(15, 118, 110, 0.08));
		--oc-danger: var(--admin-danger, #dc2626);
		--oc-radius: var(--admin-radius, 12px);
		--oc-radius-sm: 9px;
		--oc-shadow: var(--admin-shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.05));
		background: var(--oc-surface);
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius);
		box-shadow: var(--oc-shadow);
		padding: clamp(16px, 1.6vw, 20px);
		display: grid;
		gap: 14px;
		min-width: 0;
		color: var(--oc-text);
	}

	.oc-schedules h2,
	.oc-schedules h3 {
		margin: 0;
	}

	.oc-panel__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
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

	.oc-alert {
		padding: 12px 16px;
		border-radius: var(--oc-radius);
		border: 1px solid rgba(220, 38, 38, 0.2);
		background: rgba(220, 38, 38, 0.08);
		color: #991b1b;
		font-size: 0.9rem;
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

	.oc-btn:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.oc-btn:focus-visible,
	.oc-chip-btn:focus-visible,
	.oc-weekday:focus-visible,
	.oc-sched-card__main:focus-visible {
		outline: 2px solid var(--oc-primary);
		outline-offset: 2px;
	}

	/* ── Badges ── */
	.oc-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		width: fit-content;
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 0.72rem;
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

	/* ── Layout ── */
	.oc-sched-layout {
		display: grid;
		grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.2fr);
		gap: 16px;
		align-items: start;
	}

	.oc-sched-side {
		display: grid;
		gap: 12px;
		min-width: 0;
	}

	.oc-sched-toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	/* ── Schedule cards ── */
	.oc-sched-list {
		display: grid;
		gap: 10px;
		max-height: 480px;
		overflow: auto;
		padding-right: 2px;
	}

	.oc-sched-card {
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface);
		padding: 12px;
		display: grid;
		gap: 10px;
		transition:
			border-color 0.18s ease,
			box-shadow 0.18s ease;
	}

	.oc-sched-card.is-selected {
		border-color: var(--oc-primary);
		box-shadow: inset 3px 0 0 var(--oc-primary);
	}

	.oc-sched-card__main {
		border: 0;
		background: transparent;
		color: inherit;
		text-align: left;
		display: grid;
		gap: 8px;
		cursor: pointer;
		padding: 0;
	}

	.oc-sched-card__top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.oc-sched-card__top strong {
		font-size: 0.92rem;
		overflow-wrap: anywhere;
	}

	.oc-sched-card__meta {
		display: grid;
		gap: 4px;
		margin: 0;
	}

	.oc-sched-card__meta > div {
		display: grid;
		grid-template-columns: 74px minmax(0, 1fr);
		gap: 8px;
		align-items: baseline;
	}

	.oc-sched-card__meta dt {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--oc-muted);
	}

	.oc-sched-card__meta dd {
		margin: 0;
		font-size: 0.8rem;
		overflow-wrap: anywhere;
	}

	.oc-sched-card__actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		border-top: 1px solid var(--oc-border-soft);
		padding-top: 10px;
	}

	.oc-chip-btn {
		border: 1px solid var(--oc-border);
		border-radius: 8px;
		background: var(--oc-surface);
		color: var(--oc-text);
		padding: 6px 10px;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			border-color 0.18s ease,
			background 0.18s ease,
			color 0.18s ease;
	}

	.oc-chip-btn:hover:not(:disabled) {
		border-color: var(--oc-primary);
		background: var(--oc-primary-soft);
		color: var(--oc-primary-strong);
	}

	.oc-chip-btn:disabled {
		opacity: 0.55;
		cursor: wait;
	}

	.oc-chip-btn--run {
		border-color: rgba(15, 118, 110, 0.4);
		color: var(--oc-primary-strong);
		font-weight: 700;
	}

	.oc-chip-btn--danger:hover:not(:disabled) {
		border-color: rgba(220, 38, 38, 0.5);
		background: rgba(220, 38, 38, 0.06);
		color: #b91c1c;
	}

	/* ── Executions ── */
	.oc-exec {
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface-2);
		padding: 12px;
		display: grid;
		gap: 10px;
	}

	.oc-exec__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.oc-exec__head h3 {
		font-size: 0.9rem;
		font-weight: 700;
	}

	.oc-exec__list {
		display: grid;
		gap: 8px;
		max-height: 320px;
		overflow: auto;
	}

	.oc-exec__row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 4px 10px;
		padding: 10px;
		border: 1px solid var(--oc-border);
		border-radius: 8px;
		background: var(--oc-surface);
		font-size: 0.8rem;
	}

	.oc-exec__row small {
		color: var(--oc-muted);
		font-size: 0.74rem;
	}

	.oc-exec__title {
		overflow-wrap: anywhere;
		font-weight: 600;
	}

	.oc-exec__error {
		color: #b91c1c !important;
	}

	.oc-exec__row a {
		color: var(--oc-primary);
		font-weight: 700;
		text-decoration: none;
	}

	.oc-exec__row a:hover {
		text-decoration: underline;
	}

	/* ── Form ── */
	.oc-form {
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface);
		padding: 16px;
		display: grid;
		gap: 16px;
		min-width: 0;
	}

	.oc-form__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
	}

	.oc-form__head h3 {
		font-size: 0.95rem;
		font-weight: 700;
	}

	.oc-form__head span {
		font-size: 0.78rem;
		color: var(--oc-muted);
	}

	.oc-form__section {
		border: 0;
		border-top: 1px solid var(--oc-border-soft);
		margin: 0;
		padding: 14px 0 0;
		display: grid;
		gap: 12px;
	}

	.oc-form__section legend {
		padding: 0;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--oc-muted);
	}

	.oc-form__grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}

	.oc-field {
		display: grid;
		gap: 6px;
		min-width: 0;
	}

	.oc-field--narrow {
		max-width: 200px;
	}

	.oc-field > span {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--oc-text);
	}

	.oc-field input,
	.oc-field select,
	.oc-field textarea {
		width: 100%;
		border: 1px solid var(--oc-border);
		border-radius: 9px;
		background: var(--oc-surface);
		color: var(--oc-text);
		padding: 9px 11px;
		font: inherit;
		font-size: 0.86rem;
		transition:
			border-color 0.18s ease,
			box-shadow 0.18s ease;
	}

	.oc-field input:focus,
	.oc-field select:focus,
	.oc-field textarea:focus {
		outline: none;
		border-color: var(--oc-primary);
		box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
	}

	.oc-field textarea {
		resize: vertical;
		min-height: 76px;
	}

	.oc-topic-count {
		display: block;
		text-align: right;
		font-size: 0.72rem;
		opacity: 0.65;
	}

	.oc-topic-count.is-over-limit {
		color: #c0392b;
		opacity: 1;
		font-weight: 700;
	}

	.oc-field__hint {
		font-size: 0.74rem;
		line-height: 1.4;
		color: var(--oc-muted);
	}

	.oc-field__hint--block {
		margin-top: -4px;
	}

	.oc-weekdays {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.oc-weekday {
		min-width: 42px;
		border: 1px solid var(--oc-border);
		border-radius: 8px;
		background: var(--oc-surface);
		color: var(--oc-text);
		padding: 7px 4px;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			border-color 0.18s ease,
			background 0.18s ease,
			color 0.18s ease;
	}

	.oc-weekday:hover {
		border-color: var(--oc-primary);
	}

	.oc-weekday.is-active {
		background: var(--oc-primary);
		border-color: var(--oc-primary);
		color: #fff;
	}

	.oc-check {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--oc-border);
		border-radius: 9px;
		background: var(--oc-surface-2);
		cursor: pointer;
	}

	.oc-check input {
		width: 18px;
		height: 18px;
		margin: 1px 0 0;
		accent-color: var(--oc-primary);
		cursor: pointer;
		flex-shrink: 0;
	}

	.oc-check span {
		font-size: 0.84rem;
		line-height: 1.4;
	}

	.oc-form__footer {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 4px;
	}

	/* ── Empty state ── */
	.oc-empty {
		display: grid;
		gap: 6px;
		justify-items: center;
		align-content: center;
		text-align: center;
		padding: 24px 16px;
		border-radius: var(--oc-radius-sm);
		background: var(--oc-surface-2);
		border: 1px dashed var(--oc-border);
		color: var(--oc-muted);
	}

	.oc-empty--sm {
		padding: 16px;
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
		font-size: 0.88rem;
	}

	/* ── Responsive ── */
	.oc-product-preview,
	.oc-exec__product {
		display: grid;
		gap: 7px;
		padding: 12px;
		border: 1px solid var(--oc-border);
		border-radius: var(--oc-radius-sm);
		background: var(--oc-primary-soft);
		font-size: 0.8rem;
	}

	.oc-product-preview p,
	.oc-product-preview h4,
	.oc-product-preview ul,
	.oc-exec__product ul {
		margin: 0;
	}

	.oc-exec__product summary {
		cursor: pointer;
		font-weight: 700;
	}

	@media (max-width: 960px) {
		.oc-sched-layout {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 560px) {
		.oc-form__grid {
			grid-template-columns: 1fr;
		}

		.oc-field--narrow {
			max-width: none;
		}

		.oc-form__footer .oc-btn {
			flex: 1 1 auto;
		}
	}
</style>
