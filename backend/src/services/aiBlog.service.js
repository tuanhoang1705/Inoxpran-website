'use strict'

const slugify = require('slugify');
const { BadRequestError, ForbiddenError } = require('../core/error.response');
const BlogService = require('./blog.service');
const { BLOG_CATEGORY_KEYS } = require('../models/blog.model');

const DEFAULT_LOCALE = 'vi';
const MAX_SEO_TITLE_LENGTH = 60;
const MAX_SEO_DESCRIPTION_LENGTH = 160;
const WORDS_PER_MINUTE = 220;

const normalizeString = (value) => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || '';
    }
    if (typeof value === 'number') return String(value).trim();
    return '';
};

const normalizeStringArray = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeString(item)).filter(Boolean);
    }

    const normalized = normalizeString(value);
    if (!normalized) return [];

    return normalized
        .split(',')
        .map((item) => normalizeString(item))
        .filter(Boolean);
};

const parseBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const escapeHtml = (value) =>
    String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const stripHtml = (value) =>
    normalizeString(value)
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const truncate = (value, maxLength) => {
    const normalized = normalizeString(value);
    if (!normalized || normalized.length <= maxLength) return normalized;
    return normalized.slice(0, Math.max(maxLength - 3, 1)).trimEnd() + '...';
};

const toSeoSlug = (value) => {
    const normalized = slugify(
        String(value || '').replace(/[\u0111\u0110]/g, (char) => (char === '\u0111' ? 'd' : 'D')),
        {
            lower: true,
            strict: true,
            locale: 'vi',
            trim: true
        }
    );

    return (
        String(normalized || '')
            .slice(0, 80)
            .replace(/-+$/g, '') || `blog-${Date.now()}`
    );
};

const estimateReadTimeMinutes = (content) => {
    const wordCount = stripHtml(content).split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
};

const ensureCategoryKey = (value) => {
    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) return 'guide';
    if (!BLOG_CATEGORY_KEYS.includes(normalized)) {
        throw new BadRequestError(`category must be one of: ${BLOG_CATEGORY_KEYS.join(', ')}`);
    }
    return normalized;
};

const dedupe = (items = []) => Array.from(new Set(items.filter(Boolean)));

const buildHeading = (keyword, suffix) => {
    const base = normalizeString(keyword) || 'sản phẩm inox';
    return `${base.charAt(0).toUpperCase()}${base.slice(1)} ${suffix}`.trim();
};

const buildFaqItems = ({ keyword, audience }) => {
    const safeKeyword = normalizeString(keyword) || 'inox';
    const safeAudience = normalizeString(audience) || 'người dùng';

    return [
        {
            question: `${safeKeyword} có phù hợp với ${safeAudience} không?`,
            answer:
                'Có, nếu ưu tiên đúng nhu cầu sử dụng, chất liệu, độ dày đáy và mức nhiệt phù hợp với tần suất nấu hằng ngày.'
        },
        {
            question: `Nên kiểm tra gì trước khi mua ${safeKeyword}?`,
            answer:
                'Nên kiểm tra mác thép, độ hoàn thiện bề mặt, tay cầm, đáy nồi/chảo và chính sách bảo hành để tránh chọn sai cấu hình.'
        },
        {
            question: `Làm sao để ${safeKeyword} bền và giữ hiệu suất tốt hơn?`,
            answer:
                'Ưu tiên vệ sinh đúng cách, hạn chế sốc nhiệt, và sử dụng nhiệt vừa để giữ độ ổn định bề mặt cũng như tuổi thọ sản phẩm.'
        }
    ];
};

const buildFaqHtml = (items = []) => {
    if (!items.length) return '';
    const html = items
        .map(
            (item) =>
                `<div><h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p></div>`
        )
        .join('');

    return `<section><h2>Câu hỏi thường gặp</h2>${html}</section>`;
};

const buildInternalLinksHtml = (candidates = []) => {
    if (!Array.isArray(candidates) || !candidates.length) return '';

    const validItems = candidates
        .map((item) => ({
            title: normalizeString(item?.title),
            url: normalizeString(item?.url)
        }))
        .filter((item) => item.title && item.url)
        .slice(0, 4);

    if (!validItems.length) return '';

    const listItems = validItems
        .map(
            (item) =>
                `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></li>`
        )
        .join('');

    return `<section><h2>Liên kết nội bộ nên thêm</h2><ul>${listItems}</ul></section>`;
};

