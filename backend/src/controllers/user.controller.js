'use strict'

const UserService = require('../services/user.service');
const { SuccessResponse, CREATED } = require('../core/success.response');

const TELEMETRY_IP_HEADERS = ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip'];

const readHeader = (req, name) => {
    const value = req.headers?.[name];
    if (Array.isArray(value)) return value[0];
    return value;
};

const resolveClientIp = (req) => {
    for (const header of TELEMETRY_IP_HEADERS) {
        const value = readHeader(req, header);
        if (!value) continue;
        const first = String(value).split(',')[0]?.trim();
        if (first) return first;
    }
    const fallback = req.ip || req.socket?.remoteAddress || null;
    return fallback ? String(fallback) : null;
};

const buildAuthTelemetryContext = (req) => ({
    sessionId:
        req.body?.telemetrySessionId ||
        req.body?.telemetry_session_id ||
        req.body?.sessionId ||
        null,
    analyticsConsent:
        req.body?.telemetryConsentAnalytics === true ||
        req.body?.telemetryConsentAnalytics === 'true' ||
        req.body?.telemetryConsentAnalytics === 1 ||
        req.body?.telemetryConsentAnalytics === '1',
    ip: resolveClientIp(req),
    userAgent: readHeader(req, 'user-agent') || null
});

class UserController {
    signUp = async (req, res, next) => {
        new CREATED({
            message: 'Registered OK!',
            metadata: await UserService.signUp({
                ...req.body,
                telemetryContext: buildAuthTelemetryContext(req)
            })
        }).send(res);
    }

    login = async (req, res, next) => {
        new SuccessResponse({
            message: 'Login success',
            metadata: await UserService.login({
                ...req.body,
                telemetryContext: buildAuthTelemetryContext(req)
            })
        }).send(res);
    }

    logout = async (req, res, next) => {
        new SuccessResponse({
            message: 'Logout success!',
            metadata: await UserService.logout(req.keyStore, req.keyPair, req.refreshToken)
        }).send(res);
    }

    handlerRefreshToken = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get token success!',
            metadata: await UserService.handlerRefreshTokenV2({
                refreshToken: req.refreshToken,
                user: req.user,
                keyStore: req.keyStore,
                keyPair: req.keyPair
            })
        }).send(res);
    }

    getProfile = async (req, res, next) => {
        new SuccessResponse({
            message: 'Get profile success',
            metadata: await UserService.getProfile({ userId: req.user.userId })
        }).send(res);
    }

    updateProfile = async (req, res, next) => {
        new SuccessResponse({
            message: 'Update profile success',
            metadata: await UserService.updateProfile({
                userId: req.user.userId,
                payload: req.body
            })
        }).send(res);
    }

    changePassword = async (req, res, next) => {
        new SuccessResponse({
            message: 'Change password success',
            metadata: await UserService.changePassword({
                userId: req.user.userId,
                currentPassword: req.body.currentPassword,
                newPassword: req.body.newPassword
            })
        }).send(res);
    }

    verifyEmail = async (req, res, next) => {
        new SuccessResponse({
            message: 'Email verified',
            metadata: await UserService.verifyEmail({
                token: req.query.token || req.body.token
            })
        }).send(res);
    }

    resendVerification = async (req, res, next) => {
        new SuccessResponse({
            message: 'Verification email sent',
            metadata: await UserService.resendVerification({
                email: req.body.email,
                locale: req.body.locale
            })
        }).send(res);
    }

    requestPasswordReset = async (req, res, next) => {
        new SuccessResponse({
            message: 'Password reset requested',
            metadata: await UserService.requestPasswordReset({
                email: req.body.email,
                locale: req.body.locale
            })
        }).send(res);
    }

    resetPassword = async (req, res, next) => {
        new SuccessResponse({
            message: 'Password reset success',
            metadata: await UserService.resetPassword({
                token: req.body.token,
                password: req.body.password
            })
        }).send(res);
    }
}

module.exports = new UserController();
