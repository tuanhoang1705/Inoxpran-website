'use strict'

const BlogService = require('../services/blog.service');
const BlogCommentService = require('../services/blogComment.service');
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
