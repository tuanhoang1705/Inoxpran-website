'use strict'

const { getSelectData } = require('../../utils');
const user = require('../user.model');

const findByEmail = async ({ email, select = { email: 1, password: 1, name: 1, status: 1, roles: 1, verify: 1 } }) => {
    return await user.findOne({ email }).select(select).lean();
};

const findById = async ({ userId, select }) => {
    return await user.findById(userId).select(select).lean();
};

const findAllUsers = async ({ limit = 50, page = 1, sort = 'ctime', filter = {}, select = [] }) => {
    const skip = (page - 1) * limit;
    const sortBy = (sort === 'ctime')
        ? { createdAt: -1, _id: -1 }
        : { createdAt: 1, _id: 1 };
    return await user.find(filter)
        .sort(sortBy)
        .skip(skip)
        .limit(limit)
        .select(getSelectData(select))
        .lean()
        .exec();
};

const countUsers = async ({ filter = {} } = {}) => {
    return await user.countDocuments(filter).exec();
};

module.exports = {
    findByEmail,
    findById,
    findAllUsers,
    countUsers
};
