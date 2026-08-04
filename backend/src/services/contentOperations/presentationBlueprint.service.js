'use strict'

const { OpenClawAgentAdapter } = require('../openclawAgentAdapter.service')
const {
    CLOSING_DEVICES,
    HEADING_MODES,
    MIN_DIFFERING_DIMENSIONS,
    OPENING_DEVICES,
    SECTION_SHAPES,
    comparePresentation
} = require('./presentationSignature.service')

// Telling a writer only what to avoid makes it drift back to the shape it knows.
// An architect agent instead designs a layout FOR this topic, is shown what the
// recent articles already look like, and must produce something measurably
// different. The fixed catalogue of 17 style families this replaces guaranteed a
// repeat every 17 posts; an invented composition has no such ceiling.

const BLUEPRINT_VERSION = 'presentation-blueprint-v1-2026-08-04'
const MAX_DESIGN_ATTEMPTS = 2
const MIN_SECTIONS = 3
const MAX_SECTIONS = 7

// Register varies the delivery, never the brand. reviewBrandVoice remains the
// hard gate, so these shift rhythm and stance inside its bounds.
const VOICE_REGISTERS = Object.freeze([
    'điềm tĩnh - giải thích cơ chế',
    'dứt khoát - cảnh báo an toàn',
    'thân tình - kinh nghiệm bếp núc',
    'phân tích - so sánh lựa chọn',
    'hướng dẫn - thao tác từng bước',
    'gỡ rối - chẩn đoán sự cố'
])

