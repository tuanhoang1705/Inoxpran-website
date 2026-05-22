# Tổng hợp API của GHTK


Tên biến: OPEN_API
Mô tả: Domain tích hợp open API	
PRODUCTION: https://services.giaohangtietkiem.vn
API Token: 3F1SplMh1nMUTUoQl5jrFJxrEr5pnodAYRM7j3s

Tên biến	    Mô tả
API_TOKEN	    API token lấy được từ web khách hàng của GHTK - URL : CUSTOMER_WEBSITE/web/thong-tin-shop/tai-khoan
PARTNER_CODE	Shop code hoặc mã bí mật dành cho đối tác
MESSAGE     	Thông báo trả về của API
ERROR_MESSAGE	Mô tả lỗi
LOG_ID	        Log iD for tracing
TRACKING_ORDER	Mã đơn hàng GHTK

## 1) Xử lý mã lỗi
Trong quá trình kết nối hệ thống và sử dụng dịch vụ của OpenAPI có thể phát sinh các lỗi không mong muốn. Tài liệu này sẽ mô tả các mã lỗi xác định đối với mục Shipping APIs của chúng tôi

Mẫu request gặp lỗi
Dưới đây là định dạng của một request gặp sự cố đã xác định :


{
    "success": false,
    "message": "{ERROR_MESSAGE}",
    "error_code": "{ERROR_CODE}",
    "log_id": "{LOG_ID}"
}


