import { API_BASE } from '$lib/server/api.js';
import {
	buildAdminHeaders,
	getAdminSession,
	refreshAdminSession
} from '$lib/server/adminAuth.js';

const unauthorizedResponse = () =>
	new Response(JSON.stringify({ message: 'Session expired. Please login again.' }), {
		status: 401,
		headers: { 'content-type': 'application/json' }
	});

export const adminApiFetch = async ({ cookies, fetch, path, options = {} }) => {
	let session = getAdminSession(cookies);
	if (!session) {
		await refreshAdminSession({ cookies, fetch });
		session = getAdminSession(cookies);
	}
	if (!session) return unauthorizedResponse();

	const execute = (activeSession) =>
		fetch(`${API_BASE}${path}`, {
			...options,
			headers: {
				...buildAdminHeaders(activeSession),
				...(options.headers || {})
			}
		});

	let response = await execute(session);
	if (![401, 403].includes(response.status)) return response;

	await refreshAdminSession({ cookies, fetch });
	session = getAdminSession(cookies);
	if (!session) return response;
	return execute(session);
};
