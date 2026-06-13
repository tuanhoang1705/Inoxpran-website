'use strict'

const { refreshToken } = require('firebase-admin/app');
const { Schema, model } = require('mongoose'); // Erase if already required
const slug = require('slugify');

const DOCUMENT_NAME = 'Product'
const COLLECTION_NAME = 'Products'
const PRODUCT_REVIEW_STATUSES = ['pending', 'approved', 'rejected'];

const productReviewSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        authorName: {
            type: String,
            required: true,
            trim: true,
            maxlength: 150
        },
        authorEmail: {
            type: String,
            default: null,
            trim: true,
            lowercase: true,
            maxlength: 180
        },
        rating: {
            type: Number,
            required: true,
            min: [1, 'Rating must be above or equal to 1'],
            max: [5, 'Rating must be below or equal to 5'],
            set: (value) => {
                const parsed = Number(value);
                if (!Number.isFinite(parsed)) return 0;
                return Math.max(1, Math.min(5, Math.round(parsed)));
            }
        },
        title: {
            type: String,
            default: '',
            trim: true,
            maxlength: 160
        },
        content: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000
        },
        images: {
            type: [
                {
                    url: { type: String, required: true },
                    path: { type: String, default: null },
                    variants: { type: Schema.Types.Mixed, default: null }
                }
            ],
            default: []
        },
        verifiedPurchase: {
            type: Boolean,
            default: true
        },
        orderId: {
            type: Schema.Types.ObjectId,
            ref: 'ORDER',
            default: null
        },
        status: {
            type: String,
            enum: PRODUCT_REVIEW_STATUSES,
            default: 'pending'
        },
        reviewedBy: {
            type: Schema.Types.ObjectId,
            ref: 'Admin',
            default: null
        },
        reviewedAt: {
            type: Date,
            default: null
        },
        source: {
            type: String,
            enum: ['customer', 'admin', 'seed'],
            default: 'customer'
        }
    },
    {
        _id: true,
        timestamps: true
    }
);

const productSchema = new Schema({
    product_name: { type: String, required: true },
    product_name_normalized: { type: String, default: '', index: true },
    product_thumb: { type: String, default: '' },
    product_thumb_path: { type: String },
    product_thumb_variants: { type: Schema.Types.Mixed, default: null },
    product_thumb_crop_state: {
        zoom: { type: Number },
        offsetX: { type: Number },
        offsetY: { type: Number }
    },
    product_gallery: {
        type: [
            {
                url: { type: String, required: true },
                path: { type: String },
                variants: { type: Schema.Types.Mixed, default: null },
                crop_state: {
                    zoom: { type: Number },
                    offsetX: { type: Number },
                    offsetY: { type: Number }
                }
            }
        ],
        default: []
    },
    product_description: { type: String, default: '' },
    product_slug: String,
    product_original_price:{ type: Number, default: 0 },
    product_price: { type: Number, default: 0 },
    product_quantity: { type: Number, default: 0 },
    product_weight: { type: Number, default: 1000 },
    product_type: { type: String, required: true, enum: ['CastIrons', 'Electronics', 'Inoxs'] },
    product_shop: String,
    product_attributes: { type: Object, default: {} },
    product_ratingsAverage: {
        type: Number,
        default: 0,
        min: [0, 'Rating must be above or equal to 0.0'],
        max: [5, 'Rating must be below 5.0'],
        set: val => Math.round(val * 10) / 10 // 4.6666, 46.666, 47, 4.7
    },
    product_ratingsCount: {
        type: Number,
        default: 0,
        min: [0, 'Rating count must be above or equal to 0'],
        set: val => Math.max(0, Math.floor(Number(val) || 0))
    },
    product_reviews: {
        type: [productReviewSchema],
        default: []
    },
    product_variations: { type: Array, default: [] },
    product_best_selling_rank: { type: Number, default: null, index: true },
    isDraft: { type: Boolean, default: true, index: true },
    isPublished: { type: Boolean, default: false, index: true }
}, {
    collection: COLLECTION_NAME,
    timestamps: true
});

//create index for search

productSchema.index({ product_name: 'text', product_description: 'text' });
productSchema.index({ 'product_reviews.userId': 1 });

// Document middleware: run before .save() and .create()
productSchema.pre('save', function (next) { 
    const slugSource = String(this.product_name || '').replace(
        /[\u0111\u0110]/g,
        (char) => (char === '\u0111' ? 'd' : 'D')
    );
    this.product_slug = slug(slugSource, {
        lower: true,
        strict: true,
        trim: true
    });
    this.product_name_normalized = String(this.product_name || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('vi');
    next();
});

// define the product type = Electronics

const electronicSchema = new Schema({
    manufacturer: { type: String, require: true },
    model: String,
    color: String
}, {
    collection: 'Electronics',
    timestamps: true
});

const castIronSchema = new Schema({
    manufacturer: { type: String, require: true },
    model: String,
    color: String
}, {
    collection: 'CastIrons',
    timestamps: true
});

const inoxSchema = new Schema({
    manufacturer: { type: String, require: true },
    model: String,
    color: String
}, {
    collection: 'Inoxs',
    timestamps: true
});



module.exports = {
    PRODUCT_REVIEW_STATUSES,
    product: model(DOCUMENT_NAME, productSchema),
    electronic: model('Electronics', electronicSchema),
    castIron: model('CastIrons', castIronSchema),
    inox: model('Inoxs', inoxSchema)
}