const buildCtaHtml = ({ productContext = [], targetKeyword }) => {
    const safeKeyword = normalizeString(targetKeyword) || 'sản phẩm inox';
    const products = normalizeStringArray(productContext).slice(0, 3);
    const productLabel = products.length ? products.join(', ') : 'giải pháp inox phù hợp';

    return `<section><h2>Kết luận</h2><p>Nếu bạn đang cần tư vấn nhanh về ${escapeHtml(
        safeKeyword
    )}, hãy bắt đầu từ nhóm ${escapeHtml(
        productLabel
    )} và đối chiếu với nhu cầu sử dụng thực tế để chọn cấu hình tối ưu.</p></section>`;
};

const buildDraftHtml = ({
    brief,
    targetKeyword,
    secondaryKeywords,
    audience,
    tone,
    includeFaq,
    includeCta,
    productContext,
    internalLinkCandidates
}) => {
    const safeBrief = normalizeString(brief);
    const safeKeyword = normalizeString(targetKeyword) || 'inox';
    const safeAudience = normalizeString(audience) || 'khách hàng đang cân nhắc mua';
    const safeTone = normalizeString(tone) || 'chuyên gia';
    const relatedTerms = normalizeStringArray(secondaryKeywords).slice(0, 3);
    const introContext = relatedTerms.length
        ? ` Các điểm cần so sánh gồm ${relatedTerms.join(', ')}.`
        : '';

    const sections = [
        `<section><p>${escapeHtml(
            safeBrief || `Bài viết này giúp bạn đánh giá ${safeKeyword} theo nhu cầu thực tế.`
        )} Nội dung được viết theo giọng ${escapeHtml(
            safeTone
        )} để ${escapeHtml(safeAudience)} có thể ra quyết định nhanh hơn.${escapeHtml(
            introContext
        )}</p></section>`,
        `<section><h2>${escapeHtml(buildHeading(safeKeyword, 'phù hợp với nhu cầu nào?'))}</h2><p>${escapeHtml(
            `${safeKeyword} nên được đánh giá theo tần suất sử dụng, nguồn nhiệt, số người dùng và yêu cầu vệ sinh sau nấu. Khi xác định đúng ngữ cảnh sử dụng, bạn sẽ tránh được việc chọn dư tính năng hoặc thiếu độ bền cần thiết.`
        )}</p></section>`,
        `<section><h2>${escapeHtml(buildHeading(safeKeyword, 'cần kiểm tra những tiêu chí gì?'))}</h2><p>${escapeHtml(
            `${safeKeyword} nên được kiểm tra theo chất liệu, kết cấu đáy, độ hoàn thiện bề mặt, độ chắc của tay cầm và độ tương thích với bếp đang dùng. Đây là nhóm tiêu chí ảnh hưởng trực tiếp đến tuổi thọ và hiệu quả nấu nướng.`
        )}</p></section>`,
        `<section><h2>${escapeHtml(buildHeading(safeKeyword, 'để tối ưu chi phí lâu dài'))}</h2><p>${escapeHtml(
            'Khi so sánh giá, không nên chỉ nhìn vào chi phí ban đầu. Một cấu hình ổn định hơn sẽ giảm rủi ro cong vênh, bám màu hoặc xuống cấp bề mặt, từ đó giúp tối ưu tổng chi phí sử dụng lâu dài.'
        )}</p></section>`
    ];

    if (relatedTerms.length) {
        sections.push(
            `<section><h2>Từ khoá phụ nên triển khai trong bài</h2><ul>${relatedTerms
                .map((term) => `<li>${escapeHtml(term)}</li>`)
                .join('')}</ul></section>`
        );
    }

    if (includeFaq) {
        sections.push(buildFaqHtml(buildFaqItems({ keyword: safeKeyword, audience: safeAudience })));
    }

    const internalLinksHtml = buildInternalLinksHtml(internalLinkCandidates);
    if (internalLinksHtml) sections.push(internalLinksHtml);
    if (includeCta) sections.push(buildCtaHtml({ productContext, targetKeyword: safeKeyword }));

    return sections.join('');
};

const buildTitle = ({ brief, targetKeyword, audience }) => {
    const safeKeyword = normalizeString(targetKeyword);
    if (safeKeyword) {
        const safeAudience = normalizeString(audience);
        return truncate(
            safeAudience
                ? `${safeKeyword}: cách chọn phù hợp cho ${safeAudience}`
                : `${safeKeyword}: hướng dẫn chọn đúng nhu cầu`,
            90
        );
    }

    const safeBrief = normalizeString(brief);
    if (!safeBrief) return 'Hướng dẫn tối ưu blog inox';
    return truncate(safeBrief, 90);
};

