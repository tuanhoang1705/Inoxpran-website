<script>
	/**
	 * Deliberate raw-HTML boundary. Callers may pass only backend-sanitized HTML
	 * or HTML produced by the authenticated rich-text editor itself.
	 */
	let { html = '' } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -->
{@html String(html || '')}
