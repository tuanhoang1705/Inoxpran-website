'use strict'

// The draft writer used to be told only "write it differently" when a review
// failed, so a retry changed the wording and failed the same gate again. This
// board turns every failure into a named defect with a concrete instruction, in
// the language the writer writes in, so a rewrite can actually converge.
//
// It is deliberately deterministic. An LLM editor sits on top of it for the
// judgement calls; the rules below must stay stable so the same draft always
// receives the same verdict and the retry loop cannot oscillate.

const REVIEW_BOARD_VERSION = 'editorial-review-board-v1-2026-08-04'

const SEVERITY_ORDER = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3 })

// Word budgets follow search intent rather than a single global floor: a "know"
// answer padded to 1,500 words is worse for the reader than a tight 600-word one.
const INTENT_WORD_RANGE = Object.freeze({
    know: { min: 500, max: 1400 },
    informational: { min: 700, max: 1800 },
    compare: { min: 700, max: 1600 },
    commercial: { min: 800, max: 1800 },
    do: { min: 900, max: 1800 },
    transactional: { min: 600, max: 1400 },
    validate: { min: 1000, max: 2200 }
})
const DEFAULT_WORD_RANGE = Object.freeze({ min: 700, max: 1800 })

const ANSWER_FIRST_MIN_WORDS = 25
const ANSWER_FIRST_MAX_WORDS = 90
const PARAGRAPH_MAX_WORDS = 120
const MIN_H2 = 3
const MIN_INFORMATION_GAIN_SIGNALS = 3
const MIN_DENSITY_RATIO = 0.34

const stripTags = (html) => String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()

const words = (value) => stripTags(value).split(' ').filter(Boolean)
const wordCount = (value) => words(value).length

