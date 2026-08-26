import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
	blogImageErrorText,
	normalizeBlogImageError,
	safeBlogImageErrorCode,
	safeBlogImageRequestId
} from '../src/lib/blogImageError.js';

test('normalizes only allowlisted image error metadata', () => {
	assert.deepEqual(
		normalizeBlogImageError(
			{ errorCode: 'AI_IMAGE_CREDIT_EXHAUSTED', requestId: 'req_credit_123' },
			new Headers({ 'x-request-id': 'ignored-header-id' })
		),
		{ errorCode: 'AI_IMAGE_CREDIT_EXHAUSTED', requestId: 'req_credit_123' }
	);
	assert.equal(safeBlogImageErrorCode('provider_raw_secret'), '');
	assert.equal(safeBlogImageRequestId('bad request id with spaces'), '');
});

test('renders localized credit guidance with a safe request reference', () => {
	const translations = {
		'admin.blogImageReview.errors.creditExhausted': 'Tài khoản OpenAI API đã hết credit.',
		'admin.blogImageReview.errors.reference': 'Mã tra cứu'
	};
	const text = blogImageErrorText(
		{ errorCode: 'AI_IMAGE_CREDIT_EXHAUSTED', requestId: 'req_credit_123' },
		{ t: (key) => translations[key] || key }
	);
	assert.equal(text, 'Tài khoản OpenAI API đã hết credit. · Mã tra cứu: req_credit_123');
});

test('image BFF never forwards raw backend error messages', () => {
	const source = fs.readFileSync(
		new URL(
			'../src/routes/admin/api/blogs/[postId]/images/[operation]/+server.js',
			import.meta.url
		),
		'utf8'
	);
	assert.match(source, /normalizeBlogImageError/);
	assert.doesNotMatch(source, /payload\?\.message/);
	assert.doesNotMatch(source, /Internal Server Error/);
});
