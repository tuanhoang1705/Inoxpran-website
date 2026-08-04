import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SIMPLE_SCHEDULE_TIMEZONE,
	buildSimpleSchedulePayload,
	dateInVietnam,
	parseScheduleTimes,
	roadmapOutcomeLabel,
	roadmapRegenerationErrorLabel,
	scheduleRunTimes,
	scheduleToSimpleForm,
	simpleDecisionReasonLabel,
	simpleExecutionDisplayStatus,
	simpleExecutionErrorLabel,
	simpleExecutionOutcomeKind,
	simpleExecutionTone,
	simpleResultLabel,
	simpleResultTone,
	validateSimpleScheduleForm
} from '../src/lib/openclaw/simpleSchedule.js';

const validForm = (overrides = {}) => ({
	name: 'Lịch blog mùa hè',
	direction: 'Các vấn đề gia dụng và làm mát trong mùa hè',
	times: '08:30, 20:00',
	startDate: '2026-07-25',
	endDate: '2026-09-30',
	...overrides
});

test('the timezone is fixed to Vietnam and never user-selectable', () => {
	assert.equal(SIMPLE_SCHEDULE_TIMEZONE, 'Asia/Ho_Chi_Minh');
	const payload = buildSimpleSchedulePayload(validForm());
	assert.ok(!('timezone' in payload), 'payload must not carry a timezone field');
});

test('parses one valid time and multiple comma-separated times', () => {
	assert.deepEqual(parseScheduleTimes('08:30'), { times: ['08:30'], invalid: [] });
	assert.deepEqual(parseScheduleTimes('20:15, 08:30, 14:00').times, ['08:30', '14:00', '20:15']);
});

test('normalizes whitespace, pads hours, and removes duplicate times', () => {
	const { times, invalid } = parseScheduleTimes('  8:30 ,08:30,   20 : 15 ');
	assert.deepEqual(times, ['08:30', '20:15']);
	assert.deepEqual(invalid, []);
});

test('reports invalid hour, minute, and format values instead of dropping them', () => {
	assert.deepEqual(parseScheduleTimes('25:00').invalid, ['25:00']);
	assert.deepEqual(parseScheduleTimes('08:61').invalid, ['08:61']);
	assert.deepEqual(parseScheduleTimes('8h30').invalid, ['8h30']);
	assert.equal(
		validateSimpleScheduleForm(validForm({ times: '08:30, 99:99' })).errors.times,
		'invalid'
	);
});

test('requires schedule name, direction, at least one time, and a start date', () => {
	assert.equal(validateSimpleScheduleForm(validForm({ name: '  ' })).errors.name, 'required');
	assert.equal(
		validateSimpleScheduleForm(validForm({ direction: '' })).errors.direction,
		'required'
	);
	assert.equal(validateSimpleScheduleForm(validForm({ times: '' })).errors.times, 'required');
	assert.equal(
		validateSimpleScheduleForm(validForm({ startDate: '' })).errors.startDate,
		'required'
	);
	assert.equal(validateSimpleScheduleForm(validForm()).valid, true);
});

test('rejects an end date earlier than the start date and invalid dates', () => {
	assert.equal(
		validateSimpleScheduleForm(validForm({ endDate: '2026-07-24' })).errors.endDate,
		'before_start'
	);
	assert.equal(
		validateSimpleScheduleForm(validForm({ startDate: '2026-02-30' })).errors.startDate,
		'invalid'
	);
	assert.equal(validateSimpleScheduleForm(validForm({ endDate: '' })).valid, true);
});

test('the submitted payload contains only the simple contract fields', () => {
	const payload = buildSimpleSchedulePayload(validForm());
	assert.deepEqual(Object.keys(payload).sort(), [
		'direction',
		'enabled',
		'endDate',
		'name',
		'simple',
		'startDate',
		'times'
	]);
	assert.equal(payload.simple, true);
	assert.deepEqual(payload.times, ['08:30', '20:00']);
	for (const forbidden of [
		'mode',
		'scheduleType',
		'agentConfig',
		'minimumOpportunityScore',
		'maximumTasksPerDay',
		'productSeeding',
		'productPlacement',
		'autoPublish',
		'sourceRequirements',
		'monitoringWindows',
		'runLimit',
		'workOrderId',
		'contentAction'
	]) {
		assert.ok(!(forbidden in payload), `payload must not expose ${forbidden}`);
	}
});

