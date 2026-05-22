# Backend Inoxpran - Mo ta chi tiet luong, vai tro va quan he

## 1) Tong quan kien truc
- Entry point: `backend/server.js` -> khoi tao `backend/src/app.js`.
- `app.js` cau hinh middleware (helmet, cors, morgan, compression), ket noi MongoDB, load Swagger, va mount router goc `/v1/api`.
- Luong request: Client -> `routes/index.js` (apiKey + permission PUBLIC) -> route module -> controller -> service -> model/repository -> MongoDB -> response.
- Response dung `core/success.response.js`, error dung `core/error.response.js`.

## 2) He thong vai tro va xac thuc
### 2.1 API key + permission (bat buoc)
- Header bat buoc: `x-api-key`.
- `auth/checkAuth.js`:
  - `apiKey`: doc API key tu DB (`models/apiKey.model.js`), kiem tra `status`.
- `permission`: kiem tra `permissions` (PUBLIC/USER/ADMIN/ADMIN_SYSTEM), co mapping legacy (`0000`, `2222`).
- `routes/index.js` ap dung `permission(PUBLIC)` cho toan bo /v1/api.

### 2.2 JWT theo userType
- Header bat buoc khi da login: `x-client-id` (userId), `authorization` (access token).
- Refresh token: `x-rtoken-id`.
- `auth/authUtils.js`:
  - `authenticationV2` (general) va `authenticationUser`/`authenticationAdmin`.
  - Doc `keyToken` theo userId + userType (User/Admin) tu DB (`models/keyToken.model.js`).

### 2.3 Vai tro
- `User`: mua hang, gio hang, checkout, theo doi don.
- `Admin`: quan tri he thong, xem/quan ly User.
- `ADMIN_SYSTEM` permission (API key) bat buoc cho cac route quan tri san pham.

## 3) Cac model va quan he
### Tai khoan
- `User` (`models/user.model.js`): thong tin nguoi dung, roles, addresses.
- `Admin` (`models/admin.model.js`): thong tin admin + permissions.
- `KeyToken` (`models/keyToken.model.js`): 1 user = 1 keypair + refresh token, su dung `refPath` theo `userType`.
- `ApiKey` (`models/apiKey.model.js`): API key + permissions (public, user, admin, admin_system).

### San pham va ton kho
- `Product` + sub-model (`models/product.model.js`): castIrons/Inoxs/Furnitures.
- `Inventory` (`models/inventory.model.js`): ton kho theo `productId` + `shopId`, co `inven_reservations`.

### Gio hang va don hang
- `Cart` (`models/cart.model.js`):
  - `cart_userId` -> User.
  - `cart_products` la array item.
  - `cart_count_product` dem so item (so luong object trong cart_products).
- `CartDeletion` (`models/cartDeletion.model.js`): luu lich su xoa item khoi cart.
- `Order` (`models/order.js`):
  - `order_userId` -> User.
  - `order_products` chua list item theo shop (co `shopId`, `item_products`).
  - COD: `order_payment_method`, `order_payment_status`, `order_cod_status`.
  - Shipping: `order_shipping_status`, `order_shipping_provider`, `order_shipments`.
- `Shipment` (`models/shipment.model.js`):
  - `shipment_order_id` -> Order.
  - `shipment_shop_id`, `shipment_user_id`.
  - Tracking/label/provider/history.

### Khuyen mai va thong bao
- `Discount`, `DiscountUsage`, `DiscountDeletion`.
- `Notification`: luu thong bao, hien tai dung cho cancel order.

## 4) Route -> Controller -> Service
### 4.1 User - `/v1/api/user`
- `POST /signup` -> `user.controller.signUp` -> `user.service.signUp` -> `User`, `KeyToken`.
- `POST /login` -> `user.controller.login` -> `user.service.login` -> `User`, `KeyToken`.
- `POST /logout` -> `user.controller.logout` -> `user.service.logout` -> `KeyToken`.
- `POST /refresh-token` -> `user.controller.handlerRefreshToken` -> `user.service.handlerRefreshTokenV2`.
- `GET /profile` -> `user.controller.getProfile` -> `user.service.getProfile` -> `user.repo`.
- `PATCH /profile` -> `user.controller.updateProfile` -> `user.service.updateProfile` -> `User`.

