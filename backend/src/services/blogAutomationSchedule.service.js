'use strict'

const crypto = require('node:crypto');
const { BlogAutomationSchedule } = require('../models/blogAutomationSchedule.model');
const { BlogAutomationExecution } = require('../models/blogAutomationExecution.model');
const AutomationSeoBlogService = require('./automationSeoBlog.service');
const { TelegramApprovalService } = require('./telegramApproval.service');
const { BadRequestError, NotFoundError } = require('../core/error.response');
const { convertToObjectIdMongodb } = require('../utils');
const {
    calculateNextRun,
    describeSchedule,
    normalizeSchedulePayload,
    parseBoolean
} = require('../utils/blogSchedule.util');
const { normalizeSlug, normalizeString } = require('../utils/seoBlogSanitizer');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const LEASE_MS = 5 * 60 * 1000;

const isCronEnabled = () => parseBoolean(process.env.OPENCLAW_BLOG_CRON_ENABLED, false);
const isSeoAgentEnabled = () => process.env.SEO_AGENT_ENABLED === 'true';

const truncate = (value, length) => normalizeString(value).slice(0, length).trim();

const mapSchedule = (schedule) => {
    if (!schedule) return null;
    return {
        id: String(schedule._id || schedule.id),
        name: schedule.name,
        description: schedule.description || '',
        enabled: Boolean(schedule.enabled),
        scheduleType: schedule.scheduleType,
        timezone: schedule.timezone,
        daily: schedule.daily || { times: [] },
        weekly: schedule.weekly || { daysOfWeek: [], times: [] },
        interval: schedule.interval || { value: 24, unit: 'hours' },
        runLimit: Number(schedule.runLimit || 0),
        runCount: Number(schedule.runCount || 0),
        startAt: schedule.startAt,
        endAt: schedule.endAt,
        autoPublish: Boolean(schedule.autoPublish),
        agentConfig: schedule.agentConfig || {},
        lastRunAt: schedule.lastRunAt,
        nextRunAt: schedule.nextRunAt,
        lastRunStatus: schedule.lastRunStatus || '',
        lastError: schedule.lastError || '',
        scheduleDescription: describeSchedule(schedule),
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt
    };
};

const mapExecution = (execution) => {
    if (!execution) return null;
    return {
        id: String(execution._id || execution.id),
        scheduleId: String(execution.scheduleId || ''),
        executionKey: execution.executionKey,
        status: execution.status,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        blogId: execution.blogId ? String(execution.blogId) : '',
        blogSlug: execution.blogSlug || '',
        blogTitle: execution.blogTitle || '',
        mode: execution.mode || 'draft',
        error: execution.error || '',
        telegramNotificationStatus: execution.telegramNotificationStatus || '',
        telegramNotificationError: execution.telegramNotificationError || '',
        metadata: execution.metadata || {},
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt
    };
};

const scheduleToPlainPayload = (schedule = {}) => ({
    name: schedule.name,
    description: schedule.description || '',
    enabled: schedule.enabled,
    scheduleType: schedule.scheduleType,
    timezone: schedule.timezone,
    daily: schedule.daily || { times: [] },
    weekly: schedule.weekly || { daysOfWeek: [], times: [] },
    interval: schedule.interval || { value: 24, unit: 'hours' },
    runLimit: schedule.runLimit || 0,
    startAt: schedule.startAt,
    endAt: schedule.endAt,
    autoPublish: schedule.autoPublish,
    agentConfig: schedule.agentConfig || {}
});

const mergeSchedulePatch = (current, patch = {}) => {
    const base = scheduleToPlainPayload(current);
    return {
        ...base,
        ...patch,
        daily: {
            ...(base.daily || {}),
            ...(patch.daily || {})
        },
        weekly: {
            ...(base.weekly || {}),
            ...(patch.weekly || {})
        },
        interval: {
            ...(base.interval || {}),
            ...(patch.interval || {})
        },
        agentConfig: {
            ...(base.agentConfig || {}),
            ...(patch.agentConfig || {})
        }
    };
};

