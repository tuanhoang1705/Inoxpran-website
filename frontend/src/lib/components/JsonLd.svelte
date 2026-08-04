<script>
	let { value = null } = $props();

	const serialize = (input) => {
		const raw = typeof input === 'string' ? input : JSON.stringify(input ?? {});
		return String(raw)
			.replace(/</g, '\\u003c')
			.replace(/>/g, '\\u003e')
			.replace(/&/g, '\\u0026')
			.replace(/\u2028/g, '\\u2028')
			.replace(/\u2029/g, '\\u2029');
	};

	let content = $derived(serialize(value));
</script>

<svelte:head>
	<svelte:element this={'script'} type="application/ld+json">{content}</svelte:element>
</svelte:head>
