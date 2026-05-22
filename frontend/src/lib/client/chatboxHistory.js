const CHATBOX_STORAGE_KEY = 'inoxpran_chatbox_guest_v2';
export const CHATBOX_HISTORY_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_STORED_MESSAGES = 120;

const hasLocalStorage = () =>
	typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const safeJsonParse = (value) => {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
};

const generateVisitorId = () =>
	`guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

const normalizeMessage = (message = {}) => {
	const role = new Set(['user', 'agent', 'consultant', 'system']).has(String(message?.role || '').trim())
		? String(message.role).trim()
		: 'system';
	const text = String(message?.text || '').trim();
	if (!text) return null;

	return {
		id: Number(message?.id) || Date.now(),
		serverId: String(message?.serverId || '').trim() || null,
		role,
		text,
		pending: false,
		meta: message?.meta && typeof message.meta === 'object' ? message.meta : null,
		createdAt: message?.createdAt || null
	};
};

const isExpired = (value) => {
	const updatedAt = new Date(value).getTime();
	if (!Number.isFinite(updatedAt)) return true;
	return Date.now() - updatedAt > CHATBOX_HISTORY_RETENTION_MS;
};

export const clearGuestChatState = () => {
	if (!hasLocalStorage()) return;
	window.localStorage.removeItem(CHATBOX_STORAGE_KEY);
};

export const readGuestChatState = () => {
	if (!hasLocalStorage()) return null;
	const raw = String(window.localStorage.getItem(CHATBOX_STORAGE_KEY) || '').trim();
	if (!raw) return null;

	const parsed = safeJsonParse(raw);
	if (!parsed || isExpired(parsed?.updatedAt)) {
		clearGuestChatState();
		return null;
	}

	return {
		visitorId: String(parsed?.visitorId || '').trim() || generateVisitorId(),
		sessionId: String(parsed?.sessionId || '').trim() || '',
		handoffRequested: Boolean(parsed?.handoffRequested),
		lastRemoteMessageAt: String(parsed?.lastRemoteMessageAt || '').trim() || '',
		liveSupport:
			parsed?.liveSupport && typeof parsed.liveSupport === 'object' ? parsed.liveSupport : null,
		customerPresence:
			parsed?.customerPresence && typeof parsed.customerPresence === 'object'
				? parsed.customerPresence
				: null,
		messages: Array.isArray(parsed?.messages)
			? parsed.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_STORED_MESSAGES)
			: []
	};
};

export const writeGuestChatState = (value = {}) => {
	if (!hasLocalStorage()) return;

	const normalized = {
		visitorId: String(value?.visitorId || '').trim() || generateVisitorId(),
		sessionId: String(value?.sessionId || '').trim() || '',
		handoffRequested: Boolean(value?.handoffRequested),
		lastRemoteMessageAt: String(value?.lastRemoteMessageAt || '').trim() || '',
		liveSupport:
			value?.liveSupport && typeof value.liveSupport === 'object' ? value.liveSupport : null,
		customerPresence:
			value?.customerPresence && typeof value.customerPresence === 'object'
				? value.customerPresence
				: null,
		messages: Array.isArray(value?.messages)
			? value.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_STORED_MESSAGES)
			: [],
		updatedAt: new Date().toISOString()
	};

	window.localStorage.setItem(CHATBOX_STORAGE_KEY, JSON.stringify(normalized));
	return normalized;
};
