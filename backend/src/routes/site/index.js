'use strict'

const express = require('express');
const asyncHandler = require('../../helpers/asyncHandler');
const siteSettingController = require('../../controllers/siteSetting.controller');
const { authenticationAdmin } = require('../../auth/authUtils');
const { requireAdminRole } = require('../../middleware/requireAdminRole');

const router = express.Router();

router.get('/', asyncHandler(siteSettingController.getPublic));
router.get('/agent-knowledge', asyncHandler(siteSettingController.getAgentKnowledge));

router.use(authenticationAdmin);
router.patch(
	'/',
	requireAdminRole(['ADMIN', 'SUPER_ADMIN']),
	asyncHandler(siteSettingController.update)
);
router.patch(
	'/agent-knowledge',
	requireAdminRole(['ADMIN', 'SUPER_ADMIN']),
	asyncHandler(siteSettingController.updateAgentKnowledge)
);

module.exports = router;
