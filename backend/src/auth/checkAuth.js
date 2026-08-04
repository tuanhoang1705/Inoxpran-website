'use strict'

const HEADER = {
    API_KEY: 'x-api-key',
    AUTHORIZATION: 'authorization'
}

const PERMISSIONS = {
    PUBLIC: 'PUBLIC',
    USER: 'USER',
    ADMIN: 'ADMIN',
    ADMIN_SYSTEM: 'ADMIN_SYSTEM'
};

const LEGACY_PERMISSION_MAP = {
    '0000': PERMISSIONS.PUBLIC,
    '2222': PERMISSIONS.ADMIN_SYSTEM
};

const PERMISSION_IMPLICATIONS = {
    [PERMISSIONS.ADMIN_SYSTEM]: [PERMISSIONS.ADMIN_SYSTEM, PERMISSIONS.ADMIN, PERMISSIONS.USER, PERMISSIONS.PUBLIC],
    [PERMISSIONS.ADMIN]: [PERMISSIONS.ADMIN, PERMISSIONS.PUBLIC],
    [PERMISSIONS.USER]: [PERMISSIONS.USER, PERMISSIONS.PUBLIC],
    [PERMISSIONS.PUBLIC]: [PERMISSIONS.PUBLIC]
};

const { findById } = require('../services/apiKey.service')
const {
    ensureApiKey,
    findConfiguredApiKeyDefinition
} = require('../helpers/bootstrapApiKey')

const apiKeyBootstrapPromises = new Map();

const recoverConfiguredApiKey = async (key) => {
    if (!findConfiguredApiKeyDefinition(key)) return null;

    if (!apiKeyBootstrapPromises.has(key)) {
        apiKeyBootstrapPromises.set(key, ensureApiKey(key).finally(() => {
            apiKeyBootstrapPromises.delete(key);
        }));
    }

    await apiKeyBootstrapPromises.get(key);
    return await findById(key);
};

const apiKey = async (req, res, next) => {
    try {
        const key = req.headers[HEADER.API_KEY]?.toString();
        if (!key) {
            return res.status(403).json({
                status: 'error',
                code: 403,
                errorCode: 'API_KEY_REQUIRED',
                message: 'Forbidden',
                requestId: req.requestId
            })
        }
        // check objKey
        let objKey = await findById(key);
        if (!objKey) {
            objKey = await recoverConfiguredApiKey(key);
        }
        if (!objKey) {
            return res.status(403).json({
                status: 'error',
                code: 403,
                errorCode: 'API_KEY_INVALID',
                message: 'Forbidden',
                requestId: req.requestId
            })
        }

        req.objKey = objKey;
        return next();

    } catch (error) {
        return next(error);
    }
}

const normalizePermissions = (permissions = []) => {
    const normalized = new Set();
    permissions.forEach((perm) => {
        const mapped = LEGACY_PERMISSION_MAP[perm] || perm;
        if (!mapped) return;
        const implied = PERMISSION_IMPLICATIONS[mapped] || [mapped];
        implied.forEach((value) => normalized.add(value));
    });
    return Array.from(normalized);
};

const permission = (requiredPermissions = []) => {
    const requiredList = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
    return (req, res, next) => {
        if (!req.objKey.permissions) {
            return res.status(403).json({
                status: 'error',
                code: 403,
                errorCode: 'API_KEY_PERMISSION_DENIED',
                message: 'Permission denied',
                requestId: req.requestId
            })
        }

        const grantedPermissions = normalizePermissions(req.objKey.permissions);
        const validPermission = requiredList.length === 0 || requiredList.some((perm) => grantedPermissions.includes(perm));
        if (!validPermission) {
            return res.status(403).json({
                status: 'error',
                code: 403,
                errorCode: 'API_KEY_PERMISSION_DENIED',
                message: 'Permission denied',
                requestId: req.requestId
            })
        }
        return next();
    }
}


const asyncHandler = fn => {
    return (req, res, next) => {
        fn(req, res, next).catch(next)
    }
}

module.exports = {
    apiKey,
    permission,
    asyncHandler,
    PERMISSIONS
}
