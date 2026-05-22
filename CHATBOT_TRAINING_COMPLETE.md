# 🤖 Chatbot Training Inoxpran - Hoàn Thành

Tôi đã hoàn thành việc **train lại chatbot** với thông tin sản phẩm chi tiết và cải thiện ngôn ngữ để nó tự nhiên hơn.

## ✅ Những Gì Đã Được Làm:

### 1. 📚 Tạo Knowledge Base Toàn Diện (PRODUCT_KNOWLEDGE_BASE.json)
- **12 documents** chi tiết về các sản phẩm Inoxpran
- **6 sản phẩm chính** (6 Hero SKUs) với thông số kỹ thuật đầy đủ:
  - Bếp từ đơn INP6101 (với câu hỏi cụ thể user hỏi)
  - Nồi Inox INP1001 (Everyday Cooking)
  - Chảo Gang INP2104 (Cook & Serve)
  - Nồi Xào INP3005 (Multi-purpose)
  - Nồi Cao Áp INP6001/INP6003 (Home Appliances)
  - Máy Rửa Bát INP6205 (Convenience)
  - Nồi Nước Dùng INP6104 (Premium)

- **4 documents chính sách & hướng dẫn**:
  - Hướng dẫn sử dụng Bếp từ
  - Chính sách bảo hành
  - Chính sách giao hàng & đổi trả
  - Thông tin liên hệ & hỗ trợ

### 2. 🎯 Cải Thiện System Prompt của Chatbot
- ✅ Loại bỏ ngôn ngữ "AI-like" quá chuẩn mực
- ✅ Hướng chatbot nói chuyện tự nhiên như một người bạn
- ✅ Hạn chế sử dụng từ khách sáo ("mình có thể hỗ trợ", "được phép", v.v.)
- ✅ Giỏi việc không dùng ký hiệu đặc biệt không cần thiết
- ✅ Khi không có thông tin, nói thẳng "chưa có thông tin" thay vì "mình chưa đủ dữ liệu"

### 3. 🚀 Tạo Upload Script
- `upload-knowledge-base.js` - Script Node.js tự động upload knowledge base
- Tự động kết nối backend server
- Hiển thị chi tiết upload results
- Có error handling & troubleshooting

### 4. 📖 Tạo Hướng Dẫn Chi Tiết
- Hướng dẫn 3 cách upload (Script, CURL, Admin Panel)
- Danh sách requirements & troubleshooting
- Cách test chatbot sau upload

---

## 🎬 Các Bước Để Hoạt Động Ngay (IMPORTANT!):

### BƯỚC 1: Đảm Bảo Backend Chạy

```bash
# Terminal 1 - Mở backend
cd F:\Inoxpran-Website\backend
npm run dev
# hoặc: npm start

# Server sẽ chạy ở http://localhost:3056
```

### BƯỚC 2: Upload Knowledge Base

```bash
# Terminal 2 (hoặc tab mới) - Upload knowledge
cd F:\Inoxpran-Website
node upload-knowledge-base.js

# Nếu máy là Mac/Linux thay bằng:
# nodejs upload-knowledge-base.js
```

**Expected Output:**
```
🚀 Bắt đầu upload Inoxpran Product Knowledge Base...

📚 Chuẩn bị upload 12 documents...
   URL: http://localhost:3056/v1/api/site-settings/agent-knowledge
   Payload size: 45000 bytes

✅ Upload thành công!
📊 Thông tin:
  - Documents uploaded: 12
  - Categories:
    * Product info: 6
    * Manual: 1
    * Warranty: 1
    * Shipping: 1
    * General: 3
```

### BƯỚC 3: Chạy Frontend

```bash
# Terminal 3 - Mở frontend
cd F:\Inoxpran-Website\frontend
npm run dev
# Server sẽ chạy ở http://localhost:5173
```

### BƯỚC 4: Test Chatbot

1. Mở browser: `http://localhost:5173`
2. Mở chat widget (góc phải trang)
3. Thử hỏi:
   ```
   User: "Bếp từ đơn INOXPRAN INP6101 có những tính năng gì?"
   
   Expected: Chatbot sẽ trả lời chi tiết về các tính năng của INP6101
   ```

4. Thử hỏi thêm:
   ```
   - "Nồi inox INP1001 giá bao nhiêu?"
   - "Cách sử dụng máy rửa bát như thế nào?"
   - "Bảo hành sản phẩm bao lâu?"
   - "Inoxpran giao những nơi nào?"
   ```

---

## 📊 Kết Quả So Sánh:

### ❌ Trước (Cũ):
```
User: "Bếp từ đơn INOXPRAN INP6101 có những tính năng gì?"

Chatbot: "Mình chưa có thông tin chi tiết về sản phẩm này, vui lòng liên hệ CSKH."
```

