'use strict'

const { OpenClawAgentAdapter } = require('../openclawAgentAdapter.service')

// The deterministic board measures what rules can measure: structure, density,
// length, layout repetition. It cannot tell whether the advice is actually
// correct, whether the answer really resolves the reader's question, or whether
// a section is filler dressed as substance. A senior editor decides that, and
// like the board it must return named defects with remedies so the writer can
// act on them instead of guessing.
//
// It runs only after the deterministic board passes, so a draft that already
// fails a measurable rule never spends an agent call.

const SENIOR_EDITOR_VERSION = 'senior-editor-review-v1-2026-08-04'
const MAX_FINDINGS = 8
const ALLOWED_SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low'])

const text = (value, max = 400) => String(value ?? '')
    .replace(new RegExp('[\u0000-\u001f\u007f]', 'g'), '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

const normalizeFindings = (raw) => (Array.isArray(raw) ? raw : [])
    .slice(0, MAX_FINDINGS)
    .map((entry, index) => {
        const severity = String(entry?.severity || '').trim().toLowerCase()
        return {
            code: text(entry?.code || entry?.defect || `senior_finding_${index + 1}`, 60)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '') || `senior_finding_${index + 1}`,
            severity: ALLOWED_SEVERITIES.includes(severity) ? severity : 'medium',
            problem: text(entry?.problem || entry?.issue, 400),
            fix: text(entry?.fix || entry?.howToFix || entry?.remedy, 400)
        }
    })
    // A defect without a remedy cannot be acted on, and an empty problem
    // statement is noise. Both are dropped rather than passed to the writer.
    .filter((entry) => entry.problem && entry.fix)

class SeniorEditorReviewService {
    constructor({ agentAdapter = new OpenClawAgentAdapter() } = {}) {
        this.agentAdapter = agentAdapter
    }

    async review({
        html = '',
        title = '',
        topic = '',
        primaryQuestion = '',
        searchIntent = '',
        productNames = [],
        attempt = 1,
        maxAttempts = 3,
        sessionKey = ''
    } = {}) {
        const response = await this.agentAdapter.run({
            agentId: 'senior-editor',
            purpose: 'senior-editorial-acceptance',
            sessionKey: sessionKey ? `${sessionKey}:${attempt}` : '',
            input: {
                title: text(title, 200),
                topic: text(topic, 300),
                primaryQuestion: text(primaryQuestion, 300),
                searchIntent: text(searchIntent, 80),
                productNames: (Array.isArray(productNames) ? productNames : []).slice(0, 6).map((name) => text(name, 120)),
                html: String(html || '').slice(0, 60_000),
                attempt,
                maxAttempts
            },
            instructions: [
                'Do not call tools. You are the senior editor who decides whether this Vietnamese housewares article is fit to publish.',
                'Judge only what rules cannot: is the advice correct and safe, does it truly answer primaryQuestion, is any section filler, does it mislead a Vietnamese household reader, is a claim asserted without support.',
                'Do NOT comment on word count, heading count, keyword placement, layout or formatting — those are already enforced elsewhere.',
                'Return exactly one JSON object: {"verdict":"accept"|"revise","summary":string,"findings":[{"code":string,"severity":"critical"|"high"|"medium"|"low","problem":string,"fix":string}]}.',
                'Use verdict "accept" only when nothing critical or high remains. Report at most 8 findings.',
                'Every finding MUST state the concrete defect in "problem" and an actionable instruction in "fix", both in Vietnamese. Never return a finding without a usable fix.',
                'Never rewrite the article and never return HTML.'
            ].join(' ')
        })

        const output = response?.output || {}
        const findings = normalizeFindings(output.findings)
        const blocking = findings.filter((entry) => entry.severity === 'critical' || entry.severity === 'high')
        // The verdict is derived from the findings rather than trusted directly:
        // an editor that reports a critical defect and still says "accept" must
        // not be able to wave a draft through.
        const accepted = String(output.verdict || '').trim().toLowerCase() === 'accept' && blocking.length === 0
        return {
            version: SENIOR_EDITOR_VERSION,
            passed: accepted,
            verdict: accepted ? 'accept' : 'revise',
            summary: text(output.summary, 600),
            findings,
            blockingFindings: blocking,
            audit: response?.audit || null
        }
    }
}

module.exports = {
    ALLOWED_SEVERITIES,
    MAX_FINDINGS,
    SENIOR_EDITOR_VERSION,
    SeniorEditorReviewService,
    normalizeFindings
}
