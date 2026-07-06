// Site-wide momentum smooth scrolling (Lenis), styled after oeg.vn's homepage feel.
// A single instance is exposed on window.__lenis so scroll-driven animations
// (e.g. GSAP ScrollTrigger in the homepage hero) can stay perfectly in sync.
// Disabled for reduced-motion users and on touch/coarse pointers (native feel there).

let lenisInstance = null;

export const getLenis = () => lenisInstance;

export const initSmoothScroll = async () => {
	if (typeof window === 'undefined') return () => {};
	if (lenisInstance) return () => {};

	const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
	const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
	if (reduceMotion || coarsePointer) return () => {};

	let Lenis;
	try {
		({ default: Lenis } = await import('lenis'));
	} catch {
		return () => {};
	}

	const lenis = new Lenis({
		lerp: 0.09, // smoothing factor — lower = smoother/heavier glide
		wheelMultiplier: 1,
		smoothWheel: true,
		syncTouch: false,
		autoRaf: false
	});

	lenisInstance = lenis;
	window.__lenis = lenis;

	let rafId = window.requestAnimationFrame(function raf(time) {
		lenis.raf(time);
		rafId = window.requestAnimationFrame(raf);
	});

	// Let late-initialising consumers (ScrollTrigger) hook in even if they mounted first.
	window.dispatchEvent(new CustomEvent('inoxpran:lenis-ready', { detail: { lenis } }));

	return () => {
		if (rafId) window.cancelAnimationFrame(rafId);
		rafId = 0;
		try {
			lenis.destroy();
		} catch {
			/* no-op */
		}
		if (window.__lenis === lenis) delete window.__lenis;
		lenisInstance = null;
	};
};
