'use strict'

const crypto = require('node:crypto')
const { BadRequestError } = require('../core/error.response')

const QA_ENVIRONMENTS = Object.freeze(['local', 'staging'])
const QA_EXECUTION_MODES = Object.freeze(['run_now', 'schedule_run_now', 'actual_schedule'])
const QA_BATCH_STATUSES = Object.freeze([
  'planned',
  'running',
  'reviewing',
  'remediating',
  'awaiting_remediation_action',
  'passed',
  'failed',
  'blocked'
])
const QA_CASE_STATUSES = Object.freeze([
  'planned',
  'reserved',
  'queued',
  'running',
  'draft_created',
  'reviewing',
  'remediating',
  'awaiting_remediation_action',
  'passed',
  'failed',
  'blocked'
])

const SENIOR_ACCEPTANCE_SCORE = 81
const MINIMUM_EXISTING_SEO_SCORE = 85
const MAX_REMEDIATION_ITERATIONS = 3

const DEFAULT_QA_CASE_MATRIX = Object.freeze({
  local: Object.freeze([
    Object.freeze({ caseKey: 'LOCAL-RUNNOW-01', executionMode: 'run_now', articleType: 'technical-explainer', contentRole: 'technical knowledge', searchIntent: 'informational', originalTopicSeed: 'How to understand common stainless-steel material labels used in household cookware', mainEntity: 'stainless-steel material labels', userProblem: 'understand material labels before choosing household cookware', audience: 'household cookware buyers', productMode: 'off', productIntensity: 'light', placementStyle: '', plannedOutline: ['Common labels and what they mean', 'Limits of a material label', 'How to verify a claim'] }),
    Object.freeze({ caseKey: 'LOCAL-SCHEDULE-RUNNOW-01', executionMode: 'schedule_run_now', articleType: 'how-to', contentRole: 'task completion', searchIntent: 'how-to', originalTopicSeed: 'How to clean a burnt stainless-steel pot while reducing the risk of scratching its surface', mainEntity: 'burnt stainless-steel pot', userProblem: 'remove burnt residue without scratching the cooking surface', audience: 'home cooks', productMode: 'off', productIntensity: 'light', placementStyle: '', plannedOutline: ['Assess residue and surface', 'Use the least abrasive cleaning sequence', 'Stop conditions and aftercare'] }),
    Object.freeze({ caseKey: 'LOCAL-RUNNOW-03', executionMode: 'run_now', articleType: 'buying-guide', contentRole: 'decision support', searchIntent: 'commercial investigation', originalTopicSeed: 'How to choose a fan for a small bedroom based on space, airflow, and noise needs', mainEntity: 'fan for a small bedroom', userProblem: 'balance room size airflow and sleep noise', audience: 'people furnishing a small bedroom', productMode: 'auto', productIntensity: 'light', placementStyle: 'criteria-first-recommendation', plannedOutline: ['Measure the room and placement', 'Compare airflow and noise criteria', 'Shortlist only verified suitable options'] }),
    Object.freeze({ caseKey: 'LOCAL-SCHEDULE-01', executionMode: 'actual_schedule', articleType: 'seasonal-guide', contentRole: 'problem solution', searchIntent: 'informational', originalTopicSeed: 'How families can prepare practical cooling options for hot days and short power outages', mainEntity: 'cooling during heat and short power outages', userProblem: 'maintain practical household cooling when grid power is briefly unavailable', audience: 'families preparing for hot weather', productMode: 'auto', productIntensity: 'light', placementStyle: 'problem-solution-late-reveal', plannedOutline: ['Prepare the room before heat peaks', 'Separate powered and non-powered options', 'Build a safe short-outage plan'] }),
    Object.freeze({ caseKey: 'LOCAL-SCHEDULE-02', executionMode: 'actual_schedule', articleType: 'product-care', contentRole: 'care guidance', searchIntent: 'how-to', originalTopicSeed: 'How to clean and store an enamelled cast-iron pot after daily cooking', mainEntity: 'enamelled cast-iron pot', userProblem: 'clean and store enamelled cast iron without damaging the coating', audience: 'home cooks using enamelled cast iron', productMode: 'auto', productIntensity: 'light', placementStyle: 'knowledge-soft-endcap', plannedOutline: ['Cool and clean after cooking', 'Handle stuck residue safely', 'Dry and store to protect the enamel'] }),
    Object.freeze({ caseKey: 'LOCAL-SCHEDULE-03', executionMode: 'actual_schedule', articleType: 'comparison', contentRole: 'comparison decision support', searchIntent: 'commercial investigation', originalTopicSeed: 'Induction cooktops and infrared cooktops: how their everyday cooking use differs', mainEntity: 'induction and infrared cooktops', userProblem: 'understand everyday differences before choosing a cooktop', audience: 'households comparing electric cooktops', productMode: 'auto', productIntensity: 'balanced', placementStyle: 'comparison-matrix-contextual', plannedOutline: ['How each heating method works', 'Everyday cookware and control differences', 'Choose by household scenario'] })
  ]),
  staging: Object.freeze([
    Object.freeze({ caseKey: 'STAGING-RUNNOW-01', executionMode: 'run_now', articleType: 'troubleshooting', contentRole: 'diagnostic guidance', searchIntent: 'troubleshooting', originalTopicSeed: 'A household fan is running weakly: basic checks to perform before requesting repair', mainEntity: 'weak household fan', userProblem: 'perform safe basic checks before requesting repair', audience: 'households with a weak-running fan', productMode: 'off', productIntensity: 'light', placementStyle: '', plannedOutline: ['Confirm the symptom safely', 'Check airflow power and obstruction', 'Know when to stop and request repair'] }),
    Object.freeze({ caseKey: 'STAGING-SCHEDULE-RUNNOW-01', executionMode: 'schedule_run_now', articleType: 'technical-explainer', contentRole: 'product education', searchIntent: 'informational', originalTopicSeed: 'How to understand common cooking modes on an electric pressure cooker', mainEntity: 'electric pressure cooker cooking modes', userProblem: 'understand mode labels and choose a suitable cooking mode', audience: 'home users of electric pressure cookers', productMode: 'auto', productIntensity: 'light', placementStyle: 'knowledge-soft-endcap', plannedOutline: ['What mode labels actually control', 'Match modes to food and liquid', 'Use manual settings safely'] }),
    Object.freeze({ caseKey: 'STAGING-SCHEDULE-01', executionMode: 'actual_schedule', articleType: 'myth-vs-fact', contentRole: 'myth correction', searchIntent: 'informational', originalTopicSeed: 'Common misunderstandings about using stainless-steel pots and pans at home', mainEntity: 'stainless-steel pots and pans', userProblem: 'separate common cookware myths from safe practical use', audience: 'home cooks using stainless steel', productMode: 'off', productIntensity: 'light', placementStyle: '', plannedOutline: ['Heating and sticking myths', 'Discoloration and safety myths', 'Evidence-based use habits'] }),
    Object.freeze({ caseKey: 'STAGING-SCHEDULE-02', executionMode: 'actual_schedule', articleType: 'scenario-based', contentRole: 'space planning guidance', searchIntent: 'informational', originalTopicSeed: 'How to organize and use household appliances in a compact kitchen', mainEntity: 'household appliances in a compact kitchen', userProblem: 'organize appliances safely with limited counter and storage space', audience: 'people living with a compact kitchen', productMode: 'auto', productIntensity: 'light', placementStyle: 'scenario-contextual', plannedOutline: ['Map tasks power and ventilation', 'Create daily and occasional appliance zones', 'Adapt the layout to common scenarios'] })
  ])
})