const buildExcerpt = ({ brief, targetKeyword, secondaryKeywords }) => {
    const safeBrief = normalizeString(brief);
    const extras = normalizeStringArray(secondaryKeywords).slice(0, 2);
    const suffix = extras.length ? `, ${extras.join(', ')}` : '';
    const fallback = targetKeyword
        ? `Bài viết tóm tắt cách đánh giá ${targetKeyword}${suffix} để chọn đúng theo nhu cầu sử dụng.`
        : 'Bài viết tóm tắt tiêu chí cần kiểm tra trước khi triển khai nội dung blog và SEO.';

    return truncate(safeBrief || fallback, 180);
};

const buildSeoTitle = ({ title, targetKeyword, brandName }) => {
    const safeTitle = normalizeString(title);
    const safeKeyword = normalizeString(targetKeyword);
    const safeBrand = normalizeString(brandName);

    const candidates = dedupe([
        safeKeyword && safeBrand ? `${safeKeyword} | ${safeBrand}` : '',
        safeTitle && safeBrand ? `${safeTitle} | ${safeBrand}` : '',
        safeKeyword || safeTitle
    ]);

    return truncate(candidates[0] || safeTitle || safeKeyword || 'Blog SEO', MAX_SEO_TITLE_LENGTH);
};

const buildSeoDescription = ({ excerpt, title, targetKeyword }) => {
    const candidates = dedupe([
        normalizeString(excerpt),
        normalizeString(targetKeyword)
            ? `${normalizeString(targetKeyword)}: các tiêu chí cần kiểm tra, cách chọn và lưu ý triển khai thực tế.`
            : '',
        normalizeString(title)
    ]);

    return truncate(candidates[0] || 'Bài viết SEO chuẩn cấu trúc cho website.', MAX_SEO_DESCRIPTION_LENGTH);
};

const buildBriefFromExisting = (existing = {}) => {
    const title = normalizeString(existing.title);
    const excerpt = normalizeString(existing.excerpt);
    const content = truncate(stripHtml(existing.content), 220);
    return [title, excerpt, content].filter(Boolean).join('. ');
};

const buildChecklistItem = ({ key, status, message, suggestion, currentValue = null, recommendedValue = null }) => ({
    key,
    status,
    message,
    suggestion,
    currentValue,
    recommendedValue
});

const countOccurrences = (text, keyword) => {
    const safeText = normalizeString(text).toLowerCase();
    const safeKeyword = normalizeString(keyword).toLowerCase();
    if (!safeText || !safeKeyword) return 0;
    return safeText.split(safeKeyword).length - 1;
};

const buildSeoFixUpdatePayload = ({ audit, payload = {} }) => {
    const updatePayload = {
        ...(audit?.suggestedUpdatePayload || {})
    };

    if (normalizeString(payload.blog_slug)) {
        updatePayload.blog_slug = normalizeString(payload.blog_slug);
    }
    if (normalizeString(payload.blog_seo_title)) {
        updatePayload.blog_seo_title = normalizeString(payload.blog_seo_title);
    }
    if (normalizeString(payload.blog_seo_description)) {
        updatePayload.blog_seo_description = normalizeString(payload.blog_seo_description);
    }
    if (payload.blog_tags !== undefined) {
        updatePayload.blog_tags = payload.blog_tags;
    }
    if (normalizeString(payload.blog_title)) {
        updatePayload.blog_title = normalizeString(payload.blog_title);
    }
    if (normalizeString(payload.blog_excerpt)) {
        updatePayload.blog_excerpt = normalizeString(payload.blog_excerpt);
    }
    if (normalizeString(payload.blog_content)) {
        updatePayload.blog_content = normalizeString(payload.blog_content);
    }
    if (normalizeString(payload.blog_category_key)) {
        updatePayload.blog_category_key = normalizeString(payload.blog_category_key);
    }

    return updatePayload;
};

const extractAnalysis = ({ title, contentHtml, seoDescription, targetKeyword }) => {
    const text = stripHtml(contentHtml);
    const normalizedKeyword = normalizeString(targetKeyword).toLowerCase();
    const normalizedContent = normalizeString(contentHtml);
    const h2Count = (normalizedContent.match(/<h2\b/gi) || []).length;
    const faqCount = (normalizedContent.match(/<h3\b/gi) || []).length;

    return {
        titleLength: normalizeString(title).length,
        descriptionLength: normalizeString(seoDescription).length,
        keywordInTitle: normalizedKeyword
            ? normalizeString(title).toLowerCase().includes(normalizedKeyword)
            : false,
        keywordInDescription: normalizedKeyword
            ? normalizeString(seoDescription).toLowerCase().includes(normalizedKeyword)
            : false,
        h2Count,
        faqCount,
        wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
        estimatedReadTimeMinutes: estimateReadTimeMinutes(contentHtml)
    };
};