Trường	Mô tả
ERROR_MESSAGE	Mô tả về lỗi
ERROR_CODE	Mã lỗi, các bạn có thể dùng mã lỗi này để đưa ra các hành vi xử lý tiếp theo cho người dùng ứng dụng của bạn trong trường hợp gặp lỗi
LOG_ID	Log ID - Bạn có thể cung cấp ID lỗi này cho chúng tôi để được hỗ trợ xác định vấn đề lỗi
Danh sách mã lỗi
1. Lỗi hệ thống
HTTP Code	Error Code	Message	Description
500	10101	Đã có lỗi xảy ra!	There was an error during execution
405	10102	Phương thức không hợp lệ	HTTP method is wrong
500	10103	Hệ thống GHTK đang sự cố. Bạn vui lòng liên hệ tại địa chỉ sos.ghtk.vn để được hỗ trợ.	There was an error during execution
404	10104	Đường dẫn không tồn tại, vui lòng thử lại sau	The requested resource/page not found.
405	10105	Yêu cầu không hợp lệ	Method Not Allowed
500		Internal Server Error	The request was not completed due to an internal error on the server side.
503		Service Unavailable	The server was unavailable.
2. Lỗi xác thực
HTTP Code	Error Code	Message	Description
401	20101	Cần cung cấp token hợp lệ	Invalid shop token
401	20102	X-Refer-Token không hợp lệ	x-refer-token is missing information in the request body
3. Lỗi với API tạo đơn hàng
HTTP Code	Error Code	Message	Description
422	30101	Thiếu thông tin đơn hàng	Field order is missing information in the request body
422	30102	Trường order.id phải có độ dài dưới 250 kí tự.	The long of text of field order.id must be less than 250 characters
422	30103	Đơn hàng chưa có khối lượng. Vui lòng kiểm tra lại.	Field order.total_weight is missing information in the request body
422	30104	Phương thức vận chuyển không hợp lệ, ban chỉ có thể chọn road(đường bộ) hoặc fly(đường bay).	Field order.transport is missing information or the value of field order.transport is invalid in the request body
422	30105	Lưu danh sách đơn hàng không thành công. Hãy thử lại. Đơn hàng có mã là ... của khách hàng ..... bị sai khối lượng. GHTK tính theo đơn vị (kg), vui lòng kiểm tra lại thông tin và điền đúng khối lượng của đơn hàng.	Total weight don`t satisfy with the given condition
422	30106	Trường is_freeship có giá trị không hợp lệ.	The value of field order.is_freeship must be 1 or 0
422	30107	Quý khách đã dùng mã ...... cho 1 đơn hàng khác.	The value of field order.id has been used
422	30108	Trường pick_option chỉ nhận một trong hai giá trị cod và post, mặc định là cod, biểu thị lấy hàng bởi COD hoặc Shop sẽ gửi tại bưu cục.	The value of field order.pick_option must be cod or post
422	30110	Giá trị hàng hoá phải lớn hơn 0. Shop vui lòng kê khai chính xác giá trị hàng hoá.	The value of field order.value out of range
422	30201	Số điện thoại lấy hàng không hợp lệ.	Field order.pick_tel in the request body is less than 7 characters
422	30202	Số điện thoại lấy hàng trùng với số điện thoại nhận hàng.	The value of field order.tel and order.pick_tel is duplicate
422	30203	Vui lòng nhập mã sản phẩm.	The value of field order.id is missing information
422	30204	Vui lòng nhập tên người gửi.	The value of field order.pick_name is missing information
422	30205	Vui lòng nhập tiền CoD	The value of field order.pick_money is missing information
422	30206	Vui lòng nhập đúng số tiền CoD.	The value of field order.pick_money is invalid
422	30207	Vui lòng nhập địa chỉ lấy hàng hóa.	The value of field order.pick_money is invalid
422	30208	Vui lòng nhập tên thành phố nơi lấy hàng hóa.	The value of field order.pick_money is invalid
422	30209	Vui lòng nhập tên quận/huyện nơi lấy hàng hóa.	The value of field order.pick_money is invalid
422	30210	Vui lòng nhập điện thoại liên hệ nơi lấy hàng hóa.	The value of field order.pick_money is invalid
422	30301	Số điện thoại khách hàng không hợp lệ.	Field order.tel must be greater than 7 characters in the request body
422	30302	Đơn hàng có mã là ... của khách hàng ... thiếu thông tin địa chỉ thôn/ấp/xóm/tổ/…. Vui lòng kiểm tra lại.	Field order.hamlet is missing information in the request body
422	30303	Vui lòng nhập tên người nhận hàng hóa.	The value of field order.name is missing
422	30304	Vui lòng nhập địa chỉ chi tiết của người nhận hàng hóa.	The value of field order.address is missing
422	30305	Vui lòng nhập tên tỉnh/thành phố của người nhận hàng hóa.	The value of field order.province is missing
422	30306	Vui lòng nhập tên quận/huyện của người nhận hàng hóa.	The value of field district is missing
422	30307	Vui lòng nhập số điện thoại người nhận hàng hóa.	The value of field order.tel is missing
422	30401	Vui lòng nhập tên người nhận hàng trả.	The value of field order.return_name is missing
422	30402	Vui lòng nhập địa chỉ chi tiết của người nhận hàng trả, ví dụ: nhà A, ngõ 100.	Field return_address is missing information in the request body
422	30403	Vui lòng nhập tên tỉnh/thành phố của người nhận hàng trả.	Field order.return_province is missing information in the request body
422	30404	Vui lòng nhập tên quận/huyện của người nhận hàng trả.	Field order.return_district is missing information in the request bodyng
422	30405	Vui lòng nhập số điện thoại người nhận hàng trả.	Field order.return_tel is missing information in the request body
422	30501	Giá trị số lượng ở sản phẩm .... có giá trị không hợp lệ.	The value of field quantity in order.products is invalid
403	30601	Shop chưa được hỗ trợ tính năng này!	The field is_fulfillment and is_economy is invalid for fulfillment order
400	30603	Lưu danh sách đơn hàng không thành công. Hãy thử lại. Đơn hàng có mã là .... của khách hàng .... quá khối lượng. GHTK tính theo đơn vị (kg) và không chuyển hàng > .... kg.	Total weight must be less than given boundary
200	30604	Do tình hình dịch bệnh nên không có chuyến bay phù hợp, bạn vui lòng chọn PTVC Bộ để tiếp tục tạo đơn hàng	Shipping method order.fly will be blocked without shopee express
400	30607	GHTK chưa hỗ trợ giao hàng đơn có số tiền CoD lớn hơn ...đ. Mong quý khách thông cảm!.	The value of field order.pick_money is invalid
400	30608	GHTK chưa hỗ trợ giao hàng đơn có giá trị đóng khai giá lớn hơn .....đ. Mong quý khách thông cảm!.	The value of field order.value is invalid
400	30609	Hiện GHTK phát hiện shop gửi mặt hàng không hợp lệ nên tài khoản của shop sẽ bị vô hiệu hóa việc đăng đơn. Vui lòng liên hệ CSKH để được giải đáp	The order is invalid because of the banned goods
200	30610	Tuyến giao đến ... đang tạm ngưng nhận đơn ...	This address is blocked when you place an order
4. Lỗi cho API in đơn hàng
HTTP Code	Error Code	Message	Description
500	40101	Has an unexpected errors when print label, please retry this request !	There was an error during execution
5. Lỗi cho API huỷ đơn hàng
HTTP Code	Error Code	Message	Description
200	50101	Đơn hàng đã ở trạng thái hủy	This order has been cancel before (packages.package_status_id = 11)
200	50102	Đơn đã lấy hàng, không thể hủy đơn.	If the goods has arrived at the warehouse (packages.package_status_id = 3), the OPM order cannot be canceled
200	50103	Đơn đã điều phối giao hàng/đang giao hàng, không thể hủy đơn.	If the goods is delivering (packages.package_status_id = 4), the order cannot be canceled
200	50104	Đơn đã giao hàng/chưa đối soát, không thể hủy đơn.	If the goods is delivered (packages.package_status_id = 5), the order cannot be canceled
200	50105	Đơn đã đối soát, không thể hủy đơn.	If the goods is debt reconciliation (packages.package_status_id = 6), the order cannot be canceled
200	50106	Đơn đã điều phối lấy hàng/đang lấy hàng, không thể hủy đơn.	If the goods is arrving to the warehouse (packages.package_status_id = 12), the order cannot be canceled
200	50107	Không thể hủy đơn hàng ....	The package (order) is invalid
500	50108	Lỗi, vui lòng thử lại sau!	There was an error during order cancellation
400	50109	Không tìm thấy vận đơn trên hệ thống	Not found the order in the system
6. Lỗi cho API tính phí
HTTP Code	Error Code	Message	Description
422	Updating ..	Xin hãy gửi trường district.	Field district is required
422	Updating ..	Xin hãy gửi trường province.	Field province is required
422	Updating ..	Xin hãy gửi trường pick_district.	Field pick_district is required
422	Updating ..	Xin hãy gửi trường pick_province.	Field pick_province is required


## 2) API đăng đơn

Đối tác gửi danh sách đơn hàng sang hệ thống của Giaohangtietkiem thông qua APIs. Sau khi các đơn hàng được lưu thành công vào hệ thống của GHTK, hệ thống sẽ trả về danh sách đơn hàng tương ứng chứa các thông tin liên quan của mỗi đơn hàng.

Đường dẫn
POST /services/shipment/order

Headers
Token: {API_TOKEN}
X-Client-Source: {PARTNER_CODE}

HTTP
CURL
PHP
POST /services/shipment/order/?ver=1.5 HTTP/1.1
Token: APITokenSample-ca441e70288cB0515F310742
X-Client-Source: S308157
Content-Type: application/json
{
  "products": [{
    "name": "bút",
    "weight": 0.1,
    "quantity": 1,
    "product_code": 1241
  }, {
    "name": "tẩy",
    "weight": 0.2,
    "quantity": 1,
    "product_code": 1254
  }],
  "order": {
    "id": "a4",
    "pick_name": "HCM-nội thành",
    "pick_address": "590 CMT8 P.11",
    "pick_province": "TP. Hồ Chí Minh",
    "pick_district": "Quận 3",
    "pick_ward": "Phường 1",
    "pick_tel": "0911222333",
    "tel": "0911222333",
    "name": "GHTK - HCM - Noi Thanh",
    "address": "123 nguyễn chí thanh",
    "province": "TP. Hồ Chí Minh",
    "district": "Quận 1",
    "ward": "Phường Bến Nghé",
    "hamlet": "Khác",
    "is_freeship": "1",
    "pick_date": "2016-09-30",
    "pick_money": 47000,
    "note": "Khối lượng tính cước tối đa: 1.00 kg",
    "value": 3000000,
    "transport": "fly",
    "pick_option": "cod", // Đơn hàng xfast yêu cầu bắt buộc pick_option là COD
    "gam_solutions": [
      { "solution_id": 12365478 },
      { "solution_id": 12365479 },
      { "solution_id": 12365470 }
    ]
  }
}

Các tham số
Tham số	Bắt buộc	Mô tả
order	yes	Object - thông tin đơn hàng gửi sang GHTK
products	yes	Array - Danh sách các sản phẩm, mô tả tham số của từng sản phẩm xem trong bảng tiếp theo
order.id	yes	String - mã đơn hàng thuộc hệ thống của đối tác
Thông tin điểm lấy hàng		
order.pick_name	yes	String - Tên người liên hệ lấy hàng hóa
order.pick_money	yes	Integer - Số tiền CoD. Nếu bằng 0 thì không thu tiền CoD. Tính theo VNĐ
order.pick_address_id	no	String - ID địa điểm lấy hàng của shop trong trang quản lý đơn hàng dành cho khách hàng. Nếu trường này khác rỗng sẽ được ưu tiên sử dụng
order.pick_address	yes	String - Địa chỉ ngắn gọn để lấy nhận hàng hóa. Ví dụ: nhà số 5, tổ 3, ngách 11, ngõ 45
order.pick_province	yes	String - Tên tỉnh/thành phố nơi lấy hàng hóa
order.pick_district	yes	String - Tên quận/huyện nơi lấy hàng hóa
order.pick_ward	no	String - Tên phường/xã nơi lấy hàng hóa
order.pick_street	no	String - Tên đường/phố nơi lấy hàng hóa
order.pick_tel	yes	String - Số điện thoại liên hệ nơi lấy hàng hóa
order.pick_ext_tel	no	String - Số máy lẻ của số điện thoại chính tại nơi lấy hàng
order.pick_email	no	String - Email liên hệ nơi lấy hàng hóa
Thông tin điểm giao hàng		
order.name	yes	String - tên người nhận hàng
order.address	yes	String - Địa chỉ chi tiết của người nhận hàng, ví dụ: Chung cư CT1, ngõ 58, đường Trần Bình
order.province	yes	String - Tên tỉnh/thành phố của người nhận hàng hóa
order.district	yes	String - Tên quận/huyện của người nhận hàng hóa
order.ward	yes	String - Tên phường/xã của người nhận hàng hóa
order.street	yes if no order.hamlet	String - Tên đường/phố của người nhận hàng hóa (Bắt buộc khi không có thôn/ấp/xóm/tổ/...)
order.hamlet	yes if no order.street	String - Tên thôn/ấp/xóm/tổ/... của người nhận hàng hóa. Nếu không có, vui lòng điền "Khác" (Bắt buộc khi không có đường/phố)
order.tel	yes	String - Số điện thoại người nhận hàng hóa
order.ext_tel	no	String - Số máy lẻ của số điện thoại chính của người nhận hàng
order.note	no	String - Ghi chú đơn hàng. Vd: Khối lượng tính cước tối đa: 1.00 kgTừ 24/2/2020 ghi chú tối đa cho phép là 120 kí tự
order.email	no	String - Email người nhận hàng hóa
Thông tin điểm trả hàng		
order.use_return_address	no	Integer - mặc định là 0. Field này có thể truyền vào một trong hai giá trị 0 hoặc 1. Bằng 0 nghĩa là địa chỉ trả hàng giống địa chỉ lấy hàng nên các field địa chỉ trả hàng không cần truyền qua. Bằng 1 nghĩa là sử dụng địa chỉ trả hàng khác địa chỉ lấy hàng và cần truyền vào giá trị cho các field tiếp theo
order.return_name	yes	String - tên người nhận hàng trả
order.return_address	yes	String - Địa chỉ chi tiết của người nhận hàng, ví dụ: nhà A, ngõ 100
order.return_province	yes	String - Tên tỉnh/thành phố của người nhận hàng hóa
order.return_district	yes	String - Tên quận/huyện của người nhận hàng hóa
order.return_ward	no	String - Tên phường/xã của người nhận hàng hóa
order.return_street	no	String - Tên đường/phố của người nhận hàng hóa
order.return_tel	yes	String - Số điện thoại người nhận hàng hóa
order.return_email	no	String - Email người nhận hàng hóa
Các thông tin thêm		
order.is_freeship	no	Integer - Thông tin người trả phí ship. Nếu bằng 1 thì shop trả ship, shipper sẽ chỉ thu người nhận hàng số tiền bằng pick_money, nếu bằng 0 thì người nhận trả ship, shipper sẽ thu tiền người nhận số tiền bằng pick_money + phí ship của đơn hàng, giá trị mặc định bằng 0
order.weight_option	no	String - nhận một trong hai giá trị gram và kilogram, mặc định là kilogram, đơn vị khối lượng của các sản phẩm có trong gói hàng
order.total_weight	no	Double - Tổng khối lượng của đơn hàng, mặc định sẽ tính theo products.weight nếu không truyền giá trị này.
order.pick_work_shift	no	Integer - Ca lấy hàng mong muốn. Nếu bằng 1 là lấy buổi sáng, 2 là lấy buổi chiều. GHTK sẽ tính toán theo từng gói dịch vụ nếu không truyền field này
order.deliver_work_shift	no	Integer - Ca giao hàng mong muốn. Nếu bằng 1 là giao buổi sáng, 2 là giao buổi chiều. GHTK sẽ tính toán theo từng gói dịch vụ nếu không truyền field này
order.label_id	no	String - Mã vận đơn được cấp trước cho đối tác - mặc định không sử dụng được field này, cấu hình riêng cho từng gói dịch vụ
order.pick_date	no	String YYYY/MM/DD - Ngày lấy hàng mong muốn. GHTK sẽ tính toán theo từng gói dịch vụ nếu không truyền field này
order.deliver_date	no	String YYYY/MM/DD - Ngày giao hàng mong muốn. GHTK sẽ tính toán theo từng gói dịch vụ nếu không truyền field này
order.value	yes	Interger (VNĐ) - Giá trị đóng khai giá, là căn cứ để tính phí khai giá và bồi thường khi có sự cố.
order.opm	no	Interger (VNĐ) - 1. đơn chỉ thu tiền, 0. default
order.pick_option	no	String - Nhận một trong hai giá trị cod và post, mặc định là cod, biểu thị lấy hàng bởi COD hoặc Shop sẽ gửi tại bưu cục
order.actual_transfer_method	no	String - Trường này lưu đường vận chuyển của đơn hàng, mặc định là đường bay (fly). Nếu đơn hàng được chuyển bằng đường bộ (road), bạn sẽ nhận được thông báo của GHTK.
order.transport	no	String - Phương thức vâng chuyển road ( bộ ) , fly (bay). Nếu phương thức vận chuyển không hợp lệ thì GHTK sẽ tự động nhảy về PTVC mặc định
order.tags	no	Array - Gắn nhãn cho đơn hàng, truyền lên mảng, mô tả nhãn đơn hàng trong bảng tiếp theo
order.sub_tags	no	Array - Chi tiết nhãn đơn hàng, truyền lên mảng (Bắt buộc gửi lên khi gán nhãn hàng cây cối cho đơn hàng)
order.total_box	no	Integer - Tổng số lượng kiện hàng trong đơn
order.gam_solutions	no	Array - Danh sách ID giải pháp Gam
Tham số products
Tham số	Bắt buộc	Mô tả
name	yes	String - Tên hàng hóa
price	no	Integer - Giá trị hàng hóa
weight	yes	Double - Khối lượng hàng hóa Tính theo đơn vị KG
quantity	no	Integer - Số lượng hàng hóa
product_code	no	String - Mã sản phẩm được lấy từ api lấy danh sách thông tin sản phẩm
height	no	Double - Chiều cao của sản phẩm (đơn vị: cm)
width	no	Double - Chiều rộng của sản phẩm (đơn vị: cm)
length	no	Double - Chiều dài của sản phẩm (đơn vị: cm)
Mô tả nhãn đơn hàng tags
Nhãn đơn hàng	Mô tả	Chi tiết
2	Giá trị cao/Đặc biệt	Những mặt hàng có giá trị hàng hoá > 3,000,000đ (với shop B2C) và > 1,000,000đ (với shop C2C). Các hàng hoá giá trị cao sẽ tính thêm phí khai giá là khoản khai giá cho các rủi ro trong quá trình vận chuyển hoặc lưu kho. Phí khai giá bằng 0.5% giá trị hàng hoá. GHTK sẽ bồi hoàn 100% giá trị khai giá khi mất hàng (tối đa 20,000,000 VNĐ) nếu có giấy tờ chứng minh nguồn gốc và giá trị hàng hoá (hoá đơn nhập hàng, hoá đơn mua hàng hợp lệ và khớp với thông tin sản phẩm trên hệ thống GHTK,...). Trong trường hợp shop không thể chứng minh nguồn gốc và giá trị hàng hoá, bồi thường tối đa 04 lần cước phí vận chuyển.
10	Cho xem hàng	Khách hàng được xem sản phẩm trước khi nhận hàng
13	Gọi shop khi khách không nhận hàng	Nhân viên GHTK sẽ liên hệ với shop nếu gặp vấn đề như: sai thông tin người nhận, không liên lạc được, KH từ chối nhận hàng
17	Giao hàng 1 phần chọn sản phẩm	Hỗ trợ khách chỉ nhận và trả tiền 1 phần hàng. Phần còn lại sẽ được trả về shop với mức phí nội tỉnh = 5.000đ/đơn, liên tỉnh = 50% phí ship
18	Giao hàng 1 phần đổi trả hàng	Hỗ trợ giao 1 sản phẩm đến cho KH và mang phần hàng còn lại trả về shop. Phí ship của đơn hàng sẽ do shop và KH thỏa thuận (mặc định bằng phí ship). Phần hàng mang về cho shop được xem như đơn hàng trả với mức phí nội tỉnh = 5.000đ/đơn, liên tỉnh = 50% phí ship.
19	Không giao được thu phí	Hỗ trợ KH không nhận sản phẩm nhưng thu một phần phí cho shop. Phí cần thu mặc định bằng phí ship, shop có thể sửa giá trị tiền cần thu theo mong muốn của mình. Phần hàng mang về cho shop được xem như đơn hàng trả với mức phí nội tỉnh = 5.000đ/đơn, liên tỉnh = 50% phí ship, Lưu ý: Đối tác cần truyền thêm trường not_delivered_fee với giá trị 0 < not_delivered_fee <= 20,000,000đ
62	Giao hàng 1 phần thu hồi chứng từ	Hỗ trợ giao sản phẩm đến cho khách hàng và mang chứng từ (hóa đơn, giấy tờ) kèm theo phần hàng còn lại về cho shop.
Mô tả nhãn đơn hàng sub_tags
Chi tiết nhãn đơn hàng	Mô tả
1	Hạt giống
2	Cây non
3	Cây có bầu
4	Cây có chậu dễ vỡ
5	Các loại cây khác
Phản hồi
Kết quả trả về khi đăng đơn thành công:

{
  "success": true,
  "message": "",
  "order": {
    "partner_id": "123123a",
    "label": "S1.A1.2001297581",
    "area": "1",
    "fee": "30400",
    "insurance_fee": "15000",
    "tracking_id": 2001297581,
    "estimated_pick_time": "Sáng 2017-07-01",
    "estimated_deliver_time": "Chiều 2017-07-01",
    "products": [],
    "status_id": 2
  }
}

Trường hợp có lỗi

{
  "success": false,
  "message": "Chưa có thông tin order"
}

warning
Quy trình của GHTK không cho phép một mã đơn được đẩy lại nếu trước đấy đã đăng thành công trên hệ thống GHTK Trường hợp lỗi order.id đã có trên hệ thống GHTK, API sẽ trả về lỗi, kèm các thông tin

partner_id: mã đơn hàng của đối tác
ghtk_label: nhãn đơn của GHTK
created: thời gian đơn hàng được tạo
status: trạng thái hiện tại của đơn hàng
{
  "success": false,
  "message": "Mã đơn hàng của bạn đã tồn tại trên hệ thống GHTK",
  "error": {
      "code" : "ORDER_ID_EXIST",
      "partner_id" : "a4", // id trong request đẩy sang của bạn
      "ghtk_label": "S1.A1.1737345", // nhãn đơn GHTK, tương ứng với id của bạn
      "created": "2016-11-02T12:18:39+07:00",
      "status": 5  // trạng thái đơn hàng hiện tại trên hệ thống GHTK, tra bảng mã trạng thái đơn trong phần webhook
  }
}

Lưu ý


## 3) API trạng thái đơn hàng

API dùng để lấy trạng thái hiện tại của 1 mã vận đơn GHTK

Mô tả
Sau khi đơn hàng được gửi tới hệ thống của Giaohangtietkiem. Khách hàng có thể kiểm tra trạng thái các đơn hàng dựa vào mã đơn hàng.

Request
Đường dẫn
GET /services/shipment/v2/{TRACKING_ORDER}

Headers
Token: {API_TOKEN}
X-Client-Source: {PARTNER_CODE}

Tham số
Tham số	Bắt buộc	Mô tả
TRACKING_ORDER	Có	Mã đơn hàng GHTK hoặc mã Đối tác được truyền qua ở trường order.id ở API đăng đơn
Code
HTTP
CURL
PHP
GET /services/shipment/v2/S1.A1.17373471 HTTP/1.1
Token: {API_TOKEN}
X-Client-Source: {PARTNER_CODE}

Phản hồi
Kết quả trả về
Hệ thống sẽ trả về kết quả dưới dạng JSON. Kết quả trả về được mô tả như sau:

Tham số	Mô tả
label_id	String - Mã đơn hàng của hệ thống GHTK
partner_id	String - Mã đơn hàng thuộc hệ thống của đối tác
status	String - Mã trạng thái đơn hàng. Tham khảo bảng mã trạng thái đơn hàng
status_text	String - Trạng thái đơn hàng.
created	String - Thời gian tạo đơn hàng, định dạng YY-MM-DD hh:mm:ss
modified	String - Thời gian cuối cùng cập nhật đơn hàng, định dạng YY-MM-DD hh:mm:ss
message	String - Ghi chú của đơn hàng
pick_date	String - Ngày hẹn lấy hàng của đơn hàng nếu có, nếu đơn hàng đã được lấy thành công thì là ngày lấy hàng
deliver_date	String - Ngày hẹn giao đơn hàng nếu có, nếu đơn hàng đã được giao hàng thì là ngày giao hàng thành công
customer_fullname	String - Họ tên người nhận hàng
customer_tel	String - Số điện thoại người nhận hàng
address	String - Địa chỉ người nhận hàng
storage_day	Integer - Số ngày giữ đơn hàng tại kho GHTK trước khi trả hàng
ship_money	Integer - Phí giao hàng
insurance	Integer - Phí khai giá
value	Integer - Giá trị đóng khai giá - căn cứ để bồi thường cho người gửi khi có sự cố xảy ra
weight	Integer - Khối lượng đơn hàng tính theo gram
pick_money	Integer - Số tiền CoD
is_freeship	Integer - Freeship cho người nhận hàng
Thành công
{
    "success": true,
    "message": "",
    "order": {
        "label_id": "S1.A1.17373471",
        "partner_id": "1234567",
        "status": "1",
        "status_text": "Chưa tiếp nhận",
        "created": "2016-10-31 22:32:08",
        "modified": "2016-10-31 22:32:08",
        "message": "Không giao hàng 1 phần",
        "pick_date": "2017-09-13",
        "deliver_date": "2017-09-14",
        "customer_fullname": "Vân Nguyễn",
        "customer_tel": "0911222333",
        "address": "123 nguyễn chí thanh Quận 1, TP Hồ Chí Minh",
        "storage_day": "3",
        "ship_money": "16500",
        "insurance": "16500",
        "value": "3000000",
        "weight": "300",
        "pick_money": 47000,
        "is_freeship": "1"
    }


## 4) API danh sách giải pháp

PATH

GET /open/api/v1/shop/solution/list

Header

Token: {API_TOKEN}
X-Client-Source: {PARTNER_CODE}
Content-Type: application/json
Sample Request

curl --location '{OPEN_API}/open/api/v1/shop/solution/list' \
--header 'Token: {API_TOKEN}' \
--header 'X-Client-Source: {PARTNER_CODE}' \
--header 'Content-Type: application/json'

Response Success

{
    "success": true,
    "data": [
        {
            "solution_id": 1340164168838205440,
            "description": "Giúp shop đảm bảo ngoại quan sản phẩm được giữ nguyên vẹn trong suốt quá trình vận chuyển.",
            "group_name": "Gói giải pháp an toàn hàng hoá toàn diện"
        },
        {
            "solution_id": 1341971770371706880,
            "description": "Giúp shop đảm bảo ....",
            "group_name": "Gói giải pháp an toàn hàng hoá toàn diện"
        },
        {
            "solution_id": 1341971857508372480,
            "description": "Giúp shop đảm bảo .... và....",
            "group_name": "Gói giải pháp an toàn hàng hoá toàn diện"
        }
    ],
    "message": "Thành công!",
    "code": 200,
    "rid": "dd663be1c8d0"
}

Parameter	Datatype	Description
solution_id	Long	ID giải pháp
description	String	Mô tả giải pháp
group_name	String	Tên nhóm giải pháp
Response Fail

{
    "success": true,
    "data": [],
    "code": 200,
    "rid": "edd77bd18366"
}

## 5) API tính phí

API dùng để thực hiện tính toán phí ship và các phụ phí liên quan đến đơn hàng dựa trên các thông tin như địa chỉ lấy hàng, địa chỉ giao hàng, cân nặng, dịch vụ đơn hàng đã chọn ...

Request
Đường dẫn
GET /services/shipment/fee

Headers
Token: {API_TOKEN}
X-Client-Source: {PARTNER_CODE}

Tham số
Tham số	Bắt buộc	Mô tả
pick_address_id	no	String - ID địa điểm lấy hàng của shop trong trang quản lý đơn hàng dành cho khách hàng. Nếu trường này khác rỗng sẽ được ưu tiên sử dụng
pick_address	no	String - Địa chỉ ngắn gọn để lấy nhận hàng hóa. Ví dụ: nhà số 5, tổ 3, ngách 11, ngõ 45
pick_province	yes	String - Tên tỉnh/thành phố nơi lấy hàng hóa
pick_district	yes	String - Tên quận/huyện nơi lấy hàng hóa
pick_ward	no	String - Tên phường/xã nơi lấy hàng hóa
pick_street	no	String - Tên đường/phố nơi lấy hàng hóa
address	no	String - Địa chỉ chi tiết của người nhận hàng, ví dụ: Chung cư CT1, ngõ 58, đường Trần Bình
province	yes	String - Tên tỉnh/thành phố của người nhận hàng hóa
district	yes	String - Tên quận/huyện của người nhận hàng hóa
ward	no	String - Tên phường/xã của người nhận hàng hóa
street	no	String - Tên đường/phố của người nhận hàng hóa
weight	yes	Integer - Cân nặng của gói hàng, đơn vị sử dụng Gram
value	no	Integer - Giá trị thực của đơn hàng áp dụng để tính phí khai giá, đơn vị sử dụng VNĐ
transport	no	String - Phương thức vâng chuyển road ( bộ ) , fly (bay). Nếu phương thức vận chuyển không hợp lệ thì GHTK sẽ tự động nhảy về PTVC mặc định
tags	no	array - Gắn nhãn cho đơn hàng. Truyền giá trị nhãn đơn hàng vào mảng tags
Code
HTTP
CURL
PHP
GET /services/shipment/fee?address=P.503%20t%C3%B2a%20nh%C3%A0%20Auu%20Vi%E1%BB%87t,%20s%E1%BB%91%201%20L%C3%AA%20%C4%90%E1%BB%A9c%20Th%E1%BB%8D&province=H%C3%A0%20n%E1%BB%99i&district=Qu%E1%BA%ADn%20C%E1%BA%A7u%20Gi%E1%BA%A5y&pick_province=H%C3%A0%20N%E1%BB%99i&pick_district=Qu%E1%BA%ADn%20Hai%20B%C3%A0%20Tr%C6%B0ng&weight=1000&value=3000000 HTTP/1.1
Token: {API_TOKEN}
X-Client-Source: {PARTNER_CODE}


Phản hồi
Các thông tin trả về
Tham số	Mô tả
fee.name	String - Tên gói cước được áp dụng, các giá trị có thể: area1, area2, area3
fee.fee	Integer - Cước vận chuyển tính theo VNĐ
fee.insurance_fee	Integer - Giá khai giá tính theo VNĐ
fee.delivery	Boolean - Hỗ trợ giao ở địa chỉ này chưa, nếu điểm giao đã được GHTK hỗ trợ giao trả về true, nếu GTHK chưa hỗ trợ giao đến khu vực này thì trả về false
Thành công
{
  "success": true,
  "message": "",
  "fee": {
    "name": "area1",
    "fee": 30400,
    "insurance_fee": 15000,
    "delivery_type": "only_hanoi",
    "a": 3,
    "dt": "local",
    "extFees": [
      {
        "display": "(+ 7,400 đ)",
        "title": "Phụ phí hàng dễ vỡ",
        "amount": 7400,
        "type": "fragile"
      },
      {
        "display": "(+ 13,400 đ)",
        "title": "Phụ phí hàng nông sản/thực phẩm khô",
        "amount": 13400,
        "type": "food"
      }
    ],
    "delivery": true
  }
}

## 6) API in nhãn đơn hàng
Request
Đường dẫn
GET /services/label/{TRACKING_ORDER}?original={ORIGINAL}&page_size={PAGE_SIZE}

Headers
Token: {API_TOKEN}
X-Client-Source: {PARTNER_CODE}

Tham số
Tham số	Bắt buộc	Mô tả
TRACKING_ORDER	Có	Mã vận đơn GHTK
ORIGINAL	Không	String - Kiểu in nhãn portrait (in dọc) hoặc landscape (in ngang) (mặc định là portrait)
PAGE_SIZE	Không	String - Khổ in của nhãn A5, A6 (mặc định là A6)
Code
HTTP
CURL
PHP
GET /services/label/{TRACKING_ORDER} HTTP/1.1
Token: {API_TOKEN}
X-Client-Source: {PARTNER_CODE}

Phản hồi
Kết quả trả về
Hệ thống sẽ trả về kết quả dưới dạng binary file PDF. Kết quả trả về được mô tả như sau:

Thành công
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename=""
Content-Transfer-Encoding: binary

Trường hợp có lỗi
Kết quả sẽ trả về với định dạng JSON

{
    "success": false,
    "message": "Mã vận đơn không hợp lệ, không tìm thấy vận đơn"
}

## 7) API huỷ đơn hàng

API dùng để huỷ 1 đơn hàng đã đẩy lên hệ thống GHTK

Endpoint
TH dùng mã vận đơn GHTK

POST /services/shipment/cancel/{TRACKING_ORDER}

warning
Trong trường hợp dùng mã đối tác ( Mã order.id được truyền qua lúc đăng đơn), vui lòng sử dụng theo format dưới đây

TRACKING_ORDER = partner_id:PARTNER_CODE
POST /services/shipment/cancel/partner_id:{PARTNER_CODE}

Headers
Token: {API_TOKEN}
X-Client-Source: {PARTNER_CODE}
Content-Type: application/json
Tham số
Tham số	Bắt buộc	Mô tả
TRACKING_ORDER	Có	Mã đơn hàng GHTK hoặc mã Đối tác được truyền qua ở trường order.id ở API đăng đơn
Code
HTTP
CURL
PHP
GET /services/shipment/cancel/{TRACKING_ORDER} HTTP/1.1
Token: {API_TOKEN}
X-Client-Source: {PARTNER_CODE}

Phản hồi
Huỷ thành công
{
  "success": true,
  "message": "",
  "log_id": "..."
}

Đơn hàng đã huỷ
{
  "success": false,
  "message": "Đơn hàng đã đã ở trạng thái hủy",
  "log_id": "..."
}

Các trường hợp không thể huỷ đơn
cảnh báo
Các trạng thái sau khi đơn hàng được lấy thành công sẽ không thể huỷ được, API chỉ có thể huỷ đơn ở các trạng thái sau :

Trạng thái chưa tiếp nhận (1)
Trạng thái đã tiếp nhận (2)
Trạng thái đang lấy hàng (12)
{
  "success": false,
  "message": "Đơn đã lấy hàng, không thể hủy đơn.",
  "log_id": "..."
}