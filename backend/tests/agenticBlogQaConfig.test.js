import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    MAX_REMEDIATION_ITERATIONS,
    MINIMUM_EXISTING_SEO_SCORE,
    QA_EXECUTION_MODES,
    SENIOR_ACCEPTANCE_SCORE,
    buildAgenticBlogQaConfig,
    buildControlledQaTopicVariant,
    buildDefaultQaCaseMatrix
} = require('../src/config/agenticBlogQa.config');
const {
    QA_MODELS,
    assertQaDatabaseIsolation,
    ensureQaInfrastructureOnce,
    resetQaInfrastructureEnsureForTests
} = require('../src/services/agenticBlogQaInfrastructure.service');

const enabledConfig = (environment = 'local', overrides = {}) => buildAgenticBlogQaConfig({
    AGENTIC_BLOG_QA_ENABLED: 'true',
    AGENTIC_BLOG_QA_ENVIRONMENT: environment,
    AGENTIC_BLOG_QA_DATABASE_NAME: `inoxpran_qa_${environment}`,
    ...overrides
});

describe('Agentic Blog QA configuration safety contract', () => {
    it('is disabled by default and preserves every fixed acceptance boundary', () => {
        const config = buildAgenticBlogQaConfig({ NODE_ENV: 'production' });

        expect(config).toMatchObject({
            enabled: false,
            environment: 'production',
            requiredScore: 81,
            seniorRequiredScore: 81,
            existingSeoThreshold: 85,
            maxIterations: 3,
            requireAllCasesPass: true,
            allowPublicPublish: false,
            telegramEnabled: false,
            paidImagesEnabled: false,
            blindReviewEnabled: true,
            topicUniquenessEnabled: true,
            localRunNowCases: 3,
            localScheduleCases: 3,
            stagingRunNowCases: 2,
            stagingScheduleCases: 2
        });
        expect(Object.isFrozen(config)).toBe(true);
        expect(SENIOR_ACCEPTANCE_SCORE).toBe(81);
        expect(MINIMUM_EXISTING_SEO_SCORE).toBe(85);
        expect(MAX_REMEDIATION_ITERATIONS).toBe(3);
    });

    it('requires an explicit local or staging environment whenever QA is enabled', () => {
        expect(() => buildAgenticBlogQaConfig({ AGENTIC_BLOG_QA_ENABLED: 'true' }))
            .toThrow('explicit local or staging');
        expect(() => enabledConfig('production')).toThrow('explicit local or staging');
        expect(() => enabledConfig('development')).toThrow('explicit local or staging');
        expect(enabledConfig('local').environment).toBe('local');
        expect(enabledConfig('staging').environment).toBe('staging');
    });

    it.each([
        ['', 'local'],
        ['inoxpran', 'local'],
        ['inoxpran_production', 'local'],
        ['inoxpran_qa_staging', 'local'],
        ['inoxpran_test_local', 'staging']
    ])('rejects a non-isolated or environment-mismatched QA database: %s', (databaseName, environment) => {
        expect(() => enabledConfig(environment, { AGENTIC_BLOG_QA_DATABASE_NAME: databaseName })).toThrow('isolated QA database');
    });

    it('requires the active connection name to exactly match the isolated configured database', () => {
        const local = enabledConfig('local');
        expect(assertQaDatabaseIsolation({
            config: local,
            connectionName: 'inoxpran_qa_local',
            models: []
        })).toBe('inoxpran_qa_local');
        expect(() => assertQaDatabaseIsolation({
            config: local,
            connectionName: 'inoxpran_qa_staging',
            models: []
        })).toThrow('not connected');
        expect(() => assertQaDatabaseIsolation({
            config: { ...local, databaseName: 'inoxpran_local' },
            connectionName: 'inoxpran_local',
            models: []
        })).toThrow('not safely isolated');
    });

    it('binds every persisted QA lineage model to the isolated database assertion set', () => {
        const modelNames = new Set(QA_MODELS.map((Model) => Model.modelName));
        expect(modelNames).toEqual(new Set([
            'AgenticBlogQaBatch',
            'AgenticBlogQaCase',
            'QaTopicReservation',
            'QaTopicReservationLock',
            'SeniorBlogAcceptanceReport',
            'QaRemediationAttempt',
            'BlogAutomationSchedule',
            'BlogAutomationExecution',
            'BlogPost',
            'ContentOperationsRun',
            'ContentOpportunityDecision',
            'ContentWorkOrder',
            'UnifiedContentBrief',
            'ResearchBundle',
            'EvidenceMap',
            'EditorialStyleProfile',
            'BlogStrategyPlan',
            'ProductSeedPlan',
            'EditorialProductPlacementPlan',
            'ContentPublishReadinessReport',
            'GoogleIntelligenceSnapshot',
            'GoogleIntelligenceRun',
            'ContentOperationsDailySnapshot',
            'ContentInventorySnapshot',
            'ContentInventoryItem',
            'ProductCatalogSnapshot'
        ]));
    });

    it('keys infrastructure ensures by active connection and reasserts isolation on every call', async () => {
        resetQaInfrastructureEnsureForTests();
        const config = enabledConfig('local');
        const Model = {
            modelName: 'QaFixture',
            db: { name: config.databaseName },
            collection: { name: 'qa_fixtures' },
            createCollection: vi.fn().mockResolvedValue(undefined),
            createIndexes: vi.fn().mockResolvedValue(['qa_fixture_index'])
        };

        await ensureQaInfrastructureOnce({ config, models: [Model] });
        await ensureQaInfrastructureOnce({ config, models: [Model] });
        expect(Model.createCollection).toHaveBeenCalledTimes(1);

        Model.db = { name: config.databaseName };
        await ensureQaInfrastructureOnce({ config, models: [Model] });
        expect(Model.createCollection).toHaveBeenCalledTimes(2);

        Model.db = { name: 'inoxpran_production' };
        await expect(ensureQaInfrastructureOnce({ config, models: [Model] }))
            .rejects.toThrow('not connected');
        expect(Model.createCollection).toHaveBeenCalledTimes(2);
        resetQaInfrastructureEnsureForTests();
    });

    it.each([
        ['AGENTIC_BLOG_QA_REQUIRED_SCORE', '80'],
        ['AGENTIC_BLOG_QA_REQUIRED_SCORE', '82'],
        ['SENIOR_BLOG_AUDITOR_REQUIRED_SCORE', '80'],
        ['SENIOR_BLOG_AUDITOR_REQUIRED_SCORE', '82'],
        ['SEO_AGENT_MIN_SEO_SCORE', '84'],
        ['AGENTIC_BLOG_QA_MAX_ITERATIONS', '4'],
        ['AGENTIC_BLOG_QA_LOCAL_RUN_NOW_CASES', '2'],
        ['AGENTIC_BLOG_QA_LOCAL_SCHEDULE_CASES', '4'],
        ['AGENTIC_BLOG_QA_STAGING_RUN_NOW_CASES', '1'],
        ['AGENTIC_BLOG_QA_STAGING_SCHEDULE_CASES', '3']
    ])('rejects an unsafe or unreviewed fixed setting: %s=%s', (key, value) => {
        expect(() => enabledConfig('local', { [key]: value })).toThrow();
    });

    it.each([
        ['AGENTIC_BLOG_QA_ALLOW_PUBLIC_PUBLISH', 'true'],
        ['AGENTIC_BLOG_QA_TELEGRAM_ENABLED', 'yes'],
        ['AGENTIC_BLOG_QA_PAID_IMAGES_ENABLED', '1'],
        ['AGENTIC_BLOG_QA_REQUIRE_ALL_CASES_PASS', 'false'],
        ['AGENTIC_BLOG_QA_BLIND_REVIEW_ENABLED', 'off'],
        ['AGENTIC_BLOG_QA_TOPIC_UNIQUENESS_ENABLED', '0'],
        ['SENIOR_BLOG_AUDITOR_HARD_GATES_ENABLED', 'false'],
        ['SENIOR_BLOG_AUDITOR_ENABLED', 'false']
    ])('fails closed when a QA safety switch is weakened: %s=%s', (key, value) => {
        expect(() => enabledConfig('local', { [key]: value })).toThrow();
    });
});