const CONTROLLED_VARIANT_DIMENSIONS = Object.freeze({
  household: Object.freeze([
    'a first-time renter household', 'a two-person urban household', 'a multigenerational household',
    'a family with school-age children', 'a household caring for an older adult', 'a shared apartment household',
    'a home cook preparing small portions', 'a household preparing batch meals'
  ]),
  setting: Object.freeze([
    'a compact kitchen with limited storage', 'a humid coastal home', 'a narrow townhouse kitchen',
    'an apartment with limited ventilation', 'a frequently used family kitchen', 'a low-noise bedroom setting',
    'a home with intermittent grid power', 'a kitchen with mixed cookware types'
  ]),
  constraint: Object.freeze([
    'prioritising low-abrasion care', 'prioritising verifiable safety claims', 'prioritising low-noise operation',
    'prioritising energy-aware daily use', 'prioritising limited counter space', 'prioritising simple maintenance',
    'prioritising cautious first-time use', 'prioritising a modest replacement budget'
  ]),
  stage: Object.freeze([
    'during initial setup', 'during routine weekly care', 'before a replacement decision',
    'after an unexpected performance change', 'while comparing two practical options', 'during hot-weather preparation',
    'after daily cooking', 'before requesting professional service'
  ])
})

const controlledIndex = (hash, offset, length) => Number.parseInt(hash.slice(offset, offset + 4), 16) % length

