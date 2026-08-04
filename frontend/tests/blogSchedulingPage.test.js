import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const schedulingPage = read('src/routes/admin/openclaw/blogs/+page.svelte');
const schedulingLoader = read('src/routes/admin/openclaw/blogs/+page.server.js');
const bosPage = read('src/routes/admin/openclaw/blogs/settings/+page.svelte');
const layout = read('src/routes/admin/+layout.svelte');
const operationProxy = read(
	'src/routes/admin/api/openclaw/blog-schedules/[scheduleId]/[operation]/+server.js'
);
const roadmapPanel = read('src/lib/components/admin/openclaw/BlogTopicRoadmapPanel.svelte');
const roadmapProxy = read(
	'src/routes/admin/api/openclaw/blog-schedules/[scheduleId]/roadmap/+server.js'
);
const roadmapRegenerateProxy = read(
	'src/routes/admin/api/openclaw/blog-schedules/[scheduleId]/roadmap/regenerate/+server.js'
);
const roadmapDismissProxy = read(
	'src/routes/admin/api/openclaw/blog-schedules/[scheduleId]/roadmap/items/[itemId]/dismiss/+server.js'
);
const roadmapProxyHelper = read('src/lib/server/openclawRoadmapProxy.js');
const executionSummariesProxy = read(
	'src/routes/admin/api/openclaw/blog-schedules/execution-summaries/+server.js'
);
const simpleSchedule = read('src/lib/openclaw/simpleSchedule.js');
const executionSummaries = read('src/lib/openclaw/executionSummaries.js');

test('schedule-load failures stay sanitized and localize with a safe reference', () => {
	assert.match(schedulingLoader, /loadErrorCode:\s*BLOG_SCHEDULES_LOAD_FAILED/);
	assert.match(schedulingLoader, /loadRequestId:\s*safeRequestId/);
	assert.doesNotMatch(schedulingLoader, /Internal Server Error/);
	assert.doesNotMatch(schedulingLoader, /Unable to load blog schedules/);
	assert.match(schedulingPage, /Unable to load blog schedules\. Please try again shortly\./);
	assert.match(schedulingPage, /Không thể tải lịch Blog\. Vui lòng thử lại sau\./);
	assert.match(schedulingPage, /Mã tra cứu/);
	assert.match(schedulingPage, /withRequestReference\(t\.loadFailed, data\?\.loadRequestId\)/);
	assert.match(schedulingPage, /OPENCLAW_BACKEND_ERROR/);
	assert.match(schedulingPage, /OPENCLAW_BACKEND_INVALID_RESPONSE/);
});

test('the scheduling page exposes only the simple contract inputs', () => {
	for (const field of [
		'name="name"',
		'name="direction"',
		'name="times"',
		'name="startDate"',
		'name="endDate"'
	]) {
		assert.match(schedulingPage, new RegExp(field));
	}
	assert.match(schedulingPage, /buildSimpleSchedulePayload/);
	assert.match(schedulingPage, /validateSimpleScheduleForm/);
	assert.match(schedulingPage, /Asia\/Ho_Chi_Minh|SIMPLE_SCHEDULE_TIMEZONE/);
	for (const forbidden of [
		'best_action',
		'fixed_brief',
		'maintenance_only',
		'minimumOpportunityScore',
		'maximumTasksPerDay',
		'productSeeding',
		'productPlacement',
		'sourceRequirements',
		'monitoringWindows',
		'workOrder',
		'agentConfig',
		'autoPublish',
		'timezone selector',
		'<select'
	]) {
		assert.ok(
			!schedulingPage.includes(forbidden),
			`scheduling page must not expose advanced control: ${forbidden}`
		);
	}
});

