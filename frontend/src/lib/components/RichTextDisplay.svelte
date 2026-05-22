<script>
	export let content = '';
</script>

<div class="rich-text-display">
	{@html content}
</div>

<style>
	.rich-text-display {
		font-family: 'Sora', 'Work Sans', system-ui, sans-serif;
		color: #151515;
		line-height: 1.8;
		font-size: 15px;
	}

	:global(.rich-text-display img) {
		width: 100%;
		max-width: 100%;
		height: auto;
		display: block;
		margin: 20px 0;
		border-radius: 12px;
		border: 1px solid #e3e1dc;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	:global(.rich-text-display a) {
		color: #0070c0;
		text-decoration: none;
		transition: color 0.2s ease;
	}

	:global(.rich-text-display a:hover) {
		color: #004b7f;
		text-decoration: underline;
	}

	:global(.rich-text-display p) {
		margin: 12px 0;
	}

	:global(.rich-text-display h1),
	:global(.rich-text-display h2),
	:global(.rich-text-display h3),
	:global(.rich-text-display h4),
	:global(.rich-text-display h5),
	:global(.rich-text-display h6) {
		margin: 16px 0 8px 0;
		font-weight: 600;
	}

	:global(.rich-text-display h1) {
		font-size: 28px;
	}

	:global(.rich-text-display h2) {
		font-size: 24px;
	}

	:global(.rich-text-display h3) {
		font-size: 20px;
	}

	:global(.rich-text-display h4) {
		font-size: 18px;
	}

	:global(.rich-text-display ul),
	:global(.rich-text-display ol) {
		margin: 12px 0 12px 24px;
	}

	:global(.rich-text-display li) {
		margin: 6px 0;
	}

	:global(.rich-text-display blockquote) {
		margin: 16px 0;
		padding-left: 16px;
		border-left: 4px solid #c07a2d;
		color: #6b6b6b;
		font-style: italic;
	}

	:global(.rich-text-display code) {
		background: #f6f2ea;
		padding: 2px 6px;
		border-radius: 4px;
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 13px;
	}

	:global(.rich-text-display pre) {
		background: #f6f2ea;
		padding: 12px;
		border-radius: 8px;
		overflow-x: auto;
		margin: 12px 0;
	}

	:global(.rich-text-display pre code) {
		background: transparent;
		padding: 0;
	}

	:global(.rich-text-display table) {
		width: 100%;
		border-collapse: collapse;
		margin: 16px 0;
	}

	:global(.rich-text-display th),
	:global(.rich-text-display td) {
		border: 1px solid #e3e1dc;
		padding: 12px;
		text-align: left;
	}

	:global(.rich-text-display th) {
		background: #f6f2ea;
		font-weight: 600;
	}

	:global(.rich-text-display hr) {
		border: none;
		border-top: 1px solid #e3e1dc;
		margin: 24px 0;
	}

	:global(.rich-text-display strong) {
		font-weight: 600;
	}

	:global(.rich-text-display em) {
		font-style: italic;
	}
</style>
