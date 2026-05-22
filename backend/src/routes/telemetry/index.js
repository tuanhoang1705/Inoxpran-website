'use strict';

const express = require('express');
const telemetryController = require('../../controllers/telemetry.controller');
const asyncHandler = require('../../helpers/asyncHandler');
const telemetrySessionMiddleware = require('../../middleware/telemetrySession');

const router = express.Router();

router.post('/events', telemetrySessionMiddleware, asyncHandler(telemetryController.captureEvents));

module.exports = router;
