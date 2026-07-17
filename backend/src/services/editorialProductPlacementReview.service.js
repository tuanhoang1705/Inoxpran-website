'use strict'

const { countWords, stripHtml } = require('../utils/seoBlogSanitizer');
const { reviewProductClaims } = require('./productSeedingReview.service');
const { hasBestsellerClaim } = require('./editorialProductPlacementPlanning.service');

const attribute = (tag, name) => {
    const match = String(tag || '').match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
    return match?.[1] || '';
};

const extractPlacementBlocks = (html) => {
    const source = String(html || '');
    const regex = /<(section|p)\b([^>]*data-block-type=["']product-(?:recommendation|inline-example)["'][^>]*)>([\s\S]*?)<\/\1>/gi;
    return [...source.matchAll(regex)].map((match) => ({
        index: match.index,
        endIndex: match.index + match[0].length,
        tag: match[1].toLowerCase(),
        html: match[0],
        text: stripHtml(match[0]),
        productId: attribute(match[2], 'data-product-id'),
        placementId: attribute(match[2], 'data-placement-id'),
        sectionKey: attribute(match[2], 'data-section-key'),
        commercialRole: attribute(match[2], 'data-commercial-role'),
        rankPosition: attribute(match[2], 'data-rank-position') || 'none',
        links: [...match[0].matchAll(/<a\b([^>]*)>/gi)].map((link) => ({ href: attribute(link[1], 'href'), linkType: attribute(link[1], 'data-link-type'), ctaType: attribute(link[1], 'data-cta-type') }))
    }));
};

const selectedProducts = (plan = {}) => [plan.primaryProduct, ...(plan.supportingProducts || [])].filter(Boolean);

const firstMentionMetrics = ({ html, productSeedPlan, blocks }) => {
    const source = String(html || '');
    const indexes = blocks.map((item) => item.index);
    selectedProducts(productSeedPlan).forEach((item) => {
        const escaped = String(item.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (escaped) {
            const match = source.match(new RegExp(escaped, 'i'));
            if (match) indexes.push(match.index);
        }
        const idIndex = source.indexOf(String(item.productId || ''));
        if (idIndex >= 0) indexes.push(idIndex);
    });
    const index = indexes.length ? Math.min(...indexes) : -1;
    if (index < 0) return { found: false, index: -1, sectionCountBefore: 0, wordsBefore: 0, progressPercent: 0, inIntroduction: false };
    const before = source.slice(0, index);
    const wordsBefore = countWords(before);
    const totalWords = Math.max(1, countWords(source));
    return {
        found: true,
        index,
        sectionCountBefore: (before.match(/<h2\b/gi) || []).length,
        wordsBefore,
        progressPercent: Math.round((wordsBefore / totalWords) * 100),
        inIntroduction: !/<h2\b/i.test(before)
    };
};

const productImages = (html) => [...String(html || '').matchAll(/<(?:img|figure)\b([^>]*)>/gi)]
    .map((match) => ({ index: match.index, endIndex: match.index + match[0].length, productId: attribute(match[1], 'data-product-id'), role: attribute(match[1], 'data-image-role') }))
    .filter((item) => item.productId || item.role === 'product');

const hasConsecutiveItems = ({ html, items }) => items.some((item, index) => {
    const next = items[index + 1];
    if (!next) return false;
    const between = String(html || '').slice(item.endIndex || item.index, next.index);
    return !/<h2\b|<p\b[^>]*>\s*[^<\s]/i.test(between) && countWords(between) < 12;
});

const reviewEditorialProductPlacement = ({ html, title = '', productSeedPlan, placementPlan }) => {
    const source = String(html || '');
    const blocks = extractPlacementBlocks(source);
    const images = productImages(source);
    const plannedSequence = placementPlan?.placementSequence || [];
    const plannedPlacementIds = new Set(plannedSequence.map((item) => item.placementId));
    const plannedProductIds = new Set(selectedProducts(productSeedPlan).map((item) => String(item.productId)));
    const issues = [];
    const warnings = [];
    const decisionPlacesProduct = placementPlan?.decision === 'place_product';
    if (!decisionPlacesProduct && blocks.length) issues.push('product_present_without_placement_plan');
    if (decisionPlacesProduct && blocks.length !== plannedSequence.length) issues.push('planned_product_block_count_mismatch');
    blocks.forEach((block) => {
        if (!plannedPlacementIds.has(block.placementId)) issues.push(`unplanned_placement_id:${block.placementId || 'missing'}`);
        if (!plannedProductIds.has(String(block.productId))) issues.push(`unplanned_product_id:${block.productId || 'missing'}`);
        const planned = plannedSequence.find((item) => item.placementId === block.placementId);
        if (planned && String(planned.productId) !== String(block.productId)) issues.push(`placement_product_mismatch:${block.placementId}`);
        if (planned && String(planned.sectionKey || '') !== String(block.sectionKey || '')) issues.push(`placement_section_mismatch:${block.placementId}`);
        if (planned && String(planned.commercialRole || '') !== String(block.commercialRole || '')) issues.push(`placement_commercial_role_mismatch:${block.placementId}`);
        if (block.links.some((link) => link.linkType === 'product' && !/^\/(?:product|products)\//.test(link.href) && !/^https:\/\/(?:www\.)?inoxpran\.com\//.test(link.href))) issues.push(`unsafe_product_link:${block.placementId}`);
    });

    const firstProductMention = firstMentionMetrics({ html: source, productSeedPlan, blocks });
    const firstRule = placementPlan?.firstProductMention || {};
    if (decisionPlacesProduct && !firstProductMention.found) issues.push('planned_product_mention_missing');
    if (firstProductMention.found) {
        if (firstProductMention.inIntroduction && !firstRule.introAllowed) issues.push('product_mentioned_in_intro');
        if (firstProductMention.sectionCountBefore < Number(firstRule.minimumSectionsBeforeProduct || 0)) issues.push('first_product_mention_too_early_by_section');
        if (firstProductMention.wordsBefore < Number(firstRule.minimumWordsBeforeProduct || 0)) issues.push('first_product_mention_too_early_by_words');
        if (firstProductMention.progressPercent < Number(firstRule.minimumProgressPercent || 0)) issues.push('first_product_mention_too_early_by_progress');
    }

    const density = placementPlan?.commercialDensity || {};
    const productLinks = blocks.flatMap((item) => item.links).filter((item) => item.linkType === 'product');
    const ctaCount = productLinks.filter((item) => item.ctaType).length;
    if (blocks.length > Number(density.maxBlocks || 0)) issues.push('product_block_limit_exceeded');
    if (ctaCount > Number(placementPlan?.ctaStrategy?.maxCount || 0)) issues.push('product_cta_limit_exceeded');
    if (!density.allowConsecutiveProductBlocks && hasConsecutiveItems({ html: source, items: blocks })) issues.push('consecutive_product_blocks');
    const imageItems = images;
    if (!placementPlan?.visualPlacement?.consecutiveProductImagesAllowed && hasConsecutiveItems({ html: source, items: imageItems })) issues.push('consecutive_product_images');
    if (images.length && placementPlan?.visualPlacement?.firstImageMustBeEditorial) {
        const firstAnyImage = source.search(/<(?:img|figure)\b/i);
        if (firstAnyImage === images[0].index) issues.push('product_image_is_first_visual');
    }

    const expectedPosition = placementPlan?.ownedProductPositionPolicy || 'none';
    const rankingEnabled = Boolean(placementPlan?.rankingStrategy?.enabled);
    if (rankingEnabled) {
        blocks.forEach((block) => {
            if (block.rankPosition === 'middle') issues.push('owned_product_in_middle_ranking');
            if (block.rankPosition !== expectedPosition) issues.push(`owned_product_rank_position_mismatch:${block.placementId}`);
        });
    } else if (blocks.some((block) => block.rankPosition === 'middle')) issues.push('owned_product_in_middle_ranking');

    const disclosureIncluded = /data-disclosure-type=["']owned-product["']/.test(source);
    const disclosureRequired = decisionPlacesProduct && Boolean(placementPlan?.disclosure?.required);
    if (disclosureRequired && !disclosureIncluded) issues.push('owned_product_disclosure_missing');
    const methodologyIncluded = /data-editorial-role=["']ranking-methodology["']/.test(source);
    const methodologyRequired = decisionPlacesProduct && Boolean(placementPlan?.rankingStrategy?.methodologyRequired);
    if (methodologyRequired && !methodologyIncluded) issues.push('ranking_methodology_missing');
    const rankingClaimPlan = placementPlan?.rankingClaimReview || {};
    const outputClaimDetected = hasBestsellerClaim(`${title} ${stripHtml(source)}`);
    const rankingEvidenceReview = { ...rankingClaimPlan, outputClaimDetected };
    if (outputClaimDetected && rankingEvidenceReview.evidenceRequired && !rankingEvidenceReview.evidenceValid) issues.push('unsupported_bestseller_claim');
    if (rankingEvidenceReview.claimDetected && rankingEvidenceReview.evidenceRequired && !rankingEvidenceReview.evidenceValid && !rankingEvidenceReview.safeTitleRewriteApplied) issues.push('unsupported_bestseller_claim');

    const withoutCommercial = source
        .replace(/<(section|p)\b[^>]*data-block-type=["']product-(?:recommendation|inline-example)["'][^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<aside\b[^>]*data-disclosure-type=["']owned-product["'][^>]*>[\s\S]*?<\/aside>/gi, '');
    const independentWords = countWords(withoutCommercial);
    const totalWords = Math.max(1, countWords(source));
    const independentRatio = independentWords / totalWords;
    const independentHeadings = (withoutCommercial.match(/<h2\b/gi) || []).length;
    const independentValuePass = independentWords >= 300 && independentRatio >= 0.6 && independentHeadings >= 3;
    if (!independentValuePass) issues.push('independent_editorial_value_insufficient');
    if (decisionPlacesProduct && blocks.length && firstProductMention.progressPercent > 85) warnings.push('product_placement_very_late');

    const claimReview = reviewProductClaims({ html: source, plan: productSeedPlan });
    if (!claimReview.pass) issues.push('product_claim_review_failed');
    const criticalPrefixes = ['unplanned_', 'placement_product_mismatch', 'owned_product_in_middle', 'product_present_without', 'unsafe_product_link'];
    const critical = issues.some((issue) => criticalPrefixes.some((prefix) => issue.startsWith(prefix)));
    const high = issues.some((issue) => /first_product|block_limit|cta_limit|consecutive|disclosure|methodology|bestseller|independent|claim/.test(issue));
    const riskLevel = critical ? 'critical' : high ? 'high' : warnings.length ? 'medium' : 'low';
    const pass = issues.length === 0;
    return {
        pass,
        riskLevel,
        issues: [...new Set(issues)],
        warnings: [...new Set(warnings)],
        metrics: {
            productBlocks: blocks.length,
            productLinks: productLinks.length,
            ctaCount,
            productImages: images.length,
            independentWords,
            independentRatio: Number(independentRatio.toFixed(3)),
            independentHeadings
        },
        firstProductMention,
        placementSummary: blocks.map((block) => ({ placementId: block.placementId, productId: block.productId, sectionKey: block.sectionKey, commercialRole: block.commercialRole, rankPosition: block.rankPosition })),
        productClaimReview: claimReview,
        rankingEvidenceReview,
        disclosureReview: { required: disclosureRequired, included: disclosureIncluded, pass: !disclosureRequired || disclosureIncluded },
        methodologyReview: { required: methodologyRequired, included: methodologyIncluded, pass: !methodologyRequired || methodologyIncluded },
        independentValueReview: { pass: independentValuePass, independentWords, independentRatio: Number(independentRatio.toFixed(3)), independentHeadings },
        visualReview: { pass: !issues.some((item) => item.includes('product_image')), productImageCount: images.length, firstVisualEditorial: !issues.includes('product_image_is_first_visual'), noConsecutiveProductImages: !issues.includes('consecutive_product_images') },
        publishRecommendation: pass ? 'allow' : riskLevel === 'critical' ? 'block' : 'rewrite'
    };
};

module.exports = {
    extractPlacementBlocks,
    firstMentionMetrics,
    reviewEditorialProductPlacement
};
