import { API_BASE } from '$lib/server/api.js';
import { buildUserHeaders } from '$lib/server/userAuth.js';

const DEFAULT_PROFILE_FETCH_TIMEOUT_MS = 900;

const readJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

export const fetchUserProfile = async ({
	fetch,
	session,
	timeoutMs = DEFAULT_PROFILE_FETCH_TIMEOUT_MS
}) => {
	if (!session) {
		return { response: null, payload: null, profile: null, timedOut: false };
	}

	const useTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
	const controller = useTimeout ? new AbortController() : null;
	let didTimeout = false;
	let timer = null;

	if (controller) {
		timer = setTimeout(() => {
			didTimeout = true;
			controller.abort();
		}, timeoutMs);
		timer.unref?.();
	}

	try {
		const response = await fetch(`${API_BASE}/user/profile`, {
			headers: buildUserHeaders(session),
			...(controller ? { signal: controller.signal } : {})
		});
		const payload = await readJson(response);

		return {
			response,
			payload,
			profile: payload?.metadata ?? null,
			timedOut: false
		};
	} catch (error) {
		if (didTimeout && error?.name === 'AbortError') {
			return { response: null, payload: null, profile: null, timedOut: true };
		}
		throw error;
	} finally {
		if (timer) clearTimeout(timer);
	}
};
