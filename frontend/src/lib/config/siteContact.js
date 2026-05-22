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

export const SITE_CONTACT = {
	phone: String(publicEnv.PUBLIC_SUPPORT_PHONE || fallbackPhone).trim(),
	email: String(publicEnv.PUBLIC_SUPPORT_EMAIL || fallbackEmail).trim(),
	telegramUsername,
	telegramUrl: telegramUrl || `https://t.me/${telegramUsername || fallbackTelegramUsername}`
};
