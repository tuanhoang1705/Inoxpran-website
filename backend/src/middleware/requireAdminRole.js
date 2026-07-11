'use strict'

const adminModel = require('../models/admin.model');
const { ForbiddenError, NotFoundError } = require('../core/error.response');
const ROOT_ADMIN_EMAILS = new Set(
	String(process.env.ROOT_ADMIN_EMAILS || 'congtytnhhdaututhangvuong2@gmail.com')
		.split(',')
		.map((value) => String(value || '').trim().toLowerCase())
		.filter(Boolean)
);
const resolveEffectiveAdminRoles = (admin) => {
	const roles = new Set(Array.isArray(admin?.roles) ? admin.roles : []);
	if (ROOT_ADMIN_EMAILS.has(String(admin?.email || '').trim().toLowerCase())) {
		roles.add('ADMIN');
		roles.add('SUPER_ADMIN');
	}
	return Array.from(roles);
};

const requireAdminRole = (allowedRoles = []) => {
	const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

	return async (req, res, next) => {
		try {
			const adminId = req.user?.userId;
			if (!adminId) {
				return next(new ForbiddenError('Admin authentication required'));
			}
			const admin = await adminModel.findById(adminId).select('roles email');
			if (!admin) {
				return next(new NotFoundError('Admin not found'));
			}

			const roles = resolveEffectiveAdminRoles(admin);
			const isAllowed =
				allowed.length === 0 || allowed.some((role) => roles.includes(role));
			if (!isAllowed) {
				return next(new ForbiddenError('Insufficient role'));
			}
			req.adminRoles = roles;
			return next();
		} catch (error) {
			return next(error);
		}
	};
};

const requireAdminPermission = (requiredPermissions = [], fallbackRoles = ['ADMIN', 'SUPER_ADMIN']) => {
	const required = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
	const fallback = Array.isArray(fallbackRoles) ? fallbackRoles : [fallbackRoles];
	return async (req, res, next) => {
		try {
			const adminId = req.user?.userId;
			if (!adminId) return next(new ForbiddenError('Admin authentication required'));
			const admin = await adminModel.findById(adminId).select('roles permissions email');
			if (!admin) return next(new NotFoundError('Admin not found'));
			const roles = resolveEffectiveAdminRoles(admin);
			const permissions = Array.isArray(admin.permissions) ? admin.permissions : [];
			const hasPermission = required.length === 0 || required.every((scope) => permissions.includes(scope));
			const hasFallbackRole = fallback.some((role) => roles.includes(role));
			if (!hasPermission && !hasFallbackRole) return next(new ForbiddenError('Insufficient permission'));
			req.adminRoles = roles;
			req.adminPermissions = permissions;
			return next();
		} catch (error) {
			return next(error);
		}
	};
};

module.exports = { requireAdminPermission, requireAdminRole, resolveEffectiveAdminRoles };
