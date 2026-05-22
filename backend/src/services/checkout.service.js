'use strict'
const { findCartById } = require('../models/repositories/cart.repo');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../core/error.response');
const { checkProductByServer, adjustProductQuantity } = require('../models/repositories/product.repo');
const { getDiscountAmount, recordDiscountUsage, rollbackDiscountUsage } = require('../services/discount.service');
const { acquireLock, releaseLock } = require('../services/redis.service');
const { releaseReservationInventory } = require('../models/repositories/inventory.repo');
const { cart } = require('../models/cart.model');
const { order } = require('../models/order');
const NotificationService = require('../services/notification.service');
const { convertToObjectIdMongodb, removeUndefinedObject } = require('../utils');

const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'cancel_requested', 'cancelled', 'delivered', 'returned'];
const ORDER_STATUS_FLOW = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['shipped', 'cancel_requested'],
    cancel_requested: ['confirmed', 'cancelled'],
    shipped: ['delivered', 'returned'],
    delivered: ['returned'],
    returned: [],
    cancelled: []
};

const normalizeUserId = (userId) => {
    return convertToObjectIdMongodb(userId);
};

const normalizeGuestOrderKey = (value) => {
    const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 96);
    return normalized || `guest:${Date.now()}`;
};

const buildGuestPayload = ({ user_address = {}, guest = {}, telemetrySessionId, marketing = {} }) => {
    const shippingEmail = String(user_address?.email || '').trim();
    const guestEmail = String(guest?.email || '').trim();
    return removeUndefinedObject({
        name: String(user_address?.name || guest?.name || '').trim(),
        phone: String(user_address?.phone || guest?.phone || '').trim(),
        email: shippingEmail || guestEmail || undefined,
        note: String(user_address?.note || guest?.note || '').trim() || undefined,
        telemetrySessionId: String(telemetrySessionId || '').trim() || undefined,
        campaignCode: String(marketing?.campaignCode || marketing?.offerCode || '').trim() || undefined
    });
};

const ensureValidStatus = (status) => {
    if (!status || !ORDER_STATUSES.includes(status)) {
        throw new BadRequestError('Invalid order status');
    }
};

const parseStatusFilter = (status) => {
    if (!status) return null;
    const entries = String(status)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    if (!entries.length) return null;
    entries.forEach(ensureValidStatus);
    return entries;
};

const normalizeNonNegativeNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    if (numeric < 0) return fallback;
    return numeric;
};

const normalizePositiveNumber = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const rounded = Math.floor(numeric);
    if (rounded < min) return fallback;
    if (rounded > max) return max;
    return rounded;
};

const resolveOrderSort = (sort) => {
    switch (sort) {
        case 'ctime_asc':
        case 'oldest':
            return { _id: 1 };
        case 'total_desc':
            return { 'order_checkout.totalCheckout': -1, _id: -1 };
        case 'total_asc':
            return { 'order_checkout.totalCheckout': 1, _id: -1 };
        case 'mtime':
            return { modifiedOn: -1, _id: -1 };
        case 'ctime':
        case 'newest':
        default:
            return { _id: -1 };
    }
};

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeObjectIdList = (values = []) => {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    const ids = [];
    for (const value of values) {
        const objectId = convertToObjectIdMongodb(value);
        if (!objectId) continue;
        const key = String(objectId);
        if (seen.has(key)) continue;
        seen.add(key);
        ids.push(objectId);
    }
    return ids;
};

