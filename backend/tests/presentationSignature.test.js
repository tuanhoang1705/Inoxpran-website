import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    buildPresentationSignature,
    comparePresentation,
    sequenceSimilarity,
    signatureHash
} = require('../src/services/contentOperations/presentationSignature.service')
const { topicFocusCollides } = require('../src/services/contentOperations/blogTopicRoadmap.service')

// Same words, same devices, same order — a reader sees the same article shape.
const layoutA = `
<p>Nhiều người vẫn đổ đầy nồi tới miệng và tự hỏi vì sao van hay tắc.</p>
<h2>Đổ bao nhiêu là vừa?</h2>
<p>Chừa ít nhất một phần ba dung tích.</p>
<ul><li>Cháo: tối đa một nửa</li><li>Thịt: hai phần ba</li></ul>
<h2>Vì sao tắc van?</h2>
<p>Bọt trào lên bịt đường thoát hơi.</p>
<ul><li>Kiểm tra van</li><li>Vệ sinh sau mỗi lần nấu</li></ul>
<h2>Khi nào phải ngừng?</h2>
<p>Khi hơi thoát thành tia.</p>
<ul><li>Ngắt nguồn</li><li>Chờ nguội</li></ul>
`

// Different words, but identical shape: prose open, three prose+checklist
// sections, list close. This is exactly what "nội dung khác mà trình bày y hệt"
// means, and it must be caught.
const layoutASameShape = `
<p>Nhiều gia đình vẫn nấu quá nhiều nước và thắc mắc vì sao ron nhanh hỏng.</p>
<h2>Nước bao nhiêu là đủ?</h2>
<p>Đổ tối đa hai phần ba.</p>
<ul><li>Canh: một nửa</li><li>Hầm: hai phần ba</li></ul>
<h2>Vì sao ron hỏng?</h2>
<p>Nhiệt lặp lại làm cao su chai cứng.</p>
<ul><li>Thay sau 12 tháng</li><li>Không rửa nước nóng</li></ul>
<h2>Khi nào nên thay?</h2>
<p>Khi ron mất đàn hồi.</p>
<ul><li>Uốn thử</li><li>Tìm vết nứt</li></ul>
`

// Genuinely different presentation: opens on a table, sections are shaped
// differently, closes on a callout.
const layoutB = `
<table><tr><th>Triệu chứng</th><th>Nguyên nhân</th></tr><tr><td>Xì hơi</td><td>Ron chai</td></tr></table>
<h2>Nhận diện triệu chứng</h2>
<table><tr><th>Dấu hiệu</th><th>Mức độ</th></tr><tr><td>Hơi rít</td><td>Nhẹ</td></tr></table>
<h2>Làm theo thứ tự sau</h2>
<ol><li>Để nguội 30 phút</li><li>Tháo ron</li><li>Uốn kiểm tra</li></ol>
<h2>Cảnh báo an toàn</h2>
<aside>Không mở nắp khi còn áp suất.</aside>
<aside>Ngừng dùng nếu vành nồi cong.</aside>
`

describe('presentation signature', () => {
    it('records order and shape, not just which tags exist', () => {
        const a = buildPresentationSignature(layoutA)
        const b = buildPresentationSignature(layoutB)
        expect(a.openingDevice).toBe('scenario-open')
        expect(b.openingDevice).toBe('table-open')
        expect(a.sectionShapes).toEqual(['prose-then-checklist', 'prose-then-checklist', 'prose-then-checklist'])
        expect(b.sectionShapes).toEqual(['table-led', 'steps-led', 'callout-led'])
        expect(a.closingDevice).toBe('list-close')
        expect(b.closingDevice).toBe('callout-close')
        expect(signatureHash(a)).not.toBe(signatureHash(b))
    })

    it('catches a different article wearing the same layout', () => {
        const candidate = buildPresentationSignature(layoutASameShape)
        const recent = [{ ...buildPresentationSignature(layoutA), sourceId: 'blog-1' }]
        const verdict = comparePresentation({ candidate, recent })
        expect(verdict.passed).toBe(false)
        expect(verdict.collisions).toHaveLength(1)
        expect(verdict.repeatedDimensions).toContain('sectionShapes')
        expect(verdict.repeatedDimensions).toContain('openingDevice')
    })

    it('accepts a genuinely different presentation', () => {
        const candidate = buildPresentationSignature(layoutB)
        const recent = [{ ...buildPresentationSignature(layoutA), sourceId: 'blog-1' }]
        const verdict = comparePresentation({ candidate, recent })
        expect(verdict.passed).toBe(true)
        expect(verdict.worst.differingDimensions).toBeGreaterThanOrEqual(3)
    })

    it('requires difference from every recent article, not just the average', () => {
        const candidate = buildPresentationSignature(layoutASameShape)
        const recent = [
            { ...buildPresentationSignature(layoutB), sourceId: 'blog-far' },
            { ...buildPresentationSignature(layoutA), sourceId: 'blog-near' }
        ]
        const verdict = comparePresentation({ candidate, recent })
        expect(verdict.passed).toBe(false)
        expect(verdict.collisions.map(entry => entry.sourceId)).toEqual(['blog-near'])
    })

    it('scores sequences by order rather than membership', () => {
        expect(sequenceSimilarity(['p', 'ul', 'p'], ['p', 'ul', 'p'])).toBe(1)
        expect(sequenceSimilarity(['table', 'p', 'ul'], ['ul', 'p', 'table'])).toBeLessThan(0.5)
        expect(sequenceSimilarity([], [])).toBe(1)
    })
})

describe('roadmap focus collision', () => {
    it('treats the same question about the same product as one plan', () => {
        expect(topicFocusCollides(
            { topic: 'Nồi áp suất điện tử INP6903: khi nào được mở nắp sau khi nấu' },
            { topic: 'Nồi áp suất điện tử INP6903: khi nào được mở nắp sau khi nấu?' }
        )).toBe(true)
        expect(topicFocusCollides(
            { topic: 'Nồi áp suất INP6903: nấu bao nhiêu là đủ để tránh trào và tắc van' },
            { topic: 'Nồi áp suất INP6903: nấu bao nhiêu là vừa để tránh trào và tắc van' }
        )).toBe(true)
    })

    it('leaves genuinely different plans about the same product alone', () => {
        expect(topicFocusCollides(
            { topic: 'Nồi áp suất núm cơ INP6902: chừa khoảng trống bao nhiêu khi nấu?' },
            { topic: 'Nồi áp suất điện tử INP6903: kiểm tra ron và van trước mỗi lần nấu' }
        )).toBe(false)
        expect(topicFocusCollides(
            { topic: 'Nồi áp suất INP6903: vệ sinh sau khi nấu để tránh mùi và cặn ở van' },
            { topic: 'Nồi áp suất INP6903: xử lý khi nồi không mở nắp sau khi nấu' }
        )).toBe(false)
    })

    it('collides on the primary question even when the topic wording differs', () => {
        expect(topicFocusCollides(
            { topic: 'Mở nắp nồi áp suất', primaryQuestion: 'Khi nào được mở nắp nồi áp suất sau khi nấu?' },
            { topic: 'Xả áp nồi áp suất', primaryQuestion: 'Khi nào được mở nắp nồi áp suất sau khi nấu' }
        )).toBe(true)
    })
})
