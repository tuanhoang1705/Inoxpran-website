const GLOBAL_CLEANUP_KEY = '__inoxpran_client_cleanup__';
const BOOTSTRAP_BUNDLE_URL =
	'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js';
const EXTERNAL_SCRIPT_PROMISES = new Map();

const safeCall = (fn) => {
	try {
		return fn?.();
	} catch {
		return undefined;
	}
};

const ensureNativeScrollShell = () => {
	document.body?.classList?.add('no-smoother');
	document.body?.style?.removeProperty?.('overflow');
	document.documentElement?.style?.removeProperty?.('overflow');
};

const loadExternalScript = (src, timeoutMs = 7000) => {
	if (!src || typeof document === 'undefined') return Promise.resolve(false);

	const cached = EXTERNAL_SCRIPT_PROMISES.get(src);
	if (cached) return cached;

	const promise = new Promise((resolve) => {
		let settled = false;
		let timeoutId = null;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			if (timeoutId) clearTimeout(timeoutId);
			resolve(Boolean(value));
		};

		timeoutId = setTimeout(() => finish(false), timeoutMs);

		const existing = Array.from(document.scripts || []).find((script) => script.src === src);
		if (existing) {
			if (existing.dataset.loaded === '1') {
				finish(true);
				return;
			}
			if (existing.dataset.failed === '1') {
				finish(false);
				return;
			}
			existing.addEventListener(
				'load',
				() => {
					existing.dataset.loaded = '1';
					finish(true);
				},
				{ once: true }
			);
			existing.addEventListener(
				'error',
				() => {
					existing.dataset.failed = '1';
					finish(false);
				},
				{ once: true }
			);
			return;
		}

		const script = document.createElement('script');
		script.src = src;
		script.async = true;
		script.defer = true;
		script.dataset.inoxpranExternal = '1';
		script.addEventListener(
			'load',
			() => {
				script.dataset.loaded = '1';
				finish(true);
			},
			{ once: true }
		);
		script.addEventListener(
			'error',
			() => {
				script.dataset.failed = '1';
				finish(false);
			},
			{ once: true }
		);
		document.head.appendChild(script);
	});

	EXTERNAL_SCRIPT_PROMISES.set(src, promise);
	return promise;
};

const createNativeScrollToTarget = () => (target, animate = true) => {
	if (typeof window === 'undefined') return;
	const behavior = animate ? 'smooth' : 'auto';

	if (typeof target === 'number' && Number.isFinite(target)) {
		window.scrollTo({ top: Math.max(0, target), left: 0, behavior });
		return;
	}

	if (typeof target === 'string' && target) {
		const el = document.querySelector(target);
		if (el) {
			const top = el.getBoundingClientRect().top + window.scrollY;
			window.scrollTo({ top: Math.max(0, top), left: 0, behavior });
			return;
		}
	}

	window.scrollTo({ top: 0, left: 0, behavior });
};

const scheduleIdleTask = (task, { timeoutMs = 1200, fallbackDelayMs = 180 } = {}) => {
	if (typeof window === 'undefined') return () => {};

	let cancelled = false;
	let idleId = null;
	let timeoutId = null;

	const run = () => {
		idleId = null;
		timeoutId = null;
		if (cancelled) return;
		void task();
	};

	if (typeof window.requestIdleCallback === 'function') {
		idleId = window.requestIdleCallback(run, { timeout: timeoutMs });
	} else {
		timeoutId = window.setTimeout(run, fallbackDelayMs);
	}

	return () => {
		cancelled = true;
		if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
			window.cancelIdleCallback(idleId);
		}
		if (timeoutId !== null) {
			window.clearTimeout(timeoutId);
		}
	};
};

const setupTooltips = (addCleanup) => {
	if (!window.bootstrap?.Tooltip) return;
	const instances = [];
	document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
		safeCall(() => window.bootstrap.Tooltip.getInstance(el)?.dispose?.());
		const trigger = el.getAttribute('data-bs-trigger') || 'hover';
		try {
			const instance = new window.bootstrap.Tooltip(el, { trigger });
			instances.push(instance);
		} catch (error) {
			console.warn('[initClient] Tooltip init failed:', error);
		}
	});

	if (!instances.length) return;
	addCleanup(() => {
		instances.forEach((instance) => safeCall(() => instance.dispose?.()));
	});
};

