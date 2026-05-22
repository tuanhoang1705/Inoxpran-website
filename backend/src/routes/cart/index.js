'use strict'

const express = require('express');
const cartController = require('../../controllers/cart.controller');
const router = express.Router();
const { asyncHandler } = require('../../auth/checkAuth');
const { authenticationUser } = require('../../auth/authUtils');

router.use(authenticationUser);

router.get('', asyncHandler(cartController.list));
router.post('', asyncHandler(cartController.addToCart));
router.post('/update', asyncHandler(cartController.update));
router.delete('', asyncHandler(cartController.delete));

module.exports = router;
