'use strict'

const crypto = require('node:crypto');

const normalizeForSimilarity = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value) => normalizeForSimilarity(value).split(' ').filter((token) => token.length > 1);
const toNgrams = (value, size = 5) => {
    const tokens = tokenize(value);
    const grams = new Set();
    for (let index = 0; index <= tokens.length - size; index += 1) grams.add(tokens.slice(index, index + size).join(' '));
    return grams;
};

const jaccardSimilarity = (left, right) => {
    const leftSet = left instanceof Set ? left : new Set(left || []);
    const rightSet = right instanceof Set ? right : new Set(right || []);
    if (!leftSet.size && !rightSet.size) return 1;
    let intersection = 0;
    leftSet.forEach((item) => { if (rightSet.has(item)) intersection += 1; });
    return intersection / Math.max(1, leftSet.size + rightSet.size - intersection);
};

const textSimilarity = (left, right, ngramSize = 5) => jaccardSimilarity(toNgrams(left, ngramSize), toNgrams(right, ngramSize));
const extractHeadings = (html) => Array.from(String(html || '').matchAll(/<h([2-4])[^>]*>([\s\S]*?)<\/h\1>/gi)).map((match) => ({
    level: Number(match[1]),
    text: String(match[2]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}));

const structuralFingerprint = (html) => {
    const source = String(html || '');
    const headings = extractHeadings(source);
    const paragraphs = Array.from(source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map((match) => tokenize(match[1]).length);
    const firstHeading = headings[0]?.text || '';
    const signature = {
        headingLevels: headings.map((heading) => heading.level),
        headingModes: headings.map((heading) => /\?$/.test(heading.text) ? 'question' : /^\d/.test(heading.text) ? 'numbered' : /^(cach|lam sao|hay|kiem tra|chon|tranh)\b/i.test(normalizeForSimilarity(heading.text)) ? 'action' : 'statement'),
        headingCount: headings.length,
        paragraphCount: paragraphs.length,
        paragraphRhythm: paragraphs.map((length) => length < 45 ? 's' : length > 100 ? 'l' : 'm').join('-'),
        listCount: (source.match(/<[ou]l\b/gi) || []).length,
        tableCount: (source.match(/<table\b/gi) || []).length,
        faqCount: headings.filter((heading) => /\?|faq|cau hoi/i.test(heading.text)).length,
        openingMode: /\?$/.test(firstHeading) ? 'question-led' : /sai|van de|gap|kho/i.test(normalizeForSimilarity(firstHeading)) ? 'problem-first' : 'answer-first'
    };
    return { ...signature, hash: crypto.createHash('sha256').update(JSON.stringify(signature)).digest('hex') };
};

const structuralSimilarity = (left, right) => {
    if (!left || !right) return 0;
    const levelScore = jaccardSimilarity(new Set(left.headingLevels || []), new Set(right.headingLevels || []));
    const modeScore = jaccardSimilarity(new Set(left.headingModes || []), new Set(right.headingModes || []));
    const rhythmScore = textSimilarity(left.paragraphRhythm || '', right.paragraphRhythm || '', 2);
    const countDelta = Math.abs(Number(left.headingCount || 0) - Number(right.headingCount || 0));
    const countScore = 1 - Math.min(1, countDelta / Math.max(1, Number(left.headingCount || 1), Number(right.headingCount || 1)));
    return Number(((levelScore + modeScore + rhythmScore + countScore) / 4).toFixed(4));
};

const reviewOriginality = ({ title, contentHtml, existing = [], thresholds = {} }) => {
    const contentThreshold = Number(thresholds.content || process.env.CONTENT_SIMILARITY_THRESHOLD || 0.82);
    const headingThreshold = Number(thresholds.headings || process.env.CONTENT_HEADING_SIMILARITY_THRESHOLD || 0.72);
    const structureThreshold = Number(thresholds.structure || process.env.CONTENT_STRUCTURAL_SIMILARITY_THRESHOLD || 0.78);
    const fingerprint = structuralFingerprint(contentHtml);
    let maximum = { content: 0, headings: 0, structure: 0, title: 0, blogId: '' };
    const candidateHeadings = extractHeadings(contentHtml).map((item) => item.text).join(' ');
    for (const item of existing) {
        const scores = {
            content: textSimilarity(contentHtml, item.blog_content || '', 7),
            headings: textSimilarity(candidateHeadings, extractHeadings(item.blog_content || '').map((heading) => heading.text).join(' '), 2),
            structure: structuralSimilarity(fingerprint, item.structuralFingerprint || structuralFingerprint(item.blog_content || '')),
            title: textSimilarity(title, item.blog_title || '', 2),
            blogId: String(item._id || item.id || '')
        };
        if (Math.max(scores.content, scores.headings, scores.structure, scores.title) > Math.max(maximum.content, maximum.headings, maximum.structure, maximum.title)) maximum = scores;
    }
    const reasons = [];
    if (maximum.content >= contentThreshold) reasons.push('content_similarity_high');
    if (maximum.headings >= headingThreshold) reasons.push('heading_similarity_high');
    if (maximum.structure >= structureThreshold) reasons.push('structural_similarity_high');
    if (maximum.title >= 0.85) reasons.push('title_similarity_high');
    return { passed: reasons.length === 0, risk: reasons.length ? 'high' : Math.max(maximum.content, maximum.headings, maximum.structure) > 0.6 ? 'medium' : 'low', reasons, maximumSimilarity: maximum, fingerprint };
};

const reviewFacts = (html) => {
    const text = normalizeForSimilarity(html);
    const unsupportedPatterns = [
        /100 phan tram/, /duoc chung nhan(?! theo)/, /tot nhat (?:viet nam|the gioi)/,
        /nghien cuu cho thay(?![^.]{0,120}(?:nguon|theo))/, /thu nghiem cua chung toi/,
        /bao dam tang hang/, /google se xep hang/
    ];
    const unsupportedClaims = unsupportedPatterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
    return { passed: unsupportedClaims.length === 0, unsupportedClaims, requiresHumanVerification: unsupportedClaims.length > 0 };
};

const reviewPeopleFirstAndSpam = ({ html, primaryKeyword = '' }) => {
    const tokens = tokenize(html);
    const keywordTokens = tokenize(primaryKeyword);
    const keyword = keywordTokens.join(' ');
    const normalized = normalizeForSimilarity(html);
    const occurrences = keyword ? normalized.split(keyword).length - 1 : 0;
    const keywordDensity = keywordTokens.length ? (occurrences * keywordTokens.length) / Math.max(tokens.length, 1) : 0;
    const uniqueRatio = new Set(tokens).size / Math.max(tokens.length, 1);
    const reasons = [];
    if (keywordDensity > 0.045) reasons.push('keyword_stuffing_risk');
    if (tokens.length > 150 && uniqueRatio < 0.18) reasons.push('repetitive_low_value_content');
    if (/doorway|hidden text|cloaking|danh lua google/.test(normalized)) reasons.push('spam_tactic_language');
    if ((html.match(/<h2\b/gi) || []).length < 3) reasons.push('insufficient_topic_coverage');
    return { passed: reasons.length === 0, spamRisk: reasons.length ? 'high' : 'low', peopleFirst: reasons.length ? 'needs_review' : 'pass', keywordDensity: Number(keywordDensity.toFixed(4)), uniqueRatio: Number(uniqueRatio.toFixed(4)), reasons };
};

const reviewBrandVoice = (html) => {
    const text = normalizeForSimilarity(html);
    const violations = [];
    if (/xa xi bac nhat|dang cap thuong luu|hoan hao tuyet doi/.test(text)) violations.push('unsupported_luxury_positioning');
    if (/chung toi da thu nghiem|chuyen gia inoxpran khang dinh/.test(text)) violations.push('fabricated_experience_or_expert');
    return { passed: violations.length === 0, status: violations.length ? 'fail' : 'pass', violations };
};

const FORMULAIC_HEADING_PATTERNS = [
    /^chon kich ban/, /^kich ban (?:gia dinh|nau|uu tien)/, /^chon tieu chi theo kich ban/,
    /^bai viet (?:huong dan|nay)/, /^huong dan chon\b.{0,4}$/
];

const detectFormulaicDraft = (html) => {
    const headings = extractHeadings(html)
        .filter((heading) => heading.level === 2)
        .map((heading) => normalizeForSimilarity(heading.text));
    const reasons = [];
    if (headings.some((heading) => FORMULAIC_HEADING_PATTERNS.some((pattern) => pattern.test(heading)))) {
        reasons.push('formulaic_scenario_heading');
    }
    const firstHeading = headings[0] || '';
    if (FORMULAIC_HEADING_PATTERNS.some((pattern) => pattern.test(firstHeading))) {
        reasons.push('formulaic_opening_heading');
    }
    return { matched: reasons.length > 0, reasons };
};

module.exports = {
    extractHeadings,
    detectFormulaicDraft,
    jaccardSimilarity,
    normalizeForSimilarity,
    reviewBrandVoice,
    reviewFacts,
    reviewOriginality,
    reviewPeopleFirstAndSpam,
    structuralFingerprint,
    structuralSimilarity,
    textSimilarity,
    tokenize
};
