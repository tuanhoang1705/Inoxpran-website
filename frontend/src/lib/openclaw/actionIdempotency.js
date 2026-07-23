const SAFE_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const STORAGE_PREFIX = 'inoxpran:openclaw-action:v1:';

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
	generateKey = defaultGenerateKey
} = {}) => {
	const memory = new Map();

	const acquire = ({ action, profile }) => {
		const slot = slotFor({ action, profile });
		const inMemory = memory.get(slot);
		if (SAFE_KEY.test(inMemory || '')) return inMemory;

		const storage = getStorage();
		if (storage) {
			try {
				const persisted = storage.getItem(storageKeyFor(slot));
				if (SAFE_KEY.test(persisted || '')) {
					memory.set(slot, persisted);
					return persisted;
				}
			} catch {
				// The in-memory fallback still preserves retries for the current page.
			}
		}

		const generated = String(generateKey() || '').trim();
		if (!SAFE_KEY.test(generated)) {
			throw new Error('Unable to generate a valid OpenClaw action idempotency key');
		}
		memory.set(slot, generated);
		if (storage) {
			try {
				storage.setItem(storageKeyFor(slot), generated);
			} catch {
				// Session storage may be disabled; the in-memory copy remains authoritative.
			}
		}
		return generated;
	};

	const clear = ({ action, profile, key }) => {
		const slot = slotFor({ action, profile });
		const current = memory.get(slot);
		if (current && current !== key) return false;

		const storage = getStorage();
		if (storage) {
			try {
				const persisted = storage.getItem(storageKeyFor(slot));
				if (persisted && persisted !== key) return false;
				storage.removeItem(storageKeyFor(slot));
			} catch {
				// Clearing the in-memory key is still safe after a definitive response.
			}
		}
		memory.delete(slot);
		return true;
	};

	return { acquire, clear };
};
