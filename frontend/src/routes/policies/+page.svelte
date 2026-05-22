<script>
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import { locale } from '$lib/i18n/index.js';
	import { SITE_CONTACT } from '$lib/config/siteContact.js';
	import { getPolicyPath } from '$lib/content/policies.js';

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
			.replace(/</g, '\u003c')
			.replace(/>/g, '\u003e')
			.replace(/&/g, '\u0026')
			.replace(/\u2028/g, '\u2028')
			.replace(/\u2029/g, '\u2029');

	const POLICY_CONTENT = {
		vi: {
			title: 'Chính sách mua hàng, vận chuyển và đổi trả',
			heading: 'Chính sách khách hàng',
			lede:
				'Inoxpran áp dụng chính sách minh bạch, dễ kiểm tra và xử lý nhanh cho sản phẩm gia dụng. Nội dung dưới đây được xây dựng theo thông lệ phổ biến của các website gia dụng lớn, đồng thời điều chỉnh cho phù hợp với vận hành thực tế của Inoxpran.',
			updatedLabel: 'Cập nhật lần cuối',
			updatedAt: '11/03/2026',
			summary: [
				{
					label: 'Khiếu nại ngoại quan',
					value: '48 giờ',
					description: 'Áp dụng khi giao sai hàng, thiếu hàng hoặc bể vỡ do vận chuyển.'
				},
				{
					label: 'Đổi trả vì lỗi kỹ thuật',
					value: '7 ngày',
					description: 'Áp dụng với lỗi do nhà sản xuất hoặc lỗi phát sinh ngay khi sử dụng đúng hướng dẫn.'
				},
				{
					label: 'Hoàn tiền',
					value: '3-7 ngày làm việc',
					description: 'Tính từ khi Inoxpran xác nhận đã nhận hàng hoàn và phê duyệt yêu cầu.'
				}
			],
			nav: [
				{ id: 'returns-policy', label: 'Đổi trả & hoàn tiền' },
				{ id: 'shipping-policy', label: 'Vận chuyển & giao nhận' },
				{ id: 'privacy-policy', label: 'Bảo mật thông tin' }
			],
			sections: [
				{
					id: 'returns-policy',
					kicker: 'Đổi trả',
					title: 'Chính sách đổi trả và hoàn tiền',
					description:
						'Áp dụng cho đơn hàng đặt tại website chính thức của Inoxpran. Với đơn mua qua đại lý hoặc sàn thương mại điện tử, khách hàng vui lòng đối chiếu thêm chính sách tại điểm bán tương ứng.',
					groups: [
						{
							title: '1. Các trường hợp được hỗ trợ đổi trả',
							items: [
								'Giao sai mẫu, sai màu, sai dung tích, sai số lượng hoặc thiếu phụ kiện so với đơn đặt hàng.',
								'Sản phẩm có dấu hiệu móp méo, nứt vỡ, trầy xước nghiêm trọng do vận chuyển và được phản hồi trong vòng 48 giờ kể từ thời điểm nhận hàng.',
								'Sản phẩm phát sinh lỗi kỹ thuật do nhà sản xuất trong vòng 7 ngày kể từ ngày nhận, dù đã được lắp đặt hoặc sử dụng đúng hướng dẫn.',
								'Sản phẩm không thể vận hành ngay từ lần sử dụng đầu tiên, ví dụ bếp không lên nguồn, nồi cơm không kích hoạt được chương trình cơ bản, linh kiện đi kèm không hoạt động.'
							]
						},
						{
							title: '2. Điều kiện tiếp nhận yêu cầu',
							items: [
								'Khách hàng cung cấp mã đơn hàng hoặc thông tin mua hàng đủ để Inoxpran đối soát.',
								'Sản phẩm còn đầy đủ phụ kiện, quà tặng kèm, phiếu bảo hành, sách hướng dẫn và bao bì nếu còn giữ được.',
								'Sản phẩm không có dấu hiệu hư hỏng do rơi vỡ, va đập mạnh, vào nước sai quy cách, cháy nổ điện, tự ý tháo lắp hoặc sử dụng sai công năng.',
								'Khách hàng nên quay video mở hộp khi nhận hàng để rút ngắn thời gian xác minh các trường hợp thiếu hàng hoặc bể vỡ do vận chuyển.'
							]
						},
						{
							title: '3. Các trường hợp không áp dụng đổi trả',
							items: [
								'Sản phẩm đã qua sử dụng bình thường, không có lỗi kỹ thuật, nhưng khách hàng thay đổi nhu cầu hoặc không còn nhu cầu sử dụng.',
								'Sản phẩm có hao mòn thẩm mỹ nhẹ sau quá trình sử dụng hoặc phát sinh trầy xước nhưng không được phản ánh trong thời hạn tiếp nhận khiếu nại.',
								'Hư hỏng do dùng sai hướng dẫn, đun quá nhiệt, dùng sai nguồn điện, vệ sinh bằng hóa chất không phù hợp hoặc bảo quản sai điều kiện.',
								'Thiếu phụ kiện, quà tặng hoặc bộ phận tiêu hao do khách hàng tự làm mất sau khi đã nhận đủ hàng.'
							]
						},
						{
							title: '4. Quy trình xử lý',
							items: [
								'Bước 1: Liên hệ Inoxpran qua hotline hoặc email, gửi kèm mã đơn hàng, hình ảnh và video mô tả lỗi.',
								'Bước 2: Inoxpran phản hồi tiếp nhận trong 1 ngày làm việc và hướng dẫn hình thức kiểm tra phù hợp.',
								'Bước 3: Sau khi xác minh, Inoxpran sẽ đổi sản phẩm tương đương, đổi model cùng giá trị khi có sự đồng ý của khách hàng, hoặc hoàn tiền theo phương thức thanh toán ban đầu.',
								'Bước 4: Nếu cần gửi hàng về kho để kiểm tra, Inoxpran sẽ thông báo trước chi phí, thời gian và đầu mối tiếp nhận.'
							]
						},
						{
							title: '5. Chi phí vận chuyển và hoàn tiền',
							items: [
								'Nếu lỗi thuộc về Inoxpran, nhà sản xuất hoặc đơn vị vận chuyển do Inoxpran chỉ định, Inoxpran chịu toàn bộ chi phí vận chuyển đổi trả.',
								'Nếu yêu cầu không đáp ứng điều kiện đổi trả nhưng khách hàng vẫn muốn gửi kiểm tra bảo hành, chi phí gửi hàng phát sinh sẽ được thông báo trước.',
								'Tiền hoàn được xử lý trong vòng 3-7 ngày làm việc sau khi yêu cầu được phê duyệt, tùy theo phương thức thanh toán và thời gian xử lý của ngân hàng hoặc cổng thanh toán.'
							]
						}
					]
				},
				{
					id: 'shipping-policy',
					kicker: 'Vận chuyển',
					title: 'Chính sách vận chuyển và giao nhận',
					description:
						'Inoxpran xử lý đơn hàng trong giờ làm việc và phối hợp với đối tác giao nhận để giao hàng toàn quốc. Thời gian giao thực tế có thể thay đổi theo địa chỉ nhận, điều kiện thời tiết hoặc giai đoạn cao điểm.',
					groups: [
						{
							title: '1. Thời gian xử lý đơn',
							items: [
								'Đơn xác nhận thành công trước 15:00 thường được xử lý trong cùng ngày làm việc.',
								'Đơn sau thời điểm trên hoặc vào ngày nghỉ, ngày lễ sẽ được xử lý ở ngày làm việc kế tiếp.'
							]
						},
						{
							title: '2. Thời gian giao hàng tham khảo',
							items: [
								'Nội thành các thành phố lớn: khoảng 1-3 ngày làm việc.',
								'Khu vực tỉnh và liên tỉnh: khoảng 2-5 ngày làm việc, tùy tuyến giao và khả năng phục vụ của đơn vị vận chuyển.'
							]
						},
						{
							title: '3. Kiểm tra khi nhận hàng',
							items: [
								'Khách hàng nên kiểm tra tình trạng kiện hàng, tem niêm phong, số lượng và model trước khi ký nhận.',
								'Nếu phát hiện dấu hiệu bất thường, vui lòng phản hồi ngay với shipper và liên hệ Inoxpran để được hỗ trợ nhanh nhất.'
							]
						}
					]
				},
				{
					id: 'privacy-policy',
					kicker: 'Bảo mật',
					title: 'Chính sách bảo mật thông tin',
					description:
						'Inoxpran chỉ thu thập các thông tin cần thiết để xác nhận đơn hàng, giao hàng, chăm sóc khách hàng và thực hiện nghĩa vụ bảo hành, đổi trả.',
					groups: [
						{
							title: '1. Thông tin được thu thập',
							items: [
								'Họ tên, số điện thoại, email, địa chỉ nhận hàng, lịch sử đơn hàng và nội dung trao đổi hỗ trợ.',
								'Dữ liệu kỹ thuật cơ bản như địa chỉ IP, loại thiết bị hoặc hành vi thao tác trên website khi khách hàng cho phép cookie liên quan.'
							]
						},
						{
							title: '2. Mục đích sử dụng',
							items: [
								'Xác nhận đơn hàng, giao hàng, đối soát thanh toán và chăm sóc sau bán.',
								'Tiếp nhận khiếu nại, xử lý bảo hành, đổi trả và cải thiện chất lượng dịch vụ.'
							]
						},
						{
							title: '3. Phạm vi chia sẻ',
							items: [
								'Inoxpran chỉ chia sẻ dữ liệu với đơn vị vận chuyển, cổng thanh toán hoặc đối tác công nghệ khi cần thiết để hoàn thành đơn hàng.',
								'Inoxpran không bán hoặc cho thuê dữ liệu cá nhân của khách hàng cho bên thứ ba vì mục đích quảng cáo độc lập.'
							]
						}
					]
				}
			],
			contactTitle: 'Liên hệ xử lý nhanh',
			contactDescription:
				'Khi cần đổi trả hoặc cần giải thích thêm về chính sách, vui lòng gửi kèm mã đơn hàng và ảnh hoặc video mô tả tình trạng sản phẩm để Inoxpran xử lý nhanh hơn.',
			phoneLabel: 'Hotline',
			emailLabel: 'Email',
			ctaLabel: 'Liên hệ tư vấn'
		},
		en: {
			title: 'Store policies, shipping and returns',
			heading: 'Customer policies',
			lede:
				'Inoxpran follows a clear, verifiable and fast-response policy for cookware and home appliances. The policy below is aligned with common practices used by major home-appliance ecommerce stores and adapted to Inoxpran operations.',
			updatedLabel: 'Last updated',
			updatedAt: 'March 11, 2026',
			summary: [
				{
					label: 'Transit or packing issue claim',
					value: '48 hours',
					description: 'For wrong items, missing items, or visible breakage caused during delivery.'
				},
				{
					label: 'Technical defect return',
					value: '7 days',
					description: 'For manufacturer defects or faults found during proper first use.'
				},
				{
					label: 'Refund timeline',
					value: '3-7 business days',
					description: 'After Inoxpran receives the returned item and approves the request.'
				}
			],
			nav: [
				{ id: 'returns-policy', label: 'Returns & refunds' },
				{ id: 'shipping-policy', label: 'Shipping & delivery' },
				{ id: 'privacy-policy', label: 'Privacy policy' }
			],
			sections: [
				{
					id: 'returns-policy',
					kicker: 'Returns',
					title: 'Return and refund policy',
					description:
						'This policy applies to orders placed on the official Inoxpran website. Orders placed through marketplaces or resellers may also follow the policy of that sales channel.',
					groups: [
						{
							title: '1. Eligible return cases',
							items: [
								'Wrong model, color, capacity, quantity, or missing accessories compared with the confirmed order.',
								'Severe dents, cracks, or transit damage reported within 48 hours after delivery.',
								'Manufacturer defects found within 7 days of delivery when the product has been used according to instructions.',
								'The item fails to operate on first use, such as a cooktop not powering on or an appliance program not starting.'
							]
						},
						{
							title: '2. Conditions for review',
							items: [
								'Customers provide a valid order code or enough purchase details for verification.',
								'All accessories, gifts, manuals and warranty documents are returned where available.',
								'The product must not show damage caused by drops, impact, misuse, wrong voltage, moisture exposure or unauthorized repair.',
								'Unboxing video is strongly recommended to help verify transit damage or missing parts faster.'
							]
						},
						{
							title: '3. Cases not covered',
							items: [
								'Normal used items with no confirmed defect when the customer simply changes their mind.',
								'Minor cosmetic wear found after normal use and not reported within the claim window.',
								'Damage caused by misuse, overheating, unsuitable cleaning chemicals, wrong voltage or improper storage.',
								'Missing parts or gifts lost by the customer after the order was received in full.'
							]
						},
						{
							title: '4. Handling process',
							items: [
								'Step 1: Contact Inoxpran by hotline or email and send your order code, photos and videos.',
								'Step 2: Inoxpran confirms receipt within 1 business day and guides the inspection method.',
								'Step 3: Once approved, Inoxpran will replace the item, propose an equivalent model with customer consent, or issue a refund.',
								'Step 4: If the item must be returned for inspection, shipping instructions and timeline will be confirmed in advance.'
							]
						},
						{
							title: '5. Shipping cost and refunds',
							items: [
								'If the issue is caused by Inoxpran, the manufacturer or the shipping partner arranged by Inoxpran, return shipping is covered by Inoxpran.',
								'If the request does not meet return conditions but the customer still wants a warranty inspection, shipping cost will be communicated first.',
								'Refunds are processed within 3-7 business days after approval, depending on payment method and banking timelines.'
							]
						}
					]
				},
				{
					id: 'shipping-policy',
					kicker: 'Shipping',
					title: 'Shipping and delivery policy',
					description:
						'Inoxpran processes orders during business hours and works with shipping partners for nationwide delivery. Actual delivery time may vary by destination, weather and peak periods.',
					groups: [
						{
							title: '1. Order processing',
							items: [
								'Orders confirmed before 3:00 PM are usually processed on the same business day.',
								'Orders placed later, on weekends or on holidays are processed on the next business day.'
							]
						},
						{
							title: '2. Estimated delivery time',
							items: [
								'Major city areas: around 1-3 business days.',
								'Provincial and inter-city routes: around 2-5 business days depending on the service area.'
							]
						},
						{
							title: '3. Receiving inspection',
							items: [
								'Customers should inspect the parcel condition, seal, quantity and model before accepting the shipment.',
								'If anything looks unusual, please report it immediately to the courier and contact Inoxpran for support.'
							]
						}
					]
				},
				{
					id: 'privacy-policy',
					kicker: 'Privacy',
					title: 'Privacy policy',
					description:
						'Inoxpran collects only the data required to confirm orders, deliver products, support customers and handle warranty or returns.',
					groups: [
						{
							title: '1. Data collected',
							items: [
								'Name, phone, email, delivery address, order history and customer support communication.',
								'Basic technical data such as IP address, device type or site interactions when relevant cookies are allowed.'
							]
						},
						{
							title: '2. How data is used',
							items: [
								'To confirm orders, arrange delivery, reconcile payment and provide after-sales support.',
								'To resolve complaints, warranty and returns, and improve service quality.'
							]
						},
						{
							title: '3. Data sharing',
							items: [
								'Data is shared only with shipping, payment or technology partners when required to complete the order.',
								'Inoxpran does not sell or rent customer personal data to third parties for independent advertising purposes.'
							]
						}
					]
				}
			],
			contactTitle: 'Need help with a return?',
			contactDescription:
				'Please include your order code and product photos or videos when contacting us so the team can review your request faster.',
			phoneLabel: 'Hotline',
			emailLabel: 'Email',
			ctaLabel: 'Contact support'
		}
	};

	$: currentLocale = $locale === 'en' ? 'en' : 'vi';
	$: content = POLICY_CONTENT[currentLocale];
	$: siteUrl = normalizeSiteUrl(env.PUBLIC_SITE_URL);
	$: seoTitle = `${content.title} | Inoxpran`;
	$: seoDescription = truncateMeta(content.lede);
	$: ogImageUrl = `${siteUrl}/og-image.png`;
	$: ogImageAlt = `${content.title} | Inoxpran`;
	$: canonicalUrl = `${siteUrl}${$page.url?.pathname || '/policies'}`;
	$: policyBreadcrumbId = `${canonicalUrl}#breadcrumb`;
	$: policyBreadcrumbJsonLd = JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		'@id': policyBreadcrumbId,
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
				name: content.title,
				item: canonicalUrl
			}
		]
	});
	$: policyCollectionJsonLd = JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'CollectionPage',
		'@id': `${canonicalUrl}#policy-collection`,
		url: canonicalUrl,
		name: seoTitle,
		description: seoDescription,
		breadcrumb: {
			'@id': policyBreadcrumbId
		},
		mainEntity: {
			'@type': 'ItemList',
			itemListElement: content.sections.map((section, index) => ({
				'@type': 'ListItem',
				position: index + 1,
				name: section.title,
				url: `${siteUrl}${getPolicyPath(section.id, currentLocale)}`
			}))
		},
		inLanguage: currentLocale === 'en' ? 'en-US' : 'vi-VN'
	});
	$: policyWebPageJsonLd = JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'WebPage',
		'@id': canonicalUrl,
		url: canonicalUrl,
		name: seoTitle,
		description: seoDescription,
		breadcrumb: {
			'@id': policyBreadcrumbId
		},
		isPartOf: {
			'@type': 'WebSite',
			'@id': `${siteUrl}/#website`
		},
		about: {
			'@type': 'Organization',
			'@id': `${siteUrl}/#organization`,
			name: 'Inoxpran'
		},
		hasPart: content.sections.map((section) => ({
			'@type': 'CreativeWork',
			name: section.title,
			description: section.description,
			url: `${canonicalUrl}#${section.id}`
		})),
		inLanguage: currentLocale === 'en' ? 'en-US' : 'vi-VN'
	});
