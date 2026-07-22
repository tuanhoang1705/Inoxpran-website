const ACTIVE_STATUSES = new Set(['queued', 'running']);
const SUCCESS_STATUSES = new Set([
	'draft_created',
	'maintenance_created',
	'completed',
	'published',
	'skipped'
]);
const FAILURE_STATUSES = new Set(['blocked', 'failed', 'timed_out', 'tracking_timeout']);

const dateMs = (value) => {
	const parsed = new Date(value || '').getTime();
	return Number.isFinite(parsed) ? parsed : null;
};

export const selectDefaultDailyDraftSchedule = (schedules = [], selectedId = '') => {
	const available = Array.isArray(schedules) ? schedules.filter((schedule) => schedule?.id) : [];
	return (
		available.find((schedule) => schedule.id === selectedId) ||
		available.find((schedule) => schedule.enabled) ||
		available[0] ||
		null
	);
};

export const selectQueuedDailyDraftExecution = (
	executions = [],
	{ scheduleId = '', queuedAt = '', executionId = '' } = {}
) => {
	const candidates = (Array.isArray(executions) ? executions : [])
		.filter((execution) => !scheduleId || execution?.scheduleId === scheduleId)
		.sort(
			(left, right) =>
				(dateMs(right?.createdAt || right?.startedAt) || 0) -
				(dateMs(left?.createdAt || left?.startedAt) || 0)
		);
	if (executionId) return candidates.find((execution) => execution?.id === executionId) || null;

	const queuedMs = dateMs(queuedAt);
	if (queuedMs === null) return candidates[0] || null;
	return (
		candidates.find((execution) => {
			const executionMs = dateMs(execution?.createdAt || execution?.startedAt);
			return executionMs !== null && executionMs >= queuedMs - 5000;
		}) || null
	);
};

export const normalizeDailyDraftExecution = (execution = {}, fallback = {}) => {
	const status = String(execution?.status || fallback?.status || 'queued');
	const details = [
		execution?.blogTitle,
		execution?.contentAction ? `content_action=${execution.contentAction}` : '',
		execution?.telegramNotificationStatus ? `telegram=${execution.telegramNotificationStatus}` : ''
	]
		.filter(Boolean)
		.join('\n');
	return {
		...fallback,
		...execution,
		id: execution?.id || fallback?.id || '',
		scheduleId: execution?.scheduleId || fallback?.scheduleId || '',
		status,
		startedAt: execution?.startedAt || fallback?.startedAt || fallback?.queuedAt || '',
		finishedAt: execution?.completedAt || fallback?.finishedAt || '',
		output: details || fallback?.output || '',
		error: execution?.error || fallback?.error || ''
	};
};

export const isDailyDraftRunActive = (status) => ACTIVE_STATUSES.has(String(status || ''));
export const isDailyDraftRunSuccessful = (status) => SUCCESS_STATUSES.has(String(status || ''));
export const isDailyDraftRunFailed = (status) => FAILURE_STATUSES.has(String(status || ''));

export const dailyDraftStatusLabel = (status, isEnglish = false) => {
	const normalized = String(status || 'queued');
	const labels = {
		queued: isEnglish ? 'Queued' : 'Đang xếp hàng',
		running: isEnglish ? 'Running' : 'Đang chạy',
		draft_created: isEnglish ? 'Draft created' : 'Đã tạo bản nháp',
		maintenance_created: isEnglish ? 'Revision staged' : 'Đã tạo bản chỉnh sửa',
		completed: isEnglish ? 'Completed' : 'Hoàn tất',
		published: isEnglish ? 'Published' : 'Đã xuất bản',
		skipped: isEnglish ? 'Skipped safely' : 'Đã bỏ qua an toàn',
		blocked: isEnglish ? 'Blocked' : 'Bị chặn',
		failed: isEnglish ? 'Failed' : 'Lỗi',
		timed_out: isEnglish ? 'Timed out' : 'Quá thời gian',
		tracking_timeout: isEnglish ? 'Check run history' : 'Kiểm tra lịch sử chạy'
	};
	return labels[normalized] || (isEnglish ? 'Unknown' : 'Chưa xác định');
};
