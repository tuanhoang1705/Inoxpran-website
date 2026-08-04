import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    DEFAULT_OPENAI_BLOG_MODEL,
    getOpenAiBlogModelReadiness,
    requireBlogIdeationModel,
    resolveBlogIdeationModel,
    resolveBlogWriterModel
} = require('../src/config/openaiBlog.config');
const { detectFormulaicDraft } = require('../src/utils/agenticBlogCore.util');

describe('OpenClaw blog brain configuration', () => {
    it('does not inherit a generic chat model or invent an implicit provider model', () => {
        const legacyChatModelOnly = { OPENAI_CHAT_MODEL: 'gpt-5-mini' };
        expect(DEFAULT_OPENAI_BLOG_MODEL).toBe('');
        expect(resolveBlogWriterModel(legacyChatModelOnly)).toBe('');
        expect(resolveBlogIdeationModel(legacyChatModelOnly)).toBe('');
        expect(() => requireBlogIdeationModel(legacyChatModelOnly)).toThrow(
            expect.objectContaining({ code: 'OPENAI_IDEATION_MODEL_REQUIRED' })
        );
    });

    it('requires explicit role-specific model configuration', () => {
        expect(resolveBlogWriterModel({ OPENAI_BLOG_MODEL: 'gpt-5.6-terra' })).toBe('');
        expect(resolveBlogWriterModel({ OPENAI_WRITER_MODEL: 'gpt-5.6-sol' })).toBe('gpt-5.6-sol');
        expect(resolveBlogIdeationModel({ OPENAI_BLOG_MODEL: 'gpt-5.6-terra', OPENAI_IDEATION_MODEL: 'gpt-5.6-sol' })).toBe('gpt-5.6-sol');
        expect(getOpenAiBlogModelReadiness({
            OPENAI_WRITER_MODEL: 'gpt-5.6-terra',
            OPENAI_IDEATION_MODEL: 'gpt-5.6-sol'
        })).toEqual({
            ready: true,
            writerModel: 'gpt-5.6-terra',
            ideationModel: 'gpt-5.6-sol',
            missing: []
        });
    });

    it('rejects malformed model identifiers before a paid provider request', () => {
        expect(getOpenAiBlogModelReadiness({
            OPENAI_WRITER_MODEL: 'valid-model',
            OPENAI_IDEATION_MODEL: 'model with spaces'
        })).toEqual({
            ready: false,
            writerModel: 'valid-model',
            ideationModel: '',
            missing: ['OPENAI_IDEATION_MODEL']
        });
    });
});

describe('formulaic writer guard', () => {
    it('flags the repeated scenario-heading template for retry', () => {
        const result = detectFormulaicDraft(`
            <article>
                <p>Đoạn mở đầu.</p>
                <h2>Chọn kịch bản gia đình phù hợp</h2>
                <p>Nội dung.</p>
            </article>
        `);
        expect(result.matched).toBe(true);
        expect(result.reasons).toContain('formulaic_scenario_heading');
    });

    it('allows an article with a topic-specific editorial heading', () => {
        const result = detectFormulaicDraft(`
            <article>
                <p>Đoạn mở đầu.</p>
                <h2>Đáy nồi nóng không đều: kiểm tra từ loại bếp</h2>
                <p>Nội dung.</p>
            </article>
        `);
        expect(result.matched).toBe(false);
    });
});
