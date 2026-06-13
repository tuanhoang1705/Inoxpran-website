'use strict'
 
const ProductService = require('../services/product.service');
const { SuccessResponse } = require('../core/success.response');
const { commitPendingStorageUploads } = require('../services/pendingStorageUpload.service');

const collectProductArtifacts = (productItem = {}) => [
    ...(productItem?.product_thumb
        ? [{
              url: productItem.product_thumb,
              path: productItem.product_thumb_path,
              variants: productItem.product_thumb_variants
          }]
        : []),
    ...(Array.isArray(productItem?.product_gallery) ? productItem.product_gallery : [])
];

const commitProductUploads = (req, productItem = {}) => {
    void commitPendingStorageUploads({
            ownerId: req.user?.userId,
            sessionId: req.body?.upload_session_id,
            html: productItem?.product_description || req.body?.product_description,
            artifacts: collectProductArtifacts(productItem)
        }).catch((error) => {
        console.error('Failed to commit product description uploads', {
            error: error?.message || 'commit-pending-upload-failed'
        });
    });
};

class ProductController {
    createProduct = async (req, res, next) => {
        const created = await ProductService.createProduct(req.body.product_type, {
            ...req.body,
            product_shop: req.user.userId
        });
        commitProductUploads(req, created);
        new SuccessResponse({
            message: 'Create new product success',
            metadata: created
        }).send(res);
    }
    createDraft = async (req, res, next) => {
        const created = await ProductService.createDraft(req.body.product_type, {
            ...req.body,
            product_shop: req.user.userId
        });
        commitProductUploads(req, created);
        new SuccessResponse({
            message: 'Create product draft success',
            metadata: created
        }).send(res);
    }
    // update product
    updateProduct = async (req, res, next) => {
         const updated = await ProductService.updateProduct(req.body.product_type, req.params.productId, {
             ...req.body,
             product_shop: req.user.userId,
        });
         commitProductUploads(req, updated);
         new SuccessResponse({
            message: 'Update product success',
             metadata: updated
        }).send(res);
    };
    updateProductMedia = async (req, res, next) => {
        const updated = await ProductService.updateProductMedia({
            productId: req.params.productId,
            payload: req.body
        });
        commitProductUploads(req, updated);
        new SuccessResponse({
            message: 'Update product media success',
            metadata: updated
        }).send(res);
    };
    deleteProduct = async (req, res, next) => {
        new SuccessResponse({
            message: 'Delete product success',
            metadata: await ProductService.deleteProduct({
                product_id: req.params.productId,
                product_shop: req.user.userId
            })
        }).send(res);
    };

    publishProductByShop = async (req, res, next) => { 
        console.log('c>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>',  req.params.id);
          new SuccessResponse({
            message: 'publish Product By Shop success',
            metadata: await ProductService.publishProductByShop({
                product_id: req.params.id,
                product_shop: req.user.userId
            })
        }).send(res);
    }
    unPublishProductByShop = async (req, res, next) => { 
        console.log('c>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>',  req.params.id);
          new SuccessResponse({
            message: 'unpublish Product By Shop success',
            metadata: await ProductService.unPublishProductByShop({
                product_id: req.params.id,
                product_shop: req.user.userId
            })
        }).send(res);
    }

    // QUERY //
    /**
     * @desc Get all drafts for shop
     * @param {String} product_shop
     * @param {Number} limit
     * @param {Number} skip
     * @return {JSON}
     */
    getAllDraftsForShop = async (req, res, next) => {
        const includeAll = req.query.scope === 'all';
        const limit = Number(req.query.limit) || 50;
        const page = Number(req.query.page) || 1;
        const skip = Math.max(page - 1, 0) * Math.max(limit, 1);
        new SuccessResponse({
            message: 'Get list drafts for shop success',
            metadata: await ProductService.findAllDraftsForShop({
                product_shop: includeAll ? undefined : req.user.userId,
                limit,
                skip
            })
        }).send(res);
    }