const buildQaRunSlotKeyHash = ({ caseId, iteration, executionMode }) => crypto
  .createHash('sha256')
  .update(`agentic-blog-qa-run-slot-v1\0${String(caseId || '')}\0${Number(iteration || 0)}\0${String(executionMode || '')}`)
  .digest('hex')

const buildControlledQaTopicVariant = ({ caseDefinition, variantSeed, probe = 0 }) => {
  const hash = crypto.createHash('sha256')
    .update(`agentic-blog-qa-topic-v1\0${variantSeed}\0${caseDefinition.caseKey}\0${probe}`)
    .digest('hex')
  const household = CONTROLLED_VARIANT_DIMENSIONS.household[controlledIndex(hash, 0, CONTROLLED_VARIANT_DIMENSIONS.household.length)]
  const setting = CONTROLLED_VARIANT_DIMENSIONS.setting[controlledIndex(hash, 4, CONTROLLED_VARIANT_DIMENSIONS.setting.length)]
  const constraint = CONTROLLED_VARIANT_DIMENSIONS.constraint[controlledIndex(hash, 8, CONTROLLED_VARIANT_DIMENSIONS.constraint.length)]
  const stage = CONTROLLED_VARIANT_DIMENSIONS.stage[controlledIndex(hash, 12, CONTROLLED_VARIANT_DIMENSIONS.stage.length)]
  const scenario = `${household} in ${setting}, ${constraint}, ${stage}`
  const variationKey = `qa-${hash.slice(0, 16)}`
  return {
    ...caseDefinition,
    effectiveTopic: `${caseDefinition.originalTopicSeed} - scenario for ${scenario}`,
    topicCore: `${caseDefinition.mainEntity}; ${scenario}`,
    userProblem: `${caseDefinition.userProblem}; specifically for ${scenario}`,
    audience: `${caseDefinition.audience}; ${household}; ${setting}`,
    plannedOutline: (caseDefinition.plannedOutline || []).map((heading, index) =>
      index === 0 ? `${heading} for ${constraint}` : heading
    ),
    variationKey
  }
}

const buildDefaultQaCaseMatrix = ({ environment, config, variantSeed = 'reviewed-default', probe = 0 }) => {
  const matrix = DEFAULT_QA_CASE_MATRIX[environment]
  if (!matrix) throw new BadRequestError('No safe QA case matrix exists for this environment')
  const runNowCount = environment === 'local' ? config.localRunNowCases : config.stagingRunNowCases
  const scheduleCount = environment === 'local' ? config.localScheduleCases : config.stagingScheduleCases
  const runNow = matrix.filter(item => ['run_now', 'schedule_run_now'].includes(item.executionMode)).slice(0, runNowCount)
  const scheduled = matrix.filter(item => item.executionMode === 'actual_schedule').slice(0, scheduleCount)
  if (runNow.length !== runNowCount || scheduled.length !== scheduleCount) {
    throw new BadRequestError('Configured QA case counts exceed the reviewed safe topic matrix')
  }
  return [...runNow, ...scheduled].map(item => buildControlledQaTopicVariant({
    caseDefinition: item,
    variantSeed,
    probe
  }))
}

