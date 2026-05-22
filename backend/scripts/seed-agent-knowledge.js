/**
 * Script to seed agent knowledge for Inoxpran chatbot
 * Run: node scripts/seed-agent-knowledge.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/inoxpran';

const SiteSettingModel = require('../src/models/siteSetting.model');

const KNOWLEDGE_DOCUMENTS = [
	// Product Information
	{
		id: 'hero1-inox304-potset',
		title: 'Bộ nồi Inox 304 5 lớp (Hero 1)',
		category: 'product_info',
		sourceType: 'text',
		sourceName: 'Product Catalog',
		content: `Bộ nồi Inoxpran Hero 1 - Inox 304 với 5 lớp đáy
Chất liệu: Inox 304 (an toàn với thực phẩm)
Đáy: 5 lớp gồm Inox 304 + Nhôm + Sắt từ + Inox 430
Nắp kính: 3.5mm chống sứt mẻ
Tương thích: Bếp từ, bếp gas, bếp hồng ngoại
Công dụng: Nấu nước, nấu cơm, nấu canh, nấu xương cốt, hấp hàng

Ưu điểm:
- Không bị gỉ nhờ Inox 304
- Đáy 5 lớp giúp phân tán nhiệt đều từ đáy đến mép
- Tương thích tất cả loại bếp (bếp gas, bếp từ, bếp hồng ngoại)
- Nắp kính giúp quan sát thực phẩm mà không cần mở nắp
- An toàn cho sức khỏe gia đình`
	},
	{
		id: 'hero2-3ply-frypan',
		title: 'Chảo Inox 3 lớp (Hero 2)',
		category: 'product_info',
		sourceType: 'text',
		sourceName: 'Product Catalog',
		content: `Chảo Inoxpran Hero 2 - Inox 3 lớp
Chất liệu: Inox 304 (bề ngoài), Nhôm 1mm (lõi dẫn nhiệt), Inox 430 (bề trong, từ tính)
Đáy: Unibody construction cho độ bền cao
Nắp: Không có (có thể dùng với nắp kính 24-26cm)
Tương thích: Bếp từ (có từ tính ở lớp đáy)

Ưu điểm:
- Chảo chuyên dụng nấu, chiên, xào
- Nhôm 1mm dẫn nhiệt nhanh và đều
- Cọc cắm xoay dễ dàng, an toàn khi nấu
- Tiết kiệm năng lượng nhờ khả năng dẫn nhiệt tốt`
	},
	{
		id: 'hero3-castironautienam',
		title: 'Nồi cơm Lẩu gang phủ men (Hero 3 - Cook & Serve)',
		category: 'product_info',
		sourceType: 'text',
		sourceName: 'Product Catalog',
		content: `Nồi cơm Lẩu Inoxpran Hero 3 - Gang phủ men Enamel
Chất liệu: Gang ductile phủ men sứ (màu đỏ, xanh, hồng,...)
Nắp: Kính cường lực
Công dụng: Nấu cơm, nấu lẫu, hầm, nướng... Có thể dùng như bát dùng ăn trên bàn

Ưu điểm:
- Có thể nấu rồi dùng luôn làm bát ăn
- Giữ nhiệt lâu, thực phẩm nóng lâu hơn
- Vẻ ngoài sang trọng, đẹp mắt
- Tươi màu, không bế, không phai`
	},
	{
		id: 'hero4-inductionhob',
		title: 'Bếp từ đơn INOXPRAN INP6104',
		category: 'product_info',
		sourceType: 'text',
		sourceName: 'Product Catalog',
		content: `Bếp từ đơn Inoxpran Hero 4 - Model INP6104
Công suất: 2600W
Mặt kính: Kính cường lực chịu lực và sốc nhiệt
Điện áp: 220-240V, 50/60Hz
Kích thước: 320 x 380 x 45mm

Tính năng:
- Nút xoay điều chỉnh nhiệt độ + nút bật/tắt
- Chức năng Booster để nấu nhanh
- Phát hiện tự động nồi nấu có từ tính
- Cảnh báo khi nồi quá nóng
- Chế độ hẹn giờ

Ưu điểm:
- Tiết kiệm điện so với bếp gas
- Nấu nhanh hơn 30%
- An toàn cho gia đình (mặt kính không nóng khi không có nồi)
- Dễ vệ sinh, chỉ cần lau kính`
	},
	{
		id: 'hero5-ricecooker',
		title: 'Nồi cơm điện Inoxpran (Hero 5)',
		category: 'product_info',
		sourceType: 'text',
		sourceName: 'Product Catalog',
		content: `Nồi cơm điện Inoxpran Hero 5
Model: INP6001 (1.8L) và INP6003 (1.2L)
Công suất: 800W (INP6001), 500W (INP6003)
Điện áp: 220-240V, 50/60Hz
Lòng nồi: Inox 304 dày

Tính năng:
- Nước sôi tự động cắt điện (an toàn)
- Chế độ giữ nóm thực phẩm
- 16 chế độ nấu tự động
- Nắp kính trong suốt, dễ quan sát
- Dễ dàng vệ sinh, tháo lắp các bộ phận`
	},
	{
		id: 'hero6-electrickettle',
		title: 'Bình đun nước điện Inox 304 (Hero 6)',
		category: 'product_info',
		sourceType: 'text',
		sourceName: 'Product Catalog',
		content: `Bình đun nước điện Inoxpran Hero 6 - Model INP6205
Chất liệu: Inox 304 thân bình + bộ phận tiếp xúc nước
Công suất: 1200W
Dung tích: 1.8L
Điện áp: 220-240V, 50/60Hz

Tính năng:
- Kính quan sát mức nước sáng rõ
- Công tắc tự động cắt điện khi nước sôi
- Quai cắm xoay 360 độ
- Lỗ đổ nước to, dễ rót
- Có chỉ thị đèn sáng khi đang đun

Ưu điểm:
- Đun nước nhanh chỉ trong 5 phút
- Tiết kiệm điện
- Bền gấp đôi so với inox 201`
	},

	// Usage Manuals
	{
		id: 'manual-inox-potset',
		title: 'Hướng dẫn sử dụng và bảo trì nồi Inox',
		category: 'manual',
		sourceType: 'text',
		sourceName: 'User Manual',
		content: `Hướng dẫn sử dụng bộ nồi Inox 304 Inoxpran

Cách sử dụng:
1. Trước lần sử dụng đầu tiên: Rửa nồi và nắp bằng nước ấm + nước rửa chén nhẹ nhàng
2. Rửa sạch, lau khô trước khi nấu
3. Đựng thực phẩm vào nồi (không vượt quá 3/4 dung tích)
4. Đặt nồi trên bếp, chọn lửa vừa
5. Khi nước sôi, hạ lửa xuống mức thấp
6. Không sử dụng nắp kín nếu không cần

Mẹo nấu ăn:
- Để nước ấm trước khi đặt lên nồi nóng để tránh sốc nhiệt
- Không nên chạy lửa quá lớn (lãng phí năng lượng)
- Sử dụng chảo từ Inoxpran cùng với nồi để tối ưu hóa nấu ăn

Cách bảo trì:
1. Sau mỗi lần dùng, rửa nồi bằng nước ấm + nước rửa chén
2. Lau khi vừa là để tránh mất ẩm
3. Không bao giờ dùng bột mài or vật sắc để cạo bề mặt
4. Nếu bị bám cháy: Đổ nước vào, thêm 1 muỗng baking soda, để 30 phút, rồi rửa sạch
5. Lưu trữ ở nơi khô ráo`
	},
	{
		id: 'manual-inductionhob',
		title: 'Hướng dẫn sử dụng bếp từ INOXPRAN',
		category: 'manual',
		sourceType: 'text',
		sourceName: 'User Manual',
		content: `Hướng dẫn sử dụng bếp từ Inoxpran INP6104

Cách lắp đặt:
1. Đặt bếp trên mặt phẳng, cách các lưỡi quạt thông gió tối thiểu 10cm
2. Kiểm tra điện áp (220-240V)
3. Cắm vào ổ điện tiêu chuẩn

Cách sử dụng:
1. Nhấn nút bật/tắt
2. Đặt nồi từ (có từ tính ở đáy) lên mặt bếp
3. Xoay nút chỉnh nhiệt từ 1-9 (mức 1 = nấu chậm, mức 9 = nấu nhanh)
4. Sử dụng chế độ Booster để sôi nước nhanh hơn

Lưu ý an toàn:
- Chỉ sử dụng với nồi có đáy từ tính
- Không để chi thanh kim loại trên bếp khi đang chạy
- Bếp sẽ nóng, tránh chạm tay vào
- Luôn để ý trẻ em và thú cưng

Rửa sạch:
1. Tắt bếp, chờ mát (ít nhất 5 phút)
2. Lau mặt kính bằng khăn mắt mềm, ẩm
3. Không bao giờ dùng chất axit hay bột mài`
	},

	// Warranty Policy
	{
		id: 'warranty-standard',
		title: 'Chính sách bảo hành Inoxpran',
		category: 'warranty_policy',
		sourceType: 'text',
		sourceName: 'Warranty Policy',
		content: `Chính sách bảo hành Inoxpran

Thời gian bảo hành:
- Sản phẩm nồi, chảo: 2 năm từ ngày mua
- Sản phẩm điện (bếp từ, nồi cơm, bình đun): 1 năm từ ngày mua

Nội dung bảo hành (miễn phí):
- Bị nứt, bể, gỉ không do người dùng gây ra
- Lỗi kỹ thuật trong quá trình sản xuất
- Nắp kính bị nứt (được thay thế 1 lần miễn phí)
- Hỏng hóc liên quan đến cấu trúc đáy

Không bảo hành:
- Sản phẩm bị va đập, rơi vỡ
- Hư hỏng do sử dụng không đúng cách
- Sử dụng với loại bếp không phù hợp
- Hỏng pin, bộ sạc trong bảo hành thiết bị điện
- Lỗi thẩm mỹ (trầy xước bề mặt)

Thủ tục bảo hành:
1. Liên hệ CSKH Inoxpran với hóa đơn mua hàng và ảnh chứng chỉ chất lượng
2. Gửi sản phẩm đến địa chỉ bảo hành được chỉ định
3. Inoxpran sẽ kiểm tra, sửa chữa hoặc thay mới nếu không sửa được
4. Gửi lại sản phẩm cho khách trong vòng 7 ngày làm việc (nếu là lỗi nhà sản xuất)

Chi phí vận chuyển:
- Bảo hành lỗi nhà sản xuất: Inoxpran chịu 100%
- Hỏng hóc do người dùng gây ra: Khách hàng chịu 100%`
	},

	// Shipping & Return Policy
	{
		id: 'shipping-policy',
		title: 'Chính sách giao hàng và đổi trả',
		category: 'shipping_policy',
		sourceType: 'text',
		sourceName: 'Shipping Policy',
		content: `Chính sách giao hàng và đổi trả Inoxpran

Giao hàng:
- Phạm vi: Toàn quốc (63 tỉnh thành)
- Thời gian giao: 1-3 ngày (nội thành), 3-7 ngày (liên tỉnh)
- Phí giao: Tính theo khoảng cách (có thể miễn phí với đơn hàng từ 2 triệu đồng)
- Giao hàng tiêu chuẩn: Giờ hành chính (8-18h, thứ 2-6)

Hình thức giao hàng:
- Giao qua GHTK, Viettel Post, Grab Express
- Có thể giao tận điểm (cơ sở, công ty) hoặc tận nhà
- Có thể giao hàng lấy tiền COD (trả tiền khi nhận)

Đổi trả:
- Thời gian đổi trả: 30 ngày từ ngày mua (với lỗi do nhà sản xuất)
- Lý do đổi trả:
  * Sản phẩm lỗi, hỏng từ lúc nhập kho
  * Giao sai sản phẩm
  * Sản phẩm bị va đập, vỡ do vận chuyển
- Quy trình: Liên hệ CSKH → Gửi ảnh/video → Phê duyệt → Gửi sản phẩm mới

Lưu ý:
- Sản phẩm đổi phải còn nguyên hộp, nilon, chứng chỉ chất lượng
- Không hỗ trợ đổi trả nếu đã hết thời hạn
- Nếu sản phẩm bị vỡ trong kho, Inoxpran sẽ thay hàng mới 100%`
	},

	// General Policy
	{
		id: 'general-about',
		title: 'Thông tin chung về Inoxpran',
		category: 'general_policy',
		sourceType: 'text',
		sourceName: 'Company Info',
		content: `Thông tin chung về Inoxpran

Thương hiệu:
- Tên: Inoxpran
- Xuất xứ: Italy, thành lập năm 1954 tại Brescia
- Gia nhập nhóm PENGO S.p.A từ 2015
- Chuyên về nồi, chảo inox và các sản phẩm phụ vụ nhà bếp

Cam kết:
- Luôn sử dụng Inox 304 an toàn cho sức khỏe
- Đáy 3-5 lớp phân tán nhiệt đều
- Tương thích tất cả loại bếp (gas, từ, điện)
- Đội CSKH 24/7 hỗ trợ khách hàng

Liên hệ:
- Website: inoxpran.com
- Hotline: 1900 XXXX (TBD)
- Email: support@inoxpran.com (TBD)
- Fanpage: facebook.com/inoxpran (TBD)`
	},
	{
		id: 'general-paymentmethods',
		title: 'Phương thức thanh toán tại Inoxpran',
		category: 'general_policy',
		sourceType: 'text',
		sourceName: 'Company Info',
		content: `Phương thức thanh toán

Các phương thức thanh toán khả dụng:
1. Thanh toán trực tiếp (tiền mặt) tại của hàng
2. Chuyển khoản ngân hàng
3. Thanh toán qua thẻ tín dụng / debit card
4. Ví điện tử (Momo, ZaloPay, ViettelPay)
5. COD - Thanh toán khi nhận hàng (phí COD: 0 đồng)
6. Mua trả góp lãi suất 0% (với các ngân hàng hỗ trợ)

Đối với đơn hàng online:
- Mặc định: COD (trả tiền khi nhận)
- Hoặc chuyển khoản ngân hàng trước rồi giao hàng

Lưu ý an toàn:
- Không bao giờ chia sẻ mã OTP, CVV, CVC
- Chỉ thanh toán trên các website chính thức (inoxpran.com)
- Nếu có lỗi thanh toán, liên hệ CSKH ngay`
	}
];

const main = async () => {
	try {
		await mongoose.connect(MONGODB_URI);
		console.log('✓ Connected to MongoDB');

		// Find or create the knowledge setting
		let setting = await SiteSettingModel.findOne({ key: 'agentKnowledge' });

		if (!setting) {
			setting = new SiteSettingModel({
				key: 'agentKnowledge',
				value: {
					documents: KNOWLEDGE_DOCUMENTS
				}
			});
		} else {
			// Update documents, keeping existing ones that are not in our seed
			const existingIds = new Set(setting.value.documents?.map(d => d.id) || []);
			const newDocuments = KNOWLEDGE_DOCUMENTS.filter(d => !existingIds.has(d.id));
			setting.value.documents = [...(setting.value.documents || []), ...newDocuments];
		}

		await setting.save();
		console.log(`✓ Seeded ${KNOWLEDGE_DOCUMENTS.length} knowledge documents`);
		console.log('✓ Agent knowledge base updated successfully');

		await mongoose.disconnect();
		process.exit(0);
	} catch (error) {
		console.error('✗ Error seeding knowledge:', error.message);
		process.exit(1);
	}
};

main();
