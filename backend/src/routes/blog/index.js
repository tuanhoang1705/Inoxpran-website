'use strict'

const express = require('express');
const blogController = require('../../controllers/blog.controller');
const asyncHandler = require('../../helpers/asyncHandler');
const { uploadLarge } = require('../../middleware/upload');
const {
    cleanupUploadedArtifacts,
    uploadSingleImage,
    uploadBase64Image
} = require('../../middleware/firebaseUpload');
const { authenticationAdmin } = require('../../auth/authUtils');
const { permission, PERMISSIONS } = require('../../auth/checkAuth');

const router = express.Router();

const BLOG_IMAGE_MAX_SIZE = Number(process.env.UPLOAD_BLOG_MAX_SIZE || 5 * 1024 * 1024);
const BLOG_IMAGE_VALIDATION = {
    maxSizeBytes: BLOG_IMAGE_MAX_SIZE,
    requireDimensions: false
};
const requireAdmin = [permission(PERMISSIONS.ADMIN_SYSTEM), authenticationAdmin];

router.get('', asyncHandler(blogController.listPublicBlogs));
router.get('/:slug', asyncHandler(blogController.getPublicBlogBySlug));

router.get('/admin/all', requireAdmin, asyncHandler(blogController.listBlogsForAdmin));
router.get('/admin/comments', requireAdmin, asyncHandler(blogController.listAdminComments));
router.patch(
    '/admin/comments/:commentId',
    requireAdmin,
    asyncHandler(blogController.updateCommentStatus)
);
router.delete(
    '/admin/comments/:commentId',
    requireAdmin,
    asyncHandler(blogController.deleteComment)
);
router.get('/admin/:blogId', requireAdmin, asyncHandler(blogController.getBlogForAdmin));

router.get('/:slug/comments', asyncHandler(blogController.listPublicComments));
router.post('/:slug/comments', asyncHandler(blogController.createPublicComment));

router.post(
    '',
    requireAdmin,
    uploadLarge.single('blog_image'),
    uploadSingleImage({
        field: 'blog_image',
        folder: 'blogs',
        validation: BLOG_IMAGE_VALIDATION,
        optimization: { profile: 'blog' }
    }),
    uploadBase64Image({
        field: 'blog_image',
        folder: 'blogs',
        validation: BLOG_IMAGE_VALIDATION,
        optimization: { profile: 'blog' }
    }),
    asyncHandler(blogController.createBlog)
);

router.patch(
    '/:blogId',
    requireAdmin,
    uploadLarge.single('blog_image'),
    uploadSingleImage({
        field: 'blog_image',
        folder: 'blogs',
        validation: BLOG_IMAGE_VALIDATION,
        optimization: { profile: 'blog' }
    }),
    uploadBase64Image({
        field: 'blog_image',
        folder: 'blogs',
        validation: BLOG_IMAGE_VALIDATION,
        optimization: { profile: 'blog' }
    }),
    asyncHandler(blogController.updateBlog)
);

router.delete('/:blogId', requireAdmin, asyncHandler(blogController.deleteBlog));
router.post('/publish/:blogId', requireAdmin, asyncHandler(blogController.publishBlog));
router.post('/unpublish/:blogId', requireAdmin, asyncHandler(blogController.unPublishBlog));

router.use(async (error, req, res, next) => {
    await cleanupUploadedArtifacts(req);
    next(error);
});

module.exports = router;
