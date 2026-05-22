'use strict'

const CheckoutService = require("../services/checkout.service");

const { SuccessResponse } = require("../core/success.response");

class CheckoutController{

    checkoutReview = async (req, res, next) => {
        // new
        new SuccessResponse({
            message: 'Create new Cart success',
            metadata: await CheckoutService.checkoutReview({
                userId: req.user.userId,
                ...req.body
            })
        }).send(res)
    }

    createOrder = async (req, res, next) => {
        new SuccessResponse({
            message: 'Create order success',
            metadata: await CheckoutService.orderByUser({
                userId: req.user.userId,
                ...req.body
            })
        }).send(res);
    }

    createGuestOrder = async (req, res, next) => {
        new SuccessResponse({
            message: 'Create guest order success',
            metadata: await CheckoutService.orderByGuest(req.body)
        }).send(res);
    }

    getOrdersByUser = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get orders success',
            metadata: await CheckoutService.getOrdersByUser({
                userId: req.user.userId,
                ...req.query
            })
        }).send(res);
    }

    getOrdersByAdmin = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get admin orders success',
            metadata: await CheckoutService.getOrdersByAdmin(req.query)
        }).send(res);
    }

    getOneOrderByUser = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get order success',
            metadata: await CheckoutService.getOneOrderByUser({
                userId: req.user.userId,
                orderId: req.params.orderId
            })
        }).send(res);
    }

    cancelOrderByUser = async (req, res, next) => {
        new SuccessResponse({
            message: 'Cancel order success',
            metadata: await CheckoutService.cancelOrderByUser({
                userId: req.user.userId,
                orderId: req.params.orderId,
                reason: req.body?.reason
            })
        }).send(res);
    }

    updateOrderStatusByAdmin = async (req, res, next) => {
        new SuccessResponse({
            message: 'Update order status success',
            metadata: await CheckoutService.updateOrderStatusByShop({
                orderId: req.params.orderId,
                status: req.body.status,
                isAdmin: true,
                actorId: req.user.userId,
                actorType: 'Admin'
            })
        }).send(res);
    }

    deleteOrderByAdmin = async (req, res, next) => {
        new SuccessResponse({
            message: 'Delete order success',
            metadata: await CheckoutService.deleteOrderByAdmin({
                orderId: req.params.orderId
            })
        }).send(res);
    }

    bulkDeleteOrdersByAdmin = async (req, res, next) => {
        new SuccessResponse({
            message: 'Bulk delete orders success',
            metadata: await CheckoutService.bulkDeleteOrdersByAdmin({
                ids: req.body?.ids,
                allFiltered: Boolean(req.body?.allFiltered),
                filters: req.body?.filters || {}
            })
        }).send(res);
    }
}

module.exports = new CheckoutController();

