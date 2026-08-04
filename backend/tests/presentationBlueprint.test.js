import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
    PresentationBlueprintService,
    blueprintAsSignature,
    normalizeBlueprint
} = require('../src/services/contentOperations/presentationBlueprint.service')
const { buildPresentationSignature } = require('../src/services/contentOperations/presentationSignature.service')

const adapterReturning = (...outputs) => {
    const calls = []
    return {
        calls,
        run: vi.fn(async (request) => {
            calls.push(request)
            const output = outputs[Math.min(calls.length - 1, outputs.length - 1)]
            return { output, audit: { agentId: request.agentId, durationMs: 1 } }
        })
    }
}

const proseLayout = {
    openingDevice: 'prose-open',
    sectionShapes: ['prose-only', 'prose-only', 'prose-only'],
    headingModes: ['statement', 'statement', 'statement'],
    closingDevice: 'prose-close'
}

describe('presentation blueprint', () => {
    it('keeps invention free but forces the mechanics into a verifiable vocabulary', () => {
        const blueprint = normalizeBlueprint({
            layoutName: 'thang-chẩn-đoán',
            why: 'Chủ đề là chuỗi triệu chứng nên hợp bậc thang',
            openingDevice: 'table-open',
            closingDevice: 'callout-close',
            voiceRegister: 'gỡ rối - chẩn đoán sự cố',
            sections: [
                { label: 'Bảng triệu chứng', shape: 'table-led', headingMode: 'statement' },
                { label: 'Chuỗi nguyên nhân', shape: 'steps-led', headingMode: 'question' },
                { label: 'Ngưỡng dừng', shape: 'callout-led', headingMode: 'imperative' }
            ]
        })
        expect(blueprint.layoutName).toBe('thang-chẩn-đoán')
        expect(blueprint.openingDevice).toBe('table-open')
        expect(blueprint.sections.map(s => s.shape)).toEqual(['table-led', 'steps-led', 'callout-led'])

        // An invented mechanic the renderer cannot detect would make compliance
        // unverifiable, so it falls back rather than being trusted.
        const invented = normalizeBlueprint({
            openingDevice: 'hologram-open',
            sections: [{ shape: 'spiral-of-wisdom', headingMode: 'interpretive-dance' }]
        })
        expect(invented.openingDevice).toBe('prose-open')
        expect(invented.sections[0].shape).toBe('prose-only')
        expect(invented.sections[0].headingMode).toBe('statement')
        expect(invented.sections.length).toBeGreaterThanOrEqual(3)
    })

    it('redesigns when the first design repeats a recent layout, and reports the collision back', async () => {
        const adapter = adapterReturning(
            {
                layoutName: 'lặp lại',
                openingDevice: 'prose-open',
                closingDevice: 'prose-close',
                sections: [
                    { shape: 'prose-only', headingMode: 'statement' },
                    { shape: 'prose-only', headingMode: 'statement' },
                    { shape: 'prose-only', headingMode: 'statement' }
                ]
            },
            {
                layoutName: 'bậc-thang-chẩn-đoán',
                openingDevice: 'table-open',
                closingDevice: 'callout-close',
                sections: [
                    { shape: 'table-led', headingMode: 'question' },
                    { shape: 'steps-led', headingMode: 'imperative' },
                    { shape: 'callout-led', headingMode: 'question' }
                ]
            }
        )
        const service = new PresentationBlueprintService({ agentAdapter: adapter })
        const result = await service.design({ topic: 'Nồi áp suất xì hơi', recentPresentations: [proseLayout] })

        expect(result.attempts).toBe(2)
        expect(result.verdict.passed).toBe(true)
        expect(result.blueprint.layoutName).toBe('bậc-thang-chẩn-đoán')
        // The second attempt must be told which dimensions collided.
        expect(adapter.calls[1].input.collisionFeedback.repeatedDimensions.length).toBeGreaterThan(0)
        expect(adapter.calls[0].agentId).toBe('content-architect')
    })

    it('returns the design with its verdict instead of blocking the run outright', async () => {
        const adapter = adapterReturning({
            openingDevice: 'prose-open',
            closingDevice: 'prose-close',
            sections: [
                { shape: 'prose-only', headingMode: 'statement' },
                { shape: 'prose-only', headingMode: 'statement' },
                { shape: 'prose-only', headingMode: 'statement' }
            ]
        })
        const service = new PresentationBlueprintService({ agentAdapter: adapter })
        const result = await service.design({ topic: 'x', recentPresentations: [proseLayout] })
        expect(result.verdict.passed).toBe(false)
        expect(result.blueprint).toBeTruthy()
    })

    it('grades a design with the same comparator that later grades the rendered draft', () => {
        const blueprint = normalizeBlueprint({
            openingDevice: 'table-open',
            closingDevice: 'callout-close',
            sections: [
                { shape: 'table-led', headingMode: 'statement' },
                { shape: 'steps-led', headingMode: 'question' },
                { shape: 'callout-led', headingMode: 'imperative' }
            ]
        })
        const planned = blueprintAsSignature(blueprint)
        const rendered = buildPresentationSignature(`
<table><tr><td>a</td></tr></table>
<h2>Nhận diện</h2><table><tr><td>b</td></tr></table>
<h2>Vì sao hỏng?</h2><ol><li>một</li></ol>
<h2>Hãy dừng khi</h2><aside>cảnh báo</aside>
`)
        expect(rendered.openingDevice).toBe(planned.openingDevice)
        expect(rendered.sectionShapes).toEqual(planned.sectionShapes)
        expect(rendered.closingDevice).toBe(planned.closingDevice)
    })

    it('does not spend a second agent call when there is no history to differ from', async () => {
        const adapter = adapterReturning({ openingDevice: 'prose-open', sections: [] })
        const service = new PresentationBlueprintService({ agentAdapter: adapter })
        const result = await service.design({ topic: 'x', recentPresentations: [] })
        expect(result.attempts).toBe(1)
        expect(adapter.run).toHaveBeenCalledTimes(1)
    })
})
