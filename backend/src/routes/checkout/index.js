'use strict'

const express = require('express');

const checkoutController = require('../../controllers/checkout.controller');
const router = express.Router();
const { asyncHandler } = require('../../auth/checkAuth');
const { authenticationUser, authenticationAdmin } = require('../../auth/authUtils');

router.post('/guest/orders', asyncHandler(checkoutController.createGuestOrder));

router.post('/review', authenticationUser, asyncHandler(checkoutController.checkoutReview));

router.post('/orders', authenticationUser, asyncHandler(checkoutController.createOrder));
router.get('/orders', authenticationUser, asyncHandler(checkoutController.getOrdersByUser));
router.get('/orders/:orderId', authenticationUser, asyncHandler(checkoutController.getOneOrderByUser));
router.post('/orders/:orderId/cancel', authenticationUser, asyncHandler(checkoutController.cancelOrderByUser));

router.get('/admin/orders', authenticationAdmin, asyncHandler(checkoutController.getOrdersByAdmin));
router.post('/admin/orders/bulk-delete', authenticationAdmin, asyncHandler(checkoutController.bulkDeleteOrdersByAdmin));
router.patch('/admin/orders/:orderId/status', authenticationAdmin, asyncHandler(checkoutController.updateOrderStatusByAdmin));
router.delete('/admin/orders/:orderId', authenticationAdmin, asyncHandler(checkoutController.deleteOrderByAdmin));

module.exports = router;
