import assert from 'node:assert/strict';
import test from 'node:test';

import { readAdminCookie, rememberAdminCookie } from '../src/lib/server/adminCookieState.js';

test('same-request admin cookie state wins over legacy-domain deletion state', () => {
	const cookies = {
		get: () => undefined
	};

	rememberAdminCookie(cookies, 'admin_client_id', 'admin-1');
	rememberAdminCookie(cookies, 'admin_access_token', 'new-access-token');

	assert.equal(readAdminCookie(cookies, 'admin_client_id'), 'admin-1');
	assert.equal(readAdminCookie(cookies, 'admin_access_token'), 'new-access-token');
});

test('cleared admin cookie state masks stale request cookies', () => {
	const cookies = {
		get: () => 'stale-cookie'
	};

	rememberAdminCookie(cookies, 'admin_access_token', undefined);
	assert.equal(readAdminCookie(cookies, 'admin_access_token'), undefined);
});

test('untouched admin cookies still read from the incoming request', () => {
	const cookies = {
		get: (name) => (name === 'admin_name' ? 'Admin' : undefined)
	};

	assert.equal(readAdminCookie(cookies, 'admin_name'), 'Admin');
	assert.equal(readAdminCookie(cookies, 'admin_email'), undefined);
});
