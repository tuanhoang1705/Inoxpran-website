<script>
	import { resolve } from '$app/paths';
	import { locale } from '$lib/i18n/admin/index.js';
	import { normalizeOpenClawUiError, openClawUiErrorText } from '$lib/openclaw/uiError.js';

	let { data } = $props();
	const isEn = $derived($locale === 'en');

	// svelte-ignore state_referenced_locally
	let status = $state(data?.status || {});
	// svelte-ignore state_referenced_locally
	let sources = $state(Array.isArray(data?.sources) ? data.sources : []);
	// svelte-ignore state_referenced_locally
	let snapshots = $state(Array.isArray(data?.snapshots) ? data.snapshots : []);
	// svelte-ignore state_referenced_locally
	let schedule = $state({
		enabled: false,
		timezone: 'Asia/Ho_Chi_Minh',
		scheduleType: 'daily',
		daily: { times: ['05:30'] },
		interval: { value: 24, unit: 'hours' },
		strictGate: true,
		sourceGroups: ['official'],
		allowLastSuccessfulSnapshot: false,
		maxSnapshotAgeHours: 24,
		sourceTimeoutMs: 15000,
		retryPolicy: { count: 2, delayMs: 1000 },
		...(data?.schedule || {})
	});
	// svelte-ignore state_referenced_locally
	let executions = $state(Array.isArray(data?.executions) ? data.executions : []);
	// svelte-ignore state_referenced_locally
	let relatedBlogs = $state(Array.isArray(data?.relatedBlogs) ? data.relatedBlogs : []);
	// svelte-ignore state_referenced_locally
	let styles = $state(Array.isArray(data?.styles) ? data.styles : []);
	// svelte-ignore state_referenced_locally
	let recentProfiles = $state(Array.isArray(data?.recentProfiles) ? data.recentProfiles : []);
	let busy = $state('');
	let notice = $state('');
	// svelte-ignore state_referenced_locally
	let error = $state(data?.loadError || '');
	let overrideReason = $state('');
	let sourceDraft = $state({
		name: '',
		baseUrl: '',
		sourceType: 'third_party',
		official: false,
		required: false,
		priority: 100,
		sourceGroups: 'industry'
	});

	const latest = $derived(status?.snapshot || snapshots[0] || null);
	const changes = $derived([
		...(Array.isArray(latest?.officialChanges) ? latest.officialChanges : []),
		...(Array.isArray(latest?.thirdPartyObservations) ? latest.thirdPartyObservations : [])
	]);
	const guidance = $derived(latest?.contentGuidance || {});
	const telegram = $derived(status?.telegram || {});

	const t = $derived({
		back: isEn ? 'Back to OpenClaw' : 'Quay lại OpenClaw',
		eyebrow: isEn ? 'SEARCH OPERATIONS / DAILY CONTROL' : 'VẬN HÀNH SEARCH / KIỂM SOÁT HẰNG NGÀY',
		title: isEn ? 'Google Intelligence' : 'Google Intelligence',
		subtitle: isEn
			? 'Verified Google Search guidance, daily content gate, source health and editorial diversity in one auditable console.'
			: 'Hướng dẫn Google Search đã xác minh, cổng nội dung hằng ngày, sức khỏe nguồn và đa dạng biên tập trong một bảng điều khiển có thể kiểm toán.',
		runNow: isEn ? 'Run intelligence now' : 'Chạy Intelligence ngay',
		refresh: isEn ? 'Refresh' : 'Làm mới',
		running: isEn ? 'Running…' : 'Đang chạy…',
		today: isEn ? 'Today overview' : 'Tổng quan hôm nay',
		snapshot: isEn ? 'Snapshot' : 'Snapshot',
		gate: isEn ? 'Content gate' : 'Cổng nội dung',
		sourceHealth: isEn ? 'Source health' : 'Sức khỏe nguồn',
		changes: isEn ? 'Material changes' : 'Thay đổi đáng kể',
		critical: isEn ? 'Critical changes' : 'Thay đổi nghiêm trọng',
		open: isEn ? 'OPEN' : 'MỞ',
		blocked: isEn ? 'BLOCKED' : 'ĐANG CHẶN',
		checked: isEn ? 'Checked' : 'Đã kiểm tra',
		latestChanges: isEn ? 'Latest verified changes' : 'Thay đổi đã xác minh mới nhất',
		noChanges: isEn
			? 'No material changes recorded for this snapshot.'
			: 'Không có thay đổi đáng kể trong snapshot này.',
		currentGuidance: isEn ? 'Current guidance' : 'Hướng dẫn hiện hành',
		technicalSeo: isEn ? 'Technical SEO' : 'SEO kỹ thuật',
		content: isEn ? 'People-first content' : 'Nội dung people-first',
		aiSearch: isEn ? 'AI search' : 'AI Search',
		structuredData: isEn ? 'Structured data' : 'Dữ liệu có cấu trúc',
		spamRisk: isEn ? 'Spam risk' : 'Rủi ro spam',
		sources: isEn ? 'Source registry' : 'Danh sách nguồn',
		sourceHint: isEn
			? 'Official sources remain authoritative; third-party sources are interpretation only.'
			: 'Nguồn chính thức giữ vai trò quyết định; nguồn bên thứ ba chỉ là diễn giải.',
		official: isEn ? 'Official' : 'Chính thức',
		required: isEn ? 'Required' : 'Bắt buộc',
		priority: isEn ? 'Priority' : 'Ưu tiên',
		lastSuccess: isEn ? 'Last success' : 'Lần thành công cuối',
		lastError: isEn ? 'Last error' : 'Lỗi cuối',
		runSource: isEn ? 'Run source' : 'Chạy nguồn',
		addSource: isEn ? 'Add source' : 'Thêm nguồn',
		sourceName: isEn ? 'Source name' : 'Tên nguồn',
		sourceUrl: isEn ? 'HTTPS source URL' : 'URL HTTPS của nguồn',
		sourceType: isEn ? 'Source type' : 'Loại nguồn',
		enabled: isEn ? 'Enabled' : 'Bật',
		disabled: isEn ? 'Disabled' : 'Tắt',
		schedule: isEn ? 'Persistent schedule' : 'Lịch chạy bền vững',
		timezone: isEn ? 'Timezone' : 'Múi giờ',
		scheduleType: isEn ? 'Schedule type' : 'Kiểu lịch',
		daily: isEn ? 'Daily' : 'Hằng ngày',
		interval: isEn ? 'Every N hours' : 'Mỗi N giờ',
		runTimes: isEn ? 'Run times (comma separated)' : 'Giờ chạy (phân cách dấu phẩy)',
		strictGate: isEn ? 'Strict gate' : 'Cổng nghiêm ngặt',
		allowLast: isEn ? 'Allow last successful snapshot' : 'Cho dùng snapshot thành công gần nhất',
		maxAge: isEn ? 'Maximum age (hours)' : 'Tuổi tối đa (giờ)',
		timeout: isEn ? 'Source timeout (ms)' : 'Timeout nguồn (ms)',
		retries: isEn ? 'Retry count' : 'Số lần thử lại',
		retryDelay: isEn ? 'Retry delay (ms)' : 'Độ trễ thử lại (ms)',
		intervalUnit: isEn ? 'Interval unit' : 'Đơn vị chu kỳ',
		sourceGroups: isEn ? 'Source groups' : 'Nhóm nguồn',
		saveSchedule: isEn ? 'Save schedule' : 'Lưu lịch',
		executions: isEn ? 'Execution history' : 'Lịch sử thực thi',
		snapshots: isEn ? 'Snapshot history' : 'Lịch sử snapshot',
		manualOverride: isEn ? 'Controlled manual override' : 'Override thủ công có kiểm soát',
		overrideWarning: isEn
			? 'An override opens the gate but preserves the failed status in the audit log.'
			: 'Override sẽ mở cổng nhưng vẫn giữ trạng thái lỗi trong audit log.',
		reason: isEn ? 'Reason (minimum 10 characters)' : 'Lý do (tối thiểu 10 ký tự)',
		override: isEn ? 'Override latest snapshot' : 'Override snapshot mới nhất',
		styles: isEn ? 'Editorial style library' : 'Thư viện phong cách biên tập',
		styleHint: isEn
			? 'Rotate structure, not just vocabulary. A complete reusable article template cannot be defined here.'
			: 'Luân phiên cấu trúc, không chỉ từ ngữ. Không thể định nghĩa mẫu bài hoàn chỉnh để lặp lại tại đây.',
		cooldown: isEn ? 'Cooldown days' : 'Số ngày cooldown',
		locked: isEn ? 'Locked preference' : 'Ưu tiên đã khóa',
		generateStyle: isEn ? 'Generate today profile' : 'Tạo profile hôm nay',
		recentProfiles: isEn ? 'Recent profiles' : 'Profile gần đây',
		relatedBlogs: isEn ? 'Related Agentic blogs' : 'Bài Agentic liên quan',
		openEditor: isEn ? 'Open editor' : 'Mở trình biên tập',
		telegramStatus: isEn ? 'Telegram safety status' : 'Trạng thái an toàn Telegram',
		token: isEn ? 'Token' : 'Token',
		allowlist: isEn ? 'Allowlist' : 'Allowlist',
		mode: isEn ? 'Mode' : 'Chế độ',
		adminUrl: isEn ? 'Admin URL' : 'URL admin',
		configured: isEn ? 'Configured' : 'Đã cấu hình',
		missing: isEn ? 'Missing' : 'Thiếu',
		success: isEn ? 'Operation completed.' : 'Thao tác đã hoàn tất.',
		failed: isEn ? 'Operation failed.' : 'Thao tác thất bại.'
	});
	const requestErrorText = (value, fallbackCode = 'OPENCLAW_REQUEST_FAILED') =>
		openClawUiErrorText(value, { isEn, fallbackCode });
	const errorText = $derived(
		error ? requestErrorText(error, 'GOOGLE_INTELLIGENCE_LOAD_FAILED') : ''
	);
	const recordErrorText = (record = {}) =>
		requestErrorText(
			{
				errorCode: record.errorCode || record.lastErrorCode,
				requestId: record.requestId || record.lastRequestId
			},
			'OPENCLAW_REQUEST_FAILED'
		);

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com')
			return path;
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
	};

	const api = async (path, options = {}) => {
		const response = await fetch(resolveAdminPath(`/admin/api/openclaw/${path}`), {
			...options,
			headers: { 'content-type': 'application/json', ...(options.headers || {}) }
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			throw normalizeOpenClawUiError(payload, 'OPENCLAW_REQUEST_FAILED', response.headers);
		}
		return payload || {};
	};

	const formatDate = (value) => {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return new Intl.DateTimeFormat(isEn ? 'en-US' : 'vi-VN', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	};

	const statusLabel = (value) => String(value || 'not_ready').replaceAll('_', ' ');
	const listInputValue = (value) => (Array.isArray(value) ? value.join(', ') : String(value || ''));
	const severityTone = (severity) =>
		['critical', 'high'].includes(severity) ? 'danger' : severity === 'medium' ? 'warn' : 'calm';

	const refreshAll = async () => {
		busy = 'refresh';
		error = '';
		notice = '';
		try {
			const [
				nextStatus,
				nextSources,
				nextSnapshots,
				nextSchedule,
				nextExecutions,
				nextBlogs,
				nextStyles
			] = await Promise.all([
				api('google-intelligence/status'),
				api('google-intelligence/sources'),
				api('google-intelligence/snapshots?limit=20'),
				api('google-intelligence/schedule'),
				api('google-intelligence/executions?limit=30'),
				api('google-intelligence/related-blogs?limit=30'),
				api('editorial-styles/')
			]);
			status = nextStatus;
			sources = nextSources.sources || [];
			snapshots = nextSnapshots.snapshots || [];
			schedule = nextSchedule;
			executions = nextExecutions.executions || [];
			relatedBlogs = nextBlogs.blogs || [];
			styles = nextStyles.styles || [];
			recentProfiles = nextStyles.recentProfiles || [];
			notice = t.success;
		} catch (cause) {
			error = normalizeOpenClawUiError(cause, 'OPENCLAW_REQUEST_FAILED');
		} finally {
			busy = '';
		}
	};

	const runNow = async () => {
		busy = 'run';
		error = '';
		notice = '';
		try {
			await api('google-intelligence/run-now', { method: 'POST', body: '{}' });
			notice = t.success;
			await refreshAll();
		} catch (cause) {
			error = normalizeOpenClawUiError(cause, 'OPENCLAW_REQUEST_FAILED');
			busy = '';
		}
	};

	const updateSource = async (source, patch) => {
		busy = `source-${source.id}`;
		error = '';
		notice = '';
		try {
			const updated = await api(`google-intelligence/sources/${source.id}`, {
				method: 'PATCH',
				body: JSON.stringify(patch)
			});
			sources = sources.map((item) => (item.id === source.id ? updated : item));
			notice = t.success;
		} catch (cause) {
			error = normalizeOpenClawUiError(cause, 'OPENCLAW_REQUEST_FAILED');
		} finally {
			busy = '';
		}
	};

	const runSource = async (source) => {
		busy = `source-${source.id}`;
		error = '';
		notice = '';
		try {
			await api(`google-intelligence/sources/${source.id}/run-now`, { method: 'POST', body: '{}' });
			notice = t.success;
			await refreshAll();
		} catch (cause) {
			error = normalizeOpenClawUiError(cause, 'OPENCLAW_REQUEST_FAILED');
			busy = '';
		}
	};

	const createSource = async () => {
		busy = 'source-create';
		error = '';
		notice = '';
		try {
			const created = await api('google-intelligence/sources', {
				method: 'POST',
				body: JSON.stringify({
					...sourceDraft,
					priority: Number(sourceDraft.priority || 100),
					sourceGroups: String(sourceDraft.sourceGroups || '')
						.split(',')
						.map((item) => item.trim())
						.filter(Boolean)
				})
			});
			sources = [...sources, created];
			sourceDraft = {
				name: '',
				baseUrl: '',
				sourceType: 'third_party',
				official: false,
				required: false,
				priority: 100,
				sourceGroups: 'industry'
			};
			notice = t.success;
		} catch (cause) {
			error = normalizeOpenClawUiError(cause, 'OPENCLAW_REQUEST_FAILED');
		} finally {
			busy = '';
		}
	};

	const saveSchedule = async () => {
		busy = 'schedule';
		error = '';
		notice = '';
		try {
			const payload = {
				...schedule,
				daily: {
					times: String(schedule?.daily?.times || '')
						.split(',')
						.map((item) => item.trim())
						.filter(Boolean)
				},
				interval: {
					value: Number(schedule?.interval?.value || 24),
					unit: schedule?.interval?.unit || 'hours'
				},
				sourceGroups: String(schedule?.sourceGroups || '')
					.split(',')
					.map((item) => item.trim())
					.filter(Boolean),
				maxSnapshotAgeHours: Number(schedule?.maxSnapshotAgeHours || 24),
				sourceTimeoutMs: Number(schedule?.sourceTimeoutMs || 15000),
				retryPolicy: {
					...schedule.retryPolicy,
					count: Number(schedule?.retryPolicy?.count || 0),
					delayMs: Number(schedule?.retryPolicy?.delayMs || 1000)
				}
			};
			schedule = await api('google-intelligence/schedule', {
				method: 'PATCH',
				body: JSON.stringify(payload)
			});
			notice = t.success;
		} catch (cause) {
			error = normalizeOpenClawUiError(cause, 'OPENCLAW_REQUEST_FAILED');
		} finally {
			busy = '';
		}
	};

	const overrideLatest = async () => {
		if (!latest?.id) return;
		busy = 'override';
		error = '';
		notice = '';
		try {
			const updated = await api(`google-intelligence/snapshots/${latest.id}/override`, {
				method: 'POST',
				body: JSON.stringify({ reason: overrideReason })
			});
			status = { ...status, snapshot: updated, gateOpen: true };
			overrideReason = '';
			notice = t.success;
		} catch (cause) {
			error = normalizeOpenClawUiError(cause, 'OPENCLAW_REQUEST_FAILED');
		} finally {
			busy = '';
		}
	};

	const updateStyle = async (style, patch) => {
		busy = `style-${style.id}`;
		error = '';
		notice = '';
		try {
			const updated = await api(`editorial-styles/${style.id}`, {
				method: 'PATCH',
				body: JSON.stringify(patch)
			});
			styles = styles.map((item) =>
				item.id === style.id ? updated : patch.locked ? { ...item, locked: false } : item
			);
			notice = t.success;
		} catch (cause) {
			error = normalizeOpenClawUiError(cause, 'OPENCLAW_REQUEST_FAILED');
		} finally {
			busy = '';
		}
	};

	const generateTodayStyle = async () => {
		busy = 'style-generate';
		error = '';
		notice = '';
		try {
			await api('editorial-styles/generate-today', { method: 'POST', body: '{}' });
			notice = t.success;
			await refreshAll();
		} catch (cause) {
			error = normalizeOpenClawUiError(cause, 'OPENCLAW_REQUEST_FAILED');
			busy = '';
		}
	};
</script>

<svelte:head><title>Google Intelligence | OpenClaw | INOXPRAN</title></svelte:head>

<section class="intel-shell">
	<a class="back" href={resolve('/admin/openclaw')}>← {t.back}</a>

	<header class="hero">
		<div>
			<p class="eyebrow">{t.eyebrow}</p>
			<h1>{t.title}</h1>
			<p class="lede">{t.subtitle}</p>
		</div>
		<div class="hero-actions">
			<button class="button secondary" onclick={refreshAll} disabled={Boolean(busy)}
				>{t.refresh}</button
			>
			<button class="button primary" onclick={runNow} disabled={Boolean(busy)}
				>{busy === 'run' ? t.running : t.runNow}</button
			>
		</div>
	</header>

	{#if errorText}<div class="alert danger" role="alert">{errorText}</div>{/if}
	{#if notice}<div class="alert success" role="status">{notice}</div>{/if}

	<section class="block overview">
		<div class="section-title">
			<span>01</span>
			<div>
				<h2>{t.today}</h2>
				<p>
					{latest?.snapshotDate || '—'} · {latest?.timezone ||
						schedule?.timezone ||
						'Asia/Ho_Chi_Minh'}
				</p>
			</div>
		</div>
		<div class="metric-grid">
			<article class="metric">
				<span>{t.snapshot}</span><strong class:danger-text={latest?.status === 'failed'}
					>{statusLabel(latest?.status)}</strong
				><small>{t.checked}: {formatDate(latest?.checkedAt)}</small>
			</article>
			<article class="metric gate" class:closed={!status?.gateOpen}>
				<span>{t.gate}</span><strong>{status?.gateOpen ? t.open : t.blocked}</strong><small
					>{status?.strictGate ? 'STRICT' : 'ADVISORY'}</small
				>
			</article>
			<article class="metric">
				<span>{t.sourceHealth}</span><strong
					>{latest?.successfulSources || 0}/{latest?.sourcesChecked || 0}</strong
				><small>{latest?.failedSources || 0} {isEn ? 'failed' : 'lỗi'}</small>
			</article>
			<article class="metric">
				<span>{t.changes}</span><strong>{changes.length}</strong><small
					>{latest?.noMaterialChanges ? 'NO MATERIAL CHANGE' : 'REVIEW REQUIRED'}</small
				>
			</article>
			<article class="metric">
				<span>{t.critical}</span><strong
					>{(latest?.risks || []).filter((item) => item.severity === 'critical').length}</strong
				><small>{status?.latestRun?.status || '—'}</small>
			</article>
		</div>
	</section>

	<div class="split">
		<section class="block">
			<div class="section-title compact">
				<span>02</span>
				<div><h2>{t.latestChanges}</h2></div>
			</div>
			{#if changes.length}
				<div class="change-list">
					{#each changes as change, __eachIndex6 (change?._id ?? change?.id ?? __eachIndex6)}
						<article class="change">
							<div class="change-top">
								<span class="severity {severityTone(change.severity)}">{change.severity}</span><span
									>{change.changeType || 'updated'} · {change.affectedArea || 'content_quality'} · {change.actionStatus ||
										'pending_review'}</span
								>
							</div>
							<h3>{change.title}</h3>
							<p>{change.summary}</p>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Intelligence sources are validated outbound HTTP(S) URLs, not SvelteKit routes. -->
							<a href={change.sourceUrl} target="_blank" rel="noopener noreferrer"
								>{new URL(change.sourceUrl).hostname} ↗</a
							>
						</article>
					{/each}
				</div>
			{:else}<p class="empty">{t.noChanges}</p>{/if}
		</section>

		<section class="block guidance">
			<div class="section-title compact">
				<span>03</span>
				<div><h2>{t.currentGuidance}</h2></div>
			</div>
			{#each [[t.technicalSeo, guidance.technicalSeo], [t.content, guidance.content], [t.aiSearch, guidance.aiSearch], [t.structuredData, guidance.structuredData], [t.spamRisk, guidance.spamRisk]] as item, __eachIndex1 (item?._id ?? item?.id ?? __eachIndex1)}
				<div class="guidance-row">
					<h3>{item[0]}</h3>
					<p>{item[1] || '—'}</p>
				</div>
			{/each}
		</section>
	</div>

	<section class="block">
		<div class="section-title">
			<span>04</span>
			<div>
				<h2>{t.sources}</h2>
				<p>{t.sourceHint}</p>
			</div>
		</div>
		<div class="table-wrap">
			<table>
				<thead
					><tr
						><th>{t.enabled}</th><th>{isEn ? 'Source' : 'Nguồn'}</th><th>{t.official}</th><th
							>{t.priority}</th
						><th>{t.lastSuccess}</th><th>{t.lastError}</th><th></th></tr
					></thead
				>
				<tbody
					>{#each sources as source (source.id)}<tr>
							<td
								><button
									class="toggle"
									class:on={source.enabled}
									aria-label={`${t.enabled} ${source.name}`}
									onclick={() => updateSource(source, { enabled: !source.enabled })}
									disabled={busy === `source-${source.id}`}><span></span></button
								></td
							>
							<td>
								<strong
									><input
										class="source-name-input"
										value={source.name}
										maxlength="180"
										onchange={(event) => updateSource(source, { name: event.currentTarget.value })}
									/></strong
								>
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Source base URLs are validated outbound HTTP(S) URLs, not SvelteKit routes. -->
								<a href={source.baseUrl} target="_blank" rel="noopener noreferrer"
									>{new URL(source.baseUrl).hostname}</a
								>
								<input
									class="source-groups-input"
									value={listInputValue(source.sourceGroups)}
									aria-label={t.sourceGroups}
									onchange={(event) =>
										updateSource(source, {
											sourceGroups: event.currentTarget.value
												.split(',')
												.map((item) => item.trim())
												.filter(Boolean)
										})}
								/>
							</td>
							<td
								><span class="tag" class:official={source.official}
									>{source.official ? t.official : '3RD PARTY'}</span
								>{#if source.official}<button
										class="tag required control-tag"
										class:inactive={!source.required}
										onclick={() => updateSource(source, { required: !source.required })}
										>{t.required}</button
									>{/if}</td
							>
							<td
								><input
									class="compact-input"
									type="number"
									min="1"
									max="1000"
									value={source.priority}
									onchange={(event) =>
										updateSource(source, { priority: Number(event.currentTarget.value) })}
								/></td
							><td>{formatDate(source.lastSuccessAt)}</td><td class="error-cell"
								>{source.lastError ? recordErrorText(source) : '—'}</td
							>
							<td
								><button
									class="text-button"
									onclick={() => runSource(source)}
									disabled={busy === `source-${source.id}`}>{t.runSource}</button
								></td
							>
						</tr>{/each}</tbody
				>
			</table>
		</div>
		<div class="source-create form-grid">
			<label
				><span>{t.sourceName}</span><input bind:value={sourceDraft.name} maxlength="180" /></label
			>
			<label
				><span>{t.sourceUrl}</span><input
					type="url"
					bind:value={sourceDraft.baseUrl}
					placeholder="https://…"
				/></label
			>
			<label
				><span>{t.sourceType}</span><select bind:value={sourceDraft.sourceType}
					><option value="third_party">third_party</option><option value="documentation"
						>documentation</option
					><option value="blog">blog</option><option value="status">status</option><option
						value="search_console">search_console</option
					><option value="merchant">merchant</option></select
				></label
			>
			<label
				><span>{t.priority}</span><input
					type="number"
					min="1"
					max="1000"
					bind:value={sourceDraft.priority}
				/></label
			>
			<label
				><span>{t.sourceGroups}</span><input
					bind:value={sourceDraft.sourceGroups}
					placeholder="industry, cookware"
				/></label
			>
			<label class="check-row"
				><span>{t.official}</span><input
					type="checkbox"
					bind:checked={sourceDraft.official}
				/></label
			>
			<label class="check-row"
				><span>{t.required}</span><input
					type="checkbox"
					bind:checked={sourceDraft.required}
					disabled={!sourceDraft.official}
				/></label
			>
		</div>
		<div class="right">
			<button
				class="button secondary"
				onclick={createSource}
				disabled={busy === 'source-create' ||
					!sourceDraft.name.trim() ||
					!sourceDraft.baseUrl.trim()}>{t.addSource}</button
			>
		</div>
	</section>

	<section class="block">
		<div class="section-title">
			<span>05</span>
			<div>
				<h2>{t.schedule}</h2>
				<p>
					{schedule?.nextRunAt
						? `${isEn ? 'Next' : 'Tiếp theo'}: ${formatDate(schedule.nextRunAt)}`
						: '—'}
				</p>
			</div>
		</div>
		<div class="form-grid">
			<label
				><span>{t.enabled}</span><input type="checkbox" bind:checked={schedule.enabled} /></label
			>
			<label><span>{t.timezone}</span><input bind:value={schedule.timezone} /></label>
			<label
				><span>{t.scheduleType}</span><select bind:value={schedule.scheduleType}
					><option value="daily">{t.daily}</option><option value="interval">{t.interval}</option
					></select
				></label
			>
			{#if schedule.scheduleType === 'daily'}<label
					><span>{t.runTimes}</span><input
						value={listInputValue(schedule?.daily?.times)}
						oninput={(event) =>
							(schedule = { ...schedule, daily: { times: event.currentTarget.value } })}
					/></label
				>
			{:else}<label
					><span>{t.interval}</span><input
						type="number"
						min="1"
						bind:value={schedule.interval.value}
					/></label
				><label
					><span>{t.intervalUnit}</span><select bind:value={schedule.interval.unit}
						><option value="minutes">minutes</option><option value="hours">hours</option><option
							value="days">days</option
						></select
					></label
				>{/if}
			<label
				><span>{t.strictGate}</span><input
					type="checkbox"
					bind:checked={schedule.strictGate}
				/></label
			>
			<label
				><span>{t.allowLast}</span><input
					type="checkbox"
					bind:checked={schedule.allowLastSuccessfulSnapshot}
				/></label
			>
			<label
				><span>{t.maxAge}</span><input
					type="number"
					min="1"
					bind:value={schedule.maxSnapshotAgeHours}
				/></label
			>
			<label
				><span>{t.timeout}</span><input
					type="number"
					min="1000"
					step="1000"
					bind:value={schedule.sourceTimeoutMs}
				/></label
			>
			<label
				><span>{t.retries}</span><input
					type="number"
					min="0"
					max="5"
					bind:value={schedule.retryPolicy.count}
				/></label
			>
			<label
				><span>{t.retryDelay}</span><input
					type="number"
					min="100"
					max="60000"
					step="100"
					bind:value={schedule.retryPolicy.delayMs}
				/></label
			>
			<label
				><span>{t.sourceGroups}</span><input
					value={listInputValue(schedule?.sourceGroups)}
					oninput={(event) => (schedule = { ...schedule, sourceGroups: event.currentTarget.value })}
				/></label
			>
		</div>
		<div class="right">
			<button class="button primary" onclick={saveSchedule} disabled={Boolean(busy)}
				>{t.saveSchedule}</button
			>
		</div>
	</section>

	<div class="split histories">
		<section class="block">
			<div class="section-title compact">
				<span>06</span>
				<div><h2>{t.executions}</h2></div>
			</div>
			<div class="timeline">
				{#each executions.slice(0, 12) as execution, __eachIndex3 (execution?._id ?? execution?.id ?? __eachIndex3)}<article
					>
						<span class="timeline-dot" class:failed={execution.status === 'failed'}></span>
						<div>
							<strong>{statusLabel(execution.status)}</strong>
							<p>{execution.triggeredBy} · {execution.changesDetected || 0} changes</p>
							<small
								>{formatDate(execution.startedAt)}
								{execution.error ? `· ${recordErrorText(execution)}` : ''}</small
							>
						</div>
					</article>{/each}
			</div>
		</section>
		<section class="block">
			<div class="section-title compact">
				<span>07</span>
				<div><h2>{t.snapshots}</h2></div>
			</div>
			<div class="snapshot-list">
				{#each snapshots.slice(0, 12) as item, __eachIndex4 (item?._id ?? item?.id ?? __eachIndex4)}<article
					>
						<div>
							<strong>{item.snapshotDate}</strong>
							<p>{statusLabel(item.status)}</p>
						</div>
						<div>
							<b>{item.successfulSources}/{item.sourcesChecked}</b><small
								>{formatDate(item.checkedAt)}</small
							>
						</div>
					</article>{/each}
			</div>
		</section>
	</div>

	<section class="block override">
		<div class="section-title">
			<span>08</span>
			<div>
				<h2>{t.manualOverride}</h2>
				<p>{t.overrideWarning}</p>
			</div>
		</div>
		<div class="override-form">
			<textarea rows="3" bind:value={overrideReason} placeholder={t.reason}></textarea><button
				class="button danger-button"
				onclick={overrideLatest}
				disabled={busy === 'override' || overrideReason.trim().length < 10 || !latest?.id}
				>{t.override}</button
			>
		</div>
	</section>

	<section class="block">
		<div class="section-title">
			<span>09</span>
			<div>
				<h2>{t.styles}</h2>
				<p>{t.styleHint}</p>
			</div>
			<button class="button secondary" onclick={generateTodayStyle} disabled={Boolean(busy)}
				>{t.generateStyle}</button
			>
		</div>
		<div class="style-grid">
			{#each styles as style (style.id)}<article
					class:disabled={!style.enabled}
					class:locked={style.locked}
				>
					<div class="style-head">
						<h3>{style.styleFamily}</h3>
						<button
							class="toggle"
							class:on={style.enabled}
							aria-label={`${t.enabled} ${style.styleFamily}`}
							onclick={() => updateStyle(style, { enabled: !style.enabled })}><span></span></button
						>
					</div>
					<p>{style.description}</p>
					<div class="style-controls">
						<label
							>{t.cooldown}<input
								type="number"
								min="1"
								max="30"
								value={style.cooldownDays}
								onchange={(event) =>
									updateStyle(style, { cooldownDays: Number(event.currentTarget.value) })}
							/></label
						><button
							class="lock"
							class:active={style.locked}
							onclick={() => updateStyle(style, { locked: !style.locked })}>⌁ {t.locked}</button
						>
					</div>
					<small
						>{isEn ? 'Last used' : 'Dùng gần nhất'}: {formatDate(style.lastUsedAt)} · {style.useCount ||
							0}×</small
					>
				</article>{/each}
		</div>
		<h3 class="subhead">{t.recentProfiles}</h3>
		<div class="profile-strip">
			{#each recentProfiles.slice(0, 14) as profile, __eachIndex2 (profile?._id ?? profile?.id ?? __eachIndex2)}<span
					><b>{profile.date}</b>{profile.styleFamily}<small
						>{profile.openingMode} · {profile.headingMode}</small
					></span
				>{/each}
		</div>
	</section>

	<div class="split">
		<section class="block">
			<div class="section-title compact">
				<span>10</span>
				<div><h2>{t.relatedBlogs}</h2></div>
			</div>
			<div class="blog-list">
				{#each relatedBlogs as item, __eachIndex5 (item?._id ?? item?.id ?? __eachIndex5)}<article>
						<div>
							<strong>{item.title}</strong>
							<p>{item.googleIntelSnapshotDate} · {item.googleIntelStatus}</p>
							<small
								>research {item.researchBundleId.slice(-6)} · style {item.editorialStyleProfileId.slice(
									-6
								)} · strategy {item.strategyPlanId.slice(-6)} · execution {item.agenticExecutionId.slice(
									-6
								)}</small
							><small>fingerprint {item.structuralFingerprint?.hash?.slice(0, 10) || '—'}</small
							>{#if item.originalityReview?.reasons?.length}<small class="similarity-warning"
									>⚠ {item.originalityReview.reasons.join(', ')}</small
								>{/if}
						</div>
						<a href={resolve(`/admin/blogs/${item.id}`)} target="_blank" rel="noreferrer"
							>{t.openEditor} ↗</a
						>
					</article>{/each}
			</div>
		</section>
		<section class="block">
			<div class="section-title compact">
				<span>11</span>
				<div><h2>{t.telegramStatus}</h2></div>
			</div>
			<div class="status-list">
				<div><span>{t.enabled}</span><b>{telegram.enabled ? t.enabled : t.disabled}</b></div>
				<div>
					<span>{t.token}</span><b>{telegram.tokenConfigured ? t.configured : t.missing}</b>
				</div>
				<div>
					<span>{t.allowlist}</span><b>{telegram.allowlistConfigured ? t.configured : t.missing}</b>
				</div>
				<div><span>{t.mode}</span><b>{telegram.mode || 'webhook'}</b></div>
				<div>
					<span>Webhook secret</span><b
						>{telegram.webhookSecretConfigured ? t.configured : t.missing}</b
					>
				</div>
				<div>
					<span>{t.adminUrl}</span><b
						>{telegram.adminBaseUrlConfigured ? t.configured : t.missing}</b
					>
				</div>
			</div>
		</section>
	</div>
</section>

<style>
	.intel-shell {
		--ink: #17211f;
		--muted: #66736f;
		--line: #dce3df;
		--paper: #fff;
		--wash: #f4f7f5;
		--green: #0f6b5b;
		--green-dark: #084b40;
		--copper: #b35e2a;
		--danger: #b42318;
		display: grid;
		gap: 18px;
		color: var(--ink);
		min-width: 0;
		font-family: 'Avenir Next', 'Trebuchet MS', sans-serif;
	}
	.back {
		color: var(--green);
		font-weight: 800;
		text-decoration: none;
		width: fit-content;
		font-size: 0.86rem;
	}
	.hero {
		position: relative;
		overflow: hidden;
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 24px;
		padding: 28px;
		background: var(--ink);
		color: #fff;
		border-radius: 18px;
	}
	.hero:after {
		content: '';
		position: absolute;
		width: 310px;
		height: 310px;
		border: 1px solid rgba(255, 255, 255, 0.13);
		border-radius: 50%;
		right: -90px;
		top: -160px;
		box-shadow:
			0 0 0 44px rgba(255, 255, 255, 0.025),
			0 0 0 88px rgba(255, 255, 255, 0.018);
	}
	.hero > div {
		position: relative;
		z-index: 1;
	}
	.eyebrow {
		margin: 0 0 10px;
		color: #8fd6c8;
		font:
			800 0.68rem/1.2 ui-monospace,
			monospace;
		letter-spacing: 0.18em;
	}
	.hero h1 {
		margin: 0;
		font-size: clamp(2rem, 5vw, 4.5rem);
		line-height: 0.9;
		letter-spacing: -0.055em;
	}
	.lede {
		max-width: 760px;
		margin: 16px 0 0;
		color: #cbd6d2;
		line-height: 1.55;
	}
	.hero-actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
	.button {
		min-height: 42px;
		padding: 0 17px;
		border: 1px solid transparent;
		border-radius: 9px;
		font: 800 0.82rem/1 inherit;
		cursor: pointer;
	}
	.button:disabled {
		opacity: 0.55;
		cursor: wait;
	}
	.primary {
		background: #75cfbd;
		color: #0a302a;
	}
	.secondary {
		background: #fff;
		color: var(--ink);
		border-color: var(--line);
	}
	.danger-button {
		background: #fff;
		color: var(--danger);
		border-color: #efb5af;
	}
	.alert {
		padding: 12px 16px;
		border-radius: 10px;
		font-weight: 700;
	}
	.alert.danger {
		background: #fff0ee;
		color: var(--danger);
		border: 1px solid #f5c1bb;
	}
	.alert.success {
		background: #eaf8f4;
		color: var(--green);
		border: 1px solid #b8e3d8;
	}
	.block {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 16px;
		padding: clamp(18px, 2.2vw, 28px);
		box-shadow: 0 1px 2px rgba(18, 33, 29, 0.03);
	}
	.section-title {
		display: flex;
		align-items: flex-start;
		gap: 13px;
		margin-bottom: 20px;
	}
	.section-title > span {
		font:
			800 0.68rem/1 ui-monospace,
			monospace;
		color: var(--copper);
		border-top: 2px solid var(--copper);
		padding-top: 6px;
	}
	.section-title > div {
		flex: 1;
	}
	.section-title h2 {
		margin: 0;
		font-size: 1.25rem;
		letter-spacing: -0.025em;
	}
	.section-title p {
		margin: 5px 0 0;
		color: var(--muted);
		font-size: 0.87rem;
	}
	.section-title.compact {
		margin-bottom: 14px;
	}
	.metric-grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		border: 1px solid var(--line);
		border-radius: 12px;
		overflow: hidden;
	}
	.metric {
		padding: 18px;
		border-right: 1px solid var(--line);
		background: linear-gradient(180deg, #fff, var(--wash));
		min-width: 0;
	}
	.metric:last-child {
		border-right: 0;
	}
	.metric span,
	.metric small {
		display: block;
		color: var(--muted);
		font-size: 0.73rem;
	}
	.metric strong {
		display: block;
		margin: 8px 0 10px;
		font:
			800 clamp(1.05rem, 2vw, 1.45rem)/1 ui-monospace,
			monospace;
		text-transform: uppercase;
		overflow-wrap: anywhere;
	}
	.metric.gate {
		background: #e8f6f2;
	}
	.metric.gate.closed {
		background: #fff0ee;
		color: var(--danger);
	}
	.danger-text {
		color: var(--danger);
	}
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.9fr);
		gap: 18px;
		align-items: start;
	}
	.change-list {
		display: grid;
		gap: 10px;
	}
	.change {
		padding: 15px;
		border: 1px solid var(--line);
		border-left: 3px solid var(--green);
		border-radius: 10px;
	}
	.change-top {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		color: var(--muted);
		font:
			700 0.7rem/1 ui-monospace,
			monospace;
		text-transform: uppercase;
	}
	.severity {
		padding: 4px 7px;
		border-radius: 4px;
		background: #eef3f1;
	}
	.severity.danger {
		background: #fff0ee;
		color: var(--danger);
	}
	.severity.warn {
		background: #fff6e7;
		color: #9a5b08;
	}
	.change h3 {
		margin: 10px 0 6px;
		font-size: 0.98rem;
	}
	.change p {
		margin: 0 0 8px;
		color: var(--muted);
		font-size: 0.84rem;
		line-height: 1.5;
	}
	.change a,
	.table-wrap a {
		color: var(--green);
		font-size: 0.76rem;
	}
	.empty {
		padding: 25px;
		background: var(--wash);
		border-radius: 10px;
		color: var(--muted);
	}
	.guidance-row {
		padding: 14px 0;
		border-bottom: 1px solid var(--line);
	}
	.guidance-row:last-child {
		border: 0;
	}
	.guidance-row h3 {
		margin: 0 0 5px;
		font-size: 0.83rem;
		color: var(--green);
	}
	.guidance-row p {
		margin: 0;
		color: var(--muted);
		font-size: 0.84rem;
		line-height: 1.48;
	}
	.table-wrap {
		overflow: auto;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.8rem;
	}
	th {
		padding: 10px;
		text-align: left;
		background: var(--wash);
		color: var(--muted);
		font:
			800 0.68rem/1 ui-monospace,
			monospace;
		text-transform: uppercase;
		white-space: nowrap;
	}
	td {
		padding: 12px 10px;
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}
	td strong,
	td a {
		display: block;
	}
	.error-cell {
		max-width: 220px;
		color: var(--danger);
	}
	.tag {
		display: inline-block;
		padding: 4px 6px;
		margin: 2px;
		border-radius: 4px;
		background: #eef1f0;
		font:
			800 0.64rem/1 ui-monospace,
			monospace;
	}
	.tag.official {
		background: #e3f4ef;
		color: var(--green);
	}
	.tag.required {
		background: #fff2e9;
		color: var(--copper);
	}
	.toggle {
		width: 38px;
		height: 22px;
		border: 0;
		border-radius: 20px;
		background: #cbd3d0;
		padding: 3px;
		cursor: pointer;
	}
	.toggle span {
		display: block;
		width: 16px;
		height: 16px;
		background: #fff;
		border-radius: 50%;
		transition: transform 0.2s;
	}
	.toggle.on {
		background: var(--green);
	}
	.toggle.on span {
		transform: translateX(16px);
	}
	.text-button {
		border: 0;
		background: none;
		color: var(--green);
		font-weight: 800;
		cursor: pointer;
		white-space: nowrap;
	}
	.form-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.form-grid label {
		display: grid;
		gap: 6px;
		color: var(--muted);
		font-size: 0.76rem;
		font-weight: 800;
	}
	.form-grid input:not([type='checkbox']),
	.form-grid select,
	.style-controls input,
	.override textarea {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 10px 11px;
		background: #fff;
		color: var(--ink);
		font: inherit;
	}
	.form-grid input[type='checkbox'] {
		width: 20px;
		height: 20px;
		accent-color: var(--green);
	}
	.right {
		display: flex;
		justify-content: flex-end;
		margin-top: 18px;
	}
	.timeline,
	.snapshot-list,
	.blog-list {
		display: grid;
		gap: 0;
	}
	.timeline article {
		position: relative;
		display: flex;
		gap: 12px;
		padding: 0 0 18px;
	}
	.timeline article:before {
		content: '';
		position: absolute;
		left: 5px;
		top: 12px;
		bottom: 0;
		border-left: 1px solid var(--line);
	}
	.timeline-dot {
		position: relative;
		z-index: 1;
		width: 11px;
		height: 11px;
		margin-top: 4px;
		border-radius: 50%;
		background: var(--green);
		flex: none;
	}
	.timeline-dot.failed {
		background: var(--danger);
	}
	.timeline p,
	.timeline small,
	.snapshot-list p,
	.snapshot-list small,
	.blog-list p,
	.blog-list small {
		margin: 4px 0 0;
		color: var(--muted);
		font-size: 0.74rem;
	}
	.snapshot-list article,
	.blog-list article {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: center;
		padding: 12px 0;
		border-bottom: 1px solid var(--line);
	}
	.snapshot-list article > div:last-child {
		text-align: right;
	}
	.snapshot-list small {
		display: block;
	}
	.override {
		border-color: #edc7c2;
		background: linear-gradient(135deg, #fff, #fff9f8);
	}
	.override-form {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 12px;
		align-items: end;
	}
	.override textarea {
		resize: vertical;
	}
	.style-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
	}
	.style-grid article {
		display: grid;
		gap: 11px;
		padding: 15px;
		border: 1px solid var(--line);
		border-radius: 11px;
		background: var(--wash);
	}
	.style-grid article.disabled {
		opacity: 0.55;
	}
	.style-grid article.locked {
		border-color: var(--copper);
		box-shadow: inset 0 3px 0 var(--copper);
	}
	.style-head {
		display: flex;
		justify-content: space-between;
		gap: 10px;
	}
	.style-head h3 {
		margin: 0;
		font:
			800 0.84rem/1.2 ui-monospace,
			monospace;
	}
	.style-grid p {
		margin: 0;
		color: var(--muted);
		font-size: 0.76rem;
	}
	.style-grid small {
		color: var(--muted);
		font-size: 0.68rem;
	}
	.style-controls {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 8px;
	}
	.style-controls label {
		font-size: 0.68rem;
		color: var(--muted);
	}
	.style-controls input {
		width: 70px;
		display: block;
		margin-top: 4px;
		padding: 6px;
	}
	.lock {
		border: 1px solid var(--line);
		background: #fff;
		border-radius: 7px;
		padding: 7px;
		font-size: 0.68rem;
		cursor: pointer;
	}
	.lock.active {
		border-color: var(--copper);
		color: var(--copper);
	}
	.subhead {
		margin: 24px 0 10px;
		font-size: 0.9rem;
	}
	.profile-strip {
		display: flex;
		gap: 8px;
		overflow: auto;
		padding-bottom: 5px;
	}
	.profile-strip > span {
		min-width: 165px;
		padding: 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		font-size: 0.72rem;
	}
	.profile-strip b,
	.profile-strip small {
		display: block;
	}
	.profile-strip small {
		margin-top: 5px;
		color: var(--muted);
	}
	.blog-list a {
		color: var(--green);
		font-weight: 800;
		font-size: 0.76rem;
		white-space: nowrap;
	}
	.status-list {
		display: grid;
	}
	.status-list > div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 0;
		border-bottom: 1px solid var(--line);
	}
	.status-list span {
		color: var(--muted);
		font-size: 0.8rem;
	}
	.status-list b {
		font:
			800 0.74rem/1 ui-monospace,
			monospace;
		text-transform: uppercase;
	}
	@media (max-width: 1150px) {
		.metric-grid {
			grid-template-columns: repeat(3, 1fr);
		}
		.metric {
			border-bottom: 1px solid var(--line);
		}
		.style-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (max-width: 820px) {
		.hero,
		.split {
			grid-template-columns: 1fr;
			display: grid;
		}
		.metric-grid,
		.form-grid,
		.style-grid {
			grid-template-columns: 1fr 1fr;
		}
		.hero-actions {
			justify-content: start;
		}
		.override-form {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 560px) {
		.metric-grid,
		.form-grid,
		.style-grid {
			grid-template-columns: 1fr;
		}
		.metric {
			border-right: 0;
		}
		.section-title {
			flex-wrap: wrap;
		}
		.section-title > .button {
			width: 100%;
		}
		.hero-actions,
		.hero-actions .button {
			width: 100%;
		}
		.hero-actions .button {
			flex: 1;
		}
		.block {
			padding: 16px;
		}
	}
	.similarity-warning {
		display: block;
		color: var(--danger) !important;
		margin-top: 5px !important;
	}
	.source-create {
		margin-top: 20px;
		padding-top: 20px;
		border-top: 1px dashed var(--line);
	}
	.compact-input {
		width: 72px;
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 6px;
		background: #fff;
		color: var(--ink);
	}
	.source-name-input,
	.source-groups-input {
		display: block;
		width: 220px;
		max-width: 35vw;
		border: 0;
		border-bottom: 1px solid transparent;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-weight: 800;
		padding: 3px 0;
	}
	.source-name-input:focus,
	.source-groups-input:focus {
		outline: 0;
		border-color: var(--green);
	}
	.source-groups-input {
		margin-top: 4px;
		color: var(--muted);
		font-size: 0.68rem;
		font-weight: 600;
	}
	.control-tag {
		border: 0;
		cursor: pointer;
	}
	.control-tag.inactive {
		opacity: 0.38;
	}
	.check-row {
		align-content: start;
	}
	.check-row input {
		margin-top: 5px;
	}
</style>
