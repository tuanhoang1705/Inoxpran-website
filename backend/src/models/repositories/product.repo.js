'use strict'

const { product  } = require('../product.model');
const { Types } = require('mongoose');
const { getSelectData, getUnSelectData, convertToObjectIdMongodb } = require('../../utils/index');

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findProductByNormalizedName = async ({ name, excludeId } = {}) => {
    const normalizedName = String(name || '').trim().replace(/\s+/g, ' ');
    if (!normalizedName) return null;
    const normalizedNameKey = normalizedName.toLocaleLowerCase('vi');

    const exactNamePattern = normalizedName
        .split(' ')
        .map((part) => escapeRegex(part))
        .join('\\s+');
    const exclusionFilter = {};
    const excludedObjectId = convertToObjectIdMongodb(excludeId);
    if (excludedObjectId) {
        exclusionFilter._id = { $ne: excludedObjectId };
    }

    const normalizedMatch = await product.findOne({
        product_name_normalized: normalizedNameKey,
        ...exclusionFilter
    })
        .select('_id product_name product_slug isDraft isPublished')
        .lean()
        .exec();
    if (normalizedMatch) return normalizedMatch;

    return await product.findOne({
        product_name: { $regex: `^${exactNamePattern}$`, $options: 'i' },
        ...exclusionFilter
    })
        .select('_id product_name product_slug isDraft isPublished')
        .lean()
        .exec();
};

const buildSearchTokens = (value) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) return [];

    const compact = normalized.replace(/[\s._/-]+/g, '');
    const numeric = normalized.replace(/\D+/g, '');

    return Array.from(new Set([normalized, compact, numeric]))
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
};

const buildRegexSearchFilter = (searchText) => {
    const tokens = buildSearchTokens(searchText);
    if (!tokens.length) return null;

    const clauses = tokens.flatMap((token) => {
        const escapedToken = escapeRegex(token);
        return [
            { product_name: { $regex: escapedToken, $options: 'i' } },
            { product_slug: { $regex: escapedToken, $options: 'i' } }
        ];
    });

    return { $or: clauses };
};

const findAllDraftsForShop = async ({ query, limit, skip }) => { 
    return await queryProduct({ query, limit, skip });
    
};

const findAllPublishForShop = async ({ query, limit, skip }) => {
    return await queryProduct({ query, limit, skip });
};

const searchProductsByUser = async ({ keySearch }) => { 
    const searchText = typeof keySearch === 'string' ? keySearch.trim() : '';
    if (!searchText) return [];
    const textResults = await product.find(
        {
            isPublished: true,
            $text: { $search: searchText }
        },
        { score: { $meta: 'textScore' } }
    )
        .sort({ score: { $meta: 'textScore' } })
        .lean();
    if (textResults.length) return textResults;

    const regexFilter = buildRegexSearchFilter(searchText);
    if (!regexFilter) return [];

    return await product.find({
        isPublished: true,
        ...regexFilter
    })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();
}

const adjustProductQuantity = async ({ productId, delta }) => {
    const productObjectId = convertToObjectIdMongodb(productId);
    const normalizedDelta = Number(delta);
    if (!productObjectId || !Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
        return null;
    }
    return await product.updateOne(
        { _id: productObjectId },
        { $inc: { product_quantity: normalizedDelta } }
    );
};

const publishProductByShop = async ({ product_shop, product_id }) => {
  const shopObjectId = convertToObjectIdMongodb(product_shop);
  const productObjectId = convertToObjectIdMongodb(product_id);
  if (!shopObjectId || !productObjectId) return null;

  const foundShop = await product.findOne({
    product_shop: shopObjectId,
    _id: productObjectId
  });
    
    if (!foundShop) return null;

    foundShop.isDraft = false;
    foundShop.isPublished = true;
    const { modifiedCount } = await foundShop.updateOne(foundShop);
    
    return modifiedCount;
};

const unPublishProductByShop = async ({ product_shop, product_id }) => { 
      const shopObjectId = convertToObjectIdMongodb(product_shop);
      const productObjectId = convertToObjectIdMongodb(product_id);
      if (!shopObjectId || !productObjectId) return null;

      const foundShop = await product.findOne({
    product_shop: shopObjectId,
    _id: productObjectId
  });
    
    if (!foundShop) return null;

    foundShop.isDraft = true;
    foundShop.isPublished = false;
    const { modifiedCount } = await foundShop.updateOne(foundShop);
    
    return modifiedCount;
}

const resolveSort = (sort) => {
    if (!sort) return { _id: -1 };
    if (typeof sort === 'object') return sort;
    switch (sort) {
        case 'ctime':
            return { _id: -1 };
        case 'created':
            return { createdAt: -1 };
        case 'updated':
            return { updatedAt: -1 };
        case 'price_asc':
            return { product_price: 1 };
        case 'price_desc':
            return { product_price: -1 };
        case 'name_asc':
            return { product_name: 1 };
        case 'name_desc':
            return { product_name: -1 };
        default:
            return { _id: 1 };
    }
};

