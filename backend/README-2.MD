# 🛒📦 TỔNG HỢP HÀM & MODULE NODE.JS CHO WEBSITE E-COMMERCE

## ⚙️ CORE EXPRESS (Web Server & Routing)
| Hàm / API | Mục đích |
|-----------|----------|
| express() | Tạo app web |
| app.get(), post(), put(), delete() | Định tuyến API |
| req.params, req.query, req.body | Lấy dữ liệu yêu cầu |
| res.status().json() | Phản hồi dữ liệu |
| next() | Chuyển tiếp middleware |
| express.Router() | Modular hóa router |

## 🛡 AUTHENTICATION & SECURITY
| Hàm / API | Mục đích |
|-----------|----------|
| bcrypt.hash(), compare() | Mã hoá mật khẩu |
| jsonwebtoken.sign(), verify() | Tạo & xác minh token |
| passport | Xác thực Google/Facebook |
| helmet() | Tăng cường bảo mật HTTP |
| cors() | Cho phép cross-origin |
| rateLimit() | Chống spam, brute-force |
| express-validator | Xác thực dữ liệu |

## 👥 USER & ROLE MANAGEMENT
| Hàm / API | Mục đích |
|-----------|----------|
| User.findById() | Lấy thông tin người dùng |
| isAdmin(req.user) | Kiểm tra quyền admin |
| authMiddleware() | Bảo vệ route |

## 📦 PRODUCT & INVENTORY
| Hàm / API | Mục đích |
|-----------|----------|
| mongoose.Model.create(), find(), update() | Quản lý sản phẩm |
| slugify(name) | Tạo slug sản phẩm |
| multer.single() | Upload ảnh |
| fs.unlink() | Xoá file ảnh cũ |

## 🛒 CART & ORDER FLOW
| Hàm / API | Mục đích |
|-----------|----------|
| Cart.create(), updateOne() | Quản lý giỏ hàng |
| Order.create(), status = 'Paid' | Xử lý đơn hàng |
| populate('user product') | Join bảng dữ liệu |
| orderMiddleware() | Kiểm tra đơn hàng hợp lệ |

## 💳 PAYMENT INTEGRATION
| API | Mục đích |
|-----|----------|
| stripe.checkout.sessions.create() | Thanh toán Stripe |
| paypal-rest-sdk | Tích hợp Paypal |
| vnpay.createPaymentUrl() | Thanh toán VNPAY |
| app.post('/webhook') | Nhận webhook thanh toán |

## 💬 EMAIL & NOTIFICATION
| Hàm / API | Mục đích |
|-----------|----------|
| nodemailer.sendMail() | Gửi email xác nhận |
| socket.io.emit() | Gửi thông báo realtime |
| node-cron.schedule() | Gửi email định kỳ |

## 🔍 SEARCH & SEO
| Hàm / API | Mục đích |
|-----------|----------|
| mongoose.createIndex({ name: 'text' }) | Tìm kiếm sản phẩm |
| Product.find({ $text: { $search: '...' } }) | Truy vấn |
| helmet() | Tối ưu bảo mật & SEO |

## 📊 ADMIN DASHBOARD
| Hàm / API | Mục đích |
|-----------|----------|
| Order.aggregate() | Thống kê doanh thu |
| socket.io | Realtime dashboard |
| adminMiddleware() | Bảo vệ dashboard |

## 🌍 3RD PARTY API
| Tên dịch vụ | Tích hợp |
|-------------|----------|
| GHTK, GHN | axios.post() |
| Cloudinary, S3 | Upload ảnh |
| Google login | passport-google-oauth20 |

## 📁 PROJECT STRUCTURE GỢI Ý