const buildAdminOrderFilter = ({ status, q, from, to }) => {
    const filter = {};
    const statusFilter = parseStatusFilter(status);
    if (statusFilter) {
        filter.order_status =
            statusFilter.length > 1
                ? { $in: statusFilter }
                : statusFilter[0];
    }

    const queryText = typeof q === 'string' ? q.trim() : '';
    if (queryText) {
        const queryClauses = [];
        const objectId = convertToObjectIdMongodb(queryText);
        if (objectId) {
            queryClauses.push({ _id: objectId });
        }
        const regex = new RegExp(escapeRegex(queryText), 'i');
        queryClauses.push(
            { order_trackingNumber: regex },
            { 'order_shipping.name': regex },
            { 'order_shipping.phone': regex },
            { 'order_shipping.address': regex },
            { 'order_shipping.ward': regex },
            { 'order_shipping.district': regex },
            { 'order_shipping.province': regex }
        );
        filter.$or = queryClauses;
    }

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    const hasValidFrom = fromDate instanceof Date && !Number.isNaN(fromDate.getTime());
    const hasValidTo = toDate instanceof Date && !Number.isNaN(toDate.getTime());
    if (hasValidFrom || hasValidTo) {
        filter.createdOn = {};
        if (hasValidFrom) filter.createdOn.$gte = fromDate;
        if (hasValidTo) {
            toDate.setHours(23, 59, 59, 999);
            filter.createdOn.$lte = toDate;
        }
    }

    return filter;
};

const buildOrderSummary = (groups = []) => {
    const byStatus = ORDER_STATUSES.reduce((summary, status) => {
        summary[status] = 0;
        return summary;
    }, {});

    for (const group of groups) {
        if (!group?._id) continue;
        if (!Object.prototype.hasOwnProperty.call(byStatus, group._id)) continue;
        byStatus[group._id] = Number(group.count) || 0;
    }

    const total = Object.values(byStatus).reduce((acc, value) => acc + value, 0);
    return {
        total,
        byStatus,
        byTab: {
            waiting: byStatus.pending + byStatus.confirmed,
            shipping: byStatus.shipped,
            completed: byStatus.delivered,
            cancel_requested: byStatus.cancel_requested,
            cancelled: byStatus.cancelled,
            returned: byStatus.returned
        }
    };
};

const shouldRollbackOnAdminDelete = (orderDoc) => {
    const status = orderDoc?.order_status;
    return status === 'pending' || status === 'confirmed' || status === 'cancel_requested';
};

const collectOrderItems = (orderDoc) => {
    const items = Array.isArray(orderDoc?.order_products) ? orderDoc.order_products : [];
    const products = [];
    const discounts = [];

    for (const item of items) {
        const itemProducts = Array.isArray(item.item_products) ? item.item_products : [];
        for (const product of itemProducts) {
            if (product?.productId && product?.quantity != null) {
                products.push({
                    productId: product.productId,
                    quantity: product.quantity
                });
            }
        }

        const discount = Array.isArray(item.shop_discounts) ? item.shop_discounts[0] : null;
        if (discount?.discountId) {
            discounts.push({
                discountId: discount.discountId,
                shopId: item.shopId
            });
        }
    }

    return { products, discounts };
};

const rollbackOrderSideEffects = async ({ orderDoc }) => {
    if (!orderDoc) return;
    const { products, discounts } = collectOrderItems(orderDoc);
    const cartId = orderDoc.order_cartId ? String(orderDoc.order_cartId) : undefined;

    if (products.length) {
        await Promise.all(products.map((product) => (
            releaseReservationInventory({
                productId: product.productId,
                quantity: product.quantity,
                cartId
            })
        )));
        await Promise.all(products.map((product) => (
            adjustProductQuantity({
                productId: product.productId,
                delta: product.quantity
            })
        )));
    }

    if (discounts.length) {
        await Promise.all(discounts.map((discount) => (
            rollbackDiscountUsage({
                discountId: discount.discountId,
                shopId: discount.shopId,
                userId: orderDoc.order_userId
            })
        )));
    }
};
class CheckoutService{

