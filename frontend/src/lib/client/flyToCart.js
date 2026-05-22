export const flyToCart = (imgEl, options = {}) => {
	if (typeof window === 'undefined') return false;
	if (!imgEl) return false;
	const dock = window.__inoxpranCartDock;
	if (!dock?.getRect) return false;

	const { xOffset = 0, yOffset = 0, scale = 0.2 } = options;
	const from = imgEl.getBoundingClientRect();
	const to = dock.getRect();

	const clone = imgEl.cloneNode(true);
	clone.classList.add('fly-clone');
	clone.style.left = `${from.left}px`;
	clone.style.top = `${from.top}px`;
	clone.style.width = `${from.width}px`;
	clone.style.height = `${from.height}px`;

	document.body.appendChild(clone);

	requestAnimationFrame(() => {
		const translateX = to.left - from.left + xOffset;
		const translateY = to.top - from.top + yOffset;
		clone.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
		clone.style.opacity = '0.2';
	});

	clone.addEventListener(
		'transitionend',
		() => {
			clone.remove();
			dock.bump?.();
		},
		{ once: true }
	);

	return true;
};
