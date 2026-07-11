import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    reviewBrandVoice,
    reviewFacts,
    reviewOriginality,
    reviewPeopleFirstAndSpam,
    structuralFingerprint,
    structuralSimilarity
} = require('../src/utils/agenticBlogCore.util');

const article = ({ headings = ['Van de', 'Kiem tra', 'Giai phap', 'Cau hoi?'], body = 'Gia dinh can xem chat lieu, loai bep va cach ve sinh truoc khi quyet dinh.' } = {}) =>
    `<article><p>${body}</p>${headings.map((heading) => `<section><h2>${heading}</h2><p>${`${body} `.repeat(12)}</p></section>`).join('')}</article>`;

describe('Agentic Blog Core V2 quality gates', () => {
    it('stores a structural fingerprint that captures hierarchy, rhythm and components', () => {
        const result = structuralFingerprint(`${article()}<ul><li>A</li></ul><table><tr><td>B</td></tr></table>`);
        expect(result.headingCount).toBe(4);
        expect(result.headingLevels).toEqual([2, 2, 2, 2]);
        expect(result.listCount).toBe(1);
        expect(result.tableCount).toBe(1);
        expect(result.hash).toHaveLength(64);
    });

    it('detects an exact article clone', () => {
        const html = article();
        const result = reviewOriginality({
            title: 'Cach chon noi inox',
            contentHtml: html,
            existing: [{ _id: 'blog-1', blog_title: 'Cach chon noi inox', blog_content: html }]
        });
        expect(result.passed).toBe(false);
        expect(result.risk).toBe('high');
        expect(result.reasons).toContain('content_similarity_high');
    });

    it('does not let synonym spinning bypass heading and structural similarity checks', () => {
        const original = article({ body: 'Nguoi dung can kiem tra chat lieu, loai bep va cach ve sinh.' });
        const spun = article({ body: 'Khach hang nen xem xet vat lieu, kieu bep va phuong phap lam sach.' });
        const result = reviewOriginality({
            title: 'Huong dan lua chon dung cu inox',
            contentHtml: spun,
            existing: [{ _id: 'blog-2', blog_title: 'Cam nang chon do inox', blog_content: original }]
        });
        expect(result.passed).toBe(false);
        expect(result.reasons.some((reason) => ['heading_similarity_high', 'structural_similarity_high'].includes(reason))).toBe(true);
    });

    it('measures materially different article structures', () => {
        const checklist = structuralFingerprint(`${article({ headings: ['Checklist', 'Buoc 1', 'Buoc 2', 'Buoc 3'] })}<ul><li>A</li></ul>`);
        const comparison = structuralFingerprint('<article><p>Mo dau</p><h2>So sanh?</h2><table><tr><td>A</td></tr></table><h3>Tieu chi</h3><p>Chi tiet dai va co bang doi chieu.</p></article>');
        expect(structuralSimilarity(checklist, comparison)).toBeLessThan(0.78);
    });

    it('blocks unsupported certifications, fabricated tests and ranking promises', () => {
        const result = reviewFacts('<p>Chung toi da thu nghiem va bao dam tang hang. San pham duoc chung nhan.</p>');
        expect(result.passed).toBe(false);
        expect(result.unsupportedClaims.length).toBeGreaterThan(0);
    });

    it('blocks keyword stuffing and repetitive low-value text', () => {
        const result = reviewPeopleFirstAndSpam({
            html: `<h2>A</h2><h2>B</h2><h2>C</h2><p>${'noi inox '.repeat(220)}</p>`,
            primaryKeyword: 'noi inox'
        });
        expect(result.passed).toBe(false);
        expect(result.spamRisk).toBe('high');
    });

    it('preserves INOXPRAN voice by rejecting fabricated experts and luxury claims', () => {
        expect(reviewBrandVoice('<p>Chuyen gia Inoxpran khang dinh day la lua chon xa xi bac nhat.</p>').passed).toBe(false);
        expect(reviewBrandVoice('<p>Hay doi chieu nhu cau, thong tin vat lieu va huong dan su dung.</p>').passed).toBe(true);
    });
});
