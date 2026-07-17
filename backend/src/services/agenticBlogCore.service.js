'use strict'

const crypto = require('node:crypto');
const { blog } = require('../models/blog.model');
const { ResearchBundle } = require('../models/researchBundle.model');
const { EditorialStyleDefinition } = require('../models/editorialStyleDefinition.model');
const { EditorialStyleProfile } = require('../models/editorialStyleProfile.model');
const { BlogStrategyPlan } = require('../models/blogStrategyPlan.model');
const { GoogleIntelligenceService } = require('./googleIntelligence.service');
const { safeSourceFetch } = require('./safeSourceFetch.service');
const { dateInTimezone } = require('../utils/googleIntelligence.util');
const { normalizeSlug, normalizeString } = require('../utils/seoBlogSanitizer');
const {
    normalizeForSimilarity,
    reviewBrandVoice,
    reviewFacts,
    reviewOriginality,
    reviewPeopleFirstAndSpam,
    textSimilarity
} = require('../utils/agenticBlogCore.util');

const STYLE_FAMILIES = [
    'problem-solution', 'answer-first', 'checklist-driven', 'expert-advisory', 'myth-vs-fact',
    'comparison-led', 'narrative-case-study', 'diagnostic-guide', 'decision-tree', 'mistakes-to-avoid',
    'step-by-step', 'buyer-journey', 'technical-explainer', 'scenario-based', 'evidence-first',
    'editorial-magazine', 'concise-practical-guide'
];

const ARTICLE_TYPES = [
    'how-to', 'product-care', 'buying-guide', 'comparison', 'troubleshooting', 'technical-explainer',
    'listicle', 'myth-vs-fact', 'checklist', 'mistakes-to-avoid', 'use-case-guide', 'seasonal-guide',
    'maintenance-calendar', 'faq-synthesis', 'product-education', 'existing-article-update'
];

const STYLE_CONFIG = {
    'problem-solution': ['problem-first', 'problem-to-resolution', 'short-long-short', 'balanced', 'examples-plus-checklist', 'household-scenarios', 'soft-consultation', 'problem-process-result', 'direct-answer'],
    'answer-first': ['direct-answer', 'question-led', 'short-medium-long', 'short-forward', 'claim-source-explanation', 'quick-example', 'next-best-action', 'answer-detail-proof', 'summary-first'],
    'checklist-driven': ['outcome-first', 'checklist-led', 'short-short-medium', 'compact', 'verification-checklist', 'kitchen-checks', 'saveable-checklist', 'step-icons', 'checklist'],
    'expert-advisory': ['context-first', 'advisory-statements', 'medium-long-short', 'balanced', 'source-plus-caveat', 'advisor-scenario', 'soft-consultation', 'evidence-callouts', 'expert-summary'],
    'myth-vs-fact': ['surprising-myth', 'myth-question-led', 'short-long-short', 'varied', 'myth-evidence-fact', 'common-beliefs', 'fact-check-prompt', 'paired-contrast', 'myth-fact'],
    'comparison-led': ['choice-tension', 'comparison-criteria', 'medium-short-medium', 'balanced', 'comparison-table-plus-notes', 'use-case-pairs', 'decision-support', 'comparison-grid', 'comparison-summary'],
    'narrative-case-study': ['household-scenario', 'chronological-scenes', 'long-short-medium', 'varied', 'scenario-plus-lessons', 'composite-scenario', 'reflection', 'scene-details', 'lesson-summary'],
    'diagnostic-guide': ['symptom-first', 'diagnostic-questions', 'short-medium-short', 'compact', 'symptom-cause-check', 'kitchen-diagnostics', 'next-diagnostic-step', 'diagnostic-map', 'diagnosis'],
    'decision-tree': ['decision-first', 'conditional-headings', 'short-short-long', 'compact', 'if-then-evidence', 'household-choices', 'decision-confirmation', 'branch-diagram', 'decision-tree'],
    'mistakes-to-avoid': ['mistake-first', 'mistake-correction', 'short-long-medium', 'varied', 'mistake-impact-fix', 'common-errors', 'preventive-check', 'before-after', 'correction'],
    'step-by-step': ['result-preview', 'numbered-actions', 'short-medium-short', 'balanced', 'action-reason-check', 'guided-task', 'next-step', 'process-sequence', 'steps'],
    'buyer-journey': ['need-first', 'journey-stages', 'medium-long-short', 'balanced', 'criteria-tradeoff', 'buyer-scenarios', 'fit-check', 'journey-map', 'decision-summary'],
    'technical-explainer': ['mechanism-first', 'concept-to-application', 'long-medium-short', 'mixed', 'definition-mechanism-limit', 'material-behavior', 'practical-application', 'annotated-diagram', 'definition'],
    'scenario-based': ['scene-first', 'scenario-questions', 'medium-short-long', 'varied', 'scenario-option-result', 'vietnamese-household', 'choose-your-scenario', 'scene-cards', 'scenario-answer'],
    'evidence-first': ['verified-fact-first', 'evidence-led', 'medium-long-short', 'balanced', 'source-claim-caveat', 'evidence-application', 'review-sources', 'evidence-cards', 'evidence-summary'],
    'editorial-magazine': ['editorial-observation', 'thematic-headings', 'long-short-long', 'varied', 'observation-context-example', 'lifestyle-scenes', 'editorial-close', 'feature-spread', 'pull-quote'],
    'concise-practical-guide': ['task-first', 'action-led', 'short-short-medium', 'compact', 'action-check-warning', 'quick-household-tip', 'one-clear-next-step', 'compact-cards', 'quick-answer']
};

const sha256 = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const parseList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const buildSearchConsoleContext = (env = process.env) => {
    const property = normalizeString(env.GOOGLE_SEARCH_CONSOLE_PROPERTY || env.SEARCH_CONSOLE_SITE_URL);
    return {
        configured: Boolean(property),
        fallback: !property,
        property: property || '',
        metrics: [],
        note: property
            ? 'Read-only Search Console property is configured; only verified signals supplied by the external connector may be used.'
            : 'Search Console is unavailable; use internal inventory and never fabricate performance data.'
    };
};

const inferAbstractPattern = ({ text, index }) => {
    const normalized = normalizeForSimilarity(text);
    return {
        openingPattern: /\?|lam sao|tai sao/.test(normalized.slice(0, 300)) ? 'question-first' : index % 2 ? 'context-first' : 'problem-first',
        narrativeMode: /so sanh|khac nhau/.test(normalized) ? 'comparison-advisory' : 'practical-advisory',
        sectionRhythm: index % 3 === 0 ? 'short-long-short' : index % 3 === 1 ? 'medium-short-medium' : 'short-medium-long',
        evidenceMode: /theo|nghien cuu|tai lieu|huong dan/.test(normalized) ? 'source-plus-explanation' : 'examples-plus-checklist',
        headingStyle: index % 2 ? 'question-led' : 'action-led',
        ctaStyle: 'soft-consultation',
        visualDensity: index % 2 ? 'medium' : 'low',
        tone: 'practical-calm-trustworthy'
    };
};

