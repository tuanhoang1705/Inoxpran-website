<script>
	import { browser } from '$app/environment';
	import { onMount, tick } from 'svelte';
	import { locale, t } from '$lib/i18n/admin/index.js';

	let { data } = $props();

	let roomState = $state(data?.room || null);
	let consultantsState = $state(Array.isArray(data?.consultants) ? data.consultants : []);
	let currentAdmin = $state(data?.currentAdmin || null);
	let roomListState = $state(Array.isArray(data?.roomList) ? data.roomList : []);
	let apiError = $state(data?.apiError || '');
	let infoMessage = $state('');
	let roomActionBusy = $state('');
	let sendingMessage = $state(false);
	let composerText = $state('');
	let menuOpen = $state(false);
	let consultantSearch = $state('');
	let selectedConsultantAdminId = $state('');
	let highlightedConsultantIndex = $state(-1);
	let copiedRoomCode = $state(false);
	let copiedSessionId = $state(false);
	let nowTs = $state(Date.now());
	let typingRequested = $state(Boolean(data?.room?.session?.liveSupport?.typing?.active));
	let typingActiveSent = $state(Boolean(data?.room?.session?.liveSupport?.typing?.active));
	let typingRequestInFlight = $state(false);
	let optimisticMessages = $state([]);
	let conversationEl = $state(null);
	let composerEl = $state(null);
	let isNearBottom = $state(true);
	let typingIdleHandle = null;
	let streamError = $state(false);
	let snapshotRefreshInFlight = false;
	let snapshotRefreshQueued = false;
	let snapshotRefreshMarkRead = false;
	let roomListSearch = $state('');
	let roomListScope = $state('all');
	let roomListPage = $state(1);
	let roomListRefreshInFlight = false;
	let roomListRefreshQueued = false;
	let menuHost = $state(null);
	let sidePanelMode = $state('');
	let roomSwitchTargetId = $state('');
	let roomSwitchError = $state('');
	let roomFetchToken = 0;
	let roomSwitchAbortController = null;
	let roomSnapshotCache = new Map();
	let lastRoomListAutoPageKey = $state('');

	const room = $derived(roomState || null);
	const session = $derived(room?.session || null);
	const roomList = $derived(Array.isArray(roomListState) ? roomListState : []);
	const messages = $derived(Array.isArray(room?.messages) ? room.messages : []);
	const consultants = $derived(Array.isArray(consultantsState) ? consultantsState : []);
	const summary = $derived(
		room?.summary || { unreadCount: 0, messageCount: 0, returnedMessageCount: 0 }
	);
	const latestLead = $derived(room?.latestLead || null);
	const sla = $derived(room?.sla || null);
	const cannedReplies = $derived(Array.isArray(room?.cannedReplies) ? room.cannedReplies : []);
	const returnTo = $derived(String(data?.returnTo || '/admin/chat-rooms'));
	const extractRoomCode = (value) => String(value || '').replace(/^chat_?/, '') || '--';
	const roomCodeValue = $derived.by(() => extractRoomCode(session?.sessionId));
	const liveSupport = $derived(session?.liveSupport || {});
	const customerPresence = $derived(session?.customerPresence || {});
	const roomClosed = $derived(String(session?.status || '').toLowerCase() === 'closed');
	const showSlaBadge = $derived(String(session?.status || '').toLowerCase() !== 'closed');
	const roomSwitchBusy = $derived(Boolean(roomSwitchTargetId));
	const activeRoomSelectionId = $derived(roomSwitchTargetId || session?.sessionId || '');
	const ownedByCurrentAdmin = $derived.by(() => {
		const assignedId = String(session?.assignedTo?._id || session?.assignedTo || '');
		const adminId = String(currentAdmin?.userId || '');
		const roomEmail = String(
			liveSupport?.adminEmail || liveSupport?.assignedAdminEmail || ''
		).toLowerCase();
		const adminEmail = String(currentAdmin?.email || '').toLowerCase();
		return Boolean(
			(adminId && assignedId && adminId === assignedId) ||
			(adminEmail && roomEmail && adminEmail === roomEmail)
		);
	});
	const canClaimRoom = $derived(!roomClosed && (!liveSupport?.active || ownedByCurrentAdmin));
	const consultantLabel = (roomItem) =>
		roomItem?.liveSupport?.adminName ||
		roomItem?.liveSupport?.accountLabel ||
		roomItem?.assignedTo?.name ||
		roomItem?.assignedTo?.email ||
		$t('admin.chatRooms.detail.noConsultantAssigned');
	const currentConsultant = $derived(consultantLabel(session));
	const roomHandledByOtherAdmin = $derived(Boolean(liveSupport?.active && !ownedByCurrentAdmin));
	const guestCustomerLabel = 'Kh\u00e1ch h\u00e0ng L\u1ea1';
	const guestPhonePromptText =
		'Em \u0111\u00e3 chuy\u1ec3n y\u00eau c\u1ea7u sang t\u01b0 v\u1ea5n vi\u00ean tr\u1ef1c ti\u1ebfp. Anh/ch\u1ecb vui l\u00f2ng \u0111\u1ec3 l\u1ea1i s\u1ed1 \u0111i\u1ec7n tho\u1ea1i ngay trong khung chat n\u1ebfu ch\u01b0a cung c\u1ea5p \u0111\u1ec3 \u0111\u1ed9i CSKH ti\u1ebfp t\u1ee5c h\u1ed7 tr\u1ee3 \u1ea1.';
	const hasAuthenticatedCustomerAccount = (roomItem) =>
		Boolean(roomItem?.context?.authenticatedCustomer);
	const hasGuestPhonePrompt = (messageList = []) =>
		messageList.some(
			(message) =>
				String(message?.role || '').toLowerCase() === 'assistant' &&
				String(message?.text || '').trim() === guestPhonePromptText
		);
	const resolveCustomerLabel = ({
		latestLead: lead,
		user,
		authenticatedCustomer = false,
		handoffRequested = false
	}) =>
		lead?.phone ||
		(authenticatedCustomer ? user?.name : null) ||
		(handoffRequested ? guestCustomerLabel : $t('common.customer'));
	const customerLabel = $derived(
		resolveCustomerLabel({
			latestLead,
			user: session?.user,
			authenticatedCustomer: hasAuthenticatedCustomerAccount(session),
			handoffRequested: Boolean(session?.handoff?.requestedAt) || hasGuestPhonePrompt(messages)
		})
	);
	const adminLabel = $derived(currentAdmin?.name || currentAdmin?.email || '--');
	const customerInitial = $derived.by(() =>
		String(customerLabel || 'K')
			.slice(0, 1)
			.toUpperCase()
	);
	const roomOwnedByCurrentAdmin = (roomItem) => {
		if (!currentAdmin?.userId && !currentAdmin?.email) return false;
		return (
			String(currentAdmin?.userId || '') ===
				String(roomItem?.assignedTo?._id || roomItem?.assignedTo || '') ||
			String(currentAdmin?.email || '').toLowerCase() ===
				String(
					roomItem?.liveSupport?.adminEmail || roomItem?.liveSupport?.assignedAdminEmail || ''
				).toLowerCase()
		);
	};
	const roomItemHandledByOtherAdmin = (roomItem) =>
		Boolean(roomItem?.liveSupport?.active && !roomOwnedByCurrentAdmin(roomItem));
	const filteredRoomList = $derived.by(() => {
		const query = roomListSearch.trim().toLowerCase();
		return roomList.filter((item) => {
			if (!item?.sessionId) return false;
			if (roomListScope === 'mine' && !roomOwnedByCurrentAdmin(item)) return false;
			if (roomListScope === 'unread' && Number(item?.unreadCount || 0) <= 0) return false;
			if (!query) return true;
			return [
				extractRoomCode(item?.sessionId),
				item?.latestLead?.phone,
				item?.user?.name,
				item?.liveSupport?.adminName,
				item?.assignedTo?.name,
				item?.latestMessage?.text,
				item?.sourcePath
			]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(query));
		});
	});
	const roomActivityAt = (roomItem) =>
		roomItem?.latestMessage?.createdAt ||
		roomItem?.lastActiveAt ||
		roomItem?.updatedAt ||
		roomItem?.createdAt ||
		null;
	const sortedFilteredRoomList = $derived.by(() =>
		[...filteredRoomList].sort(
			(left, right) =>
				new Date(roomActivityAt(right) || 0).getTime() -
				new Date(roomActivityAt(left) || 0).getTime()
		)
	);
	const roomListPageSize = 10;
	const totalRoomListPages = $derived(
		Math.max(1, Math.ceil(sortedFilteredRoomList.length / roomListPageSize))
	);
	const visibleRoomList = $derived.by(() => {
		const pageIndex = Math.max(Number(roomListPage || 1), 1) - 1;
		const start = pageIndex * roomListPageSize;
		return sortedFilteredRoomList.slice(start, start + roomListPageSize);
	});
	const canGoPrevRoomPage = $derived(roomListPage > 1);
	const canGoNextRoomPage = $derived(roomListPage < totalRoomListPages);
	const filteredConsultants = $derived.by(() => {
		const activeId = String(session?.assignedTo?._id || '');
		const query = consultantSearch.trim().toLowerCase();
		return consultants.filter((consultant) => {
			if (!consultant?.adminId || String(consultant.adminId) === activeId) return false;
			if (!query) return true;
			return [consultant.adminName, consultant.adminEmail, consultant.accountLabel]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(query));
		});
	});
	const mergedMessages = $derived.by(() => {
		const serverClientIds = new Set(
			messages.map((message) => message?.meta?.clientRequestId).filter(Boolean)
		);
		const optimistic = optimisticMessages.filter(
			(message) => !serverClientIds.has(message?.meta?.clientRequestId)
		);
		return [...messages, ...optimistic].sort(
			(left, right) =>
				new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime()
		);
	});

	const formatDateTime = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		return date.toLocaleString($locale === 'en' ? 'en-US' : 'vi-VN');
	};

	const formatRelativeTime = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		const diffSeconds = Math.max(1, Math.floor((nowTs - date.getTime()) / 1000));
		const formatter = new Intl.RelativeTimeFormat($locale === 'en' ? 'en-US' : 'vi-VN', {
			numeric: 'always'
		});
		if (diffSeconds < 60) return formatter.format(-diffSeconds, 'second');
		if (diffSeconds < 3600) return formatter.format(-Math.floor(diffSeconds / 60), 'minute');
		if (diffSeconds < 86400) return formatter.format(-Math.floor(diffSeconds / 3600), 'hour');
		return formatter.format(-Math.floor(diffSeconds / 86400), 'day');
	};

	const formatSidebarTime = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		const diff = Math.abs(nowTs - date.getTime());
		if (diff < 86400000) {
			return date.toLocaleTimeString($locale === 'en' ? 'en-US' : 'vi-VN', {
				hour: '2-digit',
				minute: '2-digit'
			});
		}
		return date.toLocaleDateString($locale === 'en' ? 'en-US' : 'vi-VN', {
			day: '2-digit',
			month: '2-digit'
		});
	};

	const formatRoomGroupLabel = (value) => {
		if (!value) return '--';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '--';
		const target = new Date(date);
		target.setHours(0, 0, 0, 0);
		const today = new Date(nowTs);
		today.setHours(0, 0, 0, 0);
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		if (target.getTime() === today.getTime()) return $t('common.today');
		if (target.getTime() === yesterday.getTime()) return $t('common.yesterday');
		return date.toLocaleDateString($locale === 'en' ? 'en-US' : 'vi-VN', {
			weekday: 'short',
			day: '2-digit',
			month: '2-digit'
		});
	};

	const groupedRoomList = $derived.by(() => {
		const groups = [];
		for (const item of visibleRoomList) {
			const activityAt = roomActivityAt(item);
			const date = activityAt ? new Date(activityAt) : null;
			const key =
				date && !Number.isNaN(date.getTime())
					? new Date(date.setHours(0, 0, 0, 0)).toISOString()
					: 'unknown';
			const label = formatRoomGroupLabel(activityAt);
			const existing = groups.find((group) => group.key === key);
			if (existing) {
				existing.items.push(item);
				continue;
			}
			groups.push({ key, label, items: [item] });
		}
		return groups;
	});
	const roomListAutoPageKey = $derived.by(() =>
		[
			String(session?.sessionId || ''),
			roomListSearch.trim().toLowerCase(),
			roomListScope,
			sortedFilteredRoomList.map((item) => String(item?.sessionId || '')).join('|')
		].join('::')
	);

	const formatElapsed = (milliseconds) => {
		const totalSeconds = Math.max(Math.floor(Number(milliseconds || 0) / 1000), 0);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		if (hours > 0) return `${hours}h ${minutes}m`;
		if (minutes > 0) return `${minutes}m ${seconds}s`;
		return `${seconds}s`;
	};

	const statusLabel = (value) =>
		String(value || '').toLowerCase() === 'handoff'
			? $t('admin.chatRooms.status.handoff')
			: String(value || '').toLowerCase() === 'closed'
				? $t('admin.chatRooms.status.closed')
				: $t('admin.chatRooms.status.open');

	const presenceLabel = (value) =>
		String(value || '').toLowerCase() === 'left'
			? $t('admin.chatRooms.presence.left')
			: $t('admin.chatRooms.presence.active');

	const presenceStateClass = (value) => {
		const state = String(value || '').toLowerCase();
		return state === 'left' ? 'left' : 'active';
	};

	const slaTone = (currentSla) =>
		!currentSla || currentSla.state === 'closed'
			? 'neutral'
			: currentSla.level === 'critical'
				? 'critical'
				: currentSla.level === 'warning'
					? 'warning'
					: currentSla.state === 'waiting'
						? 'waiting'
						: 'active';

	const slaLabel = (currentSla) => {
		if (!currentSla) return '--';
		if (currentSla.state === 'closed') return $t('admin.chatRooms.sla.closed');
		const elapsed = nowTs - new Date(currentSla.startedAt || nowTs).getTime();
		const prefix =
			currentSla.level === 'critical'
				? `${$t('admin.chatRooms.sla.critical')} | `
				: currentSla.level === 'warning'
					? `${$t('admin.chatRooms.sla.warning')} | `
					: '';
		return currentSla.state === 'waiting'
			? `${prefix}${$t('admin.chatRooms.sla.waiting', { time: formatElapsed(elapsed) })}`
			: currentSla.state === 'active'
				? `${prefix}${$t('admin.chatRooms.sla.active', { time: formatElapsed(elapsed) })}`
				: `${prefix}${$t('admin.chatRooms.sla.open', { time: formatElapsed(elapsed) })}`;
	};

	const roleLabel = (message) => {
		const role = String(message?.role || '').toLowerCase();
		if (role === 'consultant')
			return (
				message?.meta?.adminName ||
				message?.meta?.accountLabel ||
				$t('admin.chatRooms.roles.consultant')
			);
		if (role === 'assistant') return $t('admin.chatRooms.roles.assistant');
		if (role === 'system') return $t('admin.chatRooms.roles.system');
		return $t('admin.chatRooms.roles.user');
	};

	const roomListTitle = (roomItem) =>
		resolveCustomerLabel({
			latestLead: roomItem?.latestLead,
			user: roomItem?.user,
			authenticatedCustomer: hasAuthenticatedCustomerAccount(roomItem),
			handoffRequested: Boolean(roomItem?.handoff?.requestedAt)
		});

	const roomListPreview = (roomItem) => {
		const text = String(roomItem?.latestMessage?.text || '').trim();
		if (!text) return roomItem?.sourcePath || '/';
		return text.length > 72 ? `${text.slice(0, 69)}...` : text;
	};

	const roomListHref = (sessionId) =>
		`/admin/chat-rooms/${sessionId}?returnTo=${encodeURIComponent(returnTo)}`;

	const updateViewportState = () => {
		if (!conversationEl) return;
		const remaining =
			conversationEl.scrollHeight - conversationEl.scrollTop - conversationEl.clientHeight;
		isNearBottom = remaining <= 96;
	};

	const scrollToBottom = async (behavior = 'smooth') => {
		await tick();
		if (!conversationEl) return;
		conversationEl.scrollTo({ top: conversationEl.scrollHeight, behavior });
		isNearBottom = true;
	};

	const resizeComposer = () => {
		if (!composerEl) return;
		composerEl.style.height = '0px';
		composerEl.style.height = `${Math.min(composerEl.scrollHeight, 180)}px`;
	};

	const isClosedRoomError = (error) =>
		String(error?.message || '')
			.toLowerCase()
			.includes('closed room');
	const syncClosedRoomUiState = () => {
		window.clearTimeout(typingIdleHandle);
		typingRequested = false;
		typingActiveSent = false;
		menuOpen = false;
	};

	const updateLocalLiveSupport = (patch = {}) => {
		if (!roomState?.session) return;
		roomState = {
			...roomState,
			session: {
				...roomState.session,
				status: patch.status || roomState.session.status,
				assignedTo:
					patch.assignedTo !== undefined ? patch.assignedTo : roomState.session.assignedTo,
				assignedAt:
					patch.assignedAt !== undefined ? patch.assignedAt : roomState.session.assignedAt,
				liveSupport: {
					...(roomState.session.liveSupport || {}),
					...patch.liveSupport
				}
			}
		};
	};

	const copyToClipboard = async (value, type) => {
		if (!browser || !navigator?.clipboard || !value) return;
		await navigator.clipboard.writeText(String(value));
		if (type === 'room') {
			copiedRoomCode = true;
			window.setTimeout(() => (copiedRoomCode = false), 1500);
			return;
		}
		copiedSessionId = true;
		window.setTimeout(() => (copiedSessionId = false), 1500);
	};

	const isModifiedNavigationEvent = (event) =>
		Boolean(
			event?.defaultPrevented ||
			event?.button !== 0 ||
			event?.metaKey ||
			event?.ctrlKey ||
			event?.shiftKey ||
			event?.altKey
		);

	const replaceRoomHistory = (targetSessionId) => {
		if (!browser || !targetSessionId) return;
		window.history.replaceState(window.history.state, '', roomListHref(targetSessionId));
	};

	const cacheRoomSnapshot = (metadata) => {
		const sessionId = String(metadata?.session?.sessionId || '').trim();
		if (!sessionId) return;
		roomSnapshotCache.set(sessionId, metadata);
	};

	const applySnapshotMetadata = async (
		metadata,
		{ forceScroll = false, resetOptimistic = false, resetTypingState = false } = {}
	) => {
		cacheRoomSnapshot(metadata);
		roomState = metadata;
		if (resetOptimistic) {
			optimisticMessages = [];
		} else {
			const serverClientIds = new Set(
				(metadata.messages || []).map((message) => message?.meta?.clientRequestId).filter(Boolean)
			);
			optimisticMessages = optimisticMessages.filter(
				(message) => !serverClientIds.has(message?.meta?.clientRequestId)
			);
		}
		const nextTypingActive = Boolean(metadata?.session?.liveSupport?.typing?.active);
		typingActiveSent = nextTypingActive;
		if (resetTypingState) {
			window.clearTimeout(typingIdleHandle);
			typingRequested = nextTypingActive;
		}
		apiError = '';
		roomSwitchError = '';
		streamError = false;
		if (forceScroll || isNearBottom) await scrollToBottom('auto');
	};

	const readRoomSnapshot = async (
		targetSessionId,
		{ markRead = true, signal, messageLimit = 300 } = {}
	) => {
		const params = new URLSearchParams({ messageLimit: String(messageLimit) });
		if (markRead) params.set('markRead', '1');
		const response = await fetch(`/admin/api/chat-rooms/${targetSessionId}?${params.toString()}`, {
			headers: { 'cache-control': 'no-store' },
			signal
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok || !payload?.metadata) {
			throw new Error(payload?.error || $t('admin.chatRooms.errors.roomLoad'));
		}
		return payload.metadata;
	};

	const fetchRoomList = async () => {
		const response = await fetch('/admin/api/chat-rooms?limit=48&status=handoff', {
			headers: { 'cache-control': 'no-store' }
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			throw new Error(payload?.error || $t('admin.chatRooms.errors.listLoad'));
		}
		const items = Array.isArray(payload?.metadata?.items) ? payload.metadata.items : [];
		if (
			session?.sessionId &&
			!items.some((item) => item?.sessionId === session.sessionId) &&
			roomState?.session
		) {
			items.unshift({
				...(roomState.session || {}),
				sessionId: roomState.session.sessionId,
				latestMessage:
					Array.isArray(roomState.messages) && roomState.messages.length
						? {
								role: roomState.messages[roomState.messages.length - 1]?.role,
								text: roomState.messages[roomState.messages.length - 1]?.text,
								createdAt: roomState.messages[roomState.messages.length - 1]?.createdAt
							}
						: null,
				latestLead: roomState.latestLead || null,
				unreadCount: Number(roomState.summary?.unreadCount || 0),
				sla: roomState.sla || null
			});
		}
		roomListState = items;
	};

	const queueRoomListRefresh = () => {
		if (roomListRefreshInFlight) {
			roomListRefreshQueued = true;
			return;
		}
		roomListRefreshInFlight = true;
		void (async () => {
			try {
				await fetchRoomList();
			} catch (error) {
				console.error('[chat-room] room list refresh failed', error);
			} finally {
				roomListRefreshInFlight = false;
				if (roomListRefreshQueued) {
					roomListRefreshQueued = false;
					queueRoomListRefresh();
				}
			}
		})();
	};

	const fetchSnapshot = async ({
		sessionId = session?.sessionId,
		forceScroll = false,
		markRead = true,
		resetOptimistic = false,
		resetTypingState = false,
		signal
	} = {}) => {
		const targetSessionId = String(sessionId || '').trim();
		if (!targetSessionId) {
			throw new Error($t('admin.chatRooms.errors.roomLoad'));
		}
		const token = ++roomFetchToken;
		const metadata = await readRoomSnapshot(targetSessionId, {
			markRead,
			signal
		});
		if (token !== roomFetchToken) return null;
		await applySnapshotMetadata(metadata, {
			forceScroll,
			resetOptimistic,
			resetTypingState
		});
		return metadata;
	};

	const queueSnapshotRefresh = ({ markRead = false, forceScroll = false } = {}) => {
		snapshotRefreshMarkRead = snapshotRefreshMarkRead || markRead;
		if (snapshotRefreshInFlight) {
			snapshotRefreshQueued = true;
			return;
		}
		snapshotRefreshInFlight = true;
		void (async () => {
			try {
				const targetSessionId = roomSwitchTargetId || session?.sessionId;
				await fetchSnapshot({
					sessionId: targetSessionId,
					markRead: snapshotRefreshMarkRead,
					forceScroll
				});
			} catch (error) {
				console.error('[chat-room] realtime refresh failed', error);
				apiError = error?.message || $t('admin.chatRooms.errors.roomLoad');
				streamError = true;
			} finally {
				snapshotRefreshInFlight = false;
				const shouldRunAgain = snapshotRefreshQueued;
				const nextMarkRead = snapshotRefreshMarkRead;
				snapshotRefreshQueued = false;
				snapshotRefreshMarkRead = false;
				if (shouldRunAgain) {
					queueSnapshotRefresh({ markRead: nextMarkRead, forceScroll: false });
				}
			}
		})();
	};

	const patchRoom = async (payload, targetSessionId = session?.sessionId) => {
		const roomSessionId = String(targetSessionId || '').trim();
		if (!roomSessionId) {
			throw new Error($t('admin.chatRooms.errors.roomUpdate'));
		}
		const response = await fetch(`/admin/api/chat-rooms/${roomSessionId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const body = await response.json().catch(() => null);
		if (!response.ok) throw new Error(body?.error || $t('admin.chatRooms.errors.roomUpdate'));
		return body?.metadata || null;
	};

	const switchRoom = async (targetSessionId) => {
		const nextSessionId = String(targetSessionId || '').trim();
		const currentSessionId = String(session?.sessionId || '').trim();
		if (!nextSessionId) return;
		if (roomSwitchTargetId === nextSessionId) return;
		roomSwitchError = '';
		apiError = '';
		if (nextSessionId === currentSessionId) {
			menuOpen = false;
			return;
		}
		const previousSessionId = currentSessionId;
		roomSwitchTargetId = nextSessionId;
		infoMessage = '';
		menuOpen = false;
		if (sidePanelMode === 'transfer') {
			selectedConsultantAdminId = '';
			consultantSearch = '';
			highlightedConsultantIndex = -1;
		}
		snapshotRefreshQueued = false;
		snapshotRefreshMarkRead = false;
		window.clearTimeout(typingIdleHandle);
		typingRequested = false;
		typingActiveSent = false;
		if (roomSwitchAbortController) {
			roomSwitchAbortController.abort();
		}
		const controller = new AbortController();
		roomSwitchAbortController = controller;
		const cachedMetadata = roomSnapshotCache.get(nextSessionId);
		if (cachedMetadata) {
			await applySnapshotMetadata(cachedMetadata, {
				forceScroll: true,
				resetOptimistic: true,
				resetTypingState: true
			});
			replaceRoomHistory(nextSessionId);
		}
		if (previousSessionId) {
			void patchRoom({ typingActive: false }, previousSessionId).catch(() => {});
		}
		try {
			const metadata = await fetchSnapshot({
				sessionId: nextSessionId,
				forceScroll: !cachedMetadata,
				markRead: true,
				resetOptimistic: true,
				resetTypingState: true,
				signal: controller.signal
			});
			if (!metadata) return;
			replaceRoomHistory(nextSessionId);
			queueRoomListRefresh();
		} catch (error) {
			if (error?.name === 'AbortError') return;
			roomSwitchError = error?.message || $t('admin.chatRooms.errors.roomLoad');
			apiError = roomSwitchError;
			if (isClosedRoomError(error)) {
				syncClosedRoomUiState();
			}
		} finally {
			if (roomSwitchAbortController === controller) {
				roomSwitchAbortController = null;
				roomSwitchTargetId = '';
			}
		}
	};

	const handleRoomListSelection = (event, targetSessionId) => {
		if (isModifiedNavigationEvent(event)) return;
		event.preventDefault();
		void switchRoom(targetSessionId);
	};

	const flushTypingState = async () => {
		if (roomClosed) {
			syncClosedRoomUiState();
			return;
		}
		if (typingRequestInFlight || typingRequested === typingActiveSent) return;
		typingRequestInFlight = true;
		const nextActive = typingRequested;
		try {
			await patchRoom({ typingActive: nextActive, typingDurationMs: 12000, markRead: true });
			typingActiveSent = nextActive;
			updateLocalLiveSupport({
				status: nextActive ? 'handoff' : undefined,
				assignedTo: nextActive
					? session?.assignedTo || {
							_id: currentAdmin?.userId,
							name: currentAdmin?.name,
							email: currentAdmin?.email
						}
					: undefined,
				assignedAt: nextActive ? session?.assignedAt || new Date().toISOString() : undefined,
				liveSupport: {
					active: nextActive ? true : Boolean(liveSupport?.active),
					channel: 'admin_console',
					adminName: currentAdmin?.name || liveSupport?.adminName,
					adminEmail: currentAdmin?.email || liveSupport?.adminEmail,
					accountLabel: currentAdmin?.name || currentAdmin?.email || liveSupport?.accountLabel,
					typing: {
						active: nextActive,
						source: 'admin_console',
						updatedAt: new Date().toISOString(),
						until: nextActive ? new Date(Date.now() + 12000).toISOString() : null
					}
				}
			});
		} catch (error) {
			console.error('[chat-room] typing update failed', error);
			if (isClosedRoomError(error)) {
				syncClosedRoomUiState();
				apiError = $t('admin.chatRooms.detail.roomClosedHint');
				queueSnapshotRefresh({ markRead: true, forceScroll: false });
				return;
			}
		} finally {
			typingRequestInFlight = false;
			if (typingRequested !== typingActiveSent) void flushTypingState();
		}
	};

	const queueTyping = (active) => {
		if (roomClosed) {
			syncClosedRoomUiState();
			return;
		}
		typingRequested = Boolean(active);
		if (!typingRequestInFlight) void flushTypingState();
	};

	const toggleMenu = () => {
		menuOpen = !menuOpen;
	};

	const toggleSidePanel = (mode) => {
		sidePanelMode = sidePanelMode === mode ? '' : mode;
		menuOpen = false;
	};

	const scheduleTypingIdle = () => {
		window.clearTimeout(typingIdleHandle);
		typingIdleHandle = window.setTimeout(() => queueTyping(false), 1600);
	};

	const performRoomAction = async (busyKey, payload, successMessage, forceScroll = false) => {
		if (roomActionBusy || roomSwitchBusy) return;
		if (roomClosed && busyKey !== 'reopen') {
			apiError = $t('admin.chatRooms.detail.roomClosedHint');
			syncClosedRoomUiState();
			return;
		}
		roomActionBusy = busyKey;
		menuOpen = false;
		try {
			await patchRoom(payload);
			await fetchSnapshot({ forceScroll, markRead: true });
			queueRoomListRefresh();
			infoMessage = successMessage;
			apiError = '';
		} catch (error) {
			apiError = isClosedRoomError(error)
				? $t('admin.chatRooms.detail.roomClosedHint')
				: error?.message || $t('admin.chatRooms.errors.roomUpdate');
			if (isClosedRoomError(error)) {
				syncClosedRoomUiState();
				queueSnapshotRefresh({ markRead: true, forceScroll: false });
			}
		} finally {
			roomActionBusy = '';
		}
	};

	const sendMessage = async () => {
		const text = composerText.trim();
		if (!text || sendingMessage || roomSwitchBusy) return;
		if (roomHandledByOtherAdmin) {
			apiError = $t('admin.chatRooms.detail.otherConsultantHint');
			return;
		}
		if (roomClosed) {
			apiError = $t('admin.chatRooms.detail.roomClosedHint');
			syncClosedRoomUiState();
			return;
		}
		const clientRequestId = `live_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
		optimisticMessages = [
			...optimisticMessages,
			{
				role: 'consultant',
				text,
				createdAt: new Date().toISOString(),
				meta: {
					clientRequestId,
					adminName: currentAdmin?.name || currentAdmin?.email,
					adminEmail: currentAdmin?.email || '',
					accountLabel: currentAdmin?.name || currentAdmin?.email || ''
				}
			}
		];
		composerText = '';
		resizeComposer();
		window.clearTimeout(typingIdleHandle);
		queueTyping(false);
		updateLocalLiveSupport({
			status: 'handoff',
			assignedTo: session?.assignedTo || {
				_id: currentAdmin?.userId,
				name: currentAdmin?.name,
				email: currentAdmin?.email
			},
			assignedAt: session?.assignedAt || new Date().toISOString(),
			liveSupport: {
				active: true,
				channel: 'admin_console',
				adminName: currentAdmin?.name || liveSupport?.adminName,
				adminEmail: currentAdmin?.email || liveSupport?.adminEmail,
				accountLabel: currentAdmin?.name || currentAdmin?.email || liveSupport?.accountLabel,
				lastMessageAt: new Date().toISOString(),
				typing: {
					active: false,
					source: 'admin_console',
					updatedAt: new Date().toISOString(),
					until: null
				}
			}
		});
		sendingMessage = true;
		await scrollToBottom();
		try {
			await patchRoom({ messageText: text, messageClientId: clientRequestId, markRead: true });
			await fetchSnapshot({ forceScroll: true, markRead: true });
			queueRoomListRefresh();
			apiError = '';
		} catch (error) {
			optimisticMessages = optimisticMessages.filter(
				(message) => message?.meta?.clientRequestId !== clientRequestId
			);
			composerText = text;
			resizeComposer();
			apiError = isClosedRoomError(error)
				? $t('admin.chatRooms.detail.roomClosedHint')
				: error?.message || $t('admin.chatRooms.errors.roomUpdate');
			if (isClosedRoomError(error)) {
				syncClosedRoomUiState();
				queueSnapshotRefresh({ markRead: true, forceScroll: false });
			}
		} finally {
			sendingMessage = false;
		}
	};

	const handleComposerInput = (event) => {
		if (roomHandledByOtherAdmin) return;
		composerText = event.currentTarget.value;
		resizeComposer();
		if (!composerText.trim()) {
			window.clearTimeout(typingIdleHandle);
			queueTyping(false);
			return;
		}
		queueTyping(true);
		scheduleTypingIdle();
	};

	const applyCannedReply = async (reply) => {
		if (roomHandledByOtherAdmin || roomClosed || roomSwitchBusy) return;
		composerText = [composerText, reply?.text || ''].filter(Boolean).join(composerText ? '\n' : '');
		resizeComposer();
		await tick();
		composerEl?.focus();
	};

	const transferRoom = async () => {
		if (!selectedConsultantAdminId || roomSwitchBusy) return;
		await performRoomAction(
			'transfer',
			{ transferToAdminId: selectedConsultantAdminId, markRead: true },
			$t('admin.chatRooms.success.roomTransferred')
		);
		selectedConsultantAdminId = '';
		consultantSearch = '';
		highlightedConsultantIndex = -1;
		sidePanelMode = '';
	};

	const handleRealtimeEvent = (event) => {
		const action = String(event?.action || '')
			.trim()
			.toLowerCase();
		const eventAdminId = String(event?.payload?.adminId || '').trim();
		const currentAdminId = String(currentAdmin?.userId || '').trim();
		if (action === 'read' && eventAdminId && currentAdminId && eventAdminId === currentAdminId) {
			return;
		}
		const shouldMarkRead =
			String(event?.source || '')
				.trim()
				.toLowerCase() === 'openclaw';
		queueRoomListRefresh();
		if (roomSwitchBusy) return;
		queueSnapshotRefresh({ markRead: shouldMarkRead, forceScroll: false });
	};

	onMount(() => {
		if (!browser) return undefined;
		const clock = window.setInterval(() => {
			nowTs = Date.now();
		}, 1000);
		const handleWindowPointer = (event) => {
			if (!menuOpen || !menuHost) return;
			if (!menuHost.contains(event.target)) menuOpen = false;
		};
		const handleWindowKey = (event) => {
			if (event.key === 'Escape') menuOpen = false;
		};
		const listStream = new EventSource('/admin/api/chat-rooms/stream');
		listStream.addEventListener('room', () => {
			queueRoomListRefresh();
		});
		listStream.addEventListener('ready', () => {
			streamError = false;
		});
		listStream.onerror = () => {
			streamError = true;
		};
		void tick().then(async () => {
			resizeComposer();
			if (session?.sessionId) await scrollToBottom('auto');
		});
		window.addEventListener('pointerdown', handleWindowPointer);
		window.addEventListener('keydown', handleWindowKey);
		return () => {
			window.clearInterval(clock);
			window.clearTimeout(typingIdleHandle);
			window.removeEventListener('pointerdown', handleWindowPointer);
			window.removeEventListener('keydown', handleWindowKey);
			listStream.close();
		};
	});

	$effect(() => {
		if (!browser || !session?.sessionId) return undefined;
		const stream = new EventSource(`/admin/api/chat-rooms/${session.sessionId}/stream`);
		stream.addEventListener('room', (rawEvent) => {
			try {
				const parsed = JSON.parse(rawEvent.data);
				handleRealtimeEvent(parsed);
			} catch (error) {
				console.error('[chat-room] invalid realtime payload', error);
			}
		});
		stream.addEventListener('ready', () => {
			streamError = false;
		});
		stream.onerror = () => {
			streamError = true;
		};
		return () => {
			stream.close();
		};
	});

	$effect(() => {
		if (!roomState?.session?.sessionId) return;
		cacheRoomSnapshot(roomState);
	});

	$effect(() => {
		if (!roomClosed) return;
		syncClosedRoomUiState();
	});

	$effect(() => {
		roomListSearch;
		roomListScope;
		roomListPage = 1;
	});

	$effect(() => {
		const maxPage = totalRoomListPages;
		if (roomListPage > maxPage) {
			roomListPage = maxPage;
		}
		if (roomListPage < 1) {
			roomListPage = 1;
		}
	});

	$effect(() => {
		const autoPageKey = roomListAutoPageKey;
		if (!autoPageKey || autoPageKey === lastRoomListAutoPageKey) return;
		lastRoomListAutoPageKey = autoPageKey;

		const currentSessionId = String(session?.sessionId || '');
		if (!currentSessionId) return;

		const currentIndex = sortedFilteredRoomList.findIndex(
			(item) => String(item?.sessionId || '') === currentSessionId
		);
		if (currentIndex >= 0) {
			roomListPage = Math.floor(currentIndex / roomListPageSize) + 1;
		}
	});
</script>

<svelte:head>
	<title>{$t('admin.chatRooms.detailTitle')} | Inoxpran Chat</title>
</svelte:head>

{#if !room || !session}
	<section class="room-detail-empty">
		<h1>{$t('admin.chatRooms.detailTitle')}</h1>
		<p>{apiError || $t('admin.chatRooms.errors.notFound')}</p>
		<a class="room-detail-empty__link" href={returnTo}>{$t('admin.chatRooms.backToList')}</a>
	</section>
{:else}
	<section class="room-detail-page">
		<header class="room-detail-page__header">
			<div class="room-detail-page__header-main">
				<a class="room-detail-page__back" href={returnTo}>{$t('admin.chatRooms.backToList')}</a>
				<div>
					<h1>{$t('admin.chatRooms.detailTitle')}</h1>
					<p>{$t('admin.chatRooms.lede')}</p>
				</div>
			</div>
			<div class="room-detail-page__header-badges">
				<span class={`status-pill status-pill--${String(session.status || 'open').toLowerCase()}`}
					>{statusLabel(session.status)}</span
				>
				{#if summary.unreadCount > 0}
					<span class="status-pill status-pill--attention"
						>{$t('admin.chatRooms.detail.unreadCustomerMessages')}: {summary.unreadCount}</span
					>
				{/if}
				{#if showSlaBadge}
					<span class={`status-pill status-pill--${slaTone(sla)}`}>{slaLabel(sla)}</span>
				{/if}
			</div>
		</header>

		<div
			class={`room-detail-page__layout ${sidePanelMode ? 'room-detail-page__layout--with-panel' : ''}`}
		>
			<aside class="room-switcher">
				<div class="room-switcher__header">
					<div>
						<h2>{$t('admin.chatRooms.detail.inboxTitle')}</h2>
						<p>{$t('admin.chatRooms.detail.inboxDesc')}</p>
					</div>
					<span class="room-switcher__count">{filteredRoomList.length}</span>
				</div>

				<label class="room-switcher__search">
					<span>{$t('common.search')}</span>
					<input
						type="search"
						bind:value={roomListSearch}
						placeholder={$t('admin.chatRooms.detail.inboxSearchPlaceholder')}
					/>
				</label>

				<div
					class="room-switcher__tabs"
					role="tablist"
					aria-label={$t('admin.chatRooms.detail.inboxTitle')}
				>
					<button
						type="button"
						class:active={roomListScope === 'all'}
						onclick={() => (roomListScope = 'all')}
					>
						{$t('admin.chatRooms.detail.inboxAll')}
					</button>
					<button
						type="button"
						class:active={roomListScope === 'unread'}
						onclick={() => (roomListScope = 'unread')}
					>
						{$t('admin.chatRooms.detail.inboxUnread')}
					</button>
					<button
						type="button"
						class:active={roomListScope === 'mine'}
						onclick={() => (roomListScope = 'mine')}
					>
						{$t('admin.chatRooms.detail.inboxMine')}
					</button>
				</div>

				<div class="room-switcher__list">
					{#if groupedRoomList.length}
						{#each groupedRoomList as group (group.key)}
							<section class="room-switcher__section">
								<header class="room-switcher__section-label">{group.label}</header>
								<div class="room-switcher__section-items">
									{#each group.items as roomItem (roomItem.sessionId)}
										<a
											class="room-switcher__item"
											class:active={roomItem.sessionId === activeRoomSelectionId}
											class:pending={roomItem.sessionId === roomSwitchTargetId}
											href={roomListHref(roomItem.sessionId)}
											data-sveltekit-preload-data="hover"
											aria-label={`${$t('admin.chatRooms.detail.inboxOpenRoom')}: ${roomListTitle(roomItem)}`}
											aria-busy={roomItem.sessionId === roomSwitchTargetId}
											onclick={(event) => handleRoomListSelection(event, roomItem.sessionId)}
										>
											<div class="room-switcher__avatar">
												{String(roomListTitle(roomItem) || 'K')
													.slice(0, 1)
													.toUpperCase()}
											</div>
											<div class="room-switcher__body">
												<div class="room-switcher__row">
													<strong>{roomListTitle(roomItem)}</strong>
													<time>{formatSidebarTime(roomActivityAt(roomItem))}</time>
												</div>
												<div class="room-switcher__row room-switcher__row--snippet">
													<p>{roomListPreview(roomItem)}</p>
													{#if Number(roomItem?.unreadCount || 0) > 0}
														<span class="room-switcher__unread"
															>{Number(roomItem.unreadCount) > 99
																? '99+'
																: roomItem.unreadCount}</span
														>
													{/if}
												</div>
												<div class="room-switcher__meta">
													<span
														class={`room-switcher__status room-switcher__status--${String(roomItem?.status || 'open').toLowerCase()}`}
													>
														{statusLabel(roomItem?.status)}
													</span>
													<span class="room-switcher__code"
														>{extractRoomCode(roomItem?.sessionId)}</span
													>
													{#if roomItemHandledByOtherAdmin(roomItem)}
														<span class="room-switcher__busy-admin"
															>{$t('admin.chatRooms.detail.otherConsultantBadge')}</span
														>
													{/if}
													{#if roomOwnedByCurrentAdmin(roomItem)}
														<span class="room-switcher__mine"
															>{$t('admin.chatRooms.detail.inboxMine')}</span
														>
													{/if}
													{#if roomItem.sessionId === session.sessionId}
														<span class="room-switcher__current"
															>{$t('admin.chatRooms.detail.inboxCurrentRoom')}</span
														>
													{/if}
												</div>
											</div>
										</a>
									{/each}
								</div>
							</section>
						{/each}
					{:else}
						<div class="room-switcher__empty">{$t('admin.chatRooms.detail.inboxEmpty')}</div>
					{/if}
				</div>

				{#if filteredRoomList.length > roomListPageSize}
					<div class="room-switcher__nav">
						<button
							type="button"
							class="room-switcher__nav-btn"
							disabled={!canGoPrevRoomPage}
							onclick={() => (roomListPage = Math.max(1, roomListPage - 1))}
						>
							{$t('admin.chatRooms.pagination.previous')}
						</button>
						<span class="room-switcher__nav-label">
							{$t('admin.chatRooms.pagination.page')}
							{roomListPage}/{totalRoomListPages}
						</span>
						<button
							type="button"
							class="room-switcher__nav-btn"
							disabled={!canGoNextRoomPage}
							onclick={() => (roomListPage = Math.min(totalRoomListPages, roomListPage + 1))}
						>
							{$t('admin.chatRooms.pagination.next')}
						</button>
					</div>
				{/if}
			</aside>

			<section class="room-console" aria-busy={roomSwitchBusy}>
				<div class="room-console__header">
					<div class="room-console__identity">
						<div class="room-console__avatar">{customerInitial}</div>
						<div class="room-console__identity-copy">
							<div class="room-console__title-row">
								<span class="room-console__eyebrow"
									>{$t('admin.chatRooms.detail.liveConversation')}</span
								>
								<span
									class={`room-chip room-chip--presence room-chip--${presenceStateClass(customerPresence?.state)}`}
									>{presenceLabel(customerPresence?.state)}</span
								>
							</div>
							<h2>{customerLabel}</h2>
							<div class="room-console__identity-meta">
								<span class="room-console__path">{session?.sourcePath || '/'}</span>
								<time class="room-console__created-at" datetime={session?.createdAt || undefined}>
									{formatDateTime(session?.createdAt)}
								</time>
							</div>
							<div class="room-console__status-strip">
								<span class="room-chip room-chip--consultant">{currentConsultant}</span>
								{#if roomHandledByOtherAdmin}
									<span class="room-chip room-chip--locked"
										>{$t('admin.chatRooms.detail.otherConsultantBadge')}</span
									>
								{/if}
							</div>
						</div>
					</div>

					<div class="room-console__actions">
						{#if canClaimRoom && !liveSupport?.active}
							<button
								type="button"
								class="btn-primary btn-primary--claim"
								disabled={roomActionBusy === 'claim' || roomSwitchBusy}
								onclick={() =>
									performRoomAction(
										'claim',
										{ claimRoom: true, markRead: true },
										$t('admin.chatRooms.success.roomClaimed'),
										true
									)}
							>
								{$t('admin.chatRooms.detail.claimRoom')}
							</button>
						{/if}
						<div class="room-console__menu" bind:this={menuHost}>
							<button
								type="button"
								class="btn-icon btn-icon--ghost"
								aria-label={$t('admin.chatRooms.detail.moreActions')}
								aria-expanded={menuOpen}
								onclick={toggleMenu}
							>
								<span></span><span></span><span></span>
							</button>
							{#if menuOpen}
								<div class="room-console__menu-panel">
									<div class="room-console__menu-section">
										<p>{$t('admin.chatRooms.detail.roomSummary')}</p>
										<button type="button" onclick={() => toggleSidePanel('overview')}>
											{sidePanelMode === 'overview'
												? $t('common.close')
												: $t('admin.chatRooms.detail.roomSummary')}
										</button>
										<button
											type="button"
											disabled={roomClosed}
											onclick={() => toggleSidePanel('transfer')}
										>
											{$t('admin.chatRooms.detail.transferRoom')}
										</button>
									</div>
									<div class="room-console__menu-section">
										<p>{$t('admin.chatRooms.detail.settings')}</p>
										<button
											type="button"
											disabled={!liveSupport?.active || roomActionBusy === 'release'}
											onclick={() =>
												performRoomAction(
													'release',
													{ releaseRoom: true, markRead: true },
													$t('admin.chatRooms.success.roomReleased')
												)}
										>
											{$t('admin.chatRooms.detail.releaseRoom')}
										</button>
										{#if roomClosed}
											<button
												type="button"
												disabled={roomActionBusy === 'reopen'}
												onclick={() =>
													performRoomAction(
														'reopen',
														{ status: 'handoff', reopen: true, markRead: true },
														$t('admin.chatRooms.success.roomReopened')
													)}
											>
												{$t('admin.chatRooms.detail.reopenRoom')}
											</button>
										{:else}
											<button
												type="button"
												disabled={roomActionBusy === 'close'}
												onclick={() =>
													performRoomAction(
														'close',
														{ status: 'closed', markResolved: true, markRead: true },
														$t('admin.chatRooms.success.roomClosed')
													)}
											>
												{$t('admin.chatRooms.detail.closeRoom')}
											</button>
										{/if}
									</div>
								</div>
							{/if}
						</div>
					</div>
				</div>

				{#if apiError}
					<div class="notice notice--error">{apiError}</div>
				{/if}
				{#if roomSwitchBusy && !roomSwitchError}
					<div class="notice notice--info">Đang chuyển sang phòng chat mới...</div>
				{/if}
				{#if streamError && !apiError}
					<div class="notice notice--error">{$t('admin.chatRooms.errors.realtimeInterrupted')}</div>
				{/if}
				{#if infoMessage}
					<div class="notice notice--info">{infoMessage}</div>
				{/if}

				<div
					class="room-console__messages"
					bind:this={conversationEl}
					onscroll={updateViewportState}
				>
					{#each mergedMessages as message, index (`${message._id || message.meta?.clientRequestId || index}`)}
						<div class={`message-row message-row--${String(message.role || 'user').toLowerCase()}`}>
							<div
								class={`message-bubble message-bubble--${String(message.role || 'user').toLowerCase()} ${message.meta?.clientRequestId && !message._id ? 'is-optimistic' : ''}`}
							>
								{#if String(message.role || '').toLowerCase() !== 'system'}
									<div class="message-bubble__label">{roleLabel(message)}</div>
								{/if}
								<p>{message.text}</p>
								<div class="message-bubble__meta">
									<span>{formatDateTime(message.createdAt)}</span>
									{#if message.meta?.clientRequestId && !message._id}
										<strong>{$t('common.loading')}</strong>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>

				<div class="room-console__composer">
					{#if cannedReplies.length}
						<div class="room-console__quick-replies">
							{#each cannedReplies as reply}
								<button
									type="button"
									class="quick-reply"
									disabled={roomHandledByOtherAdmin || roomClosed || roomSwitchBusy}
									onclick={() => applyCannedReply(reply)}
								>
									>{reply.text}</button
								>
							{/each}
						</div>
					{/if}

					<div
						class="room-console__composer-box"
						class:room-console__composer-box--readonly={roomHandledByOtherAdmin}
					>
						<div class="room-console__composer-head">
							<div>
								<span>{$t('admin.chatRooms.detail.replyingAs')}</span>
								<strong>{adminLabel}</strong>
							</div>
						</div>
						<textarea
							bind:this={composerEl}
							bind:value={composerText}
							rows="1"
							placeholder={$t('admin.chatRooms.detail.composerPlaceholder')}
							oninput={handleComposerInput}
							onkeydown={(event) => {
								if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
									event.preventDefault();
									void sendMessage();
								}
							}}
							disabled={roomClosed || roomSwitchBusy || roomHandledByOtherAdmin}
						></textarea>
						<div class="room-console__composer-foot">
							<p>
								{roomHandledByOtherAdmin
									? $t('admin.chatRooms.detail.otherConsultantHint')
									: roomClosed
										? $t('admin.chatRooms.detail.roomClosedHint')
										: $t('admin.chatRooms.detail.composerHelp')}
							</p>
							<button
								type="button"
								class="btn-primary"
								disabled={sendingMessage ||
									roomClosed ||
									roomSwitchBusy ||
									roomHandledByOtherAdmin ||
									!composerText.trim()}
								onclick={sendMessage}
							>
								{$t('admin.chatRooms.detail.sendMessage')}
							</button>
						</div>
					</div>
				</div>
			</section>

			{#if sidePanelMode}
				<aside class="room-panel">
					<div class="room-panel__header">
						<div>
							<h3>
								{sidePanelMode === 'transfer'
									? $t('admin.chatRooms.detail.transferRoom')
									: $t('admin.chatRooms.detail.roomSummary')}
							</h3>
							<p>
								{sidePanelMode === 'transfer'
									? $t('admin.chatRooms.detail.findConsultantHelp')
									: $t('admin.chatRooms.detail.liveConversationDesc')}
							</p>
						</div>
						<button
							type="button"
							class="room-panel__close"
							aria-label={$t('common.close')}
							onclick={() => (sidePanelMode = '')}
						>
							<span aria-hidden="true">&times;</span>
						</button>
					</div>

					{#if sidePanelMode === 'overview'}
						<div class="room-panel__cards">
							<div class="room-panel__code-card">
								<span>{$t('admin.chatRooms.detail.roomCode')}</span>
								<strong>{roomCodeValue}</strong>
								<button type="button" onclick={() => copyToClipboard(roomCodeValue, 'room')}>
									{copiedRoomCode
										? $t('admin.chatRooms.table.copied')
										: $t('admin.chatRooms.detail.copyRoomCode')}
								</button>
							</div>
							<div class="room-panel__code-card">
								<span>{$t('admin.chatRooms.table.sessionId')}</span>
								<strong>{session.sessionId}</strong>
								<button type="button" onclick={() => copyToClipboard(session.sessionId, 'session')}>
									{copiedSessionId
										? $t('admin.chatRooms.table.copied')
										: $t('admin.chatRooms.detail.copySessionId')}
								</button>
							</div>
						</div>

						<div class="room-panel__facts">
							<div>
								<span>{$t('admin.chatRooms.detail.roomHealth')}</span><strong
									>{slaLabel(sla)}</strong
								>
							</div>
							<div>
								<span>{$t('admin.chatRooms.detail.currentConsultant')}</span><strong
									>{currentConsultant}</strong
								>
							</div>
							<div>
								<span>{$t('admin.chatRooms.detail.customerPresence')}</span><strong
									>{presenceLabel(customerPresence?.state)}</strong
								>
							</div>
							<div>
								<span>{$t('admin.chatRooms.detail.claimedAt')}</span><strong
									>{formatDateTime(liveSupport?.claimedAt)}</strong
								>
							</div>
							<div>
								<span>{$t('admin.chatRooms.detail.lastConsultantReply')}</span><strong
									>{liveSupport?.lastMessageAt
										? formatRelativeTime(liveSupport.lastMessageAt)
										: '--'}</strong
								>
							</div>
							<div>
								<span>{$t('admin.chatRooms.detail.messagesReturned')}</span><strong
									>{summary.returnedMessageCount}/{summary.messageCount}</strong
								>
							</div>
							<div>
								<span>{$t('admin.chatRooms.detail.latestLead')}</span><strong
									>{latestLead?.phone || '--'}</strong
								>
							</div>
							<div>
								<span>{$t('admin.chatRooms.detail.sourcePath')}</span><strong
									>{session?.sourcePath || '--'}</strong
								>
							</div>
						</div>
					{:else}
						<div class="room-panel__transfer">
							<input
								type="search"
								value={consultantSearch}
								placeholder={$t('admin.chatRooms.detail.findConsultantPlaceholder')}
								oninput={(event) => {
									consultantSearch = event.currentTarget.value;
									selectedConsultantAdminId = '';
									highlightedConsultantIndex = filteredConsultants.length ? 0 : -1;
								}}
								onkeydown={(event) => {
									if (!filteredConsultants.length) return;
									if (event.key === 'ArrowDown') {
										event.preventDefault();
										highlightedConsultantIndex = Math.min(
											filteredConsultants.length - 1,
											highlightedConsultantIndex + 1
										);
									} else if (event.key === 'ArrowUp') {
										event.preventDefault();
										highlightedConsultantIndex = Math.max(0, highlightedConsultantIndex - 1);
									} else if (event.key === 'Enter' && highlightedConsultantIndex >= 0) {
										event.preventDefault();
										const candidate = filteredConsultants[highlightedConsultantIndex];
										selectedConsultantAdminId = String(candidate.adminId);
										consultantSearch =
											candidate.adminName || candidate.accountLabel || candidate.adminEmail || '';
									}
								}}
							/>
							<div class="room-panel__consultants">
								{#if filteredConsultants.length}
									{#each filteredConsultants as consultant, index}
										<button
											type="button"
											class:selected={String(selectedConsultantAdminId) ===
												String(consultant.adminId)}
											class:highlighted={index === highlightedConsultantIndex}
											onclick={() => {
												selectedConsultantAdminId = String(consultant.adminId);
												consultantSearch =
													consultant.adminName ||
													consultant.accountLabel ||
													consultant.adminEmail ||
													'';
											}}
										>
											<strong>{consultant.adminName || consultant.accountLabel}</strong>
											<span>{consultant.adminEmail || consultant.accountLabel}</span>
											<div class="room-panel__consultant-badges">
												<small class:active={consultant.onShift}
													>{consultant.onShift
														? $t('admin.chatRooms.detail.consultantOnShift')
														: $t('admin.chatRooms.detail.consultantOffShift')}</small
												>
												<small class:active={consultant.supportsAutoAssign}
													>{consultant.supportsAutoAssign
														? $t('admin.chatRooms.detail.autoAssignOn')
														: $t('admin.chatRooms.detail.autoAssignOff')}</small
												>
											</div>
										</button>
									{/each}
								{:else}
									<div class="room-panel__empty">
										{$t('admin.chatRooms.detail.noConsultantAvailable')}
									</div>
								{/if}
							</div>
							<button
								type="button"
								class="btn-dark"
								disabled={!selectedConsultantAdminId ||
									roomClosed ||
									roomSwitchBusy ||
									roomActionBusy === 'transfer'}
								onclick={transferRoom}
							>
								{$t('admin.chatRooms.detail.transferRoom')}
							</button>
						</div>
					{/if}
				</aside>
			{/if}
		</div>
	</section>
{/if}

<style>
	:global(body) {
		overflow: hidden;
	}

	.room-detail-page {
		--font-sans:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', 'Roboto', sans-serif;
		--primary: #0d8b7e;
		--primary-dark: #0a6b63;
		--primary-light: #d0f0ed;
		--surface: #ffffff;
		--surface-secondary: #f6f7f9;
		--surface-tertiary: #f0f2f5;
		--border: #e0e2e8;
		--border-2: #d0d4db;
		--text-primary: #1a1a1a;
		--text-secondary: #65727d;
		--text-tertiary: #949ca8;
		--success: #2e7d22;
		--warning: #d97706;
		--error: #dc2626;
		--info: #2563eb;
		--graphite: #1f2937;
		--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1);
		--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.1);
		--shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.12);

		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		display: grid;
		grid-template-rows: auto 1fr;
		min-height: 100vh;
		color: var(--text-primary);
		font-family: var(--font-sans);
		background: var(--surface);
		overflow: hidden;
	}

	.room-detail-empty,
	.room-detail-page__header,
	.room-switcher,
	.room-console,
	.room-panel {
		position: relative;
		z-index: 1;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 28px;
		backdrop-filter: blur(18px);
		box-shadow: var(--shadow);
	}

	.room-detail-empty {
		padding: 2rem;
		display: grid;
		gap: 1rem;
		max-width: 520px;
		background:
			radial-gradient(circle at top left, rgba(21, 120, 106, 0.16), transparent 42%),
			rgba(255, 255, 255, 0.9);
	}

	.room-detail-empty__link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 40px;
		padding: 0 1rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: rgba(255, 255, 255, 0.9);
		color: var(--ink);
		text-decoration: none;
		font-size: 0.85rem;
		font-weight: 700;
		transition:
			transform 0.18s ease,
			border-color 0.18s ease,
			box-shadow 0.18s ease;
	}

	.room-detail-empty__link:hover {
		transform: translateY(-1px);
		border-color: rgba(21, 120, 106, 0.28);
		box-shadow: 0 12px 24px rgba(15, 23, 42, 0.1);
	}

	.room-detail-page__header {
		padding: 0.75rem 1.5rem;
		display: flex;
		justify-content: space-between;
		gap: 1.5rem;
		align-items: center;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}

	.room-detail-page__header-main {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.room-detail-page__header h1,
	.room-console__identity-copy h2,
	.room-panel__header h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.room-detail-page__header p,
	.room-detail-page__header a,
	.room-console__identity-copy p,
	.notice,
	.room-panel__header p {
		margin: 0;
	}

	.room-detail-page__back {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 36px;
		padding: 0 0.85rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface);
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-secondary);
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.room-detail-page__back:hover {
		background: var(--surface-secondary);
		border-color: var(--primary);
		color: var(--primary);
	}

	.room-detail-page__header h1 {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.room-detail-page__header-badges {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-left: auto;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 28px;
		padding: 0.4rem 0.85rem;
		border-radius: 20px;
		font-size: 0.75rem;
		font-weight: 600;
		border: 1px solid transparent;
		white-space: nowrap;
	}

	.status-pill--open,
	.status-pill--active {
		background: #dcfce7;
		color: #166534;
		border-color: #bbf7d0;
	}

	.status-pill--handoff,
	.status-pill--waiting {
		background: #dbeafe;
		color: #1d4ed8;
		border-color: #bfdbfe;
	}

	.status-pill--closed,
	.status-pill--neutral {
		background: #e5e7eb;
		color: #374151;
		border-color: #d1d5db;
	}

	.status-pill--warning {
		background: #fef3c7;
		color: #92400e;
		border-color: #fcd34d;
	}

	.status-pill--critical {
		background: #fee2e2;
		color: #b91c1c;
		border-color: #fecaca;
	}

	.status-pill--attention {
		background: var(--primary-light);
		color: var(--primary-dark);
		border-color: #a7d8cc;
	}

	.room-detail-page__layout {
		display: grid;
		grid-template-columns: 300px 1fr;
		gap: 0;
		min-height: 0;
		flex: 1;
		overflow: hidden;
	}

	.room-detail-page__layout--with-panel {
		grid-template-columns: 300px 1fr 340px;
	}

	.room-switcher {
		display: grid;
		grid-template-rows: auto auto minmax(0, 1fr) auto;
		gap: 0;
		padding: 0;
		min-height: 0;
		height: 100%;
		max-height: 100%;
		overflow: hidden;
		background: var(--surface);
		border-right: 1px solid var(--border);
	}

	.room-switcher__header {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: flex-start;
		padding: 1rem;
		background: var(--surface);
	}

	.room-switcher__header h2 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.room-switcher__header p {
		margin: 0.15rem 0 0;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--text-tertiary);
	}

	.room-switcher__count {
		min-width: 32px;
		height: 28px;
		padding: 0 0.65rem;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--primary-light);
		color: var(--primary-dark);
		font-size: 0.75rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.room-switcher__search {
		display: grid;
		gap: 0.4rem;
		padding: 0 0.8rem 0.8rem;
		background: var(--surface);
	}

	.room-switcher__search span {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}

	.room-switcher__search input {
		height: 40px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-secondary);
		padding: 0 0.85rem;
		font: inherit;
		color: var(--text-primary);
		outline: none;
		transition: all 0.2s ease;
		font-size: 0.85rem;
	}

	.room-switcher__search input:focus {
		border-color: var(--primary);
		background: var(--surface);
		box-shadow: inset 0 0 0 3px rgba(13, 139, 126, 0.1);
	}

	.room-switcher__tabs {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		padding: 0 0.8rem 0.8rem;
		background: var(--surface);
	}

	.room-switcher__tabs button {
		height: 32px;
		padding: 0 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--surface-secondary);
		color: var(--text-secondary);
		font: inherit;
		font-weight: 600;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.room-switcher__tabs button.active {
		background: var(--primary);
		color: #fff;
		border-color: var(--primary);
	}

	.room-switcher__tabs button:hover:not(.active) {
		background: var(--surface-tertiary);
		border-color: var(--border-2);
	}

	.room-switcher__list {
		min-height: 0;
		overflow-y: auto;
		display: grid;
		gap: 0.4rem;
		padding: 0.4rem 0.4rem;
		scrollbar-gutter: stable;
	}

	.room-switcher__list::-webkit-scrollbar {
		width: 6px;
	}

	.room-switcher__list::-webkit-scrollbar-track {
		background: transparent;
	}

	.room-switcher__list::-webkit-scrollbar-thumb {
		background: rgba(0, 0, 0, 0.1);
		border-radius: 3px;
	}

	.room-switcher__list::-webkit-scrollbar-thumb:hover {
		background: rgba(0, 0, 0, 0.2);
	}

	.room-switcher__nav {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 0.5rem;
		padding: 0.8rem;
		border-top: 1px solid var(--border);
		background: var(--surface);
	}

	.room-switcher__nav-btn {
		flex: 1;
		height: 36px;
		padding: 0 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--surface-secondary);
		color: var(--text-primary);
		font: inherit;
		font-weight: 600;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.room-switcher__nav-btn:hover:not(:disabled) {
		background: var(--surface-tertiary);
		border-color: var(--border-2);
	}

	.room-switcher__nav-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.room-switcher__nav-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
		text-align: center;
		flex: 0 0 auto;
		padding: 0 0.5rem;
	}

	.room-switcher__section {
		display: grid;
		gap: 0;
	}

	.room-switcher__section-label {
		position: sticky;
		top: -2%;
		z-index: 2;
		padding: 0.5rem 0.35rem 0.35rem;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		background: linear-gradient(180deg, var(--surface-secondary) 90%, rgba(255, 255, 255, 0.5));
		margin-top: 40px;
	}

	.room-switcher__section-items {
		display: grid;
		gap: 0.35rem;
		padding: 0 0.35rem;
		margin-top: 15px;
	}

	.room-switcher__item {
		display: grid;
		grid-template-columns: 44px 1fr;
		gap: 0.7rem;
		padding: 0.6rem 0.7rem;
		text-decoration: none;
		color: inherit;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		transition: all 0.2s ease;
		position: relative;
		overflow: hidden;
	}

	.room-switcher__item:hover {
		background: var(--surface-secondary);
		border-color: var(--border-2);
	}

	.room-switcher__item.active {
		background: var(--primary-light);
		border-color: var(--primary);
		box-shadow: inset 0 0 0 2px var(--primary);
	}

	.room-switcher__item.pending {
		opacity: 0.7;
		pointer-events: none;
	}

	.room-switcher__avatar {
		width: 44px;
		height: 44px;
		border-radius: 8px;
		background: linear-gradient(135deg, var(--primary), #0aa18f);
		color: #fff;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.room-switcher__body {
		min-width: 0;
		display: grid;
		gap: 0.35rem;
	}

	.room-switcher__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		min-width: 0;
	}

	.room-switcher__row strong {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.85rem;
		color: var(--text-primary);
		font-weight: 600;
	}

	.room-switcher__row time {
		flex: 0 0 auto;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-weight: 500;
	}

	.room-switcher__row--snippet {
		align-items: flex-start;
		gap: 0.5rem;
	}

	.room-switcher__row--snippet p {
		margin: 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8rem;
		color: var(--text-tertiary);
		flex: 1;
	}

	.room-switcher__unread {
		flex: 0 0 auto;
		min-width: 20px;
		height: 20px;
		padding: 0 0.35rem;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--graphite);
		color: #fff;
		font-size: 0.7rem;
		font-weight: 700;
	}

	.room-switcher__meta {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.room-switcher__status,
	.room-switcher__code,
	.room-switcher__mine,
	.room-switcher__current,
	.room-switcher__busy-admin {
		display: inline-flex;
		align-items: center;
		min-height: 20px;
		padding: 0.2rem 0.45rem;
		border-radius: 6px;
		font-size: 0.65rem;
		font-weight: 600;
		border: none;
	}

	.room-switcher__status--open {
		background: #dcfce7;
		color: #166534;
	}

	.room-switcher__status--handoff {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.room-switcher__status--closed {
		background: #f3f4f6;
		color: #6b7280;
	}

	.room-switcher__code {
		background: rgba(13, 139, 126, 0.08);
		color: var(--primary);
	}

	.room-switcher__mine {
		background: #fef3c7;
		color: #92400e;
	}

	.room-switcher__current {
		background: var(--primary-light);
		color: var(--primary-dark);
	}

	.room-switcher__busy-admin {
		background: #fee2e2;
		color: #b91c1c;
	}

	.room-switcher__empty {
		margin: 1.5rem 0.8rem 0;
		padding: 1.5rem 1rem;
		border-radius: 10px;
		background: var(--surface-secondary);
		border: 1px dashed var(--border-2);
		text-align: center;
		color: var(--text-tertiary);
		font-size: 0.8rem;
	}

	.room-console {
		min-height: 0;
		height: 100%;
		max-height: 100%;
		align-self: start;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--surface);
	}

	.room-console__header {
		padding: 0.5rem 0.9rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		min-height: 48px;
		flex-wrap: nowrap;
	}

	.room-console__identity {
		display: flex;
		gap: 0.5rem;
		min-width: 0;
		align-items: center;
		flex: 1;
	}

	.room-console__avatar {
		width: 42px;
		height: 42px;
		border-radius: 6px;
		background: linear-gradient(135deg, var(--primary), #0aa18f);
		color: #fff;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.8rem;
		flex-shrink: 0;
	}

	.room-console__identity-copy {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		flex: 1;
		flex-wrap: nowrap;
	}

	.room-console__title-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: nowrap;
		flex-shrink: 0;
	}

	.room-console__eyebrow {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.room-console__identity-copy h2 {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
		line-height: 1.1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex-shrink: 0;
	}

	.room-console__identity-copy p {
		color: var(--text-secondary);
		font-size: 0.7rem;
		line-height: 1.1;
	}

	.room-console__identity-meta {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: nowrap;
		min-width: 0;
		color: var(--text-secondary);
		font-size: 0.65rem;
		line-height: 1.1;
		flex-shrink: 0;
	}

	.room-console__path {
		padding: 0.15rem 0.4rem;
		border-radius: 3px;
		background: var(--surface-secondary);
		border: 0.5px solid var(--border);
		color: var(--text-secondary);
		font-size: 0.65rem;
		white-space: nowrap;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.room-console__created-at {
		position: relative;
		padding-left: 0.4rem;
		color: var(--text-secondary);
		font-size: 0.65rem;
		white-space: nowrap;
	}

	.room-console__created-at::before {
		content: '';
		position: absolute;
		left: 0;
		top: 50%;
		width: 0.5px;
		height: 9px;
		background: rgba(0, 0, 0, 0.08);
		transform: translateY(-50%);
	}

	.room-console__status-strip {
		display: flex;
		gap: 0.25rem;
		flex-wrap: nowrap;
		align-items: center;
		flex-shrink: 0;
	}

	.room-chip {
		display: inline-flex;
		align-items: center;
		max-width: 100%;
		padding: 0.3rem 0.6rem;
		border-radius: 5px;
		font-size: 0.7rem;
		font-weight: 600;
		border: 1px solid var(--border);
		background: var(--surface-secondary);
		color: var(--text-secondary);
		gap: 0.3rem;
	}

	.room-chip--presence::before {
		content: '';
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: #94a3b8;
		flex: 0 0 auto;
	}

	.room-chip--active {
		background: #dcfce7;
		color: #166534;
		border-color: #bbf7d0;
	}

	.room-chip--active::before {
		background: #22c55e;
		box-shadow: 0 0 0.5rem rgba(34, 197, 94, 0.35);
		animation: presencePulse 2s infinite cubic-bezier(0.4, 0, 0.6, 1);
	}

	.room-chip--left {
		background: var(--surface-secondary);
		color: var(--text-secondary);
		border-color: var(--border);
	}

	.room-chip--consultant {
		background: var(--surface-secondary);
		color: var(--text-primary);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.room-chip--locked {
		background: #fee2e2;
		color: #b91c1c;
		border-color: #fecaca;
	}

	@keyframes presencePulse {
		0%,
		100% {
			box-shadow: 0 0 0.5rem rgba(34, 197, 94, 0.35);
		}
		50% {
			box-shadow: 0 0 0.8rem rgba(34, 197, 94, 0.55);
		}
	}

	.room-console__actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.4rem;
		flex-shrink: 0;
		flex-wrap: wrap;
	}

	.btn-primary,
	.btn-dark,
	.btn-icon,
	.room-console__menu-panel button,
	.room-panel__code-card button,
	.room-panel__consultants button,
	.quick-reply {
		border: 0;
		cursor: pointer;
		font: inherit;
	}

	.btn-primary {
		height: 36px;
		padding: 0 0.95rem;
		border-radius: 6px;
		background: var(--primary);
		color: #fff;
		font-size: 0.75rem;
		font-weight: 700;
		box-shadow: 0 2px 8px rgba(13, 139, 126, 0.2);
		transition: all 0.2s ease;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--primary-dark);
		box-shadow: 0 4px 12px rgba(13, 139, 126, 0.3);
		transform: translateY(-1px);
	}

	.btn-primary--claim {
		padding-inline: 1rem;
		background: var(--graphite);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.btn-dark {
		height: 36px;
		border-radius: 6px;
		background: var(--graphite);
		color: #fff;
		font-weight: 700;
		font-size: 0.75rem;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.btn-icon {
		width: 36px;
		height: 36px;
		border-radius: 6px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
		border: 1px solid var(--border);
		background: var(--surface);
		transition: all 0.2s ease;
	}

	.btn-icon span {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		display: block;
		background: var(--graphite);
	}

	.btn-icon:hover:not(:disabled) {
		background: var(--surface-secondary);
		border-color: var(--border-2);
	}

	.room-switcher__tabs button:hover:not(.active),
	.room-switcher__nav-btn:hover:not(:disabled),
	.btn-primary:hover:not(:disabled),
	.btn-dark:hover:not(:disabled),
	.room-console__menu-panel button:hover:not(:disabled),
	.quick-reply:hover,
	.room-panel__consultants button:hover {
		transform: translateY(-1px);
	}

	.room-switcher__nav-btn,
	.room-console__menu-panel button,
	.quick-reply,
	.room-panel__consultants button {
		transition: all 0.2s ease;
	}

	.room-panel__close {
		width: 40px;
		height: 40px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text-primary);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		font-size: 1.25rem;
		line-height: 1;
		transition: all 0.2s ease;
	}

	.room-panel__close:hover {
		background: var(--surface-secondary);
		border-color: var(--border-2);
	}

	.room-console__menu {
		position: relative;
	}

	.room-console__menu-panel {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		z-index: 12;
		width: min(260px, calc(100vw - 1rem));
		padding: 0.6rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface);
		box-shadow: 0 10px 32px rgba(0, 0, 0, 0.12);
		display: grid;
		gap: 0.6rem;
	}

	.room-console__menu-section {
		display: grid;
		gap: 0.35rem;
	}

	.room-console__menu-section p {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
		padding: 0 0.4rem;
	}

	.room-console__menu-panel button {
		min-height: 36px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--surface-secondary);
		color: var(--text-primary);
		font-weight: 600;
		font-size: 0.8rem;
		text-align: left;
		padding: 0.5rem 0.7rem;
	}

	.room-console__menu-panel button:hover:not(:disabled) {
		background: var(--surface-tertiary);
		border-color: var(--border-2);
	}

	.room-console__menu-panel button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.notice,
	.quick-reply,
	.message-bubble,
	.room-panel__facts div,
	.room-panel__code-card,
	.room-panel__consultants button {
		border: 1px solid var(--border);
	}

	.notice {
		margin: 0.8rem 1rem 1rem;
		padding: 0.8rem 0.9rem;
		border-radius: 10px;
		background: #fff;
		color: var(--text-secondary);
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.notice--error {
		background: #fee2e2;
		color: #b91c1c;
		border-color: #fecaca;
	}

	.notice--info {
		background: #dbeafe;
		color: #1d4ed8;
		border-color: #bfdbfe;
	}

	.room-console[aria-busy='true'] .room-console__messages,
	.room-console[aria-busy='true'] .room-console__composer {
		opacity: 0.72;
		transition: opacity 0.18s ease;
	}

	.room-console__messages {
		flex: 1 1 auto;
		min-height: 0;
		max-height: 100%;
		overflow-y: auto;
		padding: 1rem 1.2rem;
		display: grid;
		gap: 0.75rem;
		align-content: start;
		background: var(--surface);
	}

	.room-console__messages::-webkit-scrollbar {
		width: 6px;
	}

	.room-console__messages::-webkit-scrollbar-track {
		background: transparent;
	}

	.room-console__messages::-webkit-scrollbar-thumb {
		background: rgba(0, 0, 0, 0.1);
		border-radius: 3px;
	}

	.room-console__messages::-webkit-scrollbar-thumb:hover {
		background: rgba(0, 0, 0, 0.2);
	}

	.message-row {
		display: flex;
		margin-bottom: 0.25rem;
	}

	.message-row--consultant {
		justify-content: flex-end;
	}

	.message-row--system {
		justify-content: center;
	}

	.message-bubble {
		max-width: min(75%, 600px);
		padding: 0.85rem 0.95rem;
		border-radius: 16px;
		background: var(--surface-secondary);
		color: var(--text-primary);
		box-shadow: none;
		font-size: 0.85rem;
	}

	.message-bubble--assistant {
		background: var(--surface-tertiary);
	}

	.message-bubble--consultant {
		background: var(--primary);
		color: #fff;
		border-color: var(--primary);
		max-width: 75%;
	}

	.message-bubble--system {
		max-width: min(60%, 520px);
		padding: 0.6rem 0.8rem;
		text-align: center;
		background: var(--surface-secondary);
		color: var(--text-secondary);
		border-color: var(--border);
		font-size: 0.75rem;
	}

	.message-bubble.is-optimistic {
		opacity: 0.7;
	}

	.message-bubble__label {
		margin-bottom: 0.3rem;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.75;
	}

	.message-bubble p {
		margin: 0;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.message-bubble__meta {
		margin-top: 0.4rem;
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
		font-size: 0.7rem;
		opacity: 0.7;
	}

	.room-console__composer {
		padding: 0.9rem 1.2rem 1rem;
		display: grid;
		gap: 0.7rem;
		background: var(--surface);
		border-top: 1px solid var(--border);
	}

	.room-console__quick-replies {
		display: flex;
		gap: 0.45rem;
		overflow-x: auto;
		padding-bottom: 0.1rem;
	}

	.room-console__quick-replies::-webkit-scrollbar {
		height: 4px;
	}

	.room-console__quick-replies::-webkit-scrollbar-track {
		background: transparent;
	}

	.room-console__quick-replies::-webkit-scrollbar-thumb {
		background: rgba(0, 0, 0, 0.1);
		border-radius: 2px;
	}

	.quick-reply {
		flex: 0 0 auto;
		padding: 0.5rem 0.8rem;
		border-radius: 20px;
		background: var(--surface-secondary);
		color: var(--text-primary);
		font-size: 0.78rem;
		font-weight: 600;
		border: 1px solid var(--border);
	}

	.quick-reply:hover {
		background: var(--surface-tertiary);
		border-color: var(--border-2);
	}

	.quick-reply:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		background: var(--surface-secondary);
		border-color: var(--border);
	}

	.room-console__composer-box {
		display: grid;
		gap: 0.65rem;
		padding: 0.85rem;
		border-radius: 12px;
		background: var(--surface-secondary);
		border: 1px solid var(--border);
	}

	.room-console__composer-box--readonly {
		opacity: 0.82;
	}

	.room-console__composer-head {
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.room-console__composer-head span {
		display: block;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
	}

	.room-console__composer-head strong {
		color: var(--text-primary);
	}

	.room-console__composer-box textarea {
		width: 100%;
		min-height: 72px;
		max-height: 160px;
		resize: none;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface);
		padding: 0.85rem;
		font: inherit;
		font-size: 0.85rem;
		line-height: 1.5;
		outline: none;
		color: var(--text-primary);
		transition: all 0.2s ease;
	}

	.room-console__composer-box textarea:focus {
		border-color: var(--primary);
		background: var(--surface);
		box-shadow: inset 0 0 0 3px rgba(13, 139, 126, 0.1);
	}

	.room-console__composer-box textarea:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.room-console__composer-foot {
		display: flex;
		justify-content: space-between;
		gap: 0.7rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.room-console__composer-foot p {
		color: var(--text-secondary);
		font-size: 0.75rem;
		line-height: 1.4;
		margin: 0;
		flex: 1;
	}

	.room-panel {
		padding: 0;
		display: grid;
		grid-template-rows: auto 1fr;
		gap: 0;
		align-content: start;
		position: static;
		max-height: 100%;
		overflow: hidden;
		background: var(--surface);
		border-left: 1px solid var(--border);
	}

	.room-panel__header {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: flex-start;
		padding: 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}

	.room-panel__header h3 {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.room-panel__header p {
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--text-secondary);
		margin-top: 0.15rem;
	}

	.room-panel__cards {
		display: grid;
		gap: 0.6rem;
		padding: 1rem;
	}

	.room-panel__code-card {
		padding: 0.85rem;
		border-radius: 8px;
		background: var(--surface-secondary);
		display: grid;
		gap: 0.3rem;
		border: 1px solid var(--border);
	}

	.room-panel__code-card span,
	.room-panel__facts span {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
	}

	.room-panel__code-card strong,
	.room-panel__facts strong {
		font-size: 0.85rem;
		line-height: 1.4;
		color: var(--text-primary);
		word-break: break-word;
		font-weight: 700;
	}

	.room-panel__code-card button {
		justify-self: start;
		padding: 0;
		background: transparent;
		color: var(--primary);
		font-size: 0.75rem;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
		transition: color 0.2s ease;
	}

	.room-panel__code-card button:hover {
		color: var(--primary-dark);
	}

	.room-panel__code-card button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.room-panel__facts {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.6rem;
		padding: 0 1rem;
		overflow-y: auto;
	}

	.room-panel__facts::-webkit-scrollbar {
		width: 6px;
	}

	.room-panel__facts::-webkit-scrollbar-track {
		background: transparent;
	}

	.room-panel__facts::-webkit-scrollbar-thumb {
		background: rgba(0, 0, 0, 0.1);
		border-radius: 3px;
	}

	.room-panel__facts div {
		padding: 0.8rem;
		border-radius: 8px;
		background: var(--surface-secondary);
		display: grid;
		gap: 0.25rem;
	}

	.room-panel__transfer {
		display: grid;
		gap: 0.7rem;
		padding: 1rem;
		overflow-y: auto;
		min-height: 0;
	}

	.room-panel__transfer input {
		height: 40px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-secondary);
		padding: 0 0.85rem;
		font: inherit;
		font-size: 0.85rem;
		color: var(--text-primary);
		outline: none;
		transition: all 0.2s ease;
	}

	.room-panel__transfer input:focus {
		border-color: var(--primary);
		background: var(--surface);
		box-shadow: inset 0 0 0 3px rgba(13, 139, 126, 0.1);
	}

	.room-panel__consultants {
		display: grid;
		gap: 0.45rem;
		max-height: 400px;
		overflow-y: auto;
	}

	.room-panel__consultants::-webkit-scrollbar {
		width: 6px;
	}

	.room-panel__consultants::-webkit-scrollbar-track {
		background: transparent;
	}

	.room-panel__consultants::-webkit-scrollbar-thumb {
		background: rgba(0, 0, 0, 0.1);
		border-radius: 3px;
	}

	.room-panel__consultants button {
		padding: 0.75rem;
		border-radius: 8px;
		background: var(--surface-secondary);
		text-align: left;
		display: grid;
		gap: 0.15rem;
		border: 1px solid var(--border);
	}

	.room-panel__consultants button.selected,
	.room-panel__consultants button.highlighted {
		border-color: var(--primary);
		background: var(--primary-light);
		box-shadow: inset 0 0 0 2px var(--primary-light);
	}

	.room-panel__consultants strong {
		color: var(--text-primary);
		font-size: 0.8rem;
		font-weight: 700;
	}

	.room-panel__consultants span {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.room-panel__consultant-badges {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
		margin-top: 0.25rem;
	}

	.room-panel__consultant-badges small {
		padding: 0.25rem 0.45rem;
		border-radius: 4px;
		background: var(--surface-tertiary);
		color: var(--text-secondary);
		font-size: 0.7rem;
		font-weight: 600;
	}

	.room-panel__consultant-badges small.active {
		background: #dcfce7;
		color: #166534;
	}

	.room-panel__empty {
		padding: 1.5rem 1rem;
		border-radius: 8px;
		background: var(--surface-secondary);
		color: var(--text-secondary);
		text-align: center;
		border: 1px dashed var(--border-2);
		font-size: 0.8rem;
	}

	.btn-primary:disabled,
	.btn-dark:disabled,
	.room-console__menu-panel button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	button:focus-visible,
	a:focus-visible,
	input:focus-visible,
	textarea:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	@media (max-width: 1400px) {
		.room-detail-page__layout {
			grid-template-columns: 280px 1fr;
		}

		.room-detail-page__layout--with-panel {
			grid-template-columns: 280px 1fr 300px;
		}

		.room-switcher {
			width: 280px;
		}

		.room-panel {
			width: 300px;
		}
	}

	@media (max-width: 1100px) {
		.room-detail-page__layout,
		.room-detail-page__layout--with-panel {
			grid-template-columns: 260px 1fr;
		}

		.room-detail-page__header {
			padding: 0.85rem 1rem;
		}

		.room-panel {
			position: fixed;
			top: 0;
			right: 0;
			width: min(340px, 100vw);
			height: 100%;
			z-index: 20;
			box-shadow: -4px 0 12px rgba(0, 0, 0, 0.1);
			transform: translateX(100%);
			transition: transform 0.3s ease;
		}

		.room-detail-page__layout--with-panel .room-panel {
			transform: translateX(0);
		}

		.room-switcher {
			width: 260px;
		}
	}

	@media (max-width: 900px) {
		.room-detail-page {
			grid-template-rows: auto 1fr;
		}

		.room-detail-page__header {
			flex-direction: column;
		}

		.room-detail-page__header-badges {
			justify-content: flex-start;
		}

		.room-detail-page__layout,
		.room-detail-page__layout--with-panel {
			grid-template-columns: 1fr;
		}

		.room-switcher {
			width: 100%;
			max-height: min(38vh, 320px);
			border-right: none;
			border-bottom: 1px solid var(--border);
		}

		.room-switcher__tabs button {
			flex: 1 1 0;
			min-width: 0;
		}

		.room-console {
			min-height: 500px;
		}

		.room-console__header {
			padding: 0.55rem 0.9rem;
			gap: 0.4rem;
			align-items: flex-start;
			flex-wrap: wrap;
		}

		.room-console__identity,
		.room-console__actions {
			width: 100%;
		}

		.room-console__actions {
			justify-content: flex-start;
		}

		.room-panel {
			position: fixed;
			width: 100%;
		}

		.message-bubble,
		.message-bubble--system {
			max-width: 90%;
		}

		.room-console__messages {
			padding: 0.8rem 1rem;
		}

		.room-console__composer {
			padding: 0.8rem 1rem 0.9rem;
		}

		.room-console__identity-meta {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.2rem;
		}

		.room-panel__facts {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.room-detail-page__header {
			padding: 0.6rem 1rem;
			flex-wrap: wrap;
			gap: 0.8rem;
		}

		.room-detail-page__back {
			font-size: 0.75rem;
			padding: 0 0.7rem;
			min-height: 32px;
		}

		.room-detail-page__header h1 {
			font-size: 0.85rem;
		}

		.room-detail-page__layout {
			grid-template-columns: 1fr;
			gap: 0;
		}

		.room-switcher {
			max-height: min(42vh, 360px);
		}

		.room-switcher__header,
		.room-switcher__search,
		.room-switcher__tabs,
		.room-switcher__nav {
			padding-left: 0.7rem;
			padding-right: 0.7rem;
		}

		.room-switcher__item {
			grid-template-columns: 36px 1fr;
			gap: 0.5rem;
			padding: 0.5rem;
		}

		.room-switcher__avatar {
			width: 36px;
			height: 36px;
			font-size: 0.75rem;
		}

		.room-console__header {
			padding: 0.5rem 0.8rem;
			gap: 0.35rem;
		}

		.room-console__identity {
			gap: 0.4rem;
		}

		.room-console__avatar {
			width: 40px;
			height: 40px;
			font-size: 0.8rem;
		}

		.room-console__identity-copy h2 {
			font-size: 0.85rem;
		}

		.room-console__identity-meta {
			font-size: 0.65rem;
		}

		.room-switcher__nav {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.room-switcher__nav-label {
			grid-column: 1 / -1;
			order: -1;
			padding: 0;
		}

		.room-chip {
			padding: 0.25rem 0.5rem;
			font-size: 0.65rem;
		}

		.room-console__actions {
			gap: 0.3rem;
		}

		.room-console__messages {
			padding: 0.6rem 0.8rem;
		}

		.message-bubble {
			max-width: 95%;
		}

		.room-console__composer {
			padding: 0.7rem 0.85rem 0.85rem;
			gap: 0.6rem;
		}

		.room-console__composer-box {
			padding: 0.75rem;
			gap: 0.6rem;
		}

		.room-console__composer-box textarea {
			min-height: 60px;
			max-height: 120px;
			padding: 0.7rem;
			font-size: 0.8rem;
		}

		.quick-reply {
			font-size: 0.7rem;
			padding: 0.4rem 0.7rem;
		}

		.room-panel {
			width: 100%;
			max-height: 400px;
		}

		.room-panel__header {
			padding: 0.8rem;
		}

		.room-panel__cards {
			padding: 0.8rem;
			gap: 0.5rem;
		}

		.room-panel__facts {
			padding: 0.8rem;
			gap: 0.5rem;
		}

		.room-panel__transfer {
			padding: 0.8rem;
		}
	}
</style>
