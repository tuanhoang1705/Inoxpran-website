'use strict'

const WEBMASTERS_READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const DEFAULT_GOOGLE_AUTH_TIMEOUT_MS = 10 * 1000;

const boundedTimeoutMs = (value, fallback = DEFAULT_GOOGLE_AUTH_TIMEOUT_MS) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(60 * 1000, Math.max(1, parsed)) : fallback;
};

const withTimeout = async (promise, timeoutMs, code) => {
    let timeout;
    try {
        return await Promise.race([
            Promise.resolve(promise),
            new Promise((_, reject) => {
                timeout = setTimeout(() => {
                    const error = new Error(String(code || 'operation_timeout').toLowerCase());
                    error.code = code || 'OPERATION_TIMEOUT';
                    reject(error);
                }, boundedTimeoutMs(timeoutMs));
            })
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
};

const loadGoogleAuth = () => {
    try {
        return require('google-auth-library').GoogleAuth;
    } catch (_error) {
        const error = new Error('google_auth_library_unavailable');
        error.code = 'GOOGLE_AUTH_LIBRARY_UNAVAILABLE';
        throw error;
    }
};

const createGoogleAuthTokenProvider = ({ GoogleAuthClass, timeoutMs = DEFAULT_GOOGLE_AUTH_TIMEOUT_MS } = {}) => {
    let clientPromise = null;
    return async () => {
        const Auth = GoogleAuthClass || loadGoogleAuth();
        if (!clientPromise) {
            const auth = new Auth({ scopes: [WEBMASTERS_READONLY_SCOPE] });
            clientPromise = withTimeout(
                auth.getClient(),
                timeoutMs,
                'GOOGLE_AUTH_CLIENT_TIMEOUT'
            ).catch((error) => {
                clientPromise = null;
                throw error;
            });
        }
        const client = await clientPromise;
        const response = await withTimeout(
            client.getAccessToken(),
            timeoutMs,
            'GOOGLE_AUTH_TOKEN_TIMEOUT'
        );
        const token = typeof response === 'string' ? response : response?.token;
        if (!token || typeof token !== 'string') {
            const error = new Error('google_auth_token_unavailable');
            error.code = 'GOOGLE_AUTH_TOKEN_UNAVAILABLE';
            throw error;
        }
        return token;
    };
};

module.exports = {
    DEFAULT_GOOGLE_AUTH_TIMEOUT_MS,
    WEBMASTERS_READONLY_SCOPE,
    boundedTimeoutMs,
    createGoogleAuthTokenProvider,
    withTimeout
};
