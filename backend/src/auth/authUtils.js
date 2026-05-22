'use strict'

const JWT = require('jsonwebtoken');
const { AuthFailureError, NotFoundError } = require('../core/error.response');
const asyncHandler = require('../helpers/asyncHandler');

//service
const { findByUserId } = require('../services/keyToken.service.js');
const HEADER = {
    API_KEY: 'x-api-key',
    CLIENT_ID: 'x-client-id',
    AUTHORIZATION: 'authorization',
    REFRESHTOKEN: 'x-rtoken-id'
}

const createTokenPair = async (payload, publicKey, privateKey) => {
    try {
        // accessToken
        const accessToken = await JWT.sign(payload, publicKey, {
            expiresIn: '30 days'
        })

        const refreshToken = await JWT.sign(payload, privateKey, {
            expiresIn: '60 days'
        })

        return {accessToken, refreshToken};
    } catch (error) {
        throw error;
    }
}

const findKeyPairByKeyId = (keyStore, keyId) => {
    if (!keyId || !Array.isArray(keyStore?.keys)) return null;
    return keyStore.keys.find((item) => item.keyId === keyId) || null;
};

const findKeyPairByRefreshToken = (keyStore, refreshToken) => {
    if (!refreshToken || !Array.isArray(keyStore?.keys)) return null;
    return keyStore.keys.find((item) => item.refreshToken === refreshToken) || null;
};

const findKeyPairByUsedRefreshToken = (keyStore, refreshToken) => {
    if (!refreshToken || !Array.isArray(keyStore?.keys)) return null;
    return keyStore.keys.find((item) => Array.isArray(item.refreshTokensUsed) && item.refreshTokensUsed.includes(refreshToken)) || null;
};

const buildAuthentication = (userType) => asyncHandler(async (req, res, next) => {
    /*
    1 - Check usserId misssing?
    2 - get accessToken
    3 - verifyToken
    4 - check user in bds?
    5 - check keyStore with this userId?
    6 - OK all -> return next()
    */

    const userId = req.headers[HEADER.CLIENT_ID];
    if (!userId) throw new AuthFailureError('Invalid Request1');
    //2
    const keyStore = await findByUserId(userId, userType);
    if (!keyStore) throw new NotFoundError('Not found keyStore');
    
    //3

    if (req.headers[HEADER.REFRESHTOKEN]) {
        try {
            const refreshToken = req.headers[HEADER.REFRESHTOKEN];
            const hasKeyPairs = Array.isArray(keyStore.keys) && keyStore.keys.length > 0;
            let keyPair = findKeyPairByRefreshToken(keyStore, refreshToken);
            if (!keyPair && hasKeyPairs) {
                keyPair = findKeyPairByUsedRefreshToken(keyStore, refreshToken);
            }
            const privateKey = keyPair?.privateKey || (hasKeyPairs ? null : keyStore.privateKey);
            if (!privateKey) throw new AuthFailureError('Invalid Request2');
            if (!keyPair && keyStore.refreshToken && keyStore.refreshToken !== refreshToken) {
                throw new AuthFailureError('Invalid Request2');
            }
            const decodeUser = JWT.verify(refreshToken, privateKey);
            if (userId !== decodeUser.userId) throw new AuthFailureError('Invalid Userid');
            req.keyStore = keyStore;
            req.keyPair = keyPair;
            req.user = decodeUser;
            req.refreshToken = refreshToken;
            return next();
        } catch (error) {
            throw error;
        }
    }
    const accessToken = req.headers[HEADER.AUTHORIZATION];
    if (!accessToken) throw new AuthFailureError('Invalid Request2');
    try {
        const decodedPayload = JWT.decode(accessToken) || {};
        const keyId = decodedPayload?.keyId;
        const hasKeyPairs = Array.isArray(keyStore.keys) && keyStore.keys.length > 0;
        if (hasKeyPairs && !keyId) throw new AuthFailureError('Invalid Request2');
        const keyPair = findKeyPairByKeyId(keyStore, keyId);
        if (keyId && !keyPair) throw new NotFoundError('Not found keyStore');
        const publicKey = keyPair?.publicKey || keyStore.publicKey;
        if (!publicKey) throw new AuthFailureError('Invalid Request2');
        const decodeUser = JWT.verify(accessToken, publicKey);
        if (userId !== decodeUser.userId) throw new AuthFailureError('Invalid Userid');
        req.keyStore = keyStore;
        req.keyPair = keyPair;
        req.user = decodeUser;
        return next();
    } catch (error) {
        throw error;
    }
});

const authenticationV2 = buildAuthentication();
const authenticationUser = buildAuthentication('User');
const authenticationAdmin = buildAuthentication('Admin');

const verifyJWT = async (token, keySecret) => {
    return await JWT.verify(token, keySecret);
}
module.exports = {
    createTokenPair,
    authenticationV2,
    authenticationUser,
    authenticationAdmin,
    verifyJWT
}
