'use strict'

const express = require('express');

const inventoryController = require('../../controllers/inventory.controller');
const router = express.Router();
const asyncHandler = require('../../helpers/asyncHandler');
const { authenticationAdmin } = require('../../auth/authUtils');


router.use(authenticationAdmin);
router.post('', asyncHandler(inventoryController.addStock));


module.exports = router;