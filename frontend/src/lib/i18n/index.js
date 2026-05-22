import { browser } from '$app/environment';
import { derived, writable } from 'svelte/store';
import { defaultLocale, messages, normalizeLocale } from './messages.js';

const locale = writable(defaultLocale);

const resolveKey = (dictionary, key) =>
	key.split('.').reduce((value, part) => value?.[part], dictionary);

const interpolate = (value, params) => {
	if (!params) return value;
	return value.replace(/\{(\w+)\}/g, (match, key) =>
		Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
	);
};

const translate = (lang, key, params) => {
	const fallback = resolveKey(messages[defaultLocale], key) ?? key;
	const value = resolveKey(messages[lang], key) ?? fallback;
	return typeof value === 'string' ? interpolate(value, params) : String(value ?? key);
};

const t = derived(locale, ($locale) => (key, params) => translate($locale, key, params));

const setLocale = (value) => {
	const next = normalizeLocale(value);
	locale.set(next);
	if (browser) {
		document.documentElement.lang = next;
		document.cookie = `site_lang=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
	}
};

const initLocale = (value) => {
	const next = normalizeLocale(value);
	locale.set(next);
	if (browser) {
		document.documentElement.lang = next;
	}
};

export { locale, t, setLocale, initLocale, translate };
