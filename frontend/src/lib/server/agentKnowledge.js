import { Buffer } from 'node:buffer';
import { extname } from 'node:path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { API_BASE } from '$lib/server/api.js';

export const ALLOWED_KNOWLEDGE_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.docx', '.xlsx']);
export const MAX_KNOWLEDGE_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_KNOWLEDGE_CONTENT_LENGTH = 110000;
export const DEFAULT_KNOWLEDGE_CATEGORIES = Object.freeze([
	'product_info',
	'manual',
	'warranty_policy',
	'shipping_policy',
	'general_policy'
]);

const CATEGORY_LABELS = {
	vi: {
		product_info: 'Thông tin sản phẩm',
		manual: 'Hướng dẫn sử dụng',
		warranty_policy: 'Chính sách bảo hành',
		shipping_policy: 'Chính sách giao / đổi trả',
		general_policy: 'Chính sách chung'
	},
	en: {
		product_info: 'Product information',
		manual: 'Usage manual',
		warranty_policy: 'Warranty policy',
		shipping_policy: 'Shipping / return policy',
		general_policy: 'General policy'
	}
};

const zeroWidthPattern = /[\u200B-\u200D\uFEFF]/g;
const nbspPattern = /\u00A0/g;

export const safeJson = async (response) => {
	try {
		return await response.json();
	} catch {
		return null;
	}
};

export const normalizeAgentKnowledgeSettings = (payload) => ({
	documents: Array.isArray(payload?.metadata?.documents)
		? payload.metadata.documents
				.map((item) => ({
					id: String(item?.id || '').trim(),
					title: String(item?.title || '').trim(),
					category: String(item?.category || 'general_policy').trim(),
					sourceType: String(item?.sourceType || 'text').trim(),
					sourceName: String(item?.sourceName || '').trim() || null,
					content: String(item?.content || ''),
					updatedAt: item?.updatedAt || null
				}))
				.filter((item) => item.id && item.title && item.content)
		: [],
	categories: Array.isArray(payload?.metadata?.categories)
		? payload.metadata.categories.map((item) => String(item || '').trim()).filter(Boolean)
		: [],
	maxItems: Number(payload?.metadata?.maxItems) || 0,
	updatedAt: payload?.metadata?.updatedAt || null
});

export const getKnowledgeCategoryOptions = (locale = 'vi', categories = DEFAULT_KNOWLEDGE_CATEGORIES) => {
	const labels = locale === 'en' ? CATEGORY_LABELS.en : CATEGORY_LABELS.vi;
	return categories.map((value) => ({
		value,
		label: labels[value] || value
	}));
};

export const buildKnowledgePreview = (value, maxLength = 220) => {
	const text = String(value || '').replace(/\s+/g, ' ').trim();
	if (!text) return '';
	return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
};

export const fetchAgentKnowledgeSettings = async ({ fetch, headers }) => {
	const response = await fetch(`${API_BASE}/site-settings/agent-knowledge`, { headers });
	if (!response.ok) return normalizeAgentKnowledgeSettings(null);
	return normalizeAgentKnowledgeSettings(await safeJson(response));
};

const normalizeWhitespace = (value) =>
	String(value || '')
		.replace(nbspPattern, ' ')
		.replace(zeroWidthPattern, '')
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim();

const clipKnowledgeContent = (content) => {
	if (content.length <= MAX_KNOWLEDGE_CONTENT_LENGTH) return content;
	return `${content.slice(0, MAX_KNOWLEDGE_CONTENT_LENGTH - 55).trim()}\n\n[Nội dung đã được cắt bớt do vượt giới hạn lưu trữ.]`;
};

const normalizeCell = (value) => normalizeWhitespace(value).replace(/\s*\|\s*/g, ' / ');

const isUsefulRow = (row = []) => row.some((cell) => normalizeCell(cell));

