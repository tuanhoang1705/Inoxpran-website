'use strict'

const crypto = require('node:crypto')
const { Types } = require('mongoose')
const { QaTopicReservation } = require('../models/qaTopicReservation.model')
const { QaTopicReservationLock } = require('../models/qaTopicReservationLock.model')
const { ContentInventoryItem } = require('../models/contentInventoryItem.model')
const { blog: BlogPost } = require('../models/blog.model')
const { BadRequestError, ConflictRequestError } = require('../core/error.response')
const { QA_ENVIRONMENTS, QA_EXECUTION_MODES } = require('../config/agenticBlogQa.config')

const PAGE_SIZE = 200
const MAX_PAGINATED_COMPARISONS = 10_000
const SEMANTIC_LOCK_LEASE_MS = 30_000
const SEMANTIC_SIMILARITY_THRESHOLD = 0.78
const OUTLINE_SIMILARITY_THRESHOLD = 0.85

const sha256 = value => crypto.createHash('sha256').update(String(value || '')).digest('hex')

const normalizeTopicKey = value => String(value || '')
  .replace(/[\u0111\u0110]/g, character => (character === '\u0111' ? 'd' : 'D'))
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ')

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'bai', 'ban', 'bi', 'cac', 'cach', 'can', 'cho', 'co', 'cua', 'de', 'duoc',
  'gia', 'guide', 'hay', 'huong', 'la', 'list', 'mot', 'nhung', 'nen', 'nhat', 'of', 'the', 'thi',
  'to', 'top', 'tot', 'tu', 'va', 've', 'voi'
])

const TOKEN_ALIASES = Object.freeze({
  best: 'ranking',
  bestseller: 'ranking',
  hangdau: 'ranking',
  ranking: 'ranking',
  top: 'ranking',
  chon: 'select',
  lua: 'select',
  mua: 'select',
  danhgia: 'review',
  review: 'review',
  sosanh: 'compare',
  compare: 'compare',
  xoong: 'noi',
  saucepan: 'noi',
  cookware: 'noi'
})

const semanticTokens = value => normalizeTopicKey(value)
  .replace(/([a-z])(\d)/g, '$1 $2')
  .replace(/(\d)([a-z])/g, '$1 $2')
  .split(' ')
  .filter(Boolean)
  .map(token => (/^\d+$/.test(token) ? 'number' : (TOKEN_ALIASES[token] || token)))
  .filter(token => token !== 'number' && !STOP_WORDS.has(token))

const normalizeSemanticText = value => Array.from(new Set(semanticTokens(value))).sort().join(' ')

const normalizeOutline = outline => (Array.isArray(outline) ? outline : [])
  .map(item => typeof item === 'string' ? item : (item?.heading || item?.title || item?.text || ''))
  .map(normalizeSemanticText)
  .filter(Boolean)

const buildSemanticProfile = ({
  effectiveTopic,
  mainEntity = '',
  topicCore = '',
  searchIntent = '',
  userProblem = '',
  audience = '',
  articleType = '',
  contentRole = '',
  plannedOutline = [],
  entitySummary = []
} = {}) => {
  const outline = normalizeOutline(plannedOutline)
  const profile = {
    mainEntityKey: normalizeSemanticText(mainEntity || (Array.isArray(entitySummary) ? entitySummary.join(' ') : entitySummary)),
    topicCoreKey: normalizeSemanticText(topicCore || effectiveTopic),
    searchIntentKey: normalizeSemanticText(searchIntent),
    userProblemKey: normalizeSemanticText(userProblem),
    audienceKey: normalizeSemanticText(audience),
    articleTypeKey: normalizeSemanticText(articleType),
    contentRoleKey: normalizeSemanticText(contentRole),
    outline
  }
  profile.signature = Array.from(new Set([
    ...semanticTokens(profile.mainEntityKey),
    ...semanticTokens(profile.topicCoreKey),
    ...semanticTokens(profile.searchIntentKey),
    ...semanticTokens(profile.userProblemKey),
    ...semanticTokens(profile.audienceKey),
    ...semanticTokens(profile.articleTypeKey),
    ...semanticTokens(profile.contentRoleKey),
    ...outline.flatMap(semanticTokens)
  ])).sort()
  return profile
}