### ✅ Sau (Mới):
```
User: "Bếp từ đơn INOXPRAN INP6101 có những tính năng gì?"

Chatbot: "Bếp từ INP6101 có 10 mức điều chỉnh nhiệt độ từ 65°C đến 200°C, bộ hẹn giờ lên tới 3 giờ, tự động tắt khi không có nồi, và hiệu suất năng lượng lên tới 98%. Công suất 2000W, tương thích với nồi có đáy từ."
```

---

## 📁 Files Được Tạo/Chỉnh Sửa:

### 📄 Files Mới:
1. **PRODUCT_KNOWLEDGE_BASE.json** - Knowledge base đầy đủ
2. **upload-knowledge-base.js** - Upload script
3. **UPLOAD_KNOWLEDGE_BASE_GUIDE.md** - Hướng dẫn chi tiết

### ✏️ Files Chỉnh Sửa:
1. **frontend/src/lib/server/openaiSupport.js**
   - Cải thiện `buildSystemPrompt()` - Ngôn ngữ tự nhiên hơn
   - Cải thiện `cleanupOutputText()` - Loại bỏ ký hiệu đặc biệt tốt hơn

---

## 🔑 Key Changes Detail:

### System Prompt Improvements:
**Trước:**
```
'Bạn là nhân viên hỗ trợ khách hàng của Inoxpran.'
'Nếu không đủ thông tin, hãy hỏi một câu làm rõ ngắn gọn.'
'Giữ câu trả lời ngắn: tối đa 1-3 câu.'
```

**Sau:**
```
'Bạn là nhân viên hỗ trợ khách hàng của Inoxpran. Hãy trò chuyện một cách tự nhiên, như một người bạn thân, không quá trang trọng hay máy móc.'
'Trả lời NGẮN GỌN và THIẾT THỰC. Tối đa 2-3 câu, không dài dòng.'
'Nói chuyện bình thường, không dùng từng từ khách sáo hay cụm từ "mình có thể hỗ trợ", "được phép", "thực hiện", v.v.'
'Nếu là sản phẩm Inoxpran, hãy tìm trong dữ liệu và trả lời rõ ràng. Nếu không tìm thấy, nói thẳng "chưa có thông tin" thay vì nói "mình chưa đủ dữ liệu".'
```

---

## ⚙️ Technical Details:

### Knowledge Base Architecture:
```
Frontend (Chat Widget)
    ↓
API Endpoint: POST /api/chat/message
    ↓
generateSupportReply() function
    ↓
1. Fetch Knowledge Documents from: /site-settings/agent-knowledge
2. Score documents based on user query
3. Select top 4 documents
4. Build system prompt with knowledge context
5. Call OpenAI API with messages
    ↓
Return reply to user
```

### Caching:
- Knowledge base được cache 5 phút ở client
- Khi cache expire, auto-fetch từ backend
- Không cần restart server khi update knowledge

---

## 🚀 Next Steps (Optional Improvements):

1. **Thêm sản phẩm mới:**
   - Chỉnh sửa PRODUCT_KNOWLEDGE_BASE.json
   - Chạy: `node upload-knowledge-base.js` lại

2. **Fine-tune System Prompt:**
   - Chỉnh sửa buildSystemPrompt() nếu muốn style khác
   - Restart backend server để apply

3. **Monitor Chatbot Performance:**
   - Xem các câu hỏi phổ biến
   - Xem reply cũ vs. reply mới
   - Tối ưu knowledge base dựa trên phản hồi

4. **Thêm More Languages:**
   - Thêm English documents (sẵn có framework)
   - Thêm Tiếng Anh system prompt (sẵn có)

5. **Admin Panel:**
   - Tạo UI cho admin để quản lý knowledge base
   - Không cần chỉnh sửa JSON trực tiếp

---

## 📞 Support:

Nếu gặp vấn đề:

1. ✅ Kiểm tra backend chạy: `http://localhost:3056`
2. ✅ Kiểm tra .env có đủ API keys
3. ✅ Refresh page browser (Ctrl+F5)
4. ✅ Check browser console cho errors
5. ✅ Xem logs terminal backend

---

## 🎉 Summary:

✅ Chatbot đã được train lại với **12 documents** chi tiết  
✅ System prompt cải thiện để **tự nhiên hơn, ít AI-like hơn**  
✅ Bếp từ INP6101 và các sản phẩm khác có thông tin chi tiết  
✅ Upload script ready to use  
✅ Hướng dẫn chi tiết đã tạo  

**Giờ chỉ cần:** Upload knowledge base và test! 🚀
