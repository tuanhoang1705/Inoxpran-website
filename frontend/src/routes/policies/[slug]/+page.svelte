<script>
	import { env } from '$env/dynamic/public';
	import { page } from '$app/stores';
	import { SITE_CONTACT } from '$lib/config/siteContact.js';
	import { getPolicyContactLinks, getPolicyPath, listPolicyDetails } from '$lib/content/policies.js';

	let { data } = $props();
	const policy = $derived(data?.policy ?? null);
	const currentLocale = $derived($page.url?.pathname?.startsWith('/en') ? 'en' : 'vi');
	const siteUrl = $derived(String(env.PUBLIC_SITE_URL || 'https://inoxpran.com').trim().replace(/\/+$/, '') || 'https://inoxpran.com');
	const canonicalUrl = $derived(String(data?.canonicalUrl || '').trim() || `${siteUrl}${$page.url.pathname}`);
	const ogImageUrl = $derived(`${siteUrl}/og-image.png`);
	const ogImageAlt = $derived(policy?.title || 'Inoxpran policies');
	const allPoliciesHref = $derived(currentLocale === 'en' ? '/en/policies' : '/policies');
	const relatedPolicies = $derived(
		listPolicyDetails(currentLocale)
			.filter((item) => item.slug !== policy?.slug)
			.map((item) => ({ ...item, href: getPolicyPath(item.slug, currentLocale) }))
	);
	const { phoneHref, emailHref } = getPolicyContactLinks();
	const escapeJsonLd = (value) =>
		String(value || '')
			.replace(/</g, '\u003c')
			.replace(/>/g, '\u003e')
			.replace(/&/g, '\u0026')
			.replace(/\u2028/g, '\u2028')
			.replace(/\u2029/g, '\u2029');
	const breadcrumbId = $derived(`${canonicalUrl}#breadcrumb`);
	const breadcrumbJsonLd = $derived.by(() =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			'@id': breadcrumbId,
			itemListElement: [
				{ '@type': 'ListItem', position: 1, name: currentLocale === 'en' ? 'Home' : 'Trang chủ', item: `${siteUrl}${currentLocale === 'en' ? '/en' : ''}` },
				{ '@type': 'ListItem', position: 2, name: currentLocale === 'en' ? 'Policies' : 'Chính sách', item: `${siteUrl}${allPoliciesHref}` },
				{ '@type': 'ListItem', position: 3, name: policy?.title || 'Policy', item: canonicalUrl }
			]
		})
	);
	const policyPageJsonLd = $derived.by(() =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'WebPage',
			'@id': canonicalUrl,
			url: canonicalUrl,
			name: `${policy?.title || 'Policy'} | Inoxpran`,
			description: policy?.metaDescription || policy?.summary || '',
			dateModified: policy?.updatedAtIso || undefined,
			breadcrumb: { '@id': breadcrumbId },
			isPartOf: { '@type': 'WebSite', '@id': `${siteUrl}/#website` },
			about: { '@type': 'Organization', '@id': `${siteUrl}/#organization`, name: 'Inoxpran' },
			inLanguage: currentLocale === 'en' ? 'en-US' : 'vi-VN'
		})
	);
</script>