const setSimilarity = (left = [], right = []) => {
  const a = new Set(Array.isArray(left) ? left : semanticTokens(left))
  const b = new Set(Array.isArray(right) ? right : semanticTokens(right))
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

const profileSimilarity = (left, right) => {
  const signature = setSimilarity(left?.signature, right?.signature)
  const topicCore = setSimilarity(left?.topicCoreKey, right?.topicCoreKey)
  const mainEntity = setSimilarity(left?.mainEntityKey, right?.mainEntityKey)
  const userProblem = setSimilarity(left?.userProblemKey, right?.userProblemKey)
  const outline = setSimilarity((left?.outline || []).flatMap(semanticTokens), (right?.outline || []).flatMap(semanticTokens))
  const sameIntent = Boolean(left?.searchIntentKey && left.searchIntentKey === right?.searchIntentKey)
  const sameArticleType = Boolean(left?.articleTypeKey && left.articleTypeKey === right?.articleTypeKey)
  const score = Math.max(
    signature,
    topicCore * 0.7 + mainEntity * 0.15 + Math.max(userProblem, outline) * 0.15,
    topicCore * 0.75 + (sameIntent ? 0.15 : 0) + (sameArticleType ? 0.1 : 0)
  )
  const conflict =
    topicCore >= 0.88 ||
    signature >= SEMANTIC_SIMILARITY_THRESHOLD ||
    score >= SEMANTIC_SIMILARITY_THRESHOLD ||
    outline >= OUTLINE_SIMILARITY_THRESHOLD ||
    (mainEntity >= 0.8 && userProblem >= 0.65 && (sameIntent || sameArticleType))
  return { score, signature, topicCore, mainEntity, userProblem, outline, sameIntent, sameArticleType, conflict }
}

const buildTopicFingerprint = normalizedTopicKey => sha256(`qa-topic-v1\0${normalizedTopicKey}`)
const buildSemanticFingerprint = profile => sha256(`qa-topic-semantic-v1\0${JSON.stringify(profile)}`)
const buildOutlineFingerprint = profile => sha256(`qa-topic-outline-v1\0${JSON.stringify(profile?.outline || [])}`)
const buildReservationId = ({ environment, normalizedTopicKey, batchId, caseId }) =>
  `qa-topic:${sha256(`${environment}\0${normalizedTopicKey}\0${batchId}\0${caseId}`)}`

const assertObjectId = (value, field) => {
  if (!Types.ObjectId.isValid(String(value || ''))) throw new BadRequestError(`${field} is invalid`)
  return new Types.ObjectId(String(value))
}

const qaConflict = (code, message, details = null) => {
  const error = new ConflictRequestError(message)
  error.code = code
  if (details) error.details = details
  return error
}

const toPlain = value => value && typeof value.toObject === 'function' ? value.toObject() : value

const runPaginatedFind = async ({
  Model,
  filter = {},
  select = '',
  pageSize = PAGE_SIZE,
  maxRows = MAX_PAGINATED_COMPARISONS,
  onPage = null
}) => {
  if (!Model?.find) return []
  const rows = []
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    if (onPage) await onPage()
    let query = Model.find(filter)
    if (query?.sort) query = query.sort({ _id: 1 })
    if (select && query?.select) query = query.select(select)
    const supportsPagination = Boolean(query?.skip && query?.limit)
    if (supportsPagination) query = query.skip(offset).limit(pageSize)
    if (query?.lean) query = query.lean()
    const page = await query
    if (onPage) await onPage()
    const normalized = Array.isArray(page) ? page : []
    rows.push(...normalized)
    if (!supportsPagination || normalized.length < pageSize) return rows
  }
  throw qaConflict('QA_TOPIC_CORPUS_LIMIT_EXCEEDED', 'The semantic uniqueness corpus exceeded its fail-closed comparison bound')
}

const profileFromCorpusRow = row => buildSemanticProfile({
  effectiveTopic: row?.topicSummary || row?.blog_title || row?.title || '',
  mainEntity: Array.isArray(row?.entitySummary) ? row.entitySummary.join(' ') : '',
  searchIntent: row?.primaryIntent || '',
  articleType: row?.articleType || '',
  contentRole: row?.contentRole || '',
  plannedOutline: row?.headingSummary || row?.structuralFingerprint?.headings || []
})

