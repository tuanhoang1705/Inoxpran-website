'use strict';

const { SuccessResponse } = require('../core/success.response');
const { BadRequestError } = require('../core/error.response');
const { sendMail } = require('../services/mail.service');

class MailController {
  test = async (req, res, next) => {
    const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
    if (!to) {
      throw new BadRequestError('Recipient email is required');
    }
    if (!/\S+@\S+\.\S+/.test(to)) {
      throw new BadRequestError('Recipient email is invalid');
    }

    const subject =
      typeof req.body?.subject === 'string' && req.body.subject.trim()
        ? req.body.subject.trim()
        : 'Inoxpran mail test';

    const text =
      typeof req.body?.text === 'string' && req.body.text.trim()
        ? req.body.text.trim()
        : 'This is a test email from Inoxpran.';

    const html =
      typeof req.body?.html === 'string' && req.body.html.trim()
        ? req.body.html.trim()
        : `<p>${text}</p>`;

    const result = await sendMail({ to, subject, text, html });
    if (result?.skipped) {
      throw new BadRequestError('SMTP is not configured');
    }

    new SuccessResponse({
      message: 'Test email sent',
      metadata: {
        to,
        messageId: result?.messageId || null,
        accepted: result?.accepted || [],
        rejected: result?.rejected || []
      }
    }).send(res);
  };
}

module.exports = new MailController();
