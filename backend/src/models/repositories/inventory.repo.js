const { convertToObjectIdMongodb } = require('../../utils');
const { inventory } = require('../inventory.model');

const {Type} = require('mongoose');
const insertInventory = async ({ productId, shopId, stock, location }) => {
    return await inventory.create({
        inven_productId: productId,
        inven_shopId: shopId,
        inven_stock: stock,
        inven_location: location
    });
}

const reservationInventory = async ({ productId, quantity, cartId }) => {
    const query = {
        inven_productId: convertToObjectIdMongodb(productId),
        inven_stock: { $gte: quantity }
    };
    const updateSet = {
        $inc: {
            inven_stock: -quantity
        },
        $push: {
            inven_reservations: {
                quantity,
                cartId,
                createOn: new Date()
            }
        }
    };
    return await inventory.updateOne(query, updateSet, { upsert: false });
}

const releaseReservationInventory = async ({ productId, quantity, cartId }) => {
    const query = { inven_productId: convertToObjectIdMongodb(productId) };
    const updateSet = {
        $inc: {
            inven_stock: quantity
        }
    };
    if (cartId) {
        updateSet.$pull = {
            inven_reservations: {
                cartId
            }
        };
    }
    return await inventory.updateOne(query, updateSet);
}

const findInventoryByProductIds = async ({ productIds = [] } = {}) => {
    const ids = Array.isArray(productIds)
        ? productIds.map((id) => convertToObjectIdMongodb(id)).filter(Boolean)
        : [];
    if (!ids.length) return [];
    return await inventory
        .find({ inven_productId: { $in: ids } })
        .select('inven_productId inven_stock')
        .lean();
};

const setInventoryStock = async ({ productId, stock }) => {
    const productObjectId = convertToObjectIdMongodb(productId);
    const normalizedStock = Number(stock);
    if (!productObjectId || !Number.isFinite(normalizedStock)) return null;
    return await inventory.updateOne(
        { inven_productId: productObjectId },
        { $set: { inven_stock: normalizedStock } },
        { upsert: false }
    );
};
    
module.exports = {
    insertInventory,
    reservationInventory,
    releaseReservationInventory,
    findInventoryByProductIds,
    setInventoryStock
};
