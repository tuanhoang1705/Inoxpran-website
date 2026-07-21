<script>
	import { t } from '$lib/i18n/admin/index.js';
	import {
		CONTENT_SCHEDULE_MODES,
		scheduleModeTranslationKey
	} from '$lib/contentOperations/contracts.js';
	import StatusBadge from './StatusBadge.svelte';

	let { schedule = {}, onSave = () => {}, onToggle = () => {}, busy = false } = $props();
	const buildForm = (scheduleValue = {}) => {
		const initial = scheduleValue?.schedule || scheduleValue || {};
		return {
			enabled: initial.enabled === true,
			timezone: initial.timezone || 'Asia/Ho_Chi_Minh',
			scheduleType: ['daily', 'interval'].includes(initial.scheduleType)
				? initial.scheduleType
				: 'daily',
			dailyTime: initial.daily?.times?.[0] || initial.dailyTime || initial.time || '06:30',
			intervalValue: Number(initial.interval?.value ?? 24),
			intervalUnit: ['minutes', 'hours', 'days'].includes(initial.interval?.unit)
				? initial.interval.unit
				: 'hours',
			mode: CONTENT_SCHEDULE_MODES.includes(initial.mode) ? initial.mode : 'best_action',
			topic: initial.topic || '',
			primaryKeyword: initial.primaryKeyword || '',
			sourceRequirements: Array.isArray(initial.sourceRequirements)
				? initial.sourceRequirements.join(', ')
				: 'content_inventory',
			minimumOpportunityScore: Number(initial.minimumOpportunityScore ?? 0.65),
			allowSkip: initial.allowSkip !== false,
			draftOnly: true,
			maxTasksPerDay: Number(initial.maximumTasksPerDay ?? initial.maxTasksPerDay ?? 1),
			monitoringWindows: Array.isArray(initial.monitoringWindows)
				? initial.monitoringWindows.join(', ')
				: '1d, 7d, 14d, 30d, 90d'
		};
	};
	// The initial prop capture is intentional for SSR; the effect keeps later API refreshes in sync.
	// svelte-ignore state_referenced_locally
	let form = $state(buildForm(schedule));
	$effect(() => {
		Object.assign(form, buildForm(schedule));
	});

	const splitTokens = (value) =>
		String(value || '')
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
	const splitWindows = (value) => [...new Set(splitTokens(value))];
	const save = () => {
		onSave({
			timezone: String(form.timezone || '').trim() || 'Asia/Ho_Chi_Minh',
			scheduleType: form.scheduleType,
			daily: { times: [form.dailyTime] },
			interval: {
				value: Math.min(
					365,
					Math.max(form.intervalUnit === 'minutes' ? 5 : 1, Number(form.intervalValue) || 1)
				),
				unit: form.intervalUnit
			},
			mode: form.mode,
			topic: String(form.topic || '').trim(),
			primaryKeyword: String(form.primaryKeyword || '').trim(),
			sourceRequirements: splitTokens(form.sourceRequirements),
			minimumOpportunityScore: Math.min(1, Math.max(0, Number(form.minimumOpportunityScore) || 0)),
			allowSkip: form.allowSkip,
			draftOnly: true,
			maximumTasksPerDay: Math.min(24, Math.max(1, Number(form.maxTasksPerDay) || 1)),
			monitoringWindows: splitWindows(form.monitoringWindows)
		});
	};
	const toggle = async () => {
		const next = !form.enabled;
		const accepted = await onToggle(next);
		if (accepted !== false) form.enabled = next;
	};
</script>

