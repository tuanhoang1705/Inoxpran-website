'use strict'

const { BadRequestError, NotFoundError } = require('../core/error.response');
const discount = require('../models/discount.model');
const discountDeletion = require('../models/discountDeletion.model');
const discountUsage = require('../models/discountUsage.model');
const { convertToObjectIdMongodb, removeUndefinedObject } = require('../utils');
const { findAllDiscountCodesUnSelect, findAllDiscountCodesSelect, checkDiscountExists } = require('../models/repositories/discount.repo');
const { findAllDraftsForShop,
    publishProductByShop,
    findAllPublishForShop,
    unPublishProductByShop,
    searchProductsByUser,
    findAllProducts,
    findProduct,
    updateProductById
} = require('../models/repositories/product.repo');
const { product } = require('../models/product.model');
/*
    Discount Service
    1 - Generator Discount code [[shop/ admin]]
    2 - Get discount amount [User]
    3 - Get all discount codes [Use/Shop]
    4 - Verify discount code [Use]
    5 - Delete discount code [Admin/Shop]
    6 - Cancel discount code [user]
*/

class DisscountService { 
    static async createDiscountCode(payload) {
        const code = payload.code ?? payload.discount_code;
        const startDateInput = payload.start_date ?? payload.discount_startDate ?? payload.startDate;
        const endDateInput = payload.end_date ?? payload.discount_endDate ?? payload.endDate;
        const isActive = payload.is_active ?? payload.discount_is_active;
        const shopId = payload.shopId ?? payload.discount_shopId;
        const minOrderValue = payload.min_order_value ?? payload.discount_min_order_value;
        const productIds = payload.product_ids ?? payload.discount_product_ids;
        const appliesTo = payload.applies_to ?? payload.discount_applies_to;
        const nameDiscount = payload.name_discount ?? payload.discount_name;
        const description = payload.description ?? payload.discount_description;
        const type = payload.type ?? payload.discount_type;
        const value = payload.value ?? payload.discount_value;
        const maxValue = payload.max_value ?? payload.discount_max_value;
        const maxUses = payload.max_uses ?? payload.discount_max_uses;
        const usesCount = payload.uses_count ?? payload.discount_uses_count;
        const usersUsed = payload.users_used ?? payload.discount_uses_used;
        const maxUsesPerUser = payload.max_uses_per_user ?? payload.discount_max_uses_per_user;
        const customerAppliesTo =
            payload.customer_applies_to ??
            payload.discount_customer_applies_to ??
            payload.customerAppliesTo;
        const customerIds = payload.customer_ids ?? payload.discount_customer_ids ?? payload.customerIds;

        const startDate = new Date(startDateInput);
        const endDate = new Date(endDateInput);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            throw new BadRequestError('Invalid date format');
        }
                console.log('new Date() < nextStartDate', new Date() < startDate);

        // kiểm tra
        if(new Date() < startDate || new Date() > endDate) {
            throw new BadRequestError('Invalid date range'); 
        }
        if (startDate >= endDate) {
            throw new BadRequestError('Start date must be before end date');
        }

        // create index for discount code
        const foundDiscount = await discount.findOne({
            discount_code: code,
            discount_shopId: convertToObjectIdMongodb(shopId),
        }).lean();

        if (foundDiscount && foundDiscount.discount_is_active) {
            throw new BadRequestError('Discount code already exists');
        }

        if (customerAppliesTo === 'specific' && (!Array.isArray(customerIds) || !customerIds.length)) {
            throw new BadRequestError('Customer ids are required for specific discounts');
        }

