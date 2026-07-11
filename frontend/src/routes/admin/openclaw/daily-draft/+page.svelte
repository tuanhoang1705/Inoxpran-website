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
	<a class="oc-back" href="/admin/openclaw">
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
		<span>{t.back}</span>
	</a>

	<header class="oc-header dd-header">
		<div class="oc-header__intro">
			<p class="oc-eyebrow">OpenClaw</p>
			<h1>{t.title}</h1>
			<p class="oc-header__sub">{t.subtitle}</p>
		</div>
		<span class="oc-badge dd-header__badge" class:is-good={automation.enabled} class:is-muted={!automation.enabled}>
			<span class="oc-dot"></span>{t.seoAgent}: {automation.enabled ? t.enabled : t.disabled}
		</span>
	</header>

	{#if pageError}
		<div class="oc-alert" role="alert">{pageError}</div>
	{/if}

	<div class="dd-grid">
		<section class="oc-panel dd-run">
			<div class="dd-run__intro">
				<span class="dd-run__icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none"><path d="M8 5.5v13l11-6.5-11-6.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
				</span>
				<div>
					<h2>{t.runSectionTitle}</h2>
					<p class="oc-muted">{t.runSectionHint}</p>
				</div>
			</div>

			<div class="dd-run__mode">
				<span class="oc-muted">{t.publishingMode}</span>
				<span class="oc-badge" class:is-warn={automation.autoPublish} class:is-good={!automation.autoPublish}>
					<span class="oc-dot"></span>{automation.autoPublish ? t.autoPublish : t.draftOnly}
				</span>
			</div>

			<div class="dd-run__cta">
				<button type="button" class="oc-btn oc-btn--primary" onclick={() => (confirmOpen = true)} disabled={running}>
					{running ? t.running : t.runNow}
				</button>
			</div>

			{#if runError}
				<div class="oc-alert" role="alert">{runError}</div>
			{/if}

			{#if activeRun}
				<div class="dd-result">
					<div class="dd-result__row">
						<span>{t.runStatus}</span>
						<b
							class="oc-badge"
							class:is-good={activeRun.status === 'completed'}
							class:is-danger={activeRun.status === 'failed' || activeRun.status === 'timed_out'}
							class:is-muted={activeRun.status !== 'completed' && activeRun.status !== 'failed' && activeRun.status !== 'timed_out'}
						>
							{runStatusLabel(activeRun.status)}
						</b>
					</div>
					<div class="dd-result__row">
						<span>{t.executionId}</span>
						<code>{activeRun.id}</code>
					</div>
					<div class="dd-result__row">
						<span>{isEn ? 'Started' : 'Bắt đầu'}</span>
						<strong>{formatDateTime(activeRun.startedAt)}</strong>
					</div>
					<div class="dd-result__links">
						{#if generatedBlogEditPath}
							<a class="oc-btn oc-btn--ghost oc-btn--sm" href={generatedBlogEditPath} target="_blank" rel="noreferrer">
								{t.openDraft}
							</a>
						{/if}
						<a class="oc-btn oc-btn--ghost oc-btn--sm" href="/admin/blogs" target="_blank" rel="noreferrer">
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
				<h2>{t.statusTitle}</h2>
			</div>
			<div class="dd-status__list">
				<div class="dd-status__row">
					<span>{t.seoAgent}</span>
					<b class="oc-badge" class:is-good={automation.enabled} class:is-muted={!automation.enabled}>
						<span class="oc-dot"></span>{automation.enabled ? t.enabled : t.disabled}
					</b>
				</div>
				<div class="dd-status__row">
					<span>{t.blogCron}</span>
					<b class="oc-badge" class:is-good={scheduleRuntime.cronEnabled} class:is-muted={!scheduleRuntime.cronEnabled}>
						<span class="oc-dot"></span>{scheduleRuntime.cronEnabled ? t.enabled : t.disabled}
					</b>
				</div>
				<div class="dd-status__row">
					<span>{t.autoPublish}</span>
					<b class="oc-badge" class:is-warn={automation.autoPublish} class:is-good={!automation.autoPublish}>
						<span class="oc-dot"></span>{automation.autoPublish ? t.autoPublish : t.draftOnly}
					</b>
				</div>
				<div class="dd-status__row">
					<span>{t.telegram}</span>
					<b
						class="oc-badge"
						class:is-good={telegramStatus.tone === 'good'}
						class:is-danger={telegramStatus.tone === 'bad'}
						class:is-warn={telegramStatus.tone === 'warn'}
					>
						<span class="oc-dot"></span>{telegramStatus.label}
					</b>
				</div>
				<div class="dd-status__row">
					<span>{t.imagePipeline}</span>
					<b class="oc-badge" class:is-good={automation.imagePipelineEnabled} class:is-muted={!automation.imagePipelineEnabled}>
						<span class="oc-dot"></span>{automation.imagePipelineEnabled ? t.enabled : t.disabled}
					</b>
				</div>
				<div class="dd-status__row dd-status__row--stack">
					<span>{t.gateway}</span>
					<code class="dd-status__gateway" title={dashboard?.openclaw?.gatewayUrl || '--'}>{dashboard?.openclaw?.gatewayUrl || '--'}</code>
				</div>
			</div>
		</aside>
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
			<p class="oc-muted">{t.confirmDescription}</p>

			<div class="dd-confirm">
				<div class="dd-confirm__item">
					<span>{t.publishingMode}</span>
					<b class="oc-badge" class:is-warn={automation.autoPublish} class:is-good={!automation.autoPublish}>
						{automation.autoPublish ? t.autoPublish : t.draftOnly}
					</b>
				</div>
				<div class="dd-confirm__item">
					<span>{t.imagePipeline}</span>
					<b>{automation.imagePipelineEnabled ? t.on : t.off}</b>
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

			{#if automation.autoPublish}
				<div class="dd-confirm__warning">{t.autoPublishWarning}</div>
			{/if}

			<small class="oc-muted">{t.configNote}</small>

			<div class="dd-modal__actions">
				<button type="button" class="oc-btn oc-btn--ghost" onclick={() => (confirmOpen = false)}>{t.cancel}</button>
				<button type="button" class="oc-btn oc-btn--primary" onclick={confirmRun}>{t.confirmRun}</button>
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
		transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease,
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

	.dd-status__row--stack {
		flex-direction: column;
		align-items: flex-start;
		gap: 5px;
	}

	.dd-status__gateway {
		font-family: 'Monaco', 'Courier New', monospace;
		font-size: 0.76rem;
		color: var(--oc-text);
		overflow-wrap: anywhere;
		max-width: 100%;
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