</script>

<svelte:head>
	<title>{seoTitle}</title>
	<meta name="description" content={seoDescription} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:title" content={seoTitle} />
	<meta property="og:description" content={seoDescription} />
	<meta property="og:image" content={ogImageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={ogImageAlt} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={seoTitle} />
	<meta name="twitter:description" content={seoDescription} />
	<meta name="twitter:image" content={ogImageUrl} />
	<meta name="twitter:image:alt" content={ogImageAlt} />
	{@html '<script type="application/ld+json">' + escapeJsonLd(policyBreadcrumbJsonLd) + '</script>'}
	{@html '<script type="application/ld+json">' + escapeJsonLd(policyCollectionJsonLd) + '</script>'}
	{@html '<script type="application/ld+json">' + escapeJsonLd(policyWebPageJsonLd) + '</script>'}
</svelte:head>

<section class="policy-shell padding-large">
	<div class="container policy-layout">
		<header class="policy-hero">
			<p class="policy-kicker">{content.heading}</p>
			<div class="policy-hero-row">
				<div>
					<h1>{content.title}</h1>
					<p class="policy-lede">{content.lede}</p>
				</div>
				<div class="policy-updated">
					<span>{content.updatedLabel}</span>
					<strong>{content.updatedAt}</strong>
				</div>
			</div>

			<div class="policy-summary-grid">
				{#each content.summary as item}
					<article class="policy-summary-card">
						<span>{item.label}</span>
						<strong>{item.value}</strong>
						<p>{item.description}</p>
					</article>
				{/each}
			</div>
		</header>

		<div class="policy-content-grid">
			<aside class="policy-nav-card">
				<h2>{currentLocale === 'en' ? 'On this page' : 'Mục lục'}</h2>
				<nav aria-label={currentLocale === 'en' ? 'Policy navigation' : 'Điều hướng chính sách'}>
					{#each content.nav as item}
						<a href={`#${item.id}`}>{item.label}</a>
					{/each}
				</nav>
			</aside>

			<div class="policy-sections">
				{#each content.sections as section}
					<article id={section.id} class="policy-section-card">
						<p class="policy-section-kicker">{section.kicker}</p>
						<h2>{section.title}</h2>
						<p class="policy-section-desc">{section.description}</p>

						<div class="policy-group-stack">
							{#each section.groups as group}
								<section class="policy-group">
									<h3>{group.title}</h3>
									<ul>
										{#each group.items as item}
											<li>{item}</li>
										{/each}
									</ul>
								</section>
							{/each}
						</div>
					</article>
				{/each}

				<article class="policy-contact-card">
					<div>
						<p class="policy-section-kicker">{content.ctaLabel}</p>
						<h2>{content.contactTitle}</h2>
						<p>{content.contactDescription}</p>
					</div>
					<div class="policy-contact-actions">
						<a href={`tel:${SITE_CONTACT.phone.replace(/\s+/g, '')}`}>
							<span>{content.phoneLabel}</span>
							<strong>{SITE_CONTACT.phone}</strong>
						</a>
						<a href={`mailto:${SITE_CONTACT.email}`}>
							<span>{content.emailLabel}</span>
							<strong>{SITE_CONTACT.email}</strong>
						</a>
					</div>
				</article>
			</div>
		</div>
	</div>
</section>

<style>
	:global(html) {
		scroll-padding-top: 110px;
	}

	.policy-shell {
		background:
			radial-gradient(circle at top left, rgba(208, 230, 235, 0.72), transparent 34%),
			linear-gradient(180deg, #f7f1e8 0%, #fffdfa 42%, #ffffff 100%);
	}

	.policy-layout {
		display: grid;
		gap: 28px;
	}

	.policy-hero,
	.policy-nav-card,
	.policy-section-card,
	.policy-contact-card,
	.policy-summary-card {
		background: rgba(255, 255, 255, 0.92);
		border: 1px solid rgba(20, 63, 79, 0.1);
		box-shadow: 0 18px 45px rgba(16, 52, 64, 0.08);
	}

	.policy-hero {
		padding: clamp(24px, 4vw, 40px);
		border-radius: 32px;
	}

	.policy-kicker,
	.policy-section-kicker {
		margin: 0 0 10px;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #1d4e63;
	}

	.policy-hero-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 20px;
		align-items: end;
	}

	.policy-hero h1,
	.policy-section-card h2,
	.policy-contact-card h2 {
		margin: 0;
		font-family: 'Cormorant Garamond', Georgia, serif;
		font-size: clamp(2.2rem, 5vw, 3.5rem);
		line-height: 0.96;
		color: #132f3c;
	}

	.policy-lede,
	.policy-section-desc,
	.policy-contact-card p {
		margin: 14px 0 0;
		max-width: 72ch;
		font-size: 1rem;
		line-height: 1.8;
		color: #4f5f67;
	}

	.policy-updated {
		min-width: 180px;
		padding: 16px 18px;
		border-radius: 20px;
		background: linear-gradient(180deg, #163947 0%, #1f5568 100%);
		color: #f7fbfc;
	}

	.policy-updated span,
	.policy-summary-card span,
	.policy-contact-actions a span {
		display: block;
		font-size: 0.82rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: inherit;
		opacity: 0.8;
	}

	.policy-updated strong,
	.policy-summary-card strong,
	.policy-contact-actions a strong {
		display: block;
		margin-top: 6px;
		font-size: 1.2rem;
		font-weight: 700;
	}

	.policy-summary-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 16px;
		margin-top: 24px;
	}

	.policy-summary-card {
		padding: 20px;
		border-radius: 24px;
	}

	.policy-summary-card span {
		color: #60737b;
	}

	.policy-summary-card strong {
		color: #132f3c;
	}

	.policy-summary-card p {
		margin: 10px 0 0;
		color: #5c6d74;
		line-height: 1.7;
	}

	.policy-content-grid {
		display: grid;
		grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
		gap: 20px;
		align-items: start;
	}

	.policy-nav-card {
		position: sticky;
		top: 112px;
		padding: 22px;
		border-radius: 28px;
	}

	.policy-nav-card h2 {
		margin: 0 0 16px;
		font-size: 1rem;
		font-weight: 700;
		color: #173845;
	}

	.policy-nav-card nav {
		display: grid;
		gap: 10px;
	}

	.policy-nav-card a {
		padding: 12px 14px;
		border-radius: 999px;
		background: #f2f6f7;
		color: #234554;
		text-decoration: none;
		transition:
			transform 0.2s ease,
			background-color 0.2s ease,
			color 0.2s ease;
	}

	.policy-nav-card a:hover,
	.policy-nav-card a:focus-visible {
		background: #1d4e63;
		color: #fff;
		transform: translateX(4px);
	}

	.policy-sections {
		display: grid;
		gap: 18px;
	}

	.policy-section-card,
	.policy-contact-card {
		padding: clamp(22px, 4vw, 34px);
		border-radius: 30px;
		scroll-margin-top: 120px;
	}

	.policy-group-stack {
		display: grid;
		gap: 18px;
		margin-top: 24px;
	}

	.policy-group {
		padding-top: 18px;
		border-top: 1px solid rgba(26, 68, 84, 0.1);
	}

	.policy-group h3 {
		margin: 0 0 12px;
		font-size: 1.02rem;
		color: #183946;
	}

	.policy-group ul {
		margin: 0;
		padding-left: 18px;
		display: grid;
		gap: 10px;
		color: #55656d;
		line-height: 1.75;
	}

	.policy-contact-card {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 18px;
		align-items: center;
		background: linear-gradient(135deg, #153845 0%, #22586b 100%);
		color: #f6fbfc;
	}

	.policy-contact-card .policy-section-kicker,
	.policy-contact-card p {
		color: rgba(246, 251, 252, 0.84);
	}

	.policy-contact-card h2 {
		color: #fff;
		font-size: clamp(1.9rem, 4vw, 2.6rem);
	}

	.policy-contact-actions {
		display: grid;
		gap: 12px;
		min-width: min(100%, 320px);
	}

	.policy-contact-actions a {
		padding: 16px 18px;
		border-radius: 20px;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.18);
		color: #fff;
		text-decoration: none;
	}

	@media (max-width: 991px) {
		.policy-summary-grid,
		.policy-content-grid,
		.policy-contact-card {
			grid-template-columns: 1fr;
		}

		.policy-nav-card {
			position: static;
		}

		.policy-contact-actions {
			min-width: 0;
		}
	}

	@media (max-width: 640px) {
		.policy-hero-row {
			grid-template-columns: 1fr;
		}

		.policy-updated {
			min-width: 0;
		}

		.policy-nav-card a:hover,
		.policy-nav-card a:focus-visible {
			transform: none;
		}
	}
</style>