    // login and withoutlogin
    /*
    {
        cartId,
        userId,
        shop_order_ids:[
            {
                shopId,
                shop_discount: [],
                itemsproducts: [
                  {
                    price,
                    quantity,
                    productId
                  }
                ]
            },
            {
                shopId,
                shop_discount: [
                {
                    "shopId",
                    "discountId",
                     "codeId":
                }
                
                ],
                itemsproducts: [
                  {
                    price,
                    quantity,
                    productId
                  }
                ]
            }
        ]
    }
    */
    static async checkoutReview({
        cartId, userId, shop_order_ids = [], shipping_fee = 0, allowGuest = false
    }) {

        const normalizedUserId = normalizeUserId(userId);
        if (!normalizedUserId && !allowGuest) throw new BadRequestError('Invalid user id');

        const cartObjectId = convertToObjectIdMongodb(cartId);
        if (cartObjectId) {
            if (!normalizedUserId) throw new BadRequestError('Cart checkout requires a user');
            const foundCart = await findCartById(cartObjectId);
            if (!foundCart) throw new BadRequestError('Cart does not exists');
            if (String(foundCart.cart_userId) !== String(normalizedUserId)) {
                throw new ForbiddenError('Cart does not belong to the user');
            }
        }

        if (!Array.isArray(shop_order_ids)) {
            throw new BadRequestError('shop_order_ids must be an array');
        }
        
        const normalizedShippingFee = normalizeNonNegativeNumber(shipping_fee, 0);
        const checkout_order = {
            totalPrice: 0,
            freeShip: 0,
            shippingFee: normalizedShippingFee,
            totalShipping: normalizedShippingFee,
            totalDiscount: 0,
            totalCheckout: 0,
        }, shop_order_ids_new = [];

        // tính tổng tiền bill

        for (let i = 0; i < shop_order_ids.length; i++) {
            const { shopId, shop_discounts = [], item_products = [] } = shop_order_ids[i];
            if (!Array.isArray(item_products) || !item_products.length) {
                throw new BadRequestError('item_products is required');
            }
            // check product available
            const checkProductServer = await checkProductByServer(item_products);
            const validProducts = checkProductServer.filter(Boolean);
            if (!validProducts.length || validProducts.length !== item_products.length) {
                throw new BadRequestError('order wrong!');
            }

            // tong tien don hang
            const checkoutPrice = validProducts.reduce((acc, product) => {
                return acc + (product.quantity * product.price)
            }, 0);
            // tong tong tien truoc khi  xu ly
            checkout_order.totalPrice += checkoutPrice;
            
            const itemCheckout = {
                shopId,
                shop_discounts,
                priceRaw: checkoutPrice, // time truoc khi giam gia
                priceApplyDiscount: checkoutPrice,
                item_products: validProducts
            }

            // neu shop_discounts ton tai > 0, check xem co hop le hay khong
            if (shop_discounts.length > 0) {
                if (!normalizedUserId) {
                    throw new BadRequestError('Discount requires an account');
                }
                // gia su chi co mot discount
                // get amount discount

                console.log('mo mat raaaaaaaaaaa>>>>>>>>>:::', {
                    codeId: shop_discounts[0].codeId,
                    userId: normalizedUserId,
                    shopId,
                    products: checkProductServer
                });
                const { discount = 0, discountId, discountCode } = await getDiscountAmount({
                    codeId: shop_discounts[0].codeId,
                    userId: normalizedUserId,
                    shopId,
                    products: validProducts

                });

                // tong cong discount giam gia
                checkout_order.totalDiscount += discount;

                const resolvedCodeId = shop_discounts[0].codeId || discountCode;
                itemCheckout.shop_discounts = [{
                    ...shop_discounts[0],
                    codeId: resolvedCodeId,
                    discountId,
                    discountCode,
                    discountAmount: discount
                }];
                
                //neu tien giam gia lon hon 0
                if (discount > 0) {
                    itemCheckout.priceApplyDiscount = checkoutPrice - discount;
                }
            }
            
            // tong thanh toan cuoi cung
            checkout_order.totalCheckout += itemCheckout.priceApplyDiscount;
            shop_order_ids_new.push(itemCheckout)
        }
        checkout_order.totalCheckout += normalizedShippingFee;
        return {
            
            shop_order_ids,
            shop_order_ids_new,
            checkout_order
        }
    }
    
    // order

