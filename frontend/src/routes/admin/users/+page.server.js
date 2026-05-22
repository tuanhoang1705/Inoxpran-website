import { env } from '$env/dynamic/private';
import { fail, redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { getTranslator } from '$lib/i18n/admin/server.js';
import { buildAdminHeaders, ensureAdminSession } from '$lib/server/adminAuth.js';
import { setAdminToast } from '$lib/server/adminToast.js';

const ROOT_ADMIN_EMAILS = new Set(
	String(env.ROOT_ADMIN_EMAILS || 'congtytnhhdaututhangvuong2@gmail.com')
		.split(',')
		.map((value) => String(value || '').trim().toLowerCase())
		.filter(Boolean)
);

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const sanitizeReturnTo = (value, fallback = '/admin/users') => {
	const candidate = String(value || '').trim();
	if (!candidate.startsWith('/admin/users')) return fallback;
	return candidate;
};

const buildReturnTo = (url) => {
	const query = url.searchParams.toString();
	return query ? `${url.pathname}?${query}` : url.pathname;
};

const hasRootAdminAccess = (session) => {
	if (!session) return false;
	const roles = Array.isArray(session.roles) ? session.roles : [];
	if (roles.includes('SUPER_ADMIN')) return true;
	return ROOT_ADMIN_EMAILS.has(String(session.email || '').trim().toLowerCase());
};

const buildUserParams = (url) => {
	const params = new URLSearchParams();
	const requestedLimit = url.searchParams.get('limit') || '20';
	const requestedPage = url.searchParams.get('page') || '1';
	const requestedStatus = url.searchParams.get('status') || '';
	params.set('limit', requestedLimit);
	params.set('page', requestedPage);
	if (requestedStatus) params.set('status', requestedStatus);
	return params;
};

const buildAnonymousParams = (url) => {
	const params = new URLSearchParams();
	const requestedAnonPage = url.searchParams.get('anonPage') || '1';
	const requestedAnonLimit = url.searchParams.get('anonLimit') || '20';
	const requestedAnonMapped = url.searchParams.get('anonMapped') || '';
	params.set('page', requestedAnonPage);
	params.set('limit', requestedAnonLimit);
	if (requestedAnonMapped) params.set('mapped', requestedAnonMapped);
	return params;
};

const buildAdminAccountParams = (url) => {
	const params = new URLSearchParams();
	const requestedPage = url.searchParams.get('adminPage') || '1';
	const requestedLimit = url.searchParams.get('adminLimit') || '10';
	const requestedStatus = url.searchParams.get('adminStatus') || '';
	const requestedQuery = url.searchParams.get('adminQ') || '';
	params.set('page', requestedPage);
	params.set('limit', requestedLimit);
	if (requestedStatus) params.set('status', requestedStatus);
	if (requestedQuery) params.set('q', requestedQuery);
	return params;
};

export const load = async ({ cookies, fetch, url }) => {
	const session = await ensureAdminSession({ cookies, fetch });
	if (!session) {
		throw redirect(303, '/admin/login');
	}
	const headers = buildAdminHeaders(session);
	const t = getTranslator(cookies);
	const canManageAdminAccounts = hasRootAdminAccess(session);
	const returnTo = buildReturnTo(url);

	const userParams = buildUserParams(url);
	const anonymousParams = buildAnonymousParams(url);
	const adminAccountParams = buildAdminAccountParams(url);
	const deleted = url.searchParams.get('deleted') === '1';
	const adminDeleted = url.searchParams.get('adminDeleted') === '1';

	const requests = [
		fetch(`${API_BASE}/admin/users?${userParams.toString()}`, { headers }),
		fetch(`${API_BASE}/admin/anonymous-visitors?${anonymousParams.toString()}`, { headers })
	];

	if (canManageAdminAccounts) {
		requests.push(fetch(`${API_BASE}/admin/admin-accounts?${adminAccountParams.toString()}`, { headers }));
		requests.push(fetch(`${API_BASE}/admin/admin-account-audit-logs?limit=20`, { headers }));
	}

	const [userResponse, anonResponse, adminAccountsResponse, adminAuditLogsResponse] =
		await Promise.all(requests);

	const requestedUserPage = url.searchParams.get('page') || '1';
	const requestedUserLimit = url.searchParams.get('limit') || '20';
	const requestedUserStatus = url.searchParams.get('status') || '';
	const requestedAnonPage = url.searchParams.get('anonPage') || '1';
	const requestedAnonLimit = url.searchParams.get('anonLimit') || '20';
	const requestedAnonMapped = url.searchParams.get('anonMapped') || '';
	const requestedAdminPage = url.searchParams.get('adminPage') || '1';
	const requestedAdminLimit = url.searchParams.get('adminLimit') || '10';
	const requestedAdminStatus = url.searchParams.get('adminStatus') || '';
	const requestedAdminQuery = url.searchParams.get('adminQ') || '';

	const usersFallback = {
		users: [],
		pagination: {
			page: Number(requestedUserPage) || 1,
			limit: Number(requestedUserLimit) || 20,
			total: 0,
			totalPages: 1,
			hasPrevPage: false,
			hasNextPage: false
		},
		filters: { status: requestedUserStatus, sort: 'ctime' }
	};
	const anonymousFallback = {
		anonymousVisitors: [],
		anonymousPagination: {
			page: Number(requestedAnonPage) || 1,
			limit: Number(requestedAnonLimit) || 20,
			total: 0,
			totalPages: 1,
			hasPrevPage: false,
			hasNextPage: false
		},
		anonymousFilters: { mapped: requestedAnonMapped || '' }
	};
	const adminAccountsFallback = {
		adminAccounts: [],
		adminAccountsPagination: {
			page: Number(requestedAdminPage) || 1,
			limit: Number(requestedAdminLimit) || 10,
			total: 0,
			totalPages: 1,
			hasPrevPage: false,
			hasNextPage: false
		},
		adminAccountsFilters: {
			status: requestedAdminStatus || '',
			q: requestedAdminQuery || ''
		}
	};
	const adminAuditLogsFallback = {
		adminAuditLogs: [],
		adminAuditLogsPagination: {
			page: 1,
			limit: 20,
			total: 0,
			totalPages: 1,
			hasPrevPage: false,
			hasNextPage: false
		}
	};

	let usersData = usersFallback;
	let apiError = '';
	if (userResponse.ok) {
		const payload = await parsePayload(userResponse);
		const metadata = payload?.metadata;
		if (Array.isArray(metadata)) {
			usersData = {
				users: metadata,
				pagination: {
					page: Number(requestedUserPage) || 1,
					limit: Number(requestedUserLimit) || 20,
					total: metadata.length,
					totalPages: 1,
					hasPrevPage: false,
					hasNextPage: false
				},
				filters: { status: requestedUserStatus, sort: 'ctime' }
			};
		} else {
			usersData = {
				users: Array.isArray(metadata?.items) ? metadata.items : [],
				pagination: metadata?.pagination || usersFallback.pagination,
				filters: metadata?.filters || usersFallback.filters
			};
		}
	} else {
		apiError = t('admin.users.errors.load');
	}

	let anonymousData = anonymousFallback;
	let anonymousApiError = '';
	if (anonResponse.ok) {
		const anonPayload = await parsePayload(anonResponse);
		const anonMeta = anonPayload?.metadata;
		anonymousData = {
			anonymousVisitors: Array.isArray(anonMeta?.items) ? anonMeta.items : [],
			anonymousPagination: anonMeta?.pagination || anonymousFallback.anonymousPagination,
			anonymousFilters: anonMeta?.filters || anonymousFallback.anonymousFilters
		};
	} else {
		anonymousApiError = t('admin.users.errors.load');
	}

	let adminAccountsData = adminAccountsFallback;
	let adminAccountsApiError = '';
	let adminAuditLogsData = adminAuditLogsFallback;
	let adminAuditLogsApiError = '';
	if (canManageAdminAccounts) {
		if (adminAccountsResponse?.ok) {
			const payload = await parsePayload(adminAccountsResponse);
			const metadata = payload?.metadata;
			adminAccountsData = {
				adminAccounts: Array.isArray(metadata?.items) ? metadata.items : [],
				adminAccountsPagination: metadata?.pagination || adminAccountsFallback.adminAccountsPagination,
				adminAccountsFilters: metadata?.filters || adminAccountsFallback.adminAccountsFilters
			};
		} else {
			adminAccountsApiError = 'Failed to load admin accounts.';
		}

		if (adminAuditLogsResponse?.ok) {
			const payload = await parsePayload(adminAuditLogsResponse);
			const metadata = payload?.metadata;
			adminAuditLogsData = {
				adminAuditLogs: Array.isArray(metadata?.items) ? metadata.items : [],
				adminAuditLogsPagination:
					metadata?.pagination || adminAuditLogsFallback.adminAuditLogsPagination
			};
		} else {
			adminAuditLogsApiError = 'Failed to load admin audit logs.';
		}
	}

	return {
		...usersData,
		...anonymousData,
		...adminAccountsData,
		...adminAuditLogsData,
		canManageAdminAccounts,
		deleted,
		adminDeleted,
		apiError,
		anonymousApiError,
		adminAccountsApiError,
		adminAuditLogsApiError,
		returnTo
	};
};

export const actions = {
	updateAdminAccount: async ({ cookies, fetch, request, url }) => {
		const session = await ensureAdminSession({ cookies, fetch });
		if (!session) {
			throw redirect(303, '/admin/login');
		}
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const adminId = String(form.get('adminId') || '').trim();
		const status = String(form.get('status') || '').trim();
		const roles = form
			.getAll('roles')
			.map((value) => String(value || '').trim())
			.filter(Boolean);
		const returnTo = sanitizeReturnTo(form.get('returnTo'), buildReturnTo(url));

		if (!adminId) {
			const message = 'Missing admin account id.';
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const response = await fetch(`${API_BASE}/admin/admin-accounts/${adminId}`, {
			method: 'PATCH',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				status: status || undefined,
				roles
			})
		});

		if (!response.ok) {
			const payload = await parsePayload(response);
			const message = payload?.message || 'Failed to update admin account.';
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: 'Admin account updated.'
		});
		throw redirect(303, returnTo);
	},
	deleteAdminAccount: async ({ cookies, fetch, request, url }) => {
		const session = await ensureAdminSession({ cookies, fetch });
		if (!session) {
			throw redirect(303, '/admin/login');
		}
		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const adminId = String(form.get('adminId') || '').trim();
		const returnTo = sanitizeReturnTo(form.get('returnTo'), buildReturnTo(url));

		if (!adminId) {
			const message = 'Missing admin account id.';
			return fail(400, { error: message, toast: { tone: 'error', message } });
		}

		const response = await fetch(`${API_BASE}/admin/admin-accounts/${adminId}`, {
			method: 'DELETE',
			headers
		});

		if (!response.ok) {
			const payload = await parsePayload(response);
			const message = payload?.message || 'Failed to delete admin account.';
			return fail(response.status, { error: message, toast: { tone: 'error', message } });
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: 'Admin account deleted.'
		});
		const nextUrl = new URL(returnTo, 'http://localhost');
		nextUrl.searchParams.set('adminDeleted', '1');
		throw redirect(303, `${nextUrl.pathname}${nextUrl.search}`);
	}
};