class QaTopicUniquenessService {
  constructor({
    ReservationModel = QaTopicReservation,
    LockModel = ReservationModel === QaTopicReservation ? QaTopicReservationLock : null,
    InventoryItemModel = ContentInventoryItem,
    BlogModel = BlogPost,
    now = () => new Date()
  } = {}) {
    this.ReservationModel = ReservationModel
    this.LockModel = LockModel
    this.InventoryItemModel = InventoryItemModel
    this.BlogModel = BlogModel
    this.now = now
  }

  async _acquireSemanticLock(environment) {
    if (!this.LockModel?.findOneAndUpdate) return { owner: '', bypassedForInjectedTestModel: true }
    const owner = `qa-topic-lock:${process.pid}:${crypto.randomUUID()}`
    const lockId = `qa-topic-reservation:${environment}`
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const now = this.now()
      try {
        let query = this.LockModel.findOneAndUpdate(
          {
            _id: lockId,
            $or: [
              { leaseUntil: { $lte: now } },
              { leaseUntil: null },
              { leaseUntil: { $exists: false } },
              { owner }
            ]
          },
          { $set: { environment, owner, leaseUntil: new Date(now.getTime() + SEMANTIC_LOCK_LEASE_MS) } },
          { upsert: true, new: true, runValidators: true }
        )
        if (query?.lean) query = query.lean()
        const lock = await query
        if (lock?.owner === owner) return { lockId, owner }
      } catch (error) {
        if (error?.code !== 11000) throw error
      }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw qaConflict('QA_TOPIC_RESERVATION_BUSY', 'The semantic topic reservation lock could not be acquired safely')
  }

  async _renewSemanticLock(lock) {
    if (!lock?.owner || !this.LockModel?.updateOne) return true
    const now = this.now()
    const renewed = await this.LockModel.updateOne(
      { _id: lock.lockId, owner: lock.owner, leaseUntil: { $gt: now } },
      { $set: { leaseUntil: new Date(now.getTime() + SEMANTIC_LOCK_LEASE_MS) } }
    )
    const matched = Number(renewed?.matchedCount ?? renewed?.modifiedCount ?? renewed?.n ?? 0)
    if (matched !== 1) {
      throw qaConflict('QA_TOPIC_RESERVATION_LOCK_LOST', 'The semantic topic reservation lock was lost before the reservation committed')
    }
    return true
  }

  async _releaseSemanticLock(lock) {
    if (!lock?.owner || !this.LockModel?.updateOne) return
    await this.LockModel.updateOne(
      { _id: lock.lockId, owner: lock.owner },
      { $set: { owner: '', leaseUntil: new Date(0) } }
    )
  }

  async _existingReservation(reservationId) {
    if (!this.ReservationModel?.findById) return null
    let query = this.ReservationModel.findById(reservationId)
    if (query?.lean) query = query.lean()
    return query
  }