const resolveSwiperNavigation = (swiperEl) => {
	const scopes = [
		swiperEl.closest('section'),
		swiperEl.parentElement,
		swiperEl.closest('.container'),
		document
	].filter(Boolean);

	let nextEl = null;
	let prevEl = null;
	for (const scope of scopes) {
		nextEl = nextEl || scope.querySelector?.('.product-slider-button-next') || null;
		prevEl = prevEl || scope.querySelector?.('.product-slider-button-prev') || null;
		if (nextEl || prevEl) break;
	}

	return nextEl || prevEl ? { nextEl, prevEl } : null;
};

const toggleDisabledNav = (el, disabled) => {
	if (!el) return;
	el.classList.toggle('swiper-button-disabled', Boolean(disabled));
	el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
	if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
	if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
};

const setupNativeProductSliders = (addCleanup) => {
	const sliders = Array.from(document.querySelectorAll('.product-swiper'));
	if (!sliders.length) return;

	sliders.forEach((slider) => {
		const navigation = resolveSwiperNavigation(slider);
		const prevEl = navigation?.prevEl || null;
		const nextEl = navigation?.nextEl || null;
		if (!prevEl || !nextEl) return;

		let rafId = 0;
		let settleTimerId = 0;
		let pendingScrollLeft = null;

		const getStep = () => {
			const slides = Array.from(slider.querySelectorAll('.swiper-slide'));
			if (slides.length >= 2) {
				const delta = Math.abs(slides[1].offsetLeft - slides[0].offsetLeft);
				if (delta > 0) return delta;
			}
			if (slides.length === 1) {
				const width = slides[0].getBoundingClientRect().width;
				if (width > 0) return width;
			}
			return Math.max(220, Math.round(slider.clientWidth * 0.9));
		};

		const updateNavState = (currentOverride = null) => {
			const maxScroll = Math.max(0, slider.scrollWidth - slider.clientWidth);
			const current = Math.max(
				0,
				Number.isFinite(currentOverride) ? Number(currentOverride) : slider.scrollLeft
			);
			const atStart = current <= 2 || maxScroll <= 2;
			const atEnd = current >= maxScroll - 2 || maxScroll <= 2;
			toggleDisabledNav(prevEl, atStart);
			toggleDisabledNav(nextEl, atEnd);
		};

		const queueUpdate = () => {
			if (rafId) return;
			rafId = requestAnimationFrame(() => {
				rafId = 0;
				updateNavState();
			});
		};

		const clearPendingTarget = () => {
			pendingScrollLeft = null;
			if (settleTimerId) {
				window.clearTimeout(settleTimerId);
				settleTimerId = 0;
			}
		};

		const schedulePendingClear = () => {
			if (settleTimerId) window.clearTimeout(settleTimerId);
			settleTimerId = window.setTimeout(() => {
				settleTimerId = 0;
				pendingScrollLeft = null;
				queueUpdate();
			}, 420);
		};

		const scrollByStep = (direction) => {
			const maxScroll = Math.max(0, slider.scrollWidth - slider.clientWidth);
			const current = Math.max(
				0,
				Number.isFinite(pendingScrollLeft) ? Number(pendingScrollLeft) : slider.scrollLeft
			);
			const atStart = current <= 2 || maxScroll <= 2;
			const atEnd = current >= maxScroll - 2 || maxScroll <= 2;
			if ((direction < 0 && atStart) || (direction > 0 && atEnd)) {
				updateNavState(current);
				return;
			}

			const step = Math.max(180, Math.round(getStep()));
			const target = Math.max(0, Math.min(maxScroll, current + direction * step));
			if (Math.abs(target - current) <= 2) {
				updateNavState(current);
				return;
			}

			pendingScrollLeft = target;
			updateNavState(target);
			schedulePendingClear();
			slider.scrollTo({
				left: target,
				top: 0,
				behavior: 'smooth'
			});
		};

		const handlePrevClick = (event) => {
			event?.preventDefault?.();
			scrollByStep(-1);
		};
		const handleNextClick = (event) => {
			event?.preventDefault?.();
			scrollByStep(1);
		};
		const handlePrevKeydown = (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			scrollByStep(-1);
		};
		const handleNextKeydown = (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			scrollByStep(1);
		};

		const handleScroll = () => {
			if (Number.isFinite(pendingScrollLeft)) {
				const distance = Math.abs(slider.scrollLeft - Number(pendingScrollLeft));
				if (distance <= 3) {
					clearPendingTarget();
				}
			}
			queueUpdate();
		};
		const handleResize = () => queueUpdate();

		slider.addEventListener('scroll', handleScroll, { passive: true });
		window.addEventListener('resize', handleResize, { passive: true });
		prevEl.addEventListener('click', handlePrevClick);
		nextEl.addEventListener('click', handleNextClick);
		prevEl.addEventListener('keydown', handlePrevKeydown);
		nextEl.addEventListener('keydown', handleNextKeydown);

		queueUpdate();
		const timeoutId = window.setTimeout(queueUpdate, 60);

		addCleanup(() => {
			slider.removeEventListener('scroll', handleScroll);
			window.removeEventListener('resize', handleResize);
			prevEl.removeEventListener('click', handlePrevClick);
			nextEl.removeEventListener('click', handleNextClick);
			prevEl.removeEventListener('keydown', handlePrevKeydown);
			nextEl.removeEventListener('keydown', handleNextKeydown);
			window.clearTimeout(timeoutId);
			if (settleTimerId) {
				window.clearTimeout(settleTimerId);
				settleTimerId = 0;
			}
			pendingScrollLeft = null;
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
		});
	});
};

