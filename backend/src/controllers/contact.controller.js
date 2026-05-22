'use strict'

const ContactService = require('../services/contact.service');
const { SuccessResponse, CREATED } = require('../core/success.response');

class ContactController {
	create = async (req, res, next) => {
		const payload = {
			...req.body,
			referrer: req.body?.referrer || req.get('referer')
		};

		new CREATED({
			message: 'Contact submitted successfully',
			metadata: await ContactService.createContact({
				payload,
				meta: {
					userAgent: req.get('user-agent'),
					ip: req.ip,
					locale: req.headers['accept-language']
				}
			})
		}).send(res);
	};

	listAdmin = async (req, res, next) => {
		new SuccessResponse({
			message: 'Get contacts success',
			metadata: await ContactService.listContacts(req.query)
		}).send(res);
	};

	getAdminById = async (req, res, next) => {
		new SuccessResponse({
			message: 'Get contact success',
			metadata: await ContactService.getContactById({ contactId: req.params.contactId })
		}).send(res);
	};

	updateAdmin = async (req, res, next) => {
		new SuccessResponse({
			message: 'Update contact success',
			metadata: await ContactService.updateContact({
				contactId: req.params.contactId,
				payload: req.body,
				updatedBy: req.user?.userId
			})
		}).send(res);
	};

	deleteAdmin = async (req, res, next) => {
		new SuccessResponse({
			message: 'Delete contact success',
			metadata: await ContactService.deleteContact({
				contactId: req.params.contactId
			})
		}).send(res);
	};

	bulkDeleteAdmin = async (req, res, next) => {
		new SuccessResponse({
			message: 'Bulk delete contacts success',
			metadata: await ContactService.bulkDeleteContacts({
				ids: req.body?.ids,
				allFiltered: Boolean(req.body?.allFiltered),
				filters: req.body?.filters || {}
			})
		}).send(res);
	};
}

module.exports = new ContactController();