class AIBlogService {
    static async seoAudit({ blogId, payload = {}, reviewerId }) {
        const existing = await BlogService.getBlogForAdmin({ blogId });
        const targetKeyword =
            normalizeString(payload.targetKeyword || payload.primaryKeyword) ||
            normalizeString(existing?.tags?.[0]) ||
            normalizeString(existing?.title);
        const secondaryKeywords = normalizeStringArray(
            payload.secondaryKeywords !== undefined ? payload.secondaryKeywords : existing?.tags?.slice(1, 6)
        );
        const contentHtml = normalizeString(existing?.content);
        const contentText = stripHtml(contentHtml);
        const title = normalizeString(existing?.title);
        const seoTitle = normalizeString(existing?.seoTitle);
        const seoDescription = normalizeString(existing?.seoDescription);
        const slug = normalizeString(existing?.slug);
        const excerpt = normalizeString(existing?.excerpt);
        const image = normalizeString(existing?.image);
        const h1Count = title ? 1 : 0;
        const h2Count = (contentHtml.match(/<h2\b/gi) || []).length;
        const h3Count = (contentHtml.match(/<h3\b/gi) || []).length;
        const internalLinkCount = (contentHtml.match(/<a\b[^>]*href=(['"])(\/(?!\/)|https?:\/\/[^'"]*inoxpran)[^'"]*\1/gi) || []).length;
        const wordCount = contentText ? contentText.split(/\s+/).filter(Boolean).length : 0;
        const keywordOccurrences = countOccurrences(`${title} ${seoTitle} ${seoDescription} ${contentText}`, targetKeyword);
        const analysis = extractAnalysis({
            title: seoTitle || title,
            contentHtml,
            seoDescription,
            targetKeyword
        });

        const seoSuggestion = await AIBlogService.generateSeo({
            payload: {
                title,
                contentHtml,
                excerpt,
                targetKeyword,
                secondaryKeywords,
                slugSource: slug || title,
                brandName: normalizeString(payload.brandName || 'Inoxpran')
            },
            reviewerId
        });

        const checklist = [
            buildChecklistItem({
                key: 'seo_title_length',
                status:
                    seoTitle.length >= 30 && seoTitle.length <= MAX_SEO_TITLE_LENGTH ? 'pass' : 'warn',
                message: `SEO title length = ${seoTitle.length}`,
                suggestion: 'Keep SEO title in 30-60 chars and include target keyword near the front.',
                currentValue: seoTitle,
                recommendedValue: seoSuggestion.seo.seoTitle
            }),
            buildChecklistItem({
                key: 'seo_description_length',
                status:
                    seoDescription.length >= 70 && seoDescription.length <= MAX_SEO_DESCRIPTION_LENGTH
                        ? 'pass'
                        : 'warn',
                message: `SEO description length = ${seoDescription.length}`,
                suggestion: 'Keep meta description around 120-160 chars and make intent clear.',
                currentValue: seoDescription,
                recommendedValue: seoSuggestion.seo.seoDescription
            }),
            buildChecklistItem({
                key: 'slug_quality',
                status: slug && slug === toSeoSlug(slug) ? 'pass' : 'warn',
                message: slug ? `Slug = ${slug}` : 'Slug is missing',
                suggestion: 'Use a short lowercase slug with hyphens and the primary keyword.',
                currentValue: slug,
                recommendedValue: seoSuggestion.seo.slug
            }),
            buildChecklistItem({
                key: 'keyword_presence',
                status: keywordOccurrences > 0 ? 'pass' : 'warn',
                message: `Target keyword occurrences detected = ${keywordOccurrences}`,
                suggestion: 'Ensure the main keyword appears naturally in title, intro, and meta fields.',
                currentValue: targetKeyword,
                recommendedValue: targetKeyword
            }),
            buildChecklistItem({
                key: 'heading_structure',
                status: h2Count >= 2 ? 'pass' : 'warn',
                message: `H1=${h1Count}, H2=${h2Count}, H3=${h3Count}`,
                suggestion: 'Use one clear H1, at least 2 H2 sections, and optional H3s for FAQs.',
                currentValue: { h1Count, h2Count, h3Count },
                recommendedValue: { minH2: 2 }
            }),
            buildChecklistItem({
                key: 'internal_links',
                status: internalLinkCount > 0 ? 'pass' : 'warn',
                message: `Internal links detected = ${internalLinkCount}`,
                suggestion: 'Add at least one internal link to related products or blog posts.',
                currentValue: internalLinkCount,
                recommendedValue: 1
            }),
            buildChecklistItem({
                key: 'content_depth',
                status: wordCount >= 300 ? 'pass' : 'warn',
                message: `Word count = ${wordCount}`,
                suggestion: 'Thin content under 300 words should usually be expanded.',
                currentValue: wordCount,
                recommendedValue: 300
            }),
            buildChecklistItem({
                key: 'cover_image',
                status: image ? 'pass' : 'warn',
                message: image ? 'Cover image exists' : 'Cover image is missing',
                suggestion: 'Keep a cover image to improve CTR and content completeness.',
                currentValue: image,
                recommendedValue: image || 'upload-required'
            })
        ];

        const score = checklist.reduce((total, item) => total + (item.status === 'pass' ? 1 : 0), 0);
        const maxScore = checklist.length;
        const suggestedUpdatePayload = {
            blog_slug: seoSuggestion.seo.slug,
            blog_seo_title: seoSuggestion.seo.seoTitle,
            blog_seo_description: seoSuggestion.seo.seoDescription,
            blog_tags: seoSuggestion.seo.recommendedTags
        };

        return {
            reviewerId: normalizeString(reviewerId),
            blog: {
                id: existing.id || existing._id,
                title,
                slug,
                excerpt,
                seoTitle,
                seoDescription,
                image,
                isDraft: Boolean(existing?.isDraft),
                isPublished: Boolean(existing?.isPublished)
            },
            targetKeyword,
            secondaryKeywords,
            metrics: {
                wordCount,
                keywordOccurrences,
                h1Count,
                h2Count,
                h3Count,
                internalLinkCount,
                estimatedReadTimeMinutes: analysis.estimatedReadTimeMinutes
            },
            score: {
                passed: score,
                total: maxScore,
                percentage: Math.round((score / maxScore) * 100)
            },
            analysis,
            checklist,
            suggestedFixes: checklist
                .filter((item) => item.status !== 'pass')
                .map((item) => ({
                    key: item.key,
                    suggestion: item.suggestion,
                    recommendedValue: item.recommendedValue
                })),
            suggestedUpdatePayload,
            seoSuggestion
        };
    }

    static async applySeoFixes({ blogId, payload = {}, reviewerId }) {
        const audit = await AIBlogService.seoAudit({
            blogId,
            payload,
            reviewerId
        });

        const updatePayload = buildSeoFixUpdatePayload({ audit, payload });

        const updated = await BlogService.updateBlog({
            blogId,
            payload: updatePayload,
            sendNewsletter: false
        });

        return {
            audit,
            updated,
            updatePayloadUsed: updatePayload,
            reviewerId: normalizeString(reviewerId)
        };
    }

    static async fullSeoRefresh({ blogId, payload = {}, reviewerId }) {
        const existing = await BlogService.getBlogForAdmin({ blogId });
        const allowPublished = parseBoolean(payload.allowPublished, false);
        if (!existing?.isDraft && !allowPublished) {
            throw new ForbiddenError('Only draft blogs can run full SEO refresh');
        }

        const audit = await AIBlogService.seoAudit({
            blogId,
            payload,
            reviewerId
        });

        const seoFixPayload = buildSeoFixUpdatePayload({ audit, payload });
        const seoApplied = await BlogService.updateBlog({
            blogId,
            payload: seoFixPayload,
            sendNewsletter: false
        });

        const refreshed = await AIBlogService.regenerateAndUpdate({
            blogId,
            payload: {
                ...payload,
                allowPublished
            },
            reviewerId
        });

        return {
            existing,
            audit,
            seoApplied,
            refreshed,
            seoFixPayloadUsed: seoFixPayload,
            constraints: {
                allowPublished
            }
        };
    }

    static async createFromBrief({ payload = {}, reviewerId }) {
        const generated = await AIBlogService.generateDraft({ payload, reviewerId });

        const blogImage =
            normalizeString(payload.blog_image) ||
            normalizeString(payload.coverImage) ||
            normalizeString(payload.blogImage);
        if (!blogImage) {
            throw new BadRequestError('blog_image is required to create draft');
        }

        const creationPayload = {
            ...generated.createPayload,
            blog_image: blogImage,
            blog_image_path: normalizeString(payload.blog_image_path),
            blog_image_variants: payload.blog_image_variants,
            blog_image_crop_state: payload.blog_image_crop_state,
            blog_author_name: normalizeString(payload.blog_author_name || payload.authorName),
            blog_author_avatar: normalizeString(payload.blog_author_avatar || payload.authorAvatar),
            blog_related_post_ids: payload.blog_related_post_ids,
            blog_views: payload.blog_views,
            blog_comments_count: payload.blog_comments_count,
            status: 'draft',
            isPublished: false
        };

        if (normalizeString(payload.blog_slug)) {
            creationPayload.blog_slug = normalizeString(payload.blog_slug);
        }
        if (normalizeString(payload.blog_title)) {
            creationPayload.blog_title = normalizeString(payload.blog_title);
        }
        if (normalizeString(payload.blog_excerpt)) {
            creationPayload.blog_excerpt = normalizeString(payload.blog_excerpt);
        }
        if (normalizeString(payload.blog_content)) {
            creationPayload.blog_content = normalizeString(payload.blog_content);
        }
        if (normalizeString(payload.blog_seo_title)) {
            creationPayload.blog_seo_title = normalizeString(payload.blog_seo_title);
        }
        if (normalizeString(payload.blog_seo_description)) {
            creationPayload.blog_seo_description = normalizeString(payload.blog_seo_description);
        }
        if (payload.blog_tags !== undefined) {
            creationPayload.blog_tags = payload.blog_tags;
        }
        if (normalizeString(payload.blog_category_key)) {
            creationPayload.blog_category_key = normalizeString(payload.blog_category_key);
        }
        if (payload.blog_read_time_minutes !== undefined) {
            creationPayload.blog_read_time_minutes = payload.blog_read_time_minutes;
        }

        const created = await BlogService.createBlog({
            payload: creationPayload,
            shopId: reviewerId,
            sendNewsletter: false
        });

        return {
            generated,
            created,
            createPayloadUsed: {
                ...creationPayload,
                status: 'draft'
            }
        };
    }

    static async createAndPublishWithReview({ payload = {}, reviewerId }) {
        const createdDraft = await AIBlogService.createFromBrief({ payload, reviewerId });
        const createdBlogId = normalizeString(createdDraft?.created?.id || createdDraft?.created?._id);
        if (!createdBlogId) {
            throw new BadRequestError('Unable to resolve created draft blog id');
        }

        const approval = payload.approval || {};
        const approved = parseBoolean(approval.approved, false);
        if (!approved) {
            return {
                generated: createdDraft.generated,
                created: createdDraft.created,
                review: {
                    blogId: createdBlogId,
                    approved: false,
                    mode: normalizeString(approval.mode || 'manual'),
                    notes: normalizeString(approval.notes),
                    reviewedBy:
                        normalizeString(approval.reviewedBy) || normalizeString(reviewerId),
                    status: 'draft_created_waiting_review'
                },
                published: null,
                createPayloadUsed: createdDraft.createPayloadUsed
            };
        }

        const publishedResult = await AIBlogService.publishWithReview({
            payload: {
                blogId: createdBlogId,
                approval,
                sendNewsletter: payload.sendNewsletter,
                requireSeoFields: payload.requireSeoFields
            },
            reviewerId
        });

        return {
            generated: createdDraft.generated,
            created: createdDraft.created,
            review: publishedResult.review,
            published: publishedResult.blog,
            createPayloadUsed: createdDraft.createPayloadUsed
        };
    }

    static async regenerateAndUpdate({ blogId, payload = {}, reviewerId }) {
        const existing = await BlogService.getBlogForAdmin({ blogId });
        const allowPublished = parseBoolean(payload.allowPublished, false);
        if (!existing?.isDraft && !allowPublished) {
            throw new ForbiddenError('Only draft blogs can be regenerated and updated');
        }

        const mergedGenerationPayload = {
            ...payload,
            brief: normalizeString(payload.brief) || buildBriefFromExisting(existing),
            targetKeyword:
                normalizeString(payload.targetKeyword || payload.primaryKeyword) ||
                normalizeString(existing?.tags?.[0]) ||
                normalizeString(existing?.title),
            secondaryKeywords:
                payload.secondaryKeywords !== undefined
                    ? payload.secondaryKeywords
                    : Array.isArray(existing?.tags)
                        ? existing.tags.slice(1, 6)
                        : [],
            category:
                normalizeString(payload.category || payload.categoryKey) ||
                normalizeString(existing?.categoryKey) ||
                'guide'
        };

        const generated = await AIBlogService.generateDraft({
            payload: mergedGenerationPayload,
            reviewerId
        });

        const updatePayload = {
            ...generated.createPayload
        };

        if (normalizeString(payload.blog_title)) {
            updatePayload.blog_title = normalizeString(payload.blog_title);
        }
        if (normalizeString(payload.blog_excerpt)) {
            updatePayload.blog_excerpt = normalizeString(payload.blog_excerpt);
        }
        if (normalizeString(payload.blog_content)) {
            updatePayload.blog_content = normalizeString(payload.blog_content);
        }
        if (normalizeString(payload.blog_slug)) {
            updatePayload.blog_slug = normalizeString(payload.blog_slug);
        }
        if (normalizeString(payload.blog_seo_title)) {
            updatePayload.blog_seo_title = normalizeString(payload.blog_seo_title);
        }
        if (normalizeString(payload.blog_seo_description)) {
            updatePayload.blog_seo_description = normalizeString(payload.blog_seo_description);
        }
        if (payload.blog_tags !== undefined) {
            updatePayload.blog_tags = payload.blog_tags;
        }
        if (normalizeString(payload.blog_category_key)) {
            updatePayload.blog_category_key = normalizeString(payload.blog_category_key);
        }
        if (payload.blog_read_time_minutes !== undefined) {
            updatePayload.blog_read_time_minutes = payload.blog_read_time_minutes;
        }
        if (normalizeString(payload.blog_image)) {
            updatePayload.blog_image = normalizeString(payload.blog_image);
        }
        if (normalizeString(payload.blog_image_path)) {
            updatePayload.blog_image_path = normalizeString(payload.blog_image_path);
        }
        if (payload.blog_image_variants !== undefined) {
            updatePayload.blog_image_variants = payload.blog_image_variants;
        }
        if (payload.blog_image_crop_state !== undefined) {
            updatePayload.blog_image_crop_state = payload.blog_image_crop_state;
        }
        if (normalizeString(payload.blog_author_name || payload.authorName)) {
            updatePayload.blog_author_name = normalizeString(
                payload.blog_author_name || payload.authorName
            );
        }
        if (normalizeString(payload.blog_author_avatar || payload.authorAvatar)) {
            updatePayload.blog_author_avatar = normalizeString(
                payload.blog_author_avatar || payload.authorAvatar
            );
        }
        if (payload.blog_related_post_ids !== undefined) {
            updatePayload.blog_related_post_ids = payload.blog_related_post_ids;
        }
        if (payload.blog_views !== undefined) {
            updatePayload.blog_views = payload.blog_views;
        }
        if (payload.blog_comments_count !== undefined) {
            updatePayload.blog_comments_count = payload.blog_comments_count;
        }

        const updated = await BlogService.updateBlog({
            blogId,
            payload: updatePayload,
            sendNewsletter: false
        });

        return {
            existing,
            generated,
            updated,
            updatePayloadUsed: updatePayload,
            constraints: {
                allowPublished
            }
        };
    }

    static async generateDraft({ payload = {}, reviewerId }) {
        const brief = normalizeString(payload.brief);
        if (!brief) throw new BadRequestError('brief is required');

        const targetKeyword = normalizeString(payload.targetKeyword || payload.primaryKeyword);
        const secondaryKeywords = normalizeStringArray(payload.secondaryKeywords);
        const audience = normalizeString(payload.audience);
        const tone = normalizeString(payload.tone);
        const locale = normalizeString(payload.locale) || DEFAULT_LOCALE;
        const categoryKey = ensureCategoryKey(payload.category || payload.categoryKey);
        const includeFaq = parseBoolean(payload.includeFaq, true);
        const includeCta = parseBoolean(payload.includeCta, true);
        const productContext = normalizeStringArray(payload.productContext);
        const internalLinkCandidates = Array.isArray(payload.internalLinkCandidates)
            ? payload.internalLinkCandidates
            : [];
        const brandName = normalizeString(payload.brandName || 'Inoxpran');

        const title = buildTitle({ brief, targetKeyword, audience });
        const excerpt = buildExcerpt({ brief, targetKeyword, secondaryKeywords });
        const contentHtml = buildDraftHtml({
            brief,
            targetKeyword,
            secondaryKeywords,
            audience,
            tone,
            includeFaq,
            includeCta,
            productContext,
            internalLinkCandidates
        });
        const seoTitle = buildSeoTitle({ title, targetKeyword, brandName });
        const seoDescription = buildSeoDescription({ excerpt, title, targetKeyword });
        const slug = toSeoSlug(payload.slugSource || title);
        const tags = dedupe([targetKeyword, ...secondaryKeywords, ...productContext]).slice(0, 8);
        const estimatedReadTimeMinutes = estimateReadTimeMinutes(contentHtml);

        return {
            locale,
            reviewerId: normalizeString(reviewerId),
            draft: {
                title,
                excerpt,
                contentHtml,
                slug,
                seoTitle,
                seoDescription,
                tags,
                categoryKey,
                estimatedReadTimeMinutes
            },
            createPayload: {
                blog_title: title,
                blog_excerpt: excerpt,
                blog_content: contentHtml,
                blog_slug: slug,
                blog_seo_title: seoTitle,
                blog_seo_description: seoDescription,
                blog_tags: tags,
                blog_category_key: categoryKey,
                blog_read_time_minutes: estimatedReadTimeMinutes
            },
            checklist: {
                hasFaq: includeFaq,
                hasCta: includeCta,
                hasInternalLinks: internalLinkCandidates.length > 0,
                requiresCoverImage: true,
                requiresReviewBeforePublish: true
            }
        };
    }

    static async generateSeo({ payload = {}, reviewerId }) {
        const title = normalizeString(payload.title);
        const contentHtml = normalizeString(payload.contentHtml || payload.blog_content);
        if (!title) throw new BadRequestError('title is required');
        if (!contentHtml) throw new BadRequestError('contentHtml is required');

        const targetKeyword = normalizeString(payload.targetKeyword || payload.primaryKeyword);
        const secondaryKeywords = normalizeStringArray(payload.secondaryKeywords);
        const brandName = normalizeString(payload.brandName || 'Inoxpran');
        const excerptSource =
            normalizeString(payload.excerpt) || truncate(stripHtml(contentHtml), 180);
        const seoTitle = buildSeoTitle({ title, targetKeyword, brandName });
        const seoDescription = buildSeoDescription({
            excerpt: excerptSource,
            title,
            targetKeyword
        });
        const slug = toSeoSlug(payload.slugSource || title);
        const recommendedTags = dedupe([targetKeyword, title, ...secondaryKeywords])
            .map((item) => normalizeString(item))
            .filter(Boolean)
            .slice(0, 8);

        return {
            reviewerId: normalizeString(reviewerId),
            seo: {
                slug,
                seoTitle,
                seoDescription,
                recommendedTags
            },
            updatePayload: {
                blog_slug: slug,
                blog_seo_title: seoTitle,
                blog_seo_description: seoDescription,
                blog_tags: recommendedTags
            },
            analysis: extractAnalysis({
                title,
                contentHtml,
                seoDescription,
                targetKeyword
            })
        };
    }

    static async publishWithReview({ payload = {}, reviewerId }) {
        const blogId = normalizeString(payload.blogId);
        if (!blogId) throw new BadRequestError('blogId is required');

        const approval = payload.approval || {};
        const approved = parseBoolean(approval.approved, false);
        if (!approved) {
            throw new ForbiddenError('Blog must be explicitly approved before publish');
        }

        const mode = normalizeString(approval.mode || 'manual');
        const notes = normalizeString(approval.notes);
        const sendNewsletter = parseBoolean(payload.sendNewsletter, false);
        const requireSeoFields = parseBoolean(payload.requireSeoFields, true);
        const found = await BlogService.getBlogForAdmin({ blogId });

        if (requireSeoFields) {
            if (!normalizeString(found?.title)) {
                throw new BadRequestError('Blog title is required before publish');
            }
            if (!normalizeString(found?.excerpt)) {
                throw new BadRequestError('Blog excerpt is required before publish');
            }
            if (!normalizeString(found?.content)) {
                throw new BadRequestError('Blog content is required before publish');
            }
            if (!normalizeString(found?.slug)) {
                throw new BadRequestError('Blog slug is required before publish');
            }
            if (!normalizeString(found?.seoTitle)) {
                throw new BadRequestError('Blog SEO title is required before publish');
            }
            if (!normalizeString(found?.seoDescription)) {
                throw new BadRequestError('Blog SEO description is required before publish');
            }
            if (!normalizeString(found?.image)) {
                throw new BadRequestError('Blog cover image is required before publish');
            }
        }

        const published = await BlogService.publishBlog({
            blogId,
            sendNewsletter
        });

        return {
            review: {
                blogId,
                approved: true,
                mode,
                notes,
                reviewedBy: normalizeString(approval.reviewedBy) || normalizeString(reviewerId),
                requireSeoFields,
                sendNewsletter
            },
            blog: published
        };
    }
}

module.exports = AIBlogService;
