const NAVIGATION_TYPE_KEY = 'inoxpran_last_navigation_type';
const NAVIGATION_TIMESTAMP_KEY = 'inoxpran_last_navigation_timestamp';
const DEFAULT_RECENT_WINDOW_MS = 2500;

const canUseSessionStorage = () => {
	if (typeof window === 'undefined') return false;
	try {
		return typeof window.sessionStorage !== 'undefined';
	} catch {
		return false;
	}
};

const readTimestamp = () => {
	if (!canUseSessionStorage()) return 0;
	const raw = window.sessionStorage.getItem(NAVIGATION_TIMESTAMP_KEY);
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : 0;
};

export const markNavigationType = (type) => {
	if (!canUseSessionStorage()) return;
	const normalizedType = String(type || '').trim();
	if (!normalizedType) return;
	const now = Date.now();
	window.sessionStorage.setItem(NAVIGATION_TYPE_KEY, normalizedType);
	window.sessionStorage.setItem(NAVIGATION_TIMESTAMP_KEY, String(now));
};

export const isRecentNavigationType = (type, maxAgeMs = DEFAULT_RECENT_WINDOW_MS) => {
	if (!canUseSessionStorage()) return false;
	const normalizedType = String(type || '').trim();
	if (!normalizedType) return false;
	const currentType = window.sessionStorage.getItem(NAVIGATION_TYPE_KEY);
	if (currentType !== normalizedType) return false;
	const recordedAt = readTimestamp();
	if (!recordedAt) return false;
	const ageMs = Date.now() - recordedAt;
	return ageMs >= 0 && ageMs <= Math.max(Number(maxAgeMs) || DEFAULT_RECENT_WINDOW_MS, 0);
};
