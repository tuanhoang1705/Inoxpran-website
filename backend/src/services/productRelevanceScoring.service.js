'use strict'

const { buildEnvProductSeedingConfig } = require('../config/productSeeding.config');

const normalizeText = (value) => String(value || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP_WORDS = new Set([
    'va', 'và', 'voi', 'với', 'cho', 'cua', 'của', 'mot', 'một', 'nhung', 'những', 'cac', 'các',
    'the', 'and', 'for', 'with', 'how', 'cach', 'cách', 'lam', 'làm', 'khi', 'tu', 'từ',
    'phu', 'phù', 'hop', 'hợp', 'dung', 'dụng', 'san', 'sản', 'pham', 'phẩm', 'gia', 'khong', 'không'
]);
const SEMANTIC_GROUPS = [
    ['quạt', 'quat', 'fan', 'làm mát', 'lam mat', 'gió', 'gio'],
    ['tích điện', 'tich dien', 'sạc', 'sac', 'pin', 'rechargeable', 'mất điện', 'mat dien'],
    ['nồi', 'noi', 'cookware', 'nấu', 'nau', 'bếp', 'bep'],
    ['chảo', 'chao', 'pan', 'chiên', 'chien', 'xào', 'xao'],
    ['inox', 'stainless', 'thép không gỉ', 'thep khong gi'],
    ['ấm', 'am', 'kettle', 'đun nước', 'dun nuoc'],
    ['mini', 'nhỏ gọn', 'nho gon', 'cá nhân', 'ca nhan', 'bàn học', 'ban hoc'],
    ['vệ sinh', 've sinh', 'làm sạch', 'lam sach', 'bảo quản', 'bao quan', 'care'],
    ['mua', 'chọn', 'chon', 'buying', 'so sánh', 'so sanh', 'comparison']
];

const tokens = (value) => new Set(normalizeText(value).split(' ').filter((item) => item.length > 1 && !STOP_WORDS.has(item)));
const expandSemanticTokens = (value) => {
    const normalized = normalizeText(value);
    const padded = ` ${normalized} `;
    const result = tokens(normalized);
    SEMANTIC_GROUPS.forEach((group) => {
        if (group.some((phrase) => padded.includes(` ${normalizeText(phrase)} `))) {
            group.forEach((phrase) => tokens(phrase).forEach((token) => result.add(token)));
        }
    });
    return result;
};

const overlapScore = (query, corpus) => {
    const queryTokens = query instanceof Set ? query : expandSemanticTokens(query);
    const corpusTokens = corpus instanceof Set ? corpus : expandSemanticTokens(corpus);
    if (!queryTokens.size || !corpusTokens.size) return 0;
    const matched = [...queryTokens].filter((item) => corpusTokens.has(item));
    return Number(Math.min(1, matched.length / Math.max(2, queryTokens.size * 0.65)).toFixed(4));
};

const productCorpus = (candidate) => [
    candidate.name,
    candidate.category?.id,
    candidate.category?.name,
    candidate.shortDescription,
    ...(candidate.verifiedFeatures || []),
    ...(candidate.verifiedSpecifications || []).flatMap((item) => [item.key, item.value]),
    ...(candidate.materials || []),
    ...(candidate.supportedUseCases || []),
    ...(candidate.problemSolutions || []),
    ...(candidate.compatibility || []),
    ...(candidate.targetCustomers || [])
].join(' ');

const addPenalty = (penalties, code, value, evidence = '') => {
    if (value <= 0) return;
    penalties.push({ code, value: Number(value.toFixed(4)), evidence });
};

const scoreCandidate = ({ candidate, brief = {}, exposure = {}, config = buildEnvProductSeedingConfig() }) => {
    const weights = config.scoringWeights;
    const penaltyConfig = config.scoringPenalties;
    const corpus = productCorpus(candidate);
    const topicQuery = [brief.topic, ...(brief.searchIntent || []), brief.articleType, brief.contentRole].join(' ');
    const problemQuery = [...(brief.userProblems || []), ...(brief.targetAudience || [])].join(' ');
    const useCaseCorpus = [...(candidate.supportedUseCases || []), ...(candidate.problemSolutions || []), ...(candidate.compatibility || [])].join(' ');
    const preferredCategories = new Set((brief.preferredCategoryIds || []).map(normalizeText));
    const preferredProducts = new Set((brief.preferredProductIds || []).map(String));
    const excludedProducts = new Set((brief.excludedProductIds || []).map(String));
    const topicIntent = overlapScore(topicQuery, corpus);
    const identityTokens = tokens([candidate.name, candidate.category?.name, ...(candidate.verifiedFeatures || []), ...(candidate.supportedUseCases || [])].join(' '));
    const anchorMatches = [...expandSemanticTokens([brief.topic, ...(brief.searchIntent || [])].join(' '))]
        .filter((item) => item.length >= 3 && identityTokens.has(item));
    const userProblem = problemQuery ? overlapScore(problemQuery, corpus) : topicIntent;
    const categoryPreferred = preferredCategories.size > 0 && preferredCategories.has(normalizeText(candidate.category?.id));
    const categoryFeature = Number(Math.min(1, overlapScore(topicQuery, `${candidate.category?.name || ''} ${(candidate.verifiedFeatures || []).join(' ')}`) + (categoryPreferred ? 0.2 : 0)).toFixed(4));
    const useCase = useCaseCorpus ? overlapScore(`${topicQuery} ${problemQuery}`, useCaseCorpus) : overlapScore(topicQuery, corpus) * 0.5;
    const availability = candidate.availability === 'in_stock' ? 1 : candidate.availability === 'low_stock' ? 0.65 : candidate.availability === 'unknown' ? 0.3 : 0;
    const dataCompleteness = Math.min(Math.max(Number(candidate.dataCompleteness) || 0, 0), 1);
    const seasonality = (brief.seasonalContext || []).length
        ? overlapScore((brief.seasonalContext || []).join(' '), (candidate.seasonality || []).join(' '))
        : 0.5;
    const linkOpportunity = candidate.canonicalUrl && candidate.status === 'active' ? 1 : 0;
    const scoreBreakdown = { topicIntent, userProblem, categoryFeature, useCase, availability, dataCompleteness, seasonality, linkOpportunity };
    let weightedScore = Object.entries(scoreBreakdown).reduce((sum, [key, value]) => sum + value * (weights[key] || 0), 0);
    if (preferredProducts.has(String(candidate.productId))) weightedScore += 0.03;
    const penalties = [];
    if (candidate.status !== 'active') addPenalty(penalties, 'inactive_or_discontinued', penaltyConfig.inactive);
    if (!candidate.canonicalUrl || !/^\/product\/[a-z0-9%._~-]+$/i.test(candidate.canonicalUrl)) addPenalty(penalties, 'invalid_canonical_url', penaltyConfig.invalidCanonicalUrl);
    if (candidate.availability === 'out_of_stock' && !brief.productSeeding?.allowOutOfStock) addPenalty(penalties, 'out_of_stock', penaltyConfig.outOfStock);
    if (dataCompleteness < config.catalogMinDataCompleteness) addPenalty(penalties, 'insufficient_data', penaltyConfig.insufficientData);
    if (topicIntent < 0.2) addPenalty(penalties, 'weak_semantic_relevance', penaltyConfig.weakSemanticRelevance);
    if (preferredCategories.size && !categoryPreferred) addPenalty(penalties, 'category_mismatch', penaltyConfig.categoryMismatch);
    if (excludedProducts.has(String(candidate.productId))) addPenalty(penalties, 'explicitly_excluded', penaltyConfig.excluded);
    if (Number(exposure.daysSinceLast || Infinity) < config.productCooldownDays) addPenalty(penalties, 'product_cooldown', penaltyConfig.recentExposure, `${exposure.daysSinceLast} days since last inclusion`);
    if (Number(exposure.last30Days || 0) >= 3) addPenalty(penalties, 'recent_overexposure', penaltyConfig.repeatedExposure * Math.min(3, Math.floor(exposure.last30Days / 3)), `${exposure.last30Days} inclusions in 30 days`);
    if (Number(exposure.categoryLast30Days || 0) >= 6) addPenalty(penalties, 'category_overexposure', penaltyConfig.repeatedExposure, `${exposure.categoryLast30Days} category inclusions in 30 days`);
    if (Math.max(0, ...Object.values(exposure.ctaModes || {}).map(Number)) >= 3) addPenalty(penalties, 'repeated_cta_pattern', penaltyConfig.repeatedExposure * 0.5);
    if (Math.max(0, ...Object.values(exposure.placementTypes || {}).map(Number)) >= 3) addPenalty(penalties, 'repeated_placement_pattern', penaltyConfig.repeatedExposure * 0.5);
    const penaltyTotal = penalties.reduce((sum, item) => sum + item.value, 0);
    const totalScore = Number(Math.min(1, Math.max(0, weightedScore - penaltyTotal)).toFixed(4));
    const rejectionReasons = [
        ...(candidate.rejectionReasons || []),
        ...penalties.filter((item) => ['inactive_or_discontinued', 'invalid_canonical_url', 'explicitly_excluded'].includes(item.code)).map((item) => item.code)
    ];
    if (totalScore < (brief.productSeeding?.relevanceThreshold ?? config.minRelevanceScore)) rejectionReasons.push('below_relevance_threshold');
    if (!anchorMatches.length) rejectionReasons.push('no_semantic_anchor');
    return {
        productId: String(candidate.productId || ''),
        totalScore,
        scoreBreakdown,
        penalties,
        matchedEvidence: [
            ...anchorMatches.slice(0, 5).map((item) => `anchor:${item}`),
            ...(topicIntent > 0 ? [`topic:${candidate.name}`] : []),
            ...(categoryFeature > 0 ? [`category:${candidate.category?.name || ''}`] : []),
            ...(useCase > 0 ? (candidate.supportedUseCases || []).slice(0, 3).map((item) => `use_case:${item}`) : [])
        ],
        missingEvidence: [
            ...(candidate.verifiedSpecifications?.length ? [] : ['verified_specifications']),
            ...(candidate.supportedUseCases?.length ? [] : ['supported_use_cases'])
        ],
        eligible: Boolean(candidate.eligible) && rejectionReasons.length === 0,
        rejectionReasons
    };
};

const rankCandidates = ({ candidates = [], brief = {}, exposures = {}, config = buildEnvProductSeedingConfig() }) => candidates
    .map((candidate) => ({
        candidate,
        score: scoreCandidate({ candidate, brief, exposure: exposures[String(candidate.productId)] || {}, config })
    }))
    .sort((left, right) => right.score.totalScore - left.score.totalScore || String(left.candidate.productId).localeCompare(String(right.candidate.productId)));

module.exports = {
    ProductRelevanceScoringService: { scoreCandidate, rankCandidates },
    expandSemanticTokens,
    normalizeText,
    overlapScore,
    productCorpus,
    rankCandidates,
    scoreCandidate
};
