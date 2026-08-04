import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    buildArchitecture,
    buildLlmDraftMessages,
    passesTrustedTopicPlanGate
} = require('../src/services/agenticBlogCore.service');
const {
    RUBRIC_VERSION
} = require('../src/services/contentOperations/topicRoadmapScoring.service');

// The writer prompt used to inject a hardcoded 4-heading style bank plus a fixed
// answer-block layout, and the strategy brief never reached the writer. These
// tests lock in the de-templating contract: no bank leakage without a real
// brief outline, editorialBrief + avoidStructures are forwarded, and the JSON
// contract asks the model to author the meta fields itself.

const baseArchitectureInput = () => ({
    topic: 'noi com dien cho gia dinh nho',
    style: { styleFamily: 'scenario-based', openingMode: 'answer-first', ctaMode: 'soft', visualPlanMode: 'lifestyle', answerBlockMode: 'inline' },
    decision: 'new',
    researchBundle: { sourceAttributions: [] },
    productSeedPlan: null,
    editorialPlacementPlan: null
});

const userPayload = (messages) => JSON.parse(messages.find((m) => m.role === 'user').content);
const systemText = (messages) => messages.find((m) => m.role === 'system').content;

describe('Agentic blog writer de-templating', () => {
    it('accepts only the canonical current roadmap rubric at gates 82/48 or stricter', () => {
        const current = {
            rubricVersion: RUBRIC_VERSION,
            totalScore: 82.35,
            noveltySubtotal: 60.19,
            hardGatesPassed: true
        };

        expect(passesTrustedTopicPlanGate(current)).toBe(true);
        expect(passesTrustedTopicPlanGate({ ...current, rubricVersion: 'topic-plan-v2-2026-07-25' })).toBe(false);
        expect(passesTrustedTopicPlanGate({ ...current, totalScore: 81.99 })).toBe(false);
        expect(passesTrustedTopicPlanGate({ ...current, noveltySubtotal: 47.99 })).toBe(false);
        expect(passesTrustedTopicPlanGate({
            ...current,
            totalScore: 85,
            acceptanceScore: 90
        })).toBe(false);
    });

    it('does not forward the hardcoded style-heading bank when there is no brief outline', () => {
        const architecture = buildArchitecture(baseArchitectureInput());
        expect(architecture.outlineFromBrief).toBe(false);
        // The internal fallback template still receives synthesized headings.
        expect(architecture.headings.length).toBeGreaterThan(0);

        const messages = buildLlmDraftMessages({
            topic: 'noi com dien cho gia dinh nho',
            primaryKeyword: 'noi com dien',
            architecture
        });
        const payload = userPayload(messages);
        // The bank must never leak into the prompt as a suggested outline.
        expect(payload.contentArchitecture).toBeTruthy();
        expect(payload.contentArchitecture.suggestedHeadings).toBeUndefined();
    });

    it('forwards a genuine brief outline as advisory suggested headings', () => {
        const architecture = buildArchitecture({
            ...baseArchitectureInput(),
            plannedOutline: ['Chon dung dung tich', 'So sanh long noi', 'Cach ve sinh']
        });
        expect(architecture.outlineFromBrief).toBe(true);

        const messages = buildLlmDraftMessages({
            topic: 'noi com dien cho gia dinh nho',
            primaryKeyword: 'noi com dien',
            architecture
        });
        const payload = userPayload(messages);
        expect(payload.contentArchitecture.headingsAreAdvisory).toBe(true);
        expect(payload.contentArchitecture.suggestedHeadings).toEqual([
            'Chon dung dung tich',
            'So sanh long noi',
            'Cach ve sinh'
        ]);
    });

    it('injects the editorial brief and avoid-structures feedback into the prompt', () => {
        const messages = buildLlmDraftMessages({
            topic: 'quat tich dien',
            primaryKeyword: 'quat tich dien',
            editorialBrief: {
                primaryQuestion: 'Chon quat tich dien the nao?',
                supportingQuestions: ['Dung luong pin bao nhieu?'],
                targetAudience: 'Ho gia dinh Viet',
                userProblems: ['Mat dien mua he'],
                contentGap: 'Thieu huong dan thuc te',
                searchIntent: 'informational',
                editorialAngle: 'goc thuc dung',
                differentiationRule: 'Moi bai mot goc rieng.'
            },
            avoidStructures: {
                openingModes: ['answer-first'],
                headingSets: [['Kich ban gia dinh it nguoi', 'Chon tieu chi theo kich ban']]
            }
        });
        const payload = userPayload(messages);
        expect(payload.editorialBrief.primaryQuestion).toBe('Chon quat tich dien the nao?');
        expect(payload.avoidStructures.recentOpeningModes).toContain('answer-first');
        expect(payload.avoidStructures.recentHeadingSets[0]).toContain('Kich ban gia dinh it nguoi');
    });

    it('omits avoidStructures when there is no recent history to avoid', () => {
        const messages = buildLlmDraftMessages({
            topic: 'noi gang',
            primaryKeyword: 'noi gang',
            avoidStructures: { openingModes: [], headingSets: [] }
        });
        expect(userPayload(messages).avoidStructures).toBeNull();
    });

    it('asks the model to author the meta fields itself (no template slicing)', () => {
        const messages = buildLlmDraftMessages({ topic: 'noi gang', primaryKeyword: 'noi gang' });
        const system = systemText(messages);
        expect(system).toContain('"seoTitle"');
        expect(system).toContain('"seoDescription"');
        expect(system).toContain('"tags"');
        // seoDescription must be told not to copy the excerpt verbatim.
        expect(system).toMatch(/không sao chép y hệt "excerpt"/);
        // The formulaic excerpt openings must be explicitly banned.
        expect(system).toContain('Bài viết hướng dẫn');
    });
});