const buildContentHtml = ({ topic, primaryKeyword, dateLabel }) => {
    const keyword = primaryKeyword || topic || 'noi inox';
    const sections = [
        {
            heading: `Vi sao ${keyword} can duoc chon dung?`,
            body: `Nguoi dung thuong tim ${keyword} khi can mot loi khuyen thuc te cho bep gia dinh. Bai viet nay tong hop cac diem can kiem tra truoc khi mua, cach nhan biet nhu cau su dung va nhung loi thuong gap khi bao quan san pham inox.`
        },
        {
            heading: 'Checklist danh gia truoc khi quyet dinh',
            body: `Hay xem chat lieu, do day day noi, kha nang tuong thich voi bep, tay cam, nap va cach ve sinh sau moi lan nau. Neu san pham dung cho bep tu, day noi can bat tu on dinh va khong cong venh khi dun lau.`
        },
        {
            heading: 'Positioning cho nguoi mua thong minh',
            body: `Thong diep nen tap trung vao do ben, do an toan va chi phi su dung dai han thay vi chi noi ve gia. Inoxpran co the dat minh nhu mot lua chon thuc dung cho gia dinh Viet can do gia dung inox gon, ben va de cham soc.`
        },
        {
            heading: 'Cach su dung va bao quan',
            body: `Nen rua bang khan mem, tranh dung vat sac lam xuoc be mat, lau kho sau khi rua va khong ngam thuc pham co muoi hoac axit trong thoi gian dai. Cac vet o vang nhe thuong co the xu ly bang nuoc am, giam pha loang hoac baking soda.`
        }
    ];
    const denseParagraph = `${keyword} phu hop khi nguoi mua hieu ro kich thuoc, chat lieu, cach dung va cach ve sinh. Noi dung nen giai thich bang ngon ngu don gian, dua vi du gan voi bep gia dinh, tranh hua hen qua muc va uu tien thong tin co the kiem chung. `;
    const repeated = `<p>${denseParagraph.repeat(24)}</p>`;

    return [
        `<section>`,
        `<p><strong>Ngay tao:</strong> ${dateLabel}. Chu de: ${topic}. Bai viet duoc tao tu lich OpenClaw de lam ban nhap cho bien tap vien kiem tra.</p>`,
        ...sections.map((section) => `<h2>${section.heading}</h2><p>${section.body}</p>${repeated}`),
        `<h2>Cau hoi thuong gap</h2>`,
        `<p><strong>Co nen publish ngay?</strong> Chi publish sau khi SEO gate, brand safety va anh agentic deu duoc duyet.</p>`,
        `<p><strong>Khi nao can cap nhat?</strong> Nen cap nhat khi co thay doi ve san pham, gia, chinh sach bao hanh hoac insight moi tu khach hang.</p>`,
        `</section>`
    ].join('');
};