test('prefills the edit form from stored simple and legacy schedules', () => {
	const simple = scheduleToSimpleForm({
		id: 'abc',
		name: 'Lịch',
		direction: 'Định hướng',
		scheduleType: 'daily',
		daily: { times: ['08:30', '20:00'] },
		startAt: '2026-07-24T17:00:00.000Z',
		endAt: null,
		enabled: true
	});
	assert.equal(simple.times, '08:30, 20:00');
	assert.equal(simple.startDate, '2026-07-25');
	assert.equal(simple.endDate, '');

	const legacy = scheduleToSimpleForm({
		id: 'legacy',
		name: 'Interval',
		description: 'mô tả cũ',
		scheduleType: 'interval',
		interval: { value: 8, unit: 'hours' },
		enabled: false
	});
	assert.equal(legacy.direction, 'mô tả cũ');
	assert.equal(legacy.times, '', 'interval pseudo-times must not leak into the HH:mm field');
	assert.deepEqual(
		scheduleRunTimes({ scheduleType: 'interval', interval: { value: 8, unit: 'hours' } }),
		['~8 hours']
	);
});

test('date boundaries render in Vietnam time regardless of server timezone', () => {
	assert.equal(dateInVietnam('2026-07-24T17:00:00.000Z'), '2026-07-25');
	assert.equal(dateInVietnam('2026-09-30T16:59:59.000Z'), '2026-09-30');
});

test('maps execution statuses to simple user-facing language in VI and EN', () => {
	assert.equal(simpleResultLabel('draft_created', false), 'Đã tạo bản nháp');
	assert.equal(simpleResultLabel('draft_created', true), 'Draft created');
	assert.match(
		simpleResultLabel('skipped', false),
		/Không tạo bài mới vì nội dung hiện có đã bao phủ/
	);
	assert.equal(simpleResultLabel('failed', true), 'Failed');
	assert.equal(simpleResultLabel('retry_wait', false), 'Đang tự thử lại');
	assert.equal(simpleResultLabel('retry_wait', true), 'Retrying automatically');
	assert.equal(simpleResultLabel('', true), 'Waiting for next run');
	assert.equal(simpleResultTone('failed'), 'danger');
	assert.equal(simpleResultTone('draft_created'), 'good');
	assert.equal(simpleResultTone(''), 'muted');
});

test('safe roadmap outcomes render before failure status and missing evidence stays amber', () => {
	for (const code of [
		'ROADMAP_NO_ACCEPTABLE_TOPIC',
		'ROADMAP_NO_READY_TOPIC',
		'ROADMAP_NO_SAFE_TOPIC'
	]) {
		assert.equal(simpleExecutionOutcomeKind(code), 'safe_skip');
		assert.equal(simpleExecutionDisplayStatus('failed', code), 'skipped');
		assert.equal(simpleExecutionTone('failed', code), 'muted');
	}
	for (const code of ['ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE', 'ROADMAP_SCORE_UNREACHABLE']) {
		assert.equal(simpleExecutionOutcomeKind(code), 'source_warning');
		assert.equal(simpleExecutionTone('blocked', code), 'warning');
	}
	assert.match(
		simpleExecutionErrorLabel('ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE', true),
		/required scoring evidence/i
	);
	assert.match(
		simpleExecutionErrorLabel('ROADMAP_SCORE_UNREACHABLE', true),
		/no model was called/i
	);
});

