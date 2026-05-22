import { SITE_CONTACT } from '$lib/config/siteContact.js';

export const POLICY_DETAIL_SLUGS = Object.freeze([
	'returns-policy',
	'shipping-policy',
	'warranty-policy',
	'privacy-policy'
]);

const normalizeLocale = (locale) => (String(locale || 'vi').trim() === 'en' ? 'en' : 'vi');

const POLICY_DETAILS = {
	vi: {
		'returns-policy': {
			slug: 'returns-policy',
			kicker: 'Đổi trả',
			title: 'Chính sách đổi trả và hoàn tiền',
			shortTitle: 'Đổi trả & hoàn tiền',
			metaDescription:
				'Chi tiết điều kiện đổi trả, hoàn tiền, thời gian tiếp nhận và quy trình xử lý đơn hàng Inoxpran.',
			updatedAtLabel: 'Cập nhật lần cuối',
			updatedAtText: '23/03/2026',
			updatedAtIso: '2026-03-23',
			summary:
				'Áp dụng cho đơn hàng đặt trên website chính thức của Inoxpran. Tập trung vào lỗi kỹ thuật do nhà sản xuất, giao sai hàng, thiếu hàng hoặc hư hỏng trong quá trình vận chuyển.',
			sections: [
				{
					title: '1. Trường hợp được hỗ trợ',
					items: [
						'Giao sai model, sai dung tích, sai màu, sai số lượng hoặc thiếu phụ kiện so với đơn đã xác nhận.',
						'Sản phẩm móp méo, nứt vỡ, trầy xước nghiêm trọng do vận chuyển và được phản hồi trong vòng 48 giờ kể từ khi nhận hàng.',
						'Sản phẩm phát sinh lỗi kỹ thuật do nhà sản xuất trong vòng 7 ngày khi sử dụng đúng hướng dẫn.'
					]
				},
				{
					title: '2. Điều kiện tiếp nhận',
					items: [
						'Có mã đơn hàng hoặc đủ thông tin mua hàng để Inoxpran đối soát.',
						'Sản phẩm còn đủ phụ kiện, quà tặng, hướng dẫn sử dụng và chứng từ liên quan nếu có.',
						'Không có dấu hiệu hư hỏng do rơi vỡ, va đập mạnh, sai nguồn điện hoặc tự ý tháo lắp.'
					]
				},
				{
					title: '3. Quy trình xử lý',
					items: [
						'Bước 1: liên hệ hotline hoặc email, gửi kèm mã đơn hàng cùng ảnh hoặc video mô tả lỗi.',
						'Bước 2: Inoxpran xác nhận tiếp nhận trong 1 ngày làm việc và hướng dẫn hình thức kiểm tra phù hợp.',
						'Bước 3: nếu đủ điều kiện, Inoxpran sẽ đổi sản phẩm tương đương, đề xuất model thay thế cùng giá trị hoặc hoàn tiền theo phương thức thanh toán ban đầu.'
					]
				},
				{
					title: '4. Chi phí vận chuyển và hoàn tiền',
					items: [
						'Nếu lỗi thuộc về Inoxpran, nhà sản xuất hoặc đơn vị vận chuyển do Inoxpran chỉ định, chi phí đổi trả sẽ do Inoxpran chi trả.',
						'Tiền hoàn được xử lý trong khoảng 3-7 ngày làm việc sau khi yêu cầu được phê duyệt và hàng hoàn đã được xác nhận.'
					]
				}
			]
		},
		'shipping-policy': {
			slug: 'shipping-policy',
			kicker: 'Vận chuyển',
			title: 'Chính sách vận chuyển và giao nhận',
			shortTitle: 'Vận chuyển & giao nhận',
			metaDescription:
				'Thời gian xử lý đơn, thời gian giao hàng tham khảo và các lưu ý kiểm tra khi nhận hàng từ Inoxpran.',
			updatedAtLabel: 'Cập nhật lần cuối',
			updatedAtText: '23/03/2026',
			updatedAtIso: '2026-03-23',
			summary:
				'Inoxpran xử lý đơn trong giờ làm việc và phối hợp với đối tác giao nhận để giao hàng toàn quốc. Thời gian thực tế có thể thay đổi theo tuyến giao và giai đoạn cao điểm.',
			sections: [
				{
					title: '1. Xử lý đơn hàng',
					items: [
						'Đơn xác nhận trước 15:00 thường được xử lý trong cùng ngày làm việc.',
						'Đơn sau thời điểm trên, cuối tuần hoặc ngày lễ sẽ được chuyển sang ngày làm việc kế tiếp.'
					]
				},
				{
					title: '2. Thời gian giao hàng tham khảo',
					items: [
						'Nội thành các thành phố lớn: khoảng 1-3 ngày làm việc.',
						'Tuyến tỉnh hoặc liên tỉnh: khoảng 2-5 ngày làm việc, tùy khu vực và khả năng phục vụ của đối tác vận chuyển.'
					]
				},
				{
					title: '3. Kiểm tra khi nhận hàng',
					items: [
						'Kiểm tra tình trạng kiện hàng, tem niêm phong, model và số lượng trước khi ký nhận.',
						'Nếu có dấu hiệu móp méo, rách thùng, thiếu phụ kiện hoặc sai hàng, hãy phản hồi ngay với shipper và liên hệ Inoxpran.'
					]
				}
			]
		},
		'warranty-policy': {
			slug: 'warranty-policy',
			kicker: 'Bảo hành',
			title: 'Chính sách bảo hành và cam kết sản phẩm',
			shortTitle: 'Bảo hành 12 tháng',
			metaDescription:
				'Chính sách Bảo hành 12 tháng, cam kết hỗ trợ sản phẩm Inoxpran và quy trình tiếp nhận yêu cầu bảo hành.',
			updatedAtLabel: 'Cập nhật lần cuối',
			updatedAtText: '06/05/2026',
			updatedAtIso: '2026-05-06',
			summary:
				'Inoxpran hỗ trợ Bảo hành 12 tháng cho sản phẩm đủ điều kiện, ưu tiên lỗi kỹ thuật do nhà sản xuất và hướng dẫn sử dụng đúng cách.',
			sections: [
				{
					title: '1. Phạm vi bảo hành',
					items: [
						'Lỗi kỹ thuật do nhà sản xuất phát sinh trong điều kiện sử dụng bình thường.',
						'Hỗ trợ đối soát thông tin đơn hàng, model, số serial hoặc chứng từ mua hàng nếu có.',
						'Tư vấn cách vệ sinh, bảo quản và sử dụng để tăng tuổi thọ sản phẩm.'
					]
				},
				{
					title: '2. Trường hợp không áp dụng',
					items: [
						'Hư hỏng do rơi vỡ, va đập, cháy nổ, sai nguồn điện, tự ý tháo lắp hoặc sử dụng sai hướng dẫn.',
						'Hao mòn thẩm mỹ thông thường như xước nhẹ, ố màu do vệ sinh không đúng cách hoặc dấu vết trong quá trình sử dụng.'
					]
				},
				{
					title: '3. Cách gửi yêu cầu bảo hành',
					items: [
						'Liên hệ hotline hoặc email, gửi mã đơn hàng, hình ảnh/video và mô tả hiện tượng.',
						'Inoxpran phản hồi trong 1 ngày làm việc và hướng dẫn kiểm tra, sửa chữa hoặc đổi sản phẩm nếu đủ điều kiện.'
					]
				}
			]
		},
		'privacy-policy': {
			slug: 'privacy-policy',
			kicker: 'Bảo mật',
			title: 'Chính sách bảo mật thông tin',
			shortTitle: 'Bảo mật thông tin',
			metaDescription:
				'Nguyên tắc thu thập, sử dụng và chia sẻ dữ liệu khách hàng khi mua hàng và nhận hỗ trợ từ Inoxpran.',
			updatedAtLabel: 'Cập nhật lần cuối',
			updatedAtText: '23/03/2026',
			updatedAtIso: '2026-03-23',
			summary:
				'Inoxpran chỉ thu thập những dữ liệu cần thiết để xác nhận đơn hàng, giao hàng, chăm sóc sau bán và xử lý bảo hành, đổi trả.',
			sections: [
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
						'Xác nhận đơn hàng, giao hàng, đối soát thanh toán và chăm sóc khách hàng sau bán.',
						'Tiếp nhận khiếu nại, hỗ trợ bảo hành, đổi trả và cải thiện chất lượng dịch vụ.'
					]
				},
				{
					title: '3. Phạm vi chia sẻ',
					items: [
						'Dữ liệu chỉ được chia sẻ với đơn vị vận chuyển, cổng thanh toán hoặc đối tác công nghệ khi cần thiết để hoàn thành đơn hàng.',
						'Inoxpran không bán hoặc cho thuê dữ liệu cá nhân của khách hàng cho bên thứ ba vì mục đích quảng cáo độc lập.'
					]
				}
			]
		}
	},
	en: {
		'returns-policy': {
			slug: 'returns-policy',
			kicker: 'Returns',
			title: 'Return and refund policy',
			shortTitle: 'Returns & refunds',
			metaDescription:
				'Detailed return and refund conditions, handling timeline and review process for orders placed on the official Inoxpran website.',
			updatedAtLabel: 'Last updated',
			updatedAtText: 'March 23, 2026',
			updatedAtIso: '2026-03-23',
			summary:
				'This policy applies to orders placed on the official Inoxpran website and focuses on manufacturer defects, wrong-item delivery, missing items or transit damage.',
			sections: [
				{
					title: '1. Eligible cases',
					items: [
						'Wrong model, wrong capacity, wrong color, wrong quantity or missing accessories compared with the confirmed order.',
						'Severe dents, cracks or transit damage reported within 48 hours after delivery.',
						'Manufacturer defects detected within 7 days when the product has been used according to instructions.'
					]
				},
				{
					title: '2. Review conditions',
					items: [
						'A valid order code or enough purchase information is required for verification.',
						'Accessories, gifts, manuals and related documents should be returned where available.',
						'The product must not show damage caused by drops, impact, wrong voltage or unauthorized repair.'
					]
				},
				{
					title: '3. Handling process',
					items: [
						'Step 1: contact Inoxpran by hotline or email and send your order code with photos or videos.',
						'Step 2: Inoxpran confirms the request within 1 business day and guides the appropriate inspection path.',
						'Step 3: once approved, Inoxpran will replace the item, suggest an equivalent model with your consent, or issue a refund via the original payment method.'
					]
				},
				{
					title: '4. Shipping cost and refund timeline',
					items: [
						'If the issue is caused by Inoxpran, the manufacturer or the shipping partner arranged by Inoxpran, return shipping is covered by Inoxpran.',
						'Refunds are typically completed within 3-7 business days after approval and return confirmation.'
					]
				}
			]
		},
		'shipping-policy': {
			slug: 'shipping-policy',
			kicker: 'Shipping',
			title: 'Shipping and delivery policy',
			shortTitle: 'Shipping & delivery',
			metaDescription:
				'Order processing time, estimated delivery windows and parcel inspection guidance for Inoxpran deliveries.',
			updatedAtLabel: 'Last updated',
			updatedAtText: 'March 23, 2026',
			updatedAtIso: '2026-03-23',
			summary:
				'Inoxpran processes confirmed orders during business hours and works with shipping partners for nationwide delivery. Actual timing varies by route and peak periods.',
			sections: [
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
						'Provincial and inter-city routes: around 2-5 business days depending on service coverage.'
					]
				},
				{
					title: '3. Parcel inspection on delivery',
					items: [
						'Please inspect parcel condition, seals, model and quantity before accepting the shipment.',
						'If you see dents, torn packaging, missing accessories or the wrong item, report it to the courier immediately and contact Inoxpran.'
					]
				}
			]
		},
		'warranty-policy': {
			slug: 'warranty-policy',
			kicker: 'Warranty',
			title: 'Warranty and product commitment',
			shortTitle: '12-month warranty',
			metaDescription:
				'Inoxpran 12-month warranty support, eligible product issues and the process for submitting warranty requests.',
			updatedAtLabel: 'Last updated',
			updatedAtText: 'May 6, 2026',
			updatedAtIso: '2026-05-06',
			summary:
				'Inoxpran supports eligible products with a 12-month warranty, focused on manufacturer defects and proper-use product issues.',
			sections: [
				{
					title: '1. Warranty scope',
					items: [
						'Technical defects caused by manufacturing under normal use conditions.',
						'Order, model, serial number or purchase-document verification where available.',
						'Usage, cleaning and care guidance to extend product life.'
					]
				},
				{
					title: '2. Exclusions',
					items: [
						'Damage caused by drops, impact, fire, wrong voltage, unauthorized repair or incorrect use.',
						'Normal cosmetic wear such as light scratches, discoloration from improper cleaning or usage marks.'
					]
				},
				{
					title: '3. How to request warranty support',
					items: [
						'Contact the hotline or email with your order code, photos/videos and a short description.',
						'Inoxpran responds within 1 business day and guides inspection, repair or replacement where eligible.'
					]
				}
			]
		},
		'privacy-policy': {
			slug: 'privacy-policy',
			kicker: 'Privacy',
			title: 'Privacy policy',
			shortTitle: 'Privacy policy',
			metaDescription:
				'The data Inoxpran collects, why it is used and how it may be shared to complete orders and support customers.',
			updatedAtLabel: 'Last updated',
			updatedAtText: 'March 23, 2026',
			updatedAtIso: '2026-03-23',
			summary:
				'Inoxpran only collects the data required to confirm orders, deliver products and support after-sales requests such as warranty, returns and complaints.',
			sections: [
				{
					title: '1. Data collected',
					items: [
						'Name, phone number, email, delivery address, order history and support communications.',
						'Basic technical data such as IP address, device type or site interactions when relevant cookies are allowed.'
					]
				},
				{
					title: '2. How the data is used',
					items: [
						'To confirm orders, arrange delivery, reconcile payment and provide after-sales support.',
						'To resolve complaints, warranty and return cases, and improve service quality.'
					]
				},
				{
					title: '3. Data sharing scope',
					items: [
						'Data is shared only with shipping, payment or technology partners when required to complete the order.',
						'Inoxpran does not sell or rent customer personal data to third parties for independent advertising purposes.'
					]
				}
			]
		}
	}
};

export const getPolicyDetail = (locale, slug) => {
	const localeKey = normalizeLocale(locale);
	const policySlug = String(slug || '').trim();
	return POLICY_DETAILS[localeKey]?.[policySlug] || null;
};

export const listPolicyDetails = (locale) => {
	const localeKey = normalizeLocale(locale);
	return POLICY_DETAIL_SLUGS.map((slug) => POLICY_DETAILS[localeKey]?.[slug]).filter(Boolean);
};

export const getPolicyPath = (slug, locale = 'vi') => {
	const localeKey = normalizeLocale(locale);
	return `${localeKey === 'en' ? '/en' : ''}/policies/${encodeURIComponent(String(slug || '').trim())}`;
};

export const getPolicyContactLinks = () => ({
	phoneHref: `tel:${String(SITE_CONTACT.phone || '').replace(/[\s()-]+/g, '')}`,
	emailHref: `mailto:${SITE_CONTACT.email}`
});
