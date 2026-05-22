<script>
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import { locale, t } from '$lib/i18n/index.js';
	import { SITE_CONTACT } from '$lib/config/siteContact.js';

	const DEFAULT_SITE_URL = 'https://inoxpran.com';
	const FAQ_LAST_REVIEWED = '2026-03-23';
	const normalizeSiteUrl = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return DEFAULT_SITE_URL;
		return raw.replace(/\/+$/, '');
	};
	const escapeJsonLd = (value) =>
		String(value || '')
			.replace(/</g, '\u003c')
			.replace(/>/g, '\u003e')
			.replace(/&/g, '\u0026')
			.replace(/\u2028/g, '\u2028')
			.replace(/\u2029/g, '\u2029');

	const FAQ_ENTRIES = {
		vi: [
			{
				question: 'Thời gian giao hàng của Inoxpran thường mất bao lâu?',
				answer:
					'Đơn xác nhận trước 15:00 thường được xử lý trong ngày. Nội thành các thành phố lớn thường mất khoảng 1-3 ngày làm việc, còn tuyến tỉnh hoặc liên tỉnh thường mất khoảng 2-5 ngày làm việc.'
			},
			{
				question: 'Tôi có được kiểm tra hàng khi nhận không?',
				answer:
					'Anh/chị nên kiểm tra tình trạng kiện hàng, model và số lượng trước khi ký nhận. Nếu thấy móp méo, vỡ hoặc thiếu hàng, hãy phản hồi ngay với shipper và liên hệ Inoxpran để được hỗ trợ nhanh.'
			},
			{
				question: 'Sản phẩm lỗi kỹ thuật thì đổi trả trong bao lâu?',
				answer:
					'Inoxpran hỗ trợ đổi trả với lỗi kỹ thuật do nhà sản xuất trong vòng 7 ngày kể từ khi nhận hàng, khi sản phẩm được sử dụng đúng hướng dẫn và còn đủ điều kiện kiểm tra.'
			},
			{
				question: 'Nồi chảo inox nên vệ sinh thế nào để bền hơn?',
				answer:
					'Nên để sản phẩm nguội bớt trước khi rửa, dùng miếng mềm và chất tẩy rửa nhẹ. Tránh sốc nhiệt mạnh, tránh búi sắt hoặc hóa chất quá mạnh nếu không có hướng dẫn phù hợp cho từng dòng sản phẩm.'
			},
			{
				question: 'Tôi chưa biết chọn mã nào phù hợp, Inoxpran có hỗ trợ tư vấn không?',
				answer:
					'Có. Anh/chị có thể chat ngay trên website hoặc liên hệ hotline để đội ngũ Inoxpran tư vấn theo nhu cầu nấu ăn, loại bếp đang dùng, số người trong gia đình và ngân sách dự kiến.'
			}
		],
		en: [
			{
				question: 'How long does Inoxpran delivery usually take?',
				answer:
					'Orders confirmed before 3:00 PM are usually processed on the same business day. Major city deliveries typically take 1-3 business days, while provincial routes usually take around 2-5 business days.'
			},
			{
				question: 'Can I inspect the parcel before accepting it?',
				answer:
					'Yes. We recommend checking the parcel condition, model and quantity before signing. If you notice dents, breakage or missing items, please report it to the courier immediately and contact Inoxpran.'
			},
			{
				question: 'How long is the return window for technical defects?',
				answer:
					'Inoxpran supports returns for manufacturer technical defects within 7 days of delivery, provided the product has been used according to instructions and still meets inspection conditions.'
			},
			{
				question: 'How should I clean stainless cookware to keep it in good condition?',
				answer:
					'Let the cookware cool down before washing, then use a soft sponge and mild cleaner. Avoid thermal shock, metal scrubbers or harsh chemicals unless the specific product guide says otherwise.'
			},
			{
				question: 'Can Inoxpran help me choose the right model?',
				answer:
					'Yes. You can chat directly on the website or contact our support team for guidance based on your cooking needs, cooktop type, family size and budget.'
			}
		]
	};

	const currentLocale = $derived($locale === 'en' ? 'en' : 'vi');
	const siteUrl = $derived(normalizeSiteUrl(env.PUBLIC_SITE_URL));
	const canonicalUrl = $derived(`${siteUrl}${$page.url?.pathname || '/faq'}`);
	const ogImageUrl = $derived(`${siteUrl}/og-image.png`);
	const ogImageAlt = $derived(`${$t('faq.title')} | Inoxpran`);
	const faqEntries = $derived(FAQ_ENTRIES[currentLocale] || FAQ_ENTRIES.vi);
	const faqBreadcrumbId = $derived(`${canonicalUrl}#breadcrumb`);
	const faqBreadcrumbJsonLd = $derived.by(() =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			'@id': faqBreadcrumbId,
			itemListElement: [
				{
					'@type': 'ListItem',
					position: 1,
					name: currentLocale === 'en' ? 'Home' : 'Trang chủ',
					item: `${siteUrl}${currentLocale === 'en' ? '/en' : ''}`
				},
				{
					'@type': 'ListItem',
					position: 2,
					name: $t('faq.title'),
					item: canonicalUrl
				}
			]
		})
	);
	const faqWebPageJsonLd = $derived.by(() =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'WebPage',
			'@id': canonicalUrl,
			url: canonicalUrl,
			name: `${$t('faq.title')} | Inoxpran`,
			description: $t('faq.lede'),
			dateModified: FAQ_LAST_REVIEWED,
			breadcrumb: { '@id': faqBreadcrumbId },
			primaryImageOfPage: { '@type': 'ImageObject', url: ogImageUrl },
			mainEntity: { '@id': `${canonicalUrl}#faq` },
			isPartOf: { '@type': 'WebSite', '@id': `${siteUrl}/#website` },
			inLanguage: currentLocale === 'en' ? 'en-US' : 'vi-VN'
		})
	);
	const faqPageJsonLd = $derived.by(() =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'FAQPage',
			'@id': `${canonicalUrl}#faq`,
			url: canonicalUrl,
			name: `${$t('faq.title')} | Inoxpran`,
			description: $t('faq.lede'),
			dateModified: FAQ_LAST_REVIEWED,
			breadcrumb: { '@id': faqBreadcrumbId },
			mainEntityOfPage: { '@id': canonicalUrl },
			mainEntity: faqEntries.map((entry, index) => ({
				'@type': 'Question',
				'@id': `${canonicalUrl}#faq-q-${index + 1}`,
				url: `${canonicalUrl}#faq-q-${index + 1}`,
				name: entry.question,
				acceptedAnswer: {
					'@type': 'Answer',
					text: entry.answer
				}
			})),
			inLanguage: currentLocale === 'en' ? 'en-US' : 'vi-VN'
		})
	);
	const supportPhoneHref = $derived(`tel:${SITE_CONTACT.phone.replace(/[^\d+]/g, '')}`);
	const supportEmailHref = $derived(`mailto:${SITE_CONTACT.email}`);
