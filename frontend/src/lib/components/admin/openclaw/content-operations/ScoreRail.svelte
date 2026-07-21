<script>
	import { scorePercent } from '$lib/contentOperations/contracts.js';

	let { value = null, compact = false } = $props();
	const percent = $derived(scorePercent(value));
</script>

<div class:compact class="score" aria-label={percent === null ? '—' : `${percent}%`}>
	<div class="score__track">
		<span style={`width:${percent ?? 0}%`}></span>
	</div>
	<strong>{percent === null ? '—' : `${percent}%`}</strong>
</div>

<style>
	.score {
		display: grid;
		grid-template-columns: minmax(70px, 1fr) auto;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}

	.score__track {
		height: 0.46rem;
		border-radius: 999px;
		background: #e7ecea;
		overflow: hidden;
	}

	.score__track span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, var(--admin-accent), #42a793);
		transition: width 0.28s ease;
	}

	.score strong {
		font:
			800 0.77rem/1 ui-monospace,
			'Cascadia Mono',
			monospace;
		color: var(--admin-ink);
	}

	.score.compact {
		grid-template-columns: minmax(55px, 90px) auto;
	}
</style>
