'use strict'

const crypto = require('node:crypto')

// The pipeline already had a structural fingerprint, but it compared SETS —
// the set of heading levels (only h2/h3/h4 exist, so it was near-constant) and
// the set of heading modes (order-blind). Two articles laid out identically
// scored as different, and two laid out differently scored as the same. It also
// never recorded what a reader actually perceives as "the same shape again":
// which device opens the article, what each section looks like, and where the
// table or checklist falls. This signature records the ORDER and the SHAPE.

const PRESENTATION_SIGNATURE_VERSION = 'presentation-signature-v1-2026-08-04'

// Dimensions compared independently. A new article must differ from every recent
// one on at least MIN_DIFFERING_DIMENSIONS of them.
const SIGNATURE_DIMENSIONS = Object.freeze([
    'openingDevice',
    'deviceSequence',
    'sectionShapes',
    'headingModes',
    'devicePlacement',
    'closingDevice'
])
const MIN_DIFFERING_DIMENSIONS = 3

// The mechanics an architect may compose with. Naming the layout and explaining
// why it suits the topic stays free-form — that is where the invention lives —
// but the moving parts come from this vocabulary so compliance and difference
// can be verified against the rendered HTML rather than taken on trust.
const OPENING_DEVICES = Object.freeze([
    'scenario-open', 'question-open', 'data-open', 'answer-open',
    'table-open', 'list-open', 'callout-open', 'prose-open'
])
const SECTION_SHAPES = Object.freeze([
    'table-led', 'prose-then-table', 'steps-led', 'prose-then-steps',
    'callout-led', 'checklist-led', 'prose-then-checklist',
    'sub-divided-prose', 'prose-with-callout', 'prose-only'
])
const HEADING_MODES = Object.freeze(['question', 'numbered', 'imperative', 'statement'])
const CLOSING_DEVICES = Object.freeze(['table-close', 'list-close', 'callout-close', 'prose-close'])

const fold = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const BLOCK_PATTERN = /<(h2|h3|p|ul|ol|table|aside|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi

const blocksOf = (html) => [...String(html || '').matchAll(BLOCK_PATTERN)].map((match) => ({
    tag: match[1].toLowerCase(),
    inner: match[2]
}))

const headingModeOf = (text) => {
    const folded = fold(text)
    if (/\?$/.test(String(text).trim())) return 'question'
    if (/^\d/.test(folded)) return 'numbered'
    if (/^(cach|lam sao|hay|kiem tra|chon|tranh|dung|khong nen|nen|xu ly)\b/.test(folded)) return 'imperative'
    if (/^(khi nao|vi sao|tai sao|co nen|bao lau|bao nhieu)\b/.test(folded)) return 'question'
    return 'statement'
}

// What a section looks like, judged by the devices it actually contains and the
// order they appear in — not by its heading wording.
const sectionShapeOf = (blocks) => {
    const devices = blocks.filter((block) => block.tag !== 'h2').map((block) => block.tag)
    if (!devices.length) return 'empty'
    const has = (tag) => devices.includes(tag)
    // The lead device is whatever the reader meets first in the section. Skipping
    // past a leading paragraph reported "checklist-led" for a section that in fact
    // opens on prose, collapsing two visibly different shapes into one.
    const leadDevice = devices[0]
    if (has('table') && leadDevice === 'table') return 'table-led'
    if (has('table')) return 'prose-then-table'
    if (has('ol') && leadDevice === 'ol') return 'steps-led'
    if (has('ol')) return 'prose-then-steps'
    if (has('aside') && leadDevice === 'aside') return 'callout-led'
    if (has('ul') && leadDevice === 'ul') return 'checklist-led'
    if (has('ul')) return 'prose-then-checklist'
    if (has('h3')) return 'sub-divided-prose'
    if (has('aside')) return 'prose-with-callout'
    return 'prose-only'
}

const openingDeviceOf = (html) => {
    const source = String(html || '')
    const head = source.split(/<h2\b/i)[0] || ''
    const blocks = blocksOf(head)
    if (!blocks.length) return 'none'
    const first = blocks[0]
    if (first.tag === 'table') return 'table-open'
    if (first.tag === 'ul' || first.tag === 'ol') return 'list-open'
    if (first.tag === 'aside') return 'callout-open'
    const text = fold(first.inner)
    if (/\?$/.test(first.inner.trim())) return 'question-open'
    // "Nhiều người…" and "Nhiều gia đình…" are the same rhetorical opening; the
    // detector must not treat a synonym as a different presentation.
    if (/^(nhieu|phan lon|khong it|hau het|neu|khi|dung de|co bao gio|tuong tuong)\b/.test(text)) return 'scenario-open'
    if (/^\d|\b\d+(?:[.,]\d+)?\s*(?:%|phut|gio|lit|kg|do|nam|thang|lan)\b/.test(text)) return 'data-open'
    if (/^(cau tra loi|tra loi nhanh|noi ngan gon|ngan gon)/.test(text)) return 'answer-open'
    return 'prose-open'
}

const closingDeviceOf = (html) => {
    const blocks = blocksOf(html)
    if (!blocks.length) return 'none'
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
        const block = blocks[index]
        if (block.tag === 'h2' || block.tag === 'h3') break
        if (block.tag === 'table') return 'table-close'
        if (block.tag === 'ul' || block.tag === 'ol') return 'list-close'
        if (block.tag === 'aside') return 'callout-close'
    }
    return 'prose-close'
}

