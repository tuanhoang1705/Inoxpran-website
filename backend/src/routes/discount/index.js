'use strict'

const express = require('express');
const discountController = require('../../controllers/discount.controller');
const router = express.Router();
const { asyncHandler } = require('../../auth/checkAuth');
const { authenticationV2, authenticationUser } = require('../../auth/authUtils');

// get amount a discount

router.post('/amount', asyncHandler(discountController.getDiscountAmount));
router.get('/list_product_code', asyncHandler(discountController.getAllDiscountCodeWithProducts));

router.post('/usage', authenticationUser, asyncHandler(discountController.recordDiscountUsage));
router.post('/cancel', authenticationUser, asyncHandler(discountController.cancelDiscountCode));

// authentication //

router.use(authenticationV2);

router.post('', asyncHandler(discountController.createDisscountCode));
router.get('', asyncHandler(discountController.getAllDiscountCodes));
router.delete('/:codeId', asyncHandler(discountController.deleteDiscountCode));

module.exports = router;
