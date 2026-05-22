'use strict'
const { reservationInventory } = require('../models/repositories/inventory.repo');
const { redisClient } = require('../config/redis');

const ensureConnected = async () => {
    if (!redisClient.isOpen) {
        await redisClient.connect();
    }
};

const acquireLock = async (productId, quantity, cartId) => {
    await ensureConnected();
    const key = `lock_v2026_${productId}`;
    const retryTimes = 10;
    const expireTime = 30000; // 30 seconds tam lock
    for (let i = 0; i < retryTimes; i++) {
        const result = await redisClient.set(key, 'locked', { NX: true });
        console.log('result:::1', result);
        if (result) {
            const isReversation = await reservationInventory({
                productId, quantity, cartId
            });
            if (isReversation.modifiedCount) {
                await redisClient.pExpire(key, expireTime);
                return key;
            }
            await redisClient.del(key);
            return null;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
};

const releaseLock = async (keyLock) => {
    await ensureConnected();
    return await redisClient.del(keyLock);
};
module.exports = {
    acquireLock,
    releaseLock
}
