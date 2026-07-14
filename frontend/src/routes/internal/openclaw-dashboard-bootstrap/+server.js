import { fetch as undiciFetch } from 'undici';

// Use the unique Compose container name. Another long-running OpenClaw stack on
// the VPS also owns the generic `openclaw` network alias, which makes Docker DNS
// round-robin requests between two unrelated gateways.
const OPENCLAW_ORIGIN = 'http://app_openclaw:18789';
const OPENCLAW_CONTROL_UI_PREFIX = '/openclaw-dashboard/';
const INTERNAL_MARKER = 'nginx-openclaw-bootstrap-v1';
const MAX_UPSTREAM_BYTES = 10 * 1024 * 1024;
const FORWARDED_HEADERS = [
	'content-type',
	'content-security-policy',
	'permissions-policy',
	'referrer-policy',
	'x-content-type-options'
];
const MAX_UPSTREAM_ATTEMPTS = 5;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const GET = async ({ request }) => {
	if (request.headers.get('x-openclaw-bootstrap') !== INTERNAL_MARKER) {
		return new Response('Not found', { status: 404 });
	}

	const gatewayToken = String(process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();
	if (!gatewayToken) {
		return new Response('OpenClaw dashboard is not configured', { status: 503 });
	}
	const requestedTarget = String(
		request.headers.get('x-openclaw-path') || OPENCLAW_CONTROL_UI_PREFIX
	);
	if (requestedTarget.length > 4096 || /[#\\]/.test(requestedTarget)) {
		return new Response('Not found', { status: 404 });
	}
	let upstreamUrl;
	try {
		upstreamUrl = new URL(requestedTarget, OPENCLAW_ORIGIN);
	} catch {
		return new Response('Not found', { status: 404 });
	}
	if (
		upstreamUrl.origin !== OPENCLAW_ORIGIN ||
		!upstreamUrl.pathname.startsWith(OPENCLAW_CONTROL_UI_PREFIX)
	) {
		return new Response('Not found', { status: 404 });
	}

	let lastUpstreamStatus = 0;
	for (let attempt = 1; attempt <= MAX_UPSTREAM_ATTEMPTS; attempt += 1) {
		try {
			const upstream = await undiciFetch(upstreamUrl, {
				headers: {
					accept: '*/*',
					authorization: `Bearer ${gatewayToken}`
				},
				redirect: 'error',
				signal: AbortSignal.timeout(10_000)
			});
			if (upstream.ok) {
				const body = Buffer.from(await upstream.arrayBuffer());
				if (body.length > MAX_UPSTREAM_BYTES) {
					throw new Error('OpenClaw dashboard response is too large');
				}
				const headers = new Headers({ 'cache-control': 'no-store' });
				for (const name of FORWARDED_HEADERS) {
					const value = upstream.headers.get(name);
					if (value) headers.set(name, value);
				}
				return new Response(body, { status: 200, headers });
			}

			lastUpstreamStatus = upstream.status;
			await upstream.body?.cancel();
		} catch {
			// A cold OpenClaw dashboard can briefly reset concurrent asset requests.
		}

		if (attempt < MAX_UPSTREAM_ATTEMPTS) await wait(attempt * 150);
	}

	console.warn(
		`[openclaw-dashboard-bootstrap] upstream unavailable after ${MAX_UPSTREAM_ATTEMPTS} attempts`,
		{ path: upstreamUrl.pathname, status: lastUpstreamStatus || 'network_error' }
	);
	return new Response('OpenClaw dashboard is unavailable', { status: 502 });
};
