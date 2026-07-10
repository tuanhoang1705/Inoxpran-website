'use strict'

const express = require('express');
const asyncHandler = require('../../helpers/asyncHandler');
const telegramIntegrationController = require('../../controllers/telegramIntegration.controller');

const router = express.Router();

router.post(
    '/telegram/webhook',
    asyncHandler(telegramIntegrationController.handleWebhook)
);

module.exports = router;