    static async orderByUser({
        shop_order_ids,
        cartId,
        userId,
        user_address = {},
        user_payment = {}
    }) {
        const userObjectId = convertToObjectIdMongodb(userId);
        if (!userObjectId) throw new BadRequestError('Invalid user id');
        const cartObjectId = convertToObjectIdMongodb(cartId);
        const hasCartContext = Boolean(cartObjectId);
        const reservationCartId = hasCartContext ? String(cartObjectId) : `buy-now:${String(userObjectId)}`;
        const addressPayload = user_address && typeof user_address === 'object' ? user_address : {};
        const requiredAddressFields = ['name', 'phone', 'address', 'ward', 'district', 'province'];
        const missingFields = requiredAddressFields.filter((field) => {
            const value = addressPayload[field];
            return !String(value || '').trim();
        });
        if (missingFields.length) {
            throw new BadRequestError('Shipping address is incomplete');
        }
        const shippingFee = normalizeNonNegativeNumber(user_payment?.shipping_fee, 0);
        const { shop_order_ids_new, checkout_order } = await CheckoutService.checkoutReview({
            cartId: hasCartContext ? cartObjectId : undefined,
            userId: userObjectId,
            shop_order_ids,
            shipping_fee: shippingFee
        });
        // check lai mot lan nua xem vuot ton kho hay khong?
        // get new array Product
        const products = shop_order_ids_new.flatMap(order => order.item_products || []);
        const acquireProduct = [];
        const acquiredLocks = [];
        const reservedProducts = [];
        const recordedDiscounts = [];
        const syncedProducts = [];
        try {
            for (let i = 0; i < products.length; i++) {
                const { productId, quantity } = products[i];
                const keyLock = await acquireLock(productId, quantity, reservationCartId);
                acquireProduct.push(Boolean(keyLock));
                if (keyLock) {
                    acquiredLocks.push(keyLock);
                    reservedProducts.push({ productId, quantity });
                }
            }
        
            // check if có sản phẩm trong kho hết hàng
            if (acquireProduct.includes(false)) {
                throw new BadRequestError('Some products were updated, please review the cart');
            }

            if (reservedProducts.length) {
                const syncResults = await Promise.all(
                    reservedProducts.map((item) =>
                        adjustProductQuantity({ productId: item.productId, delta: -item.quantity })
                    )
                );
                syncedProducts.push(...reservedProducts);
                const hasInvalidSync = syncResults.some(
                    (result) => !result || result.matchedCount === 0
                );
                if (hasInvalidSync) {
                    throw new BadRequestError('Failed to sync product quantity');
                }
            }

            for (const shopOrder of shop_order_ids_new) {
                const discount = Array.isArray(shopOrder.shop_discounts) ? shopOrder.shop_discounts[0] : null;
                if (discount?.discountId) {
                    await recordDiscountUsage({
                        discountId: discount.discountId,
                        userId: userObjectId,
                        shopId: shopOrder.shopId
                    });
                    recordedDiscounts.push({
                        discountId: discount.discountId,
                        shopId: shopOrder.shopId
                    });
                }
            }
            
            const paymentPayload = removeUndefinedObject({
                ...user_payment,
                method: 'COD',
                status: user_payment?.status || 'pending'
            });
            const shippingProvider = user_payment?.shipping_provider || user_payment?.provider || 'GHTK';

            const newOrder = await order.create({
                order_userId: userObjectId,
                order_source: 'account_checkout',
                order_cartId: cartObjectId || undefined,
                order_checkout: checkout_order,
                order_shipping: user_address,
                order_payment: paymentPayload,
                order_products: shop_order_ids_new,
                order_payment_method: 'COD',
                order_payment_status: paymentPayload.status,
                order_cod_status: 'pending',
                order_shipping_status: 'pending',
                order_shipping_provider: shippingProvider
            });
            
            // remove product in my cart
            if (newOrder && hasCartContext) {
                try {
                    await cart.updateOne(
                        { _id: cartObjectId, cart_userId: userObjectId, cart_state: 'active' },
                        { $set: { cart_state: 'completed', cart_products: [], cart_count_product: 0 } }
                    );
                } catch (error) {
                    console.error('Clear cart error', error);
                }
            }
            return newOrder;
        } catch (error) {
            if (recordedDiscounts.length) {
                await Promise.all(recordedDiscounts.map((discount) => (
                    rollbackDiscountUsage({
                        discountId: discount.discountId,
                        shopId: discount.shopId,
                        userId: userObjectId
                    })
                )));
            }
            if (syncedProducts.length) {
                await Promise.all(
                    syncedProducts.map((item) =>
                        adjustProductQuantity({ productId: item.productId, delta: item.quantity })
                    )
                );
            }
            if (reservedProducts.length) {
                await Promise.all(reservedProducts.map((item) => (
                    releaseReservationInventory({
                        productId: item.productId,
                        quantity: item.quantity,
                        cartId: reservationCartId
                    })
                )));
            }
            throw error;
        } finally {
            if (acquiredLocks.length) {
                await Promise.all(acquiredLocks.map((keyLock) => releaseLock(keyLock)));
            }
        }
    }

