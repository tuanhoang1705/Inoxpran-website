<script>
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import { t } from '$lib/i18n/index.js';

	export let params;

	const DEFAULT_SITE_URL = 'https://inoxpran.com';
	const normalizeSiteUrl = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return DEFAULT_SITE_URL;
		return raw.replace(/\/+$/, '');
	};
	const siteUrl = normalizeSiteUrl(env.PUBLIC_SITE_URL);
	const formatCategoryName = (slug) =>
		String(slug || '')
			.replace(/-/g, ' ')
			.trim();
	const truncateMeta = (value, limit = 160) => {
		const text = String(value || '').trim();
		if (!text) return '';
		if (text.length <= limit) return text;
		return `${text.slice(0, limit - 3).trim()}...`;
	};
	$: slugValue = params?.slug ?? $page.params?.slug ?? '';
	$: seoTitle = $t('categoriesPage.headTitle', { slug: slugValue });
	$: seoDescription = truncateMeta($t('categoriesPage.description'));
	$: ogImageUrl = `${siteUrl}/og-image.png`;
	$: ogUrl = `${siteUrl}${$page.url?.pathname || '/categories'}${$page.url?.search || ''}`;
	const buildCategoryBreadcrumbJsonLd = (slug) =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			itemListElement: [
				{
					'@type': 'ListItem',
					position: 1,
					name: 'Inoxpran',
					item: `${siteUrl}/`
				},
				{
					'@type': 'ListItem',
					position: 2,
					name: 'Products',
					item: `${siteUrl}/shop`
				},
				{
					'@type': 'ListItem',
					position: 3,
					name: formatCategoryName(slug) || 'Category',
					item: `${siteUrl}/categories/${encodeURIComponent(String(slug || ''))}`
				}
			]
		});
</script>

<svelte:head>
	<title>{seoTitle}</title>
	<meta name="description" content={seoDescription} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={ogUrl} />
	<meta property="og:title" content={seoTitle} />
	<meta property="og:description" content={seoDescription} />
	<meta property="og:image" content={ogImageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={seoTitle} />
	<meta name="twitter:description" content={seoDescription} />
	<meta name="twitter:image" content={ogImageUrl} />
	{@html `<script type="application/ld+json">${buildCategoryBreadcrumbJsonLd(slugValue)}</script>`}
</svelte:head>

<section class="padding-large">
	<div class="container">
		<p class="mb-2 text-uppercase small">{$t('categoriesPage.eyebrow')}</p>
		<h1 class="section-title">{slugValue}</h1>
		<p class="mb-4">{$t('categoriesPage.description')}</p>
		<div class="text-center">
			<p>{$t('categoriesPage.hint')}</p>
		</div>
	</div>
</section>
