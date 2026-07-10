'use strict'

const BlogService = require('../services/blog.service');
const BlogCommentService = require('../services/blogComment.service');
const AgenticImageReviewService = require('../services/agenticImageReview.service');
const { SuccessResponse } = require('../core/success.response');
const { commitPendingStorageUploads } = require('../services/pendingStorageUpload.service');

const commitContentUploads = async (req, html) => {
    try {
        await commitPendingStorageUploads({
            ownerId: req.user?.userId,
            sessionId: req.body?.upload_session_id,
            html
        });
    } catch (error) {
        console.error('Failed to commit blog content uploads', {
            error: error?.message || 'commit-pending-upload-failed'
        });
    }
};

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const resolveSendNewsletter = (req) =>
    parseBoolean(
        req?.body?.send_newsletter ?? req?.body?.sendNewsletter ?? req?.body?.sendEmail,
        false
    );

const summarizeImageReplacement = (req) => {
    let target = req.body?.target;
    let selection = req.body?.selection;
    try {
        if (typeof target === 'string') target = JSON.parse(target);
    } catch {
        target = {};
    }
    try {
        if (typeof selection === 'string') selection = JSON.parse(selection);
    } catch {
        selection = {};
    }
    return {
        blogId: req.params?.blogId,
        targetType: target?.type || target?.targetType || 'unknown',
        targetIdentifier:
            target?.imageId ||
            (Number.isInteger(Number(target?.imageIndex)) ? `index:${target.imageIndex}` : 'missing'),
        replacementSourceType: selection?.kind || selection?.sourceType || 'unknown'
    };
};

class BlogController {
    listPublicBlogs = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get public blogs success',
            metadata: await BlogService.listBlogsPublic(req.query)
        }).send(res);
    }

    getPublicBlogBySlug = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get blog detail success',
            metadata: await BlogService.getBlogBySlug({ slug: req.params.slug })
        }).send(res);
    }

    listPublicComments = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get blog comments success',
            metadata: await BlogCommentService.listPublicComments({ slug: req.params.slug })
        }).send(res);
    }

    createPublicComment = async (req, res, next) => {
        new SuccessResponse({
            message: 'Create comment success',
            metadata: await BlogCommentService.createComment({
                slug: req.params.slug,
                payload: req.body,
                meta: {
                    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
                    userAgent: req.headers['user-agent']
                }
            })
        }).send(res);
    }

    listBlogsForAdmin = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get blogs for admin success',
            metadata: await BlogService.listBlogsForAdmin(req.query)
        }).send(res);
    }

    getBlogForAdmin = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get blog for admin success',
            metadata: await BlogService.getBlogForAdmin({ blogId: req.params.blogId })
        }).send(res);
    }

    getImagePromptSuggestions = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get image prompt suggestions success',
            metadata: await AgenticImageReviewService.getPromptSuggestions({
                blogId: req.params.blogId,
                target: req.query.target
            })
        }).send(res);
    }

    searchPexelsImages = async (req, res, next) => {
        new SuccessResponse({
            message: 'Search Pexels images success',
            metadata: await AgenticImageReviewService.searchPexels({
                blogId: req.params.blogId,
                target: req.query.target,
                query: req.query.query,
                page: req.query.page,
                perPage: req.query.perPage
            })
        }).send(res);
    }

    generateImagePreview = async (req, res, next) => {
        new SuccessResponse({
            message: 'Generate image preview success',
            metadata: await AgenticImageReviewService.generatePreview({
                blogId: req.params.blogId,
                target: req.body?.target,
                prompt: req.body?.prompt
            })
        }).send(res);
    }

    reviewAgenticImage = async (req, res, next) => {
        new SuccessResponse({
            message: 'Review agentic image success',
            metadata: await AgenticImageReviewService.reviewImage({
                blogId: req.params.blogId,
                target: req.body?.target,
                decision: req.body?.decision
            })
        }).send(res);
    }

    replaceAgenticImage = async (req, res, next) => {
        try {
            new SuccessResponse({
                message: 'Replace agentic image success',
                metadata: await AgenticImageReviewService.replaceImage({
                    blogId: req.params.blogId,
                    target: req.body?.target,
                    selection: req.body?.selection,
                    file: req.file
                })
            }).send(res);
        } catch (error) {
            console.error('Agentic image replacement failed', {
                ...summarizeImageReplacement(req),
                status: error?.status || 500,
                error: error?.message || 'image_replacement_failed'
            });
            throw error;
        }
    }

    listAdminComments = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get blog comments for admin success',
            metadata: await BlogCommentService.listAdminComments(req.query)
        }).send(res);
    }

    updateCommentStatus = async (req, res, next) => {
        new SuccessResponse({
            message: 'Update comment status success',
            metadata: await BlogCommentService.updateCommentStatus({
                commentId: req.params.commentId,
                status: String(req.body?.status || '').trim(),
                reviewerId: req.user?.userId
            })
        }).send(res);
    }

    deleteComment = async (req, res, next) => {
        new SuccessResponse({
            message: 'Delete comment success',
            metadata: await BlogCommentService.deleteComment({
                commentId: req.params.commentId
            })
        }).send(res);
    }

    createBlog = async (req, res, next) => {
        const created = await BlogService.createBlog({
            payload: req.body,
            shopId: req.user?.userId,
            sendNewsletter: resolveSendNewsletter(req)
        });
        await commitContentUploads(req, created?.content || req.body?.blog_content);
        new SuccessResponse({
            message: 'Create blog success',
            metadata: created
        }).send(res);
    }

    updateBlog = async (req, res, next) => {
        const updated = await BlogService.updateBlog({
            blogId: req.params.blogId,
            payload: req.body,
            sendNewsletter: resolveSendNewsletter(req)
        });
        await commitContentUploads(req, updated?.content || req.body?.blog_content);
        new SuccessResponse({
            message: 'Update blog success',
            metadata: updated
        }).send(res);
    }

    deleteBlog = async (req, res, next) => {
        new SuccessResponse({
            message: 'Delete blog success',
            metadata: await BlogService.deleteBlog({
                blogId: req.params.blogId
            })
        }).send(res);
    }

    publishBlog = async (req, res, next) => {
        new SuccessResponse({
            message: 'Publish blog success',
            metadata: await BlogService.publishBlog({
                blogId: req.params.blogId,
                sendNewsletter: resolveSendNewsletter(req)
            })
        }).send(res);
    }

    unPublishBlog = async (req, res, next) => {
        new SuccessResponse({
            message: 'Unpublish blog success',
            metadata: await BlogService.unPublishBlog({
                blogId: req.params.blogId
            })
        }).send(res);
    }
}

module.exports = new BlogController();