### 4.2 Admin - `/v1/api/admin`
- `POST /signup` -> `admin.controller.signUp` -> `admin.service.signUp` -> `Admin`, `KeyToken`.
- `POST /login` -> `admin.controller.login` -> `admin.service.login` -> `Admin`, `KeyToken`.
- `POST /logout` -> `admin.controller.logout` -> `admin.service.logout` -> `KeyToken`.
- `POST /refresh-token` -> `admin.controller.handlerRefreshToken` -> `admin.service.handlerRefreshTokenV2`.
- `GET /profile` -> `admin.controller.getProfile` -> `admin.service.getProfile`.
- `PATCH /profile` -> `admin.controller.updateProfile` -> `admin.service.updateProfile`.
- `GET /users` -> `admin.controller.listUsers` -> `admin.service.listUsers` -> `user.repo`.
- `GET /users/:userId` -> `admin.controller.getUserById` -> `admin.service.getUserById`.
- `PATCH /users/:userId/status` -> `admin.controller.updateUserStatus` -> `admin.service.updateUserStatus`.
### 4.3 Product - `/v1/api/product`
- Public:
  - `GET /search/:keySearch` -> `product.controller.getListSearchProduct` -> `product.service.searchProducts`.
  - `GET /` -> `product.controller.findAllProducts` -> `product.service.findAllProducts`.
  - `GET /:productId` -> `product.controller.findProduct` -> `product.service.findProduct`.
- Admin system only (permission ADMIN_SYSTEM + `authenticationAdmin`):
  - `POST /` -> `product.controller.createProduct` -> `product.service.createProduct` -> `product.model` + `inventory.repo.insertInventory`.
  - `PATCH /:productId` -> `product.controller.updateProduct` -> `product.service.updateProduct`.
  - `POST /publish/:id` -> `product.controller.publishProductByShop` -> `product.service.publishProductByShop`.
  - `POST /unPublish/:id` -> `product.controller.unPublishProductByShop` -> `product.service.unPublishProductByShop`.
  - `GET /drafts/all`, `GET /published/all` -> query theo shop.

### 4.4 Cart - `/v1/api/cart` (User auth)
- `GET /` -> `cart.controller.list` -> `cart.service.getListUserCart`.
- `POST /` -> `cart.controller.addToCart` -> `cart.service.addToCart`:
  - Neu chua co cart -> create.
  - Neu co item trung productId -> update quantity.
  - Neu item moi -> push vao `cart_products`, tang `cart_count_product`.
- `POST /update` -> `cart.controller.update` -> `cart.service.updateToCart`.
- `DELETE /` -> `cart.controller.delete` -> `cart.service.deleteUserCart` + `CartDeletion`.

### 4.5 Checkout + Order - `/v1/api/checkout`
- `POST /review` -> `checkout.controller.checkoutReview` -> `checkout.service.checkoutReview` (tinh tong, kiem tra gia).
- `POST /orders` -> `checkout.controller.createOrder` -> `checkout.service.orderByUser`:
  - Lock ton kho (`redis.service.acquireLock`) + `inventory.repo.reservationInventory`.
  - Tao order COD, set `order_payment_method`, `order_shipping_status`.
- `GET /orders` -> `checkout.controller.getOrdersByUser` -> `checkout.service.getOrdersByUser`.
- `GET /orders/:orderId` -> `checkout.controller.getOneOrderByUser`.
- `POST /orders/:orderId/cancel` -> `checkout.controller.cancelOrderByUser` -> `checkout.service.cancelOrderByUser` + `notification.service`.
- `PATCH /admin/orders/:orderId/status` -> `checkout.controller.updateOrderStatusByAdmin`.

