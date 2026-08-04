'use strict'

const express = require('express');

const checkoutController = require('../../controllers/checkout.controller');
const router = express.Router();
const { asyncHandler, permission, PERMISSIONS } = require('../../auth/checkAuth');
const { authenticationUser, authenticationAdmin } = require('../../auth/authUtils');

router.post('/guest/orders', asyncHandler(checkoutController.createGuestOrder));

const requireUser = [permission(PERMISSIONS.USER), authenticationUser];
const requireAdmin = [permission(PERMISSIONS.ADMIN), authenticationAdmin];

router.post('/review', requireUser, asyncHandler(checkoutController.checkoutReview));

router.post('/orders', requireUser, asyncHandler(checkoutController.createOrder));
router.get('/orders', requireUser, asyncHandler(checkoutController.getOrdersByUser));
router.get('/orders/:orderId', requireUser, asyncHandler(checkoutController.getOneOrderByUser));
router.post('/orders/:orderId/cancel', requireUser, asyncHandler(checkoutController.cancelOrderByUser));

router.get('/admin/orders', requireAdmin, asyncHandler(checkoutController.getOrdersByAdmin));
router.post('/admin/orders/bulk-delete', requireAdmin, asyncHandler(checkoutController.bulkDeleteOrdersByAdmin));
router.patch('/admin/orders/:orderId/status', requireAdmin, asyncHandler(checkoutController.updateOrderStatusByAdmin));
router.delete('/admin/orders/:orderId', requireAdmin, asyncHandler(checkoutController.deleteOrderByAdmin));

module.exports = router;
