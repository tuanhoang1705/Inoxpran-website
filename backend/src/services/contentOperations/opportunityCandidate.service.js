'use strict'

const crypto = require('node:crypto')
const { ACTIONS } = require('../../config/contentOperations.config')

const clamp01 = (value) => {
    const number = Number(value)
    if (!Number.isFinite(number)) return 0
    return Math.min(1, Math.max(0, number > 1 ? number / 100 : number))
}

const text = (value, max = 300) => String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

const stableId = (value) => crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 24)

const safeUrlPath = (value) => {
    try {
        const url = new URL(String(value || ''), 'https://inoxpran.invalid')
        return decodeURI(url.pathname).replace(/\/+$/, '') || '/'
    } catch (_error) {
        return ''
    }
}

const slugFromPage = (value) => {
    const match = safeUrlPath(value).match(/^\/blog\/([^/]+)$/i)
    return match ? decodeURIComponent(match[1]) : ''
}

const normalizeInventoryItem = (item = {}) => ({
    ...item,
    id: String(item._id || item.id || item.blogId || ''),
    blogId: String(item.blogId || item._id || item.id || ''),
    title: text(item.title || item.blog_title),
    slug: text(item.slug || item.blog_slug, 200),
    warnings: Array.isArray(item.warnings) ? item.warnings.map(String) : []
})

const factorSet = (overrides = {}) => ({
    userDemand: clamp01(overrides.userDemand),
    contentGap: clamp01(overrides.contentGap),
    performance: clamp01(overrides.performance),
    business: clamp01(overrides.business),
    freshness: clamp01(overrides.freshness),
    customerSignal: clamp01(overrides.customerSignal),
    productCampaign: clamp01(overrides.productCampaign),
    evidence: clamp01(overrides.evidence),
    internalLink: clamp01(overrides.internalLink),
    userValue: clamp01(overrides.userValue ?? Math.max(
        overrides.userDemand || 0,
        overrides.contentGap || 0,
        overrides.performance || 0,
        overrides.customerSignal || 0,
        overrides.freshness || 0,
        overrides.internalLink || 0
    ))
})

const candidate = ({ action, topic, targets = [], evidence = [], factors = {}, risks = [], reason, sourceKey }) => {
    const targetBlogIds = targets.map((item) => String(item?.blogId || item)).filter(Boolean)
    return {
        candidateId: stableId({ action, topic, targetBlogIds, sourceKey }),
        decisionType: action,
        topic: text(topic),
        targetBlogIds,
        primaryTargetBlogId: targetBlogIds[0] || null,
        factors: factorSet(factors),
        applicableFactors: Object.keys(factors).filter((key) => key !== 'userValue'),
        positiveEvidence: evidence.slice(0, 30),
        requiredData: action === ACTIONS.NEW ? ['google_intelligence_snapshot', 'content_inventory_snapshot'] : ['content_inventory_snapshot'],
        missingData: [],
        risks: [...new Set(risks.map(String))],
        penaltySignals: {
            cannibalizationRisk: risks.includes('cannibalization_risk') ? 0.8 : 0,
            staleProductData: risks.includes('stale_product_evidence') ? 0.35 : 0,
            lowConfidence: factors.evidence && Number(factors.evidence) < 0.4 ? 0.4 : 0
        },
        decisionReason: text(reason, 2000)
    }
}

const pageIndex = (items) => {
    const map = new Map()
    items.forEach((item) => {
        if (item.slug) map.set(`/blog/${item.slug}`, item)
        if (item.canonicalUrl) map.set(safeUrlPath(item.canonicalUrl), item)
    })
    return map
}

const latestAvailableSearchWindow = (snapshot = {}) => {
    const windows = snapshot.websitePerformance?.searchConsole?.windows
    if (!Array.isArray(windows)) return null
    return windows.find((window) => window?.status === 'available') || null
}

