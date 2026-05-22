'use strict'

const axios = require('axios');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../core/error.response');
const { order } = require('../models/order');
const { shipment } = require('../models/shipment.model');
const CheckoutService = require('../services/checkout.service');
const { convertToObjectIdMongodb, removeUndefinedObject } = require('../utils');
const { getProductById } = require('../models/repositories/product.repo');

const GHTK_BASE_URL = process.env.GHTK_BASE_URL || 'https://services.giaohangtietkiem.vn';
const GHTK_API_TOKEN = process.env.GHTK_API_TOKEN;
const GHTK_CLIENT_SOURCE = process.env.GHTK_CLIENT_SOURCE;
const GHTK_DEFAULT_PICKUP = {
    pick_address_id: process.env.GHTK_PICK_ADDRESS_ID,
    pick_address: process.env.GHTK_PICK_ADDRESS,
    pick_province: process.env.GHTK_PICK_PROVINCE,
    pick_district: process.env.GHTK_PICK_DISTRICT,
    pick_ward: process.env.GHTK_PICK_WARD,
    pick_street: process.env.GHTK_PICK_STREET
};
const DEFAULT_FEE_AMOUNT = 70000;
const DEFAULT_FEE_WEIGHT_GRAM = 3000;

const normalizeAddress = (address = {}) => {
    if (!address || typeof address !== 'object') return {};
    return removeUndefinedObject({
        name: address.name ?? address.fullName ?? address.receiverName ?? address.receiver_name,
        phone: address.phone ?? address.tel ?? address.receiverPhone ?? address.receiver_phone,
        address: address.address ?? address.street ?? address.line1 ?? address.detail,
        ward: address.ward ?? address.wardName ?? address.ward_code ?? address.wardCode,
        district: address.district ?? address.districtName ?? address.district_code ?? address.districtCode,
        province: address.province ?? address.city ?? address.state ?? address.provinceName ?? address.province_code,
        hamlet: address.hamlet
    });
};

const normalizeNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? fallback : parsed;
};

const normalizePositiveInteger = (value, fallback = 0) => {
    const parsed = Math.floor(normalizeNumber(value, fallback));
    return parsed > 0 ? parsed : fallback;
};

const normalizePickupForFee = (pickup = {}) => {
    const source = pickup && typeof pickup === 'object' ? pickup : {};
    return removeUndefinedObject({
        pick_address_id: source.pick_address_id ?? source.pickAddressId ?? GHTK_DEFAULT_PICKUP.pick_address_id,
        pick_address: source.pick_address ?? source.address ?? GHTK_DEFAULT_PICKUP.pick_address,
        pick_province: source.pick_province ?? source.province ?? GHTK_DEFAULT_PICKUP.pick_province,
        pick_district: source.pick_district ?? source.district ?? GHTK_DEFAULT_PICKUP.pick_district,
        pick_ward: source.pick_ward ?? source.ward ?? GHTK_DEFAULT_PICKUP.pick_ward,
        pick_street: source.pick_street ?? source.street ?? GHTK_DEFAULT_PICKUP.pick_street
    });
};

const normalizeReceiverForFee = (receiver = {}) => {
    const normalized = normalizeAddress(receiver);
    const source = receiver && typeof receiver === 'object' ? receiver : {};
    return removeUndefinedObject({
        address: source.address ?? normalized.address,
        province: source.province ?? normalized.province,
        district: source.district ?? normalized.district,
        ward: source.ward ?? normalized.ward,
        street: source.street
    });
};

const calculateFallbackFeeAmount = (weight) => {
    const safeWeight = normalizePositiveInteger(weight, DEFAULT_FEE_WEIGHT_GRAM);
    const blocks = Math.max(1, Math.ceil(safeWeight / DEFAULT_FEE_WEIGHT_GRAM));
    return blocks * DEFAULT_FEE_AMOUNT;
};

const buildFallbackFeeQuote = ({ params, weight, reason }) => {
    const fallbackFee = calculateFallbackFeeAmount(weight);
    return {
        provider: 'GHTK',
        fallback: true,
        reason: reason || 'fallback_rate',
        fee: {
            name: 'fallback_weight_rate',
            fee: fallbackFee,
            insurance_fee: 0,
            extra_fee: 0,
            total_fee: fallbackFee,
            delivery: true,
            delivery_type: 'fallback',
            ext_fees: []
        },
        request: params,
        rate: {
            amount: DEFAULT_FEE_AMOUNT,
            weight_gram: DEFAULT_FEE_WEIGHT_GRAM
        }
    };
};

