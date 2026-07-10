import { json } from '@sveltejs/kit';
import { API_BASE } from '$lib/server/api.js';
import { buildAdminHeaders, getAdminSession } from '$lib/server/adminAuth.js';

/**
 * Content-only autosave for an existing blog post. Accepts JSON `{ blog_content }`
 * and forwards it to the backend PATCH /blog/:id as a partial update (no image,
 * no other fields) so drafts can autosave without the full editor form.
 */
export const PATCH = async ({ request, cookies, params, fetch }) => {
	const session = getAdminSession(cookies);
	if (!session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => null);
	const content = typeof body?.blog_content === 'string' ? body.blog_content.trim() : '';
	if (!content) {
		return json({ error: 'Empty content' }, { status: 400 });
	}

	const payload = new FormData();
	payload.set('blog_content', content);

	let response;
	try {
		response = await fetch(`${API_BASE}/blog/${params.postId}`, {
			method: 'PATCH',
			headers: buildAdminHeaders(session),
			body: payload
		});
	} catch {
		return json({ error: 'Cannot reach backend API while autosaving.' }, { status: 502 });
	}

	const data = await response.json().catch(() => null);
	if (!response.ok) {
		return json({ error: data?.message || 'Autosave failed' }, { status: response.status });
	}

	return json({ ok: true, updatedAt: data?.metadata?.updatedAt || new Date().toISOString() });
};