</script>

<svelte:head>
	<title>{$t('faq.title')} | Inoxpran</title>
	<meta name="description" content={$t('faq.lede')} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:title" content={`${$t('faq.title')} | Inoxpran`} />
	<meta property="og:description" content={$t('faq.lede')} />
	<meta property="og:image" content={ogImageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={ogImageAlt} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={`${$t('faq.title')} | Inoxpran`} />
	<meta name="twitter:description" content={$t('faq.lede')} />
	<meta name="twitter:image" content={ogImageUrl} />
	<meta name="twitter:image:alt" content={ogImageAlt} />
	{@html '<script type="application/ld+json">' + escapeJsonLd(faqBreadcrumbJsonLd) + '</script>'}
	{@html '<script type="application/ld+json">' + escapeJsonLd(faqWebPageJsonLd) + '</script>'}
	{@html '<script type="application/ld+json">' + escapeJsonLd(faqPageJsonLd) + '</script>'}
</svelte:head>

<section class="faq-page padding-large">
	<div class="container faq-page__layout">
		<header class="faq-page__hero">
			<p class="faq-page__eyebrow">{$t('faq.title')}</p>
			<h1 class="section-title">{$t('faq.heading')}</h1>
			<p class="faq-page__lede">{$t('faq.lede')}</p>
		</header>

		<div class="faq-page__grid">
			<div class="faq-page__list">
				{#each faqEntries as entry, index}
					<details class="faq-item" id={`faq-q-${index + 1}`} open={index === 0}>
						<summary>{entry.question}</summary>
						<p>{entry.answer}</p>
					</details>
				{/each}
			</div>

			<aside class="faq-page__support">
				<h2>{currentLocale === 'en' ? 'Need direct support?' : 'Cần hỗ trợ thêm?'}</h2>
				<p>
					{currentLocale === 'en'
						? 'Send us your order code and product model so the support team can check the case faster.'
						: 'Anh/chị gửi kèm mã đơn hàng và model sản phẩm để đội ngũ hỗ trợ kiểm tra nhanh hơn.'}
				</p>
				<div class="faq-page__contact-card">
					<span>Hotline</span>
					<a href={supportPhoneHref}>{SITE_CONTACT.phone}</a>
				</div>
				<div class="faq-page__contact-card">
					<span>Email</span>
					<a href={supportEmailHref}>{SITE_CONTACT.email}</a>
				</div>
			</aside>
		</div>
	</div>
</section>

<style>
	.faq-page__layout {
		display: grid;
		gap: 2rem;
	}

	.faq-page__hero {
		max-width: 720px;
	}

	.faq-page__eyebrow {
		margin: 0 0 0.5rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #0a8aa1;
	}

	.faq-page__lede {
		max-width: 760px;
		color: rgba(17, 24, 39, 0.76);
	}

	.faq-page__grid {
		display: grid;
		grid-template-columns: minmax(0, 1.65fr) minmax(280px, 0.85fr);
		gap: 1.5rem;
		align-items: start;
	}

	.faq-page__list {
		display: grid;
		gap: 0.875rem;
	}

	.faq-item {
		padding: 1rem 1.1rem;
		border: 1px solid rgba(15, 118, 110, 0.12);
		border-radius: 1rem;
		background: #fff;
		box-shadow: 0 18px 45px rgba(15, 23, 42, 0.06);
	}

	.faq-item summary {
		cursor: pointer;
		font-weight: 700;
		color: #0f172a;
	}

	.faq-item p {
		margin: 0.9rem 0 0;
		line-height: 1.75;
		color: rgba(15, 23, 42, 0.78);
	}

	.faq-page__support {
		padding: 1.25rem;
		border-radius: 1.25rem;
		background: linear-gradient(180deg, rgba(7, 89, 133, 0.06), rgba(13, 148, 136, 0.1));
		border: 1px solid rgba(15, 118, 110, 0.12);
		box-shadow: 0 18px 45px rgba(15, 23, 42, 0.06);
	}

	.faq-page__support h2 {
		margin: 0 0 0.65rem;
		font-size: 1.1rem;
	}

	.faq-page__support p {
		margin: 0 0 1rem;
		line-height: 1.7;
		color: rgba(15, 23, 42, 0.76);
	}

	.faq-page__contact-card {
		display: grid;
		gap: 0.25rem;
		padding: 0.85rem 0;
		border-top: 1px solid rgba(15, 118, 110, 0.12);
	}

	.faq-page__contact-card:first-of-type {
		border-top: none;
		padding-top: 0;
	}

	.faq-page__contact-card span {
		font-size: 0.82rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgba(15, 23, 42, 0.58);
	}

	.faq-page__contact-card a {
		font-weight: 700;
		color: #0f172a;
		text-decoration: none;
	}

	.faq-page__contact-card a:hover {
		color: #0a8aa1;
	}

	@media (max-width: 960px) {
		.faq-page__grid {
			grid-template-columns: 1fr;
		}
	}
</style>
