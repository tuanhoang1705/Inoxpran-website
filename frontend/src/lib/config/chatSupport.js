import { SITE_CONTACT } from '$lib/config/siteContact.js';

const phoneDigits = String(SITE_CONTACT.phone || '').replace(/\D+/g, '');
const telegramUsername = String(SITE_CONTACT.telegramUsername || '').trim().replace(/^@+/, '');
const telegramUrl = String(SITE_CONTACT.telegramUrl || '').trim();

export const CHAT_SUPPORT_CONFIG = {
	phoneLabel: SITE_CONTACT.phone || '0867 024 186',
	phoneHref: phoneDigits ? `tel:${phoneDigits}` : 'tel:0867024186',
	telegramUsername: telegramUsername || 'hoangnt1705',
	telegramUrl:
		telegramUrl || (telegramUsername ? `https://t.me/${telegramUsername}` : 'https://t.me/hoangnt1705'),
	zaloUrl: 'https://zalo.me/0867024186',
	messengerUrl: 'https://m.me/inoxpranvietnam',
	liveChatUrl: '/contact'
};

