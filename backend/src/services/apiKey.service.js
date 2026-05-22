'use strict'

const apikeyModel = require('../models/apiKey.model')

const findById = async (key) => {
    if (!key) return null;
    const objKey = await apikeyModel.findOne({ key, status: true }).lean();
    return objKey;
}

module.exports = {
    findById
}

