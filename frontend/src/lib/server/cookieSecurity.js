export const shouldUseSecureCookies = ({ siteUrl = '', nodeEnv = '' } = {}) => {
	if (String(nodeEnv).trim().toLowerCase() === 'production') return true;
	const configuredSiteUrl = String(siteUrl || '').trim();
	if (!configuredSiteUrl) return false;
	try {
		return new URL(configuredSiteUrl).protocol === 'https:';
	} catch {
		return false;
	}
};

export const buildHostOnlyCookieOptions = ({ siteUrl = '', nodeEnv = '', maxAge } = {}) => ({
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	secure: shouldUseSecureCookies({ siteUrl, nodeEnv }),
	...(Number.isFinite(maxAge) && maxAge > 0 ? { maxAge } : {})
});

export const resolveLegacyCookieDomain = (siteUrl = '') => {
	const configuredSiteUrl = String(siteUrl || '').trim();
	if (!configuredSiteUrl) return undefined;
	try {
		const { hostname } = new URL(configuredSiteUrl);
		if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return undefined;
		return hostname;
	} catch {
		return undefined;
	}
};
