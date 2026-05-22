'use strict'

const SiteSettingService = require('../services/siteSetting.service');
const { SuccessResponse } = require('../core/success.response');

class SiteSettingController {
	getPublic = async (req, res, next) => {
		new SuccessResponse({
			message: 'Get site settings success',
			metadata: await SiteSettingService.getPublicSettings()
		}).send(res);
	};

	getAgentKnowledge = async (req, res, next) => {
		new SuccessResponse({
			message: 'Get agent knowledge settings success',
			metadata: await SiteSettingService.getAgentKnowledgeSettings()
		}).send(res);
	};

	update = async (req, res, next) => {
		new SuccessResponse({
			message: 'Update site settings success',
			metadata: await (() => {
				if (req.body?.chatConsole || Object.prototype.hasOwnProperty.call(req.body || {}, 'cannedReplies')) {
					return SiteSettingService.updateChatConsoleSettings({
						payload: req.body,
						adminId: req.user?.userId
					});
				}
				if (
					Object.prototype.hasOwnProperty.call(req.body || {}, 'marketingCampaign') ||
					Object.prototype.hasOwnProperty.call(req.body || {}, 'marketplaceLinks')
				) {
					return SiteSettingService.updateMarketingSettings({
						payload: req.body,
						adminId: req.user?.userId
					});
				}
				return SiteSettingService.updateFeatureFlags({
					payload: req.body,
					adminId: req.user?.userId
				});
			})()
		}).send(res);
	};

	updateAgentKnowledge = async (req, res, next) => {
		new SuccessResponse({
			message: 'Update agent knowledge settings success',
			metadata: await SiteSettingService.updateAgentKnowledgeSettings({
				payload: req.body,
				adminId: req.user?.userId
			})
		}).send(res);
	};
}

module.exports = new SiteSettingController();
