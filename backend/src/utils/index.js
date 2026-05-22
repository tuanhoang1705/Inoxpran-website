'use strict'

const _ = require('lodash');
const { Types } = require('mongoose');


const convertToObjectIdMongodb = (id) => {
    if (!id) {
        return undefined;
    }
    if (id instanceof Types.ObjectId) {
        return id;
    }
    if (typeof id !== 'string') {
        return undefined;
    }
    const trimmedId = id.trim();
    if (!trimmedId) {
        return undefined;
    }
    if (!Types.ObjectId.isValid(trimmedId)) {
        return undefined;
    }
    return new Types.ObjectId(trimmedId);
}
const getInfoData = ({fileds = [], object = {} }) => {
    return _.pick(object, fileds);
}
// ['a', 'b'] => { a: 1, b: 1 }
const getSelectData = (select = []) => {
    return Object.fromEntries(select.map(el => [el, 1]));
}
const getUnSelectData = (unselect = []) => {
    return Object.fromEntries(unselect.map(el => [el, 0]));
}
const removeUndefinedObject = obj => { 
    Object.keys(obj).forEach(key => {
        if (obj[key] == null || obj[key] == undefined) {
            delete obj[key];
        }
    });
    return obj; 
}
const updateNestedObject = (obj) => {
    const final = {};
    Object.keys(obj).forEach(key => {
        if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
            const response = updateNestedObject(obj[key]);
            Object.keys(response).forEach(nestedKey => {
                final[`${key}.${nestedKey}`] = response[nestedKey];
             })
        }else {
            final[key] = obj[key];
        }
    });
    return final;
}

module.exports = {
    getInfoData,
    getSelectData,
    getUnSelectData,
    removeUndefinedObject,
    updateNestedObject, 
    convertToObjectIdMongodb
}
