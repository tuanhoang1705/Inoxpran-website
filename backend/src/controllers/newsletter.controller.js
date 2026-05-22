'use strict'

const NewsletterService = require('../services/newsletter.service');
const { CREATED } = require('../core/success.response');

class NewsletterController {
  subscribe = async (req, res, next) => {
    const payload = {
      ...req.body,
      sourcePage: req.body?.sourcePage || req.get('referer')
    };

    const metadata = await NewsletterService.subscribe({
      payload,
      meta: {
        userAgent: req.get('user-agent'),
        ip: req.ip,
        locale: req.headers['accept-language']
      }
    });

    const message = metadata.already
      ? 'Email already subscribed'
      : metadata.reactivated
        ? 'Subscription reactivated'
        : 'Newsletter subscribed successfully';

    new CREATED({ message, metadata }).send(res);
  };
}

module.exports = new NewsletterController();
