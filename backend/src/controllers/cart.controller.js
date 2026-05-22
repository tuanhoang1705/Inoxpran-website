'use strict'

const CartService = require('../services/cart.service');
const { SuccessResponse } = require('../core/success.response');


class CartController{

    /**
        * @desc add to cart for user
        * @param {int} userId
        * @param {*} req
        * @param {*} res
        * @param {*} next
        * @param {*} POST
        * @method POST
        * @url /v1/api/cart/user
        * @return {
        * } 
     
     */

    // viết một file api để cho fe lên file đó để update realtime

    
    // query
    
    list = async (req, res, next) => {
        // new
        new SuccessResponse({
            message: 'Get cart success',
            metadata: await CartService.getListUserCart({
                userId: req.user.userId
            }),
        }).send(res);
    }

    // post

    addToCart = async (req, res, next) => {
        // new
        const product = req.body?.product ?? req.body;
        new SuccessResponse({
            message: 'Add to cart success',
            metadata: await CartService.addToCart({
                userId: req.user.userId,
                product
            }),
        }).send(res);
    }

    // update
    
    update = async (req, res, next) => {
        // new
        new SuccessResponse({
            message: 'Update cart success',
            metadata: await CartService.updateToCart({
                userId: req.user.userId,
                shop_order_ids: req.body?.shop_order_ids
            }),
        }).send(res);
    }

    //delete
    
    delete = async (req, res, next) => {
        // new
        new SuccessResponse({
            message: 'Delete cart item success',
            metadata: await CartService.deleteUserCart({
                userId: req.user.userId,
                productId: req.body?.productId,
                reason: req.body?.reason
            }),
        }).send(res);
    }


}

module.exports = new CartController();
