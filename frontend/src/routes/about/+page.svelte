<script>
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import { t } from '$lib/i18n/index.js';
	import { localizeInternalHref } from '$lib/utils/localePath.js';
	import { onMount } from 'svelte';

	const DEFAULT_SITE_URL = 'https://inoxpran.com';
	const normalizeSiteUrl = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return DEFAULT_SITE_URL;
		return raw.replace(/\/+$/, '');
	};
	const truncateMeta = (value, limit = 160) => {
		const text = String(value || '').trim();
		if (!text) return '';
		if (text.length <= limit) return text;
		return `${text.slice(0, limit - 3).trim()}...`;
	};
	const escapeJsonLd = (value) =>
		String(value || '')
			.replace(/</g, '\\u003c')
			.replace(/>/g, '\\u003e')
			.replace(/&/g, '\\u0026')
			.replace(/\u2028/g, '\\u2028')
			.replace(/\u2029/g, '\\u2029');

	let visibleItems = $state(new Set());

	const siteUrl = $derived(normalizeSiteUrl(env.PUBLIC_SITE_URL));
	const currentLocale = $derived($page.data?.locale === 'en' ? 'en' : 'vi');
	const isEnglish = $derived(currentLocale === 'en');
	const ogImageUrl = $derived(`${siteUrl}/og-image.png`);
	const seoTitle = $derived($t('about.seoTitle'));
	const seoDescription = $derived(truncateMeta($t('about.seoDescription')));
	const ogUrl = $derived.by(
		() => `${siteUrl}${$page.url?.pathname || '/about'}${$page.url?.search || ''}`
	);
	const aboutPageJsonLd = $derived.by(() =>
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'AboutPage',
			'@id': `${siteUrl}/#about-page`,
			name: seoTitle,
			url: `${siteUrl}${$page.url?.pathname || '/about'}`,
			description: seoDescription,
			inLanguage: $page.data?.locale === 'en' ? 'en-US' : 'vi-VN',
			isPartOf: {
				'@id': `${siteUrl}/#website`
			},
			about: {
				'@id': `${siteUrl}/#organization`
			},
			primaryImageOfPage: {
				'@type': 'ImageObject',
				url: ogImageUrl
			}
		})
	);

	const timelineItems = [
		{
			id: 'founding',
			year: '1954 - 1965',
			period: 'Giai đoạn thiết lập nền tảng',
			periodEn: 'Foundation Period',
			image: 'https://upload.wikimedia.org/wikipedia/commons/6/62/Vista_di_Lumezzane.jpg',
			imageAspect: '5 / 4',
			imagePosition: 'center center',
			imagePositionMobile: 'center center',
			highlights: [
				'Năm 1954: Doanh nghiệp được sáng lập bởi ông Giovanni Prandelli tại Lumezzane (Brescia)',
				'Sản xuất dao kéo và dụng cụ bàn ăn bằng vật liệu alpacca mạ bạc',
				'Năm 1965: Chính thức đổi tên thành Inoxpran - chuyển sang sản xuất thép không gỉ'
			],
			highlightsEn: [
				'Founded by Giovanni Prandelli in Lumezzane (Brescia)',
				'Produced cutlery and silverware tools using alpacca',
				'Rebranded to Inoxpran - transition to stainless steel production'
			]
		},
		{
			id: 'expansion',
			year: '1972 - 1982',
			period: 'Giai đoạn mở rộng quy mô công nghiệp',
			periodEn: 'Industrial Expansion',
			image:
				'https://commons.wikimedia.org/wiki/Special:Redirect/file/Chiesa_di_Sant%27Antonino_Martire_(Concesio).jpg',
			imageAspect: '4 / 5',
			imagePosition: 'center 28%',
			imagePositionMobile: 'center 24%',
			highlights: [
				'Năm 1972: Khánh thành nhà máy tại Concesio với diện tích 11.000 m²',
				'Tháng 04/1974: Chuyển đổi mô hình quản trị thành Công ty Cổ phần (S.p.A.)',
				'Năm 1982: Lập trung tâm điều hành tại Bovezzo - tổng diện tích nhà xưởng 40.000 m²'
			],
			highlightsEn: [
				'Opened production facility in Concesio (11,000 m²)',
				'Became a joint-stock company (S.p.A.)',
				'Established headquarters in Bovezzo with 40,000 m² total manufacturing space'
			]
		},
		{
			id: 'international',
			year: '1979 - 1981',
			period: 'Xác lập vị thế quốc tế',
			periodEn: 'International Recognition',
			image: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Battaglin.jpg',
			imageAspect: '4 / 5',
			imagePosition: 'center 18%',
			imagePositionMobile: 'center 15%',
			highlights: [
				'Năm 1979: Thành lập đội đua xe đạp chuyên nghiệp Gruppo Sportivo Inoxpran',
				"Năm 1981: Tài trợ vận động viên giành chiến thắng tại Giro d'Italia và Vuelta a España",
				'Xác lập danh hiệu thương hiệu quốc tế'
			],
			highlightsEn: [
				'Founded professional cycling team Gruppo Sportivo Inoxpran',
				"Sponsored cyclists won both Giro d'Italia and Vuelta a España",
				'Established international brand recognition'
			]
		},
		{
			id: 'restructure',
			year: '2015 - Nay',
			period: 'Tái cấu trúc và gia nhập tập đoàn',
			periodEn: 'Group Integration & Growth',
			image: 'https://www.pengogroup.com/img/pUpload/img_focus5.jpg',
			imageAspect: '16 / 10',
			imagePosition: 'center center',
			imagePositionMobile: 'center center',
			highlights: [
				'Năm 2015: Gia nhập danh mục thương hiệu chiến lược của Pengo S.p.A.',
				'Tái định vị phục vụ thị trường đại chúng cao cấp',
				'Mở rộng đến Pháp, Tây Ban Nha, Đông Nam Á'
			],
			highlightsEn: [
				'Joined Pengo S.p.A. group (established 1953)',
				'Repositioned for premium mass-market',
				'Expanded to France, Spain, and Southeast Asia'
			]
		},
		{
			id: 'vietnam',
			year: '2026',
			period: 'Phát triển tại thị trường Việt Nam',
			periodEn: 'Vietnam Market Development',
			image:
				'https://firebasestorage.googleapis.com/v0/b/her-ai-a4653.appspot.com/o/users%2Fz7612268791195_2faa614cdff937471335a0358f2d521f.jpg?alt=media&token=ae3690d1-e350-4504-8b7b-6db9b084d943',
			imageAspect: '4 / 5',
			imagePosition: 'center 38%',
			imagePositionMobile: 'center 34%',
			highlights: [
				'Lộ trình phủ sóng 63 tỉnh thành với 500 điểm bán',
				'Sản phẩm phân khúc "Practical Mid-premium" - cao cấp thực dụng',
				'Chuẩn chất liệu Inox 304 châu Âu & công nghệ đáy đa lớp (3-5 lớp)',
				'Bốn dòng sản phẩm: Nấu nướng, Phục vụ, Chuẩn bị, Bảo quản'
			],
			highlightsEn: [
				'Strategy to cover 63 provinces with 500 distribution points',
				'Premium practical product segment - EU standard 304 stainless steel',
				'Multi-layer bottom technology (3-5 layers)',
				'Four product lines: Cooking, Serving, Preparing, Conserving'
			]
		}
	];

	const aboutContent = $derived(
		isEnglish
			? {
					eyebrow: 'About us',
					heroTitle: 'The history and growth of the Inoxpran brand',
					heroSubtitle:
						'Inoxpran began in the Brescia region of Italy, a European center for metallurgy and manufacturing. Over nearly 70 years, the brand grew from a local workshop into an international cookware name.',
					ctaTitle: 'Vietnam market development strategy',
					ctaText:
						'Inoxpran aims to bring practical European-standard cookware to Vietnamese families through a planned nationwide distribution network.',
					ctaLabel: 'Explore products',
					valuesTitle: 'Philosophy & commitments',
					valuesSubtitle:
						'The core values that guide our product decisions, materials and everyday customer experience.',
					values: [
						{
							title: 'Enduring quality',
							text: 'European-standard 304 stainless steel and multi-layer base technology are selected for long-term durability.'
						},
						{
							title: 'Practical design',
							text: 'Simple, efficient details are designed around real cooking needs and daily kitchen routines.'
						},
						{
							title: 'Trusted heritage',
							text: 'More than 70 years of experience from Italy to international markets, with products built for lasting trust.'
						}
					]
				}
			: {
					eyebrow: 'Về chúng tôi',
					heroTitle: 'Lịch Sử Hình Thành & Phát Triển Thương Hiệu',
					heroSubtitle:
						'Inoxpran có nguồn gốc từ vùng Brescia, Italy, trung tâm công nghiệp luyện kim của châu Âu. Hành trình gần 70 năm phát triển từ một xưởng nhỏ thành thương hiệu quốc tế hàng đầu.',
					ctaTitle: 'Chiến Lược Phát Triển Tại Việt Nam',
					ctaText:
						'Inoxpran cam kết mang những sản phẩm cao cấp châu Âu đến với mọi gia đình Việt Nam thông qua mạng lưới 500 điểm bán trên 63 tỉnh thành.',
					ctaLabel: 'Khám Phá Sản Phẩm',
					valuesTitle: 'Triết Lý & Cam Kết',
					valuesSubtitle:
						'Những giá trị cốt lõi hướng dẫn mọi tính toán, quyết định, và sản phẩm của chúng tôi',
					values: [
						{
							title: 'Chất Lượng Vô Tỷ',
							text: 'Vật liệu Inox 304 chuẩn châu Âu với công nghệ đáy từ 3-5 lớp - đảm bảo độ bền vĩnh viễn'
						},
						{
							title: 'Thiết Kế Tối Ưu',
							text: 'Đơn giản, hiệu năng cao - mỗi chi tiết được thiết kế để phục vụ nhu cầu thực tế'
						},
						{
							title: 'Uy Tín Lâu Năm',
							text: 'Hơn 70 năm kinh nghiệm, từ Ý cho đến thế giới - thương hiệu được tin tưởng của hàng triệu gia đình'
						}
					]
				}
	);

	onMount(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						visibleItems.add(entry.target.id);
						visibleItems = visibleItems;
					}
				});
			},
			{ threshold: 0.15 }
		);

		document.querySelectorAll('.timeline-item').forEach((el) => {
			observer.observe(el);
		});

		return () => {
			observer.disconnect();
		};
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
	{@html `<script type="application/ld+json">${escapeJsonLd(aboutPageJsonLd)}</script>`}
