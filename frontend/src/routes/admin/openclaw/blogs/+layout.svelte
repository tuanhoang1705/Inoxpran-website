<script>
	import OpenClawActivityCenter from '$lib/components/admin/openclaw/OpenClawActivityCenter.svelte';

	let { children } = $props();
</script>

{@render children()}
<OpenClawActivityCenter />
