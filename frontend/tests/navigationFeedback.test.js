import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(path.resolve(here, '..', relative), 'utf8');

const highestZIndex = (source) => {
	const values = [...source.matchAll(/z-index:\s*(\d+)/g)].map((match) => Number(match[1]));
	return values.length ? Math.max(...values) : 0;
};

test('the route loader is painted above the header that contains the mobile menu', () => {
	// The mobile menu lives inside the header. When the loader sat below it, a tap
	// produced no visible change for the whole navigation and people tapped again.
	const loader = read('src/lib/components/RouteLoader.svelte');
	const header = read('src/lib/components/Header.svelte');

	assert.ok(
		highestZIndex(loader) > highestZIndex(header),
		`loader z-index ${highestZIndex(loader)} must exceed header z-index ${highestZIndex(header)}`
	);
});

test('the header dismisses its mobile menu when navigation starts, not when it ends', () => {
	const header = read('src/lib/components/Header.svelte');

	assert.match(header, /beforeNavigate\(/);
	const beforeIndex = header.indexOf('beforeNavigate((navigation)');
	assert.ok(beforeIndex > 0, 'beforeNavigate must receive the navigation to inspect its target');

	const body = header.slice(beforeIndex, beforeIndex + 400);
	assert.match(body, /resetMobileTransientUi\(\)/);
});

test('the loader still waits briefly so quick navigations do not flash it', () => {
	const loader = read('src/lib/components/RouteLoader.svelte');
	const delay = Number(/setTimeout\(\s*\(\)\s*=>\s*\{[^}]*\},\s*(\d+)\)/s.exec(loader)?.[1]);

	assert.ok(Number.isFinite(delay), 'the loader must debounce before showing');
	assert.ok(
		delay > 0 && delay <= 300,
		`debounce ${delay}ms should stay short enough to feel instant`
	);
});

test('the server warms the home feed so the first visitor after a deploy is not the guinea pig', () => {
	const hooks = read('src/hooks.server.js');

	// Warming once at boot only covered the deploy. The loop keeps covering every
	// later moment the cache would otherwise go cold under a visitor.
	assert.match(hooks, /startHomeFeedWarmLoop/);
	// Running it during the build would fire a request at a backend that is not
	// there and slow every build down for nothing.
	assert.match(hooks, /if\s*\(!building\)/);
});

test('a full page navigation announces itself instead of leaving the tap unanswered', () => {
	// beforeNavigate's "leave" only fires once the browser starts unloading, and a
	// browser does not unload until the server has answered - seconds after the tap on
	// a slow page. So nothing in the storefront may hand a URL straight to the browser.
	const storefront = [
		'src/lib/components/Header.svelte',
		'src/lib/components/ShopCatalogView.svelte',
		'src/routes/+page.svelte',
		'src/routes/product/[slug]/+page.svelte'
	];
	for (const file of storefront) {
		const source = read(file);
		assert.doesNotMatch(
			source,
			/window\.location\.assign\(/,
			`${file} must navigate through navigateWithFeedback so the loader appears`
		);
	}

	const header = read('src/lib/components/Header.svelte');
	assert.match(header, /navigateWithFeedback/);
});

test('the loader reacts to a full page navigation without the client-side debounce', () => {
	const loader = read('src/lib/components/RouteLoader.svelte');

	assert.match(loader, /fullPageNavigationPending/);
	// The debounce exists to stop a fast client navigation flashing the overlay. A full
	// page navigation is the opposite case: the wait is exactly what needs covering.
	const derived = /const visible = \$derived\(([^)]*)\)/.exec(loader)?.[1] || '';
	assert.match(derived, /\$fullPageNavigationPending/);
	assert.match(loader, /\{#if visible\}/);
});

test('a full page navigation that never happens releases the overlay', () => {
	const store = read('src/lib/stores/navigationProgress.js');

	// A dismissed beforeunload prompt would otherwise leave a spinner over a page that
	// is working perfectly well.
	assert.match(store, /NAVIGATION_ABANDONED_MS/);
	assert.match(store, /setTimeout\(endFullPageNavigation/);
	// The flag has to be set before control passes to the browser.
	const order = /beginFullPageNavigation\(\);\s*\n\s*window\.location\.assign/.test(store);
	assert.ok(order, 'the loader must be shown before location.assign hands over the page');
});

test('keydown handling tolerates events that carry no key', () => {
	// IME composition, autofill and extension-synthesised events arrive without one,
	// and reading startsWith off undefined threw on every such keystroke.
	const layout = read('src/routes/+layout.svelte');
	const handler = /const revealFromKey = \(event\) => \{[\s\S]*?\n\t\t\};/.exec(layout)?.[0] || '';

	assert.ok(handler, 'revealFromKey must exist');
	assert.doesNotMatch(handler, /event\.key\.startsWith/);
	assert.match(handler, /typeof event\?\.key === 'string'/);
});