test('the removed generic Run Daily Draft action stays gone', () => {
	// The per-schedule "Run now" is intentionally present (see next test); the
	// generic forced-daily-article action from the old Daily Draft page is not.
	for (const source of [schedulingPage, schedulingLoader, bosPage, layout]) {
		assert.ok(!/Run Daily Draft/i.test(source), 'Run Daily Draft must not appear');
		assert.ok(!/Chạy Daily Draft/i.test(source), 'Chạy Daily Draft must not appear');
		assert.ok(!/Chạy daily draft/i.test(source), 'daily draft run copy must not appear');
	}
	// run-now stays out of the BOS console, the loader, and the sidebar; it is a
	// per-schedule list action only.
	for (const source of [schedulingLoader, bosPage, layout]) {
		assert.ok(!/run-now/i.test(source), 'run-now must not leak outside the schedule list');
	}
});

test('the schedule list supports a safe per-schedule Run now', () => {
	assert.match(schedulingPage, /runScheduleNow\(schedule\)/);
	assert.match(schedulingPage, /\/run-now/);
	assert.match(schedulingPage, /'Idempotency-Key': idempotencyKey/);
	assert.match(schedulingPage, /createOpenClawActionIdempotencyManager/);
	assert.match(schedulingPage, /shouldRetainOpenClawActionKey/);
	// Duplicate-submit guard and no auto-publish escalation.
	assert.match(schedulingPage, /if \(runNowBusyId\) return;/);
	assert.ok(!/autoPublish/i.test(schedulingPage), 'run now must not enable publishing');
	// The proxy re-allows run-now but still requires a validated Idempotency-Key.
	assert.match(operationProxy, /'enable', 'disable', 'pause', 'resume', 'run-now'/);
	assert.match(operationProxy, /A valid Idempotency-Key is required/);
	assert.match(operationProxy, /proxyOpenClawRoadmapRequest/);
	assert.match(operationProxy, /requestId/);
});

test('schedule list offers edit, run now, pause, resume, delete and a draft link', () => {
	assert.match(schedulingPage, /startEdit\(schedule\)/);
	assert.match(schedulingPage, /setEnabled\(schedule, !schedule\.enabled\)/);
	assert.match(schedulingPage, /deleteSchedule\(schedule\)/);
	assert.match(schedulingPage, /\/executions\?limit=\$\{limit\}/);
	assert.match(schedulingPage, /admin\/blogs\/\$\{execution\.blogId\}/);
	assert.match(schedulingPage, /simpleResultLabel/);
});

test('schedule status uses smart polling and restores background runs after reload', () => {
	assert.match(schedulingPage, /createSmartPoller/);
	assert.match(schedulingPage, /fetchExecutionSummaries/);
	assert.match(executionSummaries, /execution-summaries/);
	assert.match(schedulingPage, /ACTIVE_EXECUTION_STATUSES/);
	assert.match(schedulingPage, /activeIntervalMs: 3000/);
	assert.match(schedulingPage, /idleIntervalMs: 30000/);
	assert.match(schedulingPage, /schedulePoller\?\.poke\('run-now'\)/);
	assert.ok(
		!schedulingPage.includes('setInterval('),
		'polling must not overlap through setInterval'
	);
});

test('the operator cockpit separates autonomous work, retrying runs, and true incidents', () => {
	for (const operatorCopy of [
		'Trạm điều hành Blog',
		'Tình hình hôm nay',
		'Hàng đợi công việc OpenClaw',
		'Cần bạn xử lý',
		'Chỉ tạo bản nháp — bạn luôn kiểm soát'
	]) {
		assert.ok(schedulingPage.includes(operatorCopy), `cockpit must include ${operatorCopy}`);
	}
	assert.match(schedulingPage, /retry_wait/);
	assert.match(schedulingPage, /activeExecutionRows/);
	assert.match(schedulingPage, /operatorIncidents/);
	assert.match(schedulingPage, /The same run is kept; no duplicate draft is created/);
});

