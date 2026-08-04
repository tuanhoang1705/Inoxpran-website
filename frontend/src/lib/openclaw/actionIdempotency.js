const SAFE_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const STORAGE_PREFIX = 'inoxpran:openclaw-action:v1:';
export const OPENCLAW_ACTION_KEY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const slotFor = ({ action, profile }) =>
	`${String(action || '').trim()}\u0000${String(profile || '').trim()}`;

const storageKeyFor = (slot) => `${STORAGE_PREFIX}${encodeURIComponent(slot)}`;

const defaultStorage = () => {
	try {
		return globalThis.sessionStorage || null;
	} catch {
		return null;
	}
};

const defaultGenerateKey = () =>
	typeof globalThis.crypto?.randomUUID === 'function'
		? globalThis.crypto.randomUUID()
		: `openclaw-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

export const shouldRetainOpenClawActionKey = (status) => {
	const normalized = Number(status);
	return !Number.isInteger(normalized) || normalized === 0 || normalized >= 500;
};

export const createOpenClawActionIdempotencyManager = ({
	getStorage = defaultStorage,
	generateKey = defaultGenerateKey,
	now = () => Date.now(),
	maxAgeMs = OPENCLAW_ACTION_KEY_MAX_AGE_MS
} = {}) => {
	const memory = new Map();
	const ttl = Math.max(1, Number(maxAgeMs) || OPENCLAW_ACTION_KEY_MAX_AGE_MS);

	const validRecord = (value) => {
		if (!value || typeof value !== 'object') return null;
		const key = String(value.key || '').trim();
		const updatedAt = Number(value.updatedAt) || 0;
		if (!SAFE_KEY.test(key) || !updatedAt || now() - updatedAt > ttl) return null;
		return { key, updatedAt };
	};

	const persist = (slot, record) => {
		memory.set(slot, record);
		const storage = getStorage();
		if (!storage) return;
		try {
			storage.setItem(storageKeyFor(slot), JSON.stringify(record));
		} catch {
			// Session storage may be disabled; the in-memory copy remains authoritative.
		}
	};

	const read = (slot) => {
		const inMemory = validRecord(memory.get(slot));
		if (inMemory) return inMemory;
		memory.delete(slot);

		const storage = getStorage();
		if (!storage) return null;
		try {
			const storageKey = storageKeyFor(slot);
			const raw = storage.getItem(storageKey);
			if (!raw) return null;
			let record = null;
			try {
				record = validRecord(JSON.parse(raw));
			} catch {
				// Migrate pre-TTL values once. Their original age is unknown, so the
				// migration instant starts the bounded recovery window.
				if (SAFE_KEY.test(raw)) record = { key: raw, updatedAt: now() };
			}
			if (!record) {
				storage.removeItem(storageKey);
				return null;
			}
			persist(slot, record);
			return record;
		} catch {
			return null;
		}
	};

	const acquire = ({ action, profile }) => {
		const slot = slotFor({ action, profile });
		const retained = read(slot);
		if (retained) return retained.key;

		const generated = String(generateKey() || '').trim();
		if (!SAFE_KEY.test(generated)) {
			throw new Error('Unable to generate a valid OpenClaw action idempotency key');
		}
		persist(slot, { key: generated, updatedAt: now() });
		return generated;
	};

	const peek = ({ action, profile }) => read(slotFor({ action, profile }))?.key || '';

	const clear = ({ action, profile, key }) => {
		const slot = slotFor({ action, profile });
		const current = read(slot)?.key || '';
		if (current && current !== key) return false;

		const storage = getStorage();
		if (storage) {
			try {
				storage.removeItem(storageKeyFor(slot));
			} catch {
				// Clearing the in-memory key is still safe after a definitive response.
			}
		}
		memory.delete(slot);
		return true;
	};

	return { acquire, peek, clear };
};
