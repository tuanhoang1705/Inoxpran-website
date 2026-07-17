'use strict'

const { countWords, stripHtml } = require('../utils/seoBlogSanitizer');

const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const selectedProductsById = (plan = {}) => new Map(
    [plan.primaryProduct, ...(plan.supportingProducts || [])]
        .filter(Boolean)
        .map((item) => [String(item.productId), item])
);

const buildEvidenceText = (item) => {
    const evidence = (item.allowedClaims || [])
        .filter((claim) => !['product_name', 'canonical_url'].includes(claim.key))
        .slice(0, 2)
        .map((claim) => `${escapeHtml(claim.key)}: ${escapeHtml(claim.value)}`);
    return evidence.length
        ? `Thông tin có thể đối chiếu trong catalog: ${evidence.join('; ')}.`
        : 'Hãy đối chiếu thông tin chi tiết trên trang sản phẩm trước khi quyết định.';
};

const buildPlacementHtml = ({ placement, item, placementPlan, includeDisclosure }) => {
    const attributes = [
        `data-block-type="${placement.presentation === 'inline' ? 'product-inline-example' : 'product-recommendation'}"`,
        `data-product-id="${escapeHtml(item.productId)}"`,
        `data-placement-id="${escapeHtml(placement.placementId)}"`,
        `data-section-key="${escapeHtml(placement.sectionKey)}"`,
        `data-commercial-role="${escapeHtml(placement.commercialRole)}"`,
        `data-rank-position="${escapeHtml(placement.rankPosition || 'none')}"`
    ].join(' ');
    const disclosure = includeDisclosure && placementPlan.disclosure?.required
        ? `<aside data-disclosure-type="owned-product">${escapeHtml(placementPlan.disclosure.text)}</aside>`
        : '';
    const evidenceText = buildEvidenceText(item);
    const link = placement.linkAllowed
        ? `<a href="${escapeHtml(item.canonicalUrl)}" data-link-type="product"${placement.ctaAllowed ? ' data-cta-type="product-soft"' : ''}>Xem thông tin sản phẩm</a>`
        : '';
    if (placement.presentation === 'inline') {
        return `${disclosure}<p ${attributes}>Ví dụ để đối chiếu: <strong>${escapeHtml(item.name)}</strong>. ${evidenceText} Đây là sản phẩm của INOXPRAN; mức độ phù hợp tùy nhu cầu thực tế. ${link}</p>`;
    }
    return `${disclosure}<section ${attributes}><h3>Một lựa chọn để đối chiếu theo tiêu chí trên</h3><p><strong>${escapeHtml(item.name)}</strong> là ví dụ áp dụng các tiêu chí đã nêu. ${evidenceText} Đây là sản phẩm của INOXPRAN; mức độ phù hợp tùy nhu cầu thực tế.</p>${link}</section>`;
};

const insertionCandidates = (html) => {
    const source = String(html || '');
    const headings = [...source.matchAll(/<h2\b[^>]*>/gi)];
    const closeArticle = source.toLowerCase().lastIndexOf('</article>');
    const end = closeArticle >= 0 ? closeArticle : source.length;
    return [
        ...headings.slice(1).map((match, index) => ({ index: match.index, completedSections: index + 1 })),
        { index: end, completedSections: headings.length }
    ];
};

const resolveInsertionPoint = ({ html, minimumSections, minimumWords, minimumProgressPercent }) => {
    const source = String(html || '');
    const totalWords = Math.max(1, countWords(source));
    const candidates = insertionCandidates(source);
    const eligible = candidates.find((candidate) => {
        const beforeWords = countWords(source.slice(0, candidate.index));
        const progressPercent = Math.round((beforeWords / totalWords) * 100);
        return candidate.completedSections >= minimumSections && beforeWords >= minimumWords && progressPercent >= minimumProgressPercent;
    });
    return eligible || candidates[candidates.length - 1] || { index: source.length, completedSections: 0 };
};

const resolveLastEditorialInsertionPoint = (html) => {
    const source = String(html || '');
    const closeArticle = source.toLowerCase().lastIndexOf('</article>');
    return { index: closeArticle >= 0 ? closeArticle : source.length };
};

const methodologyHtml = (placementPlan) => placementPlan.rankingStrategy?.methodologyRequired
    ? `<section data-editorial-role="ranking-methodology"><h2>Phương pháp và tiêu chí xếp hạng</h2><p>${escapeHtml(placementPlan.rankingStrategy.methodology)}</p><p>Vị trí không đại diện cho dữ liệu doanh số và không thay thế việc tự đối chiếu nhu cầu, thông số và giới hạn sử dụng.</p></section>`
    : '';

const applyEditorialProductPlacementPlanToHtml = ({ html, productSeedPlan, placementPlan }) => {
    let source = String(html || '');
    if (!placementPlan || placementPlan.decision !== 'place_product') return source;
    const products = selectedProductsById(productSeedPlan);
    const sequence = (placementPlan.placementSequence || []).filter((placement) => products.has(String(placement.productId)));
    if (!sequence.length) return source;
    const operations = sequence.map((placement, index) => {
        const threshold = placementPlan.firstProductMention || {};
        const point = placement.rankPosition === 'last'
            ? resolveLastEditorialInsertionPoint(source)
            : resolveInsertionPoint({
                html: source,
                minimumSections: Math.max(Number(threshold.minimumSectionsBeforeProduct) || 0, Number(placement.afterMinimumSection) || 0),
                minimumWords: Number(threshold.minimumWordsBeforeProduct) || 0,
                minimumProgressPercent: Number(threshold.minimumProgressPercent) || 0
            });
        return {
            index: point.index,
            order: index,
            html: buildPlacementHtml({ placement, item: products.get(String(placement.productId)), placementPlan, includeDisclosure: index === 0 })
        };
    }).sort((a, b) => b.index - a.index || b.order - a.order);
    operations.forEach((operation) => {
        source = `${source.slice(0, operation.index)}${operation.html}${source.slice(operation.index)}`;
    });
    const method = methodologyHtml(placementPlan);
    if (method) {
        const firstH2 = source.search(/<h2\b[^>]*>/i);
        const insertAt = firstH2 >= 0 ? firstH2 : source.toLowerCase().indexOf('</article>');
        source = insertAt >= 0 ? `${source.slice(0, insertAt)}${method}${source.slice(insertAt)}` : `${method}${source}`;
    }
    return source;
};

const summarizePlacementOutput = ({ html, placementPlan }) => ({
    placementStyle: placementPlan?.placementStyle || 'no-product',
    placementIds: (placementPlan?.placementSequence || []).map((item) => item.placementId),
    productBlockCount: (String(html || '').match(/data-block-type="product-(?:recommendation|inline-example)"/g) || []).length,
    productImageAnchors: placementPlan?.visualPlacement?.anchors || [],
    methodologyIncluded: /data-editorial-role="ranking-methodology"/.test(String(html || '')),
    disclosureIncluded: /data-disclosure-type="owned-product"/.test(String(html || '')),
    independentWords: countWords(stripHtml(String(html || '').replace(/<(?:section|p)\b[^>]*data-block-type="product-(?:recommendation|inline-example)"[^>]*>[\s\S]*?<\/(?:section|p)>/gi, '')))
});

module.exports = {
    applyEditorialProductPlacementPlanToHtml,
    buildPlacementHtml,
    resolveLastEditorialInsertionPoint,
    resolveInsertionPoint,
    summarizePlacementOutput
};
