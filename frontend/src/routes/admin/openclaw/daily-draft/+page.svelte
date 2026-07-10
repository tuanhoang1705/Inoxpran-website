<script>
	import { onDestroy } from 'svelte';
	import { locale } from '$lib/i18n/admin/index.js';
	import BlogSchedulesPanel from '$lib/components/admin/openclaw/BlogSchedulesPanel.svelte';

	let { data } = $props();

	const isEn = $derived($locale === 'en');

	// svelte-ignore state_referenced_locally
	let dashboard = $state(data?.dashboard || {});
	// svelte-ignore state_referenced_locally
	let pageError = $state(data?.loadError || '');

	const automation = $derived(dashboard?.automation || {});
	const env = $derived(dashboard?.env || {});
	const scheduleData = $derived(data?.schedules || {});
	const scheduleRuntime = $derived(scheduleData?.runtime || {});
	const initialSchedules = $derived(Array.isArray(scheduleData?.schedules) ? scheduleData.schedules : []);

	let confirmOpen = $state(false);
	let running = $state(false);
	let activeRun = $state(null);
	let runError = $state('');
	let pollTimer = null;

	const t = $derived({
		back: isEn ? 'Back to OpenClaw' : 'Quay lại OpenClaw',
		title: 'Daily Draft',
		subtitle: isEn
			? 'Run the blog workflow now or configure automated schedules.'
			: 'Chạy ngay quy trình tạo bài hoặc thiết lập lịch tự động.',
		runSectionTitle: isEn ? 'Run Daily Draft Now' : 'Chạy Daily Draft ngay',
		runSectionHint: isEn
			? 'Trigger the default multi-agent SEO blog workflow one time.'
			: 'Kích hoạt quy trình tạo blog SEO đa agent mặc định một lần.',
		runNow: isEn ? 'Run daily draft now' : 'Chạy daily draft ngay',
		running: isEn ? 'Running…' : 'Đang chạy…',
		confirmTitle: isEn ? 'Confirm daily draft run' : 'Xác nhận chạy daily draft',
		confirmDescription: isEn
			? 'This starts the default Agentic workflow with the settings below.'
			: 'Thao tác này khởi động quy trình Agentic mặc định với cấu hình bên dưới.',
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
		configNote: isEn
			? 'Topic, category and language follow the daily-seo-blog prompt configuration.'
			: 'Chủ đề, danh mục và ngôn ngữ theo cấu hình prompt daily-seo-blog.',
		cancel: isEn ? 'Cancel' : 'Huỷ',
		confirmRun: isEn ? 'Confirm run' : 'Xác nhận chạy',
		on: isEn ? 'On' : 'Bật',
		off: isEn ? 'Off' : 'Tắt',
		statusTitle: isEn ? 'System status' : 'Trạng thái hệ thống',
		seoAgent: isEn ? 'SEO agent' : 'SEO agent',
		blogCron: isEn ? 'Blog cron' : 'Blog cron',
		telegram: isEn ? 'Telegram approval' : 'Duyệt qua Telegram',
		gateway: isEn ? 'OpenClaw gateway' : 'OpenClaw gateway',
		enabled: isEn ? 'Enabled' : 'Đang bật',
		disabled: isEn ? 'Disabled' : 'Tắt',
		missingConfig: isEn ? 'Missing config' : 'Thiếu cấu hình',
		configured: isEn ? 'Configured' : 'Đã cấu hình',
		notConfigured: isEn ? 'Not configured' : 'Chưa cấu hình',
		runStarted: isEn ? 'Run started' : 'Đã bắt đầu chạy',
		runStatus: isEn ? 'Status' : 'Trạng thái',
		executionId: isEn ? 'Execution ID' : 'Mã phiên chạy',
		output: isEn ? 'Output' : 'Nhật ký',
		openBlogs: isEn ? 'Open blog list' : 'Mở danh sách bài viết',
		openDraft: isEn ? 'Open generated draft' : 'Mở bản nháp vừa tạo',
		draftHint: isEn
			? 'When finished, the new draft appears in the blog list.'
			: 'Khi chạy xong, bản nháp mới sẽ xuất hiện trong danh sách bài viết.'
	});

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com') {
			return path;
		}
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
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

	const runStatusLabel = (status) => {
		if (status === 'completed') return isEn ? 'Completed' : 'Hoàn tất';
		if (status === 'failed') return isEn ? 'Failed' : 'Lỗi';
		if (status === 'timed_out') return isEn ? 'Timed out' : 'Quá thời gian';
		return isEn ? 'Running' : 'Đang chạy';
	};

	const telegramStatus = $derived.by(() => {
		const enabled = Boolean(scheduleRuntime.telegramEnabled);
		if (!enabled) return { key: 'disabled', label: t.disabled, tone: 'bad' };
		const complete =
			env.TELEGRAM_BOT_TOKEN &&
			env.TELEGRAM_WEBHOOK_SECRET &&
			(env.TELEGRAM_ALLOWED_CHAT_IDS || env.TELEGRAM_ALLOWED_USER_IDS);
		if (!complete) return { key: 'missing', label: t.missingConfig, tone: 'warn' };
		return { key: 'enabled', label: t.enabled, tone: 'good' };
	});

	// Best-effort: pull a /admin/blogs/<id> style edit link out of the run output.
	const generatedBlogEditPath = $derived.by(() => {
		const output = String(activeRun?.output || '');
		const idMatch = output.match(/\/admin\/blogs\/([a-f0-9]{24})/i) || output.match(/blogId["':\s]+([a-f0-9]{24})/i);
		return idMatch ? `/admin/blogs/${idMatch[1]}` : '';
	});

	const stopPolling = () => {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	};

	const startPolling = (runId) => {
		stopPolling();
		pollTimer = setInterval(async () => {
			try {
				const response = await fetch(resolveAdminPath('/admin/api/openclaw/runs'));
				const payload = await response.json().catch(() => null);
				if (!response.ok) return;
				const runs = Array.isArray(payload?.runs) ? payload.runs : [];
				const match = runs.find((run) => run.id === runId);
				if (match) {
					activeRun = match;
					if (match.status !== 'running') {
						running = false;
						stopPolling();
					}
				}
			} catch {
				/* keep polling; transient network error */
			}
		}, 2500);
	};

	const confirmRun = async () => {
		if (running) return;
		running = true;
		runError = '';
		confirmOpen = false;
		activeRun = null;
		try {
			const response = await fetch(resolveAdminPath('/admin/api/openclaw/runs'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					action: 'daily-draft',
					profile: dashboard?.profile || 'inoxpran'
				})
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				runError =
					payload?.error || (isEn ? 'Unable to start daily draft run' : 'Không thể bắt đầu chạy daily draft');
				running = false;
				return;
			}
			activeRun = payload;
			if (payload?.status === 'running' && payload?.id) {
				startPolling(payload.id);
			} else {
				running = false;
			}
		} catch {
			runError = isEn ? 'Network error while starting run' : 'Lỗi mạng khi bắt đầu chạy';
			running = false;
		}
	};

	onDestroy(stopPolling);
</script>

<svelte:head>
	<title>Daily Draft | OpenClaw | Inoxpran</title>
</svelte:head>

<section class="openclaw-console daily-draft">
	<a class="back-link" href="/admin/openclaw">← {t.back}</a>

	<header class="dd-head">
		<div>
			<p class="openclaw-kicker">OpenClaw</p>
			<h1>{t.title}</h1>
			<p>{t.subtitle}</p>
		</div>
	</header>

	{#if pageError}
		<div class="console-alert">{pageError}</div>
	{/if}

	<div class="dd-grid">
		<section class="console-panel run-now-panel">
			<div class="panel-head">
				<h2>{t.runSectionTitle}</h2>
			</div>
			<p class="muted">{t.runSectionHint}</p>

			<button type="button" class="console-btn dark run-now-btn" onclick={() => (confirmOpen = true)} disabled={running}>
				{running ? t.running : t.runNow}
			</button>

			{#if runError}
				<div class="console-alert">{runError}</div>
			{/if}

			{#if activeRun}
				<div class="run-result">
					<div class="run-result__row">
						<span>{t.runStatus}</span>
						<strong
							class:good={activeRun.status === 'completed'}
							class:bad={activeRun.status === 'failed' || activeRun.status === 'timed_out'}
						>
							{runStatusLabel(activeRun.status)}
						</strong>
					</div>
					<div class="run-result__row">
						<span>{t.executionId}</span>
						<code>{activeRun.id}</code>
					</div>
					<div class="run-result__row">
						<span>{isEn ? 'Started' : 'Bắt đầu'}</span>
						<strong>{formatDateTime(activeRun.startedAt)}</strong>
					</div>
					<div class="run-result__links">
						{#if generatedBlogEditPath}
							<a class="console-btn secondary" href={generatedBlogEditPath} target="_blank" rel="noreferrer">
								{t.openDraft}
							</a>
						{/if}
						<a class="console-btn secondary" href="/admin/blogs" target="_blank" rel="noreferrer">
							{t.openBlogs}
						</a>
					</div>
					<small class="muted">{t.draftHint}</small>
					{#if activeRun.output || activeRun.error}
						<details>
							<summary>{t.output}</summary>
							<pre>{activeRun.output || activeRun.error}</pre>
						</details>
					{/if}
				</div>
			{/if}
		</section>

		<section class="console-panel status-panel">
			<div class="panel-head">
				<h2>{t.statusTitle}</h2>
			</div>
			<div class="status-list">
				<div class="status-row">
					<span>{t.seoAgent}</span>
					<b class:good={automation.enabled} class:bad={!automation.enabled}>
						{automation.enabled ? t.enabled : t.disabled}
					</b>
				</div>
				<div class="status-row">
					<span>{t.blogCron}</span>
					<b class:good={scheduleRuntime.cronEnabled} class:bad={!scheduleRuntime.cronEnabled}>
						{scheduleRuntime.cronEnabled ? t.enabled : t.disabled}
					</b>
				</div>
				<div class="status-row">
					<span>{t.autoPublish}</span>
					<b class:bad={automation.autoPublish} class:good={!automation.autoPublish}>
						{automation.autoPublish ? t.autoPublish : t.draftOnly}
					</b>
				</div>
				<div class="status-row">
					<span>{t.telegram}</span>
					<b
						class:good={telegramStatus.tone === 'good'}
						class:bad={telegramStatus.tone === 'bad'}
						class:warn={telegramStatus.tone === 'warn'}
					>
						{telegramStatus.label}
					</b>
				</div>
				<div class="status-row">
					<span>{t.imagePipeline}</span>
					<b class:good={automation.imagePipelineEnabled}>
						{automation.imagePipelineEnabled ? t.enabled : t.disabled}
					</b>
				</div>
				<div class="status-row">
					<span>{t.gateway}</span>
					<b>{dashboard?.openclaw?.gatewayUrl || '--'}</b>
				</div>
			</div>
		</section>
	</div>

	<BlogSchedulesPanel {initialSchedules} initialRuntime={scheduleRuntime} />
</section>

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
			<p class="muted">{t.confirmDescription}</p>

			<div class="confirm-config">
				<div>
					<span>{t.publishingMode}</span>
					<b class:bad={automation.autoPublish} class:good={!automation.autoPublish}>
						{automation.autoPublish ? t.autoPublish : t.draftOnly}
					</b>
				</div>
				<div>
					<span>{t.imagePipeline}</span>
					<b>{automation.imagePipelineEnabled ? t.on : t.off}</b>
				</div>
				<div>
					<span>{t.imageSearch}</span>
					<b>{automation.imageSearchProvider || 'disabled'}</b>
				</div>
				<div>
					<span>{t.aiImage}</span>
					<b>{automation.aiImageProvider || 'disabled'}</b>
				</div>
				<div>
					<span>{t.minSeo}</span>
					<b>{automation.minSeoScore || 85}+</b>
				</div>
				<div>
					<span>{t.wordRange}</span>
					<b>{automation.minWords || 800}–{automation.maxWords || 1800}</b>
				</div>
			</div>

			{#if automation.autoPublish}
				<div class="confirm-warning">{t.autoPublishWarning}</div>
			{/if}

			<small class="muted">{t.configNote}</small>

			<div class="dd-modal__actions">
				<button type="button" class="console-btn secondary" onclick={() => (confirmOpen = false)}>{t.cancel}</button>
				<button type="button" class="console-btn dark" onclick={confirmRun}>{t.confirmRun}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.openclaw-console {
		--ink: #17201b;
		--muted: #607067;
		--line: rgba(23, 32, 27, 0.12);
		--panel: #fbfbf7;
		--field: #f1f5ee;
		--good: #13795b;
		--bad: #b42318;
		--warn: #b45309;
		display: grid;
		gap: 1rem;
		color: var(--ink);
	}

	.back-link {
		width: fit-content;
		color: var(--good);
		font-weight: 800;
		text-decoration: none;
	}

	.back-link:hover {
		text-decoration: underline;
	}

	.dd-head {
		padding: 1.25rem;
		background:
			linear-gradient(135deg, rgba(19, 121, 91, 0.12), transparent 38%),
			linear-gradient(90deg, #fcfbf4, #eef5f1);
		border: 1px solid var(--line);
		border-radius: 8px;
	}

	.openclaw-kicker {
		margin: 0 0 0.35rem;
		color: var(--good);
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
	}

	.dd-head h1 {
		margin: 0;
		font-size: clamp(1.7rem, 3vw, 2.55rem);
		line-height: 1.05;
	}

	.dd-head p {
		margin: 0.45rem 0 0;
		color: var(--muted);
	}

	.console-alert {
		padding: 0.9rem 1rem;
		border-radius: 8px;
		border: 1px solid rgba(180, 35, 24, 0.25);
		background: #fff1ef;
		color: var(--bad);
	}

	.dd-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.8fr);
		gap: 1rem;
		align-items: start;
	}

	.console-panel {
		min-width: 0;
		border: 1px solid var(--line);
		background: var(--panel);
		border-radius: 8px;
		padding: 1rem;
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.85rem;
	}

	.panel-head h2 {
		margin: 0;
		font-size: 1rem;
	}

	.muted {
		color: var(--muted);
		font-size: 0.88rem;
	}

	.console-btn {
		border: 1px solid var(--line);
		background: #fff;
		color: var(--ink);
		border-radius: 8px;
		padding: 0.65rem 0.9rem;
		font-weight: 800;
		cursor: pointer;
		text-decoration: none;
		display: inline-block;
	}

	.console-btn.dark {
		background: #17201b;
		color: #fff;
	}

	.console-btn.secondary:hover {
		border-color: rgba(19, 121, 91, 0.45);
		background: #f7fbf8;
	}

	.console-btn:disabled {
		opacity: 0.62;
		cursor: wait;
	}

	.run-now-btn {
		margin-top: 0.85rem;
	}

	.good {
		color: var(--good);
	}

	.bad {
		color: var(--bad);
	}

	.warn {
		color: var(--warn);
	}

	.run-result {
		margin-top: 1rem;
		display: grid;
		gap: 0.5rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		padding: 0.85rem;
	}

	.run-result__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.run-result__row span {
		color: var(--muted);
		font-size: 0.82rem;
	}

	.run-result__row code {
		overflow-wrap: anywhere;
		color: #3e4c44;
	}

	.run-result__links {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.25rem;
	}

	.run-result pre {
		margin: 0.5rem 0 0;
		max-height: 320px;
		overflow: auto;
		padding: 0.85rem;
		border-radius: 8px;
		background: #121813;
		color: #dbeee2;
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.8rem;
		line-height: 1.5;
	}

	.status-list {
		display: grid;
		gap: 0.4rem;
	}

	.status-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.55rem 0;
		border-bottom: 1px solid rgba(23, 32, 27, 0.08);
	}

	.status-row:last-child {
		border-bottom: 0;
	}

	.status-row span {
		color: var(--muted);
		font-size: 0.85rem;
	}

	.status-row b {
		overflow-wrap: anywhere;
		text-align: right;
	}

	.dd-modal {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(15, 23, 19, 0.55);
	}

	.dd-modal__box {
		width: min(560px, 100%);
		background: #fff;
		border-radius: 12px;
		border: 1px solid var(--line);
		padding: 1.25rem;
		display: grid;
		gap: 0.75rem;
		box-shadow: 0 24px 60px rgba(15, 23, 19, 0.3);
	}

	.dd-modal__box h3 {
		margin: 0;
	}

	.confirm-config {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem 1rem;
		padding: 0.75rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--field);
	}

	.confirm-config div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.confirm-config span {
		color: var(--muted);
		font-size: 0.82rem;
	}

	.confirm-warning {
		padding: 0.75rem 0.9rem;
		border-radius: 8px;
		background: #fff7ed;
		border: 1px solid rgba(180, 83, 9, 0.3);
		color: var(--warn);
		font-weight: 700;
		font-size: 0.9rem;
	}

	.dd-modal__actions {
		display: flex;
		justify-content: end;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	@media (max-width: 1180px) {
		.dd-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 720px) {
		.confirm-config {
			grid-template-columns: 1fr;
		}
	}
</style>
