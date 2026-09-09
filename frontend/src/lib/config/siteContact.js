import { env as publicEnv } from '$env/dynamic/public';

const fallbackPhone = '0867 024 186';
const fallbackEmail = 'congtytnhhdaututhangvuong@gmail.com';
const fallbackTelegramUsername = 'hoangnt1705';

const telegramUsername = String(
	publicEnv.PUBLIC_TELEGRAM_SUPPORT_USERNAME || fallbackTelegramUsername
)
	.trim()
	.replace(/^@+/, '');

const telegramUrl = String(publicEnv.PUBLIC_TELEGRAM_SUPPORT_URL || '').trim();

// Deliberately has no fallback: the contact page shipped a placeholder showroom address
// ("123 Duong ABC, Quan 1") that Google and customers would both read as a real location.
// The showroom card stays hidden until a genuine address is configured here.
const showroomAddress = String(publicEnv.PUBLIC_SHOWROOM_ADDRESS || '').trim();

export const SITE_CONTACT = {
	phone: String(publicEnv.PUBLIC_SUPPORT_PHONE || fallbackPhone).trim(),
	email: String(publicEnv.PUBLIC_SUPPORT_EMAIL || fallbackEmail).trim(),
	showroomAddress,
	telegramUsername,
	telegramUrl: telegramUrl || `https://t.me/${telegramUsername || fallbackTelegramUsername}`
};
