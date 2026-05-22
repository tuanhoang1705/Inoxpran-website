import { env } from '$env/dynamic/private';
import fs from 'node:fs';
import path from 'node:path';
import { API_BASE, API_KEY_HEADER } from '$lib/server/api.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-5.4-nano';
const KNOWLEDGE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_HISTORY_MESSAGES = 6;
const MAX_CONTEXT_DOCUMENTS = 4;
const MAX_CONTEXT_CHARS = 6500;
const MAX_DOCUMENT_SNIPPET_CHARS = 1400;

let knowledgeCache = {
	expiresAt: 0,
	documents: []
};

const readEnvFileValue = (key) => {
	const candidates = [
		path.resolve(process.cwd(), '.env'),
		path.resolve(process.cwd(), '..', '.env')
	];

	try {
		for (const envPath of candidates) {
			if (!fs.existsSync(envPath)) continue;
			const content = fs.readFileSync(envPath, 'utf8');
			for (const line of content.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('#')) continue;
				const [rawKey, ...rest] = trimmed.split('=');
				if (rawKey !== key) continue;
				return rest.join('=').trim().replace(/^['"]|['"]$/g, '').trim();
			}
		}
	} catch {
		return '';
	}

	return '';
};

const readPrivateEnv = (key) => String(env[key] || readEnvFileValue(key) || '').trim();

const KNOWLEDGE_CATEGORY_LABELS = {
	vi: {
		product_info: 'Thông tin sản phẩm',
		manual: 'Hướng dẫn sử dụng',
		warranty_policy: 'Chính sách bảo hành',
		shipping_policy: 'Chính sách giao hàng / đổi trả',
		general_policy: 'Thông tin chung'
	},
	en: {
		product_info: 'Product information',
		manual: 'Usage manual',
		warranty_policy: 'Warranty policy',
		shipping_policy: 'Shipping / return policy',
		general_policy: 'General policy'
	}
};

const normalizeWhitespace = (value) =>
	String(value || '')
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();

const foldText = (value) =>
	normalizeWhitespace(value)
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();

const splitTokens = (value) =>
	Array.from(
		new Set(
			foldText(value)
				.split(/[^a-z0-9]+/g)
				.map((item) => item.trim())
				.filter((item) => item.length >= 2)
		)
	);

const clipText = (value, limit) => {
	const text = normalizeWhitespace(value);
	if (text.length <= limit) return text;
	return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
};

const categoryLabel = (value, locale = 'vi') =>
	KNOWLEDGE_CATEGORY_LABELS[locale]?.[value] || KNOWLEDGE_CATEGORY_LABELS.vi[value] || value;

const buildKnowledgeHeaders = () => {
	const headers = {};
	if (API_KEY_HEADER) headers['x-api-key'] = API_KEY_HEADER;
	return headers;
};

const safeJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

const fetchKnowledgeDocuments = async (fetchFn) => {
	const now = Date.now();
	if (knowledgeCache.expiresAt > now && knowledgeCache.documents.length) {
		return knowledgeCache.documents;
	}

	try {
		const response = await fetchFn(`${API_BASE}/site-settings/agent-knowledge`, {
			headers: buildKnowledgeHeaders()
		});
		if (!response.ok) {
			throw new Error('agent_knowledge_unavailable');
		}

		const payload = await safeJson(response);
		const documents = Array.isArray(payload?.metadata?.documents)
			? payload.metadata.documents
					.map((item) => ({
						id: String(item?.id || '').trim(),
						title: String(item?.title || '').trim(),
						category: String(item?.category || 'general_policy').trim(),
						content: normalizeWhitespace(item?.content || '')
					}))
					.filter((item) => item.id && item.title && item.content)
			: [];

		knowledgeCache = {
			expiresAt: now + KNOWLEDGE_CACHE_TTL_MS,
			documents
		};
		return documents;
	} catch {
		if (knowledgeCache.documents.length) {
			return knowledgeCache.documents;
		}
		throw new Error('agent_knowledge_unavailable');
	}
};

const scoreKnowledgeDocument = ({ document, message, sourcePath, historyText }) => {
	const haystack = foldText([document.title, document.category, document.content].join('\n'));
	const tokens = splitTokens([message, sourcePath, historyText, document.category].join(' '));

	let score = 0;
	for (const token of tokens) {
		if (!token) continue;
		if (haystack.includes(token)) score += token.length > 4 ? 3 : 1;
	}

	const pathKey = foldText(sourcePath);
	if (pathKey && haystack.includes(pathKey)) score += 6;
	const messageKey = foldText(message);
	if (messageKey && haystack.includes(messageKey)) score += 8;
	return score;
};

const selectKnowledgeDocuments = ({ documents, message, sourcePath, history }) => {
	const historyText = Array.isArray(history)
		? history
				.map((item) => String(item?.content || '').trim())
				.filter(Boolean)
				.join('\n')
		: '';

	return documents
		.map((document) => ({
			document,
			score: scoreKnowledgeDocument({ document, message, sourcePath, historyText })
		}))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_CONTEXT_DOCUMENTS)
		.map((item) => item.document);
};

