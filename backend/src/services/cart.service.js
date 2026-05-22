'use strict'
const { BadRequestError, NotFoundError } = require('../core/error.response');
const { cart } = require('../models/cart.model');
const cartDeletion = require('../models/cartDeletion.model');
const { getProductById } = require('../models/repositories/product.repo');
const { convertToObjectIdMongodb } = require('../utils');

const normalizeUserId = (userId) => {
    const userObjectId = convertToObjectIdMongodb(userId);
    if (!userObjectId) {
        throw new BadRequestError('Invalid user id');
    }
    return userObjectId;
};
/*
    Key features: Cart Service
    - add product to card [user]
    -reduce product quantity by one [User]
    - increase product quantity by One [User]
    - get cart [User]
    - DELETE cart [User]
    - Delete cart item [User]
*/

class CartService {

    /// START REPO CART ////
    static async createUserCart({ userId, product }) {
        const userObjectId = normalizeUserId(userId);
        const countIncrement = product ? 1 : 0;
        const query = { cart_userId: userObjectId, cart_state: 'active' }, updateOrInsert = {
            $addToSet: {
                cart_products: product
            },
            $inc: {
                cart_count_product: countIncrement
            }
        }, options = { upsert: true, new: true };

        return await cart.findOneAndUpdate(query, updateOrInsert, options)
    }

    static async updateUserCartQuantity({ userId, product }) {
        const userObjectId = normalizeUserId(userId);
        const { productId, quantity, name, price, shopId } = product; 
        const query = {
                cart_userId: userObjectId,
                'cart_products.productId': productId,
                cart_state: 'active'
            };
        const updateSet = {
            $inc: {
                'cart_products.$.quantity': quantity
            }
        };
        
        const setFields = {};
        if (name != null) setFields['cart_products.$.name'] = name;
        if (price != null) setFields['cart_products.$.price'] = price;
        if (shopId != null) setFields['cart_products.$.shopId'] = shopId;
        if (Object.keys(setFields).length) {
            updateSet.$set = setFields;
        }
        const options = { new: true };
        
        return await cart.findOneAndUpdate(query, updateSet, options)
    }

    static async setUserCartQuantity({ userId, product }) {
        const userObjectId = normalizeUserId(userId);
        const { productId, quantity, name, price, shopId } = product;
        const normalizedQuantity = Number(quantity);
        if (Number.isNaN(normalizedQuantity)) {
            throw new BadRequestError('Quantity must be a number');
        }

        const query = {
            cart_userId: userObjectId,
            'cart_products.productId': productId,
            cart_state: 'active'
        };

        const setFields = {
            'cart_products.$.quantity': normalizedQuantity
        };
        if (name != null) setFields['cart_products.$.name'] = name;
        if (price != null) setFields['cart_products.$.price'] = price;
        if (shopId != null) setFields['cart_products.$.shopId'] = shopId;

        const options = { new: true };
        return await cart.findOneAndUpdate(query, { $set: setFields }, options);
    }
    
    /// END CART /////
    static async addToCart({ userId, product = {} }) {
        const userObjectId = normalizeUserId(userId);
        if (!product.productId) {
            throw new BadRequestError('Product id is required');
        }
        if (product.quantity == null) {
            throw new BadRequestError('Quantity is required');
        }
        const quantity = Number(product.quantity);
        if (Number.isNaN(quantity)) {
            throw new BadRequestError('Quantity must be a number');
        }
        if (quantity <= 0) {
            throw new BadRequestError('Quantity must be greater than 0');
        }
        const safeQuantity = Math.floor(quantity);

        const foundProduct = await getProductById(product.productId);
        if (!foundProduct) {
            throw new NotFoundError('Product not found');
        }

        const cartProduct = {
            productId: product.productId,
            shopId: foundProduct.product_shop,
            quantity: safeQuantity,
            name: foundProduct.product_name,
            price: foundProduct.product_price
        };

        const userCart = await cart.findOne({ cart_userId: userObjectId, cart_state: 'active' })
        if (!userCart) {
            // create cart for User
            return await CartService.createUserCart({ userId: userObjectId, product: cartProduct })
        }
        // nếu có giỏ hàng rồi nhưng chưa có sản phẩm?
        if (!Array.isArray(userCart.cart_products) || !userCart.cart_products.length) {
            userCart.cart_products = [cartProduct];
            userCart.cart_count_product = 1;
            return await userCart.save();
        }
        // giỏ hàng tồn tại, và có sản phẩm này thì update quantity
        const existingItem = userCart.cart_products.find(
            (item) => String(item.productId) === String(product.productId)
        );
        if (existingItem) {
            const currentQuantity = Number(existingItem.quantity);
            if (!Number.isFinite(currentQuantity) || currentQuantity < 0) {
                // Auto-heal corrupted cart rows (negative/invalid quantity)
                return await CartService.setUserCartQuantity({
                    userId: userObjectId,
                    product: cartProduct
                });
            }
            return await CartService.updateUserCartQuantity({ userId: userObjectId, product: cartProduct });
        }

        const updateSet = {
            $push: {
                cart_products: cartProduct
            },
            $inc: {
                cart_count_product: 1
            }
        };
        const options = { new: true };
        return await cart.findOneAndUpdate(
            { cart_userId: userObjectId, cart_state: 'active' },
            updateSet,
            options
        );
    }
        
