'use strict'

const { SuccessResponse, CREATED } = require('../core/success.response');
const { AgenticBlogCoreService } = require('../services/agenticBlogCore.service');

class AgenticBlogCoreController {
    listStyles = async (req, res) => new SuccessResponse({
        message: 'Get editorial style library success',
        metadata: await AgenticBlogCoreService.listStyles()
    }).send(res);

    updateStyle = async (req, res) => new SuccessResponse({
        message: 'Update editorial style success',
        metadata: await AgenticBlogCoreService.updateStyle({ styleId: req.params.styleId, payload: req.body || {} })
    }).send(res);

    generateTodayStyle = async (req, res) => new CREATED({
        message: 'Generate today editorial style success',
        metadata: await AgenticBlogCoreService.generateTodayStyle()
    }).send(res);

    getResearchBundle = async (req, res) => new SuccessResponse({
        message: 'Get research bundle success',
        metadata: await AgenticBlogCoreService.getResearchBundle({ bundleId: req.params.bundleId })
    }).send(res);

    getStrategy = async (req, res) => new SuccessResponse({
        message: 'Get blog strategy success',
        metadata: await AgenticBlogCoreService.getStrategy({ strategyId: req.params.strategyId })
    }).send(res);
}

module.exports = new AgenticBlogCoreController();