const findAllProducts = async ({ limit, sort, page, filter, select} ) => {
    const skip = (page - 1) * limit;
    const sortBy = resolveSort(sort);
    const products = await product.find(filter)
        .sort(sortBy)
        .skip(skip)
        .limit(limit)
        .select(getSelectData(select))
        .lean()
        .exec();
    return products;
}

const findAllProductsForAdmin = async ({ limit, sort, page, filter, select }) => {
    const skip = (page - 1) * limit;
    const sortBy = resolveSort(sort || 'created');
    const products = await product.find(filter || {})
        .populate('product_shop', 'name email -_id')
        .sort(sortBy)
        .skip(skip)
        .limit(limit)
        .select(getSelectData(select))
        .lean()
        .exec();
    return products;
};

const findBestSellingProducts = async ({ limit = 10, select } = {}) => {
    const query = {
        isPublished: true,
        product_best_selling_rank: { $ne: null }
    };
    return await product.find(query)
        .sort({ product_best_selling_rank: 1, updatedAt: -1 })
        .limit(limit)
        .select(getSelectData(select))
        .lean()
        .exec();
};

const updateBestSellingOrder = async ({ orderedIds = [] } = {}) => {
    const ops = orderedIds.map((id, index) => ({
        updateOne: {
            filter: { _id: id },
            update: { $set: { product_best_selling_rank: index + 1 } }
        }
    }));

    if (ops.length) {
        await product.bulkWrite(ops);
    }

    await product.updateMany(
        { _id: { $nin: orderedIds } },
        { $set: { product_best_selling_rank: null } }
    );
    return ops.length;
};

const normalizeLookupValue = (value) => {
    if (value === undefined || value === null) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    try {
        return decodeURIComponent(raw).trim().replace(/^\/+|\/+$/g, '');
    } catch {
        return raw.replace(/^\/+|\/+$/g, '');
    }
};

const buildSlugCandidates = (value) => {
    const normalized = normalizeLookupValue(value);
    if (!normalized) return [];
    const lower = normalized.toLowerCase();
    return Array.from(new Set([normalized, lower])).filter(Boolean);
};

const findProduct = async ({ product_id, unSelect, includeStatus = false }) => {
    const lookupValue = normalizeLookupValue(product_id);
    if (!lookupValue) return null;

    const executeQuery = ({ filter, sort } = {}) => {
        let query = product.findOne(filter).select(getUnSelectData(unSelect));
        if (includeStatus) {
            query = query.select('+isPublished +isDraft');
        }
        if (sort) {
            query = query.sort(sort);
        }
        return query.lean().exec();
    };

    const objectId = convertToObjectIdMongodb(lookupValue);
    if (objectId) {
        const foundById = await executeQuery({
            filter: {
                _id: objectId,
                ...(!includeStatus ? { isPublished: true, isDraft: false } : {})
            }
        });
        if (foundById) return foundById;
    }

    const slugCandidates = buildSlugCandidates(lookupValue);
    if (!slugCandidates.length) return null;
    return await executeQuery({
        filter: {
            product_slug: { $in: slugCandidates },
            ...(!includeStatus ? { isPublished: true, isDraft: false } : {})
        },
        sort: { isPublished: -1, updatedAt: -1, createdAt: -1 }
    });
}

const updateProductById = async({
    productId,
    bodyUpdate,
    model,
    isNew = true
}) => {
    return await model.findByIdAndUpdate(productId, bodyUpdate, {
        new: isNew,
    });
}

const queryProduct = async ({ query, limit, skip }) => {
    return await product.find(query).
        populate('product_shop', 'name email -_id')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec();
}

const getProductById = async (productId) => {
    return await product.findOne({ _id: convertToObjectIdMongodb(productId) }).lean();
}

const checkProductByServer = async (products) => {
    return await Promise.all(products.map(async product => {
        const foundProduct = await getProductById(product.productId);
        if (foundProduct) {
            return {
                price: foundProduct.product_price,
                quantity: product.quantity,
                productId: product.productId
            }
        }
    }))
}

module.exports = {
    findAllDraftsForShop,
    publishProductByShop,
    findAllPublishForShop,
    unPublishProductByShop,
    searchProductsByUser,
    findAllProducts,
    findAllProductsForAdmin,
    findProduct,
    updateProductById,
    getProductById,
    checkProductByServer,
    findBestSellingProducts,
    updateBestSellingOrder,
    adjustProductQuantity,
    findProductByNormalizedName
}