    getAllPublishForShop = async (req, res, next) => {
        const includeAll = req.query.scope === 'all';
        const limit = Number(req.query.limit) || 50;
        const page = Number(req.query.page) || 1;
        const skip = Math.max(page - 1, 0) * Math.max(limit, 1);
        new SuccessResponse({
            message: 'Get list publish for shop success',
            metadata: await ProductService.findAllPublishForShop({
                product_shop: includeAll ? undefined : req.user.userId,
                limit,
                skip
            })
        }).send(res);
    }

    getAllProductsForAdmin = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get list products for admin success',
            metadata: await ProductService.findAllProductsForAdmin(req.query)
        }).send(res);
    }

    findDuplicateProductName = async (req, res, next) => {
        const duplicate = await ProductService.findDuplicateProductName({
            name: req.query.name,
            excludeId: req.query.excludeId
        });
        new SuccessResponse({
            message: 'Check product name success',
            metadata: {
                exists: Boolean(duplicate),
                product: duplicate || null
            }
        }).send(res);
    }

    getBestSellingProducts = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get best selling products success',
            metadata: await ProductService.getBestSellingProducts(req.query)
        }).send(res);
    }

    updateBestSellingOrder = async (req, res, next) => {
        const payload = req.body || {};
        const productIds = Array.isArray(payload)
            ? payload
            : payload.productIds || payload.product_ids || payload.ids || [];
        new SuccessResponse({
            message: 'Update best selling order success',
            metadata: await ProductService.updateBestSellingOrder({ productIds })
        }).send(res);
    }

    getListSearchProduct = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get list search success',
            metadata: await ProductService.searchProducts({
                keySearch: req.params.keySearch
            })
        }).send(res);
    }
    findAllProducts = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get list products success',
            metadata: await ProductService.findAllProducts(req.query)
        }).send(res);
    }
    findProduct = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get a product for shop success',
            metadata: await ProductService.findProduct({
                product_id: req.params.productId
            })
        }).send(res);
    }
    getReviewMeta = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get product review meta success',
            metadata: await ProductService.getProductReviewMeta({
                product_id: req.params.productId,
                userId: req.user?.userId
            })
        }).send(res);
    }
    submitReview = async (req, res, next) => {
        new SuccessResponse({
            message: 'Submit product review success',
            metadata: await ProductService.submitProductReview({
                product_id: req.params.productId,
                userId: req.user?.userId,
                payload: req.body
            })
        }).send(res);
    }
    listAdminReviews = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get admin product reviews success',
            metadata: await ProductService.listAdminProductReviews(req.query)
        }).send(res);
    }
    listAdminReviewTargets = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get admin review targets success',
            metadata: await ProductService.listAdminReviewTargets(req.query)
        }).send(res);
    }
    createAdminReview = async (req, res, next) => {
        new SuccessResponse({
            message: 'Create product review success',
            metadata: await ProductService.createAdminProductReview({
                product_id: req.body?.productId ?? req.body?.productLookup ?? req.body?.product_id,
                reviewerId: req.user?.userId,
                payload: req.body
            })
        }).send(res);
    }
    updateAdminReviewStatus = async (req, res, next) => {
        new SuccessResponse({
            message: 'Update product review status success',
            metadata: await ProductService.updateAdminProductReviewStatus({
                reviewId: req.params.reviewId,
                status: req.body?.status,
                reviewerId: req.user?.userId
            })
        }).send(res);
    }
    deleteAdminReview = async (req, res, next) => {
        new SuccessResponse({
            message: 'Delete product review success',
            metadata: await ProductService.deleteAdminProductReview({
                reviewId: req.params.reviewId
            })
        }).send(res);
    }
    findProductAdmin = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get a product for shop success',
            metadata: await ProductService.findProduct({
                product_id: req.params.productId,
                includeStatus: true
            })
        }).send(res);
    }
    // END QUERY
}

module.exports = new ProductController();
