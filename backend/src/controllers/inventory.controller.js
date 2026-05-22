'use strict'

const InventoryService = require("../services/inventory.service");

const { SuccessResponse } = require("../core/success.response");

class CheckoutController{

    addStock = async (req, res, next) => {
        // new
        new SuccessResponse({
            message: 'add stock to inventory success!',
            metadata: await InventoryService.addStockToInventory(req.body)
        }).send(res)
    }
}

module.exports = new CheckoutController();

