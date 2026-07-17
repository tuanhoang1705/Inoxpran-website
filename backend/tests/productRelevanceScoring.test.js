import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildEnvProductSeedingConfig } = require('../src/config/productSeeding.config');
const { expandSemanticTokens, overlapScore, rankCandidates, scoreCandidate } = require('../src/services/productRelevanceScoring.service');
const { normalizeBlogBrief } = require('../src/services/productSeedPlanning.service');

const config = buildEnvProductSeedingConfig({
    PRODUCT_SEEDING_ENABLED: 'true', PRODUCT_SEED_MIN_RELEVANCE_SCORE: '0.72', PRODUCT_CATALOG_MIN_DATA_COMPLETENESS: '0.6'
});

const baseCandidate = (overrides = {}) => ({
    productId: '507f1f77bcf86cd799439011', name: 'Quạt để bàn mini INP6407', slug: 'quat-de-ban-mini-inp6407',
    canonicalUrl: '/product/quat-de-ban-mini-inp6407', status: 'active', availability: 'in_stock',
    category: { id: 'Electronics', name: 'Quạt mini' },
    shortDescription: 'Quạt tích điện dùng pin sạc, làm mát bàn học cho học sinh sinh viên khi mất điện',
    verifiedFeatures: ['Pin sạc tích điện', 'Gió làm mát'], verifiedSpecifications: [{ key: 'power', value: '5W', source: 'product_attributes' }],
    materials: ['ABS'], supportedUseCases: ['bàn học', 'mất điện', 'phòng trọ'], problemSolutions: ['làm mát khi mất điện'],
    compatibility: [], targetCustomers: ['học sinh', 'sinh viên'], seasonality: ['mùa hè'], dataCompleteness: 1,
    eligible: true, rejectionReasons: [], ...overrides
});

// A dish dryer written with the generic marketing prose that previously saturated
// the folded-token overlap score (màu sắc, tích hợp, thời gian, bề mặt, phù hợp...).
const dishDryer = () => baseCandidate({
    productId: '507f1f77bcf86cd799439022', name: 'Máy sấy bát đĩa INOXPRAN INP6602', slug: 'may-say-bat-dia-inoxpran-inp6602',
    canonicalUrl: '/product/may-say-bat-dia-inoxpran-inp6602',
    category: { id: 'Electronics', name: 'Máy sấy bát đĩa' },
    shortDescription: 'Máy sấy bát đĩa tích hợp khử khuẩn, màu sắc trang nhã, thời gian sấy nhanh, bề mặt dễ vệ sinh, phù hợp mọi gia đình, hẹn giờ 24 giờ, thiết kế nhỏ gọn sang trọng cho các bạn nội trợ',
    verifiedFeatures: ['Khử khuẩn', 'Hẹn giờ'], supportedUseCases: ['sấy khô bát đĩa'], problemSolutions: ['bát đĩa khô ráo'],
    targetCustomers: ['gia đình']
});

const inoxPot = () => baseCandidate({
    productId: '507f1f77bcf86cd799439033', name: 'Nồi inox 3 đáy INOXPRAN', slug: 'noi-inox-3-day',
    canonicalUrl: '/product/noi-inox-3-day', category: { id: 'CastIrons', name: 'Nồi inox' },
    shortDescription: 'Nồi inox nấu ăn cho gia đình, dễ vệ sinh và bảo quản',
    verifiedFeatures: ['Đáy 3 lớp'], supportedUseCases: ['nấu ăn'], problemSolutions: ['nấu canh'], targetCustomers: ['gia đình']
});

const fanBrief = (overrides = {}) => normalizeBlogBrief({
    topic: 'Quạt tích điện thời trang phù hợp cho các bạn học sinh, sinh viên',
    articleType: 'how-to', searchIntent: ['informational'],
    productSeeding: { mode: 'auto', intensity: 'light', relevanceThreshold: 0.72 }, ...overrides
}, config);

describe('Product relevance semantic safety (GATE-4-FIX-001)', () => {
    it('ranks a genuine fan above a dish dryer with generic marketing prose and rejects the dryer', () => {
        const ranked = rankCandidates({ candidates: [dishDryer(), baseCandidate()], brief: fanBrief(), exposures: {}, config });
        expect(ranked[0].candidate.name).toContain('Quạt');
        expect(ranked[0].score.totalScore).toBeGreaterThan(ranked[1].score.totalScore);
        const dryer = ranked.find((entry) => entry.candidate.name.includes('sấy'));
        expect(dryer.score.eligible).toBe(false);
        expect(dryer.score.rejectionReasons.length).toBeGreaterThan(0);
    });

    it('yields no eligible product for a fan brief against a cookware-only catalog (auto -> no_seed)', () => {
        const ranked = rankCandidates({ candidates: [inoxPot()], brief: fanBrief(), exposures: {}, config });
        expect(ranked[0].score.eligible).toBe(false);
        expect(ranked[0].score.rejectionReasons).toContain('no_semantic_anchor');
    });

    it('keeps a relevant cookware product eligible for a cookware care brief', () => {
        const brief = normalizeBlogBrief({
            topic: 'Cách vệ sinh và bảo quản nồi inox cho gia đình', articleType: 'how-to',
            userProblems: ['nồi inox bị ố'], searchIntent: ['informational'],
            productSeeding: { mode: 'auto', intensity: 'light', relevanceThreshold: 0.5 }, ...{}
        }, config);
        const result = scoreCandidate({ candidate: inoxPot(), brief, config });
        expect(result.rejectionReasons).not.toContain('no_semantic_anchor');
        expect(result.matchedEvidence.some((item) => item.startsWith('anchor:'))).toBe(true);
        expect(result.eligible).toBe(true);
    });

    it('does not trigger the kettle semantic group from the substring "am" inside "làm mát"', () => {
        const expanded = expandSemanticTokens('cách làm mát phòng trọ mùa hè');
        expect(expanded.has('kettle')).toBe(false);
        expect(expanded.has('đun')).toBe(false);
    });

    it('does not collide folded diacritics (sạc vs màu sắc)', () => {
        expect(overlapScore('sạc pin quạt tích điện', 'màu sắc sang trọng bàn ăn gia đình')).toBeLessThan(0.3);
    });
});