    static async orderByGuest({
        shop_order_ids,
        user_address = {},
        user_payment = {},
        guest = {},
        telemetrySessionId,
        marketing = {}
    }) {
        const addressPayload = user_address && typeof user_address === 'object' ? user_address : {};
        const requiredAddressFields = ['name', 'phone', 'address', 'ward', 'district', 'province'];
        const missingFields = requiredAddressFields.filter((field) => {
            const value = addressPayload[field];
            return !String(value || '').trim();
        });
        if (missingFields.length) {
            throw new BadRequestError('Shipping address is incomplete');
        }

        const shippingFee = normalizeNonNegativeNumber(user_payment?.shipping_fee, 0);
        const { shop_order_ids_new, checkout_order } = await CheckoutService.checkoutReview({
            shop_order_ids,
            shipping_fee: shippingFee,
            allowGuest: true
        });

        const reservationCartId = normalizeGuestOrderKey(
            `guest:${telemetrySessionId || addressPayload.phone || Date.now()}:${Date.now()}`
        );
        const products = shop_order_ids_new.flatMap(order => order.item_products || []);
        const acquireProduct = [];
        const acquiredLocks = [];
        const reservedProducts = [];
        const syncedProducts = [];

        try {
            for (let i = 0; i < products.length; i++) {
                const { productId, quantity } = products[i];
                const keyLock = await acquireLock(productId, quantity, reservationCartId);
                acquireProduct.push(Boolean(keyLock));
                if (keyLock) {
                    acquiredLocks.push(keyLock);
                    reservedProducts.push({ productId, quantity });
                }
            }

            if (acquireProduct.includes(false)) {
                throw new BadRequestError('Some products were updated, please review the cart');
            }

            if (reservedProducts.length) {
                const syncResults = await Promise.all(
                    reservedProducts.map((item) =>
                        adjustProductQuantity({ productId: item.productId, delta: -item.quantity })
                    )
                );
                syncedProducts.push(...reservedProducts);
                const hasInvalidSync = syncResults.some(
                    (result) => !result || result.matchedCount === 0
                );
                if (hasInvalidSync) {
                    throw new BadRequestError('Failed to sync product quantity');
                }
            }

            const paymentPayload = removeUndefinedObject({
                ...user_payment,
                method: 'COD',
                status: user_payment?.status || 'pending'
            });
            const shippingProvider = user_payment?.shipping_provider || user_payment?.provider || 'GHTK';
            const shippingPayload = removeUndefinedObject({
                ...addressPayload,
                name: String(addressPayload.name || '').trim(),
                phone: String(addressPayload.phone || '').trim(),
                email: String(addressPayload.email || '').trim() || undefined,
                address: String(addressPayload.address || '').trim(),
                ward: String(addressPayload.ward || '').trim(),
                district: String(addressPayload.district || '').trim(),
                province: String(addressPayload.province || '').trim(),
                note: String(addressPayload.note || '').trim() || undefined
            });

            const newOrder = await order.create({
                order_userId: null,
                order_source: 'guest_checkout',
                order_guest: buildGuestPayload({ user_address: shippingPayload, guest, telemetrySessionId, marketing }),
                order_marketing: removeUndefinedObject({
                    campaignCode: String(marketing?.campaignCode || marketing?.offerCode || '').trim() || undefined,
                    source: String(marketing?.source || '').trim() || 'checkout'
                }),
                order_checkout: checkout_order,
                order_shipping: shippingPayload,
                order_payment: paymentPayload,
                order_products: shop_order_ids_new,
                order_payment_method: 'COD',
                order_payment_status: paymentPayload.status,
                order_cod_status: 'pending',
                order_shipping_status: 'pending',
                order_shipping_provider: shippingProvider
            });

            return newOrder;
        } catch (error) {
            if (syncedProducts.length) {
                await Promise.all(
                    syncedProducts.map((item) =>
                        adjustProductQuantity({ productId: item.productId, delta: item.quantity })
                    )
                );
            }
            if (reservedProducts.length) {
                await Promise.all(reservedProducts.map((item) => (
                    releaseReservationInventory({
                        productId: item.productId,
                        quantity: item.quantity,
                        cartId: reservationCartId
                    })
                )));
            }
            throw error;
        } finally {
            if (acquiredLocks.length) {
                await Promise.all(acquiredLocks.map((keyLock) => releaseLock(keyLock)));
            }
        }
    }

    
     /*
    1> query Orders [User]
    */
    static async getOrdersByUser({ userId, limit = 50, page = 1, sort = 'ctime', status }) {
        const normalizedUserId = normalizeUserId(userId);
        if (!normalizedUserId) throw new BadRequestError('Invalid user id');

        const filter = { order_userId: normalizedUserId };
        const statusFilter = parseStatusFilter(status);
        if (statusFilter) {
            filter.order_status =
                statusFilter.length > 1
                    ? { $in: statusFilter }
                    : statusFilter[0];
        }

        const pageNumber = Math.max(1, Number(page) || 1);
        const limitNumber = Math.max(1, Number(limit) || 50);
        const skip = (pageNumber - 1) * limitNumber;
        const sortBy = (sort === 'ctime') ? { _id: -1 } : { _id: 1 };
        
        const orders = await order.find(filter)
            .sort(sortBy)
            .skip(skip)
            .limit(limitNumber)
            .lean();

        return orders;
    }