const generateSearchCandidates = ({ snapshot, inventoryItems }) => {
    const window = latestAvailableSearchWindow(snapshot)
    if (!window) return []
    const index = pageIndex(inventoryItems)
    const signals = window.signals || {}
    const generated = []

    for (const signal of (signals.lowCtrPages || []).slice(0, 30)) {
        const item = index.get(safeUrlPath(signal.page))
        if (!item) continue
        generated.push(candidate({
            action: ACTIONS.METADATA_REFRESH,
            topic: item.title,
            targets: [item],
            sourceKey: `low_ctr:${signal.page}`,
            evidence: [{ source: 'google_search_console', windowDays: window.days, type: 'low_ctr_page', observed: signal }],
            factors: { userDemand: Math.min(1, (signal.impressions || 0) / 1000), performance: 0.88, evidence: 0.95, freshness: 0.35, userValue: 0.7 },
            reason: 'Search Console shows meaningful impressions with weak click-through rate; a scoped metadata refresh can improve discovery without rewriting the article.'
        }))
    }

    for (const signal of (signals.decayingPages || []).slice(0, 30)) {
        const item = index.get(safeUrlPath(signal.page))
        if (!item) continue
        const action = item.wordCount < 800 ? ACTIONS.EXPAND : ACTIONS.UPDATE
        generated.push(candidate({
            action,
            topic: item.title,
            targets: [item],
            sourceKey: `decay:${signal.page}`,
            evidence: [{ source: 'google_search_console', windowDays: window.days, type: 'decaying_page', observed: signal }],
            factors: { userDemand: 0.72, performance: 0.95, contentGap: action === ACTIONS.EXPAND ? 0.8 : 0.55, freshness: item.reviewStatus === 'stale' ? 0.95 : 0.65, evidence: 0.95, userValue: 0.82 },
            reason: `Observed search traffic decay supports a revision-safe ${action} action on the existing canonical URL.`
        }))
    }

    for (const signal of (signals.cannibalization || []).slice(0, 20)) {
        const targets = (signal.pages || []).map((page) => index.get(safeUrlPath(page))).filter(Boolean)
        if (targets.length < 2) continue
        generated.push(candidate({
            action: ACTIONS.MERGE,
            topic: text(signal.query || targets[0].title),
            targets,
            sourceKey: `cannibalization:${signal.query}`,
            evidence: [{ source: 'google_search_console', windowDays: window.days, type: 'cannibalization', observed: signal }],
            factors: { userDemand: 0.7, contentGap: 0.65, performance: 0.75, freshness: 0.45, evidence: 0.9, internalLink: 0.5, userValue: 0.78 },
            risks: ['merge_requires_editorial_review'],
            reason: 'Multiple existing pages receive impressions for the same query. Produce a merge plan for review; do not delete or redirect source URLs automatically.'
        }))
    }

    for (const signal of (signals.queryGaps || []).slice(0, 30)) {
        generated.push(candidate({
            action: ACTIONS.NEW,
            topic: text(signal.query),
            sourceKey: `query_gap:${signal.query}`,
            evidence: [{ source: 'google_search_console', windowDays: window.days, type: 'query_gap', observed: signal }],
            factors: { userDemand: Math.min(1, (signal.impressions || 0) / 250), contentGap: 0.92, performance: 0.6, evidence: 0.9, userValue: 0.86 },
            reason: 'Verified search demand is not currently earning clicks and maps to no selected existing target, supporting a new content work order.'
        }))
    }
    return generated
}

const generateInventoryCandidates = (items) => {
    const generated = []
    for (const item of items) {
        const warnings = new Set(item.warnings)
        if (warnings.has('broken_blog_link') || warnings.has('no_outbound_blog_links') || warnings.has('orphan_content')) {
            generated.push(candidate({
                action: ACTIONS.INTERNAL_LINK_MAINTENANCE,
                topic: item.title,
                targets: [item],
                sourceKey: `links:${item.blogId}`,
                evidence: [{ source: 'content_inventory', type: 'link_graph', blogId: item.blogId, warnings: item.warnings }],
                factors: { contentGap: 0.7, freshness: 0.65, evidence: 0.95, internalLink: warnings.has('broken_blog_link') ? 1 : 0.86, userValue: 0.72 },
                reason: 'The content inventory found an actionable internal-link issue. Limit changes to verified internal links and preserve the article body and canonical URL.'
            }))
        }
        if (warnings.has('broken_product_link') || warnings.has('inactive_product_link') || warnings.has('stale_product_evidence')) {
            generated.push(candidate({
                action: ACTIONS.CONTENT_MAINTENANCE,
                topic: item.title,
                targets: [item],
                sourceKey: `product-evidence:${item.blogId}`,
                evidence: [{ source: 'content_inventory', type: 'product_evidence_freshness', blogId: item.blogId, warnings: item.warnings }],
                factors: { contentGap: 0.7, business: 0.6, freshness: 0.92, productCampaign: 0.65, evidence: 0.9, userValue: 0.78 },
                risks: warnings.has('stale_product_evidence') ? ['stale_product_evidence'] : [],
                reason: 'Inventory evidence shows stale or invalid product references. Stage only the affected factual/link changes for review.'
            }))
        }
        if (item.reviewStatus === 'stale' || item.reviewStatus === 'review_due') {
            const action = item.wordCount < 650 ? ACTIONS.EXPAND : ACTIONS.UPDATE
            generated.push(candidate({
                action,
                topic: item.title,
                targets: [item],
                sourceKey: `review:${item.blogId}`,
                evidence: [{ source: 'content_inventory', type: 'review_freshness', blogId: item.blogId, reviewStatus: item.reviewStatus, wordCount: item.wordCount }],
                factors: { contentGap: item.wordCount < 650 ? 0.82 : 0.5, freshness: item.reviewStatus === 'stale' ? 0.95 : 0.7, evidence: 0.82, userValue: 0.65 },
                reason: `The existing article is ${item.reviewStatus}; stage a revision on its current URL and retain unaffected sections.`
            }))
        }
    }
    return generated
}

