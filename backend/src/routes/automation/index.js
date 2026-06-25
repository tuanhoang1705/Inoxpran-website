'use strict'

const express = require('express');
const asyncHandler = require('../../helpers/asyncHandler');
const automationSeoBlogController = require('../../controllers/automationSeoBlog.controller');
const { automationAuth } = require('../../middleware/automationAuth');

const router = express.Router();

router.use(automationAuth);

router.get('/seo-blog/health', asyncHandler(automationSeoBlogController.health));
router.post('/seo-blog/publish', asyncHandler(automationSeoBlogController.publish));

module.exports = router;