  async assertSemanticallyUnique({ environment, caseId, normalizedTopicKey, semanticProfile, semanticLock = null }) {
    const renewLock = semanticLock ? () => this._renewSemanticLock(semanticLock) : null
    const [reservations, inventoryItems, recentBlogs] = await Promise.all([
      runPaginatedFind({
        Model: this.ReservationModel,
        filter: { status: { $ne: 'released' }, caseId: { $ne: caseId } },
        select: 'caseId normalizedTopicKey semanticFingerprint semanticProfile',
        onPage: renewLock
      }),
      runPaginatedFind({
        Model: this.InventoryItemModel,
        filter: { status: { $ne: 'inactive' } },
        select: 'blogId title topicSummary articleType contentRole primaryIntent entitySummary headingSummary',
        onPage: renewLock
      }),
      runPaginatedFind({
        Model: this.BlogModel,
        filter: { sourceType: 'agentic' },
        select: '_id blog_title topicSummary contentRole primaryIntent entitySummary structuralFingerprint',
        onPage: renewLock
      })
    ])

    const candidates = [
      ...reservations.map(item => ({
        source: 'qa_reservation',
        id: String(item.caseId || ''),
        normalizedTopicKey: item.normalizedTopicKey,
        semanticProfile: item.semanticProfile
      })),
      ...inventoryItems.map(item => ({ source: 'content_inventory', id: String(item.blogId || ''), semanticProfile: profileFromCorpusRow(item) })),
      ...recentBlogs.map(item => ({ source: 'recent_agentic_blog', id: String(item._id || ''), semanticProfile: profileFromCorpusRow(item) }))
    ]

    for (const candidate of candidates) {
      if (candidate.normalizedTopicKey && candidate.normalizedTopicKey === normalizedTopicKey) {
        throw qaConflict('QA_TOPIC_ALREADY_RESERVED', 'The normalized QA topic already exists', {
          source: candidate.source,
          conflictingId: candidate.id,
          similarity: 1
        })
      }
      if (!candidate.semanticProfile) continue
      const similarity = profileSimilarity(semanticProfile, candidate.semanticProfile)
      if (similarity.conflict) {
        throw qaConflict('QA_TOPIC_SEMANTIC_DUPLICATE', 'The QA topic is too similar to reserved or existing content', {
          source: candidate.source,
          conflictingId: candidate.id,
          similarity: Number(similarity.score.toFixed(4))
        })
      }
    }
    return { checked: true, comparisonCount: candidates.length }
  }

  async reserve({
    batchId,
    caseId,
    environment,
    executionMode,
    originalTopicSeed,
    effectiveTopic,
    mainEntity = '',
    topicCore = '',
    searchIntent = '',
    userProblem = '',
    audience = '',
    articleType = '',
    contentRole = '',
    plannedOutline = [],
    executionId = null
  }) {
    const normalizedEnvironment = String(environment || '').trim().toLowerCase()
    if (!QA_ENVIRONMENTS.includes(normalizedEnvironment)) {
      throw new BadRequestError('QA topic reservations are limited to local and staging')
    }
    if (!QA_EXECUTION_MODES.includes(executionMode)) throw new BadRequestError('executionMode is invalid')
    const normalizedTopicKey = normalizeTopicKey(effectiveTopic || originalTopicSeed)
    if (!normalizedTopicKey) throw new BadRequestError('QA topic is required')
    const normalizedBatchId = assertObjectId(batchId, 'batchId')
    const normalizedCaseId = assertObjectId(caseId, 'caseId')
    const reservationId = buildReservationId({
      environment: normalizedEnvironment,
      normalizedTopicKey,
      batchId: normalizedBatchId,
      caseId: normalizedCaseId
    })
    const semanticProfile = buildSemanticProfile({
      effectiveTopic,
      mainEntity,
      topicCore,
      searchIntent,
      userProblem,
      audience,
      articleType,
      contentRole,
      plannedOutline
    })
    const document = {
      _id: reservationId,
      isQaTest: true,
      batchId: normalizedBatchId,
      caseId: normalizedCaseId,
      qaBatchId: normalizedBatchId,
      qaCaseId: normalizedCaseId,
      environment: normalizedEnvironment,
      executionMode,
      originalTopicSeed: String(originalTopicSeed || effectiveTopic || '').trim(),
      effectiveTopic: String(effectiveTopic || originalTopicSeed || '').trim(),
      normalizedTopicKey,
      topicFingerprint: buildTopicFingerprint(normalizedTopicKey),
      semanticFingerprint: buildSemanticFingerprint(semanticProfile),
      outlineFingerprint: buildOutlineFingerprint(semanticProfile),
      semanticProfile,
      status: 'reserved',
      reservedAt: this.now(),
      executionId: executionId ? assertObjectId(executionId, 'executionId') : null
    }

    const lock = await this._acquireSemanticLock(normalizedEnvironment)
    try {
      const existing = await this._existingReservation(reservationId)
      if (existing) {
        if (String(existing.batchId) === String(normalizedBatchId) && String(existing.caseId) === String(normalizedCaseId)) {
          return { reservation: existing, duplicate: true, idempotent: true }
        }
        throw qaConflict('QA_TOPIC_ALREADY_RESERVED', 'The normalized QA topic is already reserved by another case')
      }
      await this.assertSemanticallyUnique({
        environment: normalizedEnvironment,
        caseId: normalizedCaseId,
        normalizedTopicKey,
        semanticProfile,
        semanticLock: lock
      })
      await this._renewSemanticLock(lock)
      try {
        const created = await this.ReservationModel.create(document)
        return { reservation: toPlain(created), duplicate: false }
      } catch (error) {
        if (error?.code !== 11000) throw error
        const duplicate = await this._existingReservation(reservationId)
        if (duplicate && String(duplicate.batchId) === String(normalizedBatchId) && String(duplicate.caseId) === String(normalizedCaseId)) {
          return { reservation: duplicate, duplicate: true, idempotent: true }
        }
        throw qaConflict('QA_TOPIC_ALREADY_RESERVED', 'The normalized, semantic, or outline QA topic is already reserved by another case')
      }
    } finally {
      await this._releaseSemanticLock(lock)
    }
  }

