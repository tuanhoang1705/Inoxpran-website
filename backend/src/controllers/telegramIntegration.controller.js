'use strict'

const { SuccessResponse } = require('../core/success.response');
const { TelegramApprovalService } = require('../services/telegramApproval.service');

class TelegramIntegrationController {
    handleWebhook = async (req, res) => {
        new SuccessResponse({
            message: 'Telegram webhook processed',
            metadata: await TelegramApprovalService.handleWebhook({
                headers: req.headers || {},
                body: req.body || {}
            })
        }).send(res);
    };
}

module.exports = new TelegramIntegrationController();