// Where the heavy devices sit across the article, so "table always at the end"
// is visible as a repeated habit.
const devicePlacementOf = (html) => {
    const blocks = blocksOf(html)
    if (!blocks.length) return []
    const third = (index) => index < blocks.length / 3 ? 'early' : index < (blocks.length * 2) / 3 ? 'mid' : 'late'
    const placements = []
    blocks.forEach((block, index) => {
        if (['table', 'ul', 'ol', 'aside'].includes(block.tag)) {
            placements.push(`${block.tag}:${third(index)}`)
        }
    })
    return [...new Set(placements)].sort()
}

const buildPresentationSignature = (html = '') => {
    const source = String(html || '')
    const blocks = blocksOf(source)
    const sections = []
    let current = null
    for (const block of blocks) {
        if (block.tag === 'h2') {
            if (current) sections.push(current)
            current = { heading: fold(block.inner), raw: block.inner, blocks: [] }
        } else if (current) {
            current.blocks.push(block)
        }
    }
    if (current) sections.push(current)

    return {
        version: PRESENTATION_SIGNATURE_VERSION,
        openingDevice: openingDeviceOf(source),
        deviceSequence: blocks.map((block) => block.tag),
        sectionShapes: sections.map((section) => sectionShapeOf(section.blocks)),
        headingModes: sections.map((section) => headingModeOf(section.raw)),
        devicePlacement: devicePlacementOf(source),
        closingDevice: closingDeviceOf(source),
        sectionCount: sections.length
    }
}

const sequenceSimilarity = (left = [], right = []) => {
    const a = Array.isArray(left) ? left : []
    const b = Array.isArray(right) ? right : []
    if (!a.length && !b.length) return 1
    if (!a.length || !b.length) return 0
    // Levenshtein over the token sequences: order matters, unlike the set
    // comparison this replaces.
    const rows = Array.from({ length: a.length + 1 }, (_, index) => {
        const row = new Array(b.length + 1).fill(0)
        row[0] = index
        return row
    })
    for (let column = 0; column <= b.length; column += 1) rows[0][column] = column
    for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
            rows[i][j] = Math.min(
                rows[i - 1][j] + 1,
                rows[i][j - 1] + 1,
                rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            )
        }
    }
    return Number((1 - rows[a.length][b.length] / Math.max(a.length, b.length)).toFixed(4))
}

const dimensionSimilarity = (dimension, left, right) => {
    const leftValue = left?.[dimension]
    const rightValue = right?.[dimension]
    if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
        return sequenceSimilarity(leftValue, rightValue)
    }
    return String(leftValue || '') === String(rightValue || '') ? 1 : 0
}

const DIMENSION_SAME_THRESHOLD = 0.75

// A candidate layout is acceptable only when it differs from EVERY recent layout
// on at least MIN_DIFFERING_DIMENSIONS. Differing from the average is not
// enough: repeating one specific article's shape is exactly what a reader sees.
const comparePresentation = ({
    candidate,
    recent = [],
    minDifferingDimensions = MIN_DIFFERING_DIMENSIONS
} = {}) => {
    const comparisons = (Array.isArray(recent) ? recent : []).filter(Boolean).map((entry) => {
        const perDimension = {}
        let differing = 0
        for (const dimension of SIGNATURE_DIMENSIONS) {
            const similarity = dimensionSimilarity(dimension, candidate, entry)
            perDimension[dimension] = similarity
            if (similarity < DIMENSION_SAME_THRESHOLD) differing += 1
        }
        return {
            sourceId: String(entry?.sourceId || entry?.blogId || ''),
            perDimension,
            differingDimensions: differing,
            tooSimilar: differing < minDifferingDimensions
        }
    })
    const collisions = comparisons.filter((entry) => entry.tooSimilar)
    const worst = [...comparisons].sort((left, right) => left.differingDimensions - right.differingDimensions)[0] || null
    return {
        version: PRESENTATION_SIGNATURE_VERSION,
        passed: collisions.length === 0,
        minDifferingDimensions,
        comparedCount: comparisons.length,
        collisions,
        worst,
        repeatedDimensions: worst
            ? SIGNATURE_DIMENSIONS.filter((dimension) => worst.perDimension[dimension] >= DIMENSION_SAME_THRESHOLD)
            : []
    }
}

const signatureHash = (signature = {}) => crypto
    .createHash('sha256')
    .update(JSON.stringify(SIGNATURE_DIMENSIONS.map((dimension) => signature[dimension] ?? null)))
    .digest('hex')

module.exports = {
    CLOSING_DEVICES,
    DIMENSION_SAME_THRESHOLD,
    HEADING_MODES,
    MIN_DIFFERING_DIMENSIONS,
    OPENING_DEVICES,
    SECTION_SHAPES,
    PRESENTATION_SIGNATURE_VERSION,
    SIGNATURE_DIMENSIONS,
    blocksOf,
    buildPresentationSignature,
    closingDeviceOf,
    comparePresentation,
    devicePlacementOf,
    dimensionSimilarity,
    headingModeOf,
    openingDeviceOf,
    sectionShapeOf,
    sequenceSimilarity,
    signatureHash
}