const BOOLEAN_TRUE = new Set(['1', 'true', 'yes', 'on'])
const BOOLEAN_FALSE = new Set(['0', 'false', 'no', 'off'])

const readBoolean = (value, fallback, key) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (BOOLEAN_TRUE.has(normalized)) return true
  if (BOOLEAN_FALSE.has(normalized)) return false
  throw new BadRequestError(`${key} must be a boolean`)
}

const readInteger = (value, fallback, { key, min, max }) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new BadRequestError(`${key} must be an integer between ${min} and ${max}`)
  }
  return number
}

const requireSafetyFalse = (value, key) => {
  const enabled = readBoolean(value, false, key)
  if (enabled) throw new BadRequestError(`${key} must remain false for Agentic Blog QA`)
  return false
}

const requireSafetyTrue = (value, fallback, key) => {
  const enabled = readBoolean(value, fallback, key)
  if (!enabled) throw new BadRequestError(`${key} must remain true for Agentic Blog QA`)
  return true
}

const buildAgenticBlogQaConfig = (env = process.env) => {
  const enabled = readBoolean(env.AGENTIC_BLOG_QA_ENABLED, false, 'AGENTIC_BLOG_QA_ENABLED')
  const explicitEnvironment = String(env.AGENTIC_BLOG_QA_ENVIRONMENT || '').trim().toLowerCase()
  const environment = explicitEnvironment || (String(env.NODE_ENV || '').toLowerCase() === 'production' ? 'production' : 'local')
  if (enabled && (!explicitEnvironment || !QA_ENVIRONMENTS.includes(environment))) {
    throw new BadRequestError('Enabled Agentic Blog QA requires explicit local or staging environment')
  }
  if (!enabled && ![...QA_ENVIRONMENTS, 'production'].includes(environment)) {
    throw new BadRequestError('AGENTIC_BLOG_QA_ENVIRONMENT must be local, staging, or production while disabled')
  }
  const databaseName = String(env.AGENTIC_BLOG_QA_DATABASE_NAME || '').trim()
  if (enabled) {
    const databaseTokens = databaseName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    if (!databaseName ||
      (!databaseTokens.includes('qa') && !databaseTokens.includes('test')) ||
      !databaseTokens.includes(environment)) {
      throw new BadRequestError('Enabled Agentic Blog QA requires an explicitly isolated QA database name for the active environment')
    }
  }

  const requiredScore = readInteger(
    env.AGENTIC_BLOG_QA_REQUIRED_SCORE,
    SENIOR_ACCEPTANCE_SCORE,
    { key: 'AGENTIC_BLOG_QA_REQUIRED_SCORE', min: SENIOR_ACCEPTANCE_SCORE, max: SENIOR_ACCEPTANCE_SCORE }
  )
  const seniorRequiredScore = readInteger(
    env.SENIOR_BLOG_AUDITOR_REQUIRED_SCORE,
    SENIOR_ACCEPTANCE_SCORE,
    { key: 'SENIOR_BLOG_AUDITOR_REQUIRED_SCORE', min: SENIOR_ACCEPTANCE_SCORE, max: SENIOR_ACCEPTANCE_SCORE }
  )
  const existingSeoThreshold = readInteger(
    env.SEO_AGENT_MIN_SEO_SCORE,
    MINIMUM_EXISTING_SEO_SCORE,
    { key: 'SEO_AGENT_MIN_SEO_SCORE', min: MINIMUM_EXISTING_SEO_SCORE, max: 100 }
  )

  const config = {
    enabled,
    environment,
    databaseName,
    requiredScore,
    seniorRequiredScore,
    existingSeoThreshold,
    maxIterations: readInteger(
      env.AGENTIC_BLOG_QA_MAX_ITERATIONS,
      MAX_REMEDIATION_ITERATIONS,
      { key: 'AGENTIC_BLOG_QA_MAX_ITERATIONS', min: 1, max: MAX_REMEDIATION_ITERATIONS }
    ),
    requireAllCasesPass: requireSafetyTrue(
      env.AGENTIC_BLOG_QA_REQUIRE_ALL_CASES_PASS,
      true,
      'AGENTIC_BLOG_QA_REQUIRE_ALL_CASES_PASS'
    ),
    allowPublicPublish: requireSafetyFalse(
      env.AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH,
      'AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH'
    ),
    telegramEnabled: requireSafetyFalse(
      env.AGENTIC_BLOG_QA_TELEGRAM_ENABLED,
      'AGENTIC_BLOG_QA_TELEGRAM_ENABLED'
    ),
    paidImagesEnabled: requireSafetyFalse(
      env.AGENTIC_BLOG_QA_PAID_IMAGES_ENABLED,
      'AGENTIC_BLOG_QA_PAID_IMAGES_ENABLED'
    ),
    blindReviewEnabled: requireSafetyTrue(
      env.AGENTIC_BLOG_QA_BLIND_REVIEW_ENABLED,
      true,
      'AGENTIC_BLOG_QA_BLIND_REVIEW_ENABLED'
    ),
    topicUniquenessEnabled: requireSafetyTrue(
      env.AGENTIC_BLOG_QA_TOPIC_UNIQUENESS_ENABLED,
      true,
      'AGENTIC_BLOG_QA_TOPIC_UNIQUENESS_ENABLED'
    ),
    seniorAuditorEnabled: readBoolean(
      env.SENIOR_BLOG_AUDITOR_ENABLED,
      true,
      'SENIOR_BLOG_AUDITOR_ENABLED'
    ),
    hardGatesEnabled: requireSafetyTrue(
      env.SENIOR_BLOG_AUDITOR_HARD_GATES_ENABLED,
      true,
      'SENIOR_BLOG_AUDITOR_HARD_GATES_ENABLED'
    ),
    localRunNowCases: readInteger(env.AGENTIC_BLOG_QA_LOCAL_RUN_NOW_CASES, 3, {
      key: 'AGENTIC_BLOG_QA_LOCAL_RUN_NOW_CASES', min: 3, max: 3
    }),
    localScheduleCases: readInteger(env.AGENTIC_BLOG_QA_LOCAL_SCHEDULE_CASES, 3, {
      key: 'AGENTIC_BLOG_QA_LOCAL_SCHEDULE_CASES', min: 3, max: 3
    }),
    stagingRunNowCases: readInteger(env.AGENTIC_BLOG_QA_STAGING_RUN_NOW_CASES, 2, {
      key: 'AGENTIC_BLOG_QA_STAGING_RUN_NOW_CASES', min: 2, max: 2
    }),
    stagingScheduleCases: readInteger(env.AGENTIC_BLOG_QA_STAGING_SCHEDULE_CASES, 2, {
      key: 'AGENTIC_BLOG_QA_STAGING_SCHEDULE_CASES', min: 2, max: 2
    })
  }

  if (enabled && !config.seniorAuditorEnabled) {
    throw new BadRequestError('SENIOR_BLOG_AUDITOR_ENABLED must be true when Agentic Blog QA is enabled')
  }
  return Object.freeze(config)
}

module.exports = {
  MAX_REMEDIATION_ITERATIONS,
  DEFAULT_QA_CASE_MATRIX,
  MINIMUM_EXISTING_SEO_SCORE,
  QA_BATCH_STATUSES,
  QA_CASE_STATUSES,
  QA_ENVIRONMENTS,
  QA_EXECUTION_MODES,
  SENIOR_ACCEPTANCE_SCORE,
  buildDefaultQaCaseMatrix,
  buildControlledQaTopicVariant,
  buildQaRunSlotKeyHash,
  CONTROLLED_VARIANT_DIMENSIONS,
  buildAgenticBlogQaConfig,
  readBoolean,
  readInteger
}