const formatRowWithHeaders = (headers, row, rowIndex) => {
	const pairs = headers
		.map((header, index) => {
			const label = normalizeCell(header) || `Cột ${index + 1}`;
			const value = normalizeCell(row[index]);
			return value ? `- ${label}: ${value}` : null;
		})
		.filter(Boolean);

	if (!pairs.length) return null;
	return [`Dòng ${rowIndex}:`, ...pairs].join('\n');
};

const formatRowWithoutHeaders = (row, rowIndex) => {
	const cells = row.map(normalizeCell).filter(Boolean);
	if (!cells.length) return null;
	return `Dòng ${rowIndex}: ${cells.join(' | ')}`;
};

const normalizeWorksheetRows = (sheetName, rows) => {
	const usefulRows = rows.filter((row) => Array.isArray(row) && isUsefulRow(row));
	if (!usefulRows.length) return '';

	const headerRow = usefulRows[0] || [];
	const remainingRows = usefulRows.slice(1);
	const headerLooksStructured = headerRow.filter((cell) => normalizeCell(cell)).length >= 2 && remainingRows.length > 0;
	const formattedRows = (headerLooksStructured ? remainingRows : usefulRows)
		.map((row, index) =>
			headerLooksStructured
				? formatRowWithHeaders(headerRow, row, index + 1)
				: formatRowWithoutHeaders(row, index + 1)
		)
		.filter(Boolean);

	if (!formattedRows.length) return '';

	return [`Sheet: ${sheetName}`, ...formattedRows].join('\n\n');
};

const extractWorkbookText = (buffer, extension) => {
	const workbook = XLSX.read(buffer, {
		type: 'buffer',
		raw: false,
		cellText: true,
		cellDates: true,
		dateNF: 'yyyy-mm-dd'
	});

	const sections = workbook.SheetNames
		.map((sheetName) => {
			const sheet = workbook.Sheets[sheetName];
			const rows = XLSX.utils.sheet_to_json(sheet, {
				header: 1,
				blankrows: false,
				defval: ''
			});
			return normalizeWorksheetRows(sheetName, rows);
		})
		.filter(Boolean);

	if (!sections.length) {
		throw new Error(
			extension === '.csv'
				? 'Không đọc được nội dung CSV. Vui lòng kiểm tra định dạng file.'
				: 'Không đọc được nội dung Excel. Vui lòng kiểm tra file .xlsx.'
		);
	}

	return sections.join('\n\n');
};

const extractDocxText = async (buffer) => {
	const result = await mammoth.extractRawText({ buffer });
	const content = normalizeWhitespace(result.value);
	if (!content) {
		throw new Error('Không đọc được nội dung file Word. Vui lòng kiểm tra file .docx.');
	}
	return content;
};

const extractTextByExtension = async (buffer, extension) => {
	switch (extension) {
		case '.txt':
		case '.md':
			return normalizeWhitespace(buffer.toString('utf8'));
		case '.csv':
		case '.xlsx':
			return extractWorkbookText(buffer, extension);
		case '.docx':
			return extractDocxText(buffer);
		default:
			throw new Error('Định dạng file không được hỗ trợ.');
	}
};

export const readUploadedKnowledgeFile = async (value) => {
	if (!(value instanceof File) || !value.size) {
		return { sourceName: null, content: '' };
	}

	if (value.size > MAX_KNOWLEDGE_FILE_SIZE) {
		throw new Error('Tài liệu quá lớn. Vui lòng gửi file dưới 5MB.');
	}

	const extension = extname(String(value.name || '').toLowerCase());
	if (!ALLOWED_KNOWLEDGE_EXTENSIONS.has(extension)) {
		throw new Error('Chỉ hỗ trợ file .txt, .md, .csv, .docx và .xlsx.');
	}

	const buffer = Buffer.from(await value.arrayBuffer());
	const content = clipKnowledgeContent(await extractTextByExtension(buffer, extension));
	if (!content) {
		throw new Error('Không đọc được nội dung tài liệu.');
	}

	return {
		sourceName: String(value.name || '').trim() || null,
		content
	};
};

export const normalizeKnowledgeTextInput = (value) => clipKnowledgeContent(normalizeWhitespace(value));
