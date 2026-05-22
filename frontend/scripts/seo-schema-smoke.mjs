#!/usr/bin/env node

const DEFAULT_BASE_URL = process.env.PUBLIC_SITE_URL || 'https://inoxpran.com';
const DEFAULT_TIMEOUT_MS = 12000;

const parseArgs = (argv) => {
	const args = {};
	for (let index = 2; index < argv.length; index += 1) {
		const current = argv[index];
		if (!current.startsWith('--')) continue;
		const key = current.slice(2);
		const next = argv[index + 1];
		if (!next || next.startsWith('--')) {
			args[key] = 'true';
			continue;
		}
		args[key] = next;
		index += 1;
	}
	return args;
};

const decodeHtmlEntities = (value) =>
	String(value || '')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');

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

const extractCanonical = (html) => {
	const match = html.match(
		/<link\b[^>]*\brel=(["'])canonical\1[^>]*\bhref=(["'])([^"']+)\2[^>]*>/i
	);
	return match ? decodeHtmlEntities(match[3]).trim() : '';
};

const extractJsonLdBlocks = (html) => {
	const blocks = [];
	const regex = /<script\b[^>]*type=(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi;
	let match = regex.exec(html);
	while (match) {
		const raw = String(match[2] || '').trim();
		if (raw) blocks.push(raw);
		match = regex.exec(html);
	}
	return blocks;
};

const flattenJsonLdNode = (node, results = []) => {
	if (!node) return results;
	if (Array.isArray(node)) {
		node.forEach((item) => flattenJsonLdNode(item, results));
		return results;
	}
	if (typeof node !== 'object') return results;
	results.push(node);
	if (Array.isArray(node['@graph'])) {
		node['@graph'].forEach((item) => flattenJsonLdNode(item, results));
	}
	return results;
};

const parseJsonLdNodes = (html) => {
	const blocks = extractJsonLdBlocks(html);
	const nodes = [];
	for (const block of blocks) {
		try {
			const parsed = JSON.parse(block);
			flattenJsonLdNode(parsed, nodes);
		} catch (error) {
			nodes.push({ __parseError: error instanceof Error ? error.message : String(error) });
		}
	}
	return nodes;
};

const getNodeTypes = (node) => {
	const value = node?.['@type'];
	if (!value) return [];
	return Array.isArray(value) ? value.map(String) : [String(value)];
};

const hasType = (nodes, targetType) => nodes.some((node) => getNodeTypes(node).includes(targetType));

const ensureAbsoluteUrl = (baseUrl, target) => new URL(target, baseUrl).toString();

const fetchPageSnapshot = async (targetUrl, timeoutMs) => {
	const response = await withTimeout(targetUrl, { redirect: 'follow' }, timeoutMs);
	const html = await response.text();
	return {
		url: targetUrl,
		status: response.status,
		canonical: extractCanonical(html),
		nodes: parseJsonLdNodes(html)
	};
};

const findFirstSitemapUrl = async (baseUrl, pattern, timeoutMs) => {
	const sitemapUrl = ensureAbsoluteUrl(baseUrl, '/sitemap.xml');
	const response = await withTimeout(sitemapUrl, {}, timeoutMs);
	if (!response.ok) {
		throw new Error(`Cannot fetch sitemap: HTTP ${response.status}`);
	}
	const xml = await response.text();
	return extractLocUrls(xml).find((url) => pattern.test(new URL(url).pathname)) || '';
};

const validatePage = (label, snapshot, requiredTypes, baseUrl) => {
	const issues = [];
	if (snapshot.status !== 200) {
		issues.push(`status_${snapshot.status}`);
	}

	if (!snapshot.canonical) {
		issues.push('missing_canonical');
	} else {
		const canonicalUrl = ensureAbsoluteUrl(baseUrl, snapshot.canonical);
		const canonicalHost = new URL(canonicalUrl).host;
		const expectedHost = new URL(baseUrl).host;
		const isLocalCheck = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(expectedHost);
		if (!isLocalCheck && canonicalHost !== expectedHost) {
			issues.push('canonical_host_mismatch');
		}
	}

	if (snapshot.nodes.some((node) => node.__parseError)) {
		issues.push('invalid_json_ld');
	}

	for (const requiredType of requiredTypes) {
		if (!hasType(snapshot.nodes, requiredType)) {
			issues.push(`missing_schema_${requiredType}`);
		}
	}

	return { label, ...snapshot, issues };
};

const main = async () => {
	const args = parseArgs(process.argv);
	const baseUrl = String(args.base || DEFAULT_BASE_URL).replace(/\/+$/, '');
	const timeoutMs = Number.parseInt(String(args.timeout || DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS;

	const categoryUrl =
		args.category ||
		(await findFirstSitemapUrl(baseUrl, /\/category\//i, timeoutMs)) ||
		ensureAbsoluteUrl(baseUrl, '/shop');
	const productUrl = args.product || (await findFirstSitemapUrl(baseUrl, /\/product\//i, timeoutMs));
	const blogIndexUrl = args.blog || ensureAbsoluteUrl(baseUrl, '/blog');
	const blogArticleUrl =
		args['blog-article'] ||
		(await findFirstSitemapUrl(baseUrl, /\/blog\/[^/?#]+/i, timeoutMs));
	const faqUrl = args.faq || ensureAbsoluteUrl(baseUrl, '/faq');
	const policiesUrl = args.policies || ensureAbsoluteUrl(baseUrl, '/policies');
	const policyDetailUrl =
		args['policy-detail'] ||
		(await findFirstSitemapUrl(baseUrl, /\/policies\/[^/?#]+/i, timeoutMs));

	if (!productUrl) {
		throw new Error('Cannot find a product URL from sitemap. Pass --product explicitly.');
	}

	if (!blogArticleUrl) {
		throw new Error('Cannot find a blog article URL from sitemap. Pass --blog-article explicitly.');
	}

	if (!policyDetailUrl) {
		throw new Error('Cannot find a policy detail URL from sitemap. Pass --policy-detail explicitly.');
	}

	const checks = [
		{ label: 'home', url: ensureAbsoluteUrl(baseUrl, '/'), requiredTypes: ['Organization', 'WebSite', 'WebPage'] },
		{ label: 'about', url: ensureAbsoluteUrl(baseUrl, '/about'), requiredTypes: ['AboutPage'] },
		{ label: 'category', url: categoryUrl, requiredTypes: ['CollectionPage', 'BreadcrumbList'] },
		{ label: 'product', url: productUrl, requiredTypes: ['Product', 'BreadcrumbList'] },
		{ label: 'blog', url: blogIndexUrl, requiredTypes: ['CollectionPage', 'BreadcrumbList'] },
		{ label: 'blog-article', url: blogArticleUrl, requiredTypes: ['Article', 'BlogPosting', 'BreadcrumbList'] },
		{ label: 'faq', url: faqUrl, requiredTypes: ['FAQPage', 'WebPage', 'BreadcrumbList'] },
		{ label: 'policies', url: policiesUrl, requiredTypes: ['WebPage', 'CollectionPage', 'BreadcrumbList'] },
		{ label: 'policy-detail', url: policyDetailUrl, requiredTypes: ['WebPage', 'BreadcrumbList'] }
	];

	console.log('SEO schema smoke-check started');
	console.log(`Base: ${baseUrl}`);

	const results = [];
	for (const check of checks) {
		const snapshot = await fetchPageSnapshot(check.url, timeoutMs);
		results.push(validatePage(check.label, snapshot, check.requiredTypes, baseUrl));
	}

	const failed = results.filter((result) => result.issues.length > 0);

	for (const result of results) {
		console.log(`- ${result.label}: ${result.url}`);
		console.log(`  status: ${result.status}`);
		console.log(`  canonical: ${result.canonical || '(missing)'}`);
		console.log(`  types: ${Array.from(new Set(result.nodes.flatMap(getNodeTypes))).join(', ') || '(none)'}`);
		if (result.issues.length) {
			console.log(`  issues: ${result.issues.join(', ')}`);
		}
	}

	if (failed.length) {
		throw new Error(`Schema smoke-check failed for ${failed.map((item) => item.label).join(', ')}`);
	}

	console.log('SEO schema smoke-check passed.');
};

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

