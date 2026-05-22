# Hướng Dẫn Upload Knowledge Base Cho Inoxpran Chatbot 🚀

Bạn vừa tạo một bộ **Product Knowledge Base** đầy đủ với 10 documents chi tiết về sản phẩm Inoxpran. Giờ cần upload nó lên hệ thống để chatbot sử dụng.

## 📋 Các Document Đã Được Tạo:

1. **Về thương hiệu Inoxpran** - Giới thiệu chung
2. **Bếp từ đơn INP6101** - Chi tiết kỹ thuật, tính năng, lợi ích (SẢN PHẨM MÀ USER HỎI)
3. **Nồi Inox INP1001** - Thông tin Everyday Cooking
4. **Chảo Gang INP2104** - Cook & Serve
5. **Nồi Xào INP3005** - Đa năng
6. **Nồi Cao Áp INP6001/INP6003** - Home Appliances
7. **Máy Rửa Bát INP6205** - Convenience  
8. **Nồi Nước Dùng INP6104** - Premium
9. **Hướng dẫn sử dụng Bếp từ INP6101** - Manual chi tiết
10. **Chính sách bảo hành** - Warranty policy
11. **Chính sách giao hàng & đổi trả/** - Shipping policy
12. **Thông tin liên hệ & hỗ trợ** - General policy

## 🔄 Cách 1: Upload Qua Node.js Script (Recommended)

### Bước 1: Chạy upload script

```bash
# Từ thư mục F:/Inoxpran-Website
cd F:\Inoxpran-Website
node upload-knowledge-base.js
```

### Bước 2: Chờ kết quả

Script sẽ:
- ✅ Đọc file `PRODUCT_KNOWLEDGE_BASE.json`
- ✅ Kết nối đến backend API (`http://localhost:3056/v1/api/site-settings/agent-knowledge`)
- ✅ Upload 12 documents
- ✅ Hiển thị kết quả thành công/lỗi

### Output Expected:
```
🚀 Bắt đầu upload Inoxpran Product Knowledge Base...

📚 Chuẩn bị upload 12 documents...
   URL: http://localhost:3056/v1/api/site-settings/agent-knowledge
   Payload size: XXXXX bytes

✅ Upload thành công!
📊 Thông tin:
  - Documents uploaded: 12
  - Categories:
    * Product info: 6
    * Manual: 1
    * Warranty: 1
    * Shipping: 1
    * General: 3
  - Updated at: 2026-04-04T10:00:00Z

💡 Chatbot sẽ cập nhật knowledge trong 5 phút tới
🧪 Thử hỏi chatbot: "Bếp từ đơn INOXPRAN INP6101 có những tính năng gì?"
```

## 🔄 Cách 2: Upload Qua CURL Command (Nếu script có vấn đề)

```bash
curl -X PUT \
  http://localhost:3056/v1/api/site-settings/agent-knowledge \
  -H "Content-Type: application/json" \
  -d @PRODUCT_KNOWLEDGE_BASE.json
```

## 🔄 Cách 3: Upload Qua Admin Panel (Nếu có sẵn)

Nếu website có admin panel:
1. Đăng nhập vào admin
2. Tìm section "Site Settings" hoặc "Chatbot Configuration"
3. Chọn "Agent Knowledge" hoặc "Knowledge Base"
4. Copy nội dung từ `PRODUCT_KNOWLEDGE_BASE.json` vào form
5. Nhấn Save

## ⚙️ Yêu Cầu Trước Upload:

✅ **Backend Server Đang Chạy?**
```bash
# Nếu chưa, mở terminal mới tại thư mục backend
cd F:\Inoxpran-Website\backend
npm run dev
# hoặc
npm start
# Server sẽ chạy ở http://localhost:3056
```

✅ **File .env Có Sẵn?**
- File `F:\Inoxpran-Website\.env` phải tồn tại
- Phải có `OPENAI_API_KEY` để chatbot hoạt động

✅ **Node.js Đã Cài?**
```bash
node --version
# phải trả về v14+ hoặc cao hơn
```

## 📝 Nội Dung Chatbot Sau Upload:

### Trước Upload:
```
User: "Bếp từ đơn INOXPRAN INP6101 có những tính năng gì?"
Chatbot: "Mình chưa có thông tin chi tiết về sản phẩm này..."  ❌
```

### Sau Upload:
```
User: "Bếp từ đơn INOXPRAN INP6101 có những tính năng gì?"
Chatbot: "Bếp từ INP6101 có 10 mức điều chỉnh nhiệt độ từ 65°C đến 200°C, bộ hẹn giờ lên tới 3 giờ, tự động tắt khi không có nồi, và có hiệu suất năng lượng 98%" ✅
```

## 🧪 Cách Test Chatbot:

1. Mở website Inoxpran (localhost:5173)
2. Mở chat widget (góc phải màn hình)
3. Hỏi các câu liên quan đến sản phẩm:
   - "Bếp từ INP6101 bao nhiêu tiền?"
   - "Nồi Inox INP1001 có đảm bảo không?"
   - "Cách sử dụng máy rửa bát INP6205 như thế nào?"
   - "Inoxpran giao những nơi nào?"
   - "Đổi trả sản phẩm cần những gì?"

## 🔄 Cập Nhật Knowledge Base Sau:

Nếu muốn thêm hoặc sửa sản phẩm:

1. Chỉnh sửa file `PRODUCT_KNOWLEDGE_BASE.json`
2. Chạy lại: `node upload-knowledge-base.js`
3. Server sẽ cấp nhật tự động (cache expire 5 phút)

## ⚠️ Troubleshooting:

### Lỗi: "Backend không kết nối được"
```
Solution:
cd F:\Inoxpran-Website\backend
npm run dev
# Hoặc kiểm tra lại URL trong .env
```

### Lỗi: "OPENAI_API_KEY missing"
```
Solution:
1. Mở file .env
2. Kiểm tra có dòng: OPENAI_API_KEY=sk-proj-...
3. Nếu không, thêm nó vào
4. Restart backend server
```

### Lỗi: "JSON Parse Error"
```
Solution:
1. Kiểm tra PRODUCT_KNOWLEDGE_BASE.json có format đúng không
2. Sử dụng: https://jsonlint.com/ để validate
3. Chạy lại upload script
```

### Chatbot Vẫn Không Trả Lời Chi Tiết
```
Solution:
1. Refresh page (Ctrl+F5 hoặc Cmd+Shift+R)
2. Cache được cập nhật mỗi 5 phút
3. Kiểm tra console.log xem có error không
4. Liên hệ nếu vẫn lỗi
```

## 💡 Próximas Enhancements:

- [ ] Thêm trang chỉ dành cho admin để quản lý knowledge base
- [ ] Thêm function to import từ file CSV/Excel
- [ ] Tạo bot có thể giải thích thêm sâu hơn (multi-turn conversation)
- [ ] Thêm sản phẩm mới dễ dàng mà không cần edit JSON
- [ ] Analytics: Track câu hỏi phổ biến nhất

---

**Lưu ý:** Chatbot sẽ cache knowledge base 5 phút. Nếu update, cache sẽ expire tự động trong 5 phút tới.