  async releaseUnbound({ reservationId, batchId, caseId }) {
    const normalizedBatchId = assertObjectId(batchId, 'batchId')
    const normalizedCaseId = assertObjectId(caseId, 'caseId')
    if (!this.ReservationModel?.updateOne) return { released: false }
    const releasedAt = this.now()
    const result = await this.ReservationModel.updateOne({
      _id: String(reservationId || ''),
      batchId: normalizedBatchId,
      caseId: normalizedCaseId,
      status: 'reserved',
      blogId: null,
      executionId: null,
      'consumptions.0': { $exists: false }
    }, {
      $set: { status: 'released', releasedAt }
    })
    return { released: Number(result?.modifiedCount ?? result?.nModified ?? 0) === 1, releasedAt }
  }

  async reserveBeforeWriter({ schedule, executionId, topic }) {
    if (schedule?.isQaTest !== true) return null
    if (schedule.mode !== 'fixed_brief') throw qaConflict('QA_FIXED_BRIEF_REQUIRED', 'QA writer executions require fixed_brief mode')
    if (schedule.draftOnly !== true || schedule.autoPublish === true) {
      throw qaConflict('QA_DRAFT_ONLY_REQUIRED', 'QA writer executions must remain draft-only')
    }
    const actualKey = normalizeTopicKey(topic)
    if (!actualKey || actualKey !== String(schedule.normalizedTopicKey || '')) {
      throw qaConflict('QA_TOPIC_CONFIG_DRIFT', 'The QA schedule topic no longer matches its persisted topic reservation')
    }
    const config = schedule.agentConfig || {}
    return this.reserve({
      batchId: schedule.qaBatchId,
      caseId: schedule.qaCaseId,
      environment: schedule.environment,
      executionMode: schedule.executionMode,
      originalTopicSeed: schedule.originalTopicSeed,
      effectiveTopic: topic,
      mainEntity: config.mainEntity,
      topicCore: config.topicCore,
      searchIntent: config.searchIntent,
      userProblem: config.userProblem,
      audience: config.audience,
      articleType: config.articleType,
      contentRole: config.contentRole,
      plannedOutline: config.outline,
      executionId
    })
  }

