'use strict'

const AutomationSeoBlogService = require('../services/automationSeoBlog.service');

const logAutomationResult = ({ req, result, status }) => {
    const body = req.body || {};
    console.info('seo-automation', {
        route: req.originalUrl,
        mode: body.mode,
        slug: body.slug,
        score: body?.review?.seoScore,
        result: status || result?.mode || 'unknown'
    });
};

class AutomationSeoBlogController {
    health = async (req, res, next) => {
        const metadata = await AutomationSeoBlogService.health();
        return res.json(metadata);
    }

    publish = async (req, res, next) => {
        const metadata = await AutomationSeoBlogService.publishSeoBlog({
            payload: req.body
        });
        logAutomationResult({ req, result: metadata });
        return res.json({
            status: 'success',
            metadata
        });
    }
}

module.exports = new AutomationSeoBlogController();
