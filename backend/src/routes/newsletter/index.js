'use strict'

const express = require('express');
const asyncHandler = require('../../helpers/asyncHandler');
const newsletterController = require('../../controllers/newsletter.controller');

const router = express.Router();

router.post('/subscribe', asyncHandler(newsletterController.subscribe));

module.exports = router;
