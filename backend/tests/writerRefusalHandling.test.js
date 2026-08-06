import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildWriterUnblockBrief } = require('../src/services/agenticBlogCore.service')
const { isTransientFailureCode } = require('../src/services/contentOperations/blogTopicRoadmap.service')
const { SAFE_ROADMAP_SKIP_CODES } = require('../src/services/blogAutomationSchedule.service')

// The refusal the production content-writer actually returned: it asked for
// pipeline lineage IDs the orchestrator never passes for a new article.
const lineageRefusal = {
    status: 'blocked',
    reason: 'Không thể soạn bài an toàn từ dữ liệu hiện có: thiếu chuỗi sản xuất bắt buộc và revisionContext của bài hiện tại.',
    missingRequiredContext: [
        'googleIntelSnapshotId',
        'contentWorkOrderId',
        'evidenceMapId',
        'revisionContext'
    ],
    requiredResolution: 'Cung cấp đầy đủ các ID cùng nội dung bài hiện tại.'
}

describe('writer refusal handling', () => {
    it('turns a refusal into a blocking instruction the writer can act on', () => {
        const brief = buildWriterUnblockBrief({ refusal: lineageRefusal, attempt: 1, maxAttempts: 3 })
        expect(brief.blocking).toHaveLength(1)
        const finding = brief.blocking[0]
        expect(finding.code).toBe('writer_returned_no_draft')
        expect(finding.problem).toContain('thiếu chuỗi sản xuất bắt buộc')
        // The remedy must say the missing IDs are deliberate, or the next attempt
        // refuses for exactly the same reason.
        expect(finding.fix).toContain('chuỗi sản xuất đầy đủ cho một bài mới')
        expect(finding.fix).toContain('googleIntelSnapshotId')
    })

    it('gives a length instruction, not a context lecture, for a short draft', () => {
        const brief = buildWriterUnblockBrief({
            refusal: { status: 'too_short', reason: 'Bản nháp chỉ có 270 từ.', missingRequiredContext: [] },
            attempt: 2,
            maxAttempts: 3
        })
        expect(brief.blocking[0].code).toBe('writer_draft_too_short')
        expect(brief.blocking[0].fix).toContain('đủ độ dài')
        expect(brief.blocking[0].fix).not.toContain('googleIntelSnapshotId')
    })

    it('still produces a usable brief when the writer refused without a reason', () => {
        const brief = buildWriterUnblockBrief({ refusal: null, attempt: 1, maxAttempts: 3 })
        expect(brief.blocking).toHaveLength(1)
        expect(brief.blocking[0].problem.length).toBeGreaterThan(10)
        expect(brief.blocking[0].fix.length).toBeGreaterThan(10)
    })

    it('returns the roadmap topic to the queue instead of burning it', () => {
        expect(isTransientFailureCode('WRITER_DRAFT_UNAVAILABLE')).toBe(true)
    })

    it('does not treat a missing draft as a safe skip that needs no attention', () => {
        // It must stay visible: a run that produced nothing is not a clean skip.
        expect(SAFE_ROADMAP_SKIP_CODES.has('WRITER_DRAFT_UNAVAILABLE')).toBe(false)
    })
})