describe('reviewed QA case matrix', () => {
    it('contains exactly three Run Now paths and three actual schedules locally', () => {
        const cases = buildDefaultQaCaseMatrix({
            environment: 'local',
            config: enabledConfig('local'),
            variantSeed: 'batch-local-001'
        });

        expect(cases).toHaveLength(6);
        expect(cases.filter(item => ['run_now', 'schedule_run_now'].includes(item.executionMode))).toHaveLength(3);
        expect(cases.filter(item => item.executionMode === 'actual_schedule')).toHaveLength(3);
        expect(cases.some(item => item.executionMode === 'schedule_run_now')).toBe(true);
        expect(cases.every(item => QA_EXECUTION_MODES.includes(item.executionMode))).toBe(true);
        expect(new Set(cases.map(item => item.effectiveTopic)).size).toBe(6);
        expect(new Set(cases.map(item => item.topicCore)).size).toBe(6);
    });

    it('contains exactly two Run Now paths and two actual schedules on staging', () => {
        const cases = buildDefaultQaCaseMatrix({
            environment: 'staging',
            config: enabledConfig('staging'),
            variantSeed: 'batch-staging-001'
        });

        expect(cases).toHaveLength(4);
        expect(cases.filter(item => ['run_now', 'schedule_run_now'].includes(item.executionMode))).toHaveLength(2);
        expect(cases.filter(item => item.executionMode === 'actual_schedule')).toHaveLength(2);
        expect(cases.some(item => item.executionMode === 'schedule_run_now')).toBe(true);
    });

    it('derives repeatable scenario variation without putting hashes or IDs in semantic fields', () => {
        const definition = {
            caseKey: 'LOCAL-RUNNOW-01',
            originalTopicSeed: 'How to understand stainless-steel labels',
            mainEntity: 'stainless-steel labels',
            userProblem: 'understand labels',
            audience: 'home cooks',
            plannedOutline: ['Read the label', 'Verify the claim']
        };
        const first = buildControlledQaTopicVariant({ caseDefinition: definition, variantSeed: 'batch-a' });
        const replay = buildControlledQaTopicVariant({ caseDefinition: definition, variantSeed: 'batch-a' });
        const nextBatch = buildControlledQaTopicVariant({ caseDefinition: definition, variantSeed: 'batch-b' });

        expect(first).toEqual(replay);
        expect(nextBatch.effectiveTopic).not.toBe(first.effectiveTopic);
        const semanticFields = JSON.stringify({
            effectiveTopic: first.effectiveTopic,
            topicCore: first.topicCore,
            userProblem: first.userProblem,
            audience: first.audience,
            plannedOutline: first.plannedOutline
        });
        expect(semanticFields).not.toMatch(/qa-[a-f0-9]{8,}/i);
        expect(semanticFields).not.toMatch(/\b[a-f0-9]{16,}\b/i);
    });

    it('rejects environments without a reviewed topic matrix', () => {
        expect(() => buildDefaultQaCaseMatrix({
            environment: 'production',
            config: enabledConfig('local')
        })).toThrow('No safe QA case matrix');
    });
});
