import { redirect } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { buildAdminHeaders, ensureAdminSession } from '$lib/server/adminAuth.js';

// Hidden from admin by request.
const ADMIN_CHAT_ROOMS_ENABLED = false;

const buildParams = (url) => {
	const params = new URLSearchParams();
	const status = url.searchParams.get('status') || '';
	const q = url.searchParams.get('q');
	const page = url.searchParams.get('page');
	const limit = url.searchParams.get('limit');
	const mine = url.searchParams.get('mine');
	const unreadOnly = url.searchParams.get('unreadOnly');
	if (status) params.set('status', status);
	if (q) params.set('q', q);
	if (page) params.set('page', page);
	if (limit) params.set('limit', limit);
	if (mine && mine !== '0' && mine !== 'false') params.set('mine', mine);
	if (unreadOnly && unreadOnly !== '0' && unreadOnly !== 'false') params.set('unreadOnly', unreadOnly);
	return params;
};

const parsePayload = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const buildReturnTo = (url) => {
	const query = url.searchParams.toString();
	return query ? `${url.pathname}?${query}` : url.pathname;
};

export const load = async ({ fetch, cookies, url }) => {
	if (!ADMIN_CHAT_ROOMS_ENABLED) {
		throw redirect(303, '/admin');
	}

	const session = await ensureAdminSession({ cookies, fetch });
	const headers = buildAdminHeaders(session);
	const params = buildParams(url);
	const response = await fetch(`${API_BASE}/admin/chat-rooms?${params.toString()}`, { headers });

	if (!response.ok) {
		let apiError = 'Failed to load chat rooms.';
		try {
			const payload = await response.json();
			if (payload?.message) apiError = payload.message;
		} catch {
			// ignore
		}
		return {
			rooms: [],
			pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
			filters: {
				status: url.searchParams.get('status') || '',
				q: url.searchParams.get('q') || '',
				mine: ['1', 'true'].includes(String(url.searchParams.get('mine') || '').toLowerCase()),
				unreadOnly: ['1', 'true'].includes(String(url.searchParams.get('unreadOnly') || '').toLowerCase())
			},
			statusCounts: { all: 0, open: 0, handoff: 0, closed: 0 },
			returnTo: buildReturnTo(url),
			apiError,
			currentAdmin: session
		};
	}

	const payload = await parsePayload(response);
	const metadata = payload?.metadata || {};

	return {
		rooms: Array.isArray(metadata.items) ? metadata.items : [],
		pagination: {
			page: metadata?.pagination?.page || 1,
			limit: metadata?.pagination?.limit || 20,
			total: metadata?.pagination?.total || 0,
			totalPages: metadata?.pagination?.totalPages || 1,
			hasPrevPage: Boolean(metadata?.pagination?.hasPrevPage),
			hasNextPage: Boolean(metadata?.pagination?.hasNextPage)
		},
		filters: {
			status: metadata?.filters?.status || '',
			q: metadata?.filters?.q || '',
			mine: Boolean(metadata?.filters?.mine),
			unreadOnly: Boolean(metadata?.filters?.unreadOnly)
		},
		statusCounts: {
			all: metadata?.statusCounts?.all || 0,
			open: metadata?.statusCounts?.open || 0,
			handoff: metadata?.statusCounts?.handoff || 0,
			closed: metadata?.statusCounts?.closed || 0
		},
		returnTo: buildReturnTo(url),
		currentAdmin: session
	};
};
