'use strict'

const contactModel = require('../models/contact.model');
const adminModel = require('../models/admin.model');
const { BadRequestError, NotFoundError } = require('../core/error.response');
const { convertToObjectIdMongodb, removeUndefinedObject } = require('../utils');

const CONTACT_STATUS = ['new', 'processing', 'contacted', 'closed'];
const normalizeString = (value) => {
	if (typeof value !== 'string') return '';
	return value.trim();
};

const normalizeOptional = (value) => {
	const trimmed = normalizeString(value);
	return trimmed ? trimmed : null;
};

const normalizeEmail = (value) => {
	const trimmed = normalizeString(value).toLowerCase();
	return trimmed ? trimmed : null;
};

const isValidEmail = (value) => /\S+@\S+\.\S+/.test(value);

const isValidPhone = (value) => {
	if (!value) return false;
	const digits = value.replace(/\D/g, '');
	return digits.length >= 6;
};

const normalizeListQuery = ({ status, q } = {}) => {
	const filter = {};
	if (status && CONTACT_STATUS.includes(status)) {
		filter.status = status;
	}
	if (q && typeof q === 'string' && q.trim()) {
		filter.$text = { $search: q.trim() };
	}
	return filter;
};

const normalizeObjectIdList = (values = []) => {
	if (!Array.isArray(values)) return [];
	const seen = new Set();
	const ids = [];
	for (const value of values) {
		const objectId = convertToObjectIdMongodb(value);
		if (!objectId) continue;
		const key = String(objectId);
		if (seen.has(key)) continue;
		seen.add(key);
		ids.push(objectId);
	}
	return ids;
};

class ContactService {
	static createContact = async ({ payload = {}, meta = {} }) => {
		const fullName = normalizeString(payload.fullName || payload.name);
		const message = normalizeString(payload.message || payload.content || payload.request);
		const contactValue = normalizeOptional(
			payload.contact || payload.contactField || payload.emailOrPhone || payload.contactInfo
		);

		let phone = normalizeOptional(payload.phone);
		let email = normalizeEmail(payload.email);

		if (contactValue) {
			const maybeEmail = normalizeEmail(contactValue);
			if (maybeEmail && isValidEmail(maybeEmail)) {
				email = maybeEmail;
			} else if (isValidPhone(contactValue)) {
				phone = contactValue;
			} else {
				throw new BadRequestError('Phone or email is invalid');
			}
		}

		if (!fullName) throw new BadRequestError('Full name is required');
		if (!phone && !email) throw new BadRequestError('Phone or email is required');
		if (email && !isValidEmail(email)) {
			throw new BadRequestError('Email is invalid');
		}
		if (phone && !isValidPhone(phone)) {
			throw new BadRequestError('Phone number is invalid');
		}
		if (!message) throw new BadRequestError('Message is required');

		const contact = await contactModel.create({
			fullName,
			phone,
			email,
			message,
			sourcePage: normalizeOptional(payload.sourcePage),
			referrer: normalizeOptional(payload.referrer),
			meta: {
				userAgent: normalizeOptional(meta.userAgent),
				ip: normalizeOptional(meta.ip),
				locale: normalizeOptional(meta.locale)
			}
		});

		return contact;
	};

	static listContacts = async ({ limit = 20, page = 1, status, q }) => {
		const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
		const safePage = Math.max(parseInt(page, 10) || 1, 1);
		const skip = (safePage - 1) * safeLimit;
		const filter = normalizeListQuery({ status, q });

		const [items, total] = await Promise.all([
			contactModel
				.find(filter)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(safeLimit)
				.populate('assignedTo', 'name email')
				.lean(),
			contactModel.countDocuments(filter)
		]);

		return {
			items,
			total,
			page: safePage,
			limit: safeLimit
		};
	};

	static getContactById = async ({ contactId }) => {
		const objectId = convertToObjectIdMongodb(contactId);
		if (!objectId) throw new BadRequestError('Invalid contact id');

		const contact = await contactModel
			.findById(objectId)
			.populate('assignedTo', 'name email')
			.populate('updatedBy', 'name email')
			.lean();

		if (!contact) throw new NotFoundError('Contact not found');
		return contact;
	};

	static updateContact = async ({ contactId, payload = {}, updatedBy }) => {
		const objectId = convertToObjectIdMongodb(contactId);
		if (!objectId) throw new BadRequestError('Invalid contact id');

		const updatePayload = removeUndefinedObject({
			status: payload.status,
			internalNote: normalizeOptional(payload.internalNote),
			assignedTo: payload.assignedTo
				? convertToObjectIdMongodb(payload.assignedTo)
				: undefined
		});

		if (updatePayload.status && !CONTACT_STATUS.includes(updatePayload.status)) {
			throw new BadRequestError('Invalid status');
		}

		if (payload.assignedTo && !updatePayload.assignedTo) {
			throw new BadRequestError('Invalid assigned admin');
		}

		if (updatePayload.assignedTo) {
			const foundAdmin = await adminModel.findById(updatePayload.assignedTo).select('_id');
			if (!foundAdmin) throw new BadRequestError('Assigned admin not found');
			updatePayload.assignedAt = new Date();
		}

		if (updatePayload.status === 'contacted') {
			updatePayload.lastContactedAt = new Date();
		}

		if (updatedBy) {
			const updatedById = convertToObjectIdMongodb(updatedBy);
			if (updatedById) {
				updatePayload.updatedBy = updatedById;
			}
		}

		if (!Object.keys(updatePayload).length) {
			throw new BadRequestError('No valid fields to update');
		}

		const updated = await contactModel
			.findByIdAndUpdate(objectId, updatePayload, { new: true })
			.populate('assignedTo', 'name email')
			.populate('updatedBy', 'name email')
			.lean();

		if (!updated) throw new NotFoundError('Contact not found');
		return updated;
	};

	static deleteContact = async ({ contactId }) => {
		const objectId = convertToObjectIdMongodb(contactId);
		if (!objectId) throw new BadRequestError('Invalid contact id');

		const deleted = await contactModel.findByIdAndDelete(objectId).lean();
		if (!deleted) throw new NotFoundError('Contact not found');
		return {
			deleted: true,
			deletedCount: 1,
			contact: deleted
		};
	};

	static bulkDeleteContacts = async ({ ids = [], allFiltered = false, filters = {} }) => {
		let matchFilter = null;
		let requestedCount = 0;

		if (allFiltered) {
			matchFilter = normalizeListQuery(filters);
		} else {
			const objectIds = normalizeObjectIdList(ids);
			if (!objectIds.length) {
				throw new BadRequestError('No valid contact ids provided');
			}
			requestedCount = objectIds.length;
			matchFilter = { _id: { $in: objectIds } };
		}

		const matchedIds = await contactModel.find(matchFilter).select('_id').lean();
		const matchedObjectIds = matchedIds.map((item) => item._id).filter(Boolean);
		if (!matchedObjectIds.length) {
			return {
				deleted: true,
				deletedCount: 0,
				matchedCount: 0,
				requestedCount,
				allFiltered: Boolean(allFiltered)
			};
		}

		const deleteResult = await contactModel.deleteMany({ _id: { $in: matchedObjectIds } });
		return {
			deleted: true,
			deletedCount: Number(deleteResult?.deletedCount) || 0,
			matchedCount: matchedObjectIds.length,
			requestedCount: allFiltered ? matchedObjectIds.length : requestedCount,
			allFiltered: Boolean(allFiltered)
		};
	};
}

module.exports = ContactService;
