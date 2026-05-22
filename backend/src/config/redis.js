'use strict'

const redis = require('redis');

const normalizeEnvValue = (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return '';
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
};

const getRedisConfig = () => {
    const redisUrl = normalizeEnvValue(process.env.REDIS_URL);
    const hostEnv = normalizeEnvValue(process.env.REDIS_HOST);
    const portEnv = normalizeEnvValue(process.env.REDIS_PORT);
    const usernameEnv = normalizeEnvValue(process.env.REDIS_USERNAME);
    const password = normalizeEnvValue(process.env.REDIS_PASSWORD) || undefined;
    const username = usernameEnv || (password ? 'default' : undefined);
    const tlsEnabled = normalizeEnvValue(process.env.REDIS_TLS) === 'true';

    const hasExplicitConfig = Boolean(hostEnv || portEnv || usernameEnv || password);
    if (!hasExplicitConfig && redisUrl && (redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://'))) {
        return { url: redisUrl };
    }

    const hostFromUrl = redisUrl && !redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')
        ? redisUrl
        : '';
    const host = hostEnv || hostFromUrl || '127.0.0.1';
    const port = Number(portEnv || 6379);

    const socket = { host, port };
    if (tlsEnabled) {
        socket.tls = true;
        socket.servername = host;
    }

    return {
        socket,
        username,
        password
    };
};




const redisClient = redis.createClient(getRedisConfig());

redisClient.on('error', (err) => {
    console.error('Redis Client Error', err);
});

module.exports = {
    redisClient,
    getRedisConfig
};