const text = (value, max = 200) => String(value ?? '')
    .replace(new RegExp('[\u0000-\u001f\u007f]', 'g'), '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

const pickFrom = (value, allowed, fallback) => {
    const candidate = text(value, 60).toLowerCase()
    return allowed.includes(candidate) ? candidate : fallback
}

const normalizeBlueprint = (raw = {}, { sectionTarget = 4 } = {}) => {
    const sections = (Array.isArray(raw.sections) ? raw.sections : [])
        .slice(0, MAX_SECTIONS)
        .map((section, index) => ({
            label: text(section?.label || section?.shape || `Mục ${index + 1}`, 120),
            shape: pickFrom(section?.shape, SECTION_SHAPES, 'prose-only'),
            headingMode: pickFrom(section?.headingMode, HEADING_MODES, 'statement'),
            intent: text(section?.intent, 200)
        }))
    // Pad only up to the minimum. Padding toward a target overwrote a deliberate
    // three-section design with a fourth empty prose section, which is itself a
    // way of forcing every article back toward the same shape.
    while (sections.length < MIN_SECTIONS) {
        sections.push({
            label: `Mục ${sections.length + 1}`,
            shape: 'prose-only',
            headingMode: 'statement',
            intent: ''
        })
    }
    return {
        version: BLUEPRINT_VERSION,
        layoutName: text(raw.layoutName, 80) || 'bố-cục-tự-thiết-kế',
        why: text(raw.why, 300),
        openingDevice: pickFrom(raw.openingDevice, OPENING_DEVICES, 'prose-open'),
        closingDevice: pickFrom(raw.closingDevice, CLOSING_DEVICES, 'prose-close'),
        voiceRegister: text(raw.voiceRegister, 80) || VOICE_REGISTERS[0],
        rhythm: text(raw.rhythm, 120),
        sections
    }
}

// The blueprint is graded with the same comparator that will later grade the
// rendered article, so a design cannot be approved on criteria the finished
// draft is not held to.
const blueprintAsSignature = (blueprint = {}) => ({
    openingDevice: blueprint.openingDevice,
    sectionShapes: blueprint.sections.map((section) => section.shape),
    headingModes: blueprint.sections.map((section) => section.headingMode),
    closingDevice: blueprint.closingDevice,
    deviceSequence: blueprint.sections.flatMap((section) => ['h2', section.shape]),
    devicePlacement: []
})

const recentSummaryFor = (recent = []) => (Array.isArray(recent) ? recent : []).slice(0, 8).map((entry) => ({
    openingDevice: entry.openingDevice,
    sectionShapes: entry.sectionShapes,
    headingModes: entry.headingModes,
    closingDevice: entry.closingDevice
}))

class PresentationBlueprintService {
    constructor({
        agentAdapter = new OpenClawAgentAdapter(),
        minDifferingDimensions = MIN_DIFFERING_DIMENSIONS,
        maxAttempts = MAX_DESIGN_ATTEMPTS
    } = {}) {
        this.agentAdapter = agentAdapter
        this.minDifferingDimensions = minDifferingDimensions
        this.maxAttempts = Math.max(1, Math.min(3, Number(maxAttempts) || MAX_DESIGN_ATTEMPTS))
    }

    async design({
        topic,
        primaryQuestion = '',
        searchIntent = '',
        articleType = '',
        recentPresentations = [],
        recentVoiceRegisters = [],
        sessionKey = ''
    } = {}) {
        const recentSummary = recentSummaryFor(recentPresentations)
        let lastVerdict = null
        let lastBlueprint = null

        for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
            const response = await this.agentAdapter.run({
                agentId: 'content-architect',
                purpose: 'presentation-blueprint',
                sessionKey: sessionKey ? `${sessionKey}:${attempt}` : '',
                input: {
                    topic: text(topic, 300),
                    primaryQuestion: text(primaryQuestion, 300),
                    searchIntent: text(searchIntent, 80),
                    articleType: text(articleType, 80),
                    recentLayouts: recentSummary,
                    recentVoiceRegisters: (recentVoiceRegisters || []).slice(0, 8).map((item) => text(item, 80)),
                    vocabulary: {
                        openingDevice: OPENING_DEVICES,
                        sectionShape: SECTION_SHAPES,
                        headingMode: HEADING_MODES,
                        closingDevice: CLOSING_DEVICES
                    },
                    voiceRegisterExamples: VOICE_REGISTERS,
                    collisionFeedback: lastVerdict
                        ? {
                            repeatedDimensions: lastVerdict.repeatedDimensions,
                            note: 'Thiết kế trước vẫn trùng bố cục gần đây ở các chiều này. Đổi chúng.'
                        }
                        : null,
                    attempt
                },
                instructions: [
                    'Do not call tools. Design the presentation of ONE Vietnamese article about the supplied topic.',
                    'Return exactly one JSON object with keys: layoutName, why, openingDevice, closingDevice, voiceRegister, rhythm, sections.',
                    `sections must be an array of ${MIN_SECTIONS}-${MAX_SECTIONS} objects with keys: label, shape, headingMode, intent.`,
                    'layoutName, why, label, intent, voiceRegister and rhythm are yours to invent — do not copy the examples.',
                    'openingDevice, closingDevice, shape and headingMode MUST be values from the supplied vocabulary.',
                    'recentLayouts are the shapes already used. Your design must differ from EVERY one of them in at least three of: openingDevice, the sequence of section shapes, the sequence of heading modes, and closingDevice.',
                    'Choose the shape that genuinely serves this topic and this reader question; do not vary for the sake of variation.',
                    'Do not write article text, headings or any HTML.'
                ].join(' ')
            })

            const blueprint = normalizeBlueprint(response.output || {}, { sectionTarget: 4 })
            const verdict = comparePresentation({
                candidate: blueprintAsSignature(blueprint),
                recent: recentSummary,
                minDifferingDimensions: this.minDifferingDimensions
            })
            lastBlueprint = blueprint
            lastVerdict = verdict
            if (verdict.passed || !recentSummary.length) {
                return { blueprint, verdict, attempts: attempt, audit: response.audit || null }
            }
        }

        // A design that still collides is returned with its verdict rather than
        // thrown: the editorial board will grade the rendered article anyway, and
        // failing the whole run here would block a draft over layout alone.
        return { blueprint: lastBlueprint, verdict: lastVerdict, attempts: this.maxAttempts, audit: null }
    }
}

module.exports = {
    BLUEPRINT_VERSION,
    MAX_DESIGN_ATTEMPTS,
    MAX_SECTIONS,
    MIN_SECTIONS,
    PresentationBlueprintService,
    VOICE_REGISTERS,
    blueprintAsSignature,
    normalizeBlueprint,
    recentSummaryFor
}
