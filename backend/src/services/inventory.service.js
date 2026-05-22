'use strict'

const { BadRequestError } = require('../core/error.response');
const { inventory } = require('../models/inventory.model');
const { getProductById, adjustProductQuantity } = require('../models/repositories/product.repo');

class InventoryService {
    static async addStockToInventory({
        stock,
        productId,
        shopId,
        location = ``
    }) {
        const product = await getProductById(productId);
        if (!product) throw new BadRequestError('The product does not exists!');
        
        const query = { inven_shopId: shopId, inven_productId: productId },
            updateSet = {
                $inc: {
                    inven_stock: stock
                },
                $set: {
                    inven_location: location
                }
                
            }, options = { upsert: true, new: true };
        
        const updatedInventory = await inventory.findOneAndUpdate(query, updateSet, options);
        const delta = Number(stock);
        if (Number.isFinite(delta) && delta !== 0) {
            await adjustProductQuantity({ productId, delta });
        }
        return updatedInventory;
        
    }
};

module.exports = InventoryService;
