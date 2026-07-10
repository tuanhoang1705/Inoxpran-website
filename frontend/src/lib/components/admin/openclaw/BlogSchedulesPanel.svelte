<script>
	import { onMount } from 'svelte';
	import { locale } from '$lib/i18n/admin/index.js';

	let { initialSchedules = [], initialRuntime = {} } = $props();

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
		topic: 'noi inox cho gia dinh Viet',
		primaryKeyword: 'noi inox',
		secondaryKeywords: 'noi inox 304, noi inox dung bep tu',
		categoryKey: 'guide',
		articleType: 'how-to',
		language: 'vi',
		prompt: ''
	});

	// svelte-ignore state_referenced_locally
	let schedules = $state(Array.isArray(initialSchedules) ? [...initialSchedules] : []);
	// svelte-ignore state_referenced_locally
	let scheduleRuntime = $state(initialRuntime || {});
	// svelte-ignore state_referenced_locally
	let selectedScheduleId = $state(schedules[0]?.id || '');
	let scheduleExecutions = $state([]);
	let scheduleForm = $state(makeDefaultScheduleForm());
	let editingScheduleId = $state('');
	let busyScheduleAction = $state('');
	let pageError = $state('');

	const selectedSchedule = $derived(
		schedules.find((schedule) => schedule.id === selectedScheduleId) || schedules[0] || null
	);

	const t = $derived({
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
		dailyTimes: isEn ? 'Daily times, HH:mm comma-separated' : 'Giờ chạy (HH:mm, phân cách bằng dấu phẩy)',
		weeklyTimes: isEn ? 'Weekly times, HH:mm comma-separated' : 'Giờ chạy tuần (HH:mm, phân cách bằng dấu phẩy)',
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
		confirmDelete: isEn ? 'Delete this schedule?' : 'Xoá lịch này?'
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
			topic: schedule.agentConfig?.topic || '',
			primaryKeyword: schedule.agentConfig?.primaryKeyword || '',
			secondaryKeywords: (schedule.agentConfig?.secondaryKeywords || []).join(', '),
			categoryKey: schedule.agentConfig?.categoryKey || 'guide',
			articleType: schedule.agentConfig?.articleType || 'how-to',
			language: schedule.agentConfig?.language || 'vi',
			prompt: schedule.agentConfig?.prompt || ''
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
		autoPublish: scheduleForm.autoPublish,
		agentConfig: {
			topic: scheduleForm.topic,
			primaryKeyword: scheduleForm.primaryKeyword,
			secondaryKeywords: splitCsv(scheduleForm.secondaryKeywords),
			categoryKey: scheduleForm.categoryKey,
			articleType: scheduleForm.articleType,
			language: scheduleForm.language,
			prompt: scheduleForm.prompt
		}
	});

	const refreshSchedules = async () => {
		pageError = '';
		const response = await fetch(resolveAdminPath('/admin/api/openclaw/blog-schedules?limit=50&page=1'));
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			pageError = payload?.error || (isEn ? 'Unable to load blog schedules' : 'Không tải được lịch tạo bài');
			return;
		}
		schedules = Array.isArray(payload?.schedules) ? payload.schedules : [];
		scheduleRuntime = payload?.runtime || {};
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
			pageError = payload?.error || (isEn ? 'Unable to load schedule executions' : 'Không tải được lịch sử chạy');
			return;
		}
		scheduleExecutions = Array.isArray(payload?.executions) ? payload.executions : [];
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
				pageError = payload?.error || (isEn ? 'Unable to save blog schedule' : 'Không lưu được lịch tạo bài');
				return;
			}
			upsertSchedule(payload);
			fillScheduleForm(payload);
		} finally {
			busyScheduleAction = '';
		}
	};

	const scheduleOperation = async (scheduleId, operation) => {
		if (!scheduleId || busyScheduleAction) return;
		busyScheduleAction = `${operation}:${scheduleId}`;
		pageError = '';
		try {
			const response = await fetch(
				resolveAdminPath(`/admin/api/openclaw/blog-schedules/${scheduleId}/${operation}`),
				{ method: 'POST' }
			);
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				pageError = payload?.error || (isEn ? 'Unable to run schedule operation' : 'Không thực hiện được thao tác lịch');
				return;
			}
			if (operation === 'run-now') {
				await loadScheduleExecutions(scheduleId);
				await refreshSchedules();
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
			const response = await fetch(resolveAdminPath(`/admin/api/openclaw/blog-schedules/${scheduleId}`), {
				method: 'DELETE'
			});
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
		const current = new Set(scheduleForm.daysOfWeek || []);
		if (current.has(day)) current.delete(day);
		else current.add(day);
		scheduleForm = {
			...scheduleForm,
			daysOfWeek: Array.from(current).sort((a, b) => a - b)
		};
	};

	onMount(() => {
		if (selectedScheduleId) loadScheduleExecutions(selectedScheduleId);
	});
</script>

<section class="console-panel schedule-panel">
	<div class="panel-head">
		<h2>{t.title}</h2>
		<span>{schedules.length}</span>
	</div>

	{#if pageError}
		<div class="console-alert">{pageError}</div>
	{/if}

	<div class="schedule-layout">
		<div class="schedule-list">
			<div class="schedule-list__head">
				<button type="button" class="console-btn secondary" onclick={refreshSchedules}>{t.refresh}</button>
				<button type="button" class="console-btn secondary" onclick={() => fillScheduleForm(null)}>{t.new}</button>
			</div>
			{#if schedules.length}
				{#each schedules as schedule (schedule.id)}
					<article class="schedule-card" class:selected={selectedSchedule?.id === schedule.id}>
						<button
							type="button"
							class="schedule-card__main"
							onclick={() => {
								selectedScheduleId = schedule.id;
								loadScheduleExecutions(schedule.id);
							}}
						>
							<span class:good={schedule.enabled} class:bad={!schedule.enabled}>
								{schedule.enabled ? t.enabledLabel : t.disabledLabel}
							</span>
							<strong>{schedule.name}</strong>
							<small>{scheduleTimes(schedule)}</small>
							<small>{t.next}: {formatDateTime(schedule.nextRunAt)}</small>
							<small>
								{t.last}: {formatDateTime(schedule.lastRunAt)}
								{#if schedule.lastRunStatus}· {executionStatusLabel(schedule.lastRunStatus)}{/if}
								· {t.runCount}: {schedule.runCount ?? 0}
							</small>
						</button>
						<div class="schedule-actions">
							<button type="button" onclick={() => fillScheduleForm(schedule)}>{t.edit}</button>
							<button
								type="button"
								onclick={() => scheduleOperation(schedule.id, schedule.enabled ? 'disable' : 'enable')}
								disabled={Boolean(busyScheduleAction)}
							>
								{schedule.enabled ? t.disable : t.enable}
							</button>
							<button
								type="button"
								class="run-this"
								onclick={() => scheduleOperation(schedule.id, 'run-now')}
								disabled={Boolean(busyScheduleAction)}
							>
								{busyScheduleAction === `run-now:${schedule.id}` ? (isEn ? 'Running…' : 'Đang chạy…') : t.runThis}
							</button>
							<button type="button" onclick={() => deleteSchedule(schedule.id)}>{t.delete}</button>
						</div>
					</article>
				{/each}
			{:else}
				<div class="empty-state">{t.empty}</div>
			{/if}

			<div class="execution-box">
				<div class="panel-head compact">
					<h3>{t.executions}</h3>
					<button type="button" onclick={() => loadScheduleExecutions(selectedScheduleId)}>{t.reload}</button>
				</div>
				{#if scheduleExecutions.length}
					<div class="execution-list">
						{#each scheduleExecutions as execution (execution.executionKey || execution.createdAt)}
							<div class="execution-row">
								<b
									class:good={execution.status === 'published' || execution.status === 'draft_created'}
									class:bad={execution.status === 'failed'}
								>
									{executionStatusLabel(execution.status)}
								</b>
								<span>{execution.blogTitle || execution.executionKey}</span>
								<small>{formatDateTime(execution.createdAt)}</small>
								{#if execution.blogId}
									<a href={`/admin/blogs/${execution.blogId}`} target="_blank" rel="noreferrer">{t.openDraft}</a>
								{/if}
								{#if execution.telegramNotificationStatus}
									<small>Telegram: {execution.telegramNotificationStatus}</small>
								{/if}
								{#if execution.error}
									<small class="bad">{execution.error}</small>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="empty-state">{t.noExecutions}</div>
				{/if}
			</div>
		</div>

		<form class="schedule-form" onsubmit={saveSchedule}>
			<div class="panel-head compact">
				<h3>{editingScheduleId ? t.editTitle : t.createTitle}</h3>
				<span>{editingScheduleId ? t.editHint : t.createHint}</span>
			</div>
			<label>
				<span>{t.name}</span>
				<input bind:value={scheduleForm.name} required />
			</label>
			<label>
				<span>{t.topic}</span>
				<textarea bind:value={scheduleForm.topic} rows="2" required></textarea>
			</label>
			<div class="form-grid">
				<label>
					<span>{t.type}</span>
					<select bind:value={scheduleForm.scheduleType}>
						<option value="daily">{t.daily}</option>
						<option value="weekly">{t.weekly}</option>
						<option value="interval">{t.interval}</option>
					</select>
				</label>
				<label>
					<span>{t.timezone}</span>
					<input bind:value={scheduleForm.timezone} />
				</label>
			</div>
			{#if scheduleForm.scheduleType === 'daily'}
				<label>
					<span>{t.dailyTimes}</span>
					<input bind:value={scheduleForm.dailyTimes} placeholder="09:00, 15:30" />
				</label>
			{:else if scheduleForm.scheduleType === 'weekly'}
				<div class="weekday-row">
					{#each [0, 1, 2, 3, 4, 5, 6] as day}
						<button
							type="button"
							class:active={scheduleForm.daysOfWeek.includes(day)}
							onclick={() => toggleWeekday(day)}
						>
							{day}
						</button>
					{/each}
				</div>
				<label>
					<span>{t.weeklyTimes}</span>
					<input bind:value={scheduleForm.weeklyTimes} placeholder="09:00" />
				</label>
			{:else}
				<div class="form-grid">
					<label>
						<span>{t.every}</span>
						<input type="number" min="1" bind:value={scheduleForm.intervalValue} />
					</label>
					<label>
						<span>{t.unit}</span>
						<select bind:value={scheduleForm.intervalUnit}>
							<option value="minutes">{t.minutes}</option>
							<option value="hours">{t.hours}</option>
							<option value="days">{t.days}</option>
						</select>
					</label>
				</div>
			{/if}
			<div class="form-grid">
				<label>
					<span>{t.runLimit}</span>
					<input type="number" min="0" bind:value={scheduleForm.runLimit} />
				</label>
				<label>
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
			</div>
			<div class="form-grid">
				<label>
					<span>{t.startAt}</span>
					<input type="datetime-local" bind:value={scheduleForm.startAt} />
				</label>
				<label>
					<span>{t.endAt}</span>
					<input type="datetime-local" bind:value={scheduleForm.endAt} />
				</label>
			</div>
			<label>
				<span>{t.primaryKeyword}</span>
				<input bind:value={scheduleForm.primaryKeyword} />
			</label>
			<label>
				<span>{t.secondaryKeywords}</span>
				<input bind:value={scheduleForm.secondaryKeywords} />
			</label>
			<label>
				<span>{t.extra}</span>
				<textarea bind:value={scheduleForm.prompt} rows="3"></textarea>
			</label>
			<div class="switch-row">
				<label>
					<input type="checkbox" bind:checked={scheduleForm.enabled} />
					<span>{t.enabledSwitch}</span>
				</label>
				<label>
					<input type="checkbox" bind:checked={scheduleForm.autoPublish} />
					<span>{t.autoPublishSwitch}</span>
				</label>
			</div>
			<div class="schedule-form__actions">
				<button type="button" class="console-btn secondary" onclick={() => fillScheduleForm(null)}>{t.reset}</button>
				<button type="submit" class="console-btn dark" disabled={busyScheduleAction === 'save'}>
					{busyScheduleAction === 'save' ? t.saving : t.save}
				</button>
			</div>
		</form>
	</div>
</section>

<style>
	.schedule-panel {
		border: 1px solid var(--line, rgba(23, 32, 27, 0.12));
		background: var(--panel, #fbfbf7);
		border-radius: 8px;
		padding: 1rem;
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		color: var(--ink, #17201b);
	}

	.console-alert {
		padding: 0.9rem 1rem;
		border-radius: 8px;
		border: 1px solid rgba(180, 35, 24, 0.25);
		background: #fff1ef;
		color: var(--bad, #b42318);
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

	.panel-head span,
	.schedule-card__main small,
	.execution-row small,
	.schedule-form label span,
	.switch-row span {
		color: var(--muted, #607067);
		font-size: 0.82rem;
	}

	.good {
		color: var(--good, #13795b);
	}

	.bad {
		color: var(--bad, #b42318);
	}

	.console-btn {
		border: 1px solid var(--line, rgba(23, 32, 27, 0.12));
		background: #fff;
		color: var(--ink, #17201b);
		border-radius: 8px;
		padding: 0.65rem 0.9rem;
		font-weight: 800;
		cursor: pointer;
	}

	.console-btn.dark {
		background: #17201b;
		color: #fff;
	}

	.console-btn.secondary:hover {
		border-color: rgba(19, 121, 91, 0.45);
		background: #f7fbf8;
	}

	.schedule-layout {
		display: grid;
		grid-template-columns: minmax(320px, 0.95fr) minmax(340px, 1.05fr);
		gap: 1rem;
		align-items: start;
	}

	.schedule-list {
		display: grid;
		gap: 0.75rem;
	}

	.schedule-list__head,
	.schedule-actions,
	.schedule-form__actions,
	.switch-row,
	.weekday-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.schedule-card,
	.execution-box,
	.schedule-form {
		border: 1px solid var(--line, rgba(23, 32, 27, 0.12));
		border-radius: 8px;
		background: #fff;
	}

	.schedule-card {
		padding: 0.75rem;
		display: grid;
		gap: 0.65rem;
	}

	.schedule-card.selected {
		border-color: rgba(19, 121, 91, 0.45);
		background: #f8fbf7;
	}

	.schedule-card__main {
		border: 0;
		background: transparent;
		color: inherit;
		text-align: left;
		display: grid;
		gap: 0.22rem;
		cursor: pointer;
	}

	.schedule-card__main span {
		width: fit-content;
		border-radius: 999px;
		background: var(--field, #f1f5ee);
		padding: 0.14rem 0.5rem;
		font-size: 0.72rem;
		font-weight: 850;
	}

	.schedule-card__main strong,
	.execution-row span {
		overflow-wrap: anywhere;
	}

	.schedule-actions button,
	.execution-box button,
	.weekday-row button {
		border: 1px solid var(--line, rgba(23, 32, 27, 0.12));
		border-radius: 8px;
		background: #fff;
		padding: 0.45rem 0.6rem;
		cursor: pointer;
		font-weight: 750;
	}

	.schedule-actions button:hover,
	.execution-box button:hover,
	.weekday-row button:hover {
		border-color: rgba(19, 121, 91, 0.45);
	}

	.schedule-actions button:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.schedule-actions .run-this {
		border-color: rgba(19, 121, 91, 0.5);
		color: var(--good, #13795b);
		font-weight: 850;
	}

	.weekday-row button.active {
		background: #17201b;
		color: #fff;
	}

	.execution-box {
		padding: 0.85rem;
	}

	.panel-head.compact {
		margin-bottom: 0.65rem;
	}

	.panel-head.compact h3 {
		margin: 0;
		font-size: 0.95rem;
	}

	.execution-list {
		display: grid;
		gap: 0.5rem;
		max-height: 330px;
		overflow: auto;
	}

	.execution-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.2rem 0.65rem;
		padding: 0.65rem;
		border: 1px solid rgba(23, 32, 27, 0.08);
		border-radius: 8px;
		background: #fbfbf7;
	}

	.execution-row a {
		color: var(--good, #13795b);
		font-weight: 800;
		text-decoration: none;
	}

	.schedule-form {
		padding: 1rem;
		display: grid;
		gap: 0.75rem;
	}

	.schedule-form label {
		display: grid;
		gap: 0.35rem;
	}

	.schedule-form input,
	.schedule-form select,
	.schedule-form textarea {
		width: 100%;
		border: 1px solid var(--line, rgba(23, 32, 27, 0.12));
		border-radius: 8px;
		background: #fff;
		color: var(--ink, #17201b);
		padding: 0.65rem 0.7rem;
		font: inherit;
	}

	.schedule-form textarea {
		resize: vertical;
		min-height: 80px;
	}

	.form-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.switch-row label {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.switch-row input {
		width: auto;
	}

	.schedule-form__actions {
		justify-content: end;
	}

	.empty-state {
		padding: 1rem;
		border-radius: 8px;
		background: var(--field, #f1f5ee);
		color: var(--muted, #607067);
	}

	@media (max-width: 1180px) {
		.schedule-layout {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 720px) {
		.form-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