  async consume({ reservationId, batchId, caseId, blogId, executionId, iteration = 0, executionMode = '' }) {
    const normalizedReservationId = String(reservationId || '')
    const normalizedBatchId = assertObjectId(batchId, 'batchId')
    const normalizedCaseId = assertObjectId(caseId, 'caseId')
    const normalizedBlogId = assertObjectId(blogId, 'blogId')
    const normalizedExecutionId = assertObjectId(executionId, 'executionId')
    const normalizedIteration = Number(iteration)
    if (!Number.isInteger(normalizedIteration) || normalizedIteration < 0 || normalizedIteration > 3) {
      throw new BadRequestError('iteration must be between 0 and 3')
    }
    const normalizedExecutionMode = String(executionMode || '').trim()
    if (!QA_EXECUTION_MODES.includes(normalizedExecutionMode)) throw new BadRequestError('executionMode is invalid')
    const existing = await this._existingReservation(normalizedReservationId)
    if (!existing || String(existing.batchId) !== String(normalizedBatchId) || String(existing.caseId) !== String(normalizedCaseId)) {
      throw qaConflict('QA_TOPIC_RESERVATION_LOST', 'QA topic reservation is missing or belongs to another case')
    }
    if (existing.status === 'consumed') {
      const retainedConsumption = (existing.consumptions || []).find(item => Number(item.iteration) === normalizedIteration)
      if (retainedConsumption) {
        if (
          String(retainedConsumption.blogId || '') === String(normalizedBlogId) &&
          String(retainedConsumption.executionId || '') === String(normalizedExecutionId) &&
          retainedConsumption.executionMode === normalizedExecutionMode
        ) return existing
        throw qaConflict('QA_TOPIC_RESERVATION_REBIND_FORBIDDEN', 'A QA topic reservation iteration cannot be rebound')
      }
      if (!(existing.consumptions || []).length && normalizedIteration === 0) {
        if (
          String(existing.blogId || '') === String(normalizedBlogId) &&
          String(existing.executionId || '') === String(normalizedExecutionId)
        ) return existing
        throw qaConflict('QA_TOPIC_RESERVATION_REBIND_FORBIDDEN', 'A consumed QA topic reservation cannot be rebound')
      }
      const consumedAt = this.now()
      const advanced = await this.ReservationModel.findOneAndUpdate(
        {
          _id: normalizedReservationId,
          batchId: normalizedBatchId,
          caseId: normalizedCaseId,
          status: 'consumed',
          consumptions: { $not: { $elemMatch: { iteration: normalizedIteration } } }
        },
        {
          $set: { consumedAt, blogId: normalizedBlogId, executionId: normalizedExecutionId },
          $push: { consumptions: { iteration: normalizedIteration, executionMode: normalizedExecutionMode, blogId: normalizedBlogId, executionId: normalizedExecutionId, consumedAt } }
        },
        { new: true }
      ).lean()
      if (advanced) return advanced
      const raced = await this._existingReservation(normalizedReservationId)
      const racedConsumption = (raced?.consumptions || []).find(item => Number(item.iteration) === normalizedIteration)
      if (
        String(racedConsumption?.blogId || '') === String(normalizedBlogId) &&
        String(racedConsumption?.executionId || '') === String(normalizedExecutionId) &&
        racedConsumption?.executionMode === normalizedExecutionMode
      ) return raced
      throw qaConflict('QA_TOPIC_RESERVATION_REBIND_FORBIDDEN', 'A QA topic reservation iteration cannot be rebound')
    }
    if (existing.status !== 'reserved') {
      throw qaConflict('QA_TOPIC_RESERVATION_LOST', 'QA topic reservation is not available for consumption')
    }
    const updated = await this.ReservationModel.findOneAndUpdate(
      {
        _id: normalizedReservationId,
        batchId: normalizedBatchId,
        caseId: normalizedCaseId,
        status: 'reserved'
      },
      {
        $set: {
          status: 'consumed',
          consumedAt: this.now(),
          blogId: normalizedBlogId,
          executionId: normalizedExecutionId
        },
        $push: {
          consumptions: {
            iteration: normalizedIteration,
            executionMode: normalizedExecutionMode,
            blogId: normalizedBlogId,
            executionId: normalizedExecutionId,
            consumedAt: this.now()
          }
        }
      },
      { new: true }
    ).lean()
    if (!updated) {
      const raced = await this._existingReservation(normalizedReservationId)
      if (
        raced?.status === 'consumed' &&
        String(raced.blogId || '') === String(normalizedBlogId) &&
        String(raced.executionId || '') === String(normalizedExecutionId) &&
        (raced.consumptions || []).some(item =>
          Number(item.iteration) === normalizedIteration && item.executionMode === normalizedExecutionMode
        )
      ) return raced
      throw qaConflict('QA_TOPIC_RESERVATION_REBIND_FORBIDDEN', 'QA topic reservation consumption conflicted with another binding')
    }
    return updated
  }
}

module.exports = {
  MAX_PAGINATED_COMPARISONS,
  OUTLINE_SIMILARITY_THRESHOLD,
  PAGE_SIZE,
  QaTopicUniquenessService,
  buildOutlineFingerprint,
  buildReservationId,
  buildSemanticFingerprint,
  buildSemanticProfile,
  buildTopicFingerprint,
  normalizeSemanticText,
  normalizeTopicKey,
  profileSimilarity,
  qaConflict,
  semanticTokens,
  setSimilarity
}
