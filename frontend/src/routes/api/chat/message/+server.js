import { json } from '@sveltejs/kit';
import { generateSupportReply } from '$lib/server/openaiSupport.js';
import { callChatPersistenceApi } from '$lib/server/chatPersistenceApi.js';

const noStore = { 'cache-control': 'no-store' };
const defaultLiveSupport = {
	active: false,
	typing: {
		active: false,
		until: null
	}
};
const defaultCustomerPresence = {
	state: 'active'
};
const CUSTOMER_REQUEST_LIMIT = 10;
const CUSTOMER_REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;

const normalizeLocale = (value = 'vi') =>
	String(value || 'vi').trim().toLowerCase() === 'en' ? 'en' : 'vi';

const normalizeFailureCode = (error) => {
	const raw = String(error?.message || '').trim();
	return new Set([
		'openai_api_key_missing',
		'agent_knowledge_unavailable',
		'openai_chat_failed',
		'openai_empty_reply'
	]).has(raw)
		? raw
		: 'chat_message_failed';
};

const buildRateLimitReply = (locale = 'vi') =>
	normalizeLocale(locale) === 'en'
		? 'You have reached the AI chat limit for the last 24 hours. Please continue with a direct consultant for faster support.'
		: 'Anh/chị đã dùng hết 10 lượt hỏi AI trong 24 giờ qua. Vui lòng chuyển sang tư vấn viên trực tiếp để được hỗ trợ tiếp.';

const buildReplyMetadata = ({
	reply,
	knowledgeTitles = [],
	sessionId = null,
	persistedMetadata = null,
	fallback = false,
	limitReached = false,
	rateLimit = null
}) => ({
	reply,
	knowledgeTitles,
	sessionId: persistedMetadata?.sessionId || sessionId || null,
	handoff: {
		requested: persistedMetadata?.status === 'handoff'
	},
	liveSupport: persistedMetadata?.liveSupport || defaultLiveSupport,
	customerPresence: persistedMetadata?.customerPresence || defaultCustomerPresence,
	fallback,
	limitReached,
	rateLimit: rateLimit || {
		limit: CUSTOMER_REQUEST_LIMIT,
		used: 0,
		remaining: CUSTOMER_REQUEST_LIMIT,
		reached: false
	}
});

const persistChatExchange = async ({
	fetch,
	request,
	cookies,
	body,
	sessionId,
	locale,
	sourcePath,
	text,
	reply,
	userMeta,
	assistantMeta
}) => {
	try {
		const { response, payload } = await callChatPersistenceApi({
			fetch,
			request,
			cookies,
			path: '/message',
			method: 'POST',
			body: {
				sessionId: sessionId || null,
				visitorId: body?.visitorId || null,
				telemetrySessionId: body?.telemetrySessionId || null,
				locale,
				sourcePath,
				userText: text,
				assistantText: reply,
				userMeta,
				assistantMeta
			}
		});
		if (response.ok && payload?.metadata) {
			return payload.metadata;
		}
	} catch (error) {
		console.error('[chat-message] persistence failed');
	}

	return null;
};

const isCountedAiRequest = (item) => {
	if (!item || item.role !== 'user') return false;
	const kind = String(item?.meta?.kind || '').trim();
	return !kind || kind === 'ai_request';
};

const buildRateLimitState = (used = 0) => {
	const safeUsed = Math.max(Number(used) || 0, 0);
	const remaining = Math.max(CUSTOMER_REQUEST_LIMIT - safeUsed, 0);
	return {
		limit: CUSTOMER_REQUEST_LIMIT,
		used: safeUsed,
		remaining,
		reached: remaining <= 0
	};
};

const readRecentUsage = async ({ fetch, request, cookies, sessionId }) => {
	if (!sessionId) {
		return buildRateLimitState(0);
	}

	try {
		const after = new Date(Date.now() - CUSTOMER_REQUEST_WINDOW_MS).toISOString();
		const params = new URLSearchParams({
			sessionId,
			after,
			limit: String(CUSTOMER_REQUEST_LIMIT * 4)
		});
		const { response, payload } = await callChatPersistenceApi({
			fetch,
			request,
			cookies,
			path: `/messages?${params.toString()}`,
			method: 'GET'
		});
		if (!response.ok || !Array.isArray(payload?.metadata?.items)) {
			return buildRateLimitState(0);
		}

		const used = payload.metadata.items.filter(isCountedAiRequest).length;
		return buildRateLimitState(used);
	} catch {
		return buildRateLimitState(0);
	}
};

export const POST = async ({ request, fetch, cookies }) => {
	const body = await request.json().catch(() => ({}));
	const text = String(body?.text || '').trim();
	const locale = String(body?.locale || 'vi').trim() || 'vi';
	const sourcePath = String(body?.sourcePath || '/').trim() || '/';
	const history = Array.isArray(body?.history) ? body.history : [];
	const sessionId = String(body?.sessionId || '').trim();

	if (!text) {
		return json(
			{
				ok: false,
				error: 'invalid_payload'
			},
			{ status: 400, headers: { 'cache-control': 'no-store' } }
		);
	}

	const rateLimit = await readRecentUsage({ fetch, request, cookies, sessionId });
	if (rateLimit.reached) {
		const reply = buildRateLimitReply(locale);
		const persistedMetadata = await persistChatExchange({
			fetch,
			request,
			cookies,
			body,
			sessionId,
			locale,
			sourcePath,
			text,
			reply,
			userMeta: {
				kind: 'rate_limited_request',
				rateLimited: true
			},
			assistantMeta: {
				source: 'system',
				kind: 'rate_limit_notice',
				rateLimit
			}
		});

		return json(
			{
				ok: true,
				metadata: buildReplyMetadata({
					reply,
					knowledgeTitles: [],
					sessionId,
					persistedMetadata,
					limitReached: true,
					rateLimit
				})
			},
			{ headers: noStore }
		);
	}

	try {
		const result = await generateSupportReply({
			fetch,
			message: text,
			locale,
			sourcePath,
			history
		});
		const knowledgeTitles = Array.isArray(result.knowledgeTitles) ? result.knowledgeTitles : [];
		const persistedMetadata = await persistChatExchange({
			fetch,
			request,
			cookies,
			body,
			sessionId,
			locale,
			sourcePath,
			text,
			reply: result.reply,
			userMeta: {
				kind: 'ai_request'
			},
			assistantMeta: {
				kind: 'ai_reply',
				knowledgeTitles
			}
		});

		return json(
			{
				ok: true,
				reply: result.reply,
				knowledgeTitles,
				metadata: buildReplyMetadata({
					reply: result.reply,
					knowledgeTitles,
					sessionId,
					persistedMetadata,
					rateLimit: buildRateLimitState(rateLimit.used + 1)
				})
			},
			{ headers: noStore }
		);
	} catch (error) {
		const failureCode = normalizeFailureCode(error);
		console.error(`[chat-message] reply failed: ${failureCode}`);
		return json(
			{
				ok: false,
				error: failureCode
			},
			{
				status: failureCode === 'openai_api_key_missing' ? 503 : 502,
				headers: noStore
			}
		);
	}
};