test('each schedule opens results and roadmap in an independent full-width detail region', () => {
	assert.match(schedulingPage, /BlogTopicRoadmapPanel/);
	assert.match(schedulingPage, /toggleRoadmap\(detailSchedule\)/);
	assert.match(schedulingPage, /<BlogTopicRoadmapPanel scheduleId=\{detailSchedule\.id\} \/>/);
	assert.match(schedulingPage, /\{#key detailSchedule\.id\}/);
	assert.match(schedulingPage, /Kế hoạch chủ đề/);
	assert.match(schedulingPage, /toggleResults\(detailSchedule\)/);
	assert.match(schedulingPage, /class="bs-detail"/);
	assert.match(schedulingPage, /<details class="bs-disclosure"/);
	// Results and roadmap are separate disclosures, so opening one never closes the other.
	assert.match(schedulingPage, /roadmapOpen/);
	assert.match(schedulingPage, /resultsOpen/);
	assert.match(
		schedulingPage,
		/aria-expanded=\{detailScheduleId === schedule\.id && roadmapOpen\}/
	);
	assert.match(
		schedulingPage,
		/aria-expanded=\{detailScheduleId === schedule\.id && resultsOpen\}/
	);
});

test('the roadmap panel is container-responsive with compact disclosure cards', () => {
	assert.match(roadmapPanel, /container-type: inline-size/);
	assert.match(roadmapPanel, /@container/);
	assert.match(roadmapPanel, /tr-card__summary/);
	assert.match(roadmapPanel, /tr-evidence-disclosure/);
	assert.match(roadmapPanel, /visibleItemLimit/);
	// The stretching rank rail is gone; a compact badge replaces it.
	assert.ok(!/tr-card__rail/.test(roadmapPanel), 'the full-height rank rail must be removed');
	assert.match(roadmapPanel, /scoreAccepted/);
	assert.match(roadmapPanel, /sourceDomain/);
	assert.match(roadmapPanel, /href=\{externalUrl\}/);
	assert.doesNotMatch(roadmapPanel, /resolve\(externalUrl\)/);
});

test('roadmap external links drop credential-like query parameters', () => {
	// Extract the component's safeExternalUrl body and evaluate it in isolation so
	// this asserts the real behavior, not just its source text.
	const match = roadmapPanel.match(
		/const CREDENTIAL_QUERY_KEY =\s*(\/[\s\S]*?\/[a-z]*);[\s\S]*?const safeExternalUrl = \(value\) => \{([\s\S]*?)\n\t\};/
	);
	assert.ok(match, 'safeExternalUrl must be present in the panel');
	const [, credentialRegexLiteral, body] = match;
	const safeExternalUrl = new Function(
		'value',
		`const CREDENTIAL_QUERY_KEY = ${credentialRegexLiteral};${body}`
	);

	const stripped = safeExternalUrl('https://research.example/feed?access_token=SECRET&topic=inox');
	assert.ok(stripped.startsWith('https://research.example/feed'), 'safe host must be preserved');
	assert.ok(!stripped.includes('SECRET'), 'credential value must be removed');
	assert.ok(!/access_token/i.test(stripped), 'credential key must be removed');
	assert.match(stripped, /topic=inox/, 'benign query params must be preserved');

	assert.strictEqual(
		safeExternalUrl('https://user:pass@research.example/feed'),
		'',
		'userinfo credentials must reject the link'
	);
	assert.strictEqual(
		safeExternalUrl('javascript:alert(1)'),
		'',
		'non-http protocols must reject the link'
	);
	assert.match(
		safeExternalUrl('https://research.example/article?utm_source=x&api_key=LEAK'),
		/utm_source=x/,
		'unrelated params stay while api_key is stripped'
	);
	assert.ok(
		!safeExternalUrl('https://research.example/article?utm_source=x&api_key=LEAK').includes('LEAK'),
		'api_key value must be removed'
	);
});

test('direction copy distinguishes manager briefs, broad scope, and narrow child topics', () => {
	assert.match(schedulingPage, /manager brief, not a fixed title/i);
	assert.match(schedulingPage, /broad direction expands across categories and products/i);
	assert.match(schedulingPage, /narrow direction drills into child topics/i);
	assert.match(schedulingPage, /brief của quản lý, không phải tiêu đề cố định/i);
	assert.match(schedulingPage, /Định hướng rộng sẽ mở ra nhiều danh mục và sản phẩm/i);
	assert.match(schedulingPage, /định hướng hẹp sẽ đi sâu vào các chủ đề con/i);
});

test('roadmap panel covers evidence, actions, and resilient states without an approval gate', () => {
	for (const copy of [
		'Kế hoạch chủ đề',
		'Nghiên cứu & sinh lại',
		'Loại ý tưởng',
		'Chưa khởi tạo kế hoạch',
		'Sinh kế hoạch ngay',
		'Trạng thái nguồn',
		'Nghiên cứu gần nhất',
		'Rộng',
		'Hẹp',
		'Kết hợp'
	]) {
		assert.ok(roadmapPanel.includes(copy), `roadmap panel must include ${copy}`);
	}
	for (const contractField of [
		'normalizedGoal',
		'focusTerms',
		'productEvidence',
		'marketEvidence',
		'primaryKeyword',
		'categoryKey',
		'searchIntent',
		'articleType',
		'productScope',
		'totalScore',
		'reasonCode',
		'lastRefillAt',
		'sourceHealth'
	]) {
		assert.ok(roadmapPanel.includes(contractField), `roadmap panel must render ${contractField}`);
	}
	assert.match(roadmapPanel, /item\.status === 'ready'/);
	assert.match(roadmapPanel, /\$\{roadmapPath\(\)\}\/regenerate/);
	assert.match(roadmapPanel, /\/items\/\$\{encodeURIComponent\(item\.id\)\}\/dismiss/);
	assert.ok(!/approv|phê duyệt/i.test(roadmapPanel), 'roadmap must not expose an approval action');
	for (const internalField of ['claimedAt', 'claimedBy', 'claimToken']) {
		assert.ok(!roadmapPanel.includes(internalField), `roadmap must not expose ${internalField}`);
	}
});

test('roadmap proxies forward exact backend paths, keep regenerate dedicated, and use bounded sanitization', () => {
	assert.match(
		roadmapProxy,
		/\/admin\/openclaw\/blog-schedules\/\$\{encodeURIComponent\(params\.scheduleId\)\}\/roadmap/
	);
	assert.match(
		roadmapRegenerateProxy,
		/\/admin\/openclaw\/blog-schedules\/\$\{encodeURIComponent\(params\.scheduleId\)\}\/roadmap\/regenerate/
	);
	assert.match(
		roadmapDismissProxy,
		/\/roadmap\/items\/\$\{encodeURIComponent\(params\.itemId\)\}\/dismiss/
	);
	assert.doesNotMatch(operationProxy, /regenerate/);
	assert.match(roadmapRegenerateProxy, /safeRoadmapIdempotencyKey/);
	assert.match(roadmapRegenerateProxy, /A valid Idempotency-Key is required/);
	assert.match(roadmapRegenerateProxy, /'Idempotency-Key': idempotencyKey/);
	assert.match(roadmapRegenerateProxy, /ROADMAP_ENQUEUE_TIMEOUT_MS/);
	assert.match(roadmapProxyHelper, /ROADMAP_REASON_MAX_LENGTH = 160/);
	assert.match(roadmapProxyHelper, /OPENCLAW_BACKEND_UNAVAILABLE/);
	assert.match(roadmapProxyHelper, /OPENCLAW_BACKEND_TIMEOUT/);
	assert.match(roadmapProxyHelper, /sanitizeOpenClawClientPayload/);
	assert.match(roadmapProxyHelper, /sanitizeOpenClawErrorMessage/);
	assert.match(roadmapProxyHelper, /controller\.abort\(\)/);
	for (const source of [roadmapProxy, roadmapRegenerateProxy, roadmapDismissProxy]) {
		assert.match(source, /proxyOpenClawRoadmapRequest/);
		assert.match(source, /adminFetch: adminApiFetch/);
	}
});

test('execution polling uses one bounded batch proxy contract', () => {
	assert.match(executionSummariesProxy, /scheduleIds\.length > 50/);
	assert.match(executionSummariesProxy, /limit > 5/);
	assert.match(
		executionSummariesProxy,
		/\/admin\/openclaw\/blog-schedules\/execution-summaries\?\$\{query\}/
	);
	assert.match(executionSummariesProxy, /isExecutionSummariesPayload/);
	assert.match(schedulingPage, /fetchExecutionSummaries/);
	assert.match(schedulingPage, /buildExecutionSummariesRequest/);
	assert.match(executionSummaries, /MAX_EXECUTION_SUMMARY_SCHEDULES = 50/);
	assert.match(executionSummaries, /MAX_EXECUTIONS_PER_SCHEDULE = 5/);
	assert.doesNotMatch(schedulingPage, /mapWithConcurrency/);
});

test('roadmap panel implements the persisted async regeneration lifecycle', () => {
	assert.match(roadmapPanel, /createSmartPoller/);
	assert.match(roadmapPanel, /pollRoadmap/);
	assert.match(roadmapPanel, /regenerationPhase/);
	assert.match(roadmapPanel, /shouldReplaceRoadmapItems/);
	assert.match(roadmapPanel, /createOpenClawActionIdempotencyManager/);
	assert.match(roadmapPanel, /createRoadmapRegenerationRequestState/);
	assert.match(roadmapPanel, /recoverRegeneration/);
	assert.match(roadmapPanel, /Recover request/);
	assert.match(roadmapPanel, /Research again/);
	assert.match(roadmapPanel, /clearRegenerationRequest\(idempotencyKey\)/);
	assert.match(roadmapPanel, /matchesTrackedRequest/);
	assert.match(roadmapPanel, /regenerationActive/);
	assert.match(roadmapPanel, /onDestroy\(\(\) => roadmapPoller\?\.stop\(\)\)/);
	assert.doesNotMatch(roadmapPanel, /setInterval\(/);
	for (const phase of [
		'queued',
		'researching',
		'committing',
		'completedReplacement',
		'noChange',
		'superseded',
		'cancelled',
		'failedRegeneration'
	]) {
		assert.ok(roadmapPanel.includes(phase), `roadmap panel must represent ${phase}`);
	}
});

test('roadmap messaging uses dynamic policy and separates source, outcome, and model failures', () => {
	assert.match(roadmapPanel, /roadmapPolicy\(payload\)/);
	assert.match(roadmapPanel, /roadmapScoreAccepted\(item, policy\)/);
	assert.match(roadmapPanel, /sourceSummary\.partial/);
	assert.match(roadmapPanel, /ROADMAP_SCORE_UNREACHABLE/);
	assert.match(
		roadmapPanel,
		/\['partial', 'failed', 'unavailable', 'stale', 'degraded', 'error'\]/
	);
	assert.match(roadmapPanel, /tr-feedback--source/);
	assert.match(roadmapPanel, /tr-feedback--outcome/);
	assert.match(roadmapPanel, /tr-feedback--failure/);
	assert.doesNotMatch(roadmapPanel, /scoreNumber\(item\) >= 82/);
	assert.doesNotMatch(roadmapPanel, /sourceSummary\.partial \|\| roadmap\.lastErrorCode/);
	assert.match(simpleSchedule, /simpleDecisionReasonLabel/);
	assert.match(simpleSchedule, /roadmapRegenerationErrorLabel/);
	assert.match(schedulingPage, /simpleDecisionReasonLabel\(decisionReason, isEn\)/);
	assert.doesNotMatch(
		schedulingPage,
		/simpleExecutionErrorLabel\(\s*execution\.error\s*\|\|\s*execution\.metadata\?\.decisionReason/
	);
});

test('empty state uses the simple Vietnamese copy without internal concepts', () => {
	assert.match(schedulingPage, /Chưa có lịch Blog\./);
	assert.match(
		schedulingPage,
		/Tạo lịch đầu tiên để OpenClaw tự tìm chủ đề phù hợp và tạo bản nháp theo lịch\./
	);
	for (const forbidden of ['QA batch', 'Work Order', 'fixed brief', 'staging']) {
		assert.ok(!schedulingPage.includes(forbidden), `empty state must not mention ${forbidden}`);
	}
});

test('the sidebar keeps Google Intelligence independent and one Blog OpenClaw entry', () => {
	assert.match(layout, /href: '\/admin\/openclaw\/google-intelligence'/);
	assert.match(layout, /href: '\/admin\/openclaw\/blogs'/);
	assert.match(layout, /label: 'Blog OpenClaw'/);
	assert.ok(!layout.includes("label: 'OpenClaw AI'"), 'OpenClaw AI must not be a sidebar product');
	assert.ok(
		!layout.includes("href: '/admin/openclaw/content-operations'"),
		'Content Operations must not be a sidebar product'
	);
	assert.ok(
		!layout.includes("href: '/admin/openclaw',"),
		'the bare OpenClaw console route must not be in the sidebar'
	);
});

test('legacy routes redirect into the new structure instead of rendering old consoles', () => {
	const redirects = [
		['src/routes/admin/openclaw/+page.server.js', '/admin/openclaw/blogs'],
		['src/routes/admin/openclaw/daily-draft/+page.server.js', '/admin/openclaw/blogs'],
		[
			'src/routes/admin/openclaw/content-operations/+page.server.js',
			'/admin/openclaw/blogs/settings/operations'
		],
		[
			'src/routes/admin/openclaw/content-operations/qa/+page.server.js',
			'/admin/openclaw/blogs/settings/operations/qa'
		]
	];
	for (const [file, target] of redirects) {
		const source = read(file);
		assert.match(source, /redirect\(301,/);
		assert.ok(source.includes(target), `${file} must redirect to ${target}`);
	}
});

test('BOS keeps a compact summary and collapsed groups with working deep links', () => {
	assert.match(bosPage, /Lõi Blog OpenClaw/);
	assert.match(bosPage, /<details class="bos-group">/);
	assert.match(bosPage, /\/admin\/openclaw\/blogs\/settings\/console/);
	assert.match(bosPage, /\/admin\/openclaw\/blogs\/settings\/operations/);
	assert.match(bosPage, /\/admin\/openclaw\/blogs\/settings\/operations\/qa/);
	assert.match(bosPage, /CapabilityHealthPanel/);
	assert.match(bosPage, /Optional feature disabled|Tính năng tuỳ chọn đang tắt/);
});

test('BOS keeps unavailable resource states unknown instead of reporting them disabled', () => {
	assert.match(schedulingLoader, /BLOG_SCHEDULES_LOAD_FAILED/);
	const bosLoader = read('src/routes/admin/openclaw/blogs/settings/+page.server.js');
	assert.match(bosLoader, /availability:/);
	assert.match(bosLoader, /resourceErrors:/);
	assert.match(bosLoader, /execution-summaries/);
	assert.match(bosLoader, /limit: '5'/);
	assert.match(bosPage, /unavailableResources/);
	assert.match(bosPage, /executionSummaries/);
	assert.match(bosPage, /Chưa xác minh/);
	assert.match(
		bosPage,
		/Giá trị chưa biết được hiển thị là “Chưa xác minh”, không bị coi nhầm là đang tắt/
	);
});

test('no raw translation keys leak into the scheduling page markup', () => {
	assert.ok(
		!/\{t\.[a-zA-Z]+\.[a-zA-Z]+\.[a-zA-Z]+\}/.test(
			schedulingPage.split('<style>')[0].replace(/t\.errors\.[a-zA-Z]+\.[a-zA-Z_]+/g, '')
		)
	);
	assert.ok(
		!schedulingPage.includes("$t('admin."),
		'the page uses local bilingual copy, not missing keys'
	);
});
