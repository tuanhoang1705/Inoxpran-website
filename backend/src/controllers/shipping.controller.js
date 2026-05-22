'use strict'

const ShippingService = require('../services/shipping.service');
const { SuccessResponse } = require('../core/success.response');

class ShippingController {
    calculateFee = async (req, res, next) => {
        new SuccessResponse({
            message: 'Calculate shipment fee success',
            metadata: await ShippingService.calculateShippingFee(req.body || {})
        }).send(res);
    }

    createShipment = async (req, res, next) => {
        new SuccessResponse({
            message: 'Create shipment success',
            metadata: await ShippingService.createShipment({
                ...req.body,
                actor: {
                    userId: req.user?.userId,
                    userType: req.keyStore?.userType
                }
            })
        }).send(res);
    }

    getShipmentsByOrder = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get shipments success',
            metadata: await ShippingService.getShipmentsByOrder({
                orderId: req.params.orderId,
                shopId: req.query?.shopId,
                actor: {
                    userId: req.user?.userId,
                    userType: req.keyStore?.userType
                }
            })
        }).send(res);
    }

    getShipment = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get shipment success',
            metadata: await ShippingService.getShipmentById({
                shipmentId: req.params.shipmentId,
                actor: {
                    userId: req.user?.userId,
                    userType: req.keyStore?.userType
                }
            })
        }).send(res);
    }

    handleGhtkWebhook = async (req, res, next) => {
        new SuccessResponse({
            message: 'GHTK webhook received',
            metadata: await ShippingService.handleGhtkWebhook({
                payload: req.body
            })
        }).send(res);
    }
}

module.exports = new ShippingController();
