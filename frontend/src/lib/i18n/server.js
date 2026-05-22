import { defaultLocale, messages, normalizeLocale } from '$lib/i18n/messages.js';

export const getLocaleFromCookies = (cookies) =>
	normalizeLocale(cookies.get('site_lang') || defaultLocale);

const resolveKey = (dictionary, key) =>
	key.split('.').reduce((value, part) => value?.[part], dictionary);

const interpolate = (value, params) => {
	if (!params) return value;
	return value.replace(/\{(\w+)\}/g, (match, key) =>
		Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
	);
};

export const translate = (lang, key, params) => {
	const fallback = resolveKey(messages[defaultLocale], key) ?? key;
	const value = resolveKey(messages[lang], key) ?? fallback;
	return typeof value === 'string' ? interpolate(value, params) : String(value ?? key);
};

export const getTranslator = (cookies) => {
	const locale = getLocaleFromCookies(cookies);
	return (key, params) => translate(locale, key, params);
};
