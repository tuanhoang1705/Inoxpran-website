import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { SeniorEditorReviewService } = require('../src/services/contentOperations/seniorEditorReview.service')
const { buildRevisionBrief } = require('../src/services/contentOperations/editorialReviewBoard.service')
const { ALLOWED_TOPIC_AGENTS } = require('../src/services/openclawAgentAdapter.service')
const fs = require('node:fs')
const path = require('node:path')

const adapterReturning = (output) => ({
    run: vi.fn(async () => ({ output, audit: { agentId: 'qa-agent', durationMs: 1 } }))
})

// The senior editor called a gateway alias that was never on the adapter
// allowlist, so every call was refused and the caller read the refusal as
// approval: no draft was ever judged for substance in production, silently.
// These assert the whole chain the reviewer needs, not just its own logic.
describe('senior editor agent registration', () => {
    const deployRoot = path.resolve(__dirname, '..', '..', 'deploy', 'openclaw')

    const configuredAgentId = async () => {
        let seen = ''
        const service = new SeniorEditorReviewService({
            agentAdapter: { run: vi.fn(async ({ agentId }) => { seen = agentId; return { output: {} } }) }
        })
        await service.review({ html: '<p>x</p>' })
        return seen
    }

    it('calls an agent the adapter allowlist actually permits', async () => {
        expect(ALLOWED_TOPIC_AGENTS).toContain(await configuredAgentId())
    })

    it('calls an agent the gateway has a charter and a runtime binding for', async () => {
        const agentId = await configuredAgentId()
        expect(fs.existsSync(path.join(deployRoot, 'agents', agentId + '.md'))).toBe(true)
        expect(fs.readFileSync(path.join(deployRoot, 'openclaw.json5'), 'utf8'))
            .toContain('id: "' + agentId + '"')
    })
})

describe('senior editor review', () => {
    it('accepts only when nothing critical or high remains', async () => {
        const service = new SeniorEditorReviewService({
            agentAdapter: adapterReturning({
                verdict: 'accept',
                summary: 'Bài đúng và đủ.',
                findings: [{ code: 'nit', severity: 'low', problem: 'Câu kết hơi nhạt.', fix: 'Kết bằng ngưỡng an toàn cụ thể.' }]
            })
        })
        const result = await service.review({ html: '<p>x</p>', title: 't' })
        expect(result.passed).toBe(true)
        expect(result.verdict).toBe('accept')
    })

    it('cannot wave through a draft it has itself flagged as critical', async () => {
        const service = new SeniorEditorReviewService({
            agentAdapter: adapterReturning({
                verdict: 'accept',
                findings: [{
                    code: 'unsafe_advice',
                    severity: 'critical',
                    problem: 'Bài khuyên mở nắp khi còn áp suất.',
                    fix: 'Bỏ hẳn lời khuyên đó và nêu quy trình xả áp trước khi mở.'
                }]
            })
        })
        const result = await service.review({ html: '<p>x</p>' })
        expect(result.passed).toBe(false)
        expect(result.verdict).toBe('revise')
        expect(result.blockingFindings).toHaveLength(1)
    })

    it('drops a finding that names no remedy, since the writer could not act on it', async () => {
        const service = new SeniorEditorReviewService({
            agentAdapter: adapterReturning({
                verdict: 'revise',
                findings: [
                    { code: 'vague', severity: 'high', problem: 'Chưa ổn.' },
                    { code: 'good', severity: 'high', problem: 'Thiếu ngưỡng nhiệt.', fix: 'Nêu ngưỡng nhiệt an toàn kèm đơn vị.' }
                ]
            })
        })
        const result = await service.review({ html: '<p>x</p>' })
        expect(result.findings.map(entry => entry.code)).toEqual(['good'])
    })

    it('feeds its findings into the same revision brief the writer already reads', () => {
        const brief = buildRevisionBrief({
            editorial: { findings: [] },
            reviews: [],
            seniorFindings: [{
                code: 'unsupported_claim',
                severity: 'critical',
                problem: 'Khẳng định "tiết kiệm 40% điện" không có nguồn.',
                fix: 'Bỏ con số hoặc dẫn khuyến cáo nhà sản xuất.'
            }],
            attempt: 1
        })
        expect(brief.blocking).toHaveLength(1)
        expect(brief.blocking[0].code).toBe('unsupported_claim')
        expect(brief.blocking[0].fix.length).toBeGreaterThan(10)
    })
})
