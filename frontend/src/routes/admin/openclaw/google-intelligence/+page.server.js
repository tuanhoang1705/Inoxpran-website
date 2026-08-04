import { adminApiFetch } from '$lib/server/adminApi.js';
import { normalizeOpenClawUiError } from '$lib/openclaw/uiError.js';
import { sanitizeOpenClawClientPayload } from '$lib/server/openclawClientPayload.js';

const get = async ({ cookies, fetch, path, fallback }) => {
	try {
		const response = await adminApiFetch({ cookies, fetch, path });
		const payload = await response.json().catch(() => null);
		return {
			data: response.ok ? sanitizeOpenClawClientPayload(payload?.metadata ?? fallback) : fallback,
			error: response.ok
				? null
				: normalizeOpenClawUiError(payload, 'GOOGLE_INTELLIGENCE_LOAD_FAILED', response.headers)
		};
	} catch {
		return {
			data: fallback,
			error: normalizeOpenClawUiError(null, 'GOOGLE_INTELLIGENCE_LOAD_FAILED')
		};
	}
};

export const load = async ({ cookies, fetch }) => {
	const [
		statusResult,
		sourcesResult,
		snapshotsResult,
		scheduleResult,
		executionsResult,
		relatedBlogsResult,
		stylesResult
	] = await Promise.all([
		get({ cookies, fetch, path: '/admin/openclaw/google-intelligence/status', fallback: null }),
		get({
			cookies,
			fetch,
			path: '/admin/openclaw/google-intelligence/sources',
			fallback: { sources: [] }
		}),
		get({
			cookies,
			fetch,
			path: '/admin/openclaw/google-intelligence/snapshots?limit=20',
			fallback: { snapshots: [] }
		}),
		get({ cookies, fetch, path: '/admin/openclaw/google-intelligence/schedule', fallback: null }),
		get({
			cookies,
			fetch,
			path: '/admin/openclaw/google-intelligence/executions?limit=30',
			fallback: { executions: [] }
		}),
		get({
			cookies,
			fetch,
			path: '/admin/openclaw/google-intelligence/related-blogs?limit=30',
			fallback: { blogs: [] }
		}),
		get({
			cookies,
			fetch,
			path: '/admin/openclaw/editorial-styles',
			fallback: { styles: [], recentProfiles: [] }
		})
	]);
	const status = statusResult.data;
	const sources = sourcesResult.data;
	const snapshots = snapshotsResult.data;
	const schedule = scheduleResult.data;
	const executions = executionsResult.data;
	const relatedBlogs = relatedBlogsResult.data;
	const styles = stylesResult.data;
	return {
		status,
		sources: sources.sources || [],
		snapshots: snapshots.snapshots || [],
		schedule,
		executions: executions.executions || [],
		relatedBlogs: relatedBlogs.blogs || [],
		styles: styles.styles || [],
		recentProfiles: styles.recentProfiles || [],
		loadError:
			statusResult.error ||
			(status ? null : normalizeOpenClawUiError(null, 'GOOGLE_INTELLIGENCE_LOAD_FAILED'))
	};
};
