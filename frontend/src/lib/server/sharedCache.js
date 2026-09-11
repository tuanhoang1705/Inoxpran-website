import fs from 'node:fs';
import { createClient } from 'redis';
import { readServerEnvValue } from '$lib/server/api.js';

// A cache that outlives the process and is shared by every process.
//
// The homepage used to depend on a module-level variable: whatever the last good
// feed was, in this container's memory. That works until the container restarts,
// and it does not work at all once a second replica exists, because each replica
// warms its own copy and a visitor routed to a cold one sees an error page. Redis
// is already deployed here, so the snapshot lives there and the process memory in
// front of it is only a latency optimisation.
//
// Every operation here is best-effort and bounded. Redis being unreachable must
// degrade the site to "serves from process memory", never to "fails to render".

const OPERATION_TIMEOUT_MS = numberFromEnv('REDIS_OPERATION_TIMEOUT_MS', 1_000, {
	min: 100,
	max: 15_000
});
const CONNECT_TIMEOUT_MS = numberFromEnv('REDIS_CONNECT_TIMEOUT_MS', 5_000, {
	min: 500,
	max: 60_000
});
const KEY_PREFIX = readServerEnvValue('REDIS_KEY_PREFIX') || 'inoxpran:fe';
const MAX_RECONNECT_DELAY_MS = 10_000;
const ERROR_LOG_WINDOW_MS = 60_000;

function numberFromEnv(name, fallback, { min, max }) {
	const parsed = Number(readServerEnvValue(name));
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

const parseBoolean = (value, fallback = false) => {
	const normalized = String(value ?? '')
		.trim()
		.toLowerCase();
	if (!normalized) return fallback;
	return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const readCaCertificate = () => {
	const caFile = readServerEnvValue('REDIS_TLS_CA_FILE');
	if (!caFile) return undefined;
	try {
		return fs.readFileSync(caFile);
	} catch {
		// Treated as "no TLS material" rather than a hard failure: the connection
		// attempt will fail and the caller falls back to process memory.
		return undefined;
	}
};

const buildClientOptions = () => {
	const url = readServerEnvValue('REDIS_URL');
	const host = readServerEnvValue('REDIS_HOST');
	if (!url && !host) return null;

	const ca = readCaCertificate();
	const servername = readServerEnvValue('REDIS_TLS_SERVERNAME') || undefined;
	const password = readServerEnvValue('REDIS_PASSWORD') || undefined;
	const username = readServerEnvValue('REDIS_USERNAME') || (password ? 'default' : undefined);
	const reconnectStrategy = (retries) =>
		Math.min(MAX_RECONNECT_DELAY_MS, 200 * 2 ** Math.min(retries, 6));

	if (url) {
		if (!/^rediss?:\/\//i.test(url)) return null;
		return {
			url,
			// Without this, commands issued while the socket is down queue up and
			// resolve minutes later, long after the request that made them is gone.
			disableOfflineQueue: true,
			socket: {
				connectTimeout: CONNECT_TIMEOUT_MS,
				reconnectStrategy,
				...(ca ? { ca } : {}),
				...(servername ? { servername } : {})
			}
		};
	}

	const port = numberFromEnv('REDIS_PORT', 6379, { min: 1, max: 65535 });
	const tlsEnabled = parseBoolean(readServerEnvValue('REDIS_TLS'), false);
	return {
		disableOfflineQueue: true,
		socket: {
			host,
			port,
			connectTimeout: CONNECT_TIMEOUT_MS,
			reconnectStrategy,
			...(tlsEnabled ? { tls: true, servername: servername || host, ...(ca ? { ca } : {}) } : {})
		},
		username,
		password
	};
};

const clientOptions = buildClientOptions();

let client = null;
let connecting = null;
let lastErrorLoggedAt = 0;

const reportError = (scope, error) => {
	const now = Date.now();
	if (now - lastErrorLoggedAt < ERROR_LOG_WINDOW_MS) return;
	lastErrorLoggedAt = now;
	console.warn(`sharedCache: ${scope} unavailable (${error?.message || error})`);
};

const withDeadline = async (promise, timeoutMs) => {
	let timeoutId = null;
	const timeoutToken = Symbol('shared-cache-timeout');
	try {
		const result = await Promise.race([
			promise,
			new Promise((resolve) => {
				timeoutId = setTimeout(() => resolve(timeoutToken), timeoutMs);
				timeoutId.unref?.();
			})
		]);
		if (result === timeoutToken) throw new Error('operation timed out');
		return result;
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
};

const getClient = async () => {
	if (!clientOptions) return null;
	if (client?.isReady) return client;
	if (connecting) return await connecting;

	connecting = (async () => {
		try {
			if (!client) {
				client = createClient(clientOptions);
				// node-redis turns an unhandled 'error' into an uncaught exception,
				// which would take the whole SSR process down with it.
				client.on('error', (error) => reportError('connection', error));
			}
			if (!client.isOpen) await withDeadline(client.connect(), CONNECT_TIMEOUT_MS);
			return client.isReady ? client : null;
		} catch (error) {
			reportError('connect', error);
			return null;
		} finally {
			connecting = null;
		}
	})();

	return await connecting;
};

const namespacedKey = (key) => `${KEY_PREFIX}:${key}`;

export const isSharedCacheConfigured = () => Boolean(clientOptions);

/**
 * Reads a JSON value. Returns null for "not cached", "cache unreachable" and
 * "cached value is not readable" alike - every one of them means the caller has to
 * fall back, and none of them is worth failing a page render over.
 */
export const readSharedValue = async (key, { timeoutMs = OPERATION_TIMEOUT_MS } = {}) => {
	const connection = await getClient();
	if (!connection) return null;
	try {
		const raw = await withDeadline(connection.get(namespacedKey(key)), timeoutMs);
		if (typeof raw !== 'string' || !raw) return null;
		return JSON.parse(raw);
	} catch (error) {
		reportError('read', error);
		return null;
	}
};

/**
 * Writes a JSON value with a TTL. Resolves to false when the value did not land,
 * so callers can tell "shared" from "this process only" without having to care why.
 */
export const writeSharedValue = async (
	key,
	value,
	{ ttlSeconds = 0, timeoutMs = OPERATION_TIMEOUT_MS } = {}
) => {
	const connection = await getClient();
	if (!connection) return false;
	try {
		const payload = JSON.stringify(value);
		const options = ttlSeconds > 0 ? { EX: Math.trunc(ttlSeconds) } : undefined;
		await withDeadline(connection.set(namespacedKey(key), payload, options), timeoutMs);
		return true;
	} catch (error) {
		reportError('write', error);
		return false;
	}
};

export const closeSharedCache = async () => {
	const current = client;
	client = null;
	connecting = null;
	if (!current?.isOpen) return;
	try {
		await withDeadline(current.quit(), 2_000);
	} catch {
		current.destroy?.();
	}
};