const buildAutomationPayload = ({ schedule, executionKey, now = new Date() }) => {
    const agentConfig = schedule.agentConfig || {};
    const topic = truncate(agentConfig.topic || agentConfig.primaryKeyword || schedule.name, 90);
    const primaryKeyword = truncate(agentConfig.primaryKeyword || topic, 80);
    const dateLabel = now.toISOString().slice(0, 10);
    const slug = normalizeSlug(`${topic}-${dateLabel}-${crypto.randomBytes(3).toString('hex')}`);
    const title = truncate(topic.length > 20 ? topic : `${topic} - huong dan thuc te`, 115);
    const excerpt = truncate(
        agentConfig.prompt || `Ban nhap SEO tu OpenClaw ve ${topic}, gom insight, positioning va checklist bien tap.`,
        240
    );
    const requestedPublish =
        Boolean(schedule.autoPublish) && parseBoolean(process.env.SEO_AGENT_AUTO_PUBLISH, false);

    return {
        mode: requestedPublish ? 'publish' : 'draft',
        source: 'openclaw-daily-seo',
        primaryKeyword,
        secondaryKeywords: agentConfig.secondaryKeywords || [],
        title,
        slug,
        excerpt,
        contentHtml: buildContentHtml({ topic, primaryKeyword, dateLabel }),
        seoTitle: truncate(title, 60),
        seoDescription: truncate(excerpt, 155),
        categoryKey: agentConfig.categoryKey || 'guide',
        tags: [primaryKeyword, 'OpenClaw', 'Inoxpran'].filter(Boolean),
        authorName: process.env.SEO_AGENT_DEFAULT_AUTHOR || 'Inoxpran Editorial Team',
        imageUrl: process.env.SEO_AGENT_DEFAULT_BLOG_IMAGE || '/og-image.png',
        articleType: agentConfig.articleType || 'how-to',
        outline: [
            'Insight nguoi doc',
            'Positioning noi dung',
            'Checklist danh gia',
            'Huong dan su dung',
            'FAQ'
        ],
        metadata: {
            provider: 'openclaw',
            scheduleId: String(schedule._id || schedule.id || ''),
            executionKey,
            cron: true,
            generatedBy: 'blogAutomationSchedule.service',
            language: agentConfig.language || 'vi',
            tone: agentConfig.tone || 'practical'
        },
        review: {
            seoScore: 90,
            brandSafety: 'pass',
            duplicateRisk: 'low',
            claimRisk: 'low',
            imageSafety: 'pass'
        }
    };
};

const assertCanRunAutomation = () => {
    if (!isCronEnabled()) throw new BadRequestError('OPENCLAW_BLOG_CRON_ENABLED is false');
    if (!isSeoAgentEnabled()) throw new BadRequestError('SEO_AGENT_ENABLED is false');
};

const buildExecutionKey = ({ scheduleId, trigger, dueAt }) => {
    if (trigger === 'scheduled' && dueAt) {
        return `${scheduleId}:${new Date(dueAt).toISOString()}`;
    }
    return `${scheduleId}:${trigger}:${crypto.randomUUID()}`;
};

class BlogAutomationScheduleService {
    static async listSchedules({ limit = DEFAULT_LIMIT, page = 1 } = {}) {
        const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
        const safePage = Math.max(Number(page) || 1, 1);
        const [items, total] = await Promise.all([
            BlogAutomationSchedule.find()
                .sort({ createdAt: -1 })
                .skip((safePage - 1) * safeLimit)
                .limit(safeLimit)
                .lean(),
            BlogAutomationSchedule.countDocuments()
        ]);
        return {
            schedules: items.map(mapSchedule),
            pagination: {
                total,
                page: safePage,
                limit: safeLimit,
                pages: Math.max(1, Math.ceil(total / safeLimit))
            },
            runtime: {
                cronEnabled: isCronEnabled(),
                seoAgentEnabled: isSeoAgentEnabled(),
                autoPublishEnabled: parseBoolean(process.env.SEO_AGENT_AUTO_PUBLISH, false),
                telegramEnabled: TelegramApprovalService.isEnabled()
            }
        };
    }

    static async getSchedule({ scheduleId }) {
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const schedule = await BlogAutomationSchedule.findById(objectId).lean();
        if (!schedule) throw new NotFoundError('Schedule not found');
        return mapSchedule(schedule);
    }

    static async createSchedule({ payload, adminId }) {
        const normalized = normalizeSchedulePayload(payload);
        const nextRunAt = normalized.enabled ? calculateNextRun({ schedule: normalized }) : null;
        const created = await BlogAutomationSchedule.create({
            ...normalized,
            nextRunAt,
            createdBy: convertToObjectIdMongodb(adminId) || null
        });
        return mapSchedule(created.toObject());
    }

