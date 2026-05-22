const ROOT_CLASS = 'home-motion-enabled';
const ITEM_CLASS = 'home-motion-item';
const VISIBLE_CLASS = 'is-visible';
const LINE_CLASS = 'home-motion-line';
const LEGACY_TRANSFORM_CLASS = 'home-motion-legacy-transform';

const supportsCssFeature = (property, value) => {
	try {
		if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
		return CSS.supports(property, value);
	} catch {
		return false;
	}
};

const supportsTranslateLonghand = () => supportsCssFeature('translate', '1px');
const supportsScrollDrivenAnimations = () => supportsCssFeature('animation-timeline', 'view()');

const parseCssNumber = (value, fallback = 0) => {
	const parsed = Number.parseFloat(String(value || '').trim());
	return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const inViewport = (el, visibleRatio = 0.18) => {
	if (!el || typeof window === 'undefined') return false;
	const rect = el.getBoundingClientRect();
	const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
	if (rect.height <= 0 || viewportHeight <= 0) return false;

	const visibleTop = Math.max(rect.top, 0);
	const visibleBottom = Math.min(rect.bottom, viewportHeight);
	const visibleHeight = Math.max(0, visibleBottom - visibleTop);
	return visibleHeight / Math.max(1, rect.height) >= visibleRatio;
};

const tagMotionItem = (el, { x = 0, y = 18, delayMs = 0, durationMs = 520, line = false } = {}) => {
	if (!(el instanceof HTMLElement)) return null;
	el.classList.add(ITEM_CLASS);
	if (line) el.classList.add(LINE_CLASS);
	el.style.setProperty('--home-motion-x', `${x}px`);
	el.style.setProperty('--home-motion-y', `${y}px`);
	el.style.setProperty('--home-motion-delay', `${delayMs}ms`);
	el.style.setProperty('--home-motion-duration', `${durationMs}ms`);
	return el;
};

const buildMotionRegistry = () => {
	const entries = [];

	const hero = document.querySelector('#hero');
	if (hero) {
		const heroBg = hero.querySelector('.panel-bg');
		const heroStove =
			hero.querySelector('.hero-stove-layer picture') || hero.querySelector('.hero-stove');
		const heroTitle = hero.querySelector('.hero-title');
		const heroLine = hero.querySelector('.panel-line');
		const heroSubtitle = hero.querySelector('.panel-subtitle');
		const heroTags = Array.from(hero.querySelectorAll('.tag-row-s1 .tag'));
		const heroCta = hero.querySelector('.btn-s1');

		const items = [
			tagMotionItem(heroBg, { y: 14, durationMs: 480 }),
			tagMotionItem(heroStove, { x: 28, y: 20, delayMs: 40, durationMs: 700 }),
			tagMotionItem(heroTitle, { y: 24, delayMs: 70, durationMs: 460 }),
			tagMotionItem(heroLine, { y: 12, delayMs: 120, durationMs: 340, line: true }),
			tagMotionItem(heroSubtitle, { y: 16, delayMs: 160, durationMs: 420 }),
			...heroTags.map((tag, index) =>
				tagMotionItem(tag, { y: 12, delayMs: 200 + index * 45, durationMs: 360 })
			),
			tagMotionItem(heroCta, { y: 14, delayMs: 340, durationMs: 380 })
		].filter(Boolean);

		if (items.length) {
			entries.push({ section: hero, items, type: 'hero' });
		}
	}

	const inox = document.querySelector('#inox');
	if (inox) {
		const title = inox.querySelector('.panel-title');
		const subtitle = inox.querySelector('.panel-subtitle');
		const stats = Array.from(inox.querySelectorAll('.stat-card'));
		const inoxCard = inox.querySelector('.inox-card');
		const inoxImage = inox.querySelector('.inox-card-img');

		const items = [
			tagMotionItem(title, { y: 26, durationMs: 460 }),
			tagMotionItem(subtitle, { y: 18, delayMs: 60, durationMs: 420 }),
			...stats.map((card, index) =>
				tagMotionItem(card, { y: 18, delayMs: 110 + index * 55, durationMs: 380 })
			),
			tagMotionItem(inoxCard, { x: 24, y: 20, delayMs: 120, durationMs: 620 }),
			tagMotionItem(inoxImage, { y: 10, delayMs: 160, durationMs: 560 })
		].filter(Boolean);

		if (items.length) {
			entries.push({ section: inox, items, type: 'inox' });
		}
	}

	const services = document.querySelector('#company-services');
	if (services) {
		const cards = Array.from(services.querySelectorAll('.icon-box'));
		const items = cards
			.map((card, index) =>
				tagMotionItem(card, { y: 16, delayMs: index * 45, durationMs: 340 })
			)
			.filter(Boolean);

		if (items.length) {
			entries.push({ section: services, items, type: 'services' });
		}
	}

	return entries;
};

const createParallaxFallback = () => {
	if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

	const scenes = Array.from(document.querySelectorAll('.parallax-scene'));
	if (!scenes.length) return () => {};

	const sceneEntries = scenes.map((scene) => {
		const layers = Array.from(scene.querySelectorAll('.parallax-layer')).map((el) => ({ el }));
		const backgrounds = Array.from(scene.querySelectorAll('.parallax-bg')).map((el) => ({ el }));
		return { scene, layers, backgrounds };
	});

	let rafId = 0;
	let active = true;

	const computeProgress = (rect, viewportHeight) => {
		const denom = Math.max(1, viewportHeight * 0.5 + rect.height * 0.5);
		const centerOffset = rect.top + rect.height * 0.5 - viewportHeight * 0.5;
		return clamp(centerOffset / denom, -1, 1);
	};

	const update = () => {
		rafId = 0;
		if (!active) return;
		const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
		if (viewportHeight <= 0) return;

		for (const entry of sceneEntries) {
			const sceneRect = entry.scene.getBoundingClientRect();
			const progress = computeProgress(sceneRect, viewportHeight);

			for (const { el } of entry.layers) {
				const styles = window.getComputedStyle(el);
				const distance = parseCssNumber(styles.getPropertyValue('--parallax-distance'), 0);
				const scale = parseCssNumber(styles.getPropertyValue('--parallax-scale'), 1);
				const offsetY = progress * distance;
				el.style.transform = `translate3d(0, ${offsetY}px, 0) scale(${scale})`;
			}

			for (const { el } of entry.backgrounds) {
				const styles = window.getComputedStyle(el);
				const distance = parseCssNumber(styles.getPropertyValue('--parallax-bg-distance'), 0);
				const offsetY = progress * distance;
				el.style.backgroundPosition = `50% calc(50% + ${offsetY}px)`;
			}
		}
	};

	const requestUpdate = () => {
		if (!active || rafId) return;
		rafId = window.requestAnimationFrame(update);
	};

	window.addEventListener('scroll', requestUpdate, { passive: true });
	window.addEventListener('resize', requestUpdate);
	window.addEventListener('orientationchange', requestUpdate);
	requestUpdate();

	return () => {
		active = false;
		if (rafId) window.cancelAnimationFrame(rafId);
		window.removeEventListener('scroll', requestUpdate);
		window.removeEventListener('resize', requestUpdate);
		window.removeEventListener('orientationchange', requestUpdate);
		for (const entry of sceneEntries) {
			for (const { el } of entry.layers) {
				el.style.removeProperty('transform');
			}
			for (const { el } of entry.backgrounds) {
				el.style.removeProperty('background-position');
			}
		}
	};
};

const readCounterConfig = (el) => {
	if (!(el instanceof HTMLElement)) return null;
	const rawText = String(el.textContent || '').trim();
	const explicitTarget = String(el.dataset?.counterTarget || '').trim();
	const targetSource = explicitTarget || rawText;
	const numericToken = targetSource.match(/\d+/)?.[0] || rawText.match(/\d+/)?.[0] || '0';
	const target = Number.parseInt(numericToken, 10);
	if (!Number.isFinite(target)) return null;
	el.dataset.counterTarget = numericToken;
	const minDigits = numericToken.length;
	const preserveLeadingZeros = numericToken.startsWith('0');
	return {
		el,
		target,
		minDigits,
		preserveLeadingZeros,
		suffix: String(el.dataset?.suffix || '')
	};
};

const setCounterText = (config, value) => {
	const rounded = Math.max(0, Math.round(Number(value) || 0));
	const numberText = config.preserveLeadingZeros
		? String(rounded).padStart(config.minDigits, '0')
		: String(rounded);
	config.el.textContent = `${numberText}${config.suffix}`;
};

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const createCounterAnimator = (configs) => {
	let rafId = 0;
	let running = false;
	let startedAt = 0;
	const durationMs = 1000;

	const stop = () => {
		if (rafId) cancelAnimationFrame(rafId);
		rafId = 0;
		running = false;
	};

	const reset = () => {
		stop();
		configs.forEach((config) => setCounterText(config, 0));
	};

	const runFrame = (now) => {
		if (!running) return;
		if (!startedAt) startedAt = now;
		const progress = Math.min(1, (now - startedAt) / durationMs);
		const eased = easeOutCubic(progress);
		configs.forEach((config) => setCounterText(config, config.target * eased));
		if (progress >= 1) {
			configs.forEach((config) => setCounterText(config, config.target));
			stop();
			return;
		}
		rafId = requestAnimationFrame(runFrame);
	};

	const play = () => {
		stop();
		startedAt = 0;
		running = true;
		rafId = requestAnimationFrame(runFrame);
	};

	return { play, reset, stop };
};

const setEntryVisible = (entry, visible) => {
	entry.items.forEach((item) => item.classList.toggle(VISIBLE_CLASS, visible));
};

export const initHomeSectionsMotion = async () => {
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		return () => {};
	}

	const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
	const isCompactViewport = window.matchMedia?.('(max-width: 992px)')?.matches ?? false;
	const useLegacyTransforms = !supportsTranslateLonghand();
	if (useLegacyTransforms) {
		document.documentElement.classList.add(LEGACY_TRANSFORM_CLASS);
	} else {
		document.documentElement.classList.remove(LEGACY_TRANSFORM_CLASS);
	}
	const registry = buildMotionRegistry();
	if (!registry.length) return () => {};
	const parallaxCleanup =
		!prefersReducedMotion && !isCompactViewport && !supportsScrollDrivenAnimations()
			? createParallaxFallback()
			: () => {};

	const counterConfigs = ['#stat-layers', '#stat-grade', '#stat-warranty']
		.map((selector) => document.querySelector(selector))
		.map(readCounterConfig)
		.filter(Boolean);
	const counterAnimator = counterConfigs.length ? createCounterAnimator(counterConfigs) : null;
	const inoxEntry = registry.find((entry) => entry.type === 'inox');

	if (prefersReducedMotion || typeof IntersectionObserver === 'undefined') {
		registry.forEach((entry) => setEntryVisible(entry, true));
		counterConfigs.forEach((config) => setCounterText(config, config.target));
		return () => {
			counterAnimator?.stop();
			parallaxCleanup();
		};
	}

	if (isCompactViewport) {
		registry.forEach((entry) => setEntryVisible(entry, true));
		document.documentElement.classList.add(ROOT_CLASS);

		if (!counterAnimator || !inoxEntry) {
			counterConfigs.forEach((config) => setCounterText(config, config.target));
			return () => {
				counterAnimator?.stop();
				parallaxCleanup();
			};
		}

		counterAnimator.reset();
		const mobileCounterObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting || entry.intersectionRatio <= 0.18) continue;
					counterAnimator.reset();
					counterAnimator.play();
					mobileCounterObserver.disconnect();
					break;
				}
			},
			{
				threshold: [0, 0.2, 0.4],
				rootMargin: '0px 0px -12% 0px'
			}
		);

		mobileCounterObserver.observe(inoxEntry.section);

		return () => {
			mobileCounterObserver.disconnect();
			counterAnimator.stop();
			parallaxCleanup();
		};
	}

	const visibleMap = new WeakMap();
	registry.forEach((entry) => {
		const visible = inViewport(entry.section);
		visibleMap.set(entry.section, visible);
		setEntryVisible(entry, visible);
	});

	if (counterAnimator) {
		if (inoxEntry && visibleMap.get(inoxEntry.section)) {
			counterAnimator.reset();
			counterAnimator.play();
		} else {
			counterAnimator.reset();
		}
	}

	document.documentElement.classList.add(ROOT_CLASS);

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				const target = entry.target;
				const motionEntry = registry.find((item) => item.section === target);
				if (!motionEntry) continue;

				const isVisible = entry.isIntersecting && entry.intersectionRatio > 0.14;
				const wasVisible = Boolean(visibleMap.get(target));
				if (isVisible === wasVisible) continue;

				visibleMap.set(target, isVisible);
				setEntryVisible(motionEntry, isVisible);

				if (counterAnimator && motionEntry.type === 'inox') {
					if (isVisible) {
						counterAnimator.reset();
						counterAnimator.play();
					} else {
						counterAnimator.reset();
					}
				}
			}
		},
		{
			threshold: [0, 0.15, 0.35],
			rootMargin: '0px 0px -8% 0px'
		}
	);

	registry.forEach((entry) => observer.observe(entry.section));

	return () => {
		observer.disconnect();
		counterAnimator?.stop();
		parallaxCleanup();
	};
};
