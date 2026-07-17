'use strict'

const sanitizeHtml = require('sanitize-html');

const normalize = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .toLowerCase().replace(/\s+/g, ' ').trim();
const strip = (value) => sanitizeHtml(String(value || ''), { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();

const extractProductBlocks = (html) => {
    const blocks = [];
    const pattern = /<(section|p)\b([^>]*\bdata-block-type=["']product-(?:recommendation|inline-example)["'][^>]*)>([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = pattern.exec(String(html || ''))) !== null) {
        const attributes = match[2];
        const productId = attributes.match(/\bdata-product-id=["']([a-f0-9]{24})["']/i)?.[1] || '';
        const links = [...match[3].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((link) => ({
            href: link[1].match(/\bhref=["']([^"']+)["']/i)?.[1] || '',
            linkType: link[1].match(/\bdata-link-type=["']([^"']+)["']/i)?.[1] || '',
            anchor: strip(link[2])
        }));
        blocks.push({ productId, html: match[0], bodyHtml: match[3], text: strip(match[3]), links, index: match.index });
    }
    return blocks;
};

const selectedProducts = (plan = {}) => [plan.primaryProduct, ...(plan.supportingProducts || [])].filter(Boolean);
const allowedClaimText = (item) => normalize((item.allowedClaims || []).flatMap((claim) => [claim.key, claim.value]).join(' '));

const reviewProductClaims = ({ html, plan }) => {
    const products = new Map(selectedProducts(plan).map((item) => [String(item.productId), item]));
    const blocks = extractProductBlocks(html);
    const rejectedClaims = [];
    const verifiedClaims = [];
    const issues = [];
    blocks.forEach((block) => {
        const item = products.get(block.productId);
        if (!item) {
            issues.push(`unplanned_product:${block.productId || 'missing_id'}`);
            return;
        }
        const normalizedBlock = normalize(block.text);
        const evidence = allowedClaimText(item);
        const forbiddenPatterns = [
            ['unsupported_certification', /chung nhan|certified|iso\s*\d+/i],
            ['absolute_safety', /hoan toan an toan|tuyet doi an toan|completely safe/i],
            ['unsupported_best_claim', /tot nhat|so mot|number one|best on the market/i],
            ['unsupported_experience', /chung toi da (?:dung|thu nghiem)|khach hang cua chung toi|our customers/i],
            ['unsupported_health_claim', /chua benh|dieu tri|kills? 100%|diet khuan 100%/i],
            ['unsupported_availability_claim', /luon san hang|con hang|giao ngay|always in stock/i],
            ['unsupported_price_claim', /(?:\d[\d.,\s]{0,15})\s*(?:₫|vnd|dong|đ|d)\b/i]
        ];
        forbiddenPatterns.forEach(([code, pattern]) => {
            if (pattern.test(normalizedBlock)) rejectedClaims.push({ productId: block.productId, code, text: block.text.slice(0, 240) });
        });
        const numericSpecs = normalizedBlock.match(/\b\d+(?:[.,]\d+)?\s*(?:w|kw|v|mah|ml|l|cm|mm|kg|g)\b/gi) || [];
        numericSpecs.forEach((claim) => {
            if (!evidence.includes(normalize(claim))) rejectedClaims.push({ productId: block.productId, code: 'unsupported_specification', text: claim });
            else verifiedClaims.push({ productId: block.productId, claim, source: 'product_seed_plan' });
        });
        const values = (item.allowedClaims || []).filter((claim) => claim.value && normalizedBlock.includes(normalize(claim.value)));
        values.forEach((claim) => verifiedClaims.push({ productId: block.productId, claim: `${claim.key}:${claim.value}`, source: claim.source }));
        const conflictingKeys = new Map();
        (item.allowedClaims || []).forEach((claim) => {
            const valuesForKey = conflictingKeys.get(claim.key) || new Set();
            valuesForKey.add(normalize(claim.value));
            conflictingKeys.set(claim.key, valuesForKey);
        });
        conflictingKeys.forEach((valuesForKey, key) => {
            if (valuesForKey.size > 1) rejectedClaims.push({ productId: block.productId, code: 'catalog_data_conflict', text: key });
        });
    });
    const pass = issues.length === 0 && rejectedClaims.length === 0;
    return { pass, claimSafety: pass ? 'pass' : 'fail', verifiedClaims, rejectedClaims, issues, requiredFixes: rejectedClaims.map((item) => `Remove or verify ${item.code}`) };
};

const countOccurrences = (haystack, needle) => {
    if (!needle) return 0;
    let count = 0;
    let offset = 0;
    while ((offset = haystack.indexOf(needle, offset)) >= 0) { count += 1; offset += needle.length; }
    return count;
};

const reviewProductSeeding = ({ html, plan, minIndependentWords = 150 }) => {
    if (!plan || plan.mode === 'off' || plan.decision === 'no_seed') {
        const unexpected = extractProductBlocks(html);
        const pass = unexpected.length === 0;
        return { pass, naturalnessScore: pass ? 1 : 0, relevanceScore: 1, commercialPressure: pass ? 'low' : 'high', claimSafety: 'pass', linkSafety: pass ? 'pass' : 'fail', issues: pass ? [] : ['product_block_present_when_seeding_disabled'], requiredFixes: pass ? [] : ['Remove all product blocks'], publishRecommendation: pass ? 'publish' : 'remove_product', metrics: { productBlocks: unexpected.length } };
    }
    const source = String(html || '');
    const blocks = extractProductBlocks(source);
    const products = selectedProducts(plan);
    const density = plan.commercialDensityLimits || {};
    const plain = normalize(strip(source));
    const withoutProducts = source.replace(/<(section|p)\b[^>]*\bdata-block-type=["']product-(?:recommendation|inline-example)["'][^>]*>[\s\S]*?<\/\1>/gi, '');
    const independentWordCount = strip(withoutProducts).split(/\s+/).filter(Boolean).length;
    const totalWordCount = strip(source).split(/\s+/).filter(Boolean).length;
    const productMentions = products.reduce((sum, item) => sum + countOccurrences(plain, normalize(item.name)), 0);
    const productLinks = blocks.flatMap((item) => item.links).filter((item) => item.linkType === 'product').length;
    const productHeadings = products.reduce((sum, item) => {
        const headings = [...source.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi)].map((match) => normalize(strip(match[1])));
        return sum + headings.filter((heading) => heading.includes(normalize(item.name))).length;
    }, 0);
    const firstH2 = source.search(/<h2\b/i);
    const firstProduct = blocks[0]?.index ?? -1;
    const issues = [];
    if (!blocks.length && ['contextual_seed', 'product_led'].includes(plan.decision)) issues.push('planned_product_block_missing');
    if (firstProduct >= 0 && (firstH2 < 0 || firstProduct < firstH2)) issues.push('product_before_objective_content');
    if (productMentions > Number(density.maxProductMentions || 0)) issues.push('product_mention_limit_exceeded');
    if (productLinks > Number(density.maxProductLinks || 0)) issues.push('product_link_limit_exceeded');
    if (productHeadings > Number(density.maxProductHeadings || 0)) issues.push('product_heading_limit_exceeded');
    if (blocks.some((block) => !/inoxpran/i.test(block.text))) issues.push('ownership_disclosure_missing');
    if (blocks.some((block) => block.links.some((link) => !/^\/product\/[a-z0-9%._~-]+$/i.test(link.href)))) issues.push('invalid_product_url');
    if (blocks.some((block) => {
        const item = products.find((candidate) => String(candidate.productId) === String(block.productId));
        return block.links.some((link) => link.linkType !== 'product' || !item || link.href !== item.canonicalUrl);
    })) issues.push('product_url_not_in_plan');
    const anchors = blocks.flatMap((block) => block.links.map((link) => normalize(link.anchor))).filter(Boolean);
    if (new Set(anchors).size < anchors.length) issues.push('repeated_product_anchor');
    if (/mua ngay|gia soc|buy now|best on the market/i.test(strip(source.slice(0, Math.max(firstH2, 0))))) issues.push('sales_pitch_opening');
    if (['light', 'balanced'].includes(plan.intensity) && (independentWordCount < minIndependentWords || independentWordCount / Math.max(totalWordCount, 1) < 0.7)) issues.push('insufficient_independent_value');
    const commercialIssues = issues.filter((item) => /limit|anchor|sales_pitch|independent_value/.test(item));
    const commercialPressure = commercialIssues.length >= 2 ? 'high' : commercialIssues.length ? 'medium' : 'low';
    const pass = issues.length === 0;
    return {
        pass,
        naturalnessScore: Number(Math.max(0, 1 - issues.length * 0.15).toFixed(2)),
        relevanceScore: Number(products[0]?.relevanceScore || 0),
        commercialPressure,
        claimSafety: 'pending_claim_review',
        linkSafety: issues.some((item) => /link|url|anchor/.test(item)) ? 'fail' : 'pass',
        issues,
        requiredFixes: issues.map((item) => `Fix ${item}`),
        publishRecommendation: pass ? 'publish' : commercialPressure === 'high' ? 'remove_product' : 'rewrite',
        metrics: { productBlocks: blocks.length, productMentions, productLinks, productHeadings, independentWordCount, totalWordCount }
    };
};

const reviewProductLayer = ({ html, plan }) => {
    const productClaimReview = reviewProductClaims({ html, plan });
    const productSeedingReview = reviewProductSeeding({ html, plan });
    productSeedingReview.claimSafety = productClaimReview.claimSafety;
    if (!productClaimReview.pass) {
        productSeedingReview.pass = false;
        productSeedingReview.publishRecommendation = 'rewrite';
        productSeedingReview.issues.push('product_claim_review_failed');
    }
    return { productClaimReview, productSeedingReview, pass: productClaimReview.pass && productSeedingReview.pass };
};

module.exports = {
    ProductSeedingReviewService: { extractProductBlocks, reviewProductClaims, reviewProductLayer, reviewProductSeeding },
    extractProductBlocks,
    reviewProductClaims,
    reviewProductLayer,
    reviewProductSeeding
};
