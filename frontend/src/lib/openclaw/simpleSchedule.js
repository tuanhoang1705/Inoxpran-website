// Client-side contract for the simple Blog Scheduling page.
// Mirrors backend/src/utils/blogSchedule.util.js (expandSimpleSchedulePayload):
// the user only decides name, direction, run times, and the date window.
// Everything else is resolved by the Blog OpenClaw core (BOS).

export const SIMPLE_SCHEDULE_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const MAX_SCHEDULE_TIMES = 12;

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const normalizeTimeToken = (raw) => {
	const match = String(raw || '')
		.replace(/\s+/g, '')
		.match(TIME_PATTERN);
	if (!match) return '';
	return `${match[1].padStart(2, '0')}:${match[2]}`;
};

/**
 * Parses a comma-separated HH:mm list. Whitespace is normalized, duplicates
 * are removed, and the result is sorted. Invalid tokens are reported instead
 * of being silently dropped.
 */
export const parseScheduleTimes = (raw) => {
	const source = Array.isArray(raw)
		? raw.map((item) => String(item ?? ''))
		: String(raw ?? '').split(',');
	const seen = new Set();
	const times = [];
	const invalid = [];
	for (const item of source) {
		const compact = String(item || '').replace(/\s+/g, '');
		if (!compact) continue;
		const time = normalizeTimeToken(compact);
		if (!time) {
			invalid.push(compact.slice(0, 20));
			continue;
		}
		if (seen.has(time)) continue;
		seen.add(time);
		times.push(time);
	}
	times.sort();
	return { times, invalid };
};

const isValidDateString = (value) => {
	if (!DATE_PATTERN.test(String(value || ''))) return false;
	const [year, month, day] = String(value).split('-').map(Number);
	const probe = new Date(Date.UTC(year, month - 1, day));
	return (
		probe.getUTCFullYear() === year &&
		probe.getUTCMonth() === month - 1 &&
		probe.getUTCDate() === day
	);
};

/**
 * Validates the simple scheduling form. Returns { valid, errors, times }.
 * Error values are stable codes; the page maps them to VI/EN copy.
 */
export const validateSimpleScheduleForm = (form = {}) => {
	const errors = {};
	const name = String(form.name || '').trim();
	if (!name) errors.name = 'required';
	else if (name.length > 120) errors.name = 'too_long';
	const direction = String(form.direction || '').trim();
	if (!direction) errors.direction = 'required';
	else if (direction.length > 500) errors.direction = 'too_long';
	const { times, invalid } = parseScheduleTimes(form.times);
	if (invalid.length) errors.times = 'invalid';
	else if (!times.length) errors.times = 'required';
	else if (times.length > MAX_SCHEDULE_TIMES) errors.times = 'too_many';
	const startDate = String(form.startDate || '').trim();
	if (!startDate) errors.startDate = 'required';
	else if (!isValidDateString(startDate)) errors.startDate = 'invalid';
	const endDate = String(form.endDate || '').trim();
	if (endDate) {
		if (!isValidDateString(endDate)) errors.endDate = 'invalid';
		else if (!errors.startDate && endDate < startDate) errors.endDate = 'before_start';
	}
	return { valid: Object.keys(errors).length === 0, errors, times };
};

/**
 * Builds the exact user-facing payload. The payload intentionally contains no
 * advanced Agentic fields: mode, product settings, thresholds, work orders and
 * every other internal decision are resolved server-side by BOS.
 */
export const buildSimpleSchedulePayload = (form = {}) => {
	const { times } = parseScheduleTimes(form.times);
	return {
		simple: true,
		name: String(form.name || '').trim(),
		direction: String(form.direction || '').trim(),
		times,
		startDate: String(form.startDate || '').trim(),
		endDate: String(form.endDate || '').trim() || null,
		enabled: form.enabled === undefined ? true : Boolean(form.enabled)
	};
};

export const dateInVietnam = (value) => {
	if (!value) return '';
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: SIMPLE_SCHEDULE_TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(date);
};