const buildKnowledgeContextBlock = ({ documents, locale = 'vi' }) => {
	if (!documents.length) return '';

	const chunks = [];
	let totalChars = 0;
	for (const document of documents) {
		const snippet = clipText(document.content, MAX_DOCUMENT_SNIPPET_CHARS);
		const block = [
			`[${categoryLabel(document.category, locale)}] ${document.title}`,
			snippet
		].join('\n');
		if (totalChars + block.length > MAX_CONTEXT_CHARS) break;
		chunks.push(block);
		totalChars += block.length;
	}

	if (!chunks.length) return '';
	return chunks.join('\n\n---\n\n');
};

const sanitizeHistory = (history) =>
	(Array.isArray(history) ? history : [])
		.map((item) => ({
			role: item?.role === 'assistant' ? 'assistant' : item?.role === 'user' ? 'user' : '',
			content: clipText(item?.content || '', 1200)
		}))
		.filter((item) => item.role && item.content)
		.slice(-MAX_HISTORY_MESSAGES);

const cleanupOutputText = (text) => {
	return String(text || '')
		.replace(/\*\*/g, '')
		.replace(/[\*_`]/g, '')
		.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
		.replace(/#+\s+/g, '')
		.replace(/^[-•]\s+/gm, '')
		.replace(/\n[-•]\s+/g, '\n')
		.replace(/\s+/g, ' ')
		.trim();
};

const buildSystemPrompt = ({ locale = 'vi', sourcePath, knowledgeContext }) => {
	if (locale === 'en') {
		return [
			'You are Inoxpran customer support.',
			'Answer only questions about Inoxpran products, usage, troubleshooting, warranty, shipping, returns, and policies.',
			'For questions outside Inoxpran scope, politely say you only support Inoxpran-related topics.',
			'Use only the provided information. Never invent product specs, prices, or policies.',
			'If information is incomplete, briefly ask one clarifying question.',
			'Keep answers concise: 1-3 sentences maximum.',
			'Use plain text only. No formatting marks or special characters.',
			knowledgeContext ? `Reference material:\n${knowledgeContext}` : ''
		].filter(Boolean).join('\n\n');
	}

	return [
		'Bạn là nhân viên hỗ trợ khách hàng của Inoxpran. Hãy trò chuyện một cách tự nhiên, như một người bạn thân, không quá trang trọng hay máy móc.',
		'Trả lời NGẮN GỌN và THIẾT THỰC. Tối đa 2-3 câu, không dài dòng.',
		'Khi được hỏi về sản phẩm, hãy cung cấp thông tin CHỈ TIÊU QUAN TRỌNG - không cần liệt kê tất cả thông số nếu chỉ cần một hai cái.',
		'Nói chuyện bình thường, không dùng từng từ khách sáo hay cụm từ "mình có thể hỗ trợ", "được phép", "thực hiện", v.v.',
		'Nếu là sản phẩm Inoxpran, hãy tìm trong dữ liệu và trả lời rõ ràng. Nếu không tìm thấy, nói thẳng "chưa có thông tin" thay vì nói "mình chưa đủ dữ liệu".',
		'Không sử dụng ký hiệu đặc biệt, dấu sao, dấu gạch ngang không cần thiết. Chỉ dùng văn bản sạch sẽ.',
		'Nếu câu hỏi không liên quan đến Inoxpran, nói vui vẻ: "Cảm ơn bạn, nhưng mình chỉ biết về Inoxpran thôi."',
		'Nếu cần thêm thông tin từ khách để trả lời tốt hơn, hỏi tự nhiên chứ không hỏi "xin phép".',
		knowledgeContext ? `Thông tin sản phẩm và chính sách:\n${knowledgeContext}` : ''
	].filter(Boolean).join('\n\n');
};

const extractAssistantReply = (payload) => {
	const rawText = String(payload?.choices?.[0]?.message?.content || '')
		.trim()
		.replace(/\r\n?/g, '\n');
	return cleanupOutputText(rawText);
};

export const generateSupportReply = async ({
	fetch: fetchFn,
	message,
	locale = 'vi',
	sourcePath = '/',
	history = []
}) => {
	const apiKey = readPrivateEnv('OPENAI_API_KEY');
	if (!apiKey) {
		throw new Error('openai_api_key_missing');
	}

	const documents = await fetchKnowledgeDocuments(fetchFn);
	const cleanHistory = sanitizeHistory(history);
	const selectedDocuments = selectKnowledgeDocuments({
		documents,
		message,
		sourcePath,
		history: cleanHistory
	});
	const knowledgeContext = buildKnowledgeContextBlock({
		documents: selectedDocuments,
		locale
	});
	const systemPrompt = buildSystemPrompt({ locale, sourcePath, knowledgeContext });

	const response = await fetch(OPENAI_API_URL, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({
			model: readPrivateEnv('OPENAI_CHAT_MODEL') || DEFAULT_OPENAI_MODEL,
			temperature: 0.1,
			stream: false,
			messages: [
				{ role: 'system', content: systemPrompt },
				...cleanHistory.map((item) => ({
					role: item.role,
					content: item.content
				})),
				{ role: 'user', content: clipText(message, 2000) }
			]
		})
	});

	if (!response.ok) {
		const payload = await safeJson(response);
		throw new Error(payload?.error?.message || 'openai_chat_failed');
	}

	const payload = await safeJson(response);
	const reply = extractAssistantReply(payload);
	if (!reply) {
		throw new Error('openai_empty_reply');
	}

	return {
		reply,
		knowledgeTitles: selectedDocuments.map((item) => item.title)
	};
};
