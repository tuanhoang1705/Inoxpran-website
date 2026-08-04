<script>
	import { onDestroy, onMount } from 'svelte';
	import { locale } from '$lib/i18n/admin/index.js';
	import { createOpenClawActionIdempotencyManager } from '$lib/openclaw/actionIdempotency.js';
	import { openClawActivityStore } from '$lib/openclaw/activityCenter.js';
	import {
		createRoadmapRegenerationRequestState,
		matchesTrackedRoadmapRegeneration,
		regenerationPhase,
		roadmapPolicy,
		roadmapPollResult,
		shouldReplaceRoadmapItems
	} from '$lib/openclaw/roadmapLifecycle.js';
	import {
		roadmapOutcomeLabel,
		roadmapPolicyLabel,
		roadmapRegenerationErrorLabel,
		roadmapScoreAccepted
	} from '$lib/openclaw/simpleSchedule.js';
	import { createSmartPoller } from '$lib/openclaw/smartPolling.js';

	let { scheduleId, initialPayload = null } = $props();

	const isEn = $derived($locale === 'en');
	// svelte-ignore state_referenced_locally
	let payload = $state(initialPayload);
	let loading = $state(false);
	let actionBusy = $state('');
	let error = $state('');
	let notice = $state('');
	let visibleItemLimit = $state(10);
	let uncertainTransport = $state(false);
	let enqueuePending = $state(false);
	let hadActiveRegeneration = $state(false);
	let trackedRegenerationId = $state('');
	let regenerationActivityKey = $state('');
	let roadmapPoller = null;
	const idempotencyManager = createOpenClawActionIdempotencyManager();
	const regenerationRequestState = createRoadmapRegenerationRequestState();

	const roadmap = $derived(payload?.roadmap || null);
	const items = $derived(Array.isArray(payload?.items) ? payload.items : []);
	const regeneration = $derived(payload?.regeneration || null);
	const lifecycle = $derived(regenerationPhase(regeneration, roadmap));
	const policy = $derived(roadmapPolicy(payload));
	const policyCopy = $derived(roadmapPolicyLabel(policy, isEn));
	const policyAvailable = $derived(
		Number.isFinite(policy.acceptanceScore) && Number.isFinite(policy.minimumNoveltySubtotal)
	);
	const displayedItems = $derived(items.slice(0, visibleItemLimit));
	const scopeMode = $derived(roadmap?.interpretation?.scopeMode || '');
	const summary = $derived(roadmap?.summary || {});
	const sourceSummary = $derived(
		resolveSourceHealth(
			regeneration?.sourceHealth?.length ? regeneration.sourceHealth : roadmap?.sourceHealth,
			regeneration?.sourceSummary || roadmap?.sourceSummary
		)
	);
	const SAFE_OUTCOME_CODES = new Set([
		'ROADMAP_NO_ACCEPTABLE_TOPIC',
		'ROADMAP_NO_READY_TOPIC',
		'ROADMAP_NO_SAFE_TOPIC'
	]);
	const reportedOutcomeCode = $derived(
		regeneration ? regeneration.outcomeCode || '' : roadmap?.lastOutcomeCode || ''
	);
	const reportedFailureCode = $derived(
		regeneration ? regeneration.errorCode || '' : roadmap?.lastErrorCode || ''
	);
	const outcomeCode = $derived(
		reportedOutcomeCode || (SAFE_OUTCOME_CODES.has(reportedFailureCode) ? reportedFailureCode : '')
	);
	const failureCode = $derived(
		SAFE_OUTCOME_CODES.has(reportedFailureCode) ? '' : reportedFailureCode
	);
	const outcomeMessage = $derived(roadmapOutcomeLabel(outcomeCode, isEn, policy));
	const failureMessage = $derived(roadmapRegenerationErrorLabel(failureCode, isEn));
	const sourceFailure = $derived(
		[
			'ROADMAP_INTELLIGENCE_UNAVAILABLE',
			'ROADMAP_REQUIRED_EVIDENCE_UNAVAILABLE',
			'ROADMAP_SCORE_UNREACHABLE'
		].includes(failureCode)
	);
	const operationalFailureMessage = $derived(sourceFailure ? '' : failureMessage);
	const regenerationActive = $derived(lifecycle.active);
	const regenerateDisabled = $derived(Boolean(actionBusy) || regenerationActive || enqueuePending);

	const t = $derived({
		title: isEn ? 'Topic roadmap' : 'Kế hoạch chủ đề',
		subtitle: isEn
			? 'A rolling research-backed queue. The next run chooses from ready ideas automatically.'
			: 'Hàng đợi chủ đề liên tục dựa trên nghiên cứu. Lần chạy kế tiếp sẽ tự chọn trong các ý tưởng sẵn sàng.',
		refresh: isEn ? 'Refresh' : 'Tải lại',
		regenerate: isEn ? 'Research & regenerate' : 'Nghiên cứu & sinh lại',
		regenerating: isEn ? 'Researching…' : 'Đang nghiên cứu…',
		researchAgain: isEn ? 'Research again' : 'Nghiên cứu lại',
		recoverRequest: isEn ? 'Recover request' : 'Khôi phục yêu cầu',
		generateNow: isEn ? 'Generate now' : 'Sinh kế hoạch ngay',
		loading: isEn ? 'Loading topic roadmap…' : 'Đang tải kế hoạch chủ đề…',
		retry: isEn ? 'Try again' : 'Thử lại',
		notInitialized: isEn ? 'Roadmap not initialized' : 'Chưa khởi tạo kế hoạch',
		notInitializedHint: isEn
			? 'OpenClaw will research and build it on the first schedule run. You can generate it now without running the schedule.'
			: 'OpenClaw sẽ nghiên cứu và tạo kế hoạch ở lần chạy lịch đầu tiên. Bạn cũng có thể sinh ngay mà không cần chạy lịch.',
		empty: isEn ? 'No roadmap ideas are available yet.' : 'Chưa có ý tưởng nào trong kế hoạch.',
		emptyHint: isEn
			? 'Research may be queued or only partially complete. Refresh shortly or regenerate the roadmap.'
			: 'Nghiên cứu có thể đang chờ hoặc mới hoàn tất một phần. Hãy tải lại sau hoặc sinh lại kế hoạch.',
		goal: isEn ? 'Interpreted goal' : 'Mục tiêu đã hiểu',
		focus: isEn ? 'Focus' : 'Trọng tâm',
		ready: isEn ? 'Ready' : 'Sẵn sàng',
		claimed: isEn ? 'In progress' : 'Đang thực hiện',
		completed: isEn ? 'Completed' : 'Đã hoàn tất',
		dismissed: isEn ? 'Dismissed' : 'Đã loại',
		failed: isEn ? 'Failed' : 'Lỗi',
		lastResearch: isEn ? 'Last research' : 'Nghiên cứu gần nhất',
		sourceStatus: isEn ? 'Source status' : 'Trạng thái nguồn',
		category: isEn ? 'Category' : 'Danh mục',
		intent: isEn ? 'Intent' : 'Ý định tìm kiếm',
		articleType: isEn ? 'Article type' : 'Kiểu bài',
		productScope: isEn ? 'Product scope' : 'Phạm vi sản phẩm',
		products: isEn ? 'Product evidence' : 'Sản phẩm đối chiếu',
		marketSources: isEn ? 'Research sources' : 'Nguồn nghiên cứu',
		freshness: isEn ? 'Observed' : 'Ghi nhận',
		score: isEn ? 'Score' : 'Điểm',
		reason: isEn ? 'Reason' : 'Lý do',
		dismiss: isEn ? 'Dismiss idea' : 'Loại ý tưởng',
		dismissing: isEn ? 'Dismissing…' : 'Đang loại…',
		dismissedNotice: isEn ? 'Idea dismissed.' : 'Đã loại ý tưởng.',
		regeneratedNotice: isEn
			? 'Research was queued. The active roadmap stays available until a replacement is committed.'
			: 'Đã xếp hàng nghiên cứu. Kế hoạch hiện tại vẫn dùng được đến khi bản thay thế được áp dụng.',
		queued: isEn ? 'Research is queued.' : 'Nghiên cứu đang chờ xử lý.',
		researching: isEn ? 'Researching replacement topics…' : 'Đang nghiên cứu chủ đề thay thế…',
		committing: isEn ? 'Committing the replacement…' : 'Đang áp dụng kế hoạch thay thế…',
		completedReplacement: isEn
			? 'Replacement committed. The active topic queue has been refreshed.'
			: 'Đã áp dụng kế hoạch thay thế. Hàng đợi chủ đề đang hoạt động đã được cập nhật.',
		noChange: isEn
			? 'Research completed with no safe replacement. The previous roadmap remains active.'
			: 'Đã nghiên cứu nhưng chưa có bản thay thế an toàn. Kế hoạch cũ vẫn hoạt động.',
		superseded: isEn
			? 'This research request was superseded. The active roadmap was not replaced.'
			: 'Yêu cầu nghiên cứu này đã được thay thế. Kế hoạch đang hoạt động không bị đổi.',
		cancelled: isEn
			? 'This research request was cancelled. The active roadmap was not replaced.'
			: 'Yêu cầu nghiên cứu này đã bị huỷ. Kế hoạch đang hoạt động không bị đổi.',
		failedRegeneration: isEn
			? 'Replacement research failed. The previous roadmap remains active.'
			: 'Nghiên cứu thay thế thất bại. Kế hoạch cũ vẫn hoạt động.',
		uncertain: isEn
			? 'Delivery was not confirmed. Recover with the same request key before starting a new request.'
			: 'Chưa xác nhận được việc gửi yêu cầu. Hãy khôi phục bằng cùng mã trước khi tạo yêu cầu mới.',
		partial: isEn
			? 'Some sources are unavailable. Available evidence is shown below.'
			: 'Một số nguồn chưa sẵn sàng. Các bằng chứng hiện có vẫn được hiển thị bên dưới.',
		reference: isEn ? 'Reference' : 'Mã tra cứu',
		evidenceDetails: isEn ? 'Evidence and score details' : 'Bằng chứng và chi tiết điểm',
		novelty: isEn ? 'Novelty' : 'Độ mới',
		accepted: isEn ? 'Accepted' : 'Đạt chuẩn',
		researchRequired: isEn ? 'Research required' : 'Cần nghiên cứu lại',
		showMore: isEn ? 'Show more ideas' : 'Hiển thị thêm ý tưởng'
	});

	const resolveAdminPath = (path) => {
		if (typeof window === 'undefined' || window.location.hostname !== 'admin.inoxpran.com') {
			return path;
		}
		return path.replace(/^\/admin(?=\/|$)/, '') || '/';
	};

	const request = async (path, options = {}) => {
		let response;
		try {
			response = await fetch(resolveAdminPath(path), {
				...options,
				headers: {
					...(options.body ? { 'content-type': 'application/json' } : {}),
					...(options.headers || {})
				}
			});
		} catch (cause) {
			throw Object.assign(
				new Error(isEn ? 'The request could not be delivered.' : 'Không thể gửi yêu cầu.'),
				{
					code: 'OPENCLAW_BACKEND_UNAVAILABLE',
					status: 0,
					cause
				}
			);
		}
		const body = await response.json().catch(() => null);
		if (!response.ok) {
			throw Object.assign(
				new Error(body?.error || (isEn ? 'The request failed.' : 'Yêu cầu không thành công.')),
				{
					code: body?.errorCode || '',
					outcomeCode: body?.outcomeCode || '',
					requestId: String(body?.requestId || ''),
					status: response.status
				}
			);
		}
		return body;
	};

	const requestErrorText = (caught) => {
		const message = String(caught?.message || caught).slice(0, 260);
		const requestId = String(caught?.requestId || '').slice(0, 128);
		return requestId ? `${message} · ${t.reference}: ${requestId}` : message;
	};

	const roadmapPath = () =>
		`/admin/api/openclaw/blog-schedules/${encodeURIComponent(scheduleId)}/roadmap`;

	const isRoadmapResponse = (body) =>
		Boolean(body) &&
		typeof body === 'object' &&
		Object.prototype.hasOwnProperty.call(body, 'roadmap') &&
		Array.isArray(body.items);

	const applyResponse = (body, { preserveItemsWhileActive = true } = {}) => {
		if (!isRoadmapResponse(body)) return false;
		const replaceItems =
			!preserveItemsWhileActive ||
			shouldReplaceRoadmapItems(payload, body) ||
			!Array.isArray(payload?.items);
		payload = {
			...body,
			roadmap: body.roadmap ?? null,
			items: replaceItems ? body.items : payload.items,
			regeneration: body.regeneration ?? null
		};
		return true;
	};

	const lifecycleNotice = (phase) => {
		if (phase === 'queued') return t.queued;
		if (phase === 'researching') return t.researching;
		if (phase === 'committing') return t.committing;
		if (phase === 'completed') return t.completedReplacement;
		if (phase === 'no_change') return t.noChange;
		if (phase === 'superseded') return t.superseded;
		if (phase === 'cancelled') return t.cancelled;
		if (phase === 'failed') return failureMessage || t.failedRegeneration;
		return '';
	};

	const activityKeyFor = () => `blog-roadmap:${scheduleId}:regenerate`;

	const syncRegenerationActivity = (nextRegeneration, nextRoadmap, { force = false } = {}) => {
		if (!nextRegeneration?.id) return;
		const nextRegenerationId = String(nextRegeneration.id);
		if (
			!force &&
			uncertainTransport &&
			(!trackedRegenerationId || nextRegenerationId !== trackedRegenerationId)
		) {
			return;
		}
		const nextLifecycle = regenerationPhase(nextRegeneration, nextRoadmap);
		trackedRegenerationId = nextRegenerationId;
		regenerationActivityKey = activityKeyFor();
		openClawActivityStore.upsert({
			key: regenerationActivityKey,
			domain: 'blog-roadmap',
			entityId: scheduleId,
			runId: trackedRegenerationId,
			action: 'regenerate',
			title: t.regenerate,
			status: nextLifecycle.active
				? 'running'
				: nextLifecycle.phase === 'failed'
					? 'failed'
					: 'succeeded',
			rawStatus: nextLifecycle.phase,
			message:
				nextLifecycle.phase === 'failed'
					? roadmapRegenerationErrorLabel(nextRegeneration.errorCode, isEn) || t.failedRegeneration
					: lifecycleNotice(nextLifecycle.phase)
		});
	};

	const loadRoadmap = async (options = {}) => {
		const keepNotice = options?.keepNotice === true;
		const signal = options?.signal;
		if (!scheduleId || loading) return null;
		loading = true;
		error = '';
		if (!keepNotice) notice = '';
		try {
			const body = await request(roadmapPath(), { signal });
			applyResponse(body);
			syncRegenerationActivity(body.regeneration, body.roadmap);
			return body;
		} catch (caught) {
			error = requestErrorText(caught);
			return null;
		} finally {
			loading = false;
		}
	};

	const pollRoadmap = async ({ signal }) => {
		const body = await request(roadmapPath(), { signal });
		applyResponse(body);
		syncRegenerationActivity(body.regeneration, body.roadmap);
		return roadmapPollResult(body);
	};

	const beginPendingRoadmapActivity = () => {
		regenerationActivityKey = activityKeyFor();
		openClawActivityStore.upsert({
			key: regenerationActivityKey,
			domain: 'blog-roadmap',
			entityId: scheduleId,
			action: 'regenerate',
			title: t.regenerate,
			status: 'running',
			rawStatus: 'submitting',
			message: isEn ? 'Submitting research request…' : 'Đang gửi yêu cầu nghiên cứu…'
		});
	};

	const beginRoadmapActivity = (action, title) => {
		const key = `blog-roadmap:${scheduleId}:${action}:${Date.now()}`;
		openClawActivityStore.upsert({
			key,
			domain: 'blog-roadmap',
			entityId: scheduleId,
			action,
			title,
			status: 'running',
			message: isEn ? 'Request in progress…' : 'Đang xử lý yêu cầu…'
		});
		return key;
	};

	const clearRegenerationRequest = (idempotencyKey = '') => {
		regenerationRequestState.clear(scheduleId);
		const retainedKey =
			idempotencyKey ||
			idempotencyManager.acquire({
				action: 'roadmap-regenerate',
				profile: String(scheduleId)
			});
		idempotencyManager.clear({
			action: 'roadmap-regenerate',
			profile: String(scheduleId),
			key: retainedKey
		});
	};

	const submitRegeneration = async ({ recover = false } = {}) => {
		if (
			!scheduleId ||
			actionBusy ||
			(regenerationActive && !recover) ||
			(enqueuePending && !recover)
		) {
			return;
		}
		actionBusy = 'regenerate';
		enqueuePending = true;
		error = '';
		notice = '';
		if (!recover) {
			uncertainTransport = false;
			trackedRegenerationId = '';
		}
		const idempotencyKey = idempotencyManager.acquire({
			action: 'roadmap-regenerate',
			profile: String(scheduleId)
		});
		beginPendingRoadmapActivity();
		try {
			const body = await request(`${roadmapPath()}/regenerate`, {
				method: 'POST',
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({ reason: 'manager_requested_refresh' })
			});
			trackedRegenerationId = String(body?.regeneration?.id || '');
			uncertainTransport = false;
			const confirmedLifecycle = regenerationPhase(body?.regeneration, roadmap);
			enqueuePending = confirmedLifecycle.active;
			hadActiveRegeneration = confirmedLifecycle.active;
			if (confirmedLifecycle.active) {
				regenerationRequestState.write(scheduleId, {
					pending: true,
					uncertain: false,
					regenerationId: trackedRegenerationId
				});
				notice = t.regeneratedNotice;
			} else {
				clearRegenerationRequest(idempotencyKey);
				notice = lifecycleNotice(confirmedLifecycle.phase);
			}
			syncRegenerationActivity(body.regeneration, roadmap, { force: true });
			roadmapPoller?.poke('regeneration-confirmed');
		} catch (caught) {
			const uncertain =
				Number(caught?.status || 0) === 0 ||
				Number(caught?.status || 0) >= 500 ||
				['OPENCLAW_BACKEND_TIMEOUT', 'OPENCLAW_BACKEND_UNAVAILABLE'].includes(caught?.code);
			uncertainTransport = uncertain;
			enqueuePending = uncertain;
			if (uncertain) {
				regenerationRequestState.write(scheduleId, {
					pending: true,
					uncertain: true,
					regenerationId: trackedRegenerationId
				});
			}
			error = uncertain ? `${requestErrorText(caught)} ${t.uncertain}` : requestErrorText(caught);
			if (!uncertain) {
				clearRegenerationRequest(idempotencyKey);
				openClawActivityStore.upsert({
					key: regenerationActivityKey,
					status: 'failed',
					rawStatus: 'failed',
					message: error
				});
			} else {
				openClawActivityStore.upsert({
					key: regenerationActivityKey,
					status: 'running',
					rawStatus: 'delivery_uncertain',
					message: t.uncertain
				});
				roadmapPoller?.poke('delivery-uncertain');
			}
		} finally {
			actionBusy = '';
		}
	};

	const regenerateRoadmap = () => submitRegeneration({ recover: false });
	const recoverRegeneration = () => submitRegeneration({ recover: true });

	const dismissItem = async (item) => {
		if (!item?.id || actionBusy) return;
		actionBusy = `dismiss:${item.id}`;
		error = '';
		notice = '';
		const activityKey = beginRoadmapActivity('dismiss', t.dismiss);
		try {
			const body = await request(`${roadmapPath()}/items/${encodeURIComponent(item.id)}/dismiss`, {
				method: 'POST',
				body: JSON.stringify({ reason: 'manager_dismissed' })
			});
			notice = t.dismissedNotice;
			openClawActivityStore.upsert({
				key: activityKey,
				status: 'succeeded',
				rawStatus: 'completed',
				message: t.dismissedNotice
			});
			if (!applyResponse(body)) await loadRoadmap({ keepNotice: true });
		} catch (caught) {
			error = requestErrorText(caught);
			if (
				openClawActivityStore.find((activity) => activity.key === activityKey)?.status === 'running'
			) {
				openClawActivityStore.upsert({
					key: activityKey,
					status: 'failed',
					rawStatus: 'failed',
					message: error
				});
			}
		} finally {
			actionBusy = '';
		}
	};

	const formatDateTime = (value) => {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return new Intl.DateTimeFormat(isEn ? 'en-GB' : 'vi-VN', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	};

	const scoreText = (score) => {
		const value = Number(score);
		if (!Number.isFinite(value)) return '—';
		return value <= 1 ? `${Math.round(value * 100)}%` : `${Math.round(value)}`;
	};

	const scopeLabel = (mode) => {
		if (mode === 'narrow') return isEn ? 'Narrow' : 'Hẹp';
		if (mode === 'hybrid' || mode === 'combined' || mode === 'mixed') {
			return isEn ? 'Combined' : 'Kết hợp';
		}
		return isEn ? 'Broad' : 'Rộng';
	};

	const statusLabel = (status) => {
		const labels = {
			ready: { vi: 'Sẵn sàng', en: 'Ready' },
			claimed: { vi: 'Đang thực hiện', en: 'In progress' },
			completed: { vi: 'Đã hoàn tất', en: 'Completed' },
			dismissed: { vi: 'Đã loại', en: 'Dismissed' },
			failed: { vi: 'Lỗi', en: 'Failed' },
			queued: { vi: 'Đang chờ', en: 'Queued' },
			generating: { vi: 'Đang nghiên cứu', en: 'Researching' }
		};
		const entry = labels[String(status || '')];
		return entry ? (isEn ? entry.en : entry.vi) : status || '—';
	};

	const statusTone = (status) => {
		if (status === 'ready' || status === 'completed') return 'good';
		if (status === 'failed') return 'danger';
		if (status === 'claimed' || status === 'generating') return 'active';
		return 'muted';
	};

	const sourceStatusLabel = (status) => {
		const value = String(status || '').toLowerCase();
		const labels = {
			available: { vi: 'Sẵn sàng', en: 'Available' },
			fresh: { vi: 'Mới', en: 'Fresh' },
			healthy: { vi: 'Ổn định', en: 'Healthy' },
			ok: { vi: 'Ổn định', en: 'Healthy' },
			partial: { vi: 'Một phần', en: 'Partial' },
			degraded: { vi: 'Suy giảm', en: 'Degraded' },
			stale: { vi: 'Cũ', en: 'Stale' },
			unavailable: { vi: 'Chưa sẵn sàng', en: 'Unavailable' },
			failed: { vi: 'Lỗi', en: 'Failed' },
			error: { vi: 'Lỗi', en: 'Error' }
		};
		const entry = labels[value];
		return entry ? (isEn ? entry.en : entry.vi) : String(status || '—');
	};

	const sourceDomain = (source) => {
		try {
			const url = new URL(String(source?.canonicalUrl || ''));
			if (url.username || url.password) return '';
			return url.hostname.replace(/^www\./, '');
		} catch {
			return String(source?.sourceDomain || '').trim();
		}
	};

	const sourceName = (source) =>
		String(
			source?.sourceName ||
				source?.name ||
				source?.sourceId ||
				source?.sourceType ||
				source?.source ||
				sourceDomain(source) ||
				''
		)
			.replaceAll('_', ' ')
			.trim();

	const sourceDate = (source) => source?.observedAt || source?.fetchedAt || source?.checkedAt;

	const scoreAccepted = (item) => roadmapScoreAccepted(item, policy);

	const CREDENTIAL_QUERY_KEY =
		/(?:^|[_-])(?:token|access[_-]?token|auth|authorization|api[_-]?key|secret|password|credential|sig|signature)(?:$|[_-])|^(?:token|auth|secret|password|credential|sig)$/i;

	const safeExternalUrl = (value) => {
		try {
			const url = new URL(String(value || ''));
			if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
			// A persisted market-source URL may still carry a credential-like query
			// parameter (e.g. ?access_token=…). Rendering it as a clickable anchor would
			// leak that value to the destination, browser history, and referrer, so we
			// drop those keys before surfacing the link.
			for (const key of [...url.searchParams.keys()]) {
				if (CREDENTIAL_QUERY_KEY.test(key)) url.searchParams.delete(key);
			}
			return url.toString();
		} catch {
			return '';
		}
	};

	function resolveSourceHealth(value, summaryValue = null) {
		const entries = Array.isArray(value)
			? value
			: value && typeof value === 'object'
				? Object.entries(value).map(([source, health]) =>
						health && typeof health === 'object'
							? { source, ...health }
							: { source, status: health }
					)
				: [];
		const explicitPartial = summaryValue?.partial === true;
		const unavailable = entries.filter((entry) => {
			const status = String(entry?.status || entry?.freshness || '').toLowerCase();
			return ['partial', 'failed', 'unavailable', 'stale', 'degraded', 'error'].includes(status);
		});
		const labels = entries
			.slice(0, 4)
			.map(
				(entry) =>
					`${sourceName(entry) || 'Source'}: ${sourceStatusLabel(entry?.status || entry?.freshness)}`
			);
		return {
			entries,
			// Prefer the API aggregate when provided. The current safe view exposes
			// bounded source entries, so derive only from those entries as a legacy
			// fallback—never from roadmap outcome or error fields.
			partial: summaryValue ? explicitPartial : unavailable.length > 0,
			label: labels.length
				? labels.join(' · ')
				: isEn
					? 'No source health reported'
					: 'Chưa có báo cáo trạng thái nguồn'
		};
	}

	onMount(() => {
		const retainedRequest = regenerationRequestState.read(scheduleId);
		if (retainedRequest?.pending) {
			enqueuePending = true;
			uncertainTransport = retainedRequest.uncertain;
			trackedRegenerationId = retainedRequest.regenerationId;
			hadActiveRegeneration = !retainedRequest.uncertain;
		}
		roadmapPoller = createSmartPoller({
			poll: pollRoadmap,
			activeIntervalMs: 3000,
			idleIntervalMs: 30000,
			onResult: ({ payload: nextPayload }) => {
				const nextRegeneration = nextPayload?.regeneration;
				const nextLifecycle = regenerationPhase(nextRegeneration, nextPayload?.roadmap);
				const nextRegenerationId = String(nextRegeneration?.id || '');
				const matchesTrackedRequest = matchesTrackedRoadmapRegeneration(
					trackedRegenerationId,
					nextRegenerationId
				);
				if (uncertainTransport && matchesTrackedRequest) {
					uncertainTransport = false;
					hadActiveRegeneration = nextLifecycle.active;
					notice = lifecycleNotice(nextLifecycle.phase);
					if (nextLifecycle.active) {
						regenerationRequestState.write(scheduleId, {
							pending: true,
							uncertain: false,
							regenerationId: trackedRegenerationId
						});
					} else if (nextLifecycle.terminal) {
						enqueuePending = false;
						clearRegenerationRequest();
					}
				}
				if (nextLifecycle.active && !uncertainTransport) {
					notice = lifecycleNotice(nextLifecycle.phase);
					hadActiveRegeneration = true;
					trackedRegenerationId = nextRegenerationId || trackedRegenerationId;
					regenerationRequestState.write(scheduleId, {
						pending: true,
						uncertain: false,
						regenerationId: trackedRegenerationId
					});
				}
				enqueuePending = nextLifecycle.active || uncertainTransport;
				if (
					nextLifecycle.terminal &&
					(hadActiveRegeneration || matchesTrackedRequest) &&
					!uncertainTransport
				) {
					enqueuePending = false;
					hadActiveRegeneration = false;
					clearRegenerationRequest();
				}
			},
			onSettled: ({ payload: settledPayload }) => {
				if (uncertainTransport) return;
				const settledRegeneration = settledPayload?.regeneration;
				const settledLifecycle = regenerationPhase(settledRegeneration, settledPayload?.roadmap);
				notice = lifecycleNotice(settledLifecycle.phase);
			},
			onSyncError: (caught) => {
				if (regenerationActive || uncertainTransport) {
					error = requestErrorText(caught);
				}
			}
		});
		roadmapPoller.start();
	});

	onDestroy(() => roadmapPoller?.stop());
</script>

<section class="tr-panel" aria-labelledby={`topic-roadmap-title-${scheduleId}`}>
	<header class="tr-head">
		<div>
			<h4 id={`topic-roadmap-title-${scheduleId}`}>{t.title}</h4>
			<p>{t.subtitle}</p>
		</div>
		<div class="tr-head__actions">
			<button
				type="button"
				class="tr-button tr-button--quiet"
				onclick={loadRoadmap}
				disabled={loading}
			>
				{t.refresh}
			</button>
			<button
				type="button"
				class="tr-button tr-button--primary"
				onclick={uncertainTransport ? recoverRegeneration : regenerateRoadmap}
				disabled={regenerateDisabled && !uncertainTransport}
			>
				{actionBusy === 'regenerate'
					? t.regenerating
					: uncertainTransport
						? t.recoverRequest
						: lifecycle.terminal &&
							  ['failed', 'no_change', 'superseded', 'cancelled'].includes(lifecycle.phase)
							? t.researchAgain
							: t.regenerate}
			</button>
		</div>
	</header>

	{#if notice}<p class="tr-notice" role="status">{notice}</p>{/if}
	{#if error}
		<div class="tr-error" role="alert">
			<span>{error}</span>
			<button
				type="button"
				class="tr-button tr-button--quiet"
				onclick={uncertainTransport ? recoverRegeneration : loadRoadmap}
				disabled={Boolean(actionBusy)}
			>
				{uncertainTransport ? t.recoverRequest : t.retry}
			</button>
		</div>
	{/if}

	{#if regeneration}
		<div class="tr-lifecycle tr-lifecycle--{lifecycle.phase}" role="status" aria-live="polite">
			{#if lifecycle.active}<span class="tr-spinner tr-spinner--small" aria-hidden="true"
				></span>{/if}
			<div>
				<strong>{lifecycleNotice(lifecycle.phase)}</strong>
				{#if regeneration.attemptCount}
					<small>{isEn ? 'Attempt' : 'Lần thử'} {regeneration.attemptCount}</small>
				{/if}
			</div>
		</div>
	{/if}

	{#if loading && !payload}
		<div class="tr-state" aria-busy="true" aria-live="polite">
			<span class="tr-spinner" aria-hidden="true"></span>
			<p>{t.loading}</p>
		</div>
	{:else if !roadmap}
		<div class="tr-state tr-state--empty">
			<div class="tr-state__mark" aria-hidden="true">01</div>
			<h5>{t.notInitialized}</h5>
			<p>{t.notInitializedHint}</p>
			<button
				type="button"
				class="tr-button tr-button--primary"
				onclick={uncertainTransport ? recoverRegeneration : regenerateRoadmap}
				disabled={regenerateDisabled && !uncertainTransport}
			>
				{actionBusy === 'regenerate'
					? t.regenerating
					: uncertainTransport
						? t.recoverRequest
						: t.generateNow}
			</button>
		</div>
	{:else}
		<div class="tr-summary">
			<div class="tr-scope">
				<span class="tr-eyebrow">{scopeLabel(scopeMode)}</span>
				<strong>{roadmap.interpretation?.normalizedGoal || '—'}</strong>
				<small>{t.goal}</small>
				{#if roadmap.interpretation?.focusTerms?.length}
					<div class="tr-chip-row" aria-label={t.focus}>
						{#each roadmap.interpretation.focusTerms.slice(0, 8) as term, index (`${term}:${index}`)}
							<span class="tr-chip">{term}</span>
						{/each}
					</div>
				{/if}
			</div>
			<dl class="tr-stats">
				<div class="is-ready">
					<dt>{t.ready}</dt>
					<dd>{summary.ready ?? 0}</dd>
				</div>
				<div>
					<dt>{t.claimed}</dt>
					<dd>{summary.claimed ?? 0}</dd>
				</div>
				<div>
					<dt>{t.completed}</dt>
					<dd>{summary.completed ?? 0}</dd>
				</div>
				<div>
					<dt>{t.dismissed}</dt>
					<dd>{summary.dismissed ?? 0}</dd>
				</div>
				<div>
					<dt>{t.failed}</dt>
					<dd>{summary.failed ?? 0}</dd>
				</div>
			</dl>
			<dl class="tr-research">
				<div>
					<dt>{t.lastResearch}</dt>
					<dd>{formatDateTime(roadmap.lastRefillAt)}</dd>
				</div>
				<div>
					<dt>{t.sourceStatus}</dt>
					<dd>{sourceSummary.label}</dd>
				</div>
			</dl>
		</div>

		{#if sourceSummary.partial || sourceFailure}
			<div class="tr-feedback tr-feedback--source" role="status">
				<strong>{sourceFailure ? failureMessage : t.partial}</strong>
				<span>{sourceSummary.label}</span>
			</div>
		{/if}
		{#if outcomeMessage}
			<div class="tr-feedback tr-feedback--outcome" role="status">
				<strong>{outcomeMessage}</strong>
			</div>
		{/if}
		{#if operationalFailureMessage}
			<div class="tr-feedback tr-feedback--failure" role="alert">
				<strong>{operationalFailureMessage}</strong>
			</div>
		{/if}
		{#if policyCopy}
			<p class="tr-policy">{policyCopy}</p>
		{/if}

		{#if !items.length}
			<div class="tr-state tr-state--compact">
				<h5>{t.empty}</h5>
				<p>{t.emptyHint}</p>
			</div>
		{:else}
			<ol class="tr-list">
				{#each displayedItems as item (item.id)}
					<li class="tr-card" class:is-dimmed={item.status === 'dismissed'}>
						<details>
							<summary class="tr-card__summary">
								<span class="tr-rank" aria-hidden="true"
									>{String(item.rank ?? '—').padStart(2, '0')}</span
								>
								<span class="tr-card__headline">
									<span class="tr-card__meta">
										<span class="tr-status tr-status--{statusTone(item.status)}"
											>{statusLabel(item.status)}</span
										>
										<span class:tr-score--accepted={scoreAccepted(item)} class="tr-score"
											>{t.score} {scoreText(item.scores?.totalScore)}</span
										>
										{#if policyAvailable}
											<span class="tr-gate" class:is-accepted={scoreAccepted(item)}>
												{scoreAccepted(item) ? t.accepted : t.researchRequired}
											</span>
										{/if}
									</span>
									<strong>{item.topic}</strong>
									{#if item.searchIntent}<small>{item.searchIntent}</small>{/if}
								</span>
							</summary>
							<div class="tr-card__body">
								{#if item.angle}<p class="tr-angle">{item.angle}</p>{/if}
								<div class="tr-taxonomy">
									{#if item.primaryKeyword}<span><b>SEO</b>{item.primaryKeyword}</span>{/if}
									{#if item.categoryKey}<span><b>{t.category}</b>{item.categoryKey}</span>{/if}
									{#if item.searchIntent}<span><b>{t.intent}</b>{item.searchIntent}</span>{/if}
									{#if item.articleType}<span><b>{t.articleType}</b>{item.articleType}</span>{/if}
									{#if item.productScope}<span><b>{t.productScope}</b>{item.productScope}</span
										>{/if}
								</div>

								{#if item.scores?.rubricVersion || item.scores?.noveltySubtotal !== undefined}
									<div class="tr-score-detail">
										{#if item.scores?.noveltySubtotal !== undefined}<span
												><b>{t.novelty}</b> {scoreText(item.scores.noveltySubtotal)}</span
											>{/if}
										{#if item.scores?.rubricVersion}<span>{item.scores.rubricVersion}</span>{/if}
									</div>
								{/if}

								{#if item.productEvidence?.length || item.marketEvidence?.length}
									<details class="tr-evidence-disclosure">
										<summary>{t.evidenceDetails}</summary>
										{#if item.productEvidence?.length}
											<div class="tr-evidence">
												<strong>{t.products}</strong>
												<div class="tr-chip-row">
													{#each item.productEvidence.slice(0, 8) as product, index (product.id || product.sku || index)}
														<span
															class="tr-chip tr-chip--product"
															title={product.relevanceReason || ''}
														>
															{product.sku ? `${product.sku} · ` : ''}{product.name ||
																product.category}
														</span>
													{/each}
												</div>
											</div>
										{/if}
										{#if item.marketEvidence?.length}
											<div class="tr-evidence">
												<strong>{t.marketSources}</strong>
												<ul class="tr-sources">
													{#each item.marketEvidence.slice(0, 5) as source, index (source.id || source.canonicalUrl || index)}
														{@const externalUrl = safeExternalUrl(source.canonicalUrl)}
														<li>
															{#if externalUrl}
																<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
																<a href={externalUrl} target="_blank" rel="noopener noreferrer"
																	>{source.title || sourceName(source) || externalUrl}</a
																>
															{:else}
																<span>{source.title || sourceName(source) || '—'}</span>
															{/if}
															<small
																>{sourceName(source)}{sourceDomain(source)
																	? ` · ${sourceDomain(source)}`
																	: ''} · {t.freshness}: {formatDateTime(sourceDate(source))}</small
															>
														</li>
													{/each}
												</ul>
											</div>
										{/if}
									</details>
								{/if}

								<div class="tr-card__footer">
									{#if item.reasonCode}<small><b>{t.reason}:</b> {item.reasonCode}</small>{/if}
									{#if item.status === 'ready'}
										<button
											type="button"
											class="tr-button tr-button--danger-quiet"
											disabled={Boolean(actionBusy) || regenerationActive}
											onclick={() => dismissItem(item)}
										>
											{actionBusy === `dismiss:${item.id}` ? t.dismissing : t.dismiss}
										</button>
									{/if}
								</div>
							</div>
						</details>
					</li>
				{/each}
			</ol>
			{#if visibleItemLimit < items.length}
				<button
					type="button"
					class="tr-button tr-show-more"
					onclick={() => (visibleItemLimit += 10)}>{t.showMore}</button
				>
			{/if}
		{/if}
	{/if}
</section>

<style>
	.tr-panel {
		--tr-border: var(--admin-border, #e5e7eb);
		--tr-ink: var(--admin-ink, #1a1f2e);
		--tr-muted: var(--admin-muted, #6b7280);
		--tr-accent: var(--admin-accent, #0f766e);
		--tr-accent-strong: var(--admin-accent-strong, #065f5a);
		--tr-accent-soft: var(--admin-accent-soft, rgba(15, 118, 110, 0.08));
		--tr-danger: var(--admin-danger, #dc2626);
		border-top: 1px solid var(--tr-border);
		padding-top: 14px;
		display: grid;
		gap: 12px;
		min-width: 0;
		color: var(--tr-ink);
		container-type: inline-size;
	}

	.tr-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.tr-head h4,
	.tr-state h5 {
		margin: 0;
	}

	.tr-head h4 {
		font-size: 0.98rem;
		letter-spacing: -0.01em;
	}

	.tr-head p {
		margin: 3px 0 0;
		max-width: 580px;
		font-size: 0.8rem;
		line-height: 1.45;
		color: var(--tr-muted);
	}

	.tr-head__actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 7px;
	}

	.tr-button {
		border: 1px solid var(--tr-border);
		border-radius: 8px;
		background: var(--admin-surface, #fff);
		color: var(--tr-ink);
		padding: 6px 10px;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}

	.tr-button:hover:not(:disabled),
	.tr-button:focus-visible {
		border-color: var(--tr-accent);
		color: var(--tr-accent-strong);
	}

	.tr-button:focus-visible,
	.tr-sources a:focus-visible {
		outline: 2px solid var(--tr-accent);
		outline-offset: 2px;
	}

	.tr-button:disabled {
		opacity: 0.55;
		cursor: wait;
	}

	.tr-button--primary {
		background: var(--tr-accent);
		border-color: var(--tr-accent);
		color: #fff;
	}

	.tr-button--primary:hover:not(:disabled),
	.tr-button--primary:focus-visible {
		background: var(--tr-accent-strong);
		color: #fff;
	}

	.tr-button--quiet {
		background: transparent;
	}

	.tr-button--danger-quiet {
		border-color: transparent;
		background: transparent;
		color: var(--tr-danger);
	}

	.tr-button--danger-quiet:hover:not(:disabled) {
		border-color: rgba(220, 38, 38, 0.3);
		background: rgba(220, 38, 38, 0.05);
		color: var(--tr-danger);
	}

	.tr-notice,
	.tr-error,
	.tr-lifecycle,
	.tr-feedback {
		margin: 0;
		padding: 9px 11px;
		border-radius: 8px;
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.tr-notice {
		background: var(--tr-accent-soft);
		color: var(--tr-accent-strong);
	}

	.tr-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		border: 1px solid rgba(220, 38, 38, 0.22);
		background: rgba(220, 38, 38, 0.05);
		color: var(--tr-danger);
	}

	.tr-lifecycle {
		display: flex;
		align-items: center;
		gap: 9px;
		border: 1px solid rgba(3, 105, 161, 0.2);
		background: rgba(3, 105, 161, 0.06);
		color: #075985;
	}

	.tr-lifecycle > div,
	.tr-feedback {
		display: grid;
		gap: 2px;
	}

	.tr-lifecycle small {
		font-size: 0.68rem;
		color: inherit;
		opacity: 0.75;
	}

	.tr-lifecycle--completed {
		border-color: rgba(15, 118, 110, 0.25);
		background: var(--tr-accent-soft);
		color: var(--tr-accent-strong);
	}

	.tr-lifecycle--failed {
		border-color: rgba(220, 38, 38, 0.22);
		background: rgba(220, 38, 38, 0.05);
		color: var(--tr-danger);
	}

	.tr-feedback--source {
		border-left: 3px solid #b7791f;
		background: rgba(180, 83, 9, 0.07);
		color: #92400e;
	}

	.tr-feedback--outcome {
		border-left: 3px solid var(--tr-accent);
		background: var(--tr-accent-soft);
		color: var(--tr-accent-strong);
	}

	.tr-feedback--failure {
		border-left: 3px solid var(--tr-danger);
		background: rgba(220, 38, 38, 0.05);
		color: var(--tr-danger);
	}

	.tr-policy {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 650;
		color: var(--tr-muted);
	}

	.tr-state {
		min-height: 120px;
		border: 1px dashed var(--tr-border);
		border-radius: 10px;
		background: #f9fafb;
		display: grid;
		place-items: center;
		align-content: center;
		gap: 8px;
		padding: 22px;
		text-align: center;
	}

	.tr-state p {
		margin: 0;
		max-width: 560px;
		color: var(--tr-muted);
		font-size: 0.82rem;
		line-height: 1.5;
	}

	.tr-state--empty {
		grid-template-columns: auto minmax(0, 1fr) auto;
		place-items: center start;
		text-align: left;
	}

	.tr-state--empty p {
		grid-column: 2;
	}

	.tr-state--empty .tr-button {
		grid-column: 3;
		grid-row: 1 / span 2;
	}

	.tr-state--compact {
		min-height: 90px;
	}

	.tr-state__mark {
		grid-row: 1 / span 2;
		font-size: 1.7rem;
		font-weight: 800;
		color: var(--tr-accent);
		font-variant-numeric: tabular-nums;
	}

	.tr-spinner {
		width: 22px;
		height: 22px;
		border: 2px solid var(--tr-border);
		border-top-color: var(--tr-accent);
		border-radius: 50%;
		animation: tr-spin 0.8s linear infinite;
	}

	.tr-spinner--small {
		width: 15px;
		height: 15px;
		flex: 0 0 auto;
		border-color: color-mix(in srgb, currentColor 25%, transparent);
		border-top-color: currentColor;
	}

	@keyframes tr-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.tr-summary {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
		gap: 10px;
	}

	.tr-scope,
	.tr-stats,
	.tr-research {
		margin: 0;
		border: 1px solid var(--tr-border);
		border-radius: 10px;
		background: #f9fafb;
		padding: 11px;
	}

	.tr-scope {
		display: grid;
		gap: 5px;
	}

	.tr-scope strong {
		font-size: 0.88rem;
		line-height: 1.35;
	}

	.tr-scope small,
	.tr-research dt {
		color: var(--tr-muted);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.tr-eyebrow {
		width: fit-content;
		border-radius: 999px;
		background: var(--tr-accent-soft);
		color: var(--tr-accent-strong);
		padding: 2px 8px;
		font-size: 0.7rem;
		font-weight: 750;
	}

	.tr-stats {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		align-items: stretch;
		padding: 0;
		overflow: hidden;
	}

	.tr-stats div {
		display: grid;
		align-content: center;
		gap: 2px;
		padding: 9px 6px;
		text-align: center;
		border-right: 1px solid var(--tr-border);
	}

	.tr-stats div:last-child {
		border-right: 0;
	}

	.tr-stats .is-ready {
		background: var(--tr-accent-soft);
	}

	.tr-stats dt {
		font-size: 0.65rem;
		color: var(--tr-muted);
	}

	.tr-stats dd {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 750;
		font-variant-numeric: tabular-nums;
	}

	.tr-research {
		display: grid;
		gap: 8px;
	}

	.tr-research div {
		display: grid;
		gap: 2px;
	}

	.tr-research dd {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.4;
	}

	.tr-chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}

	.tr-chip {
		display: inline-flex;
		align-items: center;
		min-height: 23px;
		border: 1px solid var(--tr-border);
		border-radius: 999px;
		background: #fff;
		padding: 2px 8px;
		font-size: 0.7rem;
		line-height: 1.25;
	}

	.tr-chip--product {
		border-color: rgba(15, 118, 110, 0.22);
		background: var(--tr-accent-soft);
	}

	.tr-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 9px;
	}

	.tr-card {
		border: 1px solid var(--tr-border);
		border-radius: 10px;
		background: var(--admin-surface, #fff);
		overflow: clip;
		min-width: 0;
	}

	.tr-card.is-dimmed {
		opacity: 0.65;
	}

	.tr-card > details,
	.tr-evidence-disclosure {
		min-width: 0;
	}

	.tr-card__summary {
		list-style: none;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: start;
		gap: 10px;
		padding: 11px 12px;
		cursor: pointer;
		min-width: 0;
	}

	.tr-card__summary::-webkit-details-marker,
	.tr-evidence-disclosure > summary::-webkit-details-marker {
		display: none;
	}

	.tr-card__summary::after {
		content: '+';
		color: var(--tr-muted);
		font-weight: 700;
	}

	.tr-card > details[open] > .tr-card__summary::after {
		content: '–';
	}

	.tr-rank {
		display: grid;
		place-items: center;
		width: 31px;
		height: 31px;
		border-radius: 8px;
		background: #f3f4f6;
		color: var(--tr-muted);
		font-size: 0.69rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}

	.tr-card__headline {
		display: grid;
		gap: 4px;
		min-width: 0;
	}

	.tr-card__headline strong {
		font-size: 0.92rem;
		line-height: 1.35;
		overflow-wrap: anywhere;
	}

	.tr-card__headline small {
		color: var(--tr-muted);
		font-size: 0.69rem;
	}

	.tr-card__meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}

	.tr-card__body {
		display: grid;
		gap: 9px;
		padding: 0 12px 12px 53px;
		min-width: 0;
	}

	.tr-card__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.tr-gate {
		border-radius: 999px;
		padding: 2px 7px;
		font-size: 0.65rem;
		font-weight: 750;
		background: rgba(180, 83, 9, 0.08);
		color: #92400e;
	}

	.tr-gate.is-accepted {
		background: var(--tr-accent-soft);
		color: var(--tr-accent-strong);
	}

	.tr-score--accepted {
		color: var(--tr-accent-strong);
	}

	.tr-score-detail {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		border-radius: 8px;
		background: #f9fafb;
		padding: 8px 10px;
		font-size: 0.7rem;
		color: var(--tr-muted);
	}

	.tr-evidence-disclosure {
		border-top: 1px solid rgba(17, 24, 39, 0.07);
		padding-top: 7px;
	}

	.tr-evidence-disclosure > summary {
		cursor: pointer;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--tr-accent-strong);
	}

	.tr-evidence-disclosure > summary::after {
		content: ' +';
	}

	.tr-evidence-disclosure[open] > summary::after {
		content: ' –';
	}

	.tr-show-more {
		justify-self: center;
	}

	.tr-angle {
		margin: -2px 0 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--tr-muted);
	}

	.tr-status {
		border: 1px solid var(--tr-border);
		border-radius: 999px;
		padding: 2px 8px;
		font-size: 0.69rem;
		font-weight: 750;
	}

	.tr-status--good {
		border-color: rgba(15, 118, 110, 0.3);
		background: var(--tr-accent-soft);
		color: var(--tr-accent-strong);
	}

	.tr-status--danger {
		border-color: rgba(220, 38, 38, 0.25);
		background: rgba(220, 38, 38, 0.06);
		color: var(--tr-danger);
	}

	.tr-status--active {
		border-color: rgba(3, 105, 161, 0.25);
		background: rgba(3, 105, 161, 0.07);
		color: #0369a1;
	}

	.tr-status--muted {
		color: var(--tr-muted);
		background: #f9fafb;
	}

	.tr-score {
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--tr-muted);
	}

	.tr-taxonomy {
		display: flex;
		flex-wrap: wrap;
		gap: 5px 12px;
	}

	.tr-taxonomy span {
		font-size: 0.74rem;
		color: var(--tr-muted);
	}

	.tr-taxonomy b {
		margin-right: 4px;
		color: var(--tr-ink);
		font-weight: 650;
	}

	.tr-evidence {
		display: grid;
		grid-template-columns: minmax(110px, 0.25fr) minmax(0, 1fr);
		gap: 9px;
		align-items: start;
		border-top: 1px solid rgba(17, 24, 39, 0.07);
		padding-top: 8px;
	}

	.tr-evidence > strong {
		font-size: 0.72rem;
		color: var(--tr-muted);
	}

	.tr-sources {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}

	.tr-sources li {
		display: grid;
		gap: 1px;
		min-width: 0;
	}

	.tr-sources a,
	.tr-sources span {
		font-size: 0.76rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.tr-sources a {
		color: var(--tr-accent-strong);
	}

	.tr-sources small,
	.tr-card__footer small {
		font-size: 0.68rem;
		line-height: 1.4;
		color: var(--tr-muted);
	}

	@container (max-width: 700px) {
		.tr-summary {
			grid-template-columns: 1fr;
		}

		.tr-head,
		.tr-card__footer {
			align-items: stretch;
			flex-direction: column;
		}

		.tr-head__actions {
			justify-content: flex-start;
		}
	}

	@container (max-width: 520px) {
		.tr-state--empty {
			grid-template-columns: 1fr;
			text-align: center;
			place-items: center;
		}

		.tr-state--empty .tr-state__mark,
		.tr-state--empty p,
		.tr-state--empty .tr-button {
			grid-column: 1;
			grid-row: auto;
		}

		.tr-card__summary {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.tr-card__summary::after {
			display: none;
		}

		.tr-card__body {
			padding-left: 12px;
		}

		.tr-stats {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.tr-stats div:nth-child(3) {
			border-right: 0;
		}

		.tr-stats div:nth-child(n + 4) {
			border-top: 1px solid var(--tr-border);
		}

		.tr-evidence {
			grid-template-columns: 1fr;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tr-spinner {
			animation: none;
		}
	}
</style>