    static async getOrdersByAdmin({ limit = 20, page = 1, sort = 'ctime', status, q, from, to }) {
        const filter = buildAdminOrderFilter({ status, q, from, to });
        const summaryFilter = { ...filter };
        delete summaryFilter.order_status;

        const pageNumber = normalizePositiveNumber(page, 1, { min: 1 });
        const limitNumber = normalizePositiveNumber(limit, 20, { min: 1, max: 100 });
        const skip = (pageNumber - 1) * limitNumber;
        const sortBy = resolveOrderSort(sort);

        const [items, total, summaryGroups] = await Promise.all([
            order.find(filter)
                .sort(sortBy)
                .skip(skip)
                .limit(limitNumber)
                .populate({
                    path: 'order_userId',
                    select: 'name email phone'
                })
                .lean(),
            order.countDocuments(filter),
            order.aggregate([
                { $match: summaryFilter },
                { $group: { _id: '$order_status', count: { $sum: 1 } } }
            ])
        ]);

        return {
            items,
            pagination: {
                total,
                page: pageNumber,
                limit: limitNumber,
                totalPages: total > 0 ? Math.ceil(total / limitNumber) : 1,
                hasNext: skip + items.length < total,
                hasPrev: pageNumber > 1
            },
            summary: buildOrderSummary(summaryGroups)
        };
    }

    static async deleteOrderByAdmin({ orderId }) {
        const orderObjectId = convertToObjectIdMongodb(orderId);
        if (!orderObjectId) throw new BadRequestError('Invalid order id');

        const foundOrder = await order.findById(orderObjectId).lean();
        if (!foundOrder) throw new NotFoundError('Order not found');

        const deletedOrder = await order.findByIdAndDelete(orderObjectId).lean();
        if (!deletedOrder) throw new BadRequestError('Delete order failed');

        if (shouldRollbackOnAdminDelete(foundOrder)) {
            try {
                await rollbackOrderSideEffects({ orderDoc: foundOrder });
            } catch (error) {
                console.error('Rollback side effects after admin delete order error', error);
            }
        }

        return {
            deleted: true,
            deletedCount: 1,
            order: deletedOrder
        };
    }

