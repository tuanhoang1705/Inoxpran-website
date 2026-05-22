const STORAGE_SESSION_KEY = 'inoxpran.telemetry.session_id';
const API_ENDPOINT = '/api/telemetry';
const MAX_QUEUE_SIZE = 50;
const FLUSH_DELAY_MS = 4000;
const HEARTBEAT_INTERVAL_MS = 15000;
const CLICK_DEDUP_WINDOW_MS = 250;
const SCROLL_THRESHOLDS = [25, 50, 75, 90, 100];

const nowMs = () => Date.now();
const perfNow = () =>
	typeof performance !== 'undefined' && typeof performance.now === 'function'
		? performance.now()
		: nowMs();

const safeString = (value, max = 240) => {
	if (value == null) return '';
	const text = String(value).trim();
	return text ? text.slice(0, max) : '';
};

const toIsoNow = () => new Date().toISOString();

const buildPathFromLocation = (locationLike) => {
	const pathname = safeString(locationLike?.pathname || '/', 300) || '/';
	const search = safeString(locationLike?.search || '', 300);
	return `${pathname}${search}`.slice(0, 300);
};

const createSessionId = () => {
	try {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return `sid_${crypto.randomUUID()}`;
		}
	} catch {}
	return `sid_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
};

const readStoredSessionId = () => {
	if (typeof window === 'undefined') return '';
	try {
		return safeString(window.localStorage.getItem(STORAGE_SESSION_KEY), 120);
	} catch {
		return '';
	}
};

export const getStoredTelemetrySessionId = () => readStoredSessionId();

const persistSessionId = (value) => {
	if (typeof window === 'undefined') return;
	try {
		if (value) {
			window.localStorage.setItem(STORAGE_SESSION_KEY, value);
		}
	} catch {}
};

const normalizeHrefToPath = (href) => {
	const value = safeString(href, 1000);
	if (!value) return '';
	try {
		const url = new URL(value, window.location.href);
		return `${url.pathname}${url.search}${url.hash}`.slice(0, 300);
	} catch {
		return value.slice(0, 300);
	}
};

const isDocumentVisible = () => {
	if (typeof document === 'undefined') return false;
	if (document.visibilityState === 'hidden') return false;
	if (typeof document.hasFocus === 'function') return document.hasFocus();
	return true;
};

class TelemetryTracker {
	constructor() {
		this.started = false;
		this.sessionId = '';
		this.locale = 'vi';
		this.queue = [];
		this.flushTimer = 0;
		this.heartbeatTimer = 0;
		this.scrollRaf = 0;
		this.lastClickStamp = 0;
		this.pendingActiveMs = 0;
		this.lastActiveTick = 0;
		this.currentPage = {
			key: '',
			path: '',
			url: '',
			title: '',
			enteredAt: 0,
			maxScrollDepth: 0,
			sentScrollThresholds: new Set()
		};
		this.lastProductViewKey = '';
		this.lastBlogViewKey = '';
		this.bound = {
			scroll: () => this.handleScroll(),
			click: (event) => this.handleClick(event),
			visibilitychange: () => this.handleVisibilityChange(),
			focus: () => this.handleFocus(),
			blur: () => this.handleBlur(),
			pagehide: () => this.handlePageHide()
		};
	}

	start({ locale } = {}) {
		if (typeof window === 'undefined' || typeof document === 'undefined') return;
		if (this.started) {
			if (locale) this.setLocale(locale);
			return;
		}
		this.started = true;
		this.sessionId = readStoredSessionId() || createSessionId();
		persistSessionId(this.sessionId);
		this.setLocale(locale || this.locale);
		this.lastActiveTick = perfNow();

		window.addEventListener('scroll', this.bound.scroll, { passive: true });
		document.addEventListener('click', this.bound.click, true);
		document.addEventListener('visibilitychange', this.bound.visibilitychange);
		window.addEventListener('focus', this.bound.focus);
		window.addEventListener('blur', this.bound.blur);
		window.addEventListener('pagehide', this.bound.pagehide);

		this.heartbeatTimer = window.setInterval(() => {
			this.flushHeartbeat();
		}, HEARTBEAT_INTERVAL_MS);
	}

	setLocale(locale) {
		const next = safeString(locale, 8).toLowerCase();
		if (!next) return;
		this.locale = next.startsWith('en') ? 'en' : 'vi';
	}

	destroy() {
		if (typeof window === 'undefined' || typeof document === 'undefined') return;
		if (!this.started) return;
		this.started = false;
		window.removeEventListener('scroll', this.bound.scroll);
		document.removeEventListener('click', this.bound.click, true);
		document.removeEventListener('visibilitychange', this.bound.visibilitychange);
		window.removeEventListener('focus', this.bound.focus);
		window.removeEventListener('blur', this.bound.blur);
		window.removeEventListener('pagehide', this.bound.pagehide);
		if (this.flushTimer) window.clearTimeout(this.flushTimer);
		if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
		if (this.scrollRaf) window.cancelAnimationFrame(this.scrollRaf);
		this.flush({ keepalive: true, preferBeacon: true });
	}

	trackNavigation({ url, pageData, locale } = {}) {
		if (locale) this.setLocale(locale);
		if (typeof window === 'undefined') return;
		const locationLike = url || window.location;
		const path = buildPathFromLocation(locationLike);
		const pageKey = path;
		const absoluteUrl = safeString(locationLike?.href || window.location.href, 1000);
		const title = safeString(document?.title || '', 200);

		if (this.currentPage.key && this.currentPage.key !== pageKey) {
			this.finalizeCurrentPage('page_leave', 'navigation');
		}

		if (this.currentPage.key === pageKey) {
			this.currentPage.title = title || this.currentPage.title;
			this.currentPage.url = absoluteUrl || this.currentPage.url;
		} else {
			this.currentPage = {
				key: pageKey,
				path,
				url: absoluteUrl,
				title,
				enteredAt: nowMs(),
				maxScrollDepth: 0,
				sentScrollThresholds: new Set()
			};
			this.lastActiveTick = perfNow();

			this.enqueue({
				type: 'page_view',
				timestamp: toIsoNow(),
				path,
				url: absoluteUrl,
				title,
				locale: this.locale,
				meta: {
					routeType: this.resolveRouteType(path)
				}
			});
		}

		this.trackResourceViews({ path, pageData, absoluteUrl });
	}

	resolveRouteType(path) {
		if (path.startsWith('/product/')) return 'product';
		if (path.startsWith('/blog/')) return 'blog';
		if (path.startsWith('/shop')) return 'shop';
		if (path.startsWith('/category/') || path.startsWith('/categories/')) return 'category';
		return 'page';
	}

	trackResourceViews({ path, pageData, absoluteUrl }) {
		const product = pageData?.product;
		if (product && (product._id || product.product_slug || product.slug)) {
			const key = `${product._id || ''}:${product.product_slug || product.slug || ''}:${path}`;
			if (this.lastProductViewKey !== key) {
				this.lastProductViewKey = key;
				this.enqueue({
					type: 'product_view',
					timestamp: toIsoNow(),
					path,
					url: absoluteUrl,
					locale: this.locale,
					product: {
						productId: product._id || null,
						slug: product.product_slug || product.slug || null,
						name: product.product_name || product.name || null
					}
				});
			}
		}

		const post = pageData?.post;
		if (post && (post.slug || post._id || post.title)) {
			const key = `${post._id || ''}:${post.slug || ''}:${path}`;
			if (this.lastBlogViewKey !== key) {
				this.lastBlogViewKey = key;
				this.enqueue({
					type: 'blog_view',
					timestamp: toIsoNow(),
					path,
					url: absoluteUrl,
					locale: this.locale,
					meta: {
						blogSlug: post.slug || null,
						title: safeString(post.title, 180) || null
					}
				});
			}
		}
	}

	trackEvent(event) {
		this.enqueue(event);
	}

	enqueue(event) {
		if (!this.started || !event || typeof event !== 'object') return;
		this.queue.push(event);
		if (this.queue.length > MAX_QUEUE_SIZE) {
			this.queue.splice(0, this.queue.length - MAX_QUEUE_SIZE);
		}
		if (this.queue.length >= 10) {
			void this.flush();
			return;
		}
		if (this.flushTimer) return;
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = 0;
			void this.flush();
		}, FLUSH_DELAY_MS);
	}

	buildPayload(events) {
		return {
			sessionId: this.sessionId,
			locale: this.locale,
			timezoneOffsetMinutes: new Date().getTimezoneOffset(),
			events
		};
	}

	async flush({ keepalive = false, preferBeacon = false } = {}) {
		if (!this.started || !this.queue.length || typeof window === 'undefined') return;
		const events = this.queue.splice(0, this.queue.length);
		if (this.flushTimer) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = 0;
		}

		const payload = this.buildPayload(events);
		const body = JSON.stringify(payload);

		if (preferBeacon && this.trySendBeacon(body)) {
			return;
		}

		try {
			const response = await fetch(API_ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body,
				keepalive
			});
			const responsePayload = await response.json().catch(() => null);
			const nextSessionId = safeString(responsePayload?.metadata?.sessionId, 120);
			if (nextSessionId && nextSessionId !== this.sessionId) {
				this.sessionId = nextSessionId;
				persistSessionId(nextSessionId);
			}
		} catch {
			this.queue.unshift(...events.slice(-MAX_QUEUE_SIZE));
		}
	}

	trySendBeacon(body) {
		if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
			return false;
		}
		try {
			const blob = new Blob([body], { type: 'application/json' });
			return navigator.sendBeacon(API_ENDPOINT, blob);
		} catch {
			return false;
		}
	}

	markActiveTime() {
		if (!this.started) return;
		const now = perfNow();
		if (!this.lastActiveTick) {
			this.lastActiveTick = now;
			return;
		}
		if (!isDocumentVisible()) {
			this.lastActiveTick = now;
			return;
		}
		const delta = Math.max(0, now - this.lastActiveTick);
		this.pendingActiveMs += Math.min(delta, HEARTBEAT_INTERVAL_MS * 2);
		this.lastActiveTick = now;
	}

	flushHeartbeat() {
		this.markActiveTime();
		if (!this.currentPage.path) return;
		if (this.pendingActiveMs < 1000) return;
		const durationMs = Math.round(this.pendingActiveMs);
		this.pendingActiveMs = 0;
		this.enqueue({
			type: 'heartbeat',
			timestamp: toIsoNow(),
			path: this.currentPage.path,
			url: this.currentPage.url || window.location.href,
			locale: this.locale,
			durationMs,
			scrollDepthPercent: Math.round(this.currentPage.maxScrollDepth || 0)
		});
	}

	finalizeCurrentPage(eventType = 'page_leave', reason = '') {
		if (!this.currentPage.path) return;
		this.markActiveTime();
		const durationMs = Math.round(this.pendingActiveMs);
		this.pendingActiveMs = 0;
		if (durationMs <= 0 && (this.currentPage.maxScrollDepth || 0) <= 0) return;
		this.enqueue({
			type: eventType,
			timestamp: toIsoNow(),
			path: this.currentPage.path,
			url: this.currentPage.url || (typeof window !== 'undefined' ? window.location.href : ''),
			title: this.currentPage.title,
			locale: this.locale,
			durationMs: Math.max(0, durationMs),
			scrollDepthPercent: Math.round(this.currentPage.maxScrollDepth || 0),
			meta: {
				reason: safeString(reason, 40) || null,
				pageEnteredAt: this.currentPage.enteredAt || null
			}
		});
	}

	handleFocus() {
		this.lastActiveTick = perfNow();
	}

	handleBlur() {
		this.markActiveTime();
	}

	handleVisibilityChange() {
		if (document.visibilityState === 'hidden') {
			this.markActiveTime();
			this.flushHeartbeat();
			void this.flush({ keepalive: true, preferBeacon: true });
			return;
		}
		this.lastActiveTick = perfNow();
	}

	handlePageHide() {
		this.finalizeCurrentPage('session_end', 'pagehide');
		void this.flush({ keepalive: true, preferBeacon: true });
	}

	handleScroll() {
		if (this.scrollRaf || typeof window === 'undefined' || typeof document === 'undefined') return;
		this.scrollRaf = window.requestAnimationFrame(() => {
			this.scrollRaf = 0;
			const doc = document.documentElement;
			const body = document.body;
			const scrollTop = window.scrollY || doc?.scrollTop || body?.scrollTop || 0;
			const scrollHeight = Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0);
			const clientHeight = window.innerHeight || doc?.clientHeight || 0;
			const maxScrollable = Math.max(scrollHeight - clientHeight, 0);
			const percent =
				maxScrollable <= 0 ? 100 : Math.round((Math.max(0, scrollTop) / maxScrollable) * 100);
			const clampedPercent = Math.min(100, Math.max(0, percent));
			this.currentPage.maxScrollDepth = Math.max(this.currentPage.maxScrollDepth || 0, clampedPercent);
			for (const threshold of SCROLL_THRESHOLDS) {
				if (clampedPercent < threshold) continue;
				if (this.currentPage.sentScrollThresholds.has(threshold)) continue;
				this.currentPage.sentScrollThresholds.add(threshold);
				this.enqueue({
					type: 'scroll',
					timestamp: toIsoNow(),
					path: this.currentPage.path || buildPathFromLocation(window.location),
					url: window.location.href,
					locale: this.locale,
					scrollDepthPercent: threshold,
					meta: { threshold }
				});
			}
		});
	}

	handleClick(event) {
		if (!event || typeof document === 'undefined') return;
		const now = nowMs();
		if (now - this.lastClickStamp < CLICK_DEDUP_WINDOW_MS) return;

		const target = event.target instanceof Element ? event.target : null;
		if (!target) return;
		const el = target.closest('[data-track], a, button');
		if (!el) return;

		const tagName = String(el.tagName || '').toLowerCase();
		const href = tagName === 'a' ? el.getAttribute('href') || '' : '';
		const dataset = el.dataset || {};
		const label =
			safeString(dataset.trackLabel, 180) ||
			safeString(el.getAttribute('aria-label'), 180) ||
			safeString(el.textContent, 180);
		const trackName = safeString(dataset.track || dataset.trackClick, 80);
		const trackSection = safeString(dataset.trackSection, 80);
		const path = this.currentPage.path || (typeof window !== 'undefined' ? buildPathFromLocation(window.location) : '/');
		const normalizedHref = normalizeHrefToPath(href);

		const clickPayload = {
			label,
			href: normalizedHref || (tagName === 'a' ? safeString(href, 1000) : ''),
			element: tagName || null,
			trackName,
			trackSection,
			productId: safeString(dataset.productId, 64) || null,
			productSlug: safeString(dataset.productSlug, 160) || null,
			productName: safeString(dataset.productName, 180) || null,
			blogSlug: safeString(dataset.blogSlug, 160) || null
		};

		if (!clickPayload.label && !clickPayload.href && !clickPayload.trackName) return;
		this.lastClickStamp = now;
		this.enqueue({
			type: 'click',
			timestamp: toIsoNow(),
			path,
			url: typeof window !== 'undefined' ? window.location.href : '',
			locale: this.locale,
			click: clickPayload
		});
	}
}

let telemetryTrackerSingleton = null;

export const getTelemetryTracker = () => {
	if (!telemetryTrackerSingleton) {
		telemetryTrackerSingleton = new TelemetryTracker();
	}
	return telemetryTrackerSingleton;
};

export const resetTelemetryTrackerForTests = () => {
	if (!telemetryTrackerSingleton) return;
	telemetryTrackerSingleton.destroy();
	telemetryTrackerSingleton = null;
};