<section class="co-card" aria-labelledby="co-schedule-title">
	<div class="co-section-head">
		<div>
			<p class="co-kicker">07 / {$t('admin.contentOperations.views.schedule')}</p>
			<h2 id="co-schedule-title">{$t('admin.contentOperations.schedule.title')}</h2>
			<p>{$t('admin.contentOperations.schedule.description')}</p>
		</div>
		<div class="schedule-state">
			<StatusBadge status={form.enabled ? 'running' : 'paused'} />
			<button class="co-button co-button--quiet" type="button" onclick={toggle} disabled={busy}>
				{form.enabled
					? $t('admin.contentOperations.common.disable')
					: $t('admin.contentOperations.common.enable')}
			</button>
		</div>
	</div>

	<form
		onsubmit={(event) => {
			event.preventDefault();
			save();
		}}
	>
		<div class="schedule-grid">
			<label>
				<span>{$t('admin.contentOperations.schedule.fields.scheduleType')}</span>
				<select bind:value={form.scheduleType}>
					<option value="daily">{$t('admin.contentOperations.schedule.scheduleTypes.daily')}</option
					>
					<option value="interval"
						>{$t('admin.contentOperations.schedule.scheduleTypes.interval')}</option
					>
				</select>
			</label>
			<label>
				<span>{$t('admin.contentOperations.schedule.fields.mode')}</span>
				<select bind:value={form.mode}>
					{#each CONTENT_SCHEDULE_MODES as mode (mode)}<option value={mode}
							>{$t(scheduleModeTranslationKey(mode))}</option
						>{/each}
				</select>
				<small>{$t(`admin.contentOperations.schedule.modeHelp.${form.mode}`)}</small>
			</label>
			{#if form.mode === 'fixed_brief'}
				<label>
					<span>{$t('admin.contentOperations.schedule.fields.topic')}</span>
					<input bind:value={form.topic} maxlength="300" required />
				</label>
				<label>
					<span>{$t('admin.contentOperations.schedule.fields.primaryKeyword')}</span>
					<input bind:value={form.primaryKeyword} maxlength="200" />
				</label>
			{/if}
			{#if form.scheduleType === 'daily'}
				<label>
					<span>{$t('admin.contentOperations.schedule.fields.dailyTime')}</span>
					<input type="time" bind:value={form.dailyTime} required />
				</label>
			{:else}
				<label>
					<span>{$t('admin.contentOperations.schedule.fields.intervalValue')}</span>
					<input
						type="number"
						min={form.intervalUnit === 'minutes' ? 5 : 1}
						max="365"
						step="1"
						bind:value={form.intervalValue}
						required
					/>
				</label>
				<label>
					<span>{$t('admin.contentOperations.schedule.fields.intervalUnit')}</span>
					<select bind:value={form.intervalUnit}>
						<option value="minutes"
							>{$t('admin.contentOperations.schedule.intervalUnits.minutes')}</option
						>
						<option value="hours"
							>{$t('admin.contentOperations.schedule.intervalUnits.hours')}</option
						>
						<option value="days">{$t('admin.contentOperations.schedule.intervalUnits.days')}</option
						>
					</select>
				</label>
			{/if}
			<label>
				<span>{$t('admin.contentOperations.schedule.fields.timezone')}</span>
				<input bind:value={form.timezone} maxlength="80" required />
			</label>
			<label>
				<span>{$t('admin.contentOperations.schedule.fields.minimumScore')}</span>
				<input
					type="number"
					min="0"
					max="1"
					step="0.05"
					bind:value={form.minimumOpportunityScore}
				/>
			</label>
			<label>
				<span>{$t('admin.contentOperations.schedule.fields.maxTasks')}</span>
				<input type="number" min="1" max="10" step="1" bind:value={form.maxTasksPerDay} />
			</label>
			<label>
				<span>{$t('admin.contentOperations.schedule.fields.monitoringWindows')}</span>
				<input bind:value={form.monitoringWindows} placeholder="1d, 7d, 14d, 30d, 90d" />
			</label>
			<label class="schedule-wide">
				<span>{$t('admin.contentOperations.schedule.fields.sourceRequirements')}</span>
				<input
					bind:value={form.sourceRequirements}
					placeholder="content_inventory, google_search_console"
				/>
				<small>{$t('admin.contentOperations.schedule.sourceHelp')}</small>
			</label>
		</div>

		<div class="guardrails">
			<label
				><input type="checkbox" bind:checked={form.allowSkip} /><span
					><strong>{$t('admin.contentOperations.schedule.fields.allowSkip')}</strong><small
						>{$t('admin.contentOperations.schedule.allowSkipHelp')}</small
					></span
				></label
			>
			<label
				><input type="checkbox" bind:checked={form.draftOnly} /><span
					><strong>{$t('admin.contentOperations.schedule.fields.draftOnly')}</strong><small
						>{$t('admin.contentOperations.schedule.draftOnlyHelp')}</small
					></span
				></label
			>
		</div>

		<div class="schedule-actions">
			<p>{$t('admin.contentOperations.schedule.saveNotice')}</p>
			<button class="co-button co-button--primary" type="submit" disabled={busy}>
				{busy
					? $t('admin.contentOperations.common.loading')
					: $t('admin.contentOperations.common.save')}
			</button>
		</div>
	</form>
</section>

<style>
	.schedule-state {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.schedule-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
	}
	.schedule-grid label {
		display: grid;
		align-content: start;
		gap: 0.38rem;
		color: var(--admin-muted);
		font-size: 0.68rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.055em;
	}
	.schedule-grid input,
	.schedule-grid select {
		min-height: 40px;
		width: 100%;
		border: 1px solid var(--admin-border);
		border-radius: 9px;
		padding: 0.55rem 0.7rem;
		background: #fff;
		color: var(--admin-ink);
		font: inherit;
		text-transform: none;
		letter-spacing: 0;
	}
	.schedule-grid small {
		color: var(--admin-muted);
		font-size: 0.67rem;
		font-weight: 500;
		line-height: 1.4;
		text-transform: none;
		letter-spacing: 0;
	}
	.schedule-wide {
		grid-column: 1/-1;
	}
	.guardrails {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.7rem;
		margin-top: 0.85rem;
	}
	.guardrails label {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.65rem;
		align-items: start;
		padding: 0.85rem;
		border: 1px solid var(--admin-border);
		border-radius: 10px;
		background: #f8faf9;
	}
	.guardrails input {
		margin-top: 0.15rem;
		accent-color: var(--admin-accent);
	}
	.guardrails span {
		display: grid;
		gap: 0.25rem;
	}
	.guardrails strong {
		font-size: 0.79rem;
	}
	.guardrails small {
		color: var(--admin-muted);
		font-size: 0.7rem;
		line-height: 1.45;
	}
	.schedule-actions {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		margin-top: 0.85rem;
		padding-top: 0.85rem;
		border-top: 1px dashed var(--admin-border);
	}
	.schedule-actions p {
		max-width: 660px;
		margin: 0;
		color: var(--admin-muted);
		font-size: 0.72rem;
		line-height: 1.5;
	}
	@media (max-width: 840px) {
		.schedule-grid {
			grid-template-columns: 1fr 1fr;
		}
		.schedule-wide {
			grid-column: 1/-1;
		}
	}
	@media (max-width: 560px) {
		.schedule-grid,
		.guardrails {
			grid-template-columns: 1fr;
		}
		.schedule-wide {
			grid-column: auto;
		}
		.schedule-actions {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
