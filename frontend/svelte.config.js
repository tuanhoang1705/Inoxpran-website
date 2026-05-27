import adapter from '@sveltejs/adapter-node';

const csrfTrustedOrigins = Array.from(
	new Set([
		'http://localhost',
		'http://localhost:4173',
		'http://localhost:5173',
		'http://127.0.0.1',
		'http://127.0.0.1:4173',
		'http://127.0.0.1:5173',
		'https://admin.inoxpran.com',
		'https://inoxpran.com',
		'https://www.inoxpran.com'
	])
);

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		csrf: {
			trustedOrigins: csrfTrustedOrigins
		}
	}
};

export default config;
