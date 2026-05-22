import { browser } from '$app/environment';
import { derived } from 'svelte/store';
import { locale as sharedLocale } from '$lib/i18n/index.js';
import { defaultLocale, messages, normalizeLocale } from './messages.js';

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

const t = derived(sharedLocale, ($locale) => (key, params) => translate($locale, key, params));

const setLocale = (value) => {
	const next = normalizeLocale(value);
	sharedLocale.set(next);
	if (browser) {
		document.documentElement.lang = next;
		document.cookie = `site_lang=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
	}
};

const initLocale = (value) => {
	const next = normalizeLocale(value);
	sharedLocale.set(next);
	if (browser) {
		document.documentElement.lang = next;
	}
};

export { sharedLocale as locale, t, setLocale, initLocale, translate };
