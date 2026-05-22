'use strict'
const keyTokenModel = require('../models/keyToken.model');
class KeyTokenService {
    
    static createKeyToken = async ({ userId, publicKey, privateKey, refreshToken, userType = 'User', keyId }) => {
        try {
            if (!keyId) return null;
            const filter = { user: userId, userType };
            const keyPair = {
                keyId,
                publicKey,
                privateKey,
                refreshToken,
                refreshTokensUsed: []
            };

            const update = {
                $setOnInsert: {
                    publicKey,
                    privateKey,
                    refreshToken,
                    refreshTokensUsed: [],
                    userType,
                    user: userId
                },
                $push: {
                    keys: keyPair
                }
            };

            const tokens = await keyTokenModel.findOneAndUpdate(filter, update, {
                upsert: true,
                new: true
            });

            return tokens ? tokens.publicKey : null

        } catch (error) {
            return error;
        }
    }

    static findByUserId = async (userId, userType) => {
        const filter = { user: userId };
        if (userType) {
            filter.userType = userType;
        }
        return await keyTokenModel.findOne(filter)
    }

    static removeKeyById = async (id) => {
        return await keyTokenModel.deleteOne({ _id: id });
    }
    
    static findByRefreshTokenUsed = async (refreshToken) => {
        return await keyTokenModel.findOne({
            $or: [
                { refreshTokensUsed: refreshToken },
                { 'keys.refreshTokensUsed': refreshToken }
            ]
        }).lean();
    }
    
    static findByRefreshToken = async (refreshToken) => {
        return await keyTokenModel.findOne({
            $or: [{ refreshToken }, { 'keys.refreshToken': refreshToken }]
        })
    }

    static deleteKeyById = async (userId) => { 
        return await keyTokenModel.deleteOne({ user: userId});
    }

    static removeKeyByKeyId = async ({ keyStoreId, keyId }) => {
        return await keyTokenModel.findByIdAndUpdate(
            keyStoreId,
            {
                $pull: { keys: { keyId } }
            },
            { new: true }
        );
    }
};



module.exports = KeyTokenService;