### 4.6 Shipping - `/v1/api/shipping`
- `POST /` -> `shipping.controller.createShipment` -> `shipping.service.createShipment`:
  - Tao `Shipment`, goi GHTK, luu tracking/label.
  - Update `Order.order_shipping_status` + `order_trackingNumber`.
- `GET /order/:orderId` -> `shipping.controller.getShipmentsByOrder` -> `shipping.service.getShipmentsByOrder`.
- `GET /:shipmentId` -> `shipping.controller.getShipment` -> `shipping.service.getShipmentById`.
- `POST /webhook/ghtk` -> `shipping.controller.handleGhtkWebhook` -> `shipping.service.handleGhtkWebhook`:
  - Update `Shipment.shipment_status` + `Order.order_shipping_status`.

### 4.7 Discount - `/v1/api/discount`
- Public:
  - `POST /amount` -> `discount.controller.getDiscountAmount` -> `discount.service.getDiscountAmount`.
  - `GET /list_product_code` -> `discount.controller.getAllDiscountCodeWithProducts`.
- User auth:
  - `POST /usage` -> `discount.controller.recordDiscountUsage` -> `discount.service.recordDiscountUsage`.
  - `POST /cancel` -> `discount.controller.cancelDiscountCode` -> `discount.service.cancelDiscountCode`.
- Authenticated:
  - `POST /` -> `discount.controller.createDisscountCode` -> `discount.service.createDiscountCode`.
  - `GET /` -> `discount.controller.getAllDiscountCodes` -> `discount.service.getAllDiscountCodesByShop`.
  - `DELETE /:codeId` -> `discount.controller.deleteDiscountCode` -> `discount.service.deleteDiscountCode`.

### 4.8 Inventory - `/v1/api/inventory` (Admin auth)
- `POST /` -> `inventory.controller.addStock` -> `inventory.service.addStockToInventory` -> `Inventory`.

## 5) Luong nghiep vu chinh
### 5.1 Add to cart
- User login -> goi `POST /cart` voi `productId, quantity`.
- Service: kiem tra product -> cap nhat `cart_products` + `cart_count_product`.

### 5.2 Update cart item
- `POST /cart/update` -> kiem tra product, doi chieu price/old_quantity neu co -> tinh delta -> update quantity.

### 5.3 Checkout COD
- `POST /checkout/review` tinh tong, discount.
- `POST /checkout/orders`:
  - Lock ton kho bang Redis.
  - Tao order COD (pending).

### 5.4 Tao van don (GHTK)
- `POST /shipping`:
  - Build payload tu order + pickup.
  - Goi GHTK, luu tracking/label.
  - Update `order_shipping_status`.

### 5.5 Webhook GHTK
- `POST /shipping/webhook/ghtk`:
  - Map status -> `shipment_status`, update order status.

### 5.6 Discount usage
- `POST /discount/usage`: ghi nhan dung ma.
- `POST /discount/cancel`: rollback usage.
- `DELETE /discount/:codeId`: vo hieu hoa ma.

## 6) Module ho tro
- `utils/index.js`: convert ObjectId, removeUndefinedObject, updateNestedObject, getInfoData.
- `config/firebase.js` + `storage.service.js`: upload anh len Firebase Storage.
- `middleware/upload.js` + `middleware/firebaseUpload.js`: xu ly upload file.
- `config/redis.js` + `services/redis.service.js`: lock ton kho khi tao don.
- `helpers/check.connect.js`: monitor ket noi DB.
- `models/repositories/*`: ham query tap trung (product, user, admin, inventory, cart, discount).

## 7) Luu y hien trang
- Tat ca route duoc bao ve boi `x-api-key`.
- Product create/update chi cho `ADMIN_SYSTEM` + `authenticationAdmin`.
- `apiKey.service.findById` dang tao API key moi moi lan goi (chi dung trong dev).
- `orderByUser` chua xoa cart sau khi tao order (comment).
