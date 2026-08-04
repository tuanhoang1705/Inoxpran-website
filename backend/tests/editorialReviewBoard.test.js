import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    MIN_INFORMATION_GAIN_SIGNALS,
    buildRevisionBrief,
    resolveWordRange,
    reviewEditorialQuality
} = require('../src/services/contentOperations/editorialReviewBoard.service')

const section = (heading, answer, body) => `
<h2>${heading}</h2>
<p>${answer}</p>
<p>${body}</p>
`

const filler = (count) => Array.from({ length: count }, (_, index) => `chi tiết ${index}`).join(' ')

const strongDraft = () => `
<p>Nồi áp suất bị xì hơi ở gioăng là lỗi rất thường gặp sau khoảng 12 tháng sử dụng, và phần lớn gia đình xử lý sai bằng cách siết chặt nắp hơn. Bài này chỉ ra nguyên nhân thật và cách kiểm tra an toàn tại nhà trước khi quyết định thay linh kiện.</p>
<ul><li>Tóm tắt nhanh: gioăng cứng là nguyên nhân phổ biến nhất</li><li>Kiểm tra van xả trước khi thay gioăng</li><li>Ngừng dùng nếu hơi thoát thành tia</li></ul>
${section(
    'Vì sao nồi áp suất bị xì hơi ở gioăng?',
    'Nguyên nhân phổ biến nhất là gioăng cao su bị chai cứng sau 12 tháng, khiến nó không còn ép kín ở áp suất 80 kPa. Tuy nhiên nhiều người nghĩ do nắp lỏng nên siết mạnh hơn, làm biến dạng vành nồi và hỏng nặng thêm.',
    `Theo khuyến cáo nhà sản xuất, nên thay gioăng sau 12 tháng. Ví dụ một hộ dùng nồi 6 lít nấu 5 lần mỗi tuần thường phải thay sau 10 tháng. ${filler(60)}`
)}
${section(
    'Kiểm tra thế nào cho an toàn?',
    'Hãy để nồi nguội hoàn toàn trong 30 phút, sau đó tháo gioăng và uốn nhẹ; nếu thấy vết nứt hoặc mất đàn hồi thì phải thay. Nếu hơi thoát thành tia mạnh khi đang nấu, ngắt nguồn ngay và không mở nắp.',
    `Nếu gioăng còn tốt thì kiểm tra tiếp van xả. ${filler(60)}`
)}
${section(
    'Khi nào nên ngừng dùng hẳn?',
    'Ngừng dùng khi vành nồi đã cong hoặc chốt khoá không ăn khớp, vì lúc đó áp suất không được kiểm soát. Trong trường hợp này việc thay gioăng không giải quyết được vấn đề.',
    `Nồi áp suất INP6903 có chốt an toàn kép nên dễ kiểm tra hơn. ${filler(60)}`
)}
`

describe('editorial review board', () => {
    it('accepts a draft that answers first, carries real information gain and stays scannable', () => {
        const report = reviewEditorialQuality({
            html: strongDraft(),
            primaryKeyword: 'nồi áp suất bị xì hơi',
            searchIntent: 'informational',
            primaryQuestion: 'Vì sao nồi áp suất bị xì hơi ở gioăng?',
            productNames: ['INP6903']
        })
        expect(report.blockingFindings).toEqual([])
        expect(report.passed).toBe(true)
        expect(report.metrics.sectionCount).toBe(3)
        expect(report.metrics.informationGainSignals.length).toBeGreaterThanOrEqual(MIN_INFORMATION_GAIN_SIGNALS)
    })

    it('names the defect and the remedy instead of only failing', () => {
        const rehash = `
<p>Nồi áp suất là thiết bị quen thuộc trong gian bếp của nhiều gia đình hiện nay.</p>
<h2>Giới thiệu chung</h2>
<p>Thiết bị này rất tiện lợi và được nhiều người tin dùng trong cuộc sống hằng ngày hiện nay.</p>
`
        const report = reviewEditorialQuality({
            html: rehash,
            primaryKeyword: 'nồi áp suất bị xì hơi',
            searchIntent: 'informational',
            primaryQuestion: 'Vì sao nồi áp suất bị xì hơi ở gioăng?'
        })
        expect(report.passed).toBe(false)
        const codes = report.findings.map((entry) => entry.code)
        expect(codes).toContain('insufficient_sections')
        expect(codes).toContain('low_information_gain')
        expect(codes).toContain('primary_question_unanswered')
        expect(codes).toContain('keyword_missing_in_intro')
        // Every finding must be actionable; a defect without a remedy is what
        // made the old retry loop rewrite blindly and fail the same gate again.
        for (const entry of report.findings) {
            expect(entry.problem.length).toBeGreaterThan(10)
            expect(entry.fix.length).toBeGreaterThan(10)
        }
        // Critical defects must sort ahead of cosmetic ones.
        expect(['critical', 'high']).toContain(report.findings[0].severity)
    })

    it('scales the word budget to search intent rather than one global floor', () => {
        expect(resolveWordRange('know')).toMatchObject({ intent: 'know' })
        expect(resolveWordRange('do')).toMatchObject({ intent: 'do' })
        expect(resolveWordRange('')).toMatchObject({ intent: 'default' })
        expect(resolveWordRange('know').min).toBeLessThan(resolveWordRange('do').min)
    })

    it('merges pipeline reviewers into one ranked, de-duplicated instruction set', () => {
        const brief = buildRevisionBrief({
            editorial: reviewEditorialQuality({
                html: '<p>Ngắn.</p>',
                primaryKeyword: 'vợt muỗi',
                searchIntent: 'know'
            }),
            reviews: [
                { name: 'spam', passed: false, reasons: ['keyword_stuffing_risk', 'insufficient_topic_coverage'] },
                { name: 'brand', passed: false, violations: ['brand_voice_violation'] },
                { name: 'facts', passed: true, reasons: ['ignored_because_passed'] }
            ],
            attempt: 1,
            maxAttempts: 3
        })
        const codes = brief.all.map((item) => item.code)
        expect(codes).toContain('keyword_stuffing_risk')
        expect(codes).toContain('brand_voice_violation')
        expect(codes).not.toContain('ignored_because_passed')
        expect(new Set(codes).size).toBe(codes.length)
        expect(brief.blocking.length).toBeGreaterThan(0)
        for (const item of brief.all) expect(item.fix.length).toBeGreaterThan(10)
    })
})
