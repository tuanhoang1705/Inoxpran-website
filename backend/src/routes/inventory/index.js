'use strict'

const express = require('express');

const inventoryController = require('../../controllers/inventory.controller');
const router = express.Router();
const asyncHandler = require('../../helpers/asyncHandler');
const { authenticationAdmin } = require('../../auth/authUtils');
const { permission, PERMISSIONS } = require('../../auth/checkAuth');


router.use(permission(PERMISSIONS.ADMIN));
router.use(authenticationAdmin);
router.post('', asyncHandler(inventoryController.addStock));


module.exports = router;
