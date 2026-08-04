export const MAX_EXECUTION_SUMMARY_SCHEDULES = 50;
export const MAX_EXECUTIONS_PER_SCHEDULE = 5;

export const normalizeExecutionSummaryScheduleIds = (scheduleIds = []) =>
	[
		...new Set(
			(Array.isArray(scheduleIds) ? scheduleIds : [])
				.map((value) => String(value || '').trim())
				.filter(Boolean)
		)
	].slice(0, MAX_EXECUTION_SUMMARY_SCHEDULES);

export const buildExecutionSummariesRequest = (scheduleIds, limit = 1) => {
	const ids = normalizeExecutionSummaryScheduleIds(scheduleIds);
	if (!ids.length) return null;
	const boundedLimit = Math.min(MAX_EXECUTIONS_PER_SCHEDULE, Math.max(1, Number(limit) || 1));
	const query = new URLSearchParams({
		scheduleIds: ids.join(','),
		limit: String(boundedLimit)
	});
	return {
		ids,
		limit: boundedLimit,
		url: `/admin/api/openclaw/blog-schedules/execution-summaries?${query}`
	};
};