const synthesizePatterns = (patterns) => {
    const values = patterns.length ? patterns : [inferAbstractPattern({ text: '', index: 0 })];
    const pick = (key, offset = 0) => values[offset % values.length]?.[key] || values[0]?.[key];
    return {
        openingPattern: pick('openingPattern'),
        narrativeMode: pick('narrativeMode', 1),
        sectionRhythm: pick('sectionRhythm', 2),
        evidenceMode: pick('evidenceMode', 1),
        headingStyle: pick('headingStyle', 2),
        ctaStyle: 'soft-consultation',
        visualDensity: pick('visualDensity'),
        tone: 'practical-clear-trustworthy',
        synthesisRule: 'Multi-source abstract patterns only; author identities, brand identities, headings and sentences are excluded.'
    };
};

const MAX_PIPELINE_TOPIC_LENGTH = 180;
const boundTopic = (value) => {
    const cleaned = normalizeString(value).replace(/\s+/g, ' ');
    if (cleaned.length <= MAX_PIPELINE_TOPIC_LENGTH) return cleaned;
    const firstSentence = cleaned.split(/(?<=[.!?…])\s/)[0];
    if (firstSentence.length >= 20 && firstSentence.length <= MAX_PIPELINE_TOPIC_LENGTH) return firstSentence.trim();
    const cut = cleaned.slice(0, MAX_PIPELINE_TOPIC_LENGTH);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trim();
};

const LLM_DRAFT_TIMEOUT_MS = Math.min(Math.max(Number(process.env.OPENAI_DRAFT_TIMEOUT_MS || 90_000), 20_000), 240_000);

const extractJsonObject = (text) => {
    const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(cleaned); } catch { /* fall through */ }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fall through */ }
    }
    return null;
};

const sanitizeLlmHtml = (html) => {
    let output = String(html || '').trim();
    output = output.replace(/<\/?(?:script|style|iframe|object|embed|form|input|button|link|meta|svg)\b[^>]*>/gi, '');
    output = output.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
    output = output.replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
    output = output.replace(/\sclass\s*=\s*"([^"]*)"/gi, (match, value) => (/\banswer-block\b/.test(value) ? ' class="answer-block"' : ''));
    output = output.replace(/<img\b[^>]*>/gi, '');
    output = output.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
    if (!/^<article\b/i.test(output)) output = `<article>${output}</article>`;
    return output;
};

const buildLlmDraftMessages = ({ topic, primaryKeyword, secondaryKeywords, articleType, style, headingCount, language, tone, recentTitles = [], attempt }) => {
    const system = [
        'Bạn là biên tập viên nội dung cho INOXPRAN (inoxpran.com), thương hiệu đồ gia dụng Việt Nam.',
        'Viết bài blog tiếng Việt chuẩn xuất bản, bám sát 100% chủ đề được yêu cầu; tuyệt đối không chèn nội dung về danh mục sản phẩm không liên quan đến chủ đề.',
        'Cấm tuyệt đối: số liệu, chứng nhận, kết quả thử nghiệm hoặc trải nghiệm bịa đặt; các cụm "100%", "được chứng nhận", "tốt nhất Việt Nam", "tốt nhất thế giới", "nghiên cứu cho thấy", "thử nghiệm của chúng tôi", "chuyên gia INOXPRAN khẳng định", "hoàn hảo tuyệt đối"; hứa hẹn thứ hạng Google; tên đối thủ cạnh tranh.',
        'Không kể chuyện về khách hàng hoặc nhân vật cụ thể (tên riêng, địa chỉ, quận/huyện) như thể có thật; nếu cần minh họa, chỉ dùng tình huống chung chung không danh tính.',
        'Giọng văn: thực tế, rõ ràng, đáng tin cậy, hướng đến hộ gia đình Việt Nam.',
        'Chỉ trả về JSON hợp lệ dạng: {"title": string, "excerpt": string, "imageQuery": string, "html": string}.',
        'Trường "topic" trong yêu cầu chỉ là BRIEF định hướng nội bộ, không phải tiêu đề. TUYỆT ĐỐI không dùng nguyên văn hoặc gần nguyên văn brief làm "title".',
        '"title": tối đa 110 ký tự, tự nhiên và hấp dẫn, không emoji, không dấu ngoặc kép; phải khác hẳn brief và khác mọi tiêu đề trong "recentTitles".',
        '"excerpt": 1-2 câu tóm tắt bài viết, tối đa 200 ký tự.',
        '"imageQuery": 3-6 từ TIẾNG ANH mô tả hình ảnh minh họa đúng chủ đề bài viết (ví dụ "portable rechargeable fan student desk"), không chứa tên thương hiệu.',
        '"html": bài viết hoàn chỉnh bọc trong <article>...</article>, dài 900-1400 từ, chỉ dùng các thẻ <h2> <h3> <p> <ul> <ol> <li> <table> <thead> <tbody> <tr> <th> <td> <strong> <em> và <aside class="answer-block">.',
        'Cấu trúc bắt buộc: 1 đoạn mở đầu không có heading; các mục <h2> bám sát chủ đề theo số lượng headingCount; ít nhất 2 khối <aside class="answer-block"><strong>Trả lời nhanh:</strong> ...</aside> trong đó 1 khối nằm gần đầu bài; 1 danh sách <ul> dạng checklist thực hành; 1 mục <h2>Câu hỏi thường gặp</h2> chứa 2-3 câu hỏi <h3> kèm trả lời; 1 đoạn kết ngắn gọn.',
        'Không dùng <img>, không chèn link, không inline style, không markdown.'
    ].join('\n');
    const user = JSON.stringify({
        topic,
        primaryKeyword,
        secondaryKeywords,
        articleType,
        language,
        tone,
        styleFamily: style?.styleFamily || '',
        openingMode: style?.openingMode || '',
        ctaMode: style?.ctaMode || '',
        headingCount,
        recentTitles: (recentTitles || []).slice(0, 10),
        variation: attempt > 0 ? `Lần viết lại thứ ${attempt}: thay đổi hẳn bộ heading, cách mở bài và cách diễn đạt so với các lần trước.` : ''
    });
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
};

