<script>
	import { onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { forceMobileZoomOut100 } from '$lib/client/mobileViewport.js';
	import {
		CHATBOX_HISTORY_RETENTION_MS,
		clearGuestChatState,
		readGuestChatState,
		writeGuestChatState
	} from '$lib/client/chatboxHistory.js';
	import { locale } from '$lib/i18n/index.js';
	import { CHAT_SUPPORT_CONFIG } from '$lib/config/chatSupport.js';
	import { getStoredTelemetrySessionId } from '$lib/client/telemetry.js';

	let rootEl = $state(null);
	let messagesEl = $state(null);
	let isOpen = $state(false);
	let panelMode = $state('menu');
	let draftMessage = $state('');
	let messageSeq = $state(0);
	let messages = $state([]);
	let chatSessionId = $state('');
	let isSending = $state(false);
	let handoffRequested = $state(false);
	let chatError = $state('');
	let lastRemoteMessageAt = $state('');
	let liveSupport = $state(null);
	let customerPresence = $state(null);
	let inFlightController = null;
	let livePollTimer = null;
	let lastTouchY = 0;
	let keyboardOffset = $state(0);
	let livePanelMaxHeight = $state(0);
	let isNearMessagesBottom = $state(true);
	let unseenConsultantMessages = $state(0);
	let lastConsultantAlertAt = 0;
	let audioContext = null;
	let guestVisitorId = $state('');
	let hydratedViewerKey = $state('');
	let viewerStateKey = $state('');

	const hasUsableHref = (value) => Boolean(String(value || '').trim());
	const isExternalHref = (value) => /^https?:\/\//i.test(String(value || '').trim());
	const currentUserId = $derived.by(() => String($page.data?.user?.userId || '').trim());
	const currentPath = $derived.by(() => String($page.url?.pathname || '/').trim() || '/');
	const isAbortError = (error) =>
		Boolean(error) && (error.name === 'AbortError' || /abort/i.test(String(error?.message || '')));
	const buildGuestVisitorId = () =>
		`guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

	const handleMobileZoomReset = () => {
		forceMobileZoomOut100();
	};

	const ensureNotificationAudioContext = async () => {
		if (!browser) return null;
		const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextCtor) return null;
		if (!audioContext) audioContext = new AudioContextCtor();
		if (audioContext.state === 'suspended') {
			try {
				await audioContext.resume();
			} catch {
				return audioContext;
			}
		}
		return audioContext;
	};

	const chatRootStyle = $derived(
		`--chat-keyboard-offset:${keyboardOffset}px;--chat-live-max-height:${livePanelMaxHeight > 0 ? `${livePanelMaxHeight}px` : 'calc(100vh - 84px)'};`
	);

	const formatRelativeTime = (value) => {
		if (!value) return null;
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return null;
		const diffMs = Date.now() - date.getTime();
		const diffSeconds = Math.max(1, Math.floor(diffMs / 1000));
		if ($locale === 'en') {
			if (diffSeconds < 60) return `${diffSeconds}s ago`;
			const diffMinutes = Math.floor(diffSeconds / 60);
			if (diffMinutes < 60) return `${diffMinutes}m ago`;
			const diffHours = Math.floor(diffMinutes / 60);
			if (diffHours < 24) return `${diffHours}h ago`;
			const diffDays = Math.floor(diffHours / 24);
			return `${diffDays}d ago`;
		}
		if (diffSeconds < 60) return `${diffSeconds} giây trước`;
		const diffMinutes = Math.floor(diffSeconds / 60);
		if (diffMinutes < 60) return `${diffMinutes} phút trước`;
		const diffHours = Math.floor(diffMinutes / 60);
		if (diffHours < 24) return `${diffHours} giờ trước`;
		const diffDays = Math.floor(diffHours / 24);
		return `${diffDays} ngày trước`;
	};

	const buildViewerKey = () => (currentUserId ? `user:${currentUserId}` : 'guest');
	const cloneChatObject = (value) =>
		value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : null;
	const normalizeUiRole = (item = {}) => {
		if (item?.role === 'user') return 'user';
		if (item?.role === 'consultant') return 'consultant';
		if (item?.role === 'system') return 'system';
		if (
			item?.role === 'assistant' &&
			new Set(['handoff_confirmation', 'rate_limit_notice']).has(String(item?.meta?.kind || '').trim())
		) {
			return 'system';
		}
		return item?.role === 'assistant' ? 'agent' : 'system';
	};
	const normalizePersistedMessage = (item = {}, index = 0) => {
		const text = String(item?.text || '').trim();
		if (!text) return null;
		return {
			id: index + 1,
			serverId: String(item?.id || '').trim() || null,
			role: normalizeUiRole(item),
			text,
			meta: item?.meta || null,
			createdAt: item?.createdAt || null
		};
	};
	const buildUiMessagesFromPersisted = (items = []) =>
		(Array.isArray(items) ? items : []).map(normalizePersistedMessage).filter(Boolean);
	const syncMessageSeq = (items = []) => {
		messageSeq = items.reduce((max, item, index) => Math.max(max, Number(item?.id) || index + 1), 0);
	};
	const setMessagesFromSnapshot = (items = []) => {
		messages = Array.isArray(items) ? items.map((item) => ({ ...item, pending: false })) : [];
		syncMessageSeq(messages);
	};
	const replaceMessagesFromPersisted = (items = []) => {
		const nextItems = buildUiMessagesFromPersisted(items);
		setMessagesFromSnapshot(nextItems);
		lastRemoteMessageAt = nextItems[nextItems.length - 1]?.createdAt || '';
	};
	const appendPersistedMessages = async (items = []) => {
		const knownIds = new Set(messages.map((message) => message.serverId).filter(Boolean));
		const nextItems = buildUiMessagesFromPersisted(items).filter(
			(item) => !item.serverId || !knownIds.has(item.serverId)
		);
		if (!nextItems.length) return;
		const shouldAutoScroll = isNearMessagesBottom;
		const newConsultantCount = nextItems.filter((item) => item.role === 'consultant').length;
		const nextMessages = [...messages, ...nextItems.map((item) => ({ ...item, id: nextMessageId() }))];
		messages = nextMessages;
		lastRemoteMessageAt = nextItems[nextItems.length - 1]?.createdAt || lastRemoteMessageAt;
		await tick();
		if (shouldAutoScroll) {
			scrollMessagesToBottom();
		} else if (newConsultantCount > 0) {
			unseenConsultantMessages += newConsultantCount;
		}
		if (newConsultantCount > 0) {
			void triggerConsultantAlert();
		}
	};
	const resetChatState = () => {
		messages = [];
		messageSeq = 0;
		chatSessionId = '';
		handoffRequested = false;
		chatError = '';
		lastRemoteMessageAt = '';
		liveSupport = null;
		customerPresence = null;
		unseenConsultantMessages = 0;
		hydratedViewerKey = '';
	};
	const hydrateGuestState = () => {
		const snapshot = readGuestChatState();
		if (!snapshot) {
			guestVisitorId = buildGuestVisitorId();
			clearGuestChatState();
			return;
		}
		guestVisitorId = snapshot.visitorId || buildGuestVisitorId();
		chatSessionId = snapshot.sessionId || '';
		handoffRequested = Boolean(snapshot.handoffRequested);
		lastRemoteMessageAt = snapshot.lastRemoteMessageAt || '';
		liveSupport = snapshot.liveSupport || null;
		customerPresence = snapshot.customerPresence || null;
		setMessagesFromSnapshot(snapshot.messages || []);
	};
	const buildModelHistory = (items = []) =>
		(Array.isArray(items) ? items : [])
			.filter((item) => !item?.pending)
			.filter((item) => item?.role === 'user' || item?.role === 'agent')
			.filter(
				(item) =>
					!new Set(['handoff_confirmation', 'handoff_request', 'rate_limit_notice']).has(
						String(item?.meta?.kind || '').trim()
					)
			)
			.map((item) => ({
				role: item.role === 'user' ? 'user' : 'assistant',
				content: item.text
			}));
	const buildPromptSuggestions = ({ path = '/', locale = 'vi' } = {}) => {
		const normalizedPath = String(path || '/').toLowerCase();
		if (/^\/product(\/|$)/.test(normalizedPath)) {
			return locale === 'en'
				? [
						'Is this Inoxpran model suitable for my needs?',
						'Can this model be used on induction?',
						'How should I clean it and what is the warranty?'
					]
				: [
						'Model Inoxpran này phù hợp nhu cầu nào?',
						'Model này có dùng được bếp từ không?',
						'Cách vệ sinh và bảo hành của mẫu này?'
					];
		}
		if (/^\/blog(\/|$)/.test(normalizedPath)) {
			return locale === 'en'
				? [
						'Summarize this Inoxpran article briefly',
						'Which Inoxpran products are related to this post?',
						'Recommend the most relevant Inoxpran model for me'
					]
				: [
						'Tóm tắt nhanh bài viết Inoxpran này',
						'Bài này đang nói tới những sản phẩm Inoxpran nào?',
						'Gợi ý model Inoxpran phù hợp cho tôi'
					];
		}
		if (/^\/shop(\/|$)|^\/category(\/|$)/.test(normalizedPath)) {
			return locale === 'en'
				? [
						'Help me choose the right Inoxpran model',
						'Compare the main Inoxpran product lines',
						'Which Inoxpran option fits an induction cooktop?'
					]
				: [
						'Tư vấn giúp tôi chọn model Inoxpran phù hợp',
						'So sánh nhanh các dòng Inoxpran',
						'Mẫu Inoxpran nào hợp bếp từ?'
					];
		}
		return locale === 'en'
			? [
					'Recommend an Inoxpran model for my kitchen',
					'Explain Inoxpran warranty and shipping policy',
					'How do I choose between Inoxpran product lines?'
				]
			: [
					'Gợi ý model Inoxpran phù hợp cho bếp nhà tôi',
					'Giải thích giúp tôi chính sách bảo hành và giao hàng',
					'Nên chọn dòng Inoxpran nào cho nhu cầu của tôi?'
				];
	};
	const promptSuggestions = $derived.by(() => buildPromptSuggestions({ path: currentPath, locale: $locale }));
	const visiblePromptSuggestions = $derived.by(() =>
		Array.isArray(promptSuggestions) ? promptSuggestions.slice(0, 3) : []
	);
	const showStarterHints = $derived.by(
		() => !handoffRequested && !messages.length && visiblePromptSuggestions.length > 0
	);

	const parseBubbleLine = (value) => {
		const raw = String(value || '').trim();
		if (!raw) return { bullet: false, label: '', value: '', text: '' };
		const bullet = raw.startsWith('- ');
		const text = bullet ? raw.slice(2).trim() : raw;
		const match = text.match(/^([^:]{1,42}):\s*(.+)$/u);
		if (match) {
			return {
				bullet,
				label: match[1].trim(),
				value: match[2].trim(),
				text
			};
		}
		return { bullet, label: '', value: '', text };
	};

	const parseBubbleBlocks = (value) => {
		const blocks = String(value || '')
			.split(/\n{2,}/)
			.map((block) => block.trim())
			.filter(Boolean);

		return blocks.map((block) => {
			const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
			const listLike = lines.length > 0 && lines.every((line) => line.startsWith('- '));
			return {
				type: listLike ? 'list' : 'paragraphs',
				items: lines.map(parseBubbleLine)
			};
		});
	};

	const consultantTypingActive = $derived.by(
		() =>
			Boolean(handoffRequested && liveSupport?.typing?.active) &&
			(!liveSupport?.typing?.until || new Date(liveSupport.typing.until).getTime() > Date.now())
	);

	const consultantHeaderPresence = $derived.by(() => {
		if (!handoffRequested) return null;
		if (liveSupport?.active) {
			return {
				label: $locale === 'en' ? 'Consultant online' : 'CSKH đang hoạt động',
				detail: liveSupport?.lastMessageAt
					? $locale === 'en'
						? `Last replied ${formatRelativeTime(liveSupport.lastMessageAt)}`
						: `Trả lời ${formatRelativeTime(liveSupport.lastMessageAt)}`
					: null,
				tone: 'online'
			};
		}
		return {
			label: $locale === 'en' ? 'Waiting for consultant' : 'Đang chờ CSKH nhận phòng',
			detail: null,
			tone: 'waiting'
		};
	});

	const triggerConsultantAlert = async () => {
		if (!browser) return;
		const now = Date.now();
		if (now - lastConsultantAlertAt < 2500) return;
		lastConsultantAlertAt = now;

		if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
			navigator.vibrate([20, 30, 20]);
		}

		const context = await ensureNotificationAudioContext();
		if (!context || context.state !== 'running') return;

		try {
			const oscillator = context.createOscillator();
			const gain = context.createGain();
			oscillator.type = 'sine';
			oscillator.frequency.value = 880;
			gain.gain.setValueAtTime(0.0001, context.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.14);
			oscillator.connect(gain);
			gain.connect(context.destination);
			oscillator.start();
			oscillator.stop(context.currentTime + 0.15);
		} catch {
			// ignore alert audio failures
		}
	};

	const copy = $derived.by(() =>
		$locale === 'en'
			? {
					menuTitle: 'Contact for consultation',
					callTitle: `Call ${CHAT_SUPPORT_CONFIG.phoneLabel}`,
					callSubtitle: 'Support hours: 8:30 - 17:30',
					zaloTitle: 'Chat on Zalo',
					zaloSubtitle: 'Fast support via Zalo',
					messengerTitle: 'Chat on Facebook Messenger',
					messengerSubtitle: 'Message us via Facebook page',
					liveTitle: 'Start live support chat',
					liveSubtitle: 'Chat with our support team',
					openButton: 'Chat now',
					hideButton: 'Minimize',
					openButtonAria: 'Open support chat box',
					hideButtonAria: 'Minimize support chat box',
					closeAria: 'Close support chat panel',
					backAria: 'Back to contact options',
					emptyState: 'No support channels configured yet.',
					chatPanelTitle: 'Customer support',
					chatPanelSubtitle: 'Chat with our support team',
					chatInputPlaceholder: 'Your message...',
					sendAria: 'Send message',
					promptConsultant: 'Meet consultant',
					starterBadge: 'Inoxpran AI',
					starterTitle: 'Ask about products, usage, warranty, or delivery',
					starterText:
						'I only support questions related to Inoxpran and keep replies short to save time.',
					starterHint: 'Choose a prompt below or type your question.',
					connectionError:
						'The chat request was interrupted. Please send your message again or request a human consultant.'
				}
			: {
					menuTitle: 'Liên hệ để được tư vấn',
					callTitle: `Gọi ${CHAT_SUPPORT_CONFIG.phoneLabel}`,
					callSubtitle: 'Hỗ trợ từ 8:30 - 17:30',
					zaloTitle: 'Nhắn Zalo',
					zaloSubtitle: 'Trao đổi nhanh qua Zalo',
					messengerTitle: 'Nhắn Facebook Messenger',
					messengerSubtitle: 'Liên hệ qua fanpage',
					liveTitle: 'Chat trực tiếp ngay',
					liveSubtitle: 'Chat với đội ngũ hỗ trợ của chúng tôi',
					openButton: 'Chat ngay',
					hideButton: 'Thu gọn',
					openButtonAria: 'Mở khung chat tư vấn',
					hideButtonAria: 'Thu gọn khung chat tư vấn',
					closeAria: 'Đóng khung chat tư vấn',
					backAria: 'Quay lại danh sách kênh liên hệ',
					emptyState: 'Chưa cấu hình kênh tư vấn nào.',
					chatPanelTitle: 'Hỗ trợ khách hàng',
					chatPanelSubtitle: 'Chat với đội ngũ hỗ trợ của chúng tôi',
					chatInputPlaceholder: 'Tin nhắn...',
					sendAria: 'Gửi tin nhắn',
					promptConsultant: 'Gặp tư vấn viên',
					starterBadge: 'Inoxpran AI',
					starterTitle: 'Hỏi về sản phẩm, cách dùng, bảo hành hoặc giao hàng',
					starterText:
						'Em chỉ hỗ trợ các câu hỏi liên quan tới Inoxpran và sẽ trả lời ngắn gọn để tiết kiệm thời gian.',
					starterHint: 'Anh/chị có thể chọn gợi ý bên dưới hoặc nhập câu hỏi trực tiếp.',
					connectionError:
						'Kết nối chat vừa bị ngắt. Anh/chị vui lòng gửi lại tin nhắn hoặc chọn gặp tư vấn viên trực tiếp.'
				}
	);

	const quickActions = $derived.by(() =>
		[
			{
				id: 'phone',
				title: copy.callTitle,
				subtitle: copy.callSubtitle,
				href: CHAT_SUPPORT_CONFIG.phoneHref
			},
			/*
			 * Temporarily disabled: Zalo support option.
			 * Keeping this commented preserves the copy/config for later reuse while removing
			 * both the visible "Nhắn Zalo" item and its outbound click functionality.
			 */
			// {
			// 	id: 'zalo',
			// 	title: copy.zaloTitle,
			// 	subtitle: copy.zaloSubtitle,
			// 	href: CHAT_SUPPORT_CONFIG.zaloUrl
			// },
			{
				id: 'messenger',
				title: copy.messengerTitle,
				subtitle: copy.messengerSubtitle,
				href: CHAT_SUPPORT_CONFIG.messengerUrl
			},
			/*
			 * Temporarily disabled: direct live chat option.
			 * Keeping this commented prevents the "Chat trực tiếp ngay" button from rendering,
			 * so openLivePanel and the live chat flow are not reachable from this menu.
			 */
			// {
			// 	id: 'live',
			// 	title: copy.liveTitle,
			// 	subtitle: copy.liveSubtitle
			// }
		].filter((item) => item.id === 'live' || hasUsableHref(item.href))
	);

	const nextMessageId = () => {
		messageSeq += 1;
		return messageSeq;
	};

	const updateMessagesViewportState = () => {
		if (!messagesEl) return;
		const remaining = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
		isNearMessagesBottom = remaining <= 72;
		if (isNearMessagesBottom) unseenConsultantMessages = 0;
	};

	const scrollMessagesToBottom = () => {
		if (!messagesEl) return;
		messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
		isNearMessagesBottom = true;
		unseenConsultantMessages = 0;
	};

	const containScrollChain = (container, deltaY) => {
		if (!container || !Number.isFinite(deltaY)) return false;
		const { scrollTop, scrollHeight, clientHeight } = container;
		const atTop = scrollTop <= 0;
		const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
		return (atTop && deltaY < 0) || (atBottom && deltaY > 0);
	};

	const pushRemoteMessages = async (items = []) => {
		if (!Array.isArray(items) || !items.length) return;

		const knownIds = new Set(messages.map((message) => message.serverId).filter(Boolean));
		const nextItems = items
			.filter((item) => item && item.role !== 'user' && item.id && !knownIds.has(item.id))
			.map((item) => ({
				id: nextMessageId(),
				serverId: item.id,
				role:
					item.role === 'assistant'
						? 'agent'
						: item.role === 'consultant'
							? 'consultant'
							: 'system',
				text: item.text || '',
				meta: item.meta || null,
				createdAt: item.createdAt || null
			}));

		if (!nextItems.length) return;
		const shouldAutoScroll = isNearMessagesBottom;
		const newConsultantCount = nextItems.filter((item) => item.role === 'consultant').length;
		messages = [...messages, ...nextItems];
		lastRemoteMessageAt = nextItems[nextItems.length - 1]?.createdAt || lastRemoteMessageAt;
		await tick();
		if (shouldAutoScroll) {
			scrollMessagesToBottom();
		} else if (newConsultantCount > 0) {
			unseenConsultantMessages += newConsultantCount;
		}
		if (newConsultantCount > 0) {
			void triggerConsultantAlert();
		}
	};

	const syncCustomerPresence = async (state, { beacon = false } = {}) => {
		if (!chatSessionId) return;

		const payload = JSON.stringify({ sessionId: chatSessionId, state });
		if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
			navigator.sendBeacon('/api/chat/presence', new Blob([payload], { type: 'application/json' }));
			return;
		}

		try {
			await fetch('/api/chat/presence', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: payload,
				keepalive: beacon
			});
		} catch {
			// ignore presence sync errors on the widget
		}
	};

	const fetchLiveMessages = async () => {
		if (!chatSessionId || !handoffRequested) return;
		const params = new URLSearchParams({ sessionId: chatSessionId, limit: '60' });
		if (lastRemoteMessageAt) params.set('after', lastRemoteMessageAt);

		try {
			const response = await fetch(`/api/chat/messages?${params.toString()}`, {
				headers: { 'cache-control': 'no-store' }
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok) return;
			liveSupport = payload?.metadata?.liveSupport || liveSupport;
			customerPresence = payload?.metadata?.customerPresence || customerPresence;
			await pushRemoteMessages(payload?.metadata?.items || []);
		} catch {
			// ignore polling errors; consultant chat should degrade quietly
		}
	};

	const stopLivePolling = () => {
		if (!livePollTimer) return;
		clearTimeout(livePollTimer);
		livePollTimer = null;
	};

	const startLivePolling = () => {
		stopLivePolling();
		if (!browser || !isOpen || panelMode !== 'live' || !handoffRequested || !chatSessionId) return;
		const loop = async () => {
			await fetchLiveMessages();
			const delay = document.hidden ? 1800 : 700;
			livePollTimer = setTimeout(() => {
				void loop();
			}, delay);
		};
		void loop();
	};

	const abortInFlightRequest = () => {
		if (!inFlightController) return;
		inFlightController.abort();
		inFlightController = null;
	};

	const currentSourcePath = () =>
		typeof window !== 'undefined' ? window.location.pathname || '/' : '/';

	const createChatSession = async () => {
		const response = await fetch('/api/chat/session', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				sessionId: chatSessionId || null,
				visitorId: currentUserId ? null : guestVisitorId || null,
				telemetrySessionId: getStoredTelemetrySessionId() || null,
				locale: $locale,
				sourcePath: currentSourcePath()
			})
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok || !payload?.metadata?.sessionId) {
			throw new Error(payload?.error || 'chat session init failed');
		}
		chatSessionId = payload.metadata.sessionId;
		handoffRequested = payload?.metadata?.status === 'handoff';
		liveSupport = payload?.metadata?.liveSupport || liveSupport;
		customerPresence = payload?.metadata?.customerPresence || customerPresence;
	};

	const ensureChatSession = async ({ force = false } = {}) => {
		if (chatSessionId && !force) return;
		await createChatSession();
	};

	const loadPersistedHistory = async () => {
		if (!chatSessionId) return;
		const params = new URLSearchParams({
			sessionId: chatSessionId,
			after: new Date(Date.now() - CHATBOX_HISTORY_RETENTION_MS).toISOString(),
			limit: '120'
		});
		const response = await fetch(`/api/chat/messages?${params.toString()}`, {
			headers: { 'cache-control': 'no-store' }
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok || !payload?.ok || !payload?.metadata) {
			throw new Error(payload?.error || 'chat history load failed');
		}
		replaceMessagesFromPersisted(payload.metadata.items || []);
		handoffRequested = payload?.metadata?.status === 'handoff';
		liveSupport = payload?.metadata?.liveSupport || liveSupport;
		customerPresence = payload?.metadata?.customerPresence || customerPresence;
	};

	const ensureLivePanelHistory = async () => {
		const viewerKey = buildViewerKey();
		if (!currentUserId) {
			if (!guestVisitorId) hydrateGuestState();
			if (!chatSessionId) {
				await ensureChatSession();
			}
			hydratedViewerKey = viewerKey;
			return;
		}

		if (hydratedViewerKey === viewerKey && chatSessionId) return;
		await ensureChatSession({ force: !chatSessionId });
		await loadPersistedHistory();
		hydratedViewerKey = viewerKey;
	};

	const openLivePanel = async () => {
		handleMobileZoomReset();
		void ensureNotificationAudioContext();
		panelMode = 'live';
		chatError = '';
		try {
			await ensureLivePanelHistory();
			void syncCustomerPresence('active');
			if (messages.length) {
				await tick();
				scrollMessagesToBottom();
			}
		} catch {
			chatError = copy.connectionError;
		}
	};

	const togglePanel = () => {
		if (isOpen) {
			closePanel();
			return;
		}
		handleMobileZoomReset();
		void ensureNotificationAudioContext();
		isOpen = true;
		panelMode = 'menu';
	};

	const closePanel = () => {
		isOpen = false;
		panelMode = 'menu';
		chatError = '';
	};

	const pushAgentReply = async (text, meta = null) => {
		messages = [
			...messages,
			{ id: nextMessageId(), role: 'agent', text, meta, createdAt: new Date().toISOString() }
		];
		await tick();
		scrollMessagesToBottom();
	};

	const finalizePendingUserMessage = (id, committed) => {
		if (committed) {
			messages = messages.map((message) =>
				message.id === id
					? { ...message, pending: false, createdAt: message.createdAt || new Date().toISOString() }
					: message
			);
			return;
		}
		messages = messages.filter((message) => message.id !== id);
	};

	const submitMessage = async (value) => {
		const text = String(value || '').trim();
		if (!text || isSending) return;
		const history = buildModelHistory(messages);

		const pendingUserMessageId = nextMessageId();
		messages = [
			...messages,
			{
				id: pendingUserMessageId,
				role: 'user',
				text,
				pending: true,
				createdAt: new Date().toISOString()
			}
		];
		draftMessage = '';
		chatError = '';
		await tick();
		scrollMessagesToBottom();
		isSending = true;

		const controller = new AbortController();
		inFlightController = controller;

		try {
			await ensureChatSession();
			if (!chatSessionId) throw new Error('missing session');

			const response = await fetch('/api/chat/message', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					sessionId: chatSessionId,
					visitorId: currentUserId ? null : guestVisitorId || null,
					text,
					history,
					telemetrySessionId: getStoredTelemetrySessionId() || null,
					locale: $locale,
					sourcePath: currentSourcePath()
				}),
				signal: controller.signal
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok || !payload?.ok) {
				throw new Error(payload?.error || 'chat request failed');
			}

			finalizePendingUserMessage(pendingUserMessageId, true);
			if (payload?.metadata?.reply) {
				if (payload?.metadata?.limitReached) {
					messages = [
						...messages,
						{
							id: nextMessageId(),
							role: 'system',
							text: payload.metadata.reply,
							meta: { kind: 'rate_limit_notice', rateLimit: payload?.metadata?.rateLimit || null },
							createdAt: new Date().toISOString()
						}
					];
					await tick();
					scrollMessagesToBottom();
				} else {
					await pushAgentReply(payload.metadata.reply, payload?.metadata || null);
				}
			}
			if (payload?.metadata?.handoff?.requested) {
				handoffRequested = true;
				lastRemoteMessageAt =
					payload?.metadata?.messages?.at?.(-1)?.createdAt || new Date().toISOString();
				liveSupport = payload?.metadata?.liveSupport || liveSupport;
				customerPresence = payload?.metadata?.customerPresence || customerPresence;
				void fetchLiveMessages();
			}
		} catch (error) {
			finalizePendingUserMessage(pendingUserMessageId, false);
			if (controller.signal.aborted || isAbortError(error)) {
				return;
			}
			chatError = copy.connectionError;
		} finally {
			if (inFlightController === controller) {
				inFlightController = null;
			}
			isSending = false;
		}
	};

	const requestDirectSupport = async () => {
		if (handoffRequested || isSending) return;
		chatError = '';
		isSending = true;

		const controller = new AbortController();
		inFlightController = controller;

		try {
			await ensureChatSession();
			if (!chatSessionId) throw new Error('missing session');

			const response = await fetch('/api/chat/handoff', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					sessionId: chatSessionId,
					visitorId: currentUserId ? null : guestVisitorId || null,
					telemetrySessionId: getStoredTelemetrySessionId() || null,
					locale: $locale,
					sourcePath: currentSourcePath()
				}),
				signal: controller.signal
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok || !payload?.ok || !payload?.metadata?.reply) {
				throw new Error(payload?.error || 'chat handoff failed');
			}

			handoffRequested = true;
			lastRemoteMessageAt = payload?.metadata?.messages?.at?.(-1)?.createdAt || new Date().toISOString();
			liveSupport = payload?.metadata?.liveSupport || liveSupport;
			customerPresence = payload?.metadata?.customerPresence || customerPresence;
			await appendPersistedMessages(payload?.metadata?.messages || []);
			if (!payload?.metadata?.messages?.length && payload?.metadata?.reply) {
				messages = [
					...messages,
					{
						id: nextMessageId(),
						role: 'system',
						text: payload.metadata.reply,
						meta: { kind: 'handoff_confirmation' },
						createdAt: new Date().toISOString()
					}
				];
				await tick();
				scrollMessagesToBottom();
			}
			void fetchLiveMessages();
		} catch (error) {
			if (controller.signal.aborted || isAbortError(error)) {
				return;
			}
			chatError = copy.connectionError;
		} finally {
			if (inFlightController === controller) {
				inFlightController = null;
			}
			isSending = false;
		}
	};

	const handlePromptClick = async (prompt) => {
		const text = String(prompt || '').trim();
		if (!text || isSending) return;
		handleMobileZoomReset();
		void ensureNotificationAudioContext();
		await submitMessage(text);
	};

	const handleComposerSubmit = async (event) => {
		event?.preventDefault?.();
		handleMobileZoomReset();
		void ensureNotificationAudioContext();
		await submitMessage(draftMessage);
	};

	$effect(() => {
		if (!browser) return;
		if (isOpen && panelMode === 'live' && handoffRequested && chatSessionId) {
			startLivePolling();
			return () => stopLivePolling();
		}
		stopLivePolling();
		return undefined;
	});

	$effect(() => {
		if (!browser || !messagesEl || !consultantTypingActive || !isNearMessagesBottom) return;
		void tick().then(() => {
			scrollMessagesToBottom();
		});
	});

	$effect(() => {
		if (!browser) return;
		const nextViewerKey = buildViewerKey();
		if (viewerStateKey === nextViewerKey) return;
		abortInFlightRequest();
		stopLivePolling();
		resetChatState();
		viewerStateKey = nextViewerKey;
		if (!currentUserId) {
			hydrateGuestState();
			hydratedViewerKey = nextViewerKey;
		}
	});

	$effect(() => {
		if (!browser || currentUserId) return;
		guestVisitorId;
		chatSessionId;
		handoffRequested;
		lastRemoteMessageAt;
		liveSupport;
		customerPresence;
		messages;
		if (!chatSessionId && !messages.length && !handoffRequested) {
			clearGuestChatState();
			return;
		}
		writeGuestChatState({
			visitorId: guestVisitorId || buildGuestVisitorId(),
			sessionId: chatSessionId,
			handoffRequested,
			lastRemoteMessageAt,
			liveSupport: cloneChatObject(liveSupport),
			customerPresence: cloneChatObject(customerPresence),
			messages
		});
	});

	$effect(() => {
		if (!browser || !window.visualViewport) return;

		const syncViewportLayout = () => {
			const viewport = window.visualViewport;
			const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
			keyboardOffset = keyboardInset;
			livePanelMaxHeight = Math.max(320, viewport.height - 72);
		};

		syncViewportLayout();
		window.visualViewport.addEventListener('resize', syncViewportLayout);
		window.visualViewport.addEventListener('scroll', syncViewportLayout);

		return () => {
			window.visualViewport?.removeEventListener('resize', syncViewportLayout);
			window.visualViewport?.removeEventListener('scroll', syncViewportLayout);
		};
	});

	$effect(() => {
		if (!browser || !messagesEl) return;

		const handleMessagesWheel = (event) => {
			if (containScrollChain(messagesEl, event.deltaY)) {
				event.preventDefault();
			}
		};

		const handleMessagesTouchStart = (event) => {
			lastTouchY = event.touches?.[0]?.clientY || 0;
		};

		const handleMessagesTouchMove = (event) => {
			const currentY = event.touches?.[0]?.clientY || 0;
			const deltaY = lastTouchY - currentY;
			lastTouchY = currentY;
			if (containScrollChain(messagesEl, deltaY)) {
				event.preventDefault();
			}
		};

		const handleMessagesScroll = () => {
			updateMessagesViewportState();
		};

		messagesEl.addEventListener('wheel', handleMessagesWheel, { passive: false });
		messagesEl.addEventListener('touchstart', handleMessagesTouchStart, { passive: true });
		messagesEl.addEventListener('touchmove', handleMessagesTouchMove, { passive: false });
		messagesEl.addEventListener('scroll', handleMessagesScroll, { passive: true });
		updateMessagesViewportState();

		return () => {
			messagesEl?.removeEventListener('wheel', handleMessagesWheel);
			messagesEl?.removeEventListener('touchstart', handleMessagesTouchStart);
			messagesEl?.removeEventListener('touchmove', handleMessagesTouchMove);
			messagesEl?.removeEventListener('scroll', handleMessagesScroll);
		};
	});

	onMount(() => {
		const handlePointerDown = (event) => {
			if (!isOpen || !rootEl) return;
			if (rootEl.contains(event.target)) return;
			isOpen = false;
			panelMode = 'menu';
			chatError = '';
		};

		const handleKeyDown = (event) => {
			if (event.key === 'Escape') {
				isOpen = false;
				panelMode = 'menu';
				chatError = '';
			}
		};

		const handlePageHide = () => {
			abortInFlightRequest();
			void syncCustomerPresence('left', { beacon: true });
		};

		document.addEventListener('pointerdown', handlePointerDown);
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('beforeunload', handlePageHide);
		window.addEventListener('pagehide', handlePageHide);

		return () => {
			abortInFlightRequest();
			stopLivePolling();
			document.removeEventListener('pointerdown', handlePointerDown);
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('beforeunload', handlePageHide);
			window.removeEventListener('pagehide', handlePageHide);
		};
	});
</script>

<div class="support-chat" bind:this={rootEl} style={chatRootStyle}>
	{#if isOpen}
		<div
			id="support-chat-panel"
			class="support-chat__panel"
			class:is-live={panelMode === 'live'}
			role="dialog"
			aria-modal="false"
			aria-label={panelMode === 'live' ? copy.chatPanelTitle : copy.menuTitle}
		>
			<header class="support-chat__header" class:is-live={panelMode === 'live'}>
				<div class="support-chat__title-wrap">
					<span class="support-chat__title-icon" aria-hidden="true">
						<svg
							fill="currentColor"
							height="800px"
							width="800px"
							version="1.1"
							id="Capa_1"
							xmlns="http://www.w3.org/2000/svg"
							xmlns:xlink="http://www.w3.org/1999/xlink"
							viewBox="0 0 490.675 490.675"
							xml:space="preserve"
						>
							<g>
								<g>
									<g>
										<path
											d="M490.244,210.3c0-116.1-94.1-210.3-210.3-210.3c-70.9,0-133.7,35.1-171.7,88.9l16,16c33.8-49.9,90.9-82.6,155.7-82.6
				c103.8,0,188,84.2,188,188c0,64.7-32.7,121.7-82.4,155.5l16,16C455.244,343.8,490.244,281.1,490.244,210.3z"
										/>
									</g>
									<path
										d="M334.644,346.2c-14-14-36.9-15.5-51.7-2.3c-25.4,25.4-33.8,22.1-43.1,12.4L133.744,251c-9.7-9.7-13-17.7,12.4-43.1
			c13.2-14.8,11.7-37.7-2.3-51.7L84.044,96c-14-14-36.5-15.5-51.3-2.7c-50.6,45.6-39,153.5,15.5,204l146.1,146.1
			c49.2,52.2,153.8,66.7,202.8,15.2c12.8-14.8,11.3-37.3-2.7-51.3L334.644,346.2z"
									/>
									<g>
										<g>
											<path
												d="M275.844,262.7h-71.7c-6.9,0-12.5-5.6-12.5-12.5c0-24.7,59.8-71.5,63-74.2c3.2-3.7,4.9-8.3,4.9-13.2
					c0-11.1-9.1-20.2-20.2-20.2c-11.1,0-20.2,9.1-20.2,20.2c0,6.9-5.6,12.5-12.5,12.5s-12.5-5.6-12.5-12.5
					c0-24.9,20.3-45.2,45.2-45.2s45.2,20.3,45.2,45.2c0,11.5-4.3,22.4-12.1,30.8c-0.4,0.4-0.8,0.8-1.2,1.2
					c-18,14.8-35.3,31.3-45.5,42.9h50.1c6.9,0,12.5,5.6,12.5,12.5C288.344,257.1,282.744,262.7,275.844,262.7z"
											/>
										</g>
										<g>
											<path
												d="M368.244,264.5c-6.9,0-12.5-5.6-12.5-12.5v-16.1h-52c-4.6,0-8.9-2.6-11.1-6.7s-1.9-9.1,0.8-12.9l64.5-93.3
					c3.1-4.5,8.8-6.4,14-4.8c5.2,1.6,8.8,6.5,8.8,11.9v80.8h14.3c6.9,0,12.5,5.6,12.5,12.5s-5.6,12.5-12.5,12.5h-14.3V252
					C380.744,258.9,375.144,264.5,368.244,264.5z M327.544,210.9h28.2v-40.7L327.544,210.9z"
											/>
										</g>
									</g>
								</g>
							</g>
						</svg>
					</span>
					<div class="support-chat__title-text">
						<h2 class="support-chat__title">
							{panelMode === 'live' ? copy.chatPanelTitle : copy.menuTitle}
						</h2>
						{#if panelMode === 'live'}
							{#if consultantHeaderPresence}
								<div
									class={`support-chat__header-presence support-chat__header-presence--${consultantHeaderPresence.tone}`}
									role="status"
									aria-live="polite"
								>
									<span class="support-chat__header-presence-dot" aria-hidden="true"></span>
									<span class="support-chat__header-presence-copy">
										<span>{consultantHeaderPresence.label}</span>
										{#if consultantHeaderPresence.detail}
											<span class="support-chat__header-presence-detail"
												>{consultantHeaderPresence.detail}</span
											>
										{/if}
									</span>
								</div>
							{:else}
								<p class="support-chat__subtitle">{copy.chatPanelSubtitle}</p>
							{/if}
						{/if}
					</div>
				</div>
				<div class="support-chat__header-actions">
					<button
						type="button"
						class="support-chat__close-btn"
						aria-label={copy.closeAria}
						onclick={closePanel}
					>
						<span aria-hidden="true">&times;</span>
					</button>
				</div>
			</header>

			<div class="support-chat__body" class:is-live={panelMode === 'live'}>
				{#if panelMode === 'menu'}
					{#if quickActions.length}
						<ul class="support-chat__list">
							{#each quickActions as action (action.id)}
								<li class="support-chat__list-item">
									{#if action.id === 'live'}
										<button type="button" class="support-chat__item" onclick={openLivePanel}>
											<span class={`support-chat__item-icon support-chat__item-icon--${action.id}`}>
												<svg viewBox="0 0 24 24" fill="none" focusable="false" aria-hidden="true">
													<path
														d="M4 12a8 8 0 1 1 14.8 4.1L20 20l-4.2-1.2A8 8 0 0 1 4 12Z"
														fill="currentColor"
													/>
													<circle cx="8.9" cy="11.8" r="1.1" fill="#fff" />
													<circle cx="12" cy="11.8" r="1.1" fill="#fff" />
													<circle cx="15.1" cy="11.8" r="1.1" fill="#fff" />
												</svg>
											</span>
											<span class="support-chat__item-text">
												<span class="support-chat__item-title">{action.title}</span>
												<span class="support-chat__item-subtitle">{action.subtitle}</span>
											</span>
										</button>
									{:else}
										<a
											class="support-chat__item"
											href={action.href}
											target={isExternalHref(action.href) ? '_blank' : undefined}
											rel={isExternalHref(action.href) ? 'noopener noreferrer' : undefined}
										>
											<span class={`support-chat__item-icon support-chat__item-icon--${action.id}`}>
												{#if action.id === 'phone'}
													<svg viewBox="0 0 24 24" fill="none" focusable="false" aria-hidden="true">
														<path
															d="M6.8 4.3c.6-.6 1.6-.5 2 .2l1.6 2.8c.3.6.2 1.3-.3 1.7l-1 .9a1 1 0 0 0-.2 1.2c.7 1.3 1.8 2.4 3 3a1 1 0 0 0 1.2-.2l.9-1c.4-.5 1.1-.6 1.7-.3l2.8 1.6c.7.4.8 1.4.2 2l-1.3 1.3c-1 1-2.6 1.3-3.9.7a16.1 16.1 0 0 1-8.5-8.5c-.6-1.3-.3-2.9.7-3.9l1.3-1.3Z"
															fill="currentColor"
														/>
													</svg>
												{:else if action.id === 'zalo'}
													<span class="support-chat__wordmark">Zalo</span>
												{:else}
													<svg viewBox="0 0 24 24" fill="none" focusable="false" aria-hidden="true">
														<path
															d="M12 3c-4.97 0-9 3.73-9 8.33 0 2.62 1.3 4.96 3.33 6.49V21l3.16-1.74c.8.22 1.64.34 2.51.34 4.97 0 9-3.73 9-8.33S16.97 3 12 3Z"
															fill="currentColor"
														/>
														<path
															d="m8.2 12.87 2.6-2.76 1.93 1.57 2.63-2.76-2.93 4.4-1.92-1.57-2.3 1.12Z"
															fill="#fff"
														/>
													</svg>
												{/if}
											</span>
											<span class="support-chat__item-text">
												<span class="support-chat__item-title">{action.title}</span>
												<span class="support-chat__item-subtitle">{action.subtitle}</span>
											</span>
										</a>
									{/if}
								</li>
							{/each}
						</ul>
					{:else}
						<p class="support-chat__empty">{copy.emptyState}</p>
					{/if}
				{:else}
					<div class="support-chat__chat-shell">
						{#if chatError}
							<p class="support-chat__notice" role="status">{chatError}</p>
						{/if}
						<div class="support-chat__messages" bind:this={messagesEl}>
							{#each messages as message (message.id)}
								<div
									class="support-chat__bubble-row"
									class:is-user={message.role === 'user'}
									class:is-system={message.role === 'system'}
								>
									{#if message.role === 'agent'}
										<span class="support-chat__bubble-avatar" aria-hidden="true">
											<svg
												width="800px"
												height="800px"
												viewBox="0 0 1024 1024"
												class="icon"
												version="1.1"
												xmlns="http://www.w3.org/2000/svg"
												><path
													d="M565.370023 772.592126c-57.039628 44.171437-100.880349 6.115667-105.80831 1.507159-8.99688-8.535108-23.163358-8.270946-31.763994 0.660406-8.644664 8.952853-8.381525 23.207385 0.572352 31.852048 15.26613 14.727567 45.315117 32.094709 82.183179 32.09471 25.143552 0 53.43248-8.062073 82.402291-30.499496 9.833395-7.621802 11.636457-21.766778 4.025917-31.599149-7.634089-9.834419-21.800566-11.627242-31.611435-4.015678zM353.90801 534.644248c-18.654167 0-33.788216 15.122786-33.788215 33.788216v45.050954c0 18.664406 15.134049 33.788216 33.788215 33.788216s33.788216-15.12381 33.788216-33.788216v-45.050954c0-18.664406-15.134049-33.788216-33.788216-33.788216zM646.739213 534.644248c-18.654167 0-33.788216 15.122786-33.788216 33.788216v45.050954c0 18.664406 15.134049 33.788216 33.788216 33.788216s33.788216-15.12381 33.788216-33.788216v-45.050954c0-18.664406-15.134049-33.788216-33.788216-33.788216z"
													fill="currentColor"
												/><path
													d="M871.993985 455.805078c0-191.994881-168.412754-360.407634-360.407635-360.407635s-360.407634 168.412754-360.407634 360.407635c-24.777001 0-45.050954 20.271906-45.050954 45.050954v157.67834c0 24.777001 20.273953 45.050954 45.050954 45.050954h22.525477c24.777001 0 45.050954-20.273953 45.050954-45.050954v-90.101908a23.549362 23.549362 0 0 0 1.231734-0.032765c175.523637-9.523157 298.44619-137.44227 358.872831-217.791671 37.21516 32.154095 136.422481 110.490537 232.969747 125.673732-4.651511 7.084263-7.411906 15.512887-7.411906 24.574272v157.67834c0 10.760011 3.978818 20.536068 10.333051 28.30531-11.008815 82.724815-82.915257 149.847665-214.276673 199.74774-3.798615-14.498216-16.92892-25.323756-32.573888-25.323756h-112.627386c-18.583519 0-33.788216 15.204697-33.788215 33.788216s15.204697 33.788216 33.788215 33.788216h112.627386c12.477067 0 23.304654-6.931704 29.156159-17.058953 140.968532-51.288464 221.16435-122.013343 238.379957-210.670549 4.444686 1.477467 9.10746 2.474731 14.031325 2.47473h22.525477c24.777001 0 45.050954-20.273953 45.050954-45.050954v-157.67834c0.001024-24.779049-20.272929-45.050954-45.04993-45.050954z m-259.483258-199.957637c-10.910522-5.983586-24.615227-1.980194-30.576288 8.941591-1.339242 2.44811-136.912922 245.37719-363.179292 258.517734v-22.450734c0-17.009807-9.66343-31.715872-23.669157-39.378629 0.494537-1.856304 1.14368-3.659366 1.14368-5.672325 0-167.995009 147.361671-315.35668 315.35668-315.35668 160.277985 0 301.446174 134.190411 314.109588 292.405266-89.171197-10.391412-189.215032-91.837394-220.761963-119.358407 9.823156-15.07364 15.430976-25.109764 16.508103-27.081767 5.983586-10.911546 1.97917-24.593726-8.931351-30.566049z"
													fill="currentColor"
												/></svg
											>
										</span>
									{:else if message.role === 'consultant'}
										<span
											class="support-chat__bubble-avatar support-chat__bubble-avatar--consultant"
											aria-hidden="true"
										>
											TV
										</span>
									{:else if message.role === 'system'}
										<span
											class="support-chat__bubble-avatar support-chat__bubble-avatar--system"
											aria-hidden="true"
										>
											i
										</span>
									{/if}
									<div class="support-chat__bubble-stack">
										{#if message.role === 'consultant'}
											<div class="support-chat__bubble-label">
												{message.meta?.accountLabel ||
													($locale === 'en' ? 'Consultant' : 'Tư vấn viên')}
											</div>
										{/if}
										<div
										class="support-chat__bubble"
										class:is-user={message.role === 'user'}
										class:is-consultant={message.role === 'consultant'}
										class:is-system={message.role === 'system'}
									>
										{#each parseBubbleBlocks(message.text) as block}
											{#if block.type === 'list'}
												<ul class="support-chat__bubble-list">
													{#each block.items as item}
														<li class="support-chat__bubble-list-item">
															{#if item.label}
																<strong class="support-chat__bubble-key">{item.label}:</strong>
																<span>{item.value}</span>
															{:else}
																<span>{item.text}</span>
															{/if}
														</li>
													{/each}
												</ul>
											{:else}
												<div class="support-chat__bubble-paragraphs">
													{#each block.items as item}
														<p class="support-chat__bubble-line">
															{#if item.label}
																<strong class="support-chat__bubble-key">{item.label}:</strong>
																<span>{item.value}</span>
															{:else}
																<span>{item.text}</span>
															{/if}
														</p>
													{/each}
												</div>
											{/if}
										{/each}
									</div>
									</div>
								</div>
							{/each}
							{#if isSending}
								<div class="support-chat__bubble-row">
									<span class="support-chat__bubble-avatar" aria-hidden="true">
										<svg
											width="800px"
											height="800px"
											viewBox="0 0 1024 1024"
											class="icon"
											version="1.1"
											xmlns="http://www.w3.org/2000/svg"
											><path
												d="M565.370023 772.592126c-57.039628 44.171437-100.880349 6.115667-105.80831 1.507159-8.99688-8.535108-23.163358-8.270946-31.763994 0.660406-8.644664 8.952853-8.381525 23.207385 0.572352 31.852048 15.26613 14.727567 45.315117 32.094709 82.183179 32.09471 25.143552 0 53.43248-8.062073 82.402291-30.499496 9.833395-7.621802 11.636457-21.766778 4.025917-31.599149-7.634089-9.834419-21.800566-11.627242-31.611435-4.015678zM353.90801 534.644248c-18.654167 0-33.788216 15.122786-33.788215 33.788216v45.050954c0 18.664406 15.134049 33.788216 33.788215 33.788216s33.788216-15.12381 33.788216-33.788216v-45.050954c0-18.664406-15.134049-33.788216-33.788216-33.788216zM646.739213 534.644248c-18.654167 0-33.788216 15.122786-33.788216 33.788216v45.050954c0 18.664406 15.134049 33.788216 33.788216 33.788216s33.788216-15.12381 33.788216-33.788216v-45.050954c0-18.664406-15.134049-33.788216-33.788216-33.788216z"
												fill="currentColor"
											/><path
												d="M871.993985 455.805078c0-191.994881-168.412754-360.407634-360.407635-360.407635s-360.407634 168.412754-360.407634 360.407635c-24.777001 0-45.050954 20.271906-45.050954 45.050954v157.67834c0 24.777001 20.273953 45.050954 45.050954 45.050954h22.525477c24.777001 0 45.050954-20.273953 45.050954-45.050954v-90.101908a23.549362 23.549362 0 0 0 1.231734-0.032765c175.523637-9.523157 298.44619-137.44227 358.872831-217.791671 37.21516 32.154095 136.422481 110.490537 232.969747 125.673732-4.651511 7.084263-7.411906 15.512887-7.411906 24.574272v157.67834c0 10.760011 3.978818 20.536068 10.333051 28.30531-11.008815 82.724815-82.915257 149.847665-214.276673 199.74774-3.798615-14.498216-16.92892-25.323756-32.573888-25.323756h-112.627386c-18.583519 0-33.788216 15.204697-33.788215 33.788216s15.204697 33.788216 33.788215 33.788216h112.627386c12.477067 0 23.304654-6.931704 29.156159-17.058953 140.968532-51.288464 221.16435-122.013343 238.379957-210.670549 4.444686 1.477467 9.10746 2.474731 14.031325 2.47473h22.525477c24.777001 0 45.050954-20.273953 45.050954-45.050954v-157.67834c0.001024-24.779049-20.272929-45.050954-45.04993-45.050954z m-259.483258-199.957637c-10.910522-5.983586-24.615227-1.980194-30.576288 8.941591-1.339242 2.44811-136.912922 245.37719-363.179292 258.517734v-22.450734c0-17.009807-9.66343-31.715872-23.669157-39.378629 0.494537-1.856304 1.14368-3.659366 1.14368-5.672325 0-167.995009 147.361671-315.35668 315.35668-315.35668 160.277985 0 301.446174 134.190411 314.109588 292.405266-89.171197-10.391412-189.215032-91.837394-220.761963-119.358407 9.823156-15.07364 15.430976-25.109764 16.508103-27.081767 5.983586-10.911546 1.97917-24.593726-8.931351-30.566049z"
												fill="currentColor"
											/></svg
										>
									</span>
									<p class="support-chat__bubble support-chat__bubble--pending">
										{$locale === 'en' ? 'Typing...' : 'Đang soạn trả lời...'}
									</p>
								</div>
							{/if}
							{#if consultantTypingActive}
								<div class="support-chat__typing-indicator" role="status" aria-live="polite">
									<span class="support-chat__typing-avatar" aria-hidden="true">TV</span>
									<div
										class="support-chat__typing-bubble"
										aria-label={$locale === 'en' ? 'Consultant is typing' : 'CSKH đang nhập'}
									>
										<span class="support-chat__typing-dot"></span>
										<span class="support-chat__typing-dot"></span>
										<span class="support-chat__typing-dot"></span>
									</div>
								</div>
							{/if}
						</div>
						{#if unseenConsultantMessages > 0}
							<div class="support-chat__new-badge-wrap">
								<button
									type="button"
									class="support-chat__new-badge"
									onclick={scrollMessagesToBottom}
								>
									<span class="support-chat__new-badge-count">{unseenConsultantMessages}</span>
									<span>
										{$locale === 'en' ? 'New consultant message' : 'Tin nhắn mới từ CSKH'}
									</span>
								</button>
							</div>
						{/if}
						{#if showStarterHints}
							<section class="support-chat__hint-panel" aria-label={copy.starterTitle}>
								<div class="support-chat__hint-copy">
									<p class="support-chat__hint-title">{copy.starterTitle}</p>
									<p class="support-chat__hint-subtitle">{copy.starterHint}</p>
								</div>
								<div class="support-chat__prompt-group support-chat__prompt-group--compact">
									{#each visiblePromptSuggestions as prompt}
										<button
											type="button"
											class="support-chat__prompt"
											disabled={isSending}
											onclick={() => handlePromptClick(prompt)}
										>
											{prompt}
										</button>
									{/each}
									<button
										type="button"
										class="support-chat__prompt support-chat__prompt--consultant"
										disabled={isSending}
										onclick={requestDirectSupport}
									>
										{copy.promptConsultant}
									</button>
								</div>
							</section>
						{/if}
						<form class="support-chat__composer" onsubmit={handleComposerSubmit}>
							<input
								type="text"
								bind:value={draftMessage}
								class="support-chat__input"
								placeholder={copy.chatInputPlaceholder}
								autocomplete="off"
								onfocus={handleMobileZoomReset}
							/>
							<button
								type="submit"
								class="support-chat__send-btn"
								aria-label={copy.sendAria}
								disabled={isSending}
							>
								<svg viewBox="0 0 24 24" fill="none" focusable="false" aria-hidden="true">
									<path d="m3 12 17-8-4 8 4 8-17-8Z" fill="currentColor" />
								</svg>
							</button>
						</form>
					</div>
				{/if}
			</div>
			<span class="support-chat__tail" aria-hidden="true"></span>
		</div>
	{/if}

	<button
		type="button"
		class="support-chat__fab"
		class:is-open={isOpen}
		aria-expanded={isOpen ? 'true' : 'false'}
		aria-controls="support-chat-panel"
		aria-label={isOpen ? copy.hideButtonAria : copy.openButtonAria}
		onclick={togglePanel}
	>
		<span class="support-chat__fab-avatar" aria-hidden="true">
			<svg
				fill="currentColor"
				height="800px"
				width="800px"
				version="1.1"
				id="Capa_1"
				xmlns="http://www.w3.org/2000/svg"
				xmlns:xlink="http://www.w3.org/1999/xlink"
				viewBox="0 0 490.675 490.675"
				xml:space="preserve"
			>
				<g>
					<g>
						<g>
							<path
								d="M490.244,210.3c0-116.1-94.1-210.3-210.3-210.3c-70.9,0-133.7,35.1-171.7,88.9l16,16c33.8-49.9,90.9-82.6,155.7-82.6
				c103.8,0,188,84.2,188,188c0,64.7-32.7,121.7-82.4,155.5l16,16C455.244,343.8,490.244,281.1,490.244,210.3z"
							/>
						</g>
						<path
							d="M334.644,346.2c-14-14-36.9-15.5-51.7-2.3c-25.4,25.4-33.8,22.1-43.1,12.4L133.744,251c-9.7-9.7-13-17.7,12.4-43.1
			c13.2-14.8,11.7-37.7-2.3-51.7L84.044,96c-14-14-36.5-15.5-51.3-2.7c-50.6,45.6-39,153.5,15.5,204l146.1,146.1
			c49.2,52.2,153.8,66.7,202.8,15.2c12.8-14.8,11.3-37.3-2.7-51.3L334.644,346.2z"
						/>
						<g>
							<g>
								<path
									d="M275.844,262.7h-71.7c-6.9,0-12.5-5.6-12.5-12.5c0-24.7,59.8-71.5,63-74.2c3.2-3.7,4.9-8.3,4.9-13.2
					c0-11.1-9.1-20.2-20.2-20.2c-11.1,0-20.2,9.1-20.2,20.2c0,6.9-5.6,12.5-12.5,12.5s-12.5-5.6-12.5-12.5
					c0-24.9,20.3-45.2,45.2-45.2s45.2,20.3,45.2,45.2c0,11.5-4.3,22.4-12.1,30.8c-0.4,0.4-0.8,0.8-1.2,1.2
					c-18,14.8-35.3,31.3-45.5,42.9h50.1c6.9,0,12.5,5.6,12.5,12.5C288.344,257.1,282.744,262.7,275.844,262.7z"
								/>
							</g>
							<g>
								<path
									d="M368.244,264.5c-6.9,0-12.5-5.6-12.5-12.5v-16.1h-52c-4.6,0-8.9-2.6-11.1-6.7s-1.9-9.1,0.8-12.9l64.5-93.3
					c3.1-4.5,8.8-6.4,14-4.8c5.2,1.6,8.8,6.5,8.8,11.9v80.8h14.3c6.9,0,12.5,5.6,12.5,12.5s-5.6,12.5-12.5,12.5h-14.3V252
					C380.744,258.9,375.144,264.5,368.244,264.5z M327.544,210.9h28.2v-40.7L327.544,210.9z"
								/>
							</g>
						</g>
					</g>
				</g>
			</svg>
		</span>
		<span class="support-chat__fab-text">{isOpen ? copy.hideButton : copy.openButton}</span>
	</button>
</div>

<style>
	.support-chat {
		--chat-primary: #0dcaf0;
		--chat-primary-600: #0bb4d6;
		--chat-primary-700: #0999b7;
		--chat-primary-800: #077f97;
		--chat-primary-900: #06667a;
		--chat-border-soft: rgba(13, 202, 240, 0.22);
		--chat-border: rgba(13, 202, 240, 0.4);
		--chat-shadow-soft: rgba(6, 44, 56, 0.12);
		--chat-shadow: rgba(6, 44, 56, 0.2);
		--chat-text-strong: #0b3f4f;
		--chat-text-muted: #52717d;
		--chat-agent-bubble: #ebf9fe;
		--chat-user-bubble: #d9f4fc;
		--chat-user-text: #0a5064;
		position: fixed;
		right: clamp(10px, 2vw, 24px);
		bottom: max(12px, calc(env(safe-area-inset-bottom) + 8px + var(--chat-keyboard-offset, 0px)));
		z-index: 11840;
		display: grid;
		justify-items: end;
		gap: 10px;
		pointer-events: none;
	}

	.support-chat > * {
		pointer-events: auto;
	}

	.support-chat__panel {
		position: relative;
		width: min(390px, calc(100vw - 18px));
		border-radius: 16px;
		border: 1px solid var(--chat-border-soft);
		background: #ffffff;
		box-shadow:
			0 20px 40px var(--chat-shadow),
			0 8px 20px var(--chat-shadow-soft);
		overflow: hidden;
	}

	.support-chat__panel.is-live {
		height: min(600px, var(--chat-live-max-height, calc(100vh - 84px)));
		display: flex;
		flex-direction: column;
		overscroll-behavior: contain;
	}

	.support-chat__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 11px 14px;
		background: linear-gradient(135deg, #eaf9fe, #d9f5fd);
		border-bottom: 1px solid rgba(13, 202, 240, 0.18);
	}

	.support-chat__header.is-live {
		padding: 10px 10px;
		background: linear-gradient(135deg, var(--chat-primary-700), var(--chat-primary-800));
	}

	.support-chat__title-wrap {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.support-chat__title-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: rgba(13, 202, 240, 0.18);
		color: var(--chat-primary-900);
	}

	.support-chat__header.is-live .support-chat__title-icon {
		background: rgba(255, 255, 255, 0.2);
		color: #ffffff;
	}

	.support-chat__title-icon svg {
		width: 15px;
		height: 15px;
		display: block;
		/* Optical alignment: this glyph has a tail, so nudge to true center */
		transform: translate(-0.5px, -0.5px);
	}

	.support-chat__title-text {
		min-width: 0;
	}

	.support-chat__title {
		margin: 0;
		font-size: 1.02rem;
		line-height: 1.2;
		font-weight: 800;
		color: var(--chat-primary-900);
		text-transform: uppercase;
	}

	.support-chat__header.is-live .support-chat__title {
		color: #ffffff;
		text-transform: none;
		font-size: 1.15rem;
	}

	.support-chat__subtitle {
		margin: 2px 0 0;
		font-size: 0.84rem;
		line-height: 1.3;
		color: rgba(255, 255, 255, 0.95);
	}

	.support-chat__header-presence {
		margin-top: 3px;
		display: inline-flex;
		align-items: flex-start;
		gap: 7px;
		font-size: 0.76rem;
		line-height: 1.25;
		color: rgba(255, 255, 255, 0.96);
	}

	.support-chat__header-presence-copy {
		display: grid;
		gap: 1px;
	}

	.support-chat__header-presence-detail {
		font-size: 0.7rem;
		color: rgba(255, 255, 255, 0.8);
	}

	.support-chat__header-presence-dot {
		width: 8px;
		height: 8px;
		margin-top: 0.22rem;
		border-radius: 50%;
		background: currentColor;
		flex: 0 0 auto;
	}

	.support-chat__header-presence--online {
		color: #d1fae5;
	}

	.support-chat__header-presence--waiting {
		color: #fef3c7;
	}

	.support-chat__header-actions {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.support-chat__close-btn {
		flex: 0 0 auto;
		width: 28px;
		height: 28px;
		border: 0;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: #ffffff;
		font-size: 1.2rem;
		line-height: 1;
		font-weight: 700;
		cursor: pointer;
		transition:
			transform 0.16s ease,
			background-color 0.16s ease;
	}

	.support-chat__close-btn {
		background: #ff5f77;
	}

	.support-chat__close-btn:hover,
	.support-chat__close-btn:focus-visible {
		transform: translateY(-1px);
	}

	.support-chat__close-btn:hover,
	.support-chat__close-btn:focus-visible {
		background: #ef4862;
	}

	.support-chat__body {
		padding: 12px;
	}

	.support-chat__body.is-live {
		padding: 0;
		flex: 1 1 auto;
		min-height: 0;
		overscroll-behavior: contain;
	}

	.support-chat__list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 10px;
	}

	.support-chat__list-item {
		min-width: 0;
	}

	.support-chat__item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 64px;
		padding: 10px 12px;
		border-radius: 10px;
		border: 1px solid rgba(13, 202, 240, 0.2);
		background: #ffffff;
		text-decoration: none;
		cursor: pointer;
		transition:
			transform 0.16s ease,
			box-shadow 0.16s ease,
			border-color 0.16s ease;
	}

	.support-chat__item:hover,
	.support-chat__item:focus-visible {
		transform: translateY(-1px);
		box-shadow: 0 8px 16px var(--chat-shadow-soft);
		border-color: var(--chat-border);
	}

	.support-chat__item-icon {
		flex: 0 0 auto;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: #ffffff;
		font-weight: 800;
		font-size: 0.78rem;
	}

	.support-chat__item-icon svg {
		width: 18px;
		height: 18px;
	}

	.support-chat__item-icon--phone {
		background: #12a487;
	}

	.support-chat__item-icon--zalo {
		background: #0a7cff;
	}

	.support-chat__item-icon--messenger {
		background: #1366ff;
	}

	.support-chat__item-icon--live {
		background: #0f8a77;
	}

	.support-chat__wordmark {
		line-height: 1;
	}

	.support-chat__item-text {
		min-width: 0;
		display: grid;
		gap: 2px;
		text-align: left;
	}

	.support-chat__item-title {
		color: var(--chat-text-strong);
		font-weight: 700;
		line-height: 1.25;
		font-size: 0.96rem;
	}

	.support-chat__item-subtitle {
		color: var(--chat-text-muted);
		line-height: 1.3;
		font-size: 0.82rem;
	}

	.support-chat__empty {
		margin: 0;
		padding: 10px 8px;
		font-size: 0.9rem;
		color: var(--chat-text-muted);
	}

	.support-chat__chat-shell {
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: linear-gradient(180deg, #f7fcff 0%, #eef9fe 100%);
		overscroll-behavior: contain;
	}

	.support-chat__notice {
		margin: 10px 12px 0;
		padding: 10px 12px;
		border-radius: 12px;
		background: rgba(220, 38, 38, 0.08);
		color: #b91c1c;
		font-size: 0.84rem;
		line-height: 1.4;
	}

	.support-chat__messages {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 14px 12px 8px;
		display: grid;
		align-content: start;
		gap: 10px;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
		touch-action: pan-y;
	}

	.support-chat__hint-panel {
		display: grid;
		gap: 8px;
		padding: 10px 12px 6px;
		background: linear-gradient(180deg, rgba(238, 249, 254, 0.42), rgba(255, 255, 255, 0.96));
		border-top: 1px solid rgba(13, 202, 240, 0.12);
	}

	.support-chat__hint-copy {
		display: grid;
		gap: 2px;
		padding: 0 2px;
	}

	.support-chat__hint-title,
	.support-chat__hint-subtitle {
		margin: 0;
	}

	.support-chat__hint-title {
		font-size: 0.84rem;
		line-height: 1.35;
		font-weight: 700;
		color: #124454;
	}

	.support-chat__hint-subtitle {
		font-size: 0.75rem;
		line-height: 1.35;
		color: #5c7682;
	}

	.support-chat__typing-indicator {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		align-self: flex-start;
	}

	.support-chat__typing-avatar {
		flex: 0 0 auto;
		width: 24px;
		height: 24px;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #dbeafe;
		color: #1d4ed8;
		font-size: 0.72rem;
		font-weight: 700;
	}

	.support-chat__typing-bubble {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 10px 12px;
		border-radius: 16px;
		background: #eef4ff;
		box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.1);
	}

	.support-chat__typing-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #4f46e5;
		opacity: 0.35;
		animation: supportChatTypingBounce 1.2s infinite ease-in-out;
	}

	.support-chat__typing-dot:nth-child(2) {
		animation-delay: 0.15s;
	}

	.support-chat__typing-dot:nth-child(3) {
		animation-delay: 0.3s;
	}

	@keyframes supportChatTypingBounce {
		0%,
		80%,
		100% {
			transform: translateY(0);
			opacity: 0.35;
		}
		40% {
			transform: translateY(-4px);
			opacity: 1;
		}
	}

	.support-chat__new-badge-wrap {
		position: sticky;
		bottom: calc(70px + env(safe-area-inset-bottom));
		display: flex;
		justify-content: center;
		padding: 0 12px 8px;
		pointer-events: none;
		z-index: 1;
	}

	.support-chat__new-badge {
		pointer-events: auto;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		border: 0;
		border-radius: 999px;
		padding: 8px 12px;
		background: #0f766e;
		color: #ffffff;
		font-size: 0.78rem;
		font-weight: 700;
		box-shadow: 0 10px 24px rgba(15, 118, 110, 0.2);
	}

	.support-chat__new-badge-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		padding: 0 6px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.2);
		font-size: 0.72rem;
	}

	.support-chat__bubble-row {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		max-width: 100%;
	}

	.support-chat__bubble-row.is-user {
		justify-content: flex-end;
	}

	.support-chat__bubble-row.is-system {
		align-items: center;
	}

	.support-chat__bubble-avatar {
		flex: 0 0 auto;
		width: 24px;
		height: 24px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: rgb(248, 109, 114);
	}

	.support-chat__bubble-avatar svg {
		width: 22px;
		height: 22px;
	}

	.support-chat__bubble-avatar--consultant,
	.support-chat__bubble-avatar--system {
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 700;
	}

	.support-chat__bubble-avatar--consultant {
		background: #dbeafe;
		color: #1d4ed8;
	}

	.support-chat__bubble-avatar--system {
		background: #f1f5f9;
		color: #475569;
	}

	.support-chat__bubble-stack {
		display: grid;
		gap: 4px;
		max-width: 82%;
	}

	.support-chat__bubble-label {
		font-size: 0.74rem;
		line-height: 1.1;
		color: var(--chat-text-muted);
		padding-left: 4px;
	}

	.support-chat__bubble {
		margin: 0;
		max-width: 100%;
		padding: 10px 12px;
		border-radius: 14px;
		background: var(--chat-agent-bubble);
		color: #1f2937;
		font-size: 0.96rem;
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.support-chat__bubble-paragraphs {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.support-chat__bubble-line {
		margin: 0;
	}

	.support-chat__bubble-list {
		margin: 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.support-chat__bubble-list-item {
		margin: 0;
	}

	.support-chat__bubble-key {
		font-weight: 700;
	}

	.support-chat__bubble.is-user {
		background: var(--chat-user-bubble);
		color: var(--chat-user-text);
	}

	.support-chat__bubble.is-consultant {
		background: #eef4ff;
		color: #1e3a8a;
	}

	.support-chat__bubble.is-system {
		background: #f8fafc;
		color: #475569;
	}

	.support-chat__bubble--pending {
		opacity: 0.86;
		font-style: italic;
	}

	.support-chat__prompt-group {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 6px 12px 10px;
	}

	.support-chat__prompt-group--compact {
		padding: 0;
	}

	.support-chat__prompt {
		border: 1px solid rgba(13, 202, 240, 0.3);
		background: #ffffff;
		color: #334155;
		border-radius: 999px;
		padding: 7px 12px;
		font-size: 0.86rem;
		line-height: 1.2;
		cursor: pointer;
		transition:
			transform 0.16s ease,
			border-color 0.16s ease,
			color 0.16s ease;
	}

	.support-chat__prompt:hover,
	.support-chat__prompt:focus-visible {
		transform: translateY(-1px);
		border-color: rgba(13, 202, 240, 0.64);
		color: var(--chat-primary-900);
	}

	.support-chat__prompt--consultant {
		background: linear-gradient(135deg, rgba(13, 202, 240, 0.12), rgba(15, 118, 110, 0.12));
		border-color: rgba(15, 118, 110, 0.28);
		color: var(--chat-primary-900);
		font-weight: 700;
	}

	.support-chat__composer {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px 14px;
		background: #ffffff;
		border-top: 1px solid rgba(13, 202, 240, 0.18);
		position: sticky;
		bottom: 0;
		z-index: 2;
		padding-bottom: max(14px, calc(env(safe-area-inset-bottom) + 10px));
	}

	.support-chat__input {
		flex: 1 1 auto;
		min-width: 0;
		border: 1px solid rgba(15, 20, 24, 0.12);
		border-radius: 999px;
		height: 44px;
		padding: 0 14px;
		font-size: 0.94rem;
		outline: none;
	}

	.support-chat__input:focus {
		border-color: rgba(13, 202, 240, 0.72);
		box-shadow: 0 0 0 3px rgba(13, 202, 240, 0.18);
	}

	.support-chat__send-btn {
		width: 40px;
		height: 40px;
		border: 0;
		border-radius: 50%;
		background: var(--chat-primary-700);
		color: #ffffff;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			transform 0.16s ease,
			background-color 0.16s ease;
	}

	.support-chat__send-btn svg {
		width: 18px;
		height: 18px;
	}

	.support-chat__send-btn:hover,
	.support-chat__send-btn:focus-visible {
		transform: translateY(-1px);
		background: var(--chat-primary-800);
	}

	.support-chat__send-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
	}

	.support-chat__tail {
		position: absolute;
		right: 22px;
		bottom: -10px;
		width: 18px;
		height: 18px;
		background: #ffffff;
		border-right: 1px solid var(--chat-border-soft);
		border-bottom: 1px solid var(--chat-border-soft);
		transform: rotate(45deg);
	}

	.support-chat__fab {
		border: none;
		border-radius: 999px;
		min-height: 52px;
		padding: 7px 14px 7px 8px;
		display: inline-flex;
		align-items: center;
		gap: 10px;
		background: linear-gradient(135deg, var(--chat-primary-700), var(--chat-primary-900));
		color: #ffffff;
		font-weight: 800;
		font-size: 1.02rem;
		box-shadow:
			0 16px 30px rgba(11, 31, 44, 0.24),
			0 6px 12px rgba(11, 31, 44, 0.14);
		cursor: pointer;
		transition:
			transform 0.16s ease,
			box-shadow 0.16s ease,
			filter 0.16s ease;
	}

	.support-chat__fab:hover,
	.support-chat__fab:focus-visible {
		transform: translateY(-1px);
		filter: brightness(1.02);
		box-shadow:
			0 18px 34px rgba(11, 31, 44, 0.26),
			0 8px 14px rgba(11, 31, 44, 0.16);
	}

	.support-chat__fab.is-open {
		background: linear-gradient(135deg, var(--chat-primary-600), var(--chat-primary-800));
	}

	.support-chat__fab-avatar {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.22);
		color: #ffffff;
	}

	.support-chat__fab-avatar svg {
		width: 24px;
		height: 24px;
	}

	.support-chat__fab-text {
		white-space: nowrap;
		line-height: 1;
	}

	@media (max-width: 768px) {
		.support-chat {
			right: 10px;
			bottom: max(10px, calc(env(safe-area-inset-bottom) + 6px));
		}

		.support-chat__panel {
			width: min(360px, calc(100vw - 12px));
		}

		.support-chat__panel.is-live {
			height: min(520px, var(--chat-live-max-height, calc(100vh - 72px)));
		}

		.support-chat__title {
			font-size: 0.92rem;
		}

		.support-chat__header.is-live .support-chat__title {
			font-size: 1.02rem;
		}

		.support-chat__hint-panel {
			padding: 10px 10px 4px;
		}

		.support-chat__hint-title {
			font-size: 0.81rem;
		}

		.support-chat__hint-subtitle {
			font-size: 0.72rem;
		}

		.support-chat__item {
			min-height: 58px;
			padding: 9px 10px;
		}

		.support-chat__fab {
			min-height: 48px;
			padding-right: 12px;
			font-size: 0.95rem;
		}

		.support-chat__fab-avatar {
			width: 34px;
			height: 34px;
		}
	}

	@media (max-width: 420px) {
		.support-chat__item-subtitle {
			display: none;
		}

		.support-chat__item {
			min-height: 52px;
		}

		.support-chat__bubble {
			max-width: 88%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.support-chat__close-btn,
		.support-chat__item,
		.support-chat__prompt,
		.support-chat__send-btn,
		.support-chat__fab,
		.support-chat__typing-dot {
			transition: none;
			animation: none;
		}
	}
</style>