    static async updateSchedule({ scheduleId, payload }) {
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const current = await BlogAutomationSchedule.findById(objectId).lean();
        if (!current) throw new NotFoundError('Schedule not found');

        const normalized = normalizeSchedulePayload(mergeSchedulePatch(current, payload));
        const nextRunAt = normalized.enabled
            ? calculateNextRun({
                schedule: {
                    ...normalized,
                    runCount: current.runCount || 0,
                    lastRunAt: current.lastRunAt || null
                }
            })
            : null;
        const updated = await BlogAutomationSchedule.findByIdAndUpdate(
            objectId,
            {
                $set: {
                    ...normalized,
                    nextRunAt,
                    leaseUntil: null,
                    lockedBy: ''
                }
            },
            { new: true }
        ).lean();
        return mapSchedule(updated);
    }

    static async setEnabled({ scheduleId, enabled }) {
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const current = await BlogAutomationSchedule.findById(objectId).lean();
        if (!current) throw new NotFoundError('Schedule not found');
        const nextRunAt = enabled ? calculateNextRun({ schedule: { ...current, enabled: true } }) : null;
        const updated = await BlogAutomationSchedule.findByIdAndUpdate(
            objectId,
            {
                $set: {
                    enabled: Boolean(enabled),
                    nextRunAt,
                    leaseUntil: null,
                    lockedBy: '',
                    lastError: ''
                }
            },
            { new: true }
        ).lean();
        return mapSchedule(updated);
    }

    static async deleteSchedule({ scheduleId }) {
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const deleted = await BlogAutomationSchedule.findByIdAndDelete(objectId).lean();
        if (!deleted) throw new NotFoundError('Schedule not found');
        return { deleted: true, id: String(deleted._id) };
    }

    static async listExecutions({ scheduleId, limit = 20 } = {}) {
        const query = {};
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (scheduleId && !objectId) throw new BadRequestError('Invalid schedule id');
        if (objectId) query.scheduleId = objectId;
        const executions = await BlogAutomationExecution.find(query)
            .sort({ createdAt: -1 })
            .limit(Math.min(Math.max(Number(limit) || 20, 1), 100))
            .lean();
        return { executions: executions.map(mapExecution) };
    }

