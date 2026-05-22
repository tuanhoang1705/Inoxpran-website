'use strict'

const sanitizeHtml = require('sanitize-html');
const { blog } = require('../models/blog.model');
const { blogComment, BLOG_COMMENT_STATUSES } = require('../models/blogComment.model');
const { BadRequestError, NotFoundError } = require('../core/error.response');
const { convertToObjectIdMongodb } = require('../utils');

const MAX_LIMIT = 200;

const normalizeString = (value) => {
	if (typeof value !== 'string') return '';
	return value.trim();
};

const parseNumber = (value, fallback) => {
	if (value === undefined || value === null || value === '') return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const sanitizePlainText = (value) =>
	sanitizeHtml(value || '', { allowedTags: [], allowedAttributes: {} }).trim();

const sanitizeCommentContent = (value) => sanitizePlainText(value);

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const mapCommentPublic = (item) => {
	if (!item) return null;
	return {
		id: String(item._id),
		parentId: item.parentId ? String(item.parentId) : null,
		author: item.authorName,
		avatar: item.authorName ? item.authorName.charAt(0).toUpperCase() : 'I',
		content: item.content,
		date: item.createdAt,
		replies: []
	};
};

const mapCommentAdmin = (item) => {
	if (!item) return null;
	return {
		id: String(item._id),
		blogId: item.blogId ? String(item.blogId?._id || item.blogId) : null,
		blogTitle: item.blogId?.blog_title || '',
		blogSlug: item.blogId?.blog_slug || '',
		parentId: item.parentId ? String(item.parentId) : null,
		authorName: item.authorName,
		authorEmail: item.authorEmail,
		content: item.content,
		status: item.status,
		createdAt: item.createdAt,
		reviewedAt: item.reviewedAt || null
	};
};

const buildCommentTree = (items) => {
	const map = new Map();
	const roots = [];

	items.forEach((item) => {
		const mapped = mapCommentPublic(item);
		if (!mapped) return;
		map.set(mapped.id, mapped);
	});

	items.forEach((item) => {
		if (!item) return;
		const node = map.get(String(item._id));
		if (!node) return;
		const parentId = item.parentId ? String(item.parentId) : null;
		if (parentId && map.has(parentId)) {
			map.get(parentId).replies.push(node);
		} else {
			roots.push(node);
		}
	});

	return roots;
};

class BlogCommentService {
	static async createComment({ slug, payload = {}, meta = {} }) {
		const blogSlug = normalizeString(slug);
		if (!blogSlug) throw new BadRequestError('blog slug is required');

		const authorName = sanitizePlainText(normalizeString(payload.author || payload.authorName));
		const authorEmail = normalizeString(payload.email || payload.authorEmail).toLowerCase();
		const content = sanitizeCommentContent(payload.content);
		const parentIdRaw = normalizeString(payload.parentId || payload.parent_id);

		if (!authorName) throw new BadRequestError('author is required');
		if (!authorEmail || !isValidEmail(authorEmail)) throw new BadRequestError('email is invalid');
		if (!content) throw new BadRequestError('content is required');

		const blogDoc = await blog.findOne({ blog_slug: blogSlug, isPublished: true }).lean();
		if (!blogDoc) throw new NotFoundError('Blog not found');

		let parentId = null;
		let rootId = null;
		if (parentIdRaw) {
			const parentObjectId = convertToObjectIdMongodb(parentIdRaw);
			if (!parentObjectId) throw new BadRequestError('Invalid parentId');
			const parent = await blogComment.findById(parentObjectId).lean();
			if (!parent || String(parent.blogId) !== String(blogDoc._id)) {
				throw new BadRequestError('Parent comment not found');
			}
			parentId = parentObjectId;
			rootId = parent.rootId || parent._id;
		}

		const created = await blogComment.create({
			blogId: blogDoc._id,
			parentId,
			rootId,
			authorName,
			authorEmail,
			content,
			status: 'pending',
			meta: {
				ip: meta?.ip || null,
				userAgent: meta?.userAgent || null
			}
		});

		return {
			id: String(created._id),
			status: created.status
		};
	}

	static async listPublicComments({ slug }) {
		const blogSlug = normalizeString(slug);
		if (!blogSlug) throw new BadRequestError('blog slug is required');

		const blogDoc = await blog.findOne({ blog_slug: blogSlug, isPublished: true }).lean();
		if (!blogDoc) throw new NotFoundError('Blog not found');

		const comments = await blogComment
			.find({ blogId: blogDoc._id, status: 'approved' })
			.sort({ createdAt: 1 })
			.lean();

		return {
			items: buildCommentTree(comments),
			total: comments.length
		};
	}

	static async listAdminComments({
		status = 'all',
		blogId,
		q,
		page = 1,
		limit = 20
	} = {}) {
		const safeLimit = Math.min(Math.max(parseNumber(limit, 20), 1), MAX_LIMIT);
		const safePage = Math.max(parseNumber(page, 1), 1);
		const skip = (safePage - 1) * safeLimit;
		const filter = {};

		const normalizedStatus = normalizeString(status).toLowerCase();
		if (normalizedStatus && normalizedStatus !== 'all' && BLOG_COMMENT_STATUSES.includes(normalizedStatus)) {
			filter.status = normalizedStatus;
		}

		if (blogId) {
			const objectId = convertToObjectIdMongodb(blogId);
			if (objectId) filter.blogId = objectId;
		}

		const searchText = normalizeString(q);
		if (searchText) {
			filter.$or = [
				{ authorName: { $regex: searchText, $options: 'i' } },
				{ authorEmail: { $regex: searchText, $options: 'i' } },
				{ content: { $regex: searchText, $options: 'i' } }
			];
		}

		const [items, total] = await Promise.all([
			blogComment
				.find(filter)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(safeLimit)
				.populate('blogId', 'blog_title blog_slug')
				.lean(),
			blogComment.countDocuments(filter)
		]);

		return {
			items: items.map((item) => mapCommentAdmin(item)).filter(Boolean),
			total,
			page: safePage,
			limit: safeLimit
		};
	}

	static async updateCommentStatus({ commentId, status, reviewerId }) {
		const objectId = convertToObjectIdMongodb(commentId);
		if (!objectId) throw new BadRequestError('Invalid comment id');
		const normalizedStatus = normalizeString(status).toLowerCase();
		if (!BLOG_COMMENT_STATUSES.includes(normalizedStatus)) {
			throw new BadRequestError('Invalid status');
		}

		const found = await blogComment.findById(objectId);
		if (!found) throw new NotFoundError('Comment not found');

		const prevStatus = found.status;
		if (prevStatus === normalizedStatus) return mapCommentAdmin(found);

		found.status = normalizedStatus;
		found.reviewedBy = reviewerId || found.reviewedBy;
		found.reviewedAt = new Date();
		await found.save();

		if (prevStatus !== 'approved' && normalizedStatus === 'approved') {
			await blog.updateOne({ _id: found.blogId }, { $inc: { blog_comments_count: 1 } });
		} else if (prevStatus === 'approved' && normalizedStatus !== 'approved') {
			await blog.updateOne({ _id: found.blogId }, { $inc: { blog_comments_count: -1 } });
		}

		return mapCommentAdmin(found);
	}

	static async deleteComment({ commentId }) {
		const objectId = convertToObjectIdMongodb(commentId);
		if (!objectId) throw new BadRequestError('Invalid comment id');

		const found = await blogComment.findById(objectId);
		if (!found) throw new NotFoundError('Comment not found');

		const wasApproved = found.status === 'approved';
		await blogComment.deleteOne({ _id: objectId });

		if (wasApproved) {
			await blog.updateOne({ _id: found.blogId }, { $inc: { blog_comments_count: -1 } });
		}

		return true;
	}
}

module.exports = BlogCommentService;