const sectionsOf = (html) => {
    const source = String(html || '')
    const matches = [...source.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    return matches.map((match, index) => {
        const start = match.index + match[0].length
        const end = index + 1 < matches.length ? matches[index + 1].index : source.length
        return {
            heading: stripTags(match[1]),
            body: source.slice(start, end)
        }
    })
}

const paragraphsOf = (html) => [...String(html || '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean)

// Information gain is what separates a useful article from a restatement of the
// top ten results. It cannot be measured perfectly without the SERP, but a draft
// carrying no numbers, no concrete situation and no caveat is a rehash by any
// reading.
const informationGainSignals = (html) => {
    const text = stripTags(html)
    const lower = text.toLocaleLowerCase('vi')
    const signals = []
    const measurements = text.match(/\d+(?:[.,]\d+)?\s*(?:%|độ|°C|phút|giờ|giây|lít|ml|kg|g|cm|mm|W|kW|V|năm|tháng|ngày|lần|bar)/gi) || []
    if (measurements.length >= 2) signals.push('measurements')
    if (/\b(?:ví dụ|trường hợp|tình huống|chẳng hạn|thực tế là)\b/.test(lower)) signals.push('concrete_scenario')
    if (/\b(?:tuy nhiên|ngược lại|nhiều người (?:nghĩ|tưởng)|hiểu lầm|sai lầm|không nên|đừng)\b/.test(lower)) signals.push('counter_narrative')
    if (/\b(?:theo|nguồn|nghiên cứu|khuyến cáo|hướng dẫn của|nhà sản xuất)\b/.test(lower)) signals.push('attribution')
    if (/<(?:ul|ol|table)\b/i.test(String(html))) signals.push('structured_data')
    if (/\b(?:khi nào|nếu|trong trường hợp)\b/.test(lower)) signals.push('conditional_guidance')
    return signals
}

const densityRatio = (html) => {
    const list = words(html).map((word) => word.toLocaleLowerCase('vi'))
    if (!list.length) return 0
    return Number((new Set(list).size / list.length).toFixed(4))
}

const hasSummaryBlock = (html) => /(?:tl;?dr|tóm tắt nhanh|điểm chính|những điều cần nhớ|key takeaways)/i.test(stripTags(html)) ||
    /class="(?:answer-block|key-takeaways|tldr)"/i.test(String(html || ''))

const finding = (code, dimension, severity, problem, fix, detail = {}) => ({
    code, dimension, severity, problem, fix, ...detail
})

const resolveWordRange = (searchIntent) => {
    const key = String(searchIntent || '').trim().toLocaleLowerCase('vi')
    for (const [name, range] of Object.entries(INTENT_WORD_RANGE)) {
        if (key.includes(name)) return { ...range, intent: name }
    }
    return { ...DEFAULT_WORD_RANGE, intent: 'default' }
}

const reviewEditorialQuality = ({
    html = '',
    title = '',
    primaryKeyword = '',
    searchIntent = '',
    primaryQuestion = '',
    productNames = []
} = {}) => {
    const findings = []
    const total = wordCount(html)
    const sections = sectionsOf(html)
    const paragraphs = paragraphsOf(html)
    const range = resolveWordRange(searchIntent)
    // The introduction is the prose before the first section. A summary block
    // sits in that same region, so counting it inflated the intro length and
    // flagged well-formed drafts that had done exactly what the GEO rule asks.
    const introRegion = String(html).split(/<h2\b/i)[0] || ''
    const intro = stripTags(introRegion.replace(/<(ul|ol|table)\b[\s\S]*?<\/\1>/gi, ' '))
    const gainSignals = informationGainSignals(html)
    const density = densityRatio(html)

    if (sections.length < MIN_H2) {
        findings.push(finding(
            'insufficient_sections', 'structure', 'critical',
            `Bài chỉ có ${sections.length} mục <h2>, dưới mức tối thiểu ${MIN_H2}.`,
            `Tách nội dung thành ít nhất ${MIN_H2} mục <h2>, mỗi mục trả lời một câu hỏi riêng mà người đọc thực sự tìm kiếm.`,
            { observed: sections.length, required: MIN_H2 }
        ))
    }

    if (total < range.min) {
        findings.push(finding(
            'below_intent_word_floor', 'depth', 'high',
            `Bài dài ${total} từ, dưới mức ${range.min} từ hợp lý cho ý định tìm kiếm "${range.intent}".`,
            `Bổ sung chiều sâu thật: thêm tình huống cụ thể, ngưỡng số đo, hoặc bước xử lý chi tiết. Không kéo dài bằng câu chữ rỗng.`,
            { observed: total, required: range.min }
        ))
    } else if (total > range.max) {
        findings.push(finding(
            'above_intent_word_ceiling', 'depth', 'medium',
            `Bài dài ${total} từ, vượt mức ${range.max} từ cho ý định "${range.intent}" nên loãng trọng tâm.`,
            'Cắt phần lặp ý và đoạn dẫn dắt chung chung; giữ lại thông tin mà bài khác chưa có.',
            { observed: total, allowed: range.max }
        ))
    }

    // Answer-first: the reader (and an AI summariser) must get the answer
    // immediately after the question, before the supporting evidence.
    const weakAnswers = sections.filter((section) => {
        const lead = paragraphsOf(section.body)[0] || stripTags(section.body)
        const count = wordCount(lead)
        return count < ANSWER_FIRST_MIN_WORDS || count > ANSWER_FIRST_MAX_WORDS
    })
    if (weakAnswers.length) {
        findings.push(finding(
            'answer_first_missing', 'structure', 'high',
            `${weakAnswers.length}/${sections.length} mục không trả lời thẳng ngay sau tiêu đề.`,
            `Ngay dưới mỗi <h2>, viết một đoạn ${ANSWER_FIRST_MIN_WORDS}–${ANSWER_FIRST_MAX_WORDS} từ trả lời trực tiếp câu hỏi của mục đó, rồi mới đưa lý do và bằng chứng.`,
            { sections: weakAnswers.map((section) => section.heading).slice(0, 5) }
        ))
    }

    if (gainSignals.length < MIN_INFORMATION_GAIN_SIGNALS) {
        findings.push(finding(
            'low_information_gain', 'value', 'critical',
            `Bài mới đạt ${gainSignals.length}/${MIN_INFORMATION_GAIN_SIGNALS} tín hiệu giá trị mới (${gainSignals.join(', ') || 'không có'}), nên đọc như tóm tắt lại bài đã có.`,
            'Thêm ít nhất ba trong số: con số/ngưỡng đo cụ thể, một tình huống thật của người dùng, một điều nhiều người làm sai kèm lý do, dẫn nguồn hoặc khuyến cáo nhà sản xuất, một bảng/danh sách so sánh, và chỉ dẫn theo điều kiện "nếu… thì…".',
            { observed: gainSignals, required: MIN_INFORMATION_GAIN_SIGNALS }
        ))
    }

    if (density && density < MIN_DENSITY_RATIO) {
        findings.push(finding(
            'low_content_density', 'value', 'medium',
            `Tỉ lệ từ khác nhau chỉ ${density}, dưới ngưỡng ${MIN_DENSITY_RATIO} — dấu hiệu lặp ý và diễn giải vòng vo.`,
            'Xoá câu lặp lại ý đã nói, gộp các đoạn trùng nội dung, thay cụm chung chung bằng thông tin cụ thể.',
            { observed: density, required: MIN_DENSITY_RATIO }
        ))
    }

    const introWords = wordCount(intro)
    if (introWords < 40 || introWords > 160) {
        findings.push(finding(
            'weak_introduction', 'structure', 'medium',
            `Mở bài dài ${introWords} từ, ngoài khoảng 40–160 từ.`,
            'Viết mở bài 2–3 đoạn ngắn: nêu đúng vấn đề người đọc đang gặp, cho biết bài sẽ giải quyết gì, và đặt từ khoá chính trong 100 từ đầu.',
            { observed: introWords }
        ))
    }

    const keyword = String(primaryKeyword || '').trim().toLocaleLowerCase('vi')
    if (keyword) {
        const firstHundred = words(intro).slice(0, 100).join(' ').toLocaleLowerCase('vi')
        if (!firstHundred.includes(keyword)) {
            findings.push(finding(
                'keyword_missing_in_intro', 'seo', 'high',
                `Từ khoá chính "${primaryKeyword}" không xuất hiện trong 100 từ đầu.`,
                `Đưa nguyên văn "${primaryKeyword}" vào câu đầu hoặc câu thứ hai của mở bài, theo cách đọc tự nhiên.`,
                { primaryKeyword }
            ))
        }
    }

    const longParagraphs = paragraphs.filter((paragraph) => wordCount(paragraph) > PARAGRAPH_MAX_WORDS)
    if (longParagraphs.length) {
        findings.push(finding(
            'paragraph_too_long', 'readability', 'medium',
            `${longParagraphs.length} đoạn vượt ${PARAGRAPH_MAX_WORDS} từ, gây khối chữ khó đọc.`,
            `Tách mỗi đoạn dài thành các đoạn 40–80 từ, mỗi đoạn một ý; chuyển phần liệt kê thành <ul> hoặc <ol>.`,
            { observed: longParagraphs.length }
        ))
    }

    if (!hasSummaryBlock(html)) {
        findings.push(finding(
            'missing_summary_block', 'geo', 'medium',
            'Bài thiếu khối tóm tắt nhanh ngay sau mở bài.',
            'Thêm khối "Tóm tắt nhanh" gồm 5–7 gạch đầu dòng nêu kết luận chính, đặt ngay sau mở bài — đây là phần công cụ tìm kiếm và trợ lý AI trích dẫn nhiều nhất.',
            {}
        ))
    }

    if (!/<(?:ul|ol|table)\b/i.test(String(html))) {
        findings.push(finding(
            'no_scannable_block', 'readability', 'medium',
            'Toàn bài là văn xuôi, không có danh sách hay bảng.',
            'Chuyển ít nhất một phần (các bước xử lý, tiêu chí so sánh, hoặc lỗi thường gặp) thành danh sách hoặc bảng.',
            {}
        ))
    }

    const names = (Array.isArray(productNames) ? productNames : []).filter(Boolean)
    if (names.length) {
        const body = stripTags(html).toLocaleLowerCase('vi')
        const mentioned = names.filter((name) => body.includes(String(name).toLocaleLowerCase('vi')))
        if (!mentioned.length) {
            findings.push(finding(
                'product_not_connected', 'business', 'high',
                `Bài không nhắc tới sản phẩm liên quan (${names.slice(0, 3).join(', ')}).`,
                'Gắn sản phẩm vào đúng ngữ cảnh nó giải quyết vấn đề của người đọc — nêu tình huống dùng thật, không chèn quảng cáo rời rạc.',
                { expected: names.slice(0, 5) }
            ))
        }
    }

    if (primaryQuestion) {
        const asked = stripTags(html).toLocaleLowerCase('vi')
        // Punctuation must be stripped before matching: a trailing "?" on the
        // most distinctive noun of the question ("gioăng?") never matches the
        // body, which silently disabled this gate.
        const core = [...new Set(words(primaryQuestion)
            .map((word) => word.replace(/[^\p{L}\p{N}]+/gu, '').toLocaleLowerCase('vi'))
            .filter((word) => word.length > 2))].slice(0, 8)
        const covered = core.filter((word) => asked.includes(word)).length
        if (core.length && covered / core.length < 0.75) {
            findings.push(finding(
                'primary_question_unanswered', 'intent', 'critical',
                `Bài chưa trả lời rõ câu hỏi chính: "${primaryQuestion}".`,
                'Dành hẳn một mục <h2> đặt đúng câu hỏi chính, trả lời trực tiếp ở hai câu đầu, rồi mới giải thích.',
                { primaryQuestion }
            ))
        }
    }

    const ranked = [...findings].sort((left, right) =>
        SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
        left.code.localeCompare(right.code))
    const blocking = ranked.filter((entry) => entry.severity === 'critical' || entry.severity === 'high')

    return {
        version: REVIEW_BOARD_VERSION,
        passed: blocking.length === 0,
        findings: ranked,
        blockingFindings: blocking,
        metrics: {
            wordCount: total,
            sectionCount: sections.length,
            paragraphCount: paragraphs.length,
            introWordCount: introWords,
            densityRatio: density,
            informationGainSignals: gainSignals,
            intent: range.intent
        }
    }
}

// Normalises every reviewer in the pipeline — this board plus the existing
// originality, factuality, spam, brand-voice and placement checks — into one
// ordered instruction set. The writer receives defects and remedies, never a
// bare "try again".
const REMEDIATION_LIBRARY = Object.freeze({
    keyword_stuffing_risk: 'Giảm mật độ từ khoá xuống dưới 4,5%: thay các lần lặp bằng đại từ hoặc cách gọi khác của cùng sản phẩm.',
    repetitive_low_value_content: 'Xoá các câu diễn đạt lại ý đã nói; mỗi đoạn phải thêm thông tin mới.',
    spam_tactic_language: 'Bỏ mọi cách diễn đạt nhằm đánh lừa công cụ tìm kiếm; viết cho người đọc.',
    insufficient_topic_coverage: 'Tăng số mục <h2> lên ít nhất 3, mỗi mục giải quyết một câu hỏi riêng.',
    formulaic_opening: 'Đổi hẳn cách mở bài: vào thẳng tình huống cụ thể thay vì câu dẫn chung chung.',
    formulaic_structure: 'Thiết kế lại bộ heading theo đúng bài này, không dùng khung mẫu đã dùng ở bài trước.',
    duplicate_topic: 'Chuyển sang góc tiếp cận khác hẳn: đổi tình huống người đọc và quyết định chính mà bài giúp họ đưa ra.',
    unsupported_claim: 'Mọi khẳng định về an toàn, thông số hay hiệu quả phải kèm nguồn hoặc khuyến cáo nhà sản xuất; nếu không có thì bỏ khẳng định đó.',
    brand_voice_violation: 'Viết lại theo giọng tư vấn thực tế, trung tính; bỏ lời hứa tuyệt đối và ngôn ngữ thổi phồng.'
})

const buildRevisionBrief = ({ editorial = null, reviews = [], attempt = 0, maxAttempts = 3 } = {}) => {
    const items = []
    for (const entry of editorial?.findings || []) {
        items.push({
            code: entry.code,
            severity: entry.severity,
            problem: entry.problem,
            fix: entry.fix
        })
    }
    for (const review of Array.isArray(reviews) ? reviews : []) {
        if (!review || review.passed) continue
        for (const reason of review.reasons || review.violations || []) {
            const code = String(reason?.code || reason || '').trim()
            if (!code) continue
            items.push({
                code,
                severity: review.severity || 'high',
                problem: `Kiểm duyệt "${review.name || 'nội dung'}" báo lỗi: ${code}.`,
                fix: REMEDIATION_LIBRARY[code] || 'Xử lý dứt điểm lỗi này trước khi nộp lại; không giữ nguyên cách viết cũ.'
            })
        }
    }
    const seen = new Set()
    const deduped = items.filter((item) => {
        if (seen.has(item.code)) return false
        seen.add(item.code)
        return true
    }).sort((left, right) =>
        (SEVERITY_ORDER[left.severity] ?? 9) - (SEVERITY_ORDER[right.severity] ?? 9))

    return {
        version: REVIEW_BOARD_VERSION,
        attempt,
        maxAttempts,
        blocking: deduped.filter((item) => item.severity === 'critical' || item.severity === 'high'),
        advisory: deduped.filter((item) => item.severity !== 'critical' && item.severity !== 'high'),
        all: deduped
    }
}

module.exports = {
    ANSWER_FIRST_MAX_WORDS,
    ANSWER_FIRST_MIN_WORDS,
    INTENT_WORD_RANGE,
    MIN_DENSITY_RATIO,
    MIN_INFORMATION_GAIN_SIGNALS,
    REMEDIATION_LIBRARY,
    REVIEW_BOARD_VERSION,
    buildRevisionBrief,
    densityRatio,
    informationGainSignals,
    paragraphsOf,
    resolveWordRange,
    reviewEditorialQuality,
    sectionsOf,
    stripTags,
    wordCount
}
