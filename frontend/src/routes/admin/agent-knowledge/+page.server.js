import { randomUUID } from 'node:crypto';
import { fail, redirect } from '@sveltejs/kit';
import { buildAdminHeaders, ensureAdminSession } from '$lib/server/adminAuth.js';
import { setAdminToast } from '$lib/server/adminToast.js';
import {
	DEFAULT_KNOWLEDGE_CATEGORIES,
	buildKnowledgePreview,
	fetchAgentKnowledgeSettings,
	getKnowledgeCategoryOptions,
	normalizeKnowledgeTextInput,
	readUploadedKnowledgeFile,
	safeJson
} from '$lib/server/agentKnowledge.js';
import { API_BASE } from '$lib/server/api.js';
import { getLocaleFromCookies } from '$lib/i18n/admin/server.js';

const canManageKnowledge = (session) => {
	const roles = Array.isArray(session?.roles) ? session.roles : [];
	return roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');
};

const buildCopy = (locale) => ({
	pageTitle: locale === 'en' ? 'AI knowledge base' : 'Kho tri thức AI',
	forbidden:
		locale === 'en'
			? 'You do not have permission to manage agent knowledge.'
			: 'Bạn không có quyền quản lý kho tri thức AI.',
	saveFailed:
		locale === 'en' ? 'Unable to save the knowledge document.' : 'Không thể lưu tài liệu tri thức.',
	deleteFailed:
		locale === 'en'
			? 'Unable to delete the knowledge document.'
			: 'Không thể xóa tài liệu tri thức.',
	missingDocId: locale === 'en' ? 'Missing document id.' : 'Thiếu ID tài liệu.',
	missingContent:
		locale === 'en'
			? 'Please paste content or upload a supported file.'
			: 'Vui lòng dán nội dung hoặc tải lên file hợp lệ.',
	defaultTitle: locale === 'en' ? 'New knowledge document' : 'Tài liệu mới',
	saved: locale === 'en' ? 'Knowledge document saved.' : 'Đã lưu tài liệu tri thức.',
	deleted: locale === 'en' ? 'Knowledge document deleted.' : 'Đã xóa tài liệu tri thức.'
});

export const load = async ({ cookies, fetch }) => {
	const session = await ensureAdminSession({ cookies, fetch });
	if (!session) {
		throw redirect(303, '/admin/login');
	}
	if (!canManageKnowledge(session)) {
		throw redirect(303, '/admin');
	}

	const headers = buildAdminHeaders(session);
	const locale = getLocaleFromCookies(cookies);
	const settings = await fetchAgentKnowledgeSettings({ fetch, headers });

	return {
		currentAdmin: session,
		locale,
		agentKnowledgeSettings: settings,
		knowledgeCategoryOptions: getKnowledgeCategoryOptions(
			locale,
			settings.categories.length ? settings.categories : DEFAULT_KNOWLEDGE_CATEGORIES
		),
		knowledgeDocumentCount: settings.documents.length,
		previewById: Object.fromEntries(
			settings.documents.map((item) => [item.id, buildKnowledgePreview(item.content, 360)])
		)
	};
};

export const actions = {
	saveDocument: async ({ request, cookies, fetch }) => {
		const session = await ensureAdminSession({ cookies, fetch });
		if (!session) {
			throw redirect(303, '/admin/login');
		}

		const locale = getLocaleFromCookies(cookies);
		const copy = buildCopy(locale);
		if (!canManageKnowledge(session)) {
			return fail(403, { error: copy.forbidden });
		}

		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const titleInput = String(form.get('knowledgeTitle') || '').trim();
		const category = String(form.get('knowledgeCategory') || 'general_policy').trim() || 'general_policy';
		const pastedContent = normalizeKnowledgeTextInput(form.get('knowledgeContent'));

		let uploadData;
		try {
			uploadData = await readUploadedKnowledgeFile(form.get('knowledgeFile'));
		} catch (error) {
			return fail(400, { error: String(error?.message || error) });
		}

		const content = uploadData.content || pastedContent;
		if (!content) {
			return fail(400, { error: copy.missingContent });
		}

		const settings = await fetchAgentKnowledgeSettings({ fetch, headers });
		const nextDocuments = [
			...settings.documents,
			{
				id: randomUUID(),
				title:
					titleInput || (uploadData.sourceName ? uploadData.sourceName.replace(/\.[^.]+$/, '') : copy.defaultTitle),
				category,
				sourceType: uploadData.sourceName ? 'file' : 'text',
				sourceName: uploadData.sourceName,
				content
			}
		];

		const response = await fetch(`${API_BASE}/site-settings/agent-knowledge`, {
			method: 'PATCH',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				agentKnowledge: {
					documents: nextDocuments
				}
			})
		});

		if (!response.ok) {
			const payload = await safeJson(response);
			return fail(response.status, {
				error: payload?.message || payload?.metadata?.message || copy.saveFailed
			});
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: copy.saved
		});
		throw redirect(303, '/admin/agent-knowledge');
	},
	deleteDocument: async ({ request, cookies, fetch }) => {
		const session = await ensureAdminSession({ cookies, fetch });
		if (!session) {
			throw redirect(303, '/admin/login');
		}

		const locale = getLocaleFromCookies(cookies);
		const copy = buildCopy(locale);
		if (!canManageKnowledge(session)) {
			return fail(403, { error: copy.forbidden });
		}

		const headers = buildAdminHeaders(session);
		const form = await request.formData();
		const documentId = String(form.get('documentId') || '').trim();
		if (!documentId) {
			return fail(400, { error: copy.missingDocId });
		}

		const settings = await fetchAgentKnowledgeSettings({ fetch, headers });
		const nextDocuments = settings.documents.filter((item) => item.id !== documentId);
		const response = await fetch(`${API_BASE}/site-settings/agent-knowledge`, {
			method: 'PATCH',
			headers: {
				...headers,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				agentKnowledge: {
					documents: nextDocuments
				}
			})
		});

		if (!response.ok) {
			const payload = await safeJson(response);
			return fail(response.status, {
				error: payload?.message || payload?.metadata?.message || copy.deleteFailed
			});
		}

		setAdminToast(cookies, {
			tone: 'success',
			message: copy.deleted
		});
		throw redirect(303, '/admin/agent-knowledge');
	}
};