const generateSignalCandidates = ({ signals = [], snapshot }) => signals.slice(0, 100).map((signal) => candidate({
    action: ACTIONS.NEW,
    topic: text(signal.question || signal.title),
    sourceKey: `signal:${signal.id || signal._id}`,
    evidence: [{ source: `content_signal:${signal.sourceType}`, type: 'cross_department_signal', signalId: String(signal.id || signal._id || ''), summary: text(signal.summary, 500) }, {
        source: 'google_intelligence', type: 'daily_gate', snapshotId: String(snapshot.googleIntelSnapshotId || '')
    }],
    factors: {
        userDemand: signal.priority === 'critical' ? 0.9 : signal.priority === 'high' ? 0.78 : 0.55,
        contentGap: 0.72,
        business: ['campaign', 'sales', 'product'].includes(signal.sourceType) ? 0.75 : 0.45,
        customerSignal: ['customer_support', 'internal_search'].includes(signal.sourceType) ? 0.92 : 0.65,
        productCampaign: ['campaign', 'product', 'inventory'].includes(signal.sourceType) ? 0.8 : 0.25,
        evidence: signal.confidence === 'high' ? 0.85 : signal.confidence === 'medium' ? 0.65 : 0.4,
        userValue: 0.76
    },
    reason: 'A current cross-department signal describes a user question or pain point. It may create demand evidence but cannot bypass evidence and user-value gates.'
}))

const generateFixedBriefCandidate = ({ input = {}, snapshot, inventoryItems }) => {
    const topic = text(input.topic || input.primaryKeyword)
    if (!topic) return null
    if (input.action !== undefined && !Object.values(ACTIONS).includes(input.action)) throw new Error('Unsupported fixed-brief content action')
    const requested = Object.values(ACTIONS).includes(input.action) ? input.action : ACTIONS.NEW
    const target = input.targetBlogId
        ? inventoryItems.find((item) => item.blogId === String(input.targetBlogId))
        : input.targetBlogSlug
            ? inventoryItems.find((item) => item.slug === String(input.targetBlogSlug))
            : null
    if (requested !== ACTIONS.NEW && requested !== ACTIONS.SKIP && !target) return null
    return candidate({
        action: requested,
        topic,
        targets: target ? [target] : [],
        sourceKey: `fixed:${topic}:${requested}`,
        evidence: [{ source: 'operator_brief', type: 'explicit_topic', topic }, {
            source: 'google_intelligence', type: 'daily_gate', snapshotId: String(snapshot.googleIntelSnapshotId || '')
        }],
        factors: {
            userDemand: clamp01(input.userDemandScore ?? 0.72),
            contentGap: clamp01(input.contentGapScore ?? 0.75),
            business: clamp01(input.businessScore ?? 0.65),
            evidence: snapshot.googleIntelSnapshotId ? 0.78 : 0.2,
            freshness: target?.reviewStatus === 'stale' ? 0.85 : 0.58,
            userValue: clamp01(input.userValueScore ?? 0.72)
        },
        reason: 'An operator supplied a fixed brief. The topic remains subject to the same persisted score, evidence, cannibalization, and readiness controls.'
    })
}

const deduplicate = (candidates) => {
    const seen = new Set()
    return candidates.filter((item) => {
        const key = `${item.decisionType}:${item.topic.toLocaleLowerCase('vi')}:${(item.targetBlogIds || []).join(',')}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

const generateOpportunityCandidates = ({ snapshot = {}, inventoryItems = [], signals = [], input = {}, mode = 'best_action' } = {}) => {
    const items = inventoryItems.map(normalizeInventoryItem)
    const fixed = mode === 'fixed_brief' || (mode === 'maintenance_only' && Object.values(ACTIONS).includes(input.action))
        ? generateFixedBriefCandidate({ input, snapshot, inventoryItems: items })
        : null
    let candidates = [
        ...generateSearchCandidates({ snapshot, inventoryItems: items }),
        ...generateInventoryCandidates(items),
        ...generateSignalCandidates({ signals, snapshot }),
        ...(fixed ? [fixed] : [])
    ]
    if (mode === 'fixed_brief') candidates = fixed ? [fixed] : []
    if (mode === 'maintenance_only') {
        const maintenance = new Set([
            ACTIONS.UPDATE,
            ACTIONS.EXPAND,
            ACTIONS.MERGE,
            ACTIONS.METADATA_REFRESH,
            ACTIONS.INTERNAL_LINK_MAINTENANCE,
            ACTIONS.CONTENT_MAINTENANCE
        ])
        candidates = candidates.filter((item) => maintenance.has(item.decisionType))
    }
    return deduplicate(candidates).slice(0, 500)
}

module.exports = {
    candidate,
    factorSet,
    generateOpportunityCandidates,
    generateInventoryCandidates,
    generateSearchCandidates,
    generateSignalCandidates,
    slugFromPage,
    stableId
}
