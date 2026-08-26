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

	assert.match(hooks, /primeHomeFeed/);
	// Running it during the build would fire a request at a backend that is not
	// there and slow every build down for nothing.
	assert.match(hooks, /if\s*\(!building\)/);
});