const resolveFallbackReasonFromProviderError = (error) => {
    if (error?.code === 'ECONNABORTED') {
        return 'provider_timeout';
    }

    const status = normalizePositiveInteger(error?.response?.status, 0);
    if (!status) {
        return 'provider_unreachable';
    }
    if (status === 401 || status === 403) {
        return 'provider_auth_failed';
    }
    if (status >= 500) {
        return 'provider_server_error';
    }
    return `provider_http_${status}`;
};

const buildShipmentItems = async ({ items = [], defaultWeight = 1000 }) => {
    const mapped = await Promise.all(items.map(async (item) => {
        const foundProduct = await getProductById(item.productId);
        const name = foundProduct?.product_name || `product-${item.productId}`;
        const weight = normalizeNumber(foundProduct?.product_weight, defaultWeight);
        return {
            productId: item.productId,
            name,
            quantity: normalizeNumber(item.quantity),
            price: normalizeNumber(item.price),
            weight
        };
    }));
    return mapped;
};

const mapGhtkStatus = (status) => {
    const statusText = String(status ?? '').trim();
    const statusMap = {
        '1': 'label_created',
        '2': 'picked_up',
        '3': 'in_transit',
        '4': 'delivered',
        '5': 'returned',
        '6': 'cancelled'
    };
    if (statusMap[statusText]) return statusMap[statusText];
    if (['pending', 'label_created', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned', 'cancelled'].includes(statusText)) {
        return statusText;
    }
    return 'pending';
};

const buildOrderUpdateFromShipping = ({ shippingStatus, currentStatus }) => {
    const update = { order_shipping_status: shippingStatus };

    if (shippingStatus === 'delivered') {
        update.order_status = 'delivered';
        update.order_payment_status = 'paid';
        update.order_cod_status = 'collected';
        return update;
    }

    if (shippingStatus === 'returned') {
        update.order_status = 'returned';
        update.order_payment_status = 'refunded';
        update.order_cod_status = 'returned';
        return update;
    }

    if (shippingStatus === 'cancelled') {
        update.order_status = 'cancelled';
        update.order_payment_status = 'failed';
        update.order_cod_status = 'failed';
        return update;
    }

    if (['label_created', 'picked_up', 'in_transit'].includes(shippingStatus)
        && ['pending', 'confirmed'].includes(currentStatus)) {
        update.order_status = 'shipped';
    }

    return update;
};

const createGhtkShipment = async ({ shipmentDoc, orderDoc, shopOrder, pickup, receiver, items, codAmount, note, transport, deliverOption }) => {
    if (!GHTK_API_TOKEN) {
        throw new BadRequestError('GHTK token is missing');
    }

    const orderPayload = removeUndefinedObject({
        id: String(shipmentDoc._id),
        pick_name: pickup.name,
        pick_address: pickup.address,
        pick_province: pickup.province,
        pick_district: pickup.district,
        pick_ward: pickup.ward,
        pick_tel: pickup.phone,
        name: receiver.name,
        address: receiver.address,
        province: receiver.province,
        district: receiver.district,
        ward: receiver.ward,
        hamlet: receiver.hamlet,
        tel: receiver.phone,
        is_freeship: 0,
        pick_money: codAmount,
        value: codAmount,
        note,
        transport,
        deliver_option: deliverOption
    });

    const productsPayload = items.map((item) => ({
        name: item.name,
        weight: item.weight,
        quantity: item.quantity,
        price: item.price,
        product_code: item.productId
    }));

    const payload = {
        order: orderPayload,
        products: productsPayload
    };

    const response = await axios.post(
        `${GHTK_BASE_URL}/services/shipment/order`,
        payload,
        {
            headers: {
                Token: GHTK_API_TOKEN,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        }
    );

    if (!response?.data || response.data.success === false) {
        throw new BadRequestError(response?.data?.message || 'GHTK create shipment failed');
    }

    return {
        rawRequest: payload,
        rawResponse: response.data
    };
};

class ShippingService {
    static async calculateShippingFee({
        provider = 'GHTK',
        pickup = {},
        receiver = {},
        package: packageInfo = {},
        value,
        transport = 'road',
        tags = []
    }) {
        if (provider !== 'GHTK') {
            throw new BadRequestError('Unsupported shipping provider');
        }

        const receiverParams = normalizeReceiverForFee(receiver);
        const weight = normalizePositiveInteger(
            packageInfo?.weight ?? packageInfo?.totalWeight ?? packageInfo?.gram,
            0
        );
        const declaredValue = Math.max(
            0,
            Math.floor(normalizeNumber(value ?? packageInfo?.value ?? packageInfo?.declaredValue, 0))
        );

        if (!receiverParams.province || !receiverParams.district) {
            throw new BadRequestError('Receiver province and district are required');
        }
        if (!weight) {
            throw new BadRequestError('Package weight is required');
        }

        const baseParams = removeUndefinedObject({
            ...receiverParams,
            weight,
            value: declaredValue,
            transport: ['road', 'fly'].includes(transport) ? transport : 'road'
        });

        if (Array.isArray(tags) && tags.length) {
            baseParams.tags = tags.filter(Boolean);
        }

        if (!GHTK_API_TOKEN) {
            return buildFallbackFeeQuote({
                params: baseParams,
                weight,
                reason: 'missing_api_token'
            });
        }

        const pickupParams = normalizePickupForFee(pickup);
        if (!pickupParams.pick_province || !pickupParams.pick_district) {
            return buildFallbackFeeQuote({
                params: removeUndefinedObject({
                    ...pickupParams,
                    ...baseParams
                }),
                weight,
                reason: 'missing_pickup_config'
            });
        }

        const params = removeUndefinedObject({
            ...pickupParams,
            ...baseParams
        });

        try {
            const response = await axios.get(
                `${GHTK_BASE_URL}/services/shipment/fee`,
                {
                    params,
                    headers: {
                        Token: GHTK_API_TOKEN,
                        ...(GHTK_CLIENT_SOURCE ? { 'X-Client-Source': GHTK_CLIENT_SOURCE } : {})
                    },
                    timeout: 15000
                }
            );

            if (!response?.data || response.data.success === false || !response.data.fee) {
                return buildFallbackFeeQuote({
                    params,
                    weight,
                    reason: 'provider_invalid_response'
                });
            }

            const feeInfo = response.data.fee || {};
            const baseFee = normalizeNumber(feeInfo.fee, 0);
            const insuranceFee = normalizeNumber(feeInfo.insurance_fee, 0);
            const extFees = Array.isArray(feeInfo.extFees) ? feeInfo.extFees : [];
            const extraFee = extFees.reduce((sum, entry) => sum + normalizeNumber(entry?.amount, 0), 0);
            const totalFee = Math.max(0, baseFee + insuranceFee + extraFee);

            return {
                provider: 'GHTK',
                fallback: false,
                fee: {
                    name: feeInfo.name || null,
                    fee: baseFee,
                    insurance_fee: insuranceFee,
                    extra_fee: extraFee,
                    total_fee: totalFee,
                    delivery: Boolean(feeInfo.delivery),
                    delivery_type: feeInfo.delivery_type || null,
                    ext_fees: extFees
                },
                request: params
            };
        } catch (error) {
            return buildFallbackFeeQuote({
                params,
                weight,
                reason: resolveFallbackReasonFromProviderError(error)
            });
        }
    }

    static async createShipment({
        orderId,
        shopId,
        provider = 'GHTK',
        service,
        note,
        transport = 'road',
        deliver_option: deliverOption = 'none',
        pickup = {},
        package: packageInfo = {},
        cod_amount: codAmount,
        actor
    }) {
        if (actor?.userType === 'User') {
            throw new ForbiddenError('User cannot create shipment');
        }

        const orderObjectId = convertToObjectIdMongodb(orderId);
        if (!orderObjectId) {
            throw new BadRequestError('Invalid order id');
        }

        let resolvedShopId = shopId;
        if (!resolvedShopId && actor?.userType === 'Shop') {
            resolvedShopId = actor.userId;
        }
        if (!resolvedShopId) {
            throw new BadRequestError('Shop id is required');
        }

        if (actor?.userType === 'Shop' && String(actor.userId) !== String(resolvedShopId)) {
            throw new ForbiddenError('Shop is not allowed to create shipment for this order');
        }

        const orderDoc = await order.findById(orderObjectId).lean();
        if (!orderDoc) {
            throw new NotFoundError('Order not found');
        }

        if (actor?.userType === 'User' && String(orderDoc.order_userId) !== String(actor.userId)) {
            throw new ForbiddenError('Order does not belong to the user');
        }

        const shopOrder = Array.isArray(orderDoc.order_products)
            ? orderDoc.order_products.find((item) => String(item.shopId) === String(resolvedShopId))
            : null;
        if (!shopOrder) {
            throw new NotFoundError('Order items not found for shop');
        }

        const existingShipment = await shipment.findOne({
            shipment_order_id: orderObjectId,
            shipment_shop_id: String(resolvedShopId),
            shipment_status: { $ne: 'cancelled' }
        }).lean();
        if (existingShipment) {
            return existingShipment;
        }

        if (!['pending', 'confirmed'].includes(orderDoc.order_status)) {
            throw new BadRequestError('Order is not ready for shipping');
        }

        const receiver = normalizeAddress(orderDoc.order_shipping);
        const pickupAddress = normalizeAddress(pickup);
        if (!receiver.address || !receiver.district || !receiver.province || !receiver.ward || !receiver.name || !receiver.phone) {
            throw new BadRequestError('Shipping address is incomplete');
        }
        if (!pickupAddress.address || !pickupAddress.district || !pickupAddress.province || !pickupAddress.ward || !pickupAddress.name || !pickupAddress.phone) {
            throw new BadRequestError('Pickup address is incomplete');
        }

        const defaultWeight = normalizeNumber(packageInfo?.weight, 1000);
        const items = await buildShipmentItems({
            items: shopOrder.item_products || [],
            defaultWeight
        });

        const computedCod = normalizeNumber(shopOrder.priceApplyDiscount ?? shopOrder.priceRaw, 0);
        const finalCodAmount = normalizeNumber(codAmount, computedCod);

        const shipmentDoc = await shipment.create({
            shipment_order_id: orderObjectId,
            shipment_shop_id: String(resolvedShopId),
            shipment_user_id: orderDoc.order_userId,
            shipment_provider: provider,
            shipment_service: service,
            shipment_status: 'pending',
            shipment_cod_amount: finalCodAmount,
            shipment_from: pickupAddress,
            shipment_to: receiver,
            shipment_items: items,
            shipment_history: [{
                status: 'pending',
                message: 'Shipment created',
                createdAt: new Date()
            }]
        });

        let updatePayload = {
            shipment_raw_request: {},
            shipment_raw_response: {}
        };

        if (provider === 'GHTK') {
            const ghtkResponse = await createGhtkShipment({
                shipmentDoc,
                orderDoc,
                shopOrder,
                pickup: pickupAddress,
                receiver,
                items,
                codAmount: finalCodAmount,
                note,
                transport,
                deliverOption
            });

            const trackingNumber =
                ghtkResponse.rawResponse?.order?.label ||
                ghtkResponse.rawResponse?.order?.tracking_number ||
                ghtkResponse.rawResponse?.tracking_number;
            const labelUrl =
                ghtkResponse.rawResponse?.order?.label_url ||
                ghtkResponse.rawResponse?.order?.print_label;
            const fee = normalizeNumber(ghtkResponse.rawResponse?.order?.fee, 0);

            updatePayload = {
                shipment_status: 'label_created',
                shipment_tracking_number: trackingNumber || null,
                shipment_label_url: labelUrl || null,
                shipment_fee: fee,
                shipment_external_id: ghtkResponse.rawResponse?.order?.partner_id || null,
                shipment_raw_request: ghtkResponse.rawRequest,
                shipment_raw_response: ghtkResponse.rawResponse,
                $push: {
                    shipment_history: {
                        status: 'label_created',
                        message: 'Label created',
                        createdAt: new Date()
                    }
                }
            };
        }

        const updatedShipment = await shipment.findByIdAndUpdate(
            shipmentDoc._id,
            updatePayload,
            { new: true }
        ).lean();

        const shippingStatus = updatePayload.shipment_status || 'pending';
        const orderStatusUpdate = buildOrderUpdateFromShipping({
            shippingStatus,
            currentStatus: orderDoc.order_status
        });
        const orderUpdate = {
            $addToSet: { order_shipments: shipmentDoc._id },
            $set: {
                ...orderStatusUpdate,
                order_shipping_provider: provider,
                order_trackingNumber: updatePayload.shipment_tracking_number || orderDoc.order_trackingNumber
            }
        };
        await order.updateOne({ _id: orderObjectId }, orderUpdate);

        return updatedShipment;
    }

    static async getShipmentsByOrder({ orderId, shopId, actor }) {
        const orderObjectId = convertToObjectIdMongodb(orderId);
        if (!orderObjectId) {
            throw new BadRequestError('Invalid order id');
        }

        const orderDoc = await order.findById(orderObjectId).lean();
        if (!orderDoc) {
            throw new NotFoundError('Order not found');
        }

        const filter = { shipment_order_id: orderObjectId };
        if (actor?.userType === 'User' && String(orderDoc.order_userId) !== String(actor.userId)) {
            throw new ForbiddenError('Order does not belong to the user');
        }
        if (actor?.userType === 'Shop') {
            filter.shipment_shop_id = String(actor.userId);
        } else if (shopId) {
            filter.shipment_shop_id = String(shopId);
        }

        return await shipment.find(filter).lean();
    }

    static async getShipmentById({ shipmentId, actor }) {
        const shipmentObjectId = convertToObjectIdMongodb(shipmentId);
        if (!shipmentObjectId) {
            throw new BadRequestError('Invalid shipment id');
        }

        const shipmentDoc = await shipment.findById(shipmentObjectId).lean();
        if (!shipmentDoc) {
            throw new NotFoundError('Shipment not found');
        }

        if (actor?.userType === 'Shop' && String(shipmentDoc.shipment_shop_id) !== String(actor.userId)) {
            throw new ForbiddenError('Shipment does not belong to the shop');
        }

        if (actor?.userType === 'User') {
            const orderDoc = await order.findById(shipmentDoc.shipment_order_id).lean();
            if (!orderDoc || String(orderDoc.order_userId) !== String(actor.userId)) {
                throw new ForbiddenError('Shipment does not belong to the user');
            }
        }

        return shipmentDoc;
    }

    static async handleGhtkWebhook({ payload }) {
        if (!payload || typeof payload !== 'object') {
            throw new BadRequestError('Payload is required');
        }

        const trackingNumber = payload.label_id || payload.tracking_number || payload?.order?.label;
        if (!trackingNumber) {
            throw new BadRequestError('Tracking number is required');
        }

        const shipmentDoc = await shipment.findOne({
            shipment_tracking_number: trackingNumber
        }).lean();
        if (!shipmentDoc) {
            throw new NotFoundError('Shipment not found');
        }

        const nextStatus = mapGhtkStatus(payload.status_id ?? payload.status);
        const updatedShipment = await shipment.findByIdAndUpdate(
            shipmentDoc._id,
            {
                $set: {
                    shipment_status: nextStatus,
                    shipment_raw_response: payload
                },
                $push: {
                    shipment_history: {
                        status: nextStatus,
                        message: 'GHTK webhook update',
                        createdAt: new Date()
                    }
                }
            },
            { new: true }
        ).lean();

        const orderDoc = await order.findById(shipmentDoc.shipment_order_id).lean();
        if (!orderDoc) {
            throw new NotFoundError('Order not found');
        }
        const orderStatusUpdate = buildOrderUpdateFromShipping({
            shippingStatus: nextStatus,
            currentStatus: orderDoc.order_status
        });
        await order.updateOne(
            { _id: shipmentDoc.shipment_order_id },
            { $set: orderStatusUpdate }
        );

        const nextOrderStatus = orderStatusUpdate.order_status;
        if (nextOrderStatus && ['cancelled', 'returned'].includes(nextOrderStatus)) {
            const wasFinalized = ['cancelled', 'returned'].includes(orderDoc.order_status);
            if (!wasFinalized) {
                const updatedOrder = await order.findById(shipmentDoc.shipment_order_id).lean();
                await CheckoutService.rollbackOrderSideEffects({ orderDoc: updatedOrder });
            }
        }

        return updatedShipment;
    }
}

module.exports = ShippingService;
