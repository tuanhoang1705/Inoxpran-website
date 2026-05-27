const PUSH_PUBLIC_KEY_PATH = '/admin/api/push/public-key';
const PUSH_SUBSCRIPTIONS_PATH = '/admin/api/push/subscriptions';
const ADMIN_SUBDOMAIN = 'admin.inoxpran.com';

const normalizeText = (value = '') => (typeof value === 'string' ? value.trim() : '');
const resolveAdminPath = (path) => {
	if (typeof window === 'undefined') return path;
	if (window.location.hostname !== ADMIN_SUBDOMAIN) return path;
	return path.replace(/^\/admin(?=\/|$)/, '') || '/';
};

const isSecureLocalhost = () => {
	if (typeof window === 'undefined') return false;
	return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
};

export const isAdminWebPushSupported = () =>
	typeof window !== 'undefined' &&
	'serviceWorker' in navigator &&
	'PushManager' in window &&
	typeof Notification !== 'undefined' &&
	(window.isSecureContext || isSecureLocalhost());

export const fetchAdminWebPushConfig = async () => {
	if (!isAdminWebPushSupported()) {
		return { enabled: false, publicKey: null, supported: false };
	}

	const response = await fetch(resolveAdminPath(PUSH_PUBLIC_KEY_PATH), {
		method: 'GET',
		credentials: 'same-origin',
		headers: { accept: 'application/json' }
	}).catch(() => null);
	if (!response) {
		throw new Error('push_config_unavailable');
	}
	const payload = await response.json().catch(() => null);
	if (!response.ok || payload?.ok === false) {
		throw new Error(payload?.error || 'push_config_failed');
	}

	const metadata =
		payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
			? payload.metadata
			: payload;
	return {
		enabled: Boolean(metadata?.enabled),
		publicKey: normalizeText(metadata?.publicKey) || null,
		supported: true
	};
};

const urlBase64ToUint8Array = (base64String) => {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = window.atob(base64);
	return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
};

const detectBrowserName = () => {
	const userAgent = normalizeText(navigator.userAgent);
	if (/edg\//i.test(userAgent)) return 'Edge';
	if (/chrome\//i.test(userAgent) && !/edg\//i.test(userAgent)) return 'Chrome';
	if (/firefox\//i.test(userAgent)) return 'Firefox';
	if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) return 'Safari';
	return 'Browser';
};

const buildDeviceLabel = () => {
	const platform =
		normalizeText(navigator.userAgentData?.platform) || normalizeText(navigator.platform) || '';
	const mobile =
		typeof navigator.userAgentData?.mobile === 'boolean'
			? navigator.userAgentData.mobile
			: /iphone|ipad|android|mobile/i.test(navigator.userAgent);
	return [mobile ? 'Mobile' : 'Desktop', platform, detectBrowserName()].filter(Boolean).join(' - ');
};

const getAdminServiceWorkerRegistration = async (serviceWorkerUrl, serviceWorkerScope) => {
	const registration = await navigator.serviceWorker.register(serviceWorkerUrl, {
		scope: serviceWorkerScope,
		updateViaCache: 'none'
	});
	await navigator.serviceWorker.ready;
	return registration;
};

export const ensureAdminWebPushSubscription = async ({
	serviceWorkerUrl,
	serviceWorkerScope,
	publicKey
}) => {
	if (!isAdminWebPushSupported()) {
		return { supported: false, subscribed: false };
	}
	if (!publicKey) {
		throw new Error('push_public_key_missing');
	}

	const registration = await getAdminServiceWorkerRegistration(
		serviceWorkerUrl,
		serviceWorkerScope
	);
	let subscription = await registration.pushManager.getSubscription();
	let created = false;
	if (!subscription) {
		subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(publicKey)
		});
		created = true;
	}

	const response = await fetch(resolveAdminPath(PUSH_SUBSCRIPTIONS_PATH), {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify({
			subscription: subscription.toJSON(),
			deviceLabel: buildDeviceLabel()
		})
	}).catch(() => null);
	if (!response) {
		throw new Error('push_subscription_unavailable');
	}
	const payload = await response.json().catch(() => null);
	if (!response.ok || payload?.ok === false) {
		throw new Error(payload?.error || 'push_subscription_failed');
	}

	return {
		supported: true,
		subscribed: true,
		created,
		endpoint: normalizeText(subscription.endpoint),
		payload
	};
};

export const disableAdminWebPushSubscription = async ({ serviceWorkerUrl, serviceWorkerScope }) => {
	if (!isAdminWebPushSupported()) {
		return { supported: false, removed: false };
	}

	const scopeUrl = new URL(serviceWorkerScope, window.location.origin).href;
	const registration =
		(await navigator.serviceWorker.getRegistration(scopeUrl)) ||
		(await navigator.serviceWorker.getRegistration(serviceWorkerUrl)) ||
		null;
	if (!registration) {
		return { supported: true, removed: false };
	}

	const subscription = await registration.pushManager.getSubscription();
	if (!subscription) {
		return { supported: true, removed: false };
	}

	const endpoint = normalizeText(subscription.endpoint);
	await fetch(resolveAdminPath(PUSH_SUBSCRIPTIONS_PATH), {
		method: 'DELETE',
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify({ endpoint })
	}).catch(() => null);

	await subscription.unsubscribe().catch(() => false);
	return {
		supported: true,
		removed: true,
		endpoint
	};
};
