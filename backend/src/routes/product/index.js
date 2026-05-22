'use strict'

const express = require('express');
const productController = require('../../controllers/product.controller');
const router = express.Router();
const asyncHandler = require('../../helpers/asyncHandler');
const { upload, uploadLarge } = require('../../middleware/upload');
const {
    uploadSingleImage,
    uploadBase64Image,
    uploadMultipleImages,
    uploadBase64Images
} = require('../../middleware/firebaseUpload');
const { authenticationAdmin, authenticationUser } = require('../../auth/authUtils');
const { permission, PERMISSIONS } = require('../../auth/checkAuth');

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
    upload.fields([
    { name: 'product_thumb', maxCount: 1 },
    { name: 'product_gallery', maxCount: 7 }
  ]),
    uploadSingleImage({ field: 'product_thumb', folder: 'products', optimization: { profile: 'productThumb' } }),
    uploadBase64Image({ field: 'product_thumb', folder: 'products', optimization: { profile: 'productThumb' } }),
    uploadMultipleImages({ field: 'product_gallery', folder: 'products', optimization: { profile: 'productGallery' } }),
    uploadBase64Images({
        field: 'product_gallery_cropped',
        nameField: 'product_gallery_cropped_names',
        stateField: 'product_gallery_cropped_states',
        outputField: 'product_gallery',
        folder: 'products',
        optimization: { profile: 'productGallery' }
    }),
    asyncHandler(productController.createProduct)
);
router.patch(
    '/:productId',
     upload.fields([
    { name: 'product_thumb', maxCount: 1 },
    { name: 'product_gallery', maxCount: 7 }
  ]),
    uploadSingleImage({ field: 'product_thumb', folder: 'products', optimization: { profile: 'productThumb' } }),
    uploadBase64Image({ field: 'product_thumb', folder: 'products', optimization: { profile: 'productThumb' } }),
    uploadMultipleImages({ field: 'product_gallery', folder: 'products', optimization: { profile: 'productGallery' } }),
    uploadBase64Images({
        field: 'product_gallery_cropped',
        nameField: 'product_gallery_cropped_names',
        stateField: 'product_gallery_cropped_states',
        outputField: 'product_gallery',
        folder: 'products',
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
module.exports = router;
