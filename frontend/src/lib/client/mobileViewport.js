const VIEWPORT_META_SELECTOR = 'meta[name="viewport"]';
const RESTORE_DELAY_MS = 280;

let restoreTimerId = null;

const isMobileViewport = () => {
	if (typeof window === 'undefined') return false;
	try {
		return (
			window.matchMedia('(pointer: coarse)').matches ||
			window.matchMedia('(max-width: 1024px)').matches
		);
	} catch {
		return window.innerWidth <= 1024;
	}
};

const normalizeViewportContent = (content) => {
	const tokens = String(content || '')
		.split(',')
		.map((token) => token.trim())
		.filter(Boolean)
		.filter((token) => !/^(initial-scale|maximum-scale|minimum-scale)\s*=/i.test(token));

	if (!tokens.some((token) => /^width\s*=/i.test(token))) {
		tokens.unshift('width=device-width');
	}

	tokens.push('initial-scale=1');
	tokens.push('maximum-scale=1');
	return tokens.join(', ');
};

export const forceMobileZoomOut100 = () => {
	if (typeof document === 'undefined') return;
	if (!isMobileViewport()) return;

	const viewportMeta = document.querySelector(VIEWPORT_META_SELECTOR);
	if (!(viewportMeta instanceof HTMLMetaElement)) return;

	const currentContent =
		viewportMeta.getAttribute('content') || 'width=device-width, initial-scale=1';
	if (!viewportMeta.dataset.inoxpranViewportOriginal) {
		viewportMeta.dataset.inoxpranViewportOriginal = currentContent;
	}

	const baseContent = viewportMeta.dataset.inoxpranViewportOriginal || currentContent;
	viewportMeta.setAttribute('content', normalizeViewportContent(baseContent));

	if (restoreTimerId !== null) {
		window.clearTimeout(restoreTimerId);
	}

	restoreTimerId = window.setTimeout(() => {
		const restoreContent = viewportMeta.dataset.inoxpranViewportOriginal || baseContent;
		viewportMeta.setAttribute('content', restoreContent);
		delete viewportMeta.dataset.inoxpranViewportOriginal;
		restoreTimerId = null;
	}, RESTORE_DELAY_MS);
};
