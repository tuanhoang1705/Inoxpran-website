'use strict'

const express = require('express');
const shippingController = require('../../controllers/shipping.controller');
const router = express.Router();
const { asyncHandler } = require('../../auth/checkAuth');
const { authenticationV2 } = require('../../auth/authUtils');

router.post('/webhook/ghtk', asyncHandler(shippingController.handleGhtkWebhook));

router.use(authenticationV2);

router.post('/fee', asyncHandler(shippingController.calculateFee));
router.post('', asyncHandler(shippingController.createShipment));
router.get('/order/:orderId', asyncHandler(shippingController.getShipmentsByOrder));
router.get('/:shipmentId', asyncHandler(shippingController.getShipment));

module.exports = router;