test('maps stable execution error codes to actionable copy', () => {
	assert.equal(
		simpleExecutionErrorLabel('GOOGLE_INTELLIGENCE_SNAPSHOT_UNAVAILABLE', false),
		'Google Intelligence chưa có dữ liệu đạt chuẩn cho hôm nay.'
	);
	assert.equal(
		simpleExecutionErrorLabel('GOOGLE_INTELLIGENCE_SNAPSHOT_UNAVAILABLE', true),
		'Google Intelligence has no acceptable data for today.'
	);
	assert.equal(
		simpleExecutionErrorLabel('OPENCLAW_AGENT_HTTP_404', true),
		'The OpenClaw Gateway Responses endpoint (/v1/responses) is disabled. Enable gateway.http.endpoints.responses.enabled and restart the Gateway.'
	);
	assert.equal(
		simpleExecutionErrorLabel('OPENCLAW_AGENT_HTTP_401', false),
		'OpenClaw gặp lỗi xác thực HTTP 401. Hãy kiểm tra trạng thái Gateway và đăng nhập nhà cung cấp model trong Lõi Blog OpenClaw (BOS).'
	);
	assert.equal(
		simpleExecutionErrorLabel('OPENCLAW_AGENT_TIMEOUT', false),
		'Agent OpenClaw phản hồi quá thời gian. Hệ thống sẽ tự thử lại cùng lượt chạy; chỉ cần can thiệp nếu đã hết số lần thử.'
	);
	assert.equal(
		simpleExecutionErrorLabel('OPENCLAW_AGENT_HTTP_408', false),
		'OpenClaw chưa phản hồi kịp thời. Hệ thống sẽ tự thử lại cùng lượt chạy và không tạo lượt trùng.'
	);
	assert.equal(
		simpleExecutionErrorLabel('OPENCLAW_AGENT_INVALID_JSON', false),
		'Agent OpenClaw trả dữ liệu JSON sai định dạng sau lần tự sửa. Hãy kiểm tra kết quả lần chạy và chạy lại nếu giai đoạn đó không có phương án dự phòng.'
	);
	assert.equal(
		simpleExecutionErrorLabel('OPENCLAW_TOPIC_AGENT_BUDGET_EXHAUSTED', false),
		'Vòng lập kế hoạch chủ đề đã dùng hết thời gian cho phép trước khi chấm xong. Hãy chạy lại hoặc kiểm tra cấu hình thời gian agent trong Lõi Blog OpenClaw (BOS).'
	);
	assert.equal(
		simpleExecutionErrorLabel('OPENCLAW_GATEWAY_AUTH_REJECTED', true),
		'OpenClaw Gateway rejected the backend token. Sync OPENCLAW_GATEWAY_TOKEN with gateway.auth.token, then restart the backend.'
	);
	assert.equal(
		simpleExecutionErrorLabel('OPENCLAW_PROVIDER_AUTH_EXPIRED', false),
		'Phiên đăng nhập OpenAI/Codex của OpenClaw đã hết hạn. Hãy đăng nhập lại nhà cung cấp OpenAI trong Lõi Blog OpenClaw (BOS).'
	);
	assert.equal(
		simpleExecutionErrorLabel('OPENCLAW_PROVIDER_AUTH_FAILED', true),
		'OpenClaw could not authenticate with the model provider. Check the provider auth profile in Blog OpenClaw Settings (BOS).'
	);
	assert.equal(
		simpleExecutionErrorLabel('ROADMAP_NO_ACCEPTABLE_TOPIC', true),
		'No topic reached the active novelty and safety gate. This run was safely skipped and the schedule will try again next time.'
	);
	assert.match(simpleExecutionErrorLabel('UNKNOWN_FAILURE', false), /Lõi Blog OpenClaw/);
});

test('keeps natural-language reasons while hiding raw technical decision codes', () => {
	assert.equal(
		simpleDecisionReasonLabel('Existing content already covers this direction.', true),
		'Existing content already covers this direction.'
	);
	assert.equal(
		simpleDecisionReasonLabel('INTERNAL_ERROR', true),
		'The system hit an internal error. Check Blog OpenClaw Settings (BOS).',
		'technical codes must never be rendered raw'
	);
	assert.equal(
		simpleDecisionReasonLabel(
			'token=secret authorization: Bearer bearer-secret https://user:password@example.invalid/private',
			true
		),
		'[redacted] [redacted] [link removed]'
	);
	assert.match(
		roadmapRegenerationErrorLabel('OPENCLAW_AGENT_INVALID_JSON', true),
		/replacement was not committed/i
	);
	assert.match(
		roadmapOutcomeLabel('ROADMAP_NO_ACCEPTABLE_TOPIC', true, { acceptanceScore: 90 }),
		/90-point/
	);
});
