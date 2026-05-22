<script>
	import ShopCatalogView from '$lib/components/ShopCatalogView.svelte';

	let { data: routeData } = $props();
</script>

<ShopCatalogView pageData={routeData} />
