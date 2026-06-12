'use strict'

const express = require('express');
const productController = require('../../controllers/product.controller');
const router = express.Router();
const asyncHandler = require('../../helpers/asyncHandler');
const { uploadLarge, uploadProduct } = require('../../middleware/upload');
const {
    uploadSingleImage,
    uploadBase64Image,
    uploadMultipleImages,
    uploadBase64Images,
    cleanupUploadedArtifacts
} = require('../../middleware/firebaseUpload');
const { authenticationAdmin, authenticationUser } = require('../../auth/authUtils');
const { permission, PERMISSIONS } = require('../../auth/checkAuth');

const PRODUCT_IMAGE_MAX_SIZE = Number(process.env.UPLOAD_PRODUCT_MAX_SIZE || 5 * 1024 * 1024);
const PRODUCT_IMAGE_MAX_WIDTH = Number(process.env.PRODUCT_IMAGE_MAX_WIDTH || 1920);
const PRODUCT_IMAGE_MAX_HEIGHT = Number(process.env.PRODUCT_IMAGE_MAX_HEIGHT || 1920);
const productImageValidation = {
    maxSizeBytes: PRODUCT_IMAGE_MAX_SIZE,
    requireDimensions: false,
    maxWidth: PRODUCT_IMAGE_MAX_WIDTH,
    maxHeight: PRODUCT_IMAGE_MAX_HEIGHT
};

router.get('/search/:keySearch', asyncHandler(productController.getListSearchProduct));
router.get('/best-selling', asyncHandler(productController.getBestSellingProducts));
router.get('', asyncHandler(productController.findAllProducts));
router.get('/:productId/review-meta', authenticationUser, asyncHandler(productController.getReviewMeta));
router.post(
    '/:productId/reviews',
    authenticationUser,
    uploadLarge.fields([{ name: 'review_images', maxCount: 4 }]),
    uploadMultipleImages({
        field: 'review_images',
        folder: 'product-reviews',
        optimization: { profile: 'productGallery' }
    }),
    asyncHandler(productController.submitReview)
);
router.get('/:productId', asyncHandler(productController.findProduct));
// authentication (admin system only)

router.use(permission(PERMISSIONS.ADMIN_SYSTEM));
router.use(authenticationAdmin);
////////////////////////////////////

router.get('/admin/all', asyncHandler(productController.getAllProductsForAdmin));
router.get('/admin/reviews', asyncHandler(productController.listAdminReviews));
router.get('/admin/reviews/targets', asyncHandler(productController.listAdminReviewTargets));
router.post('/admin/reviews', asyncHandler(productController.createAdminReview));
router.patch('/admin/reviews/:reviewId/status', asyncHandler(productController.updateAdminReviewStatus));
router.delete('/admin/reviews/:reviewId', asyncHandler(productController.deleteAdminReview));
router.post('/best-selling/order', asyncHandler(productController.updateBestSellingOrder));
router.get(`/admin/:productId`, asyncHandler(productController.findProductAdmin));

router.post(
    '',
    uploadProduct.fields([
    { name: 'product_thumb', maxCount: 1 },
    { name: 'product_gallery', maxCount: 7 }
  ]),
    uploadSingleImage({ field: 'product_thumb', folder: 'products', validation: productImageValidation, optimization: { profile: 'productThumb' } }),
    uploadBase64Image({ field: 'product_thumb', folder: 'products', validation: productImageValidation, optimization: { profile: 'productThumb' } }),
    uploadMultipleImages({ field: 'product_gallery', folder: 'products', validation: productImageValidation, optimization: { profile: 'productGallery' } }),
    uploadBase64Images({
        field: 'product_gallery_cropped',
        nameField: 'product_gallery_cropped_names',
        stateField: 'product_gallery_cropped_states',
        outputField: 'product_gallery',
        folder: 'products',
        validation: productImageValidation,
        optimization: { profile: 'productGallery' }
    }),
    asyncHandler(productController.createProduct)
);
router.patch(
    '/:productId',
     uploadProduct.fields([
    { name: 'product_thumb', maxCount: 1 },
    { name: 'product_gallery', maxCount: 7 }
  ]),
    uploadSingleImage({ field: 'product_thumb', folder: 'products', validation: productImageValidation, optimization: { profile: 'productThumb' } }),
    uploadBase64Image({ field: 'product_thumb', folder: 'products', validation: productImageValidation, optimization: { profile: 'productThumb' } }),
    uploadMultipleImages({ field: 'product_gallery', folder: 'products', validation: productImageValidation, optimization: { profile: 'productGallery' } }),
    uploadBase64Images({
        field: 'product_gallery_cropped',
        nameField: 'product_gallery_cropped_names',
        stateField: 'product_gallery_cropped_states',
        outputField: 'product_gallery',
        folder: 'products',
        validation: productImageValidation,
        optimization: { profile: 'productGallery' }
    }),
    asyncHandler(productController.updateProduct)
);
router.delete('/:productId', asyncHandler(productController.deleteProduct));
router.post('/publish/:id', asyncHandler(productController.publishProductByShop));
router.post('/unPublish/:id', asyncHandler(productController.unPublishProductByShop));

// query

router.get('/drafts/all', asyncHandler(productController.getAllDraftsForShop));
router.get('/published/all', asyncHandler(productController.getAllPublishForShop));

router.use(async (error, req, res, next) => {
    await cleanupUploadedArtifacts(req);
    next(error);
});
module.exports = router;