    // update
    /*
        shop_order_ids:[
        {
            shopId,
            item_products: [
            {
                quantity,
                price,
                shopId,
                old_quantity,
                productId
            }],
            ...version
        }]
    */
    
    static async updateToCart({ userId, shop_order_ids = [] }) {
        const userObjectId = normalizeUserId(userId);

        const order = Array.isArray(shop_order_ids) ? shop_order_ids[0] : null;
        const item = order?.item_products?.[0];
        if (!item?.productId) {
            throw new BadRequestError('Product id is required');
        }
        
        if (item.quantity == null) {
            throw new BadRequestError('Quantity is required');
        }

        const nextQuantity = Number(item.quantity);
        if (Number.isNaN(nextQuantity)) {
            throw new BadRequestError('Quantity must be a number');
        }
        if (nextQuantity < 0) {
            throw new BadRequestError('Quantity cannot be negative');
        }

        // check product
        const foundProduct = await getProductById(item.productId);
        if (!foundProduct) {
            throw new NotFoundError('Product not found');
        }
        const productPrice = Number(foundProduct.product_price);
        if (Number.isNaN(productPrice)) {
            throw new BadRequestError('Product price is invalid');
        }
        if (item.price != null) {
            const requestPrice = Number(item.price);
            if (Number.isNaN(requestPrice)) {
                throw new BadRequestError('Price must be a number');
            }
            if (requestPrice !== productPrice) {
                throw new BadRequestError('Product price has changed');
            }
        }

        const productQuantity = Number(foundProduct.product_quantity);
        if (Number.isNaN(productQuantity)) {
            throw new BadRequestError('Product quantity is invalid');
        }
        if (item.old_quantity != null) {
            const requestOldQuantity = Number(item.old_quantity);
            if (Number.isNaN(requestOldQuantity)) {
                throw new BadRequestError('Old quantity must be a number');
            }
            if (requestOldQuantity < 0) {
                throw new BadRequestError('Old quantity cannot be negative');
            }
            if (requestOldQuantity !== productQuantity) {
                throw new BadRequestError('Product quantity has changed');
            }
        }
 
        const cartDoc = await cart.findOne({
            cart_userId: userObjectId,
            cart_state: 'active',
            'cart_products.productId': item.productId
        }, { cart_products: 1 }).lean();

        const currentItem = Array.isArray(cartDoc?.cart_products)
            ? cartDoc.cart_products.find(
                (cartItem) => String(cartItem.productId) === String(item.productId)
            )
            : null;
        if (!currentItem) {
            throw new NotFoundError('Cart item not found');
        }

        if (nextQuantity === 0) {
            return await CartService.deleteUserCart({
                userId: userObjectId,
                productId: item.productId,
                reason: 'quantity set to 0'
            });
        }

        return await CartService.setUserCartQuantity({
            userId: userObjectId,
            product: {
                productId: item.productId,
                quantity: nextQuantity,
                name: foundProduct.product_name,
                price: foundProduct.product_price,
                shopId: foundProduct.product_shop
            }
        })
    }

    static async deleteUserCart({ userId, productId, reason }) {
        const userObjectId = normalizeUserId(userId);
        if (!productId) {
            throw new BadRequestError('Product id is required');
        }

        const query = {
            cart_userId: userObjectId,
            cart_state: 'active',
            'cart_products.productId': productId
        };
        const cartDoc = await cart.findOne(query).lean();
        if (!cartDoc) {
            throw new NotFoundError('Cart item not found');
        }

        const deletedItem = Array.isArray(cartDoc.cart_products)
            ? cartDoc.cart_products.find((item) => String(item.productId) === String(productId))
            : null;
        if (!deletedItem) {
            throw new NotFoundError('Cart item not found');
        }
        const deletionPayload = {
            deletion_cart_id: cartDoc._id,
            deletion_user_id: userObjectId,
            deletion_product_id: String(deletedItem.productId),
            deletion_shop_id: deletedItem.shopId,
            deletion_reason: reason,
            deletion_snapshot: deletedItem
        };
        await cartDeletion.create(deletionPayload);

        const updateSet = {
            $pull: {
                cart_products: {
                    productId
                }
            },
            $inc: {
                cart_count_product: -1
            }
        };

        const deleteCart = await cart.updateOne(query, updateSet);
        if (!deleteCart || deleteCart.matchedCount === 0) {
            throw new NotFoundError('Cart item not found');
        }

        return deleteCart;
    };

    static async getListUserCart({ userId }) {
        const userObjectId = normalizeUserId(userId);
        return await cart.findOne({
            cart_userId: userObjectId,
            cart_state: 'active'
        }).lean();
    }
}

module.exports = CartService;
