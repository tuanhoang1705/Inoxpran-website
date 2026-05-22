'use strict'

const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const userModel = require('../models/user.model');
const KeyTokenService = require('./keyToken.service');
const UserToken = require('../models/userToken.model');
const TelemetryService = require('./telemetry.service');
const { sendMail } = require('./mail.service');
const { createTokenPair } = require('../auth/authUtils');
const { findByEmail, findById } = require('../models/repositories/user.repo');
const { BadRequestError, AuthFailureError, ForbiddenError, NotFoundError } = require('../core/error.response');
const { getInfoData, removeUndefinedObject, convertToObjectIdMongodb } = require('../utils');

const RoleUser = {
    USER: 'USER',
    ADMIN: 'ADMIN'
};

const EMAIL_TOKEN_TTL_MINUTES = 60 * 24;
const RESET_TOKEN_TTL_MINUTES = 30;

const normalizeEmail = (email) =>
    typeof email === 'string' ? email.trim().toLowerCase() : '';

const normalizeLocale = (locale) => {
    const value = typeof locale === 'string' ? locale.trim().toLowerCase() : '';
    if (!value) return 'vi';
    if (value.startsWith('en')) return 'en';
    if (value.startsWith('vi')) return 'vi';
    return 'vi';
};

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const hashToken = (token) =>
    crypto.createHash('sha256').update(token).digest('hex');

const getAppBaseUrl = () => {
    const base = process.env.APP_BASE_URL || 'http://localhost:5173';
    return base.replace(/\/$/, '');
};

const createUserToken = async ({ userId, type, ttlMinutes }) => {
    await UserToken.deleteMany({ user: userId, type, usedAt: null });
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    await UserToken.create({
        user: userId,
        token: tokenHash,
        type,
        expiresAt
    });
    return rawToken;
};

