'use strict'

const express = require('express');
const asyncHandler = require('../../helpers/asyncHandler');
const contactController = require('../../controllers/contact.controller');

const router = express.Router();

router.post('/', asyncHandler(contactController.create));

module.exports = router;
