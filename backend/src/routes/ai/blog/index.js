'use strict'

const express = require('express');
const asyncHandler = require('../../../helpers/asyncHandler');
const aiBlogController = require('../../../controllers/aiBlog.controller');
const { uploadLarge } = require('../../../middleware/upload');
const { uploadSingleImage, uploadBase64Image } = require('../../../middleware/firebaseUpload');
const { authenticationAdmin } = require('../../../auth/authUtils');
const { permission, PERMISSIONS } = require('../../../auth/checkAuth');

const router = express.Router();
const requireAdmin = [permission(PERMISSIONS.ADMIN_SYSTEM), authenticationAdmin];
const BLOG_IMAGE_MAX_SIZE = Number(process.env.UPLOAD_BLOG_MAX_SIZE || 5 * 1024 * 1024);
const BLOG_IMAGE_VALIDATION = {
    maxSizeBytes: BLOG_IMAGE_MAX_SIZE,
    requireDimensions: false
};

router.post(
    '/create-from-brief',
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
    asyncHandler(aiBlogController.createFromBrief)
);
router.post(
    '/create-and-publish-with-review',
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
    asyncHandler(aiBlogController.createAndPublishWithReview)
);
router.post(
    '/regenerate-and-update/:blogId',
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
    asyncHandler(aiBlogController.regenerateAndUpdate)
);
router.post('/seo-audit/:blogId', requireAdmin, asyncHandler(aiBlogController.seoAudit));
router.post(
    '/apply-seo-fixes/:blogId',
    requireAdmin,
    asyncHandler(aiBlogController.applySeoFixes)
);
router.post(
    '/full-seo-refresh/:blogId',
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
    asyncHandler(aiBlogController.fullSeoRefresh)
);
router.post('/generate-draft', requireAdmin, asyncHandler(aiBlogController.generateDraft));
router.post('/generate-seo', requireAdmin, asyncHandler(aiBlogController.generateSeo));
router.post(
    '/publish-with-review',
    requireAdmin,
    asyncHandler(aiBlogController.publishWithReview)
);

module.exports = router;
