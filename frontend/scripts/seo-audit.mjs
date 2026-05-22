#!/usr/bin/env node

/**
 * SEO audit script for SvelteKit sites.
 *
 * It fetches a sitemap, crawls each URL, and checks:
 * - HTTP status is 200
 * - Canonical tag exists and points to expected host/protocol
 * - Canonical consistency with sitemap URL
 * - Robots meta exists and is not "noindex" for sitemap entries
 * - Hreflang tags exist
 */

const DEFAULT_BASE_URL = process.env.PUBLIC_SITE_URL || 'https://inoxpran.com';
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;

const decodeHtmlEntities = (value) =>
	String(value || '')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');

const normalizePath = (pathname) => {
	if (!pathname) return '/';
	if (pathname === '/') return '/';
	return pathname.replace(/\/+$/, '') || '/';
};

const normalizeUrlForCompare = (rawUrl) => {
	const parsed = new URL(rawUrl);
	const pathname = normalizePath(parsed.pathname);
	const search = parsed.search || '';
	return `${parsed.protocol}//${parsed.host}${pathname}${search}`;
};

const parseArgs = (argv) => {
	const args = {};
	for (let i = 2; i < argv.length; i += 1) {
		const current = argv[i];
		if (!current.startsWith('--')) continue;
		const key = current.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			args[key] = 'true';
			continue;
		}
		args[key] = next;
		i += 1;
	}
	return args;
};

const withTimeout = async (input, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	timer.unref?.();
	try {
		return await fetch(input, {
			...init,
			signal: controller.signal
		});
	} finally {
		clearTimeout(timer);
	}
};

const isRedirectStatus = (status) => status >= 300 && status < 400;

const fetchWithRedirectTrace = async (rawUrl, timeoutMs) => {
	let currentUrl = rawUrl;
	const redirects = [];

	for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
		const response = await withTimeout(
			currentUrl,
			{
				redirect: 'manual'
			},
			timeoutMs
		);
		const location = response.headers.get('location');
		if (!isRedirectStatus(response.status) || !location) {
			return {
				response,
				finalUrl: currentUrl,
				redirects,
				tooManyRedirects: false
			};
		}

		const nextUrl = new URL(location, currentUrl).toString();
		redirects.push({ from: currentUrl, to: nextUrl, status: response.status });
		currentUrl = nextUrl;
	}

	const finalResponse = await withTimeout(
		currentUrl,
		{
			redirect: 'manual'
		},
		timeoutMs
	);

	return {
		response: finalResponse,
		finalUrl: currentUrl,
		redirects,
		tooManyRedirects: true
	};
};

const extractLocUrls = (xmlText) => {
	const urls = [];
	const regex = /<loc>\s*([^<]+)\s*<\/loc>/gi;
	let match = regex.exec(xmlText);
	while (match) {
		const raw = decodeHtmlEntities(match[1]).trim();
		if (raw) urls.push(raw);
		match = regex.exec(xmlText);
	}
	return Array.from(new Set(urls));
};

const extractFirstCanonical = (html) => {
	const canonicalRegex = /<link\b[^>]*\brel=(["'])canonical\1[^>]*\bhref=(["'])([^"']+)\2[^>]*>/i;
	const match = canonicalRegex.exec(html);
	return match ? decodeHtmlEntities(match[3]).trim() : '';
};

const extractMetaRobots = (html) => {
	const robots = [];
	const regex = /<meta\b[^>]*\bname=(["'])robots\1[^>]*\bcontent=(["'])([^"']*)\2[^>]*>/gi;
	let match = regex.exec(html);
	while (match) {
		robots.push(decodeHtmlEntities(match[3]).trim());
		match = regex.exec(html);
	}
	return robots;
};