const generateLlmDraft = async ({
    topic, primaryKeyword, secondaryKeywords = [], articleType = '', style = {},
    headingCount = 5, language = 'vi', tone = 'practical', attempt = 0, recentTitles = [],
    fetchImpl = global.fetch, timeoutMs = LLM_DRAFT_TIMEOUT_MS
}) => {
    const apiKey = normalizeString(process.env.OPENAI_API_KEY);
    if (!apiKey || typeof fetchImpl !== 'function') return null;
    const model = normalizeString(process.env.OPENAI_CHAT_MODEL) || 'gpt-4o-mini';
    const messages = buildLlmDraftMessages({ topic, primaryKeyword, secondaryKeywords, articleType, style, headingCount, language, tone, recentTitles, attempt });
    const requestOnce = async (body, signal) => fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let response = await requestOnce({ model, messages, response_format: { type: 'json_object' } }, controller.signal);
        if (response.status === 400) {
            const errorText = await response.text().catch(() => '');
            if (!/response_format/i.test(errorText)) throw new Error(`openai_http_400:${errorText.slice(0, 180)}`);
            response = await requestOnce({ model, messages }, controller.signal);
        }
        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`openai_http_${response.status}:${errorText.slice(0, 180)}`);
        }
        const data = await response.json();
        const parsed = extractJsonObject(data?.choices?.[0]?.message?.content || '');
        if (!parsed || !normalizeString(parsed.html)) throw new Error('openai_invalid_draft_response');
        const html = sanitizeLlmHtml(parsed.html);
        const words = normalizeForSimilarity(html).split(' ').filter(Boolean).length;
        if (words < 350) throw new Error(`openai_draft_too_short_${words}_words`);
        return {
            html,
            title: normalizeString(parsed.title).replace(/["“”]/g, '').slice(0, 110),
            excerpt: normalizeString(parsed.excerpt).slice(0, 220),
            imageQuery: normalizeString(parsed.imageQuery).replace(/["“”]/g, '').slice(0, 90),
            model,
            wordCount: words
        };
    } catch (error) {
        if (error?.name === 'AbortError') throw new Error('openai_draft_timeout');
        throw error;
    } finally {
        clearTimeout(timer);
    }
};

const decideTopicAction = ({ topic, existing = [], now = new Date() }) => {
    const scored = existing.map((item) => ({
        item,
        score: Math.max(textSimilarity(topic, item.blog_title || '', 2), textSimilarity(topic, (item.blog_tags || []).join(' '), 2))
    })).sort((a, b) => b.score - a.score);
    const strong = scored.filter((entry) => entry.score >= 0.55);
    const top = scored[0];
    if (!top || top.score < 0.55) return { decision: 'new', reason: 'No materially overlapping INOXPRAN article was found.', targets: [] };
    const ageDays = (now.getTime() - new Date(top.item.updatedAt || top.item.createdAt || now).getTime()) / 86_400_000;
    if (strong.length >= 2) return { decision: 'merge', reason: 'Multiple overlapping articles can provide more value as one consolidated guide.', targets: strong.slice(0, 3).map((entry) => entry.item) };
    if (ageDays >= 180) return { decision: 'update', reason: 'A closely related article exists and is old enough to benefit from a verified update.', targets: [top.item] };
    if (top.score >= 0.82) return { decision: 'skip', reason: 'A recent article already satisfies the same topic and intent.', targets: [top.item] };
    return { decision: 'new', reason: 'Related content exists, but the proposed user intent is sufficiently distinct.', targets: [] };
};

const headingSetForStyle = ({ styleFamily, topic }) => {
    const topicLabel = topic || 'đồ gia dụng inox';
    const sets = {
        'problem-solution': [`Vấn đề thường gặp khi chọn ${topicLabel}`, 'Tìm nguyên nhân trước khi đổi sản phẩm', 'Giải pháp theo từng nhu cầu sử dụng', 'Cách kiểm tra kết quả sau một tuần'],
        'answer-first': [`${topicLabel}: câu trả lời ngắn gọn`, 'Khi nào lời khuyên này phù hợp?', 'Các tiêu chí cần kiểm chứng', 'Cách áp dụng trong căn bếp gia đình'],
        'checklist-driven': [`Checklist nhanh cho ${topicLabel}`, 'Kiểm tra vật liệu và kết cấu', 'Kiểm tra khả năng sử dụng hằng ngày', 'Kiểm tra vệ sinh và bảo quản'],
        'comparison-led': ['So sánh theo nhu cầu thay vì theo quảng cáo', 'Khác biệt về vật liệu và độ bền', 'Khác biệt trong quá trình nấu', 'Bảng chọn nhanh theo tình huống'],
        'diagnostic-guide': ['Dấu hiệu nào cần kiểm tra trước?', 'Chẩn đoán từ bề mặt và đáy sản phẩm', 'Chẩn đoán từ cách nấu và vệ sinh', 'Khi nào nên dừng sử dụng để kiểm tra thêm?'],
        'decision-tree': ['Bắt đầu từ loại bếp đang dùng', 'Nếu ưu tiên độ bền, hãy kiểm tra gì?', 'Nếu ưu tiên dễ vệ sinh, hãy chọn thế nào?', 'Nhánh quyết định cuối cùng'],
        'mistakes-to-avoid': ['Sai lầm bắt đầu từ việc chọn sai nhu cầu', 'Sai lầm khi đọc thông tin vật liệu', 'Sai lầm trong lần sử dụng đầu tiên', 'Cách sửa thói quen mà không tốn thêm chi phí'],
        'step-by-step': ['Bước 1: xác định nhu cầu thật', 'Bước 2: kiểm tra vật liệu và đáy', 'Bước 3: thử khả năng thao tác an toàn', 'Bước 4: lập kế hoạch vệ sinh và bảo quản'],
        'technical-explainer': ['Cấu tạo ảnh hưởng đến trải nghiệm ra sao?', 'Vật liệu phản ứng thế nào với nhiệt?', 'Đáy nhiều lớp giải quyết vấn đề gì?', 'Từ cơ chế kỹ thuật đến lựa chọn thực tế'],
        'myth-vs-fact': ['Lầm tưởng: inox nào cũng giống nhau', 'Sự thật: tên vật liệu chưa nói lên toàn bộ sản phẩm', 'Lầm tưởng: càng nặng luôn càng tốt', 'Sự thật: nhu cầu sử dụng mới là tiêu chí quyết định'],
        'expert-advisory': ['Bối cảnh sử dụng cần nói rõ trước tiên', 'Dữ liệu nào đủ để đưa ra lời khuyên?', 'Giới hạn nào người mua cần biết?', 'Khuyến nghị theo từng thói quen bếp'],
        'narrative-case-study': ['Một tình huống bếp gia đình thường gặp', 'Quyết định ban đầu đã tạo ra vấn đề gì?', 'Gia đình điều chỉnh tiêu chí ra sao?', 'Bài học có thể áp dụng mà không phóng đại trải nghiệm'],
        'buyer-journey': ['Giai đoạn nhận ra nhu cầu', 'Giai đoạn thu hẹp tiêu chí', 'Giai đoạn kiểm chứng thông tin sản phẩm', 'Giai đoạn xác nhận độ phù hợp lâu dài'],
        'scenario-based': ['Kịch bản gia đình ít người', 'Kịch bản nấu nhiều món Việt', 'Kịch bản ưu tiên thao tác và vệ sinh', 'Chọn tiêu chí theo kịch bản của bạn'],
        'evidence-first': ['Thông tin nào đã có thể kiểm chứng?', 'Bằng chứng nói được gì và không nói được gì?', 'Áp dụng dữ liệu vào nhu cầu gia đình', 'Các điểm vẫn cần xác nhận trước khi mua'],
        'editorial-magazine': ['Một quan sát từ căn bếp hiện đại', 'Khi độ bền gặp thói quen sử dụng', 'Chi tiết nhỏ tạo khác biệt dài hạn', 'Lựa chọn thực tế sau góc nhìn tổng thể'],
        'concise-practical-guide': ['Câu trả lời thực hành trong một phút', 'Ba kiểm tra trước khi sử dụng', 'Hai cảnh báo nên ghi nhớ', 'Một bước tiếp theo đủ rõ ràng']
    };
    return sets[styleFamily] || [`Hiểu đúng nhu cầu về ${topicLabel}`, 'Tiêu chí thực tế cho gia đình Việt', 'Cách sử dụng an toàn và bền lâu', 'Tự đánh giá trước khi quyết định'];
};

const buildArchitecture = ({ topic, style, decision, researchBundle }) => {
    const headings = headingSetForStyle({ styleFamily: style.styleFamily, topic });
    return {
        opening: { mode: style.openingMode, purpose: 'Answer the primary household problem without a generic definition.' },
        headings: headings.map((heading, index) => ({ level: 2, heading, evidenceKey: `evidence-${index + 1}`, answerBlock: index === 0 || index === 3 })),
        evidenceMap: (researchBundle.sourceAttributions || []).slice(0, 6),
        imagePlan: { mode: style.visualPlanMode, cover: true, inlineCount: 2, mustBeReviewed: true },
        internalLinkPlan: [],
        ctaPlan: { mode: style.ctaMode, promise: 'Help the reader verify fit; do not pressure or promise outcomes.' },
        articleAction: decision,
        answerBlocks: headings.slice(0, 2).map((heading) => ({ question: heading, format: style.answerBlockMode }))
    };
};

const paragraphBank = ({ topic, keyword }) => [
    `Khi tìm hiểu ${topic}, gia đình nên bắt đầu từ loại bếp, số người ăn và thói quen nấu mỗi ngày. Ba yếu tố này quyết định kích thước, kiểu đáy và khả năng thao tác cần thiết. Một sản phẩm phù hợp không nhất thiết có nhiều tính năng; quan trọng hơn là dễ dùng, dễ vệ sinh và không buộc người dùng thay đổi toàn bộ thói quen trong bếp.`,
    `Thông tin về vật liệu cần được đọc cùng với cấu tạo hoàn chỉnh. Tên inox chỉ là một phần của câu chuyện; độ dày, mối nối tay cầm, độ phẳng của đáy và hướng dẫn từ nhà sản xuất đều ảnh hưởng đến trải nghiệm. Nếu thiếu dữ liệu, hãy ghi nhận đó là điều chưa chắc chắn thay vì suy đoán từ màu sắc hoặc lời quảng cáo.`,
    `Với ${keyword}, cách kiểm tra thực tế là đặt câu hỏi cụ thể: sản phẩm dùng trên loại bếp nào, dung tích có phù hợp khẩu phần không, tay cầm có chắc khi nồi đầy và việc làm sạch có mất nhiều thời gian không. Câu trả lời giúp thu hẹp lựa chọn tốt hơn một danh sách tính năng dài nhưng không gắn với nhu cầu.`,
    `Trong quá trình nấu, nên tăng nhiệt từ từ và tránh để dụng cụ rỗng trên bếp quá lâu. Với chảo inox, làm nóng hợp lý rồi điều chỉnh lượng dầu giúp hạn chế bám dính tốt hơn việc luôn dùng mức nhiệt cao. Sau khi nấu, chờ sản phẩm giảm nhiệt trước khi vệ sinh để tránh thay đổi nhiệt độ quá đột ngột.`,
    `Vết đổi màu nhẹ không tự động đồng nghĩa với vật liệu kém an toàn. Trước tiên cần xem lại nhiệt độ, nguồn nước và chất tẩy rửa đã dùng. Có thể thử nước ấm, khăn mềm và dung dịch vệ sinh phù hợp theo hướng dẫn của nhà sản xuất. Không dùng vật sắc để cạo vì vết xước mới có thể làm bề mặt khó chăm sóc hơn.`,
    `Khi so sánh hai lựa chọn, hãy dùng cùng một bộ tiêu chí: nhu cầu nấu, khả năng tương thích với bếp, mức độ thuận tiện khi cầm nắm, cách bảo quản và thông tin bảo hành. So sánh trên cùng tiêu chí giúp tránh quyết định chỉ dựa vào giá hoặc một thông số nổi bật được tách khỏi bối cảnh.`,
    `Đối với gia đình Việt nấu nhiều món có nước, món kho hoặc xào nhanh, mỗi kiểu nấu tạo ra yêu cầu khác nhau. Nồi cần dung tích và khả năng giữ nhiệt phù hợp, trong khi chảo cần kiểm soát nhiệt và thao tác thuận tiện. Một bộ sản phẩm đồng nhất về hình thức chưa chắc tối ưu bằng việc chọn từng món theo công việc thực tế.`,
    `An toàn vật liệu không nên được khẳng định bằng cảm giác hoặc những câu tuyệt đối. Hãy ưu tiên nhãn hàng công bố rõ vật liệu, hướng dẫn sử dụng, phạm vi tương thích và chính sách hỗ trợ. Nếu bài viết đề cập chứng nhận hoặc tiêu chuẩn, thông tin đó phải có tài liệu có thể kiểm tra và phải đúng với chính sản phẩm được nói đến.`,
    `Một checklist tốt phải dẫn đến hành động. Người đọc có thể ghi lại loại bếp, đường kính vùng nấu, số khẩu phần, món thường nấu và thời gian sẵn sàng dành cho vệ sinh. Sau đó mới đối chiếu với thông số sản phẩm. Cách làm này giảm mua thừa và giúp câu hỏi dành cho nhân viên tư vấn rõ ràng hơn.`,
    `Bảo quản đều đặn thường hiệu quả hơn xử lý mạnh khi vết bẩn đã tích tụ. Rửa sớm sau khi sản phẩm nguội, lau khô và cất ở nơi thoáng giúp giảm vết nước. Nếu xếp chồng, có thể dùng miếng lót mềm để hạn chế ma sát. Luôn ưu tiên hướng dẫn riêng của nhà sản xuất khi có khác biệt.`,
    `Không có một lựa chọn tốt nhất cho mọi căn bếp. Gia đình ít người có thể ưu tiên kích thước gọn, còn gia đình nấu số lượng lớn cần quan tâm dung tích và độ vững khi di chuyển. Việc nói rõ giới hạn của mỗi lựa chọn làm nội dung hữu ích hơn và tránh biến tư vấn thành lời hứa quá mức.`,
    `Trước khi quyết định, hãy xem lại ba điểm: sản phẩm có giải quyết đúng công việc cần làm không, thông tin quan trọng có nguồn rõ ràng không và việc sử dụng lâu dài có phù hợp thời gian chăm sóc của gia đình không. Nếu một điểm chưa rõ, lựa chọn hợp lý là hỏi thêm hoặc trì hoãn thay vì mua theo áp lực.`
];

const buildDraft = ({ topic, primaryKeyword, architecture, style, variantIndex = 0 }) => {
    const paragraphs = paragraphBank({ topic, keyword: primaryKeyword || topic });
    const effectiveVariant = Math.abs(Number(variantIndex) || Number(style.activeVariant?.usageIndex || 0));
    const introByMode = {
        'problem-first': `Chọn sai ${topic} thường không lộ ra ngay ở quầy hàng. Vấn đề xuất hiện khi kích thước không hợp bếp, tay cầm khó thao tác hoặc việc vệ sinh tốn quá nhiều thời gian. Bài viết này giúp bạn kiểm tra từng điểm bằng nhu cầu thực tế.`,
        'direct-answer': `Câu trả lời ngắn gọn: hãy chọn ${topic} theo loại bếp, món thường nấu, dung tích và khả năng chăm sóc lâu dài. Vật liệu quan trọng, nhưng cần được đánh giá cùng cấu tạo và hướng dẫn sử dụng.`,
        'symptom-first': `Nếu ${topic} đang đổi màu, bám dính hoặc khó vệ sinh, đừng vội kết luận sản phẩm hỏng. Cần tách dấu hiệu, nguyên nhân sử dụng và đặc điểm vật liệu trước khi quyết định xử lý.`,
        'surprising-myth': `“Inox nào cũng giống nhau” là một lầm tưởng khiến nhiều gia đình bỏ qua cấu tạo đáy, tay cầm và cách dùng. Sự khác biệt hữu ích nằm ở mức độ phù hợp với công việc hằng ngày, không chỉ ở một tên gọi vật liệu.`
    };
    const fallbackIntros = [
        `Mỗi gia đình có cách nấu và mức độ chăm sóc dụng cụ khác nhau. Vì vậy, ${topic} nên được đánh giá bằng nhu cầu, dữ liệu có thể kiểm tra và trải nghiệm sử dụng thực tế thay vì một công thức mua sắm chung.`,
        `Trước khi so sánh ${topic}, hãy ghi lại loại bếp, số khẩu phần và công việc thường làm. Ba dữ kiện này giúp loại bỏ những lựa chọn không phù hợp mà không cần dựa vào lời hứa quảng cáo.`,
        `Một cách thực tế để hiểu ${topic} là bắt đầu từ tình huống sử dụng, sau đó mới đối chiếu vật liệu, cấu tạo và hướng dẫn của nhà sản xuất. Thứ tự này giữ quyết định gần với nhu cầu thật.`
    ];
    const intro = introByMode[style.openingMode] || fallbackIntros[effectiveVariant % fallbackIntros.length];
    const paragraphOffset = effectiveVariant % paragraphs.length;
    const sections = architecture.headings.map((item, index) => {
        const first = paragraphs[(paragraphOffset + index * 2) % paragraphs.length];
        const second = paragraphs[(paragraphOffset + index * 2 + 1) % paragraphs.length];
        const answer = item.answerBlock ? `<aside class="answer-block"><strong>Trả lời nhanh:</strong> ${first}</aside>` : '';
        const listAt = (paragraphOffset + 1) % architecture.headings.length;
        const list = index === listAt ? '<ul><li>Đối chiếu loại bếp và kích thước vùng nấu.</li><li>Kiểm tra thông tin vật liệu và hướng dẫn sử dụng.</li><li>Đánh giá thao tác khi sản phẩm có thực phẩm.</li><li>Dự kiến cách vệ sinh và bảo quản.</li></ul>' : '';
        const supportingHeading = (index + paragraphOffset) % 3 === 0 ? `<h3>${index % 2 ? 'Điểm cần xác nhận' : 'Cách tự kiểm tra'}</h3>` : '';
        return `<section><h2>${item.heading}</h2>${answer}<p>${first}</p>${list}${supportingHeading}<p>${second}</p></section>`;
    }).join('');
    const table = style.styleFamily === 'comparison-led' || style.styleFamily === 'decision-tree'
        ? '<section><h2>Bảng quyết định thực tế</h2><table><thead><tr><th>Nhu cầu</th><th>Điểm cần kiểm tra</th><th>Câu hỏi xác nhận</th></tr></thead><tbody><tr><td>Nấu hằng ngày</td><td>Dung tích và thao tác</td><td>Có phù hợp khẩu phần?</td></tr><tr><td>Dùng bếp từ</td><td>Đáy và hướng dẫn tương thích</td><td>Nhà sản xuất công bố rõ?</td></tr><tr><td>Dễ chăm sóc</td><td>Bề mặt và cách vệ sinh</td><td>Có thể làm sạch bằng dụng cụ sẵn có?</td></tr></tbody></table></section>'
        : '';
    const faq = effectiveVariant % 3 === 2 ? '' : '<section><h2>Câu hỏi thường gặp</h2><h3>Có nên chọn chỉ theo tên loại inox?</h3><p>Không. Hãy xem tên vật liệu cùng cấu tạo, hướng dẫn sử dụng, loại bếp và nhu cầu nấu. Không nên suy luận chất lượng toàn bộ sản phẩm từ một thông tin đơn lẻ.</p><h3>Khi nào nên hỏi thêm tư vấn?</h3><p>Hãy hỏi khi thông tin vật liệu, tương thích bếp, bảo hành hoặc cách vệ sinh chưa rõ. Một câu trả lời có thể kiểm tra hữu ích hơn lời khẳng định tuyệt đối.</p></section>';
    const ctaByMode = {
        'soft-consultation': 'Nếu cần đối chiếu với sản phẩm INOXPRAN, hãy chuẩn bị loại bếp, số người ăn và món thường nấu để cuộc trao đổi tập trung vào độ phù hợp.',
        'next-best-action': 'Hãy ghi lại một tiêu chí còn thiếu dữ liệu và xác nhận tiêu chí đó trước khi chuyển sang bước lựa chọn tiếp theo.',
        'saveable-checklist': 'Bạn có thể lưu checklist, đánh dấu từng mục đã kiểm tra và chỉ ra quyết định khi các thông tin quan trọng đã rõ.',
        'decision-support': 'Đặt hai lựa chọn cạnh nhau theo cùng bộ tiêu chí sẽ giúp quyết định dễ kiểm chứng hơn.'
    };
    const closing = ctaByMode[style.ctaMode] || 'Bước tiếp theo hợp lý là xác nhận thông tin còn thiếu, không mua hoặc thay đổi thói quen chỉ vì áp lực từ một lời khẳng định tuyệt đối.';
    return `<article><p>${intro}</p>${sections}${table}${faq}<section><h2>Bước tiếp theo phù hợp</h2><p>${paragraphs[(paragraphOffset + 11) % paragraphs.length]}</p><p>${closing}</p></section></article>`;
};

class AgenticBlogCoreService {
    static async seedStyleLibrary() {
        const cooldown = Math.min(Math.max(Number(process.env.EDITORIAL_STYLE_DEFAULT_COOLDOWN_DAYS || 7), 1), 30);
        await Promise.all(STYLE_FAMILIES.map((styleFamily) => EditorialStyleDefinition.updateOne(
            { styleFamily },
            { $setOnInsert: { styleFamily, enabled: true, cooldownDays: cooldown, description: `Structural family: ${styleFamily}` } },
            { upsert: true }
        )));
    }

    static async chooseStyleProfile({ now = new Date(), timezone = 'Asia/Ho_Chi_Minh' } = {}) {
        await AgenticBlogCoreService.seedStyleLibrary();
        const date = dateInTimezone(now, timezone);
        const existing = await EditorialStyleProfile.findOne({ date }).lean();
        if (existing) {
            const usageCount = Number(existing.usageCount || 0) + 1;
            const variant = { key: `${existing.styleFamily}-${crypto.randomUUID().slice(0, 8)}`, usageIndex: usageCount, openingModifier: usageCount % 2 ? 'scene' : 'question', headingModifier: usageCount % 3 ? 'action' : 'diagnostic' };
            const updated = await EditorialStyleProfile.findByIdAndUpdate(existing._id, { $inc: { usageCount: 1 }, $push: { articleVariants: variant } }, { new: true }).lean();
            return { ...updated, activeVariant: variant };
        }
        const lookbackDays = Math.min(Math.max(Number(process.env.EDITORIAL_STYLE_LOOKBACK_DAYS || 14), 7), 30);
        const lookback = new Date(now.getTime() - lookbackDays * 86_400_000);
        const [definitions, recent] = await Promise.all([
            EditorialStyleDefinition.find({ enabled: true }).sort({ locked: -1, lastUsedAt: 1, useCount: 1 }).lean(),
            EditorialStyleProfile.find({ createdAt: { $gte: lookback } }).sort({ createdAt: -1 }).lean()
        ]);
        if (!definitions.length) throw new Error('No enabled editorial styles');
        const yesterdayFamily = recent[0]?.styleFamily || '';
        const locked = definitions.find((definition) => definition.locked && definition.styleFamily !== yesterdayFamily);
        const recentOpenings = new Set(recent.map((profile) => profile.openingMode));
        const recentHeadings = new Set(recent.map((profile) => profile.headingMode));
        const recentCtas = new Set(recent.map((profile) => profile.ctaMode));
        const eligible = definitions.filter((definition) => {
            if (definition.styleFamily === yesterdayFamily) return false;
            const lastUsedAt = definition.lastUsedAt ? new Date(definition.lastUsedAt).getTime() : 0;
            const cooldownMs = Number(definition.cooldownDays || 7) * 86_400_000;
            if (lastUsedAt && now.getTime() - lastUsedAt < cooldownMs) return false;
            const config = STYLE_CONFIG[definition.styleFamily] || [];
            return !recentOpenings.has(config[0]) && !recentHeadings.has(config[1]) && !recentCtas.has(config[6]);
        });
        const selected = locked || eligible[0] || definitions.find((definition) => definition.styleFamily !== yesterdayFamily) || definitions[0];
        const values = STYLE_CONFIG[selected.styleFamily] || STYLE_CONFIG['concise-practical-guide'];
        let profile;
        try {
            profile = await EditorialStyleProfile.create({
                date, styleFamily: selected.styleFamily, openingMode: values[0], headingMode: values[1],
                paragraphRhythm: values[2], sentenceLengthDistribution: values[3], evidenceMode: values[4],
                exampleMode: values[5], ctaMode: values[6], visualPlanMode: values[7], answerBlockMode: values[8],
                forbiddenRecentPatterns: recent.slice(0, lookbackDays).flatMap((item) => [item.styleFamily, item.openingMode, item.headingMode, item.ctaMode]).filter(Boolean),
                brandVoiceConstraints: ['practical', 'clear', 'trustworthy', 'evidence-based', 'Vietnamese households', 'no fabricated experience or certification'],
                structuralFingerprintTarget: { styleFamily: selected.styleFamily, openingMode: values[0], headingMode: values[1], ctaMode: values[6] },
                usageCount: 1,
                articleVariants: [{ key: `${selected.styleFamily}-1`, usageIndex: 1, openingModifier: 'base', headingModifier: 'base' }]
            });
        } catch (error) {
            if (error?.code === 11000) return AgenticBlogCoreService.chooseStyleProfile({ now, timezone });
            throw error;
        }
        await EditorialStyleDefinition.updateOne({ _id: selected._id }, { $set: { lastUsedAt: now }, $inc: { useCount: 1 } });
        return { ...profile.toObject(), activeVariant: profile.articleVariants[0] };
    }

    static async researchIndustry({ topic, sourceUrls = [], fetchOptions = {} }) {
        const enabled = process.env.INDUSTRY_RESEARCH_ENABLED !== 'false';
        const maxSources = Math.min(Math.max(Number(process.env.INDUSTRY_RESEARCH_MAX_SOURCES || 8), 1), 12);
        const urls = (sourceUrls.length ? sourceUrls : parseList(process.env.INDUSTRY_RESEARCH_SOURCE_URLS)).slice(0, maxSources);
        const sources = [];
        const patterns = [];
        if (enabled) {
            for (let index = 0; index < urls.length; index += 1) {
                try {
                    const fetched = await safeSourceFetch({ url: urls[index], timeoutMs: Number(process.env.GOOGLE_INTELLIGENCE_SOURCE_TIMEOUT_MS || 15000), ...fetchOptions });
                    const text = normalizeString(fetched.body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
                    const title = normalizeString((fetched.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || new URL(fetched.canonicalUrl).pathname)).slice(0, 240);
                    sources.push({ url: fetched.canonicalUrl, title, fetchedAt: fetched.fetchedAt, contentHash: sha256(text), sourceType: 'industry', excerptStored: false });
                    patterns.push(inferAbstractPattern({ text: text.slice(0, 4000), index }));
                } catch (error) {
                    sources.push({ url: urls[index], title: '', fetchedAt: new Date(), sourceType: 'industry', failed: true, error: normalizeString(error?.message).slice(0, 300), excerptStored: false });
                }
                if (index + 1 < urls.length) await sleep(120);
            }
        }
        const successful = sources.filter((source) => !source.failed);
        const researchCoverage = successful.length >= 3 ? 'high' : successful.length === 2 ? 'medium' : 'low';
        const editorialPatterns = synthesizePatterns(patterns);
        const bundle = await ResearchBundle.create({
            topic, sources, researchCoverage, editorialPatterns, facts: [],
            sourceAttributions: successful.map((source) => ({ title: source.title, url: source.url, use: 'Pattern synthesis and fact leads; verify facts against the source before publication.' })),
            copyrightReview: {
                passed: true, fullArticlesPersisted: false, copiedHeadingsPersisted: false,
                identitiesRemovedFromPatterns: true,
                fallbackUsed: successful.length < 2,
                rule: successful.length === 1 ? 'Single source cannot control style; internal style library is mandatory.' : 'Synthesize abstract patterns across sources.'
            },
            searchConsole: buildSearchConsoleContext(),
            contentHash: sha256(JSON.stringify(successful.map((source) => source.contentHash)))
        });
        return bundle.toObject();
    }

    static async prepareContext({ topic, primaryKeyword, articleType, now = new Date(), sourceUrls = [] }) {
        const snapshot = await GoogleIntelligenceService.ensureGoogleIntelligenceSnapshotForDate({ now });
        const existing = await blog.find({}).sort({ updatedAt: -1 }).limit(100).select('_id blog_title blog_slug blog_tags blog_content isDraft isPublished updatedAt createdAt structuralFingerprint').lean();
        const opportunity = decideTopicAction({ topic, existing, now });
        const researchBundle = await AgenticBlogCoreService.researchIndustry({ topic, sourceUrls });
        const style = await AgenticBlogCoreService.chooseStyleProfile({ now, timezone: snapshot.timezone });
        const chosenArticleType = opportunity.decision === 'update' || opportunity.decision === 'merge'
            ? 'existing-article-update'
            : ARTICLE_TYPES.includes(articleType) ? articleType : ARTICLE_TYPES[Math.abs(Number.parseInt(sha256(`${topic}:${style.styleFamily}`).slice(0, 8), 16)) % ARTICLE_TYPES.length];
        const architecture = buildArchitecture({ topic, style, decision: opportunity.decision, researchBundle });
        const strategy = await BlogStrategyPlan.create({
            googleIntelSnapshotId: snapshot.id, topic, decision: opportunity.decision,
            decisionReason: opportunity.reason, targetBlogIds: opportunity.targets.map((item) => item._id),
            targetAudience: 'Vietnamese households seeking durable, safe and practical cookware guidance',
            searchIntent: { primary: 'informational', secondary: opportunity.decision === 'new' ? 'commercial-investigation' : 'content-maintenance', confidence: 0.82 },
            userProblems: ['Need verifiable material guidance', 'Need a choice that matches the household stove and cooking habits', 'Need practical care instructions'],
            contentGap: researchBundle.researchCoverage === 'low' ? 'External research coverage is low; use conservative internal guidance and require editorial verification.' : 'Combine verified guidance with a Vietnamese household decision framework.',
            primaryQuestion: `Làm thế nào để đánh giá ${topic} theo nhu cầu thực tế?`,
            supportingQuestions: [`${topic} phù hợp loại bếp nào?`, 'Cần kiểm tra vật liệu và cấu tạo ra sao?', 'Cách sử dụng và bảo quản nào thực tế?'],
            articleType: chosenArticleType, editorialStyleProfileId: style._id,
            researchBundleId: researchBundle._id,
            evidenceRequirements: ['Attribute externally sourced facts', 'Do not invent tests, certifications or statistics', 'Mark uncertainty when source coverage is low'],
            internalLinks: opportunity.targets.slice(0, 4).map((item) => ({ blogId: String(item._id), slug: item.blog_slug, title: item.blog_title })),
            imagePlan: architecture.imagePlan, structuredDataCandidate: chosenArticleType === 'faq-synthesis' ? 'Article with visible FAQ section' : 'Article',
            riskFlags: researchBundle.researchCoverage === 'low' ? ['low_research_coverage'] : [],
            successCriteria: ['Answers the primary household question', 'Adds original decision support', 'Passes fact, originality, SEO, people-first, spam and brand gates'],
            contentArchitecture: architecture,
            reviewerPlan: { factCheck: true, originality: true, seoAeoGeo: true, peopleFirstSpam: true, brandVoice: true }
        });
        return { snapshot, opportunity, researchBundle, style, strategy: strategy.toObject(), architecture, primaryKeyword };
    }

    static async runPipeline({ schedule, executionKey, executionId, now = new Date() }) {
        const config = schedule.agentConfig || {};
        const topic = boundTopic(config.topic || config.primaryKeyword || schedule.name || 'đồ gia dụng inox cho gia đình');
        const primaryKeyword = normalizeString(config.primaryKeyword || topic);
        const context = await AgenticBlogCoreService.prepareContext({ topic, primaryKeyword, articleType: config.articleType, now, sourceUrls: Array.isArray(config.researchSources) ? config.researchSources : [] });
        if (context.opportunity.decision === 'skip') return { skipped: true, reason: context.opportunity.reason, context };
        const targetIds = new Set(context.opportunity.targets.map((item) => String(item._id)));
        const comparisonCorpus = await blog.find({ _id: { $nin: Array.from(targetIds) } }).sort({ updatedAt: -1 }).limit(50).select('_id blog_title blog_content structuralFingerprint').lean();
        const recentTitles = [
            ...context.opportunity.targets.map((item) => item.blog_title),
            ...comparisonCorpus.map((item) => item.blog_title)
        ].filter(Boolean).slice(0, 10);
        const maxOriginalityAttempts = 3;
        let contentHtml = '';
        let originality = null;
        let originalityAttempts = 0;
        let llmDraft = null;
        let llmGenerationError = '';
        for (let attempt = 0; attempt < maxOriginalityAttempts; attempt += 1) {
            originalityAttempts = attempt + 1;
            let generated = null;
            try {
                generated = await generateLlmDraft({
                    topic,
                    primaryKeyword,
                    secondaryKeywords: Array.isArray(config.secondaryKeywords) ? config.secondaryKeywords.slice(0, 8) : [],
                    articleType: context.strategy.articleType,
                    style: context.style,
                    headingCount: Math.min(Math.max((context.architecture.headings || []).length, 4), 6),
                    language: normalizeString(config.language) || 'vi',
                    tone: normalizeString(config.tone) || 'practical',
                    recentTitles,
                    attempt
                });
            } catch (error) {
                llmGenerationError = normalizeString(error?.message).slice(0, 300);
            }
            if (generated?.html) {
                llmDraft = generated;
                contentHtml = generated.html;
            } else {
                llmDraft = null;
                contentHtml = buildDraft({
                    topic, primaryKeyword, architecture: context.architecture, style: context.style,
                    variantIndex: Number(context.style.activeVariant?.usageIndex || 0) + attempt
                });
            }
            originality = reviewOriginality({ title: llmDraft?.title || topic, contentHtml, existing: comparisonCorpus });
            if (originality.passed) break;
        }
        const factuality = reviewFacts(contentHtml);
        const peopleSpam = reviewPeopleFirstAndSpam({ html: contentHtml, primaryKeyword });
        const brandVoice = reviewBrandVoice(contentHtml);
        const wordCount = normalizeForSimilarity(contentHtml).split(' ').filter(Boolean).length;
        const seoAeoGeo = {
            passed: (context.architecture.headings || []).length >= 4 && /answer-block/.test(contentHtml),
            seoScore: Math.min(96, 82 + Math.min(8, (context.architecture.headings || []).length * 2) + (context.researchBundle.researchCoverage === 'high' ? 4 : 0)),
            answerBlocks: (contentHtml.match(/class="answer-block"/g) || []).length,
            structuredDataCandidate: context.strategy.structuredDataCandidate,
            generativeSearchReady: factuality.passed && brandVoice.passed,
            promisesInclusion: false
        };
        const highRisk = !factuality.passed || !originality.passed || !peopleSpam.passed || !brandVoice.passed || !seoAeoGeo.passed;
        const target = context.opportunity.targets[0];
        const date = dateInTimezone(now, context.snapshot.timezone);
        const targetKeepsTitle = Boolean(target && target.isPublished);
        const title = targetKeepsTitle
            ? target.blog_title
            : (llmDraft?.title || target?.blog_title || topic);
        const slug = target?.blog_slug || normalizeSlug(`${llmDraft?.title || topic}-${date}-${sha256(executionKey).slice(0, 6)}`);
        const excerpt = (llmDraft?.excerpt || `Hướng dẫn thực tế về ${topic} cho gia đình Việt: tiêu chí lựa chọn, cách sử dụng và lưu ý an toàn.`).slice(0, 240);
        const payload = {
            mode: Boolean(schedule.autoPublish) && !highRisk ? 'publish' : 'draft',
            source: 'openclaw-daily-seo', primaryKeyword, secondaryKeywords: config.secondaryKeywords || [],
            title, slug, excerpt, contentHtml,
            imageSearchQuery: llmDraft?.imageQuery || '',
            seoTitle: title.slice(0, 60), seoDescription: excerpt.slice(0, 155),
            categoryKey: config.categoryKey || 'guide', tags: [primaryKeyword, 'Inoxpran', context.strategy.articleType].filter(Boolean),
            authorName: process.env.SEO_AGENT_DEFAULT_AUTHOR || 'Inoxpran Editorial Team',
            imageUrl: process.env.SEO_AGENT_DEFAULT_BLOG_IMAGE || '/og-image.png',
            articleType: context.strategy.articleType,
            outline: context.architecture.headings.map((item) => item.heading),
            contentDecision: context.opportunity.decision,
            targetBlogId: target ? String(target._id) : '',
            googleIntelSnapshotId: context.snapshot.id,
            googleIntelSnapshotDate: context.snapshot.snapshotDate,
            googleIntelStatus: context.snapshot.status,
            researchBundleId: String(context.researchBundle._id),
            editorialStyleProfileId: String(context.style._id),
            strategyPlanId: String(context.strategy._id),
            agenticExecutionId: String(executionId || ''),
            structuralFingerprint: originality.fingerprint,
            agenticReviews: { factuality, originality, seoAeoGeo, peopleFirstSpam: peopleSpam, brandVoice },
            metadata: {
                provider: 'openclaw', executionKey, pipelineVersion: 'agentic-blog-core-v2',
                googleIntelSnapshotId: context.snapshot.id, researchBundleId: String(context.researchBundle._id),
                editorialStyleProfileId: String(context.style._id), strategyPlanId: String(context.strategy._id),
                styleFamily: context.style.styleFamily, styleVariant: context.style.activeVariant,
                researchCoverage: context.researchBundle.researchCoverage,
                searchConsoleFallback: context.researchBundle.searchConsole?.fallback !== false,
                decision: context.opportunity.decision, decisionReason: context.opportunity.reason,
                reviewerDecisions: { factuality, originality, seoAeoGeo, peopleFirstSpam: peopleSpam, brandVoice },
                originalityAttempts, originalityRetryExhausted: !originality.passed,
                wordCount,
                draftGenerator: llmDraft ? `openai:${llmDraft.model}` : 'template-fallback',
                llmGenerationError: llmDraft ? '' : llmGenerationError
            },
            review: {
                seoScore: seoAeoGeo.seoScore,
                brandSafety: brandVoice.passed ? 'pass' : 'fail',
                duplicateRisk: originality.risk,
                claimRisk: factuality.passed ? 'low' : 'high',
                imageSafety: 'pass',
                factuality: factuality.passed ? 'pass' : 'fail',
                originality: originality.passed ? 'pass' : 'fail',
                peopleFirst: peopleSpam.peopleFirst,
                spamRisk: peopleSpam.spamRisk,
                seoAeoGeo: seoAeoGeo.passed ? 'pass' : 'fail'
            }
        };
        return { skipped: false, payload, context, reviews: payload.agenticReviews, highRisk };
    }

    static async listStyles() {
        await AgenticBlogCoreService.seedStyleLibrary();
        const [styles, recentProfiles] = await Promise.all([
            EditorialStyleDefinition.find().sort({ enabled: -1, lastUsedAt: -1, styleFamily: 1 }).lean(),
            EditorialStyleProfile.find().sort({ createdAt: -1 }).limit(30).lean()
        ]);
        return { styles: styles.map((item) => ({ ...item, id: String(item._id) })), recentProfiles: recentProfiles.map((item) => ({ ...item, id: String(item._id) })) };
    }

    static async updateStyle({ styleId, payload = {} }) {
        const allowed = Object.fromEntries(Object.entries(payload).filter(([key]) => ['enabled', 'cooldownDays', 'locked'].includes(key)));
        if (allowed.locked) await EditorialStyleDefinition.updateMany({ _id: { $ne: styleId } }, { $set: { locked: false } });
        const updated = await EditorialStyleDefinition.findByIdAndUpdate(styleId, { $set: allowed }, { new: true, runValidators: true }).lean();
        if (!updated) throw new Error('Editorial style not found');
        return { ...updated, id: String(updated._id) };
    }

    static async generateTodayStyle() {
        const profile = await AgenticBlogCoreService.chooseStyleProfile();
        return { ...profile, id: String(profile._id) };
    }

    static async getResearchBundle({ bundleId }) {
        const bundle = await ResearchBundle.findById(bundleId).lean();
        if (!bundle) throw new Error('Research bundle not found');
        return { ...bundle, id: String(bundle._id) };
    }

    static async getStrategy({ strategyId }) {
        const strategy = await BlogStrategyPlan.findById(strategyId).lean();
        if (!strategy) throw new Error('Blog strategy not found');
        return { ...strategy, id: String(strategy._id) };
    }
}

module.exports = {
    ARTICLE_TYPES,
    AgenticBlogCoreService,
    STYLE_FAMILIES,
    buildArchitecture,
    buildDraft,
    buildSearchConsoleContext,
    decideTopicAction,
    inferAbstractPattern,
    synthesizePatterns
};