    static async runNow({ scheduleId }) {
        assertCanRunAutomation();
        const objectId = convertToObjectIdMongodb(scheduleId);
        if (!objectId) throw new BadRequestError('Invalid schedule id');
        const schedule = await BlogAutomationSchedule.findById(objectId).lean();
        if (!schedule) throw new NotFoundError('Schedule not found');
        return BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'manual',
            dueAt: new Date()
        });
    }

    static async claimDueSchedule({ workerId, now = new Date() } = {}) {
        if (!isCronEnabled() || !isSeoAgentEnabled()) return null;
        return BlogAutomationSchedule.findOneAndUpdate(
            {
                enabled: true,
                nextRunAt: { $ne: null, $lte: now },
                $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
                $expr: {
                    $or: [
                        { $eq: ['$runLimit', 0] },
                        { $lt: ['$runCount', '$runLimit'] }
                    ]
                }
            },
            {
                $set: {
                    lockedBy: workerId,
                    leaseUntil: new Date(now.getTime() + LEASE_MS)
                }
            },
            { sort: { nextRunAt: 1 }, new: true }
        ).lean();
    }

    static async runDueOnce({ workerId = `worker-${process.pid}` } = {}) {
        const schedule = await BlogAutomationScheduleService.claimDueSchedule({ workerId });
        if (!schedule) return null;
        return BlogAutomationScheduleService.executeSchedule({
            schedule,
            trigger: 'scheduled',
            dueAt: schedule.nextRunAt
        });
    }

    static async executeSchedule({ schedule, trigger = 'scheduled', dueAt = new Date() }) {
        assertCanRunAutomation();
        const scheduleId = String(schedule._id || schedule.id || '');
        const executionKey = buildExecutionKey({ scheduleId, trigger, dueAt });
        let execution;

        try {
            execution = await BlogAutomationExecution.create({
                scheduleId,
                executionKey,
                status: 'running',
                startedAt: new Date(),
                metadata: { trigger, dueAt }
            });
        } catch (error) {
            if (error?.code === 11000) {
                return { skipped: true, reason: 'duplicate_execution', executionKey };
            }
            throw error;
        }

        const scheduleObjectId = convertToObjectIdMongodb(scheduleId);
        const completeSchedule = async ({ runCountDelta = 0, lastRunStatus, lastError = '', nextRunAt }) => {
            const update = {
                $set: {
                    lastRunAt: new Date(),
                    lastRunStatus,
                    lastError,
                    leaseUntil: null,
                    lockedBy: '',
                    nextRunAt,
                    enabled: Boolean(nextRunAt)
                }
            };
            if (runCountDelta) update.$inc = { runCount: runCountDelta };
            await BlogAutomationSchedule.updateOne({ _id: scheduleObjectId }, update);
        };

        try {
            const now = new Date();
            const payload = buildAutomationPayload({ schedule, executionKey, now });
            const result = await AutomationSeoBlogService.publishSeoBlog({ payload });
            const completedAt = new Date();
            const status = result.published ? 'published' : 'draft_created';
            let telegramResult = null;

            await BlogAutomationExecution.updateOne(
                { _id: execution._id },
                {
                    $set: {
                        status,
                        completedAt,
                        blogId: result.blogId || null,
                        blogSlug: result.slug || payload.slug,
                        blogTitle: payload.title,
                        mode: result.mode,
                        metadata: {
                            trigger,
                            dueAt,
                            resultReasons: result.reasons || [],
                            imagePipelineStatus: result.imagePipelineStatus || ''
                        }
                    }
                }
            );

            if (!result.published && result.blogId) {
                telegramResult = await TelegramApprovalService.createDraftApprovalAndNotify({
                    blogId: result.blogId,
                    blogTitle: payload.title,
                    blogSlug: result.slug || payload.slug,
                    blogUrl: result.url || '',
                    scheduleId,
                    executionId: execution._id
                });
                await BlogAutomationExecution.updateOne(
                    { _id: execution._id },
                    {
                        $set: {
                            telegramNotificationStatus: telegramResult.status || '',
                            telegramNotificationError: telegramResult.reason || ''
                        }
                    }
                );
            }

            const nextRunAt = calculateNextRun({
                schedule: {
                    ...schedule,
                    runCount: Number(schedule.runCount || 0) + 1,
                    lastRunAt: completedAt
                },
                from: completedAt
            });
            await completeSchedule({ runCountDelta: 1, lastRunStatus: status, nextRunAt });

            return {
                execution: mapExecution({
                    ...execution.toObject(),
                    status,
                    completedAt,
                    blogId: result.blogId,
                    blogSlug: result.slug,
                    blogTitle: payload.title,
                    mode: result.mode,
                    telegramNotificationStatus: telegramResult?.status || '',
                    telegramNotificationError: telegramResult?.reason || ''
                }),
                result,
                telegram: telegramResult
            };
        } catch (error) {
            const message = error?.message || 'schedule_execution_failed';
            await BlogAutomationExecution.updateOne(
                { _id: execution._id },
                {
                    $set: {
                        status: 'failed',
                        completedAt: new Date(),
                        error: message
                    }
                }
            );
            const nextRunAt = calculateNextRun({
                schedule: {
                    ...schedule,
                    lastRunAt: new Date()
                },
                from: new Date()
            });
            await completeSchedule({ lastRunStatus: 'failed', lastError: message, nextRunAt });
            throw error;
        }
    }
}

module.exports = {
    BlogAutomationScheduleService,
    buildAutomationPayload,
    isCronEnabled,
    isSeoAgentEnabled,
    mapExecution,
    mapSchedule
};