const countHreflangLinks = (html) => {
	const regex = /<link\b[^>]*\brel=(["'])alternate\1[^>]*\bhreflang=(["'])[^"']+\2[^>]*>/gi;
	let count = 0;
	let match = regex.exec(html);
	while (match) {
		count += 1;
		match = regex.exec(html);
	}
	return count;
};

const runWithConcurrency = async (items, limit, mapper) => {
	const results = new Array(items.length);
	let cursor = 0;

	const worker = async () => {
		while (true) {
			const index = cursor;
			cursor += 1;
			if (index >= items.length) return;
			results[index] = await mapper(items[index], index);
		}
	};

	await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
	return results;
};

const main = async () => {
	const args = parseArgs(process.argv);
	const baseUrl = String(args.base || DEFAULT_BASE_URL).replace(/\/+$/, '');
	const sitemapUrl = String(args.sitemap || `${baseUrl}/sitemap.xml`);
	const concurrency = Number.parseInt(String(args.concurrency || DEFAULT_CONCURRENCY), 10);
	const timeoutMs = Number.parseInt(String(args.timeout || DEFAULT_TIMEOUT_MS), 10);
	const maxUrls = Number.parseInt(String(args.max || ''), 10);
	const expectedHost = new URL(baseUrl).host;

	console.log(`SEO audit started`);
	console.log(`Base: ${baseUrl}`);
	console.log(`Sitemap: ${sitemapUrl}`);
	console.log(`Concurrency: ${Number.isFinite(concurrency) ? concurrency : DEFAULT_CONCURRENCY}`);

	const sitemapResponse = await withTimeout(sitemapUrl, {}, timeoutMs);
	if (!sitemapResponse.ok) {
		throw new Error(`Cannot fetch sitemap: HTTP ${sitemapResponse.status}`);
	}
	const sitemapXml = await sitemapResponse.text();
	const sitemapUrls = extractLocUrls(sitemapXml);
	const targetUrls =
		Number.isFinite(maxUrls) && maxUrls > 0 ? sitemapUrls.slice(0, maxUrls) : sitemapUrls;

	console.log(`URLs discovered: ${sitemapUrls.length}`);
	if (targetUrls.length !== sitemapUrls.length) {
		console.log(`URLs to audit (limited): ${targetUrls.length}`);
	}

	const checks = await runWithConcurrency(
		targetUrls,
		Number.isFinite(concurrency) && concurrency > 0 ? concurrency : DEFAULT_CONCURRENCY,
		async (url) => {
			const issues = [];
			let status = 0;
			let canonical = '';
			let robots = [];
			let hreflangCount = 0;
			let finalUrl = url;
			let redirects = [];
			let error = '';

			try {
				const crawlResult = await fetchWithRedirectTrace(url, timeoutMs);
				const response = crawlResult.response;
				finalUrl = crawlResult.finalUrl;
				redirects = crawlResult.redirects;
				status = response.status;

				if (redirects.length > 0) {
					issues.push('redirect_in_sitemap');
				}
				if (crawlResult.tooManyRedirects) {
					issues.push('too_many_redirects');
				}

				const html = await response.text();

				canonical = extractFirstCanonical(html);
				robots = extractMetaRobots(html);
				hreflangCount = countHreflangLinks(html);

				if (status !== 200) {
					issues.push(`status_${status}`);
				}

				if (!canonical) {
					issues.push('missing_canonical');
				} else {
					let canonicalAbs = canonical;
					try {
						canonicalAbs = new URL(canonical, url).toString();
					} catch {
						issues.push('invalid_canonical_url');
					}

					if (canonicalAbs) {
						const canonicalParsed = new URL(canonicalAbs);
						if (canonicalParsed.protocol !== 'https:') {
							issues.push('canonical_not_https');
						}
						if (canonicalParsed.host !== expectedHost) {
							issues.push('canonical_host_mismatch');
						}

						const normalizedCanonical = normalizeUrlForCompare(canonicalAbs);
						const normalizedExpected = normalizeUrlForCompare(
							redirects.length > 0 ? finalUrl : url
						);
						if (normalizedCanonical !== normalizedExpected) {
							issues.push('canonical_differs_from_sitemap_url');
						}
					}
				}

				if (!robots.length) {
					issues.push('missing_robots_meta');
				}
				if (robots.length > 1) {
					issues.push('multiple_robots_meta');
				}
				if (robots.some((value) => value.toLowerCase().includes('noindex'))) {
					issues.push('robots_contains_noindex');
				}

				if (hreflangCount === 0) {
					issues.push('missing_hreflang');
				}
			} catch (caught) {
				error = caught instanceof Error ? caught.message : String(caught);
				issues.push('fetch_error');
			}

			return {
				url,
				status,
				canonical,
				robots,
				hreflangCount,
				finalUrl,
				redirects,
				issues,
				error
			};
		}
	);

	const pagesWithIssues = checks.filter((result) => result.issues.length > 0);
	console.log('');
	console.log(`Audit completed: ${checks.length} page(s) checked`);
	console.log(`Pages with issue(s): ${pagesWithIssues.length}`);

	if (pagesWithIssues.length) {
		console.log('');
		console.log('Issue details:');
		for (const page of pagesWithIssues) {
			console.log(`- ${page.url}`);
			console.log(`  issues: ${page.issues.join(', ')}`);
			if (page.status) console.log(`  status: ${page.status}`);
			if (page.redirects.length) {
				console.log(
					`  redirects: ${page.redirects
						.map((hop) => `${hop.status} ${hop.from} -> ${hop.to}`)
						.join(' | ')}`
				);
			}
			if (page.finalUrl && page.finalUrl !== page.url) {
				console.log(`  finalUrl: ${page.finalUrl}`);
			}
			if (page.canonical) console.log(`  canonical: ${page.canonical}`);
			if (page.robots.length) console.log(`  robots: ${page.robots.join(' | ')}`);
			if (page.error) console.log(`  error: ${page.error}`);
		}
		process.exitCode = 1;
		return;
	}

	console.log('No canonical/robots/hreflang issue found in audited URLs.');
};

main().catch((error) => {
	console.error('SEO audit failed.');
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
