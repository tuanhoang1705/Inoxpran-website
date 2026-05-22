import { writable } from 'svelte/store';

const STORAGE_KEY = 'inoxpran.cookie_consent';
const COOKIE_KEY = 'inoxpran_cookie_consent';
const CONSENT_VERSION = 1;

const createDefaultState = () => ({
	version: CONSENT_VERSION,
	necessary: true,
	analytics: null,
	marketing: false,
	status: 'unknown',
	updatedAt: null,
	hydrated: false
});

const state = writable(createDefaultState());
let initialized = false;

const safeJsonParse = (value) => {
	if (!value) return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
};

const readCookieValue = (name) => {
	if (typeof document === 'undefined') return '';
	const parts = String(document.cookie || '').split(';');
	for (const part of parts) {
		const [rawKey, ...rest] = part.split('=');
		if (String(rawKey || '').trim() !== name) continue;
		return decodeURIComponent(rest.join('=').trim());
	}
	return '';
};

const normalizeConsent = (input) => {
	const base = createDefaultState();
	const source = input && typeof input === 'object' ? input : {};
	const analytics =
		typeof source.analytics === 'boolean'
			? source.analytics
			: source.status === 'accepted_all'
				? true
				: source.status === 'rejected_optional'
					? false
					: null;
	const status =
		typeof source.status === 'string' && source.status.trim()
			? source.status.trim()
			: analytics === true
				? 'accepted_all'
				: analytics === false
					? 'rejected_optional'
					: 'unknown';

	return {
		version: CONSENT_VERSION,
		necessary: true,
		analytics,
		marketing: false,
		status,
		updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
		hydrated: true
	};
};

const persistConsent = (consent) => {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	const serializable = {
		version: CONSENT_VERSION,
		necessary: true,
		analytics: Boolean(consent.analytics),
		marketing: false,
		status: consent.status || (consent.analytics ? 'accepted_all' : 'rejected_optional'),
		updatedAt: consent.updatedAt || new Date().toISOString()
	};
	const encoded = JSON.stringify(serializable);
	try {
		window.localStorage.setItem(STORAGE_KEY, encoded);
	} catch {}

	const secure = window.location?.protocol === 'https:' ? '; Secure' : '';
	document.cookie = `${COOKIE_KEY}=${encodeURIComponent(encoded)}; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax${secure}`;
};

const commitConsent = ({ analytics, status }) => {
	const next = normalizeConsent({
		analytics: Boolean(analytics),
		status,
		updatedAt: new Date().toISOString()
	});
	state.set(next);
	persistConsent(next);
	return next;
};

export const cookieConsent = {
	subscribe: state.subscribe
};

export const initCookieConsent = () => {
	if (typeof window === 'undefined') {
		const serverDefault = createDefaultState();
		state.set(serverDefault);
		return serverDefault;
	}
	if (initialized) {
		let snapshot = createDefaultState();
		state.subscribe((value) => {
			snapshot = value;
		})();
		return snapshot;
	}
	initialized = true;

	let raw = '';
	try {
		raw = String(window.localStorage.getItem(STORAGE_KEY) || '');
	} catch {
		raw = '';
	}
	if (!raw) {
		raw = readCookieValue(COOKIE_KEY);
	}

	const parsed = safeJsonParse(raw);
	const next = parsed ? normalizeConsent(parsed) : { ...createDefaultState(), hydrated: true };
	state.set(next);
	return next;
};

export const acceptAllCookies = () =>
	commitConsent({
		analytics: true,
		status: 'accepted_all'
	});

export const rejectOptionalCookies = () =>
	commitConsent({
		analytics: false,
		status: 'rejected_optional'
	});

export const saveCookiePreferences = ({ analytics } = {}) =>
	commitConsent({
		analytics: Boolean(analytics),
		status: 'customized'
	});

export const resetCookieConsentForDebug = () => {
	initialized = false;
	state.set(createDefaultState());
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	try {
		window.localStorage.removeItem(STORAGE_KEY);
	} catch {}
	document.cookie = `${COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
};

export const canTrackTelemetry = (consent) => Boolean(consent?.analytics === true);