    static async bulkDeleteOrdersByAdmin({ ids = [], allFiltered = false, filters = {} }) {
        let matchFilter = null;
        let requestedCount = 0;

        if (allFiltered) {
            matchFilter = buildAdminOrderFilter(filters || {});
        } else {
            const objectIds = normalizeObjectIdList(ids);
            if (!objectIds.length) {
                throw new BadRequestError('No valid order ids provided');
            }
            requestedCount = objectIds.length;
            matchFilter = { _id: { $in: objectIds } };
        }

        const matchedOrders = await order
            .find(matchFilter)
            .select('_id order_status order_userId order_cartId order_products')
            .lean();

        if (!matchedOrders.length) {
            return {
                deleted: true,
                deletedCount: 0,
                matchedCount: 0,
                requestedCount,
                rollbackAppliedCount: 0,
                rollbackFailureCount: 0,
                allFiltered: Boolean(allFiltered)
            };
        }

        const idsToDelete = matchedOrders.map((item) => item._id);
        const deleteResult = await order.deleteMany({ _id: { $in: idsToDelete } });
        const deletedCount = Number(deleteResult?.deletedCount) || 0;

        const rollbackCandidates = matchedOrders.filter(shouldRollbackOnAdminDelete);
        let rollbackFailureCount = 0;
        if (rollbackCandidates.length) {
            const rollbackResults = await Promise.allSettled(
                rollbackCandidates.map((item) => rollbackOrderSideEffects({ orderDoc: item }))
            );
            rollbackFailureCount = rollbackResults.filter((result) => result.status === 'rejected').length;
            if (rollbackFailureCount > 0) {
                rollbackResults.forEach((result) => {
                    if (result.status === 'rejected') {
                        console.error('Rollback side effects after admin bulk delete order error', result.reason);
                    }
                });
            }
        }

        return {
            deleted: true,
            deletedCount,
            matchedCount: matchedOrders.length,
            requestedCount: allFiltered ? matchedOrders.length : requestedCount,
            rollbackAppliedCount: rollbackCandidates.length - rollbackFailureCount,
            rollbackFailureCount,
            allFiltered: Boolean(allFiltered)
        };
    }

     /*
    2> query Orders Using Id [User]
    */
    static async getOneOrderByUser({ userId, orderId }) {
        const normalizedUserId = normalizeUserId(userId);
        if (!normalizedUserId) throw new BadRequestError('Invalid user id');

        const orderObjectId = convertToObjectIdMongodb(orderId);
        if (!orderObjectId) throw new BadRequestError('Invalid order id');

        const foundOrder = await order.findOne({
            _id: orderObjectId,
            order_userId: normalizedUserId
        }).lean();

        if (!foundOrder) throw new NotFoundError('Order not found');
        return foundOrder;
    }