</svelte:head>

<!-- Hero Section -->
<section class="about-hero padding-xlarge">
	<div class="container">
		<div class="hero-content">
			<div class="hero-eyebrow">
				<span class="eyebrow-label">{aboutContent.eyebrow}</span>
			</div>
			<h1 class="hero-title">{aboutContent.heroTitle}</h1>
			<p class="hero-subtitle">{aboutContent.heroSubtitle}</p>
		</div>
	</div>
</section>

<!-- Timeline Section -->
<section class="about-timeline padding-xlarge">
	<div class="container">
		<div class="timeline-container">
			{#each timelineItems as item, index (item.id)}
				<div
					id={item.id}
					class="timeline-item"
					class:visible={visibleItems.has(item.id)}
					style={`--item-index: ${index}; --timeline-image-aspect: ${item.imageAspect || '5 / 4'}; --timeline-image-position: ${item.imagePosition || 'center center'}; --timeline-image-position-mobile: ${item.imagePositionMobile || item.imagePosition || 'center center'};`}
				>
					<div class="timeline-marker">
						<div class="marker-dot"></div>
						<div class="marker-line"></div>
					</div>

					<div class="timeline-content">
						<div class="content-header">
							<div class="year-badge">{item.year}</div>
							<h2 class="period-title">{isEnglish ? item.periodEn : item.period}</h2>
						</div>

						<ul class="highlights-list">
							{#each isEnglish ? item.highlightsEn : item.highlights as highlight}
								<li class="highlight-item">
									<div class="highlight-icon"></div>
									<span>{highlight}</span>
								</li>
							{/each}
						</ul>
					</div>

					<div class="timeline-image">
						<img src={item.image} alt={isEnglish ? item.periodEn : item.period} loading="lazy" />
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- Vietnam Market CTA Section -->
<section
	class="about-cta padding-large"
	style="background: linear-gradient(135deg, #f5f5f5 0%, #ffffff 100%);"
>
	<div class="container">
		<div class="cta-content">
			<div class="cta-text">
				<h2>{aboutContent.ctaTitle}</h2>
				<p>{aboutContent.ctaText}</p>
			</div>
			<a href={localizeInternalHref('/shop', $page.data?.locale || 'vi')} class="cta-button">
				<span>{aboutContent.ctaLabel}</span>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M7 17L17 7M17 7H7M17 7V17"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</a>
		</div>
	</div>
</section>

<!-- Values Section -->
<section class="about-values padding-xlarge" style="background: #ffffff;">
	<div class="container">
		<div class="values-header">
			<h2>{aboutContent.valuesTitle}</h2>
			<p>{aboutContent.valuesSubtitle}</p>
		</div>

		<div class="values-grid">
			<div class="value-card">
				<div class="value-icon">
					<svg
						width="32"
						height="32"
						viewBox="0 0 24 24"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M12 1C5.9 1 1 5.9 1 12s4.9 11 11 11 11-4.9 11-11S18.1 1 12 1zm-2 16l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
							fill="#0dcaf0"
						/>
					</svg>
				</div>
				<h3>{aboutContent.values[0].title}</h3>
				<p>{aboutContent.values[0].text}</p>
			</div>

			<div class="value-card">
				<div class="value-icon">
					<svg
						width="32"
						height="32"
						viewBox="0 0 24 24"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M12 2C6.48 2 2 6.48 2 12c0 5.52 4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"
							fill="#0dcaf0"
						/>
					</svg>
				</div>
				<h3>{aboutContent.values[1].title}</h3>
				<p>{aboutContent.values[1].text}</p>
			</div>

			<div class="value-card">
				<div class="value-icon">
					<svg
						width="32"
						height="32"
						viewBox="0 0 24 24"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M12 2l3.09 8.26L24 11.27l-6.23 5.87 1.41 8.88L12 21.77l-7.18 4.25 1.41-8.88L0 11.27l8.91-1.01L12 2z"
							fill="#0dcaf0"
						/>
					</svg>
				</div>
				<h3>{aboutContent.values[2].title}</h3>
				<p>{aboutContent.values[2].text}</p>
			</div>
		</div>
	</div>
</section>

<style>
	/* Hero Section */
	.about-hero {
		background:
			linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(249, 249, 249, 0.95) 100%),
			url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600"><defs><pattern id="pattern" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="50" cy="50" r="30" fill="%230dcaf0" opacity="0.05"/><path d="M50 20 L70 80 L30 80 Z" fill="%230dcaf0" opacity="0.03"/></pattern></defs><rect width="1200" height="600" fill="url(%23pattern)"/></svg>');
		position: relative;
		overflow: hidden;
		padding-bottom: 20px;
	}

	.about-hero::before {
		content: '';
		position: absolute;
		top: -50%;
		right: -10%;
		width: 600px;
		height: 600px;
		background: radial-gradient(circle, rgba(13, 202, 240, 0.12) 0%, transparent 70%);
		border-radius: 50%;
		pointer-events: none;
		animation: float 20s ease-in-out infinite;
	}

	.about-hero::after {
		content: '';
		position: absolute;
		bottom: -40%;
		left: -5%;
		width: 500px;
		height: 500px;
		background: radial-gradient(circle, rgba(13, 202, 240, 0.08) 0%, transparent 70%);
		border-radius: 50%;
		pointer-events: none;
		animation: float 25s ease-in-out infinite reverse;
	}

	.hero-content {
		position: relative;
		z-index: 2;
		max-width: 900px;
	}

	.hero-eyebrow {
		display: inline-block;
		margin-bottom: 1.5rem;
		animation: slideInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s backwards;
	}

	.eyebrow-label {
		display: inline-block;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		background: rgba(13, 202, 240, 0.12);
		color: #0dcaf0;
		border-radius: 999px;
	}

	.hero-title {
		font-size: clamp(2rem, 5vw, 3.5rem);
		font-weight: 700;
		line-height: 1.2;
		margin-bottom: 1.5rem;
		color: #272727;
		animation: slideInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s backwards;
	}

	.hero-subtitle {
		font-size: clamp(1rem, 2vw, 1.125rem);
		line-height: 1.6;
		color: #666;
		margin: 0;
		animation: slideInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.3s backwards;
	}

	.hero-subtitle strong {
		color: #0dcaf0;
		font-weight: 600;
	}

	/* Timeline Section */
	.about-timeline {
		background: linear-gradient(180deg, #ffffff 0%, #f9f9f9 50%, #ffffff 100%);
		position: relative;
		background-attachment: fixed;
	}

	.timeline-container {
		--timeline-axis-width: 4.5rem;
		--timeline-gap: clamp(1rem, 2.5vw, 2rem);
		--timeline-card-width: min(100%, 31rem);
		--timeline-image-width: clamp(15rem, 24vw, 19rem);
		position: relative;
		max-width: 76rem;
		margin: 0 auto;
		padding: 2rem 0;
	}

	.timeline-container::before {
		content: '';
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		width: 2px;
		height: 100%;
		background: linear-gradient(180deg, transparent 0%, #0dcaf0 20%, #0dcaf0 80%, transparent 100%);
	}

	.timeline-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--timeline-axis-width) minmax(0, 1fr);
		column-gap: var(--timeline-gap);
		row-gap: 1rem;
		margin-bottom: 4rem;
		position: relative;
		opacity: 0;
		animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		animation-delay: calc(var(--item-index) * 0.15s);
		align-items: stretch;
	}

	.timeline-item.visible {
		animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	.timeline-content {
		grid-row: 1;
		width: var(--timeline-card-width);
		max-width: 100%;
		padding: 2rem;
		background: #f9f9f9;
		border-radius: 12px;
		border-left: 3px solid #0dcaf0;
		transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		position: relative;
		overflow: hidden;
	}

	.timeline-content::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		width: 3px;
		height: 100%;
		background: linear-gradient(180deg, transparent, #0dcaf0, transparent);
		animation: shimmer 3s ease-in-out infinite;
		opacity: 0;
	}

	.timeline-content:hover::before {
		opacity: 1;
	}

	.timeline-item:nth-child(even) .timeline-content {
		grid-column: 1;
		justify-self: end;
		border-left: 3px solid #0dcaf0;
	}

	.timeline-item:nth-child(odd) .timeline-content {
		grid-column: 3;
		justify-self: start;
		border-left: none;
		border-right: 3px solid #0dcaf0;
	}

	.timeline-content:hover {
		background: #f0f8fc;
		box-shadow: 0 16px 40px rgba(13, 202, 240, 0.16);
		transform: translateX(4px);
	}

	.timeline-image {
		grid-row: 1;
		grid-column: auto;
		width: min(100%, var(--timeline-image-width));
		height: auto;
		min-height: 0;
		aspect-ratio: var(--timeline-image-aspect, 5 / 4);
		max-height: clamp(18rem, 34vw, 24rem);
		align-self: center;
		border-radius: 12px;
		overflow: hidden;
		background: #f0f0f0;
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
		transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		position: relative;
		border: 2px solid rgba(13, 202, 240, 0.2);
	}

	.timeline-image::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(135deg, transparent 0%, rgba(13, 202, 240, 0.1) 100%);
		opacity: 0;
		transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		border-radius: 10px;
		pointer-events: none;
	}

	.timeline-item:nth-child(even) .timeline-image {
		grid-column: 3;
		justify-self: start;
	}

	.timeline-item:nth-child(odd) .timeline-image {
		grid-column: 1;
		justify-self: end;
	}

	.timeline-image:hover {
		transform: translateY(-8px) scale(1.02);
		box-shadow: 0 16px 40px rgba(13, 202, 240, 0.3);
		border-color: #0dcaf0;
	}

	.timeline-image:hover::before {
		opacity: 1;
	}

	.timeline-image img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: var(--timeline-image-position, center center);
		display: block;
	}

	.timeline-marker {
		grid-row: 1;
		grid-column: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		width: var(--timeline-axis-width);
		gap: 0;
	}

	.marker-dot {
		width: 16px;
		height: 16px;
		background: #0dcaf0;
		border: 4px solid white;
		border-radius: 50%;
		box-shadow: 0 0 0 2px #0dcaf0;
		z-index: 10;
		margin-top: 2rem;
		animation: pulse 2s ease-in-out infinite;
	}

	.content-header {
		margin-bottom: 1.5rem;
	}

	.year-badge {
		display: inline-block;
		padding: 0.5rem 1rem;
		background: rgba(13, 202, 240, 0.12);
		color: #0dcaf0;
		font-weight: 600;
		font-size: 0.875rem;
		border-radius: 6px;
		margin-bottom: 0.75rem;
	}

	.period-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #272727;
		margin: 0;
		line-height: 1.3;
	}

	.highlights-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.highlight-item {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		color: #555;
		line-height: 1.6;
		font-size: 0.95rem;
	}

	.highlight-item strong {
		color: #272727;
		font-weight: 600;
	}

	.highlight-icon {
		width: 6px;
		height: 6px;
		background: #0dcaf0;
		border-radius: 50%;
		margin-top: 0.5rem;
		flex-shrink: 0;
	}

	/* CTA Section */
	.about-cta {
		background: linear-gradient(135deg, #f5f5f5 0%, #ffffff 100%);
		padding-top: 20px;
		padding-bottom: 20px;
	}

	.cta-content {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 3rem;
		align-items: center;
	}

	.cta-text h2 {
		font-size: clamp(1.5rem, 3vw, 2rem);
		font-weight: 700;
		color: #272727;
		margin-bottom: 1rem;
		line-height: 1.3;
	}

	.cta-text p {
		color: #666;
		line-height: 1.6;
		margin: 0;
		font-size: 1rem;
	}

	.cta-button {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 2rem;
		background: #0dcaf0;
		color: white;
		border-radius: 8px;
		font-weight: 600;
		text-decoration: none;
		transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		white-space: nowrap;
		box-shadow: 0 8px 20px rgba(13, 202, 240, 0.24);
	}

	.cta-button:hover {
		background: #0ab8d9;
		transform: translateY(-2px);
		box-shadow: 0 12px 30px rgba(13, 202, 240, 0.32);
	}

	.cta-button svg {
		transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.cta-button:hover svg {
		transform: translate(4px, -4px);
	}

	/* Values Section */
	.about-values {
		position: relative;
		overflow: hidden;
	}

	.about-values::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background:
			radial-gradient(circle at 20% 50%, rgba(13, 202, 240, 0.05) 0%, transparent 50%),
			radial-gradient(circle at 80% 80%, rgba(13, 202, 240, 0.03) 0%, transparent 50%);
		pointer-events: none;
		z-index: 0;
	}

	.about-values > .container {
		position: relative;
		z-index: 1;
	}

	.values-header {
		text-align: center;
		margin-bottom: 3rem;
		animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.values-header h2 {
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		font-weight: 700;
		color: #272727;
		margin-bottom: 0.75rem;
	}

	.values-header p {
		color: #666;
		font-size: 1.1rem;
		max-width: 600px;
		margin: 0 auto;
		line-height: 1.6;
	}

	.values-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 2rem;
	}

	.value-card {
		padding: 2rem;
		background: #f9f9f9;
		border-radius: 12px;
		text-align: center;
		transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		border: 2px solid rgba(13, 202, 240, 0.1);
		position: relative;
		overflow: hidden;
	}

	.value-card::before {
		content: '';
		position: absolute;
		top: 0;
		left: -100%;
		width: 100%;
		height: 100%;
		background: linear-gradient(90deg, transparent, rgba(13, 202, 240, 0.1), transparent);
		transition: left 0.5s cubic-bezier(0.16, 1, 0.3, 1);
		pointer-events: none;
	}

	.value-card:hover::before {
		left: 100%;
	}

	.value-card:hover {
		background: #f0f8fc;
		border-color: #0dcaf0;
		transform: translateY(-8px);
		box-shadow: 0 16px 40px rgba(13, 202, 240, 0.16);
	}

	.value-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 60px;
		height: 60px;
		background: rgba(13, 202, 240, 0.1);
		border-radius: 12px;
		margin: 0 auto 1rem;
		transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.value-icon svg path {
		transition: fill 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.value-card:hover .value-icon {
		background: #0dcaf0;
		transform: scale(1.1) rotate(5deg);
		box-shadow: 0 8px 20px rgba(13, 202, 240, 0.3);
	}

	.value-card:hover .value-icon svg path {
		fill: white;
	}

	.value-card h3 {
		font-size: 1.25rem;
		font-weight: 700;
		color: #272727;
		margin: 0 0 0.75rem;
	}

	.value-card p {
		color: #666;
		font-size: 0.95rem;
		line-height: 1.6;
		margin: 0;
	}

	/* Animations */
	@keyframes slideInUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(30px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes float {
		0%,
		100% {
			transform: translate(0, 0);
		}
		50% {
			transform: translate(30px, -30px);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			box-shadow:
				0 0 0 2px #0dcaf0,
				0 0 0 6px rgba(13, 202, 240, 0.2);
		}
		50% {
			box-shadow:
				0 0 0 2px #0dcaf0,
				0 0 0 12px rgba(13, 202, 240, 0.1);
		}
	}

	@keyframes shimmer {
		0% {
			opacity: 0;
		}
		50% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	@keyframes glow {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgba(13, 202, 240, 0.7);
		}
		50% {
			box-shadow: 0 0 0 10px rgba(13, 202, 240, 0);
		}
	}

	/* Mobile Responsive */
	@media (max-width: 1100px) {
		.timeline-container {
			--timeline-axis-width: 3.5rem;
			--timeline-gap: 1.25rem;
			--timeline-card-width: min(100%, 26rem);
			--timeline-image-width: clamp(13rem, 27vw, 16rem);
		}

		.timeline-item {
			margin-bottom: 3rem;
		}
	}

	@media (max-width: 900px) {
		.timeline-container::before {
			left: calc(var(--timeline-axis-width) / 2);
			transform: none;
		}

		.timeline-item {
			grid-template-columns: var(--timeline-axis-width) minmax(0, 1fr);
			column-gap: 1rem;
			row-gap: 1rem;
			margin-bottom: 3rem;
			align-items: start;
		}

		.timeline-content {
			grid-row: auto;
			grid-column: 2 !important;
			width: 100%;
			justify-self: stretch;
			border-left: 3px solid #0dcaf0;
			border-right: none;
			margin-left: 0;
		}

		.timeline-image {
			grid-row: auto;
			grid-column: 2 !important;
			width: 100%;
			height: auto;
			aspect-ratio: var(--timeline-image-aspect, 5 / 4);
			max-height: none;
			min-height: 0;
			justify-self: stretch;
			margin: 0;
		}

		.timeline-marker {
			grid-row: 1 / span 2;
			grid-column: 1;
			position: relative;
			left: 0;
			top: 0;
			flex-direction: column;
			align-self: stretch;
		}

		.marker-dot {
			margin-top: 1.75rem;
		}

		.timeline-item:nth-child(even) .timeline-content {
			grid-column: 2;
			justify-self: stretch;
			border-left: 3px solid #0dcaf0;
			border-right: none;
		}

		.timeline-item:nth-child(odd) .timeline-content {
			grid-column: 2;
			justify-self: stretch;
			border-left: 3px solid #0dcaf0;
			border-right: none;
		}

		.timeline-item:nth-child(even) .timeline-image,
		.timeline-item:nth-child(odd) .timeline-image {
			grid-column: 2;
			justify-self: stretch;
		}

		.timeline-image img {
			object-position: var(
				--timeline-image-position-mobile,
				var(--timeline-image-position, center center)
			);
		}

		.cta-content {
			grid-template-columns: 1fr;
			gap: 2rem;
		}

		.cta-button {
			width: 100%;
			justify-content: center;
		}

		.values-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.timeline-container {
			--timeline-axis-width: 2.75rem;
		}

		.timeline-item {
			column-gap: 0.75rem;
			margin-bottom: 2.5rem;
		}

		.timeline-content {
			padding: 1.5rem;
		}

		.timeline-image {
			aspect-ratio: 4 / 3;
		}
	}

	@media (max-width: 480px) {
		.timeline-image {
			aspect-ratio: 1 / 1;
		}

		.timeline-content {
			padding: 1.25rem;
		}

		.period-title {
			font-size: 1.25rem;
		}

		.highlight-item {
			font-size: 0.9rem;
		}
	}
</style>