const buildTransactionalEmail = ({
    locale,
    subject,
    title,
    preview,
    greeting,
    introLines,
    actionLabel,
    actionUrl,
    actionHint,
    fallbackTitle,
    ignoreLine,
    noteTitle,
    noteLines
}) => {
    const lang = normalizeLocale(locale);
    const safeTitle = escapeHtml(title);
    const safePreview = escapeHtml(preview);
    const safeGreeting = escapeHtml(greeting);
    const safeActionLabel = escapeHtml(actionLabel);
    const safeActionUrl = escapeHtml(actionUrl);
    const safeActionHint = escapeHtml(actionHint);
    const safeFallbackTitle = escapeHtml(fallbackTitle);
    const safeIgnoreLine = escapeHtml(ignoreLine);
    const safeNoteTitle = escapeHtml(noteTitle);
    const htmlIntro = introLines.map((line) => `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.7;">${escapeHtml(line)}</p>`).join('');
    const htmlNotes = noteLines.map((line) => `<li style="margin:0 0 8px;color:#475569;">${escapeHtml(line)}</li>`).join('');
    const text = [
        subject,
        '',
        greeting,
        '',
        ...introLines,
        '',
        `${actionLabel}: ${actionUrl}`,
        actionHint,
        '',
        fallbackTitle,
        actionUrl,
        '',
        noteTitle,
        ...noteLines,
        '',
        ignoreLine,
        '',
        'Inoxpran'
    ].join('\n');

    const html = `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreview}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="padding:18px 24px;background:linear-gradient(135deg,#0f172a,#1e293b);color:#ffffff;">
                <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;opacity:.85;">Inoxpran</div>
                <div style="font-size:22px;font-weight:700;margin-top:6px;line-height:1.35;">${safeTitle}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 14px;color:#0f172a;font-size:15px;line-height:1.7;font-weight:600;">${safeGreeting}</p>
                ${htmlIntro}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 16px;">
                  <tr>
                    <td align="center" style="border-radius:10px;background:#0f172a;">
                      <a href="${safeActionUrl}" style="display:inline-block;padding:12px 18px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">${safeActionLabel}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 16px;color:#64748b;font-size:13px;line-height:1.6;">${safeActionHint}</p>
                <div style="margin:0 0 16px;padding:14px;border:1px dashed #cbd5e1;border-radius:10px;background:#f8fafc;">
                  <div style="margin:0 0 8px;color:#334155;font-size:13px;font-weight:700;">${safeFallbackTitle}</div>
                  <a href="${safeActionUrl}" style="color:#2563eb;text-decoration:none;word-break:break-all;font-size:13px;line-height:1.6;">${safeActionUrl}</a>
                </div>
                <div style="padding:14px 16px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;">
                  <div style="margin:0 0 8px;color:#334155;font-size:13px;font-weight:700;">${safeNoteTitle}</div>
                  <ul style="margin:0 0 0 18px;padding:0;font-size:13px;line-height:1.6;">${htmlNotes}</ul>
                </div>
                <p style="margin:16px 0 0;color:#64748b;font-size:12px;line-height:1.6;">${safeIgnoreLine}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6;">
                Inoxpran | Automated email
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    return { subject, html, text };
};

const getEmailLocale = ({ user, locale }) =>
    normalizeLocale(locale || user?.preferredLocale || user?.locale);

const sendVerificationEmail = async ({ user, token, locale }) => {
    const verifyUrl = `${getAppBaseUrl()}/verify?token=${encodeURIComponent(token)}`;
    const lang = getEmailLocale({ user, locale });
    const displayName = user?.name || (lang === 'en' ? 'there' : 'bạn');

    const copy = lang === 'en'
        ? {
            subject: 'Verify your Inoxpran account',
            title: 'Verify your email address',
            preview: 'Complete your registration and activate your Inoxpran account.',
            greeting: `Hi ${displayName},`,
            introLines: [
                'Thank you for creating an account at Inoxpran.',
                'Please confirm your email address to activate your account and continue using our services.'
            ],
            actionLabel: 'Verify Email',
            actionHint: 'This verification link is valid for 24 hours.',
            fallbackTitle: 'If the button does not work, copy and paste this link into your browser:',
            noteTitle: 'Security notes',
            noteLines: [
                'Do not share this verification link with anyone.',
                'If you did not create an account, no further action is required.'
            ],
            ignoreLine: 'If you did not sign up for Inoxpran, you can safely ignore this email.'
        }
        : {
            subject: 'Xác minh tài khoản Inoxpran',
            title: 'Xác minh địa chỉ email của bạn',
            preview: 'Hoàn tất đăng ký và kích hoạt tài khoản Inoxpran của bạn.',
            greeting: `Xin chào ${displayName},`,
            introLines: [
                'Cảm ơn bạn đã đăng ký tài khoản tại Inoxpran.',
                'Vui lòng xác minh địa chỉ email để kích hoạt tài khoản và tiếp tục sử dụng dịch vụ.'
            ],
            actionLabel: 'Xác minh email',
            actionHint: 'Liên kết xác minh này có hiệu lực trong 24 giờ.',
            fallbackTitle: 'Nếu nút không hoạt động, vui lòng sao chép liên kết sau và mở trong trình duyệt:',
            noteTitle: 'Lưu ý bảo mật',
            noteLines: [
                'Không chia sẻ liên kết xác minh này cho người khác.',
                'Nếu bạn không đăng ký tài khoản, bạn có thể bỏ qua email này.'
            ],
            ignoreLine: 'Nếu bạn không thực hiện đăng ký tại Inoxpran, bạn có thể bỏ qua email này.'
        };

    const message = buildTransactionalEmail({
        locale: lang,
        ...copy,
        actionUrl: verifyUrl
    });

    return sendMail({ to: user.email, ...message });
};

const sendResetPasswordEmail = async ({ user, token, locale }) => {
    const resetUrl = `${getAppBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    const lang = getEmailLocale({ user, locale });
    const displayName = user?.name || (lang === 'en' ? 'there' : 'bạn');

    const copy = lang === 'en'
        ? {
            subject: 'Reset your Inoxpran password',
            title: 'Password reset request',
            preview: 'Use the secure link below to set a new password for your account.',
            greeting: `Hi ${displayName},`,
            introLines: [
                'We received a request to reset the password for your Inoxpran account.',
                'Click the button below to create a new password.'
            ],
            actionLabel: 'Reset Password',
            actionHint: 'This reset link is valid for 30 minutes.',
            fallbackTitle: 'If the button does not work, copy and paste this link into your browser:',
            noteTitle: 'Security notes',
            noteLines: [
                'For your security, this link can only be used once.',
                'If you did not request a password reset, please ignore this email.'
            ],
            ignoreLine: 'If you did not request this action, no changes have been made to your account.'
        }
        : {
            subject: 'Đặt lại mật khẩu Inoxpran',
            title: 'Yêu cầu đặt lại mật khẩu',
            preview: 'Sử dụng liên kết an toàn bên dưới để tạo mật khẩu mới cho tài khoản của bạn.',
            greeting: `Xin chào ${displayName},`,
            introLines: [
                'Chúng tôi đã nhận được yêu cầu đặt lại mật khẩu cho tài khoản Inoxpran của bạn.',
                'Vui lòng bấm vào nút bên dưới để tạo mật khẩu mới.'
            ],
            actionLabel: 'Đặt lại mật khẩu',
            actionHint: 'Liên kết đặt lại mật khẩu này có hiệu lực trong 30 phút.',
            fallbackTitle: 'Nếu nút không hoạt động, vui lòng sao chép liên kết sau và mở trong trình duyệt:',
            noteTitle: 'Lưu ý bảo mật',
            noteLines: [
                'Vì lý do bảo mật, liên kết này chỉ dùng được một lần.',
                'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.'
            ],
            ignoreLine: 'Nếu bạn không thực hiện yêu cầu này, tài khoản của bạn chưa bị thay đổi.'
        };

    const message = buildTransactionalEmail({
        locale: lang,
        ...copy,
        actionUrl: resetUrl
    });

    return sendMail({ to: user.email, ...message });
};

class UserService {
    static signUp = async ({ name, email, password, phone, locale, telemetryContext = null }) => {
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        const normalizedEmail = normalizeEmail(email);
        const sanitizedPassword = typeof password === 'string' ? password : '';
        const normalizedLocale = normalizeLocale(locale);

        if (!normalizedName) throw new BadRequestError('Name is required');
        if (!normalizedEmail) throw new BadRequestError('Email is required');
        if (!/\S+@\S+\.\S+/.test(normalizedEmail)) throw new BadRequestError('Email is invalid');
        if (!sanitizedPassword) throw new BadRequestError('Password is required');
        if (sanitizedPassword.length < 6) throw new BadRequestError('Password must be at least 6 characters');

        const existingUser = await findByEmail({ email: normalizedEmail, select: { _id: 1 } });
        if (existingUser) throw new BadRequestError('User already registered');

        const passwordHash = await bcrypt.hash(sanitizedPassword, 10);

        const newUser = await userModel.create({
            name: normalizedName,
            email: normalizedEmail,
            password: passwordHash,
            phone: typeof phone === 'string' ? phone.trim() : phone,
            preferredLocale: normalizedLocale,
            status: 'inactive',
            roles: [RoleUser.USER]
        });

        if (
            telemetryContext &&
            typeof telemetryContext === 'object' &&
            telemetryContext.analyticsConsent === true
        ) {
            await TelemetryService.mapAnonymousTelemetryToUser({
                userId: newUser._id,
                sessionId: telemetryContext.sessionId,
                ip: telemetryContext.ip,
                userAgent: telemetryContext.userAgent,
                authEvent: 'signup',
                allowIpFallback: true
            }).catch((error) => {
                console.error('[telemetry] signup map failed:', error?.message || error);
            });
        }

        const verificationToken = await createUserToken({
            userId: newUser._id,
            type: 'verify_email',
            ttlMinutes: EMAIL_TOKEN_TTL_MINUTES
        });

        let emailSent = false;
        let emailSendFailed = false;
        try {
            const result = await sendVerificationEmail({ user: newUser, token: verificationToken, locale: normalizedLocale });
            emailSent = Boolean(result && !result.skipped);
        } catch (error) {
            emailSendFailed = true;
            console.error('Failed to send verification email', error?.message || error);
        }

        return {
            user: getInfoData({ fileds: ['_id', 'name', 'email', 'status', 'roles'], object: newUser }),
            emailSent,
            message: emailSent
                ? 'Registration successful. Please verify your email.'
                : emailSendFailed
                    ? 'Registration successful. Failed to send verification email.'
                    : 'Registration successful. Email service is not configured.'
        };
    }

    static login = async ({ email, password, telemetryContext = null }) => {
        const normalizedEmail = normalizeEmail(email);
        const sanitizedPassword = typeof password === 'string' ? password : '';

        if (!normalizedEmail) throw new BadRequestError('Email is required');
        if (!/\S+@\S+\.\S+/.test(normalizedEmail)) throw new BadRequestError('Email is invalid');
        if (!sanitizedPassword) throw new BadRequestError('Password is required');
        if (sanitizedPassword.length < 6) throw new BadRequestError('Password must be at least 6 characters');

        const foundUser = await findByEmail({
            email: normalizedEmail,
            select: {
                _id: 1,
                email: 1,
                password: 1,
                name: 1,
                status: 1,
                roles: 1,
                verify: 1,
                loginCount: 1
            }
        });
        if (!foundUser) throw new BadRequestError('User not registered');
        if (!foundUser.verify) throw new AuthFailureError('Email not verified');
        if (foundUser.status && foundUser.status !== 'active') throw new AuthFailureError('User is inactive');

        const match = await bcrypt.compare(sanitizedPassword, foundUser.password);
        if (!match) throw new AuthFailureError('Authentication error');

        const { _id: userId } = foundUser;
        const preLoginCount = Math.max(Number(foundUser.loginCount) || 0, 0);
        const loginNow = new Date();
        const loginIp =
            telemetryContext && typeof telemetryContext.ip === 'string'
                ? telemetryContext.ip.trim().slice(0, 80)
                : null;
        const loginUserAgent =
            telemetryContext && typeof telemetryContext.userAgent === 'string'
                ? telemetryContext.userAgent.trim().slice(0, 500)
                : null;

        await userModel.updateOne(
            { _id: userId },
            {
                $inc: { loginCount: 1 },
                $set: {
                    lastLoginAt: loginNow,
                    lastLoginIp: loginIp,
                    lastLoginUserAgent: loginUserAgent
                }
            }
        );
        if (preLoginCount <= 0) {
            await userModel
                .updateOne({ _id: userId, firstLoginAt: null }, { $set: { firstLoginAt: loginNow } })
                .catch(() => null);

            if (
                telemetryContext &&
                typeof telemetryContext === 'object' &&
                telemetryContext.analyticsConsent === true
            ) {
                await TelemetryService.mapAnonymousTelemetryToUser({
                    userId,
                    sessionId: telemetryContext.sessionId,
                    ip: telemetryContext.ip,
                    userAgent: telemetryContext.userAgent,
                    authEvent: 'first_login',
                    allowIpFallback: true
                }).catch((error) => {
                    console.error('[telemetry] first-login map failed:', error?.message || error);
                });
            }
        }

        const keyId = crypto.randomBytes(16).toString('hex');
        const privateKey = crypto.randomBytes(64).toString('hex');
        const publicKey = crypto.randomBytes(64).toString('hex');

        const tokens = await createTokenPair({ userId, email: normalizedEmail, keyId }, publicKey, privateKey);
        const savedKey = await KeyTokenService.createKeyToken({
            userId,
            publicKey,
            privateKey,
            refreshToken: tokens.refreshToken,
            userType: 'User',
            keyId
        });
        if (!savedKey) throw new BadRequestError('Key store error');

        return {
            user: getInfoData({ fileds: ['_id', 'name', 'email', 'status', 'roles'], object: foundUser }),
            tokens
        };
    }

    static handlerRefreshTokenV2 = async ({ keyStore, keyPair, user, refreshToken }) => {
        const { userId, email } = user;
        const hasKeyPairs = Array.isArray(keyStore.keys) && keyStore.keys.length > 0;
        const legacyRefreshTokensUsed = keyStore.refreshTokensUsed || [];
        const sessionKey = keyPair || null;
        if (hasKeyPairs && !sessionKey) {
            throw new AuthFailureError('User not registered');
        }
        const refreshTokensUsed = sessionKey?.refreshTokensUsed || legacyRefreshTokensUsed;
        const activeRefreshToken = sessionKey?.refreshToken || keyStore.refreshToken;

        if (refreshTokensUsed.includes(refreshToken)) {
            if (sessionKey?.keyId) {
                await KeyTokenService.removeKeyByKeyId({ keyStoreId: keyStore._id, keyId: sessionKey.keyId });
            } else {
                await KeyTokenService.deleteKeyById(userId);
            }
            throw new ForbiddenError('Something warning happened, please relogin');
        }
        if (!activeRefreshToken || activeRefreshToken !== refreshToken) {
            throw new AuthFailureError('User not registered');
        }

        const foundUser = await findByEmail({ email, select: { _id: 1, email: 1 } });
        if (!foundUser) throw new AuthFailureError('User not registered');

        const newKeyId = sessionKey?.keyId || crypto.randomBytes(16).toString('hex');
        const newPrivateKey = crypto.randomBytes(64).toString('hex');
        const newPublicKey = crypto.randomBytes(64).toString('hex');
        const tokens = await createTokenPair({ userId, email, keyId: newKeyId }, newPublicKey, newPrivateKey);

        if (sessionKey?.keyId) {
            const nextUsed = Array.isArray(refreshTokensUsed)
                ? [...refreshTokensUsed, refreshToken]
                : [refreshToken];
            const keyIndex = Array.isArray(keyStore.keys)
                ? keyStore.keys.findIndex((item) => item.keyId === sessionKey.keyId)
                : -1;
            if (keyIndex === -1) throw new AuthFailureError('User not registered');

            keyStore.keys[keyIndex].publicKey = newPublicKey;
            keyStore.keys[keyIndex].privateKey = newPrivateKey;
            keyStore.keys[keyIndex].refreshToken = tokens.refreshToken;
            keyStore.keys[keyIndex].refreshTokensUsed = nextUsed;
            await keyStore.save();
        } else {
            const nextUsed = Array.isArray(legacyRefreshTokensUsed)
                ? [...legacyRefreshTokensUsed, refreshToken]
                : [refreshToken];
            await keyStore.updateOne({
                $push: {
                    keys: {
                        keyId: newKeyId,
                        publicKey: newPublicKey,
                        privateKey: newPrivateKey,
                        refreshToken: tokens.refreshToken,
                        refreshTokensUsed: nextUsed
                    }
                },
                $addToSet: {
                    refreshTokensUsed: refreshToken
                }
            });
        }
        return {
            user,
            tokens
        };
    }

    static logout = async (keyStore, keyPair, refreshToken) => {
        if (!keyStore?._id) return null;

        if (keyPair?.keyId) {
            const updated = await KeyTokenService.removeKeyByKeyId({
                keyStoreId: keyStore._id,
                keyId: keyPair.keyId
            });
            const remainingKeys = Array.isArray(updated?.keys) ? updated.keys.length : 0;
            if (!remainingKeys && !updated?.refreshToken) {
                await KeyTokenService.removeKeyById(keyStore._id);
            }
            return updated;
        }

        if (refreshToken) {
            if (keyStore.refreshToken === refreshToken) {
                await keyStore.updateOne({ $set: { refreshToken: null } });
            }
            return keyStore;
        }

        const delKey = await KeyTokenService.removeKeyById(keyStore._id);
        return delKey;
    }

    static verifyEmail = async ({ token }) => {
        const normalizedToken = typeof token === 'string' ? token.trim() : '';
        if (!normalizedToken) throw new BadRequestError('Verification token is required');

        const tokenHash = hashToken(normalizedToken);
        const record = await UserToken.findOne({
            token: tokenHash,
            type: 'verify_email',
            usedAt: null,
            expiresAt: { $gt: new Date() }
        });
        if (!record) throw new BadRequestError('Verification token is invalid or expired');

        const user = await userModel.findById(record.user);
        if (!user) throw new NotFoundError('User not found');

        if (!user.verify) {
            user.verify = true;
            user.status = 'active';
            await user.save();
        }

        record.usedAt = new Date();
        await record.save();

        return {
            email: user.email,
            verified: true
        };
    }

    static resendVerification = async ({ email, locale }) => {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) throw new BadRequestError('Email is required');
        if (!/\S+@\S+\.\S+/.test(normalizedEmail)) throw new BadRequestError('Email is invalid');

        const user = await findByEmail({ email: normalizedEmail });
        if (!user) return { message: 'If the email exists, we sent a verification link.' };
        if (user.verify) return { message: 'Email already verified.' };

        const verificationToken = await createUserToken({
            userId: user._id,
            type: 'verify_email',
            ttlMinutes: EMAIL_TOKEN_TTL_MINUTES
        });

        let emailSent = false;
        let emailSendFailed = false;
        try {
            const result = await sendVerificationEmail({ user, token: verificationToken, locale });
            emailSent = Boolean(result && !result.skipped);
        } catch (error) {
            emailSendFailed = true;
            console.error('Failed to resend verification email', error?.message || error);
        }

        return {
            emailSent,
            message: emailSent
                ? 'Verification email sent.'
                : emailSendFailed
                    ? 'Failed to send verification email.'
                    : 'Email service is not configured.'
        };
    }

    static requestPasswordReset = async ({ email, locale }) => {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) throw new BadRequestError('Email is required');
        if (!/\S+@\S+\.\S+/.test(normalizedEmail)) throw new BadRequestError('Email is invalid');

        const user = await findByEmail({ email: normalizedEmail });
        if (!user) {
            return { message: 'If the email exists, we sent a reset link.' };
        }

        const resetToken = await createUserToken({
            userId: user._id,
            type: 'reset_password',
            ttlMinutes: RESET_TOKEN_TTL_MINUTES
        });

        let emailSent = false;
        let emailSendFailed = false;
        try {
            const result = await sendResetPasswordEmail({ user, token: resetToken, locale });
            emailSent = Boolean(result && !result.skipped);
        } catch (error) {
            emailSendFailed = true;
            console.error('Failed to send reset password email', error?.message || error);
        }

        return {
            emailSent,
            message: emailSent
                ? 'Reset instructions sent.'
                : emailSendFailed
                    ? 'Failed to send reset password email.'
                    : 'Email service is not configured.'
        };
    }

    static resetPassword = async ({ token, password }) => {
        const normalizedToken = typeof token === 'string' ? token.trim() : '';
        const sanitizedPassword = typeof password === 'string' ? password : '';
        if (!normalizedToken) throw new BadRequestError('Reset token is required');
        if (!sanitizedPassword) throw new BadRequestError('Password is required');
        if (sanitizedPassword.length < 6) throw new BadRequestError('Password must be at least 6 characters');

        const tokenHash = hashToken(normalizedToken);
        const record = await UserToken.findOne({
            token: tokenHash,
            type: 'reset_password',
            usedAt: null,
            expiresAt: { $gt: new Date() }
        });
        if (!record) throw new BadRequestError('Reset token is invalid or expired');

        const user = await userModel.findById(record.user).select('+password');
        if (!user) throw new NotFoundError('User not found');

        user.password = await bcrypt.hash(sanitizedPassword, 10);
        await user.save();

        record.usedAt = new Date();
        await record.save();

        await KeyTokenService.deleteKeyById(user._id);

        return {
            email: user.email,
            reset: true
        };
    }

    static getProfile = async ({ userId }) => {
        const userObjectId = convertToObjectIdMongodb(userId);
        if (!userObjectId) throw new BadRequestError('Invalid user id');

        const foundUser = await findById({
            userId: userObjectId,
            select: { password: 0 }
        });
        if (!foundUser) throw new NotFoundError('User not found');
        return foundUser;
    }

    static updateProfile = async ({ userId, payload }) => {
        const userObjectId = convertToObjectIdMongodb(userId);
        if (!userObjectId) throw new BadRequestError('Invalid user id');

        const updatePayload = removeUndefinedObject({
            name: typeof payload?.name === 'string' ? payload.name.trim() : undefined,
            phone: typeof payload?.phone === 'string' ? payload.phone.trim() : payload?.phone,
            avatar: typeof payload?.avatar === 'string' ? payload.avatar.trim() : payload?.avatar,
            addresses: Array.isArray(payload?.addresses) ? payload.addresses : undefined
        });

        if (!Object.keys(updatePayload).length) {
            throw new BadRequestError('No valid fields to update');
        }

        const updatedUser = await userModel.findByIdAndUpdate(
            userObjectId,
            updatePayload,
            { new: true }
        ).select({ password: 0 }).lean();

        if (!updatedUser) throw new NotFoundError('User not found');
        return updatedUser;
    }

    static changePassword = async ({ userId, currentPassword, newPassword }) => {
        const userObjectId = convertToObjectIdMongodb(userId);
        if (!userObjectId) throw new BadRequestError('Invalid user id');

        const current = typeof currentPassword === 'string' ? currentPassword : '';
        const nextPassword = typeof newPassword === 'string' ? newPassword : '';

        if (!current || !nextPassword) throw new BadRequestError('Password is required');
        if (nextPassword.length < 6) throw new BadRequestError('Password must be at least 6 characters');
        if (current === nextPassword) throw new BadRequestError('New password must be different');

        const user = await userModel.findById(userObjectId).select('+password');
        if (!user) throw new NotFoundError('User not found');

        const match = await bcrypt.compare(current, user.password);
        if (!match) throw new AuthFailureError('Current password is incorrect');

        user.password = await bcrypt.hash(nextPassword, 10);
        await user.save();

        await KeyTokenService.deleteKeyById(user._id);

        return { changed: true };
    }
}

module.exports = UserService;
