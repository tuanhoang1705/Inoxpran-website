'use strict'

const { getSelectData } = require('../../utils');
const admin = require('../admin.model');

const findByEmail = async ({ email, select = { email: 1, password: 1, name: 1, status: 1, roles: 1 } }) => {
    return await admin.findOne({ email }).select(select).lean();
};

const findById = async ({ adminId, select }) => {
    return await admin.findById(adminId).select(select).lean();
};

const findAllAdmins = async ({ limit = 50, page = 1, sort = 'ctime', filter = {}, select = [] }) => {
    const skip = (page - 1) * limit;
    const sortBy = (sort === 'ctime') ? { _id: -1 } : { _id: 1 };
    return await admin.find(filter)
        .sort(sortBy)
        .skip(skip)
        .limit(limit)
        .select(getSelectData(select))
        .lean()
        .exec();
};

module.exports = {
    findByEmail,
    findById,
    findAllAdmins
};