export const dateTimeInVietnam = (value, localeTag = 'vi-VN') => {
	if (!value) return '';
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat(localeTag, {
		timeZone: SIMPLE_SCHEDULE_TIMEZONE,
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(date);
};

/** Run times shown in the schedule list, covering legacy schedule shapes. */
export const scheduleRunTimes = (schedule = {}) => {
	if (schedule.scheduleType === 'weekly') return schedule.weekly?.times || [];
	if (schedule.scheduleType === 'interval') {
		const interval = schedule.interval || {};
		return [`~${interval.value || 24} ${interval.unit || 'hours'}`];
	}
	return schedule.daily?.times || [];
};

/** Prefills the edit form from a stored schedule (simple or legacy). */
export const scheduleToSimpleForm = (schedule = {}) => ({
	id: schedule.id || '',
	name: schedule.name || '',
	direction: schedule.direction || schedule.description || schedule.agentConfig?.topic || '',
	times: scheduleRunTimes(schedule)
		.filter((time) => TIME_PATTERN.test(String(time)))
		.join(', '),
	startDate: dateInVietnam(schedule.startAt),
	endDate: dateInVietnam(schedule.endAt),
	enabled: schedule.enabled !== false
});

const RESULT_LABELS = {
	draft_created: { vi: 'Đã tạo bản nháp', en: 'Draft created' },
	maintenance_created: { vi: 'Đã hoàn tất bảo trì nội dung', en: 'Maintenance completed' },
	published: { vi: 'Đã xuất bản (theo chính sách riêng)', en: 'Published (separate policy)' },
	completed: { vi: 'Đã hoàn tất', en: 'Completed' },
	skipped: {
		vi: 'Không tạo bài mới vì nội dung hiện có đã bao phủ định hướng này hoặc chưa tìm thấy cơ hội nội dung đủ giá trị',
		en: 'Skipped because existing content already covers this direction or no valuable opportunity was found'
	},
	daily_limit: { vi: 'Đã đạt giới hạn bài trong ngày', en: 'Daily limit reached' },
	blocked: { vi: 'Bị chặn bởi chốt an toàn', en: 'Blocked' },
	failed: { vi: 'Thất bại', en: 'Failed' },
	running: { vi: 'Đang chạy', en: 'Running' },
	committing: { vi: 'Đang chạy', en: 'Running' },
	retry_wait: { vi: 'Đang tự thử lại', en: 'Retrying automatically' },
	queued: { vi: 'Đang chờ xử lý', en: 'Queued' },
	'': { vi: 'Đang chờ lần chạy kế tiếp', en: 'Waiting for next run' }
};

export const simpleResultLabel = (status, isEn = false) => {
	const entry = RESULT_LABELS[String(status || '')] || RESULT_LABELS[''];
	return isEn ? entry.en : entry.vi;
};

export const simpleResultTone = (status) => {
	const value = String(status || '');
	if (['failed', 'blocked'].includes(value)) return 'danger';
	if (['draft_created', 'maintenance_created', 'completed', 'published'].includes(value))
		return 'good';
	return 'muted';
};

const SAFE_SKIP_OUTCOME_CODES = new Set([
	'ROADMAP_NO_ACCEPTABLE_TOPIC',
	'ROADMAP_NO_READY_TOPIC',
	'ROADMAP_NO_SAFE_TOPIC'
]);
const SOURCE_WARNING_CODES = new Set([
	'GOOGLE_INTELLIGENCE_SNAPSHOT_UNAVAILABLE',
	'ROADMAP_INTELLIGENCE_UNAVAILABLE',
	'ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE',
	'ROADMAP_SCORE_UNREACHABLE'
]);

export const simpleExecutionOutcomeKind = (errorCode) => {
	const normalized = String(errorCode || '').trim();
	if (SAFE_SKIP_OUTCOME_CODES.has(normalized)) return 'safe_skip';
	if (SOURCE_WARNING_CODES.has(normalized)) return 'source_warning';
	return normalized ? 'failure' : '';
};

export const simpleExecutionDisplayStatus = (status, errorCode) =>
	simpleExecutionOutcomeKind(errorCode) === 'safe_skip' ? 'skipped' : status;

export const simpleExecutionTone = (status, errorCode) => {
	const outcomeKind = simpleExecutionOutcomeKind(errorCode);
	if (outcomeKind === 'safe_skip') return 'muted';
	if (outcomeKind === 'source_warning') return 'warning';
	return simpleResultTone(status);
};

const ERROR_LABELS = {
	GOOGLE_INTELLIGENCE_SNAPSHOT_UNAVAILABLE: {
		vi: 'Google Intelligence chưa có dữ liệu đạt chuẩn cho hôm nay.',
		en: 'Google Intelligence has no acceptable data for today.'
	},
	BLOG_SCHEDULE_EXECUTION_FAILED: {
		vi: 'Pipeline tạo blog gặp lỗi. Hãy kiểm tra Lõi Blog OpenClaw (BOS).',
		en: 'The blog pipeline failed. Check Blog OpenClaw Settings (BOS).'
	},
	ROADMAP_NO_READY_TOPIC: {
		vi: 'Chưa có chủ đề nào sẵn sàng trong kế hoạch. Hệ thống sẽ tự nạp lại chủ đề mới ở lần chạy kế tiếp.',
		en: 'No ready topic in the roadmap yet. The system will refill new topics on the next run.'
	},
	ROADMAP_NO_SAFE_TOPIC: {
		vi: 'Chưa tìm được chủ đề mới đủ khác biệt và an toàn cho định hướng này. Hãy thử điều chỉnh định hướng hoặc chạy lại sau.',
		en: 'No sufficiently distinct, safe topic was found for this direction. Adjust the direction or try again later.'
	},
	ROADMAP_NO_ACCEPTABLE_TOPIC: {
		vi: 'Chưa có chủ đề nào đạt ngưỡng khác biệt và an toàn đang áp dụng. Lần chạy này được bỏ qua an toàn; hệ thống sẽ thử lại ở lịch kế tiếp.',
		en: 'No topic reached the active novelty and safety gate. This run was safely skipped and the schedule will try again next time.'
	},
	ROADMAP_REGENERATION_SUPERSEDED: {
		vi: 'Yêu cầu nghiên cứu đã được thay thế vì định hướng hoặc kế hoạch hiện tại đã thay đổi.',
		en: 'This research request was superseded because the direction or active roadmap changed.'
	},
	ROADMAP_REGENERATION_ATTEMPTS_EXHAUSTED: {
		vi: 'Nghiên cứu chủ đề đã hết số lần thử an toàn. Kế hoạch cũ vẫn được giữ nguyên.',
		en: 'Topic research exhausted its safe retry attempts. The previous roadmap remains active.'
	},
	ROADMAP_INTELLIGENCE_UNAVAILABLE: {
		vi: 'Nguồn dữ liệu bắt buộc cho nghiên cứu chủ đề chưa sẵn sàng. Kế hoạch cũ vẫn được giữ nguyên.',
		en: 'Required topic-research intelligence is unavailable. The previous roadmap remains active.'
	},
	ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE: {
		vi: 'Bằng chứng bắt buộc cho việc chấm điểm chủ đề chưa sẵn sàng. Lần chạy được dừng an toàn và kế hoạch cũ vẫn được giữ nguyên.',
		en: 'Required scoring evidence is unavailable. The run stopped safely and the previous roadmap remains active.'
	},
	ROADMAP_SCORE_UNREACHABLE: {
		vi: 'Dữ liệu đã xác thực hiện có chưa thể đạt ngưỡng chất lượng. Hệ thống không gọi model, không thay kế hoạch cũ và sẽ chờ nguồn tốt hơn.',
		en: 'The available verified data cannot reach the quality gate. No model was called and the previous roadmap remains active.'
	},
	OPENCLAW_BACKEND_UNAVAILABLE: {
		vi: 'Chưa thể kết nối backend OpenClaw. Có thể yêu cầu đã được nhận; hãy khôi phục bằng cùng mã yêu cầu.',
		en: 'The OpenClaw backend is unavailable. The request may have been accepted; recover it with the same request key.'
	},
	OPENCLAW_BACKEND_TIMEOUT: {
		vi: 'Backend OpenClaw chưa xác nhận yêu cầu kịp thời. Có thể yêu cầu đã được nhận; hãy khôi phục bằng cùng mã yêu cầu.',
		en: 'The OpenClaw backend did not confirm the request in time. It may have been accepted; recover it with the same request key.'
	},
	OPENCLAW_BACKEND_INVALID_RESPONSE: {
		vi: 'Backend OpenClaw trả phản hồi không hợp lệ. Không có dữ liệu nội bộ nào được hiển thị.',
		en: 'The OpenClaw backend returned an invalid response. No internal response details were shown.'
	},
	OPENCLAW_BACKEND_ERROR: {
		vi: 'Backend OpenClaw gặp lỗi khi xử lý yêu cầu.',
		en: 'The OpenClaw backend failed while processing the request.'
	},
	OPENCLAW_GATEWAY_URL_MISSING: {
		vi: 'Chưa cấu hình OpenClaw Gateway (OPENCLAW_GATEWAY_HTTP_URL). Hãy đặt biến môi trường này để dùng agent.',
		en: 'OpenClaw Gateway is not configured (OPENCLAW_GATEWAY_HTTP_URL). Set this env var to use agents.'
	},
	OPENCLAW_GATEWAY_TOKEN_MISSING: {
		vi: 'Backend chưa có token để xác thực với OpenClaw Gateway.',
		en: 'The backend has no token for OpenClaw Gateway authentication.'
	},
	OPENCLAW_AGENT_HTTP_404: {
		vi: 'OpenClaw Gateway chưa bật endpoint Responses (/v1/responses). Hãy bật gateway.http.endpoints.responses.enabled rồi khởi động lại Gateway.',
		en: 'The OpenClaw Gateway Responses endpoint (/v1/responses) is disabled. Enable gateway.http.endpoints.responses.enabled and restart the Gateway.'
	},
	OPENCLAW_AGENT_HTTP_401: {
		vi: 'OpenClaw gặp lỗi xác thực HTTP 401. Hãy kiểm tra trạng thái Gateway và đăng nhập nhà cung cấp model trong Lõi Blog OpenClaw (BOS).',
		en: 'OpenClaw encountered an HTTP 401 authentication error. Check Gateway and model-provider sign-in in Blog OpenClaw Settings (BOS).'
	},
	OPENCLAW_GATEWAY_AUTH_REJECTED: {
		vi: 'OpenClaw Gateway từ chối token của backend. Hãy đồng bộ OPENCLAW_GATEWAY_TOKEN với gateway.auth.token rồi khởi động lại backend.',
		en: 'OpenClaw Gateway rejected the backend token. Sync OPENCLAW_GATEWAY_TOKEN with gateway.auth.token, then restart the backend.'
	},
	OPENCLAW_PROVIDER_AUTH_EXPIRED: {
		vi: 'Phiên đăng nhập OpenAI/Codex của OpenClaw đã hết hạn. Hãy đăng nhập lại nhà cung cấp OpenAI trong Lõi Blog OpenClaw (BOS).',
		en: 'The OpenClaw OpenAI/Codex sign-in has expired. Sign in to the OpenAI provider again in Blog OpenClaw Settings (BOS).'
	},
	OPENCLAW_PROVIDER_AUTH_FAILED: {
		vi: 'OpenClaw không thể xác thực với nhà cung cấp model. Hãy kiểm tra hồ sơ đăng nhập nhà cung cấp trong Lõi Blog OpenClaw (BOS).',
		en: 'OpenClaw could not authenticate with the model provider. Check the provider auth profile in Blog OpenClaw Settings (BOS).'
	},
	OPENCLAW_AGENT_TIMEOUT: {
		vi: 'Agent OpenClaw phản hồi quá thời gian. Hệ thống sẽ tự thử lại cùng lượt chạy; chỉ cần can thiệp nếu đã hết số lần thử.',
		en: 'The OpenClaw agent timed out. The system will retry the same run automatically; intervene only after retries are exhausted.'
	},
	OPENCLAW_AGENT_HTTP_408: {
		vi: 'OpenClaw chưa phản hồi kịp thời. Hệ thống sẽ tự thử lại cùng lượt chạy và không tạo lượt trùng.',
		en: 'OpenClaw did not respond in time. The system will retry the same run without creating a duplicate.'
	},
	OPENCLAW_AGENT_HTTP_429: {
		vi: 'Nhà cung cấp model đang giới hạn lưu lượng. Hệ thống sẽ tự chờ và thử lại.',
		en: 'The model provider is rate limiting requests. The system will wait and retry automatically.'
	},
	OPENCLAW_AGENT_HTTP_503: {
		vi: 'Dịch vụ model tạm thời chưa sẵn sàng. Hệ thống sẽ tự thử lại.',
		en: 'The model service is temporarily unavailable. The system will retry automatically.'
	},
	OPENCLAW_AGENT_INVALID_JSON: {
		vi: 'Agent OpenClaw trả dữ liệu JSON sai định dạng sau lần tự sửa. Hãy kiểm tra kết quả lần chạy và chạy lại nếu giai đoạn đó không có phương án dự phòng.',
		en: 'The OpenClaw agent returned malformed JSON after automatic repair. Check the run result and retry only if that stage had no fallback.'
	},
	OPENCLAW_AGENT_NON_JSON_RESPONSE: {
		vi: 'Agent OpenClaw không trả dữ liệu JSON sau lần tự sửa. Hãy kiểm tra kết quả lần chạy và chạy lại nếu giai đoạn đó không có phương án dự phòng.',
		en: 'The OpenClaw agent did not return JSON after automatic repair. Check the run result and retry only if that stage had no fallback.'
	},
	OPENCLAW_TOPIC_AGENT_BUDGET_EXHAUSTED: {
		vi: 'Vòng lập kế hoạch chủ đề đã dùng hết thời gian cho phép trước khi chấm xong. Hãy chạy lại hoặc kiểm tra cấu hình thời gian agent trong Lõi Blog OpenClaw (BOS).',
		en: 'Topic planning exhausted its time budget before scoring finished. Retry it or check the agent timing configuration in Blog OpenClaw Settings (BOS).'
	},
	INTERNAL_ERROR: {
		vi: 'Hệ thống gặp lỗi nội bộ. Hãy kiểm tra Lõi Blog OpenClaw (BOS).',
		en: 'The system hit an internal error. Check Blog OpenClaw Settings (BOS).'
	}
};

const sanitizeDecisionReason = (value, maxLength = 240) =>
	[...String(value || '')]
		.map((character) => {
			const code = character.charCodeAt(0);
			return code <= 31 || code === 127 ? ' ' : character;
		})
		.join('')
		.replace(/https?:\/\/[^\s<>"']+/gi, '[link removed]')
		.replace(/\bauthorization\b\s*[:=]\s*(?:bearer|basic)\s+[^\s,;]+/gi, '[redacted]')
		.replace(
			/\b(?:authorization|token|secret|password|credential|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi,
			'[redacted]'
		)
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, Math.max(1, Number(maxLength) || 240));

export const simpleExecutionErrorLabel = (
	errorCode,
	isEn = false,
	{ freeText = false, maxLength = 240 } = {}
) => {
	const normalized = String(errorCode || '').trim();
	if (!normalized) return '';
	const entry = ERROR_LABELS[normalized];
	if (entry) return isEn ? entry.en : entry.vi;
	if (freeText) return sanitizeDecisionReason(normalized, maxLength);
	return isEn ? ERROR_LABELS.INTERNAL_ERROR.en : ERROR_LABELS.INTERNAL_ERROR.vi;
};

export const simpleDecisionReasonLabel = (reason, isEn = false, { maxLength = 240 } = {}) => {
	const normalized = String(reason || '').trim();
	if (!normalized) return '';
	if (ERROR_LABELS[normalized]) return simpleExecutionErrorLabel(normalized, isEn);
	if (/^[A-Z][A-Z0-9_.-]{2,159}$/.test(normalized)) {
		return isEn ? ERROR_LABELS.INTERNAL_ERROR.en : ERROR_LABELS.INTERNAL_ERROR.vi;
	}
	return sanitizeDecisionReason(normalized, maxLength);
};

export const roadmapRegenerationErrorLabel = (errorCode, isEn = false) => {
	const normalized = String(errorCode || '').trim();
	if (normalized === 'OPENCLAW_AGENT_INVALID_JSON') {
		return isEn
			? 'Topic research returned malformed JSON after automatic repair. The replacement was not committed, so the previous roadmap remains active.'
			: 'Nghiên cứu chủ đề trả JSON sai định dạng sau lần tự sửa. Kế hoạch thay thế chưa được áp dụng nên kế hoạch cũ vẫn hoạt động.';
	}
	if (normalized === 'OPENCLAW_AGENT_NON_JSON_RESPONSE') {
		return isEn
			? 'Topic research did not return JSON after automatic repair. The replacement was not committed, so the previous roadmap remains active.'
			: 'Nghiên cứu chủ đề không trả JSON sau lần tự sửa. Kế hoạch thay thế chưa được áp dụng nên kế hoạch cũ vẫn hoạt động.';
	}
	return simpleExecutionErrorLabel(normalized, isEn);
};

export const roadmapOutcomeLabel = (outcomeCode, isEn = false, policy = {}) => {
	const normalized = String(outcomeCode || '').trim();
	if (!normalized) return '';
	if (normalized === 'ROADMAP_REPLACEMENT_COMMITTED') {
		return isEn
			? 'New research passed the active policy and replaced the roadmap.'
			: 'Nghiên cứu mới đã đạt chính sách hiện hành và thay thế kế hoạch.';
	}
	if (normalized === 'ROADMAP_NO_ACCEPTABLE_TOPIC') {
		const threshold = Number(policy.acceptanceScore);
		const thresholdText = Number.isFinite(threshold) ? ` ${threshold}` : '';
		return isEn
			? `No topic reached the active${thresholdText}-point gate. The previous roadmap remains active.`
			: `Chưa có chủ đề nào đạt ngưỡng${thresholdText} điểm đang áp dụng. Kế hoạch cũ vẫn hoạt động.`;
	}
	return simpleExecutionErrorLabel(normalized, isEn);
};

export const roadmapPolicyLabel = (policy = {}, isEn = false) => {
	const acceptance = Number(policy.acceptanceScore);
	const novelty = Number(policy.minimumNoveltySubtotal);
	if (!Number.isFinite(acceptance) || !Number.isFinite(novelty)) return '';
	return isEn
		? `Acceptance ≥ ${acceptance}; novelty subtotal ≥ ${novelty}`
		: `Ngưỡng đạt ≥ ${acceptance}; điểm mới lạ ≥ ${novelty}`;
};

export const roadmapScoreAccepted = (item, policy = {}) => {
	const score = Number(item?.scores?.totalScore);
	const novelty = Number(item?.scores?.noveltySubtotal);
	const acceptance = Number(policy.acceptanceScore);
	const minimumNovelty = Number(policy.minimumNoveltySubtotal);
	if (!Number.isFinite(score) || !Number.isFinite(novelty)) return false;
	if (!Number.isFinite(acceptance) || !Number.isFinite(minimumNovelty)) return false;
	return (
		score >= acceptance && novelty >= minimumNovelty && item?.scores?.hardGatesPassed !== false
	);
};
