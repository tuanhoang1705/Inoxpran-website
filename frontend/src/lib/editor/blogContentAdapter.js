/**
 * Shared blog-content adapter (frontend side of the blog-content contract).
 *
 * Responsibilities:
 *  - normalize legacy / Agentic HTML before importing into the editor
 *  - assign a stable imageId to images that are missing one
 *  - keep image metadata intact
 *  - never rewrite content merely because it was opened (conservative edits only)
 *
 * The backend sanitizer remains the security source of truth; this adapter only
 * performs safe, additive normalization so old posts do not lose data.
 */

export const CONTENT_SCHEMA_VERSION = 'blog-content-v2';

const hashString = (value) => {
	let hash = 0;
	const source = String(value || '');
	for (let index = 0; index < source.length; index += 1) {
		hash = (Math.imul(31, hash) + source.charCodeAt(index)) | 0;
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
};

export const buildImageId = (src, index = 0) => `inline-${hashString(`${src}|${index}`)}`;

/**
 * Adds a stable imageId + lazy/async hints to images that are missing them and
 * mirrors the id onto the wrapping <figure>. Returns the input unchanged when
 * there is nothing to normalize or when running without a DOM (SSR).
 */
export const normalizeLegacyBlogContent = (html) => {
	if (typeof html !== 'string') return '';
	const trimmed = html.trim();
	if (!trimmed) return html || '';
	if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') return html;

	let changed = false;
	const doc = new window.DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
	const images = Array.from(doc.body.querySelectorAll('img'));

	images.forEach((img, index) => {
		const figure = img.closest('figure');
		if (!img.getAttribute('data-image-id')) {
			const inherited = figure?.getAttribute('data-image-id');
			const id = inherited || buildImageId(img.getAttribute('src') || '', index);
			img.setAttribute('data-image-id', id);
			changed = true;
			if (figure && !figure.getAttribute('data-image-id')) {
				figure.setAttribute('data-image-id', id);
			}
		}
		if (!img.getAttribute('loading')) {
			img.setAttribute('loading', 'lazy');
			changed = true;
		}
		if (!img.getAttribute('decoding')) {
			img.setAttribute('decoding', 'async');
			changed = true;
		}
	});

	return changed ? doc.body.innerHTML : html;
};

const wordsFromText = (text) =>
	String(text || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean);

/**
 * Editor statistics used by the SEO writing utilities.
 */
export const computeContentStats = ({ text = '', html = '', wordsPerMinute = 220 } = {}) => {
	const words = wordsFromText(text).length;
	const characters = String(text || '').replace(/\s/g, '').length;
	const readingTime = Math.max(1, Math.ceil(words / wordsPerMinute));

	const headings = { h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, total: 0 };
	let invalidHierarchy = false;

	if (typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined' && html) {
		const doc = new window.DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
		const nodes = Array.from(doc.body.querySelectorAll('h2, h3, h4, h5, h6'));
		let previousLevel = 2;
		nodes.forEach((node, index) => {
			const level = Number(node.tagName.slice(1));
			headings[`h${level}`] += 1;
			headings.total += 1;
			if (index > 0 && level - previousLevel > 1) invalidHierarchy = true;
			previousLevel = level;
		});
	}

	return {
		words,
		characters,
		readingTime,
		headings,
		hasH2: headings.h2 > 0,
		invalidHierarchy
	};
};

export default {
	CONTENT_SCHEMA_VERSION,
	buildImageId,
	normalizeLegacyBlogContent,
	computeContentStats
};
