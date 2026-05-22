'use strict'

const { Schema, model } = require('mongoose');
const slugify = require('slugify');

const DOCUMENT_NAME = 'BlogPost';
const COLLECTION_NAME = 'Blogs';
const MAX_SEO_SLUG_LENGTH = Number(process.env.BLOG_SLUG_MAX_LENGTH || 80);

const BLOG_CATEGORY_KEYS = ['guide', 'care', 'knowledge', 'trend', 'product', 'design'];

const blogSchema = new Schema(
    {
        blog_title: { type: String, required: true, trim: true },
        blog_slug: { type: String, required: true, trim: true, unique: true, index: true },
        blog_excerpt: { type: String, required: true, trim: true },
        blog_content: { type: String, required: true },
        blog_image: { type: String, required: true },
        blog_image_path: { type: String },
        blog_image_variants: { type: Schema.Types.Mixed, default: null },
        blog_image_crop_state: {
            zoom: { type: Number },
            offsetX: { type: Number },
            offsetY: { type: Number }
        },
        blog_category_key: {
            type: String,
            enum: BLOG_CATEGORY_KEYS,
            default: 'guide',
            index: true
        },
        blog_tags: { type: [String], default: [] },
        blog_author_name: { type: String, trim: true },
        blog_author_avatar: { type: String, trim: true, maxlength: 2 },
        blog_read_time_minutes: { type: Number, default: 1, min: 1 },
        blog_views: { type: Number, default: 0, min: 0 },
        blog_comments_count: { type: Number, default: 0, min: 0 },
        blog_related_post_ids: {
            type: [{ type: Schema.Types.ObjectId, ref: DOCUMENT_NAME }],
            default: []
        },
        blog_seo_title: { type: String, trim: true },
        blog_seo_description: { type: String, trim: true },
        blog_shop: { type: String, trim: true },
        publishedAt: { type: Date, default: null },
        isDraft: { type: Boolean, default: true, index: true },
        isPublished: { type: Boolean, default: false, index: true }
    },
    {
        collection: COLLECTION_NAME,
        timestamps: true
    }
);

blogSchema.index({
    blog_title: 'text',
    blog_excerpt: 'text',
    blog_tags: 'text'
});

blogSchema.pre('validate', function (next) {
    const source = this.blog_slug || this.blog_title || '';
    const normalized = slugify(
        String(source).replace(/[\u0111\u0110]/g, (char) => (char === '\u0111' ? 'd' : 'D')),
        {
        lower: true,
        strict: true,
        locale: 'vi',
        trim: true
        }
    );
    const seoFriendlySlug = String(normalized || '')
        .slice(0, MAX_SEO_SLUG_LENGTH)
        .replace(/-+$/g, '');
    this.blog_slug = seoFriendlySlug || `blog-${Date.now()}`;
    next();
});

module.exports = {
    blog: model(DOCUMENT_NAME, blogSchema),
    BLOG_CATEGORY_KEYS
};
