import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Figure node: preserves `<figure><img><figcaption>` structures (used by the
 * Agentic image pipeline) with editable inline captions and full image metadata.
 * The image is stored as node attributes; the figcaption is the node's inline
 * content, so caption text/formatting round-trips through the editor.
 */
export const Figure = Node.create({
	name: 'figure',
	group: 'block',
	content: 'inline*',
	draggable: true,
	isolating: true,

	addAttributes() {
		return {
			src: { default: null },
			alt: { default: null },
			title: { default: null },
			width: { default: null },
			height: { default: null },
			imageId: { default: null },
			sourceType: { default: null },
			reviewStatus: { default: null }
		};
	},

	parseHTML() {
		return [
			{
				tag: 'figure',
				contentElement: 'figcaption',
				getAttrs: (element) => {
					const img = element.querySelector('img');
					if (!img) return false;
					return {
						src: img.getAttribute('src'),
						alt: img.getAttribute('alt'),
						title: img.getAttribute('title'),
						width: img.getAttribute('width'),
						height: img.getAttribute('height'),
						imageId: element.getAttribute('data-image-id') || img.getAttribute('data-image-id'),
						sourceType:
							element.getAttribute('data-source-type') || img.getAttribute('data-source-type'),
						reviewStatus:
							element.getAttribute('data-review-status') || img.getAttribute('data-review-status')
					};
				}
			}
		];
	},

	renderHTML({ node }) {
		const { src, alt, title, width, height, imageId, sourceType, reviewStatus } = node.attrs;

		const figureAttrs = {};
		if (imageId) figureAttrs['data-image-id'] = imageId;
		if (sourceType) figureAttrs['data-source-type'] = sourceType;
		if (reviewStatus) figureAttrs['data-review-status'] = reviewStatus;

		const imgAttrs = { src, loading: 'lazy', decoding: 'async' };
		if (alt != null) imgAttrs.alt = alt;
		if (title != null) imgAttrs.title = title;
		if (width != null) imgAttrs.width = width;
		if (height != null) imgAttrs.height = height;
		if (imageId) imgAttrs['data-image-id'] = imageId;
		if (sourceType) imgAttrs['data-source-type'] = sourceType;
		if (reviewStatus) imgAttrs['data-review-status'] = reviewStatus;

		return ['figure', mergeAttributes(figureAttrs), ['img', imgAttrs], ['figcaption', 0]];
	},

	addCommands() {
		return {
			setFigure:
				(attrs = {}) =>
				({ chain }) =>
					chain()
						.insertContent({
							type: this.name,
							attrs,
							content: attrs.caption ? [{ type: 'text', text: String(attrs.caption) }] : []
						})
						.run()
		};
	}
});

export default Figure;