const setupScrollLinks = (addCleanup) => {
	const scrollToTarget = createNativeScrollToTarget();

	document.querySelectorAll('[data-scroll-to]').forEach((link) => {
		const handleClick = (event) => {
			event.preventDefault();
			const target = link.getAttribute('data-scroll-to');
			if (!target) return;
			scrollToTarget(target, true);
		};
		link.addEventListener('click', handleClick);
		addCleanup(() => link.removeEventListener('click', handleClick));
	});

	const backToTop = document.getElementById('back-to-top');
	if (backToTop) {
		const handleBackToTop = (event) => {
			event?.preventDefault?.();
			scrollToTarget('#hero', true);
		};
		backToTop.addEventListener('click', handleBackToTop);
		addCleanup(() => backToTop.removeEventListener('click', handleBackToTop));
	}
};

export function initClient() {
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		return () => {};
	}

	const previousCleanup = window[GLOBAL_CLEANUP_KEY];
	if (typeof previousCleanup === 'function') {
		safeCall(previousCleanup);
	}

	let destroyed = false;
	const cleanupFns = [];
	const addCleanup = (fn) => {
		if (typeof fn === 'function') cleanupFns.push(fn);
	};

	const cleanup = () => {
		if (destroyed) return;
		destroyed = true;
		for (const fn of cleanupFns.splice(0)) {
			safeCall(fn);
		}
		if (window[GLOBAL_CLEANUP_KEY] === cleanup) {
			window[GLOBAL_CLEANUP_KEY] = null;
		}
	};

	window[GLOBAL_CLEANUP_KEY] = cleanup;

	const run = async () => {
		if (destroyed) return;

		ensureNativeScrollShell();
		setupScrollLinks(addCleanup);
		setupNativeProductSliders(addCleanup);

		const hasHomeSections = Boolean(document.querySelector('#hero') || document.querySelector('#inox'));
		const shouldEnableHomeSectionsMotion = hasHomeSections;
		if (shouldEnableHomeSectionsMotion) {
			try {
				const { initHomeSectionsMotion } = await import('./homeSectionsMotion.js');
				if (destroyed) return;
				const homeMotionCleanup = await initHomeSectionsMotion();
				if (destroyed) {
					safeCall(homeMotionCleanup);
					return;
				}
				addCleanup(homeMotionCleanup);
			} catch (error) {
				console.warn('[initClient] Home section motion init failed:', error);
			}
		}

		const cancelDeferredUiInit = scheduleIdleTask(async () => {
			if (destroyed) return;

			const needsTooltips = Boolean(document.querySelector('[data-bs-toggle="tooltip"]'));
			const loads = [];

			if (needsTooltips && !window.bootstrap?.Tooltip) {
				loads.push(loadExternalScript(BOOTSTRAP_BUNDLE_URL));
			}
			if (loads.length) {
				await Promise.allSettled(loads);
				if (destroyed) return;
			}

			setupTooltips(addCleanup);

		});
		addCleanup(cancelDeferredUiInit);
	};

	if (document.readyState === 'loading') {
		const handleDOMContentLoaded = () => {
			void run();
		};
		document.addEventListener('DOMContentLoaded', handleDOMContentLoaded, { once: true });
		addCleanup(() => document.removeEventListener('DOMContentLoaded', handleDOMContentLoaded));
	} else {
		void run();
	}

	return cleanup;
}
