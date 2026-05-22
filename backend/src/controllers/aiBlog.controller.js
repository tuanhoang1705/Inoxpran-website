'use strict'

const { SuccessResponse } = require('../core/success.response');
const AIBlogService = require('../services/aiBlog.service');

class AIBlogController {
    createFromBrief = async (req, res, next) => {
        new SuccessResponse({
            message: 'Create AI blog draft from brief success',
            metadata: await AIBlogService.createFromBrief({
                payload: req.body,
                reviewerId: req.user?.userId
            })
        }).send(res);
    }

    createAndPublishWithReview = async (req, res, next) => {
        new SuccessResponse({
            message: 'Create and publish AI blog with review success',
            metadata: await AIBlogService.createAndPublishWithReview({
                payload: req.body,
                reviewerId: req.user?.userId
            })
        }).send(res);
    }

    regenerateAndUpdate = async (req, res, next) => {
        new SuccessResponse({
            message: 'Regenerate and update AI blog draft success',
            metadata: await AIBlogService.regenerateAndUpdate({
                blogId: req.params.blogId,
                payload: req.body,
                reviewerId: req.user?.userId
            })
        }).send(res);
    }

    seoAudit = async (req, res, next) => {
        new SuccessResponse({
            message: 'AI blog SEO audit success',
            metadata: await AIBlogService.seoAudit({
                blogId: req.params.blogId,
                payload: req.body,
                reviewerId: req.user?.userId
            })
        }).send(res);
    }

    applySeoFixes = async (req, res, next) => {
        new SuccessResponse({
            message: 'Apply AI blog SEO fixes success',
            metadata: await AIBlogService.applySeoFixes({
                blogId: req.params.blogId,
                payload: req.body,
                reviewerId: req.user?.userId
            })
        }).send(res);
    }

    fullSeoRefresh = async (req, res, next) => {
        new SuccessResponse({
            message: 'AI blog full SEO refresh success',
            metadata: await AIBlogService.fullSeoRefresh({
                blogId: req.params.blogId,
                payload: req.body,
                reviewerId: req.user?.userId
            })
        }).send(res);
    }

    generateDraft = async (req, res, next) => {
        new SuccessResponse({
            message: 'Generate AI blog draft success',
            metadata: await AIBlogService.generateDraft({
                payload: req.body,
                reviewerId: req.user?.userId
            })
        }).send(res);
    }

    generateSeo = async (req, res, next) => {
        new SuccessResponse({
            message: 'Generate AI blog SEO success',
            metadata: await AIBlogService.generateSeo({
                payload: req.body,
                reviewerId: req.user?.userId
            })
        }).send(res);
    }

    publishWithReview = async (req, res, next) => {
        new SuccessResponse({
            message: 'Publish blog with review success',
            metadata: await AIBlogService.publishWithReview({
                payload: req.body,
                reviewerId: req.user?.userId
            })
        }).send(res);
    }
}

module.exports = new AIBlogController();
