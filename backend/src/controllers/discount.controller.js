'use strict'

 
const DisscountService = require('../services/discount.service');
const { SuccessResponse } = require('../core/success.response');

class DiscountController{
    createDisscountCode = async (req, res, next) => {
        new SuccessResponse({
            message: 'Discount code created',
            metadata: await DisscountService.createDiscountCode({
                ...req.body,
                shopId: req.user.userId
            })
       }).send(res); 
    }
    
    getAllDiscountCodes = async (req, res, next) => {
         new SuccessResponse({
            message: 'Discount codes fetched',
            metadata: await DisscountService.getAllDiscountCodesByShop({
                ...req.query
            })
       }).send(res); 
    }
      getDiscountAmount = async (req, res, next) => {
         new SuccessResponse({
            message: 'Discount amount calculated',
            metadata: await DisscountService.getDiscountAmount({
                ...req.body,
            })
       }).send(res); 
    }
      getAllDiscountCodeWithProducts = async (req, res, next) => {
         new SuccessResponse({
            message: 'Discount products fetched',
            metadata: await DisscountService.getAllDiscountCodesWithProduct({
                ...req.query
            })
       }).send(res); 
    }

    recordDiscountUsage = async (req, res, next) => {
        new SuccessResponse({
            message: 'Discount usage recorded',
            metadata: await DisscountService.recordDiscountUsage({
                discountId: req.body?.discountId,
                shopId: req.body?.shopId,
                userId: req.user.userId
            })
        }).send(res);
    }

    cancelDiscountCode = async (req, res, next) => {
        new SuccessResponse({
            message: 'Discount cancelled',
            metadata: await DisscountService.cancelDiscountCode({
                codeId: req.body?.codeId,
                shopId: req.body?.shopId,
                userId: req.user.userId
            })
        }).send(res);
    }

    deleteDiscountCode = async (req, res, next) => {
        new SuccessResponse({
            message: 'Discount deleted',
            metadata: await DisscountService.deleteDiscountCode({
                shopId: req.user.userId,
                codeId: req.params.codeId,
                deletedBy: req.user.userId,
                reason: req.body?.reason
            })
        }).send(res);
    }
}

module.exports = new DiscountController();
