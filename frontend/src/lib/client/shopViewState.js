const SHOP_VIEW_STORAGE_KEY = 'inoxpran_shop_view_state_v1';
const MAX_STATE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_STATE_ENTRIES = 40;

const canUseSessionStorage = () => {
	if (typeof window === 'undefined') return false;
	try {
		return typeof window.sessionStorage !== 'undefined';
	} catch {
		return false;
	}
};

const clampScrollY = (value) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return 0;
	return Math.max(0, Math.round(numeric));
};

const safeParse = (value) => {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
};

const normalizeEntry = (entry) => {
	if (!entry || typeof entry !== 'object') return null;
	const updatedAt = Number(entry.updatedAt);
	if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
	const isFilterPanelExpanded = Boolean(entry.isFilterPanelExpanded);
	return {
		scrollY: clampScrollY(entry.scrollY),
		isFilterPanelExpanded,
		updatedAt
	};
};

const pruneStateMap = (stateMap) => {
	const now = Date.now();
	const normalizedEntries = Object.entries(stateMap || {})
		.map(([key, value]) => [key, normalizeEntry(value)])
		.filter(([key, value]) => Boolean(key) && Boolean(value))
		.filter(([, value]) => now - value.updatedAt <= MAX_STATE_AGE_MS)
		.sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
		.slice(0, MAX_STATE_ENTRIES);

	return Object.fromEntries(normalizedEntries);
};

const readStateMap = () => {
	if (!canUseSessionStorage()) return {};
	const raw = window.sessionStorage.getItem(SHOP_VIEW_STORAGE_KEY);
	return pruneStateMap(safeParse(raw));
};

const writeStateMap = (stateMap) => {
	if (!canUseSessionStorage()) return;
	const normalized = pruneStateMap(stateMap);
	window.sessionStorage.setItem(SHOP_VIEW_STORAGE_KEY, JSON.stringify(normalized));
};

export const saveShopViewState = ({ key, scrollY, isFilterPanelExpanded }) => {
	if (!canUseSessionStorage()) return;
	const normalizedKey = String(key || '').trim();
	if (!normalizedKey) return;
	const current = readStateMap();
	current[normalizedKey] = {
		scrollY: clampScrollY(scrollY),
		isFilterPanelExpanded: Boolean(isFilterPanelExpanded),
		updatedAt: Date.now()
	};
	writeStateMap(current);
};

export const loadShopViewState = (key) => {
	const normalizedKey = String(key || '').trim();
	if (!normalizedKey) return null;
	const current = readStateMap();
	const entry = current[normalizedKey];
	if (!entry) return null;
	return normalizeEntry(entry);
};
