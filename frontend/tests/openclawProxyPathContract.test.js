import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
	matchesOpenClawProxyPath,
	normalizeOpenClawProxyPath
} from '../src/lib/server/openclawProxyPath.js';

test('OpenClaw proxy paths reject traversal, encoded separators after decoding, and unsafe segments', () => {
	for (const unsafe of [
		'../runtime-controls/auto_publish',
		'plans//secret',
		'plans/ bad',
		'plans/%2fsecret',
		'plans/.'
	]) {
		assert.equal(normalizeOpenClawProxyPath(unsafe), null);
	}
	assert.equal(normalizeOpenClawProxyPath('plans/safe-id_1'), 'plans/safe-id_1');
	assert.equal(
		matchesOpenClawProxyPath({
			method: 'GET',
			path: 'plans/safe-id_1',
			contracts: { GET: [/^plans\/[A-Za-z0-9_-]{1,128}$/] }
		}),
		true
	);
});

test('every formerly open-ended OpenClaw BFF route enforces an explicit path contract', () => {
	const root = process.cwd();
	for (const relativePath of [
		'src/routes/admin/api/openclaw/product-placement/[...segments]/+server.js',
		'src/routes/admin/api/openclaw/product-seeding/[...segments]/+server.js',
		'src/routes/admin/api/openclaw/product-catalog/[...segments]/+server.js',
		'src/routes/admin/api/openclaw/editorial-styles/[...segments]/+server.js',
		'src/routes/admin/api/openclaw/google-intelligence/[...segments]/+server.js'
	]) {
		const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
		assert.match(source, /normalizeOpenClawProxyPath/);
		assert.match(source, /matchesOpenClawProxyPath/);
		assert.match(source, /openClawProxyClientError/);
	}
});