        const newDiscount = await discount.create({
            discount_name: nameDiscount,
            discount_description: description,
            discount_type: type,
            discount_code: code,
            discount_value: value,
            discount_min_order_value: minOrderValue ?? 0,
            discount_max_value: maxValue,
            discount_startDate: startDate,
            discount_endDate: endDate,
            discount_max_uses: maxUses,
            discount_uses_count: usesCount,
            discount_uses_used: usersUsed,
            discount_shopId: convertToObjectIdMongodb(shopId),
            discount_applies_to: appliesTo,
            discount_product_ids: appliesTo === 'all' ? [] : productIds,
            discount_is_active: isActive,
            discount_max_uses_per_user: maxUsesPerUser,
            discount_customer_applies_to: customerAppliesTo || 'all',
            discount_customer_ids: customerAppliesTo === 'specific' ? customerIds : []
        });
        return newDiscount;
    }
 
    static async updateDiscountCode(payload) {
        const discountId = payload.discountId ?? payload.discount_id;
        const code = payload.code ?? payload.discount_code;
        const shopId = payload.shopId ?? payload.discount_shopId;
        const nameDiscount = payload.name_discount ?? payload.discount_name;
        const description = payload.description ?? payload.discount_description;
        const type = payload.type ?? payload.discount_type;
        const value = payload.value ?? payload.discount_value;
        const maxValue = payload.max_value ?? payload.discount_max_value;
        const startDateInput = payload.start_date ?? payload.discount_startDate ?? payload.startDate;
        const endDateInput = payload.end_date ?? payload.discount_endDate ?? payload.endDate;
        const maxUses = payload.max_uses ?? payload.discount_max_uses;
        const usesCount = payload.uses_count ?? payload.discount_uses_count;
        const usersUsed = payload.users_used ?? payload.discount_uses_used;
        const isActive = payload.is_active ?? payload.discount_is_active;
        const maxUsesPerUser = payload.max_uses_per_user ?? payload.discount_max_uses_per_user;
        const minOrderValue = payload.min_order_value ?? payload.discount_min_order_value;
        const appliesTo = payload.applies_to ?? payload.discount_applies_to;
        const productIds = payload.product_ids ?? payload.discount_product_ids;
        const customerAppliesTo =
            payload.customer_applies_to ??
            payload.discount_customer_applies_to ??
            payload.customerAppliesTo;
        const customerIds = payload.customer_ids ?? payload.discount_customer_ids ?? payload.customerIds;
        
        const shopObjectId = convertToObjectIdMongodb(shopId);
        if (!shopObjectId) {
            throw new BadRequestError('Invalid shop id');
        }

        const query = { discount_shopId: shopObjectId };
        if (discountId) {
            query._id = convertToObjectIdMongodb(discountId);
        } else if (code) {
            query.discount_code = code;
        } else {
            throw new BadRequestError('Discount identifier is required');
        }

        const existingDiscount = await discount.findOne(query);
        if (!existingDiscount) {
            throw new NotFoundError('Discount code  not found');
        }

        const nextStartDate = startDateInput ? new Date(startDateInput) : existingDiscount.discount_startDate;
        const nextEndDate = endDateInput ? new Date(endDateInput) : existingDiscount.discount_endDate;

        if ((startDateInput && Number.isNaN(nextStartDate.getTime())) || (endDateInput && Number.isNaN(nextEndDate.getTime()))) {
            throw new BadRequestError('Invalid date format');
        }

        if (nextStartDate >= nextEndDate) {
            throw new BadRequestError('Start date must be before end date');
        }

        if (new Date() < nextStartDate || new Date() > nextEndDate) {
            throw new BadRequestError('Invalid date range');
        }

        if (customerAppliesTo === 'specific' && (!Array.isArray(customerIds) || !customerIds.length)) {
            throw new BadRequestError('Customer ids are required for specific discounts');
        }

        const updatePayload = removeUndefinedObject({
            discount_name: nameDiscount,
            discount_description: description,
            discount_type: type,
            discount_value: value,
            discount_min_order_value: minOrderValue,
            discount_max_value: maxValue,
            discount_startDate: startDateInput ? nextStartDate : undefined,
            discount_endDate: endDateInput ? nextEndDate : undefined,
            discount_max_uses: maxUses,
            discount_uses_count: usesCount,
            discount_uses_used: usersUsed,
            discount_is_active: isActive,
            discount_max_uses_per_user: maxUsesPerUser,
            discount_applies_to: appliesTo,
            discount_product_ids: appliesTo === 'all'
                ? []
                : productIds,
            discount_customer_applies_to: customerAppliesTo,
            discount_customer_ids: customerAppliesTo === 'all' ? [] : customerIds
        });
        

        // allow updating product list without changing applies_to
        if (!updatePayload.discount_product_ids && Array.isArray(productIds)) {
            updatePayload.discount_product_ids = productIds;
        }
        if (!updatePayload.discount_customer_ids && Array.isArray(customerIds)) {
            updatePayload.discount_customer_ids = customerIds;
        }

        const updatedDiscount = await discount.findOneAndUpdate(query, updatePayload, { new: true });
        return updatedDiscount;
    }

    /*
    Get all discount codes available with products
    */
    
    static async getAllDiscountCodesWithProduct({
        code, shopId, userId, limit, page
    }) {
        console.log('code, shopId, userId, limit, page', code, shopId, userId, limit, page);
        // create index for discount code
        const query = { discount_code: code };
        const foundDiscounts = await discount.findOne(query).lean();


        if (!foundDiscounts || !foundDiscounts.discount_is_active) {
            throw new NotFoundError('Discount code not found or inactive');
        }

        const { discount_applies_to, discount_product_ids } = foundDiscounts;
        
        let products;
        if (discount_applies_to === 'all') { 
            //get all product
            products = await findAllProducts({
                filter: {
                    isPublished: true
                },
                limit: +limit,
                page: +page,
                sort: 'ctime',
                select: ['product_name']
            });
        };
        if (discount_applies_to === 'specific') {
            //get the products ids
             products = await findAllProducts({
                filter: {
                    _id: {$in: discount_product_ids},
                    isPublished: true
                },
                limit: +limit,
                page: +page,
                sort: 'ctime',
                select: ['product_name']
            })
        }
        console.log('productsproductsproductsproducts>>>', foundDiscounts.discount_applies_to === 'specific', discount_product_ids);
        return products;
    }
    
    /*
        get all discount code of shop
    */

    
    static async getAllDiscountCodesByShop({
        limit, page, shopId, appliesTo, applies_to
    }) {
        const resolvedAppliesTo = appliesTo ?? applies_to;
        const filter = {
            discount_is_active: true
        };
        if (resolvedAppliesTo === 'all' || resolvedAppliesTo === 'specific') {
            filter.discount_applies_to = resolvedAppliesTo;
        }
        const discounts = await findAllDiscountCodesSelect({
            limit: +limit,
            page: +page,
            filter,
            select: [
                'discount_code',
                'discount_name',
                'discount_applies_to',
                'discount_product_ids',
                'discount_customer_applies_to',
                'discount_customer_ids'
            ],
            model: discount,
        })
        console.log('discountsdiscountsdiscountsdiscounts,', discounts,  +limit, +page, shopId);
        return discounts;
    }

    /*
    Apply Discount Code
    products = [
    {...}, {...}
    ]
    */

    // cần phải validate phần product khi áp discount vào 
    static async getDiscountAmount({ codeId, userId, shopId, products }) {
        const foundDiscount = await getDiscountModel(codeId, shopId);

        const {
            discount_max_uses_per_user,
            discount_is_active,
            discount_max_uses,
            discount_min_order_value,
            discount_startDate,
            discount_endDate,
            discount_uses_count,
            discount_type,
            discount_value,
            discount_max_value,
            discount_applies_to,
            discount_product_ids,
            discount_customer_applies_to,
            discount_customer_ids
        } = foundDiscount;
        
        console.log("codeId, shopId", codeId, shopId, convertToObjectIdMongodb(userId),);
        if (!discount_is_active) throw new NotFoundError(`Discount expried!`);
        const usedCount = Number(discount_uses_count || 0);
        if (discount_max_uses > 0 && usedCount >= discount_max_uses) {
            throw new NotFoundError(`Discount are out!`);
        }

        const now = new Date();
        if (now < new Date(discount_startDate) || now > new Date(discount_endDate)) {
            throw new NotFoundError(`Discount ecode has expried!`)
        }
        if (discount_customer_applies_to === 'specific') {
            if (!userId) {
                throw new BadRequestError('Customer is required for this discount');
            }
            const userIdValue = String(userId);
            const allowedIds = Array.isArray(discount_customer_ids)
                ? discount_customer_ids.map((id) => String(id))
                : [];
            if (!allowedIds.includes(userIdValue)) {
                throw new BadRequestError('Discount is not available for this customer');
            }
        }

        const productsInput = Array.isArray(products) ? products : [];
        const eligibleProductIds = Array.isArray(discount_product_ids)
            ? discount_product_ids.map((id) => String(id))
            : [];
        const eligibleProducts =
            discount_applies_to === 'specific'
                ? productsInput.filter((product) =>
                        eligibleProductIds.includes(String(product.productId))
                  )
                : productsInput;

        if (!eligibleProducts.length) {
            throw new NotFoundError('No eligible products for this discount');
        }
        // check xem có set giá trị tối thiểu hay không?
        let totalOrder = 0;
        if (discount_min_order_value > 0) {
            // get total
            totalOrder = eligibleProducts.reduce((accumulator, product) => {
                return accumulator + (product.quantity * product.price)
            }, 0);

            if (totalOrder < discount_min_order_value) throw new NotFoundError(`Discount requires a minium order value of ${discount_min_order_value}!`);
        }
        
        if (discount_max_uses_per_user > 0) {
            const userObjectId = convertToObjectIdMongodb(userId);
            if (!userObjectId) {
                throw new BadRequestError('Invalid user id');
            }
            const userUsage = await discountUsage.findOne({
                usage_discount_id: foundDiscount._id,
                usage_user_id: userObjectId
            }).select('usage_count').lean();
            if (userUsage && userUsage.usage_count >= discount_max_uses_per_user) {
                throw new BadRequestError('Discount usage limit reached for this user');
            }
        }

        if (!totalOrder && eligibleProducts.length) {
            totalOrder = eligibleProducts.reduce((accumulator, product) => {
                return accumulator + (product.quantity * product.price)
            }, 0);
        }

        const numericDiscountValue = Number(discount_value) || 0;
        const numericMaxValue = Number(discount_max_value) || 0;
        let rawAmount = 0;
        if (discount_type === 'fixed_amount') {
            rawAmount = numericDiscountValue;
        } else if (discount_type === 'percentage') {
            rawAmount = totalOrder * (numericDiscountValue / 100);
        }
        const cappedAmount =
            numericMaxValue > 0 ? Math.min(rawAmount, numericMaxValue) : rawAmount;
        const safeAmount = Math.min(cappedAmount, totalOrder);
        const totalPrice = Math.max(0, totalOrder - safeAmount);

        return {
            totalOrder,
            discount: safeAmount,
            totalPrice,
            discountId: foundDiscount._id,
            discountCode: foundDiscount.discount_code,
            appliesTo: discount_applies_to,
            productIds: eligibleProducts.map((product) => String(product.productId))
        };
    };

    static async recordDiscountUsage({ discountId, userId, shopId }) {
        const shopObjectId = convertToObjectIdMongodb(shopId);
        const discountObjectId = convertToObjectIdMongodb(discountId);
        const userObjectId = convertToObjectIdMongodb(userId);
        if (!shopObjectId) {
            throw new BadRequestError('Invalid shop id');
        }
        if (!discountObjectId) {
            throw new BadRequestError('Invalid discount id');
        }
        if (!userObjectId) {
            throw new BadRequestError('Invalid user id');
        }

        const foundDiscount = await discount.findOne({
            _id: discountObjectId,
            discount_shopId: shopObjectId
        }).lean();
        if (!foundDiscount || !foundDiscount.discount_is_active) {
            throw new NotFoundError('Discount code not found');
        }

        const now = new Date();
        if (now < new Date(foundDiscount.discount_startDate) || now > new Date(foundDiscount.discount_endDate)) {
            throw new BadRequestError('Discount expired');
        }

        const usedCount = Number(foundDiscount.discount_uses_count || 0);
        if (foundDiscount.discount_max_uses > 0 && usedCount >= foundDiscount.discount_max_uses) {
            throw new BadRequestError('Discount usage limit reached');
        }

        const usageQuery = {
            usage_discount_id: discountObjectId,
            usage_user_id: userObjectId
        };
        if (foundDiscount.discount_max_uses_per_user > 0) {
            usageQuery.usage_count = { $lt: foundDiscount.discount_max_uses_per_user };
        }

        let usageRecord;
        try {
            usageRecord = await discountUsage.findOneAndUpdate(
                usageQuery,
                {
                    $inc: { usage_count: 1 },
                    $set: {
                        usage_shop_id: shopObjectId,
                        usage_last_used_at: now
                    }
                },
                {
                    new: true,
                    upsert: true,
                    setDefaultsOnInsert: true
                }
            );
        } catch (error) {
            if (error && error.code === 11000) {
                throw new BadRequestError('Discount usage limit reached for this user');
            }
            throw error;
        }

        if (!usageRecord) {
            throw new BadRequestError('Discount usage limit reached for this user');
        }

        await discount.updateOne(
            { _id: discountObjectId },
            {
                $inc: { discount_uses_count: 1 },
                $addToSet: { discount_uses_used: userObjectId }
            }
        );

        return usageRecord;
    }

    static async deleteDiscountCode({ shopId, codeId, deletedBy, reason }) {
        const shopObjectId = convertToObjectIdMongodb(shopId);
        if (!shopObjectId) {
            throw new BadRequestError('Invalid shop id');
        }
        if (!codeId) {
            throw new BadRequestError('Discount identifier is required');
        }

        const discountObjectId = convertToObjectIdMongodb(codeId);
        const query = { discount_shopId: shopObjectId };
        if (discountObjectId) {
            query._id = discountObjectId;
        } else {
            query.discount_code = codeId;
        }

        const foundDiscount = await discount.findOne(query);
        if (!foundDiscount) {
            throw new NotFoundError('Discount code not found');
        }

        const existingDeletion = await discountDeletion.findOne({
            deletion_discount_id: foundDiscount._id,
            deletion_shop_id: shopObjectId
        }).lean();
        if (existingDeletion) {
            return existingDeletion;
        }

        const deletionPayload = removeUndefinedObject({
            deletion_discount_id: foundDiscount._id,
            deletion_discount_code: foundDiscount.discount_code,
            deletion_shop_id: shopObjectId,
            deletion_confirmed_by: convertToObjectIdMongodb(deletedBy) || shopObjectId,
            deletion_reason: reason,
            deletion_snapshot: foundDiscount.toObject()
        });

        await discount.updateOne(
            { _id: foundDiscount._id },
            { $set: { discount_is_active: false } }
        );

        const deletionRecord = await discountDeletion.create(deletionPayload);
        return deletionRecord;
    }
    /*
        Cancel discount code
    */

    static async cancelDiscountCode({codeId, shopId, userId }) {
        const foundDiscount = await getDiscountModel(codeId, shopId);

        const result = await discount.findByIdAndUpdate(foundDiscount._id, {
            $pull: {
                discount_uses_used: userId,
            },
            $inc: {
                discount_uses_count: -1
            }
        });
        return result;
    }

    static async rollbackDiscountUsage({ discountId, shopId, userId }) {
        const shopObjectId = convertToObjectIdMongodb(shopId);
        const discountObjectId = convertToObjectIdMongodb(discountId);
        const userObjectId = convertToObjectIdMongodb(userId);
        if (!shopObjectId) {
            throw new BadRequestError('Invalid shop id');
        }
        if (!discountObjectId) {
            throw new BadRequestError('Invalid discount id');
        }
        if (!userObjectId) {
            throw new BadRequestError('Invalid user id');
        }

        await discountUsage.updateOne(
            {
                usage_discount_id: discountObjectId,
                usage_user_id: userObjectId
            },
            { $inc: { usage_count: -1 } }
        );

        await discount.updateOne(
            { _id: discountObjectId, discount_shopId: shopObjectId },
            {
                $pull: { discount_uses_used: userObjectId },
                $inc: {
                    discount_uses_count: -1
                }
            }
        );

        return true;
    }
    
};

const getDiscountModel = async (codeId, shopId) => {
    const query = { discount_code: codeId };
    const foundDiscount = await checkDiscountExists(discount, query);
    
    console.log('looix day nef>>>>', codeId, shopId, foundDiscount);
    if (!foundDiscount) throw new NotFoundError(`discount doesn't exists`);
    return foundDiscount
}


module.exports = DisscountService;