<svelte:head>
	<title>{policy ? `${policy.title} | Inoxpran` : 'Inoxpran'}</title>
	<meta name="description" content={policy?.metaDescription || policy?.summary || ''} />
	<meta property="og:type" content="article" />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:title" content={policy ? `${policy.title} | Inoxpran` : 'Inoxpran'} />
	<meta property="og:description" content={policy?.metaDescription || policy?.summary || ''} />
	<meta property="og:image" content={ogImageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={ogImageAlt} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={policy ? `${policy.title} | Inoxpran` : 'Inoxpran'} />
	<meta name="twitter:description" content={policy?.metaDescription || policy?.summary || ''} />
	<meta name="twitter:image" content={ogImageUrl} />
	<meta name="twitter:image:alt" content={ogImageAlt} />
	{@html '<script type="application/ld+json">' + escapeJsonLd(breadcrumbJsonLd) + '</script>'}
	{@html '<script type="application/ld+json">' + escapeJsonLd(policyPageJsonLd) + '</script>'}
</svelte:head>

{#if policy}
	<section class="policy-detail-shell padding-large">
		<div class="container policy-detail-layout">
			<nav class="policy-detail-breadcrumb" aria-label={currentLocale === 'en' ? 'Breadcrumb' : 'Điều hướng trang'}>
				<a href={currentLocale === 'en' ? '/en' : '/'}>{currentLocale === 'en' ? 'Home' : 'Trang chủ'}</a>
				<span>/</span>
				<a href={allPoliciesHref}>{currentLocale === 'en' ? 'Policies' : 'Chính sách'}</a>
				<span>/</span>
				<span>{policy.title}</span>
			</nav>

			<header class="policy-detail-hero">
				<div>
					<p class="policy-detail-kicker">{policy.kicker}</p>
					<h1>{policy.title}</h1>
					<p class="policy-detail-summary">{policy.summary}</p>
				</div>
				<div class="policy-detail-meta">
					<span>{policy.updatedAtLabel}</span>
					<strong>{policy.updatedAtText}</strong>
				</div>
			</header>

			<div class="policy-detail-grid">
				<div class="policy-detail-main">
					{#each policy.sections as section}
						<section class="policy-detail-card">
							<h2>{section.title}</h2>
							<ul>
								{#each section.items as item}
									<li>{item}</li>
								{/each}
							</ul>
						</section>
					{/each}
				</div>

				<aside class="policy-detail-aside">
					<section class="policy-detail-card policy-detail-card--contact">
						<h2>{currentLocale === 'en' ? 'Need direct support?' : 'Cần hỗ trợ trực tiếp?'}</h2>
						<p>
							{currentLocale === 'en'
								? 'Please include your order code and product model so the support team can review your case faster.'
								: 'Anh/chị nên gửi kèm mã đơn hàng và model sản phẩm để đội ngũ hỗ trợ kiểm tra nhanh hơn.'}
						</p>
						<a href={phoneHref}><span>{currentLocale === 'en' ? 'Hotline' : 'Hotline'}</span><strong>{SITE_CONTACT.phone}</strong></a>
						<a href={emailHref}><span>Email</span><strong>{SITE_CONTACT.email}</strong></a>
					</section>

					<section class="policy-detail-card">
						<h2>{currentLocale === 'en' ? 'Other policies' : 'Chính sách liên quan'}</h2>
						<nav class="policy-detail-links">
							{#each relatedPolicies as item}
								<a href={item.href}>{item.shortTitle}</a>
							{/each}
						</nav>
					</section>
				</aside>
			</div>
		</div>
	</section>
{/if}

<style>
	.policy-detail-shell {
		background: linear-gradient(180deg, #f7f1e8 0%, #fffdfa 42%, #ffffff 100%);
	}
	.policy-detail-layout {
		display: grid;
		gap: 1.5rem;
	}
	.policy-detail-breadcrumb {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		font-size: 0.92rem;
		color: rgba(15, 23, 42, 0.62);
	}
	.policy-detail-breadcrumb a { color: #0a8aa1; text-decoration: none; }
	.policy-detail-breadcrumb a:hover { text-decoration: underline; }
	.policy-detail-hero {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 1.5rem;
		padding: 1.75rem;
		border-radius: 1.5rem;
		background: #ffffff;
		border: 1px solid rgba(15, 118, 110, 0.12);
		box-shadow: 0 22px 50px rgba(15, 23, 42, 0.07);
	}
	.policy-detail-kicker {
		margin: 0 0 0.6rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #0a8aa1;
	}
	.policy-detail-hero h1 { margin: 0 0 0.85rem; }
	.policy-detail-summary { margin: 0; max-width: 760px; line-height: 1.8; color: rgba(15, 23, 42, 0.76); }
	.policy-detail-meta {
		display: grid;
		align-content: start;
		gap: 0.3rem;
		min-width: 180px;
		padding: 1rem 1.1rem;
		border-radius: 1rem;
		background: rgba(10, 138, 161, 0.06);
		border: 1px solid rgba(10, 138, 161, 0.14);
	}
	.policy-detail-meta span { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(15, 23, 42, 0.58); }
	.policy-detail-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.9fr); gap: 1.25rem; align-items: start; }
	.policy-detail-main, .policy-detail-aside { display: grid; gap: 1rem; }
	.policy-detail-card {
		padding: 1.3rem 1.35rem;
		border-radius: 1.2rem;
		background: #fff;
		border: 1px solid rgba(15, 118, 110, 0.1);
		box-shadow: 0 18px 45px rgba(15, 23, 42, 0.06);
	}
	.policy-detail-card h2 { margin: 0 0 0.9rem; font-size: 1.05rem; }
	.policy-detail-card ul { margin: 0; padding-left: 1.2rem; display: grid; gap: 0.65rem; }
	.policy-detail-card li { line-height: 1.75; color: rgba(15, 23, 42, 0.78); }
	.policy-detail-card--contact p { margin: 0 0 1rem; line-height: 1.7; color: rgba(15, 23, 42, 0.75); }
	.policy-detail-card--contact a {
		display: grid;
		gap: 0.15rem;
		padding: 0.8rem 0;
		text-decoration: none;
		border-top: 1px solid rgba(15, 118, 110, 0.12);
		color: #0f172a;
	}
	.policy-detail-card--contact a:first-of-type { border-top: none; padding-top: 0; }
	.policy-detail-card--contact span { font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(15, 23, 42, 0.58); }
	.policy-detail-card--contact strong { font-size: 1rem; }
	.policy-detail-links { display: grid; gap: 0.65rem; }
	.policy-detail-links a {
		padding: 0.9rem 1rem;
		border-radius: 0.95rem;
		background: rgba(10, 138, 161, 0.05);
		border: 1px solid rgba(10, 138, 161, 0.12);
		text-decoration: none;
		color: #0f172a;
		font-weight: 600;
	}
	.policy-detail-links a:hover { border-color: rgba(10, 138, 161, 0.28); color: #0a8aa1; }
	@media (max-width: 960px) {
		.policy-detail-hero, .policy-detail-grid { grid-template-columns: 1fr; }
	}
</style>