     /*
    3> cancel Orders [User]
    */
    static async cancelOrderByUser({ userId, orderId, reason }) {
        const normalizedUserId = normalizeUserId(userId);
        if (!normalizedUserId) throw new BadRequestError('Invalid user id');

        const orderObjectId = convertToObjectIdMongodb(orderId);
        if (!orderObjectId) throw new BadRequestError('Invalid order id');

        const foundOrder = await order.findOne({
            _id: orderObjectId,
            order_userId: normalizedUserId
        }).lean();

        if (!foundOrder) throw new NotFoundError('Order not found');

        const currentStatus = foundOrder.order_status;
        if (currentStatus === 'cancel_requested') {
            throw new BadRequestError('Cancel request already pending');
        }

        const sanitizedReason = typeof reason === 'string' ? reason.trim() : reason;

        if (currentStatus === 'confirmed') {
            const cancelRequest = {
                status: 'pending',
                reason: sanitizedReason || null,
                requestedBy: normalizedUserId,
                requestedAt: new Date()
            };

            const updatedOrder = await order.findOneAndUpdate(
                { _id: orderObjectId, order_userId: normalizedUserId, order_status: currentStatus },
                { $set: { order_status: 'cancel_requested', order_cancel_request: cancelRequest } },
                { new: true }
            ).lean();

            if (!updatedOrder) throw new BadRequestError('Cancel request failed');
            try {
                await NotificationService.notifyCancelRequest({
                    order: updatedOrder,
                    userId: normalizedUserId,
                    reason: sanitizedReason
                });
            } catch (error) {
                console.error('Notify cancel request error', error);
            }
            return updatedOrder;
        }

        if (!ORDER_STATUS_FLOW[currentStatus]?.includes('cancelled')) {
            throw new BadRequestError('Order cannot be cancelled');
        }

        const cancelRequest = {
            status: 'approved',
            reason: sanitizedReason || null,
            requestedBy: normalizedUserId,
            requestedAt: new Date(),
            reviewedBy: normalizedUserId,
            reviewedAt: new Date(),
            reviewerType: 'User'
        };

        const updatedOrder = await order.findOneAndUpdate(
            { _id: orderObjectId, order_userId: normalizedUserId, order_status: currentStatus },
            {
                $set: {
                    order_status: 'cancelled',
                    order_cancel_request: cancelRequest,
                    order_payment_status: 'failed',
                    order_cod_status: 'failed',
                    order_shipping_status: 'cancelled'
                }
            },
            { new: true }
        ).lean();

        if (!updatedOrder) throw new BadRequestError('Cancel order failed');
        await rollbackOrderSideEffects({ orderDoc: updatedOrder });
        return updatedOrder;
    }

     /*
    4> update Orders Status [Shop | Admin]
    */
    static async updateOrderStatusByShop({ orderId, status, shopId, isAdmin = false, actorId, actorType }) {
        ensureValidStatus(status);

        const orderObjectId = convertToObjectIdMongodb(orderId);
        if (!orderObjectId) throw new BadRequestError('Invalid order id');

        if (!isAdmin && !shopId) {
            throw new BadRequestError('Shop id is required');
        }

        const query = { _id: orderObjectId };
        if (shopId) {
            query['order_products.shopId'] = shopId;
        }

        const foundOrder = await order.findOne(query).lean();
        if (!foundOrder) throw new NotFoundError('Order not found');

        const currentStatus = foundOrder.order_status;
        if (currentStatus === status) return foundOrder;
        if (!ORDER_STATUS_FLOW[currentStatus]?.includes(status)) {
            throw new BadRequestError('Invalid order status transition');
        }

        const updatePayload = { order_status: status };
        if (status === 'cancelled') {
            updatePayload.order_payment_status = 'failed';
            updatePayload.order_cod_status = 'failed';
            updatePayload.order_shipping_status = 'cancelled';
        }
        if (status === 'returned') {
            updatePayload.order_payment_status = 'refunded';
            updatePayload.order_cod_status = 'returned';
            updatePayload.order_shipping_status = 'returned';
        }
        if (currentStatus === 'cancel_requested') {
            const now = new Date();
            const reviewerType = actorType || (isAdmin ? 'Admin' : 'Shop');
            const reviewerId = actorId ?? (isAdmin ? null : shopId);
            const cancelRequest = foundOrder.order_cancel_request || {};

            if (status === 'cancelled') {
                updatePayload.order_cancel_request = {
                    ...cancelRequest,
                    status: 'approved',
                    reviewedBy: reviewerId,
                    reviewedAt: now,
                    reviewerType
                };
            }
            if (status === 'confirmed') {
                updatePayload.order_cancel_request = {
                    ...cancelRequest,
                    status: 'rejected',
                    reviewedBy: reviewerId,
                    reviewedAt: now,
                    reviewerType
                };
            }
        }

        const updatedOrder = await order.findOneAndUpdate(
            { _id: orderObjectId, order_status: currentStatus },
            { $set: updatePayload },
            { new: true }
        ).lean();

        if (!updatedOrder) throw new BadRequestError('Order status update failed');
        if (status === 'cancelled' || status === 'returned') {
            await rollbackOrderSideEffects({ orderDoc: updatedOrder });
        }
        return updatedOrder;
    }

    static async rollbackOrderSideEffects({ orderDoc }) {
        return rollbackOrderSideEffects({ orderDoc });
    }
}

module.exports = CheckoutService;


