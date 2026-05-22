'use strict'

const newsletterModel = require('../models/newsletter.model');
const { BadRequestError } = require('../core/error.response');
const { sendMail } = require('./mail.service');

const DEFAULT_BATCH_SIZE = 50;

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeEmail = (value) => normalizeString(value).toLowerCase();
const normalizeOptional = (value) => {
  const trimmed = normalizeString(value);
  return trimmed ? trimmed : null;
};

const isValidEmail = (value) => /\S+@\S+\.\S+/.test(value);

const resolveSiteBaseUrl = () => {
  const raw =
    process.env.APP_BASE_URL || process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'http://localhost:5173';
  const trimmed = String(raw || '').trim();
  if (!trimmed) return 'http://localhost:5173';
  const withoutApi = trimmed.replace(/\/?v1\/api\/?$/i, '');
  return withoutApi.replace(/\/$/, '');
};

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const chunkArray = (values = [], size = DEFAULT_BATCH_SIZE) => {
  const result = [];
  for (let i = 0; i < values.length; i += size) {
    result.push(values.slice(i, i + size));
  }
  return result;
};

const buildBlogEmail = ({ blog, baseUrl }) => {
  const title = normalizeString(blog?.title) || 'New blog post from Inoxpran';
  const excerpt = normalizeString(blog?.excerpt);
  const slug = normalizeString(blog?.slug);
  const blogUrl = slug ? `${baseUrl}/blog/${slug}` : baseUrl;
  const image = normalizeString(blog?.image);

  const subject = title.startsWith('New blog post') ? title : `New blog post: ${title}`;

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f1f1f; max-width: 600px; margin: 0 auto;">
      <h2 style="margin-bottom: 12px;">${escapeHtml(title)}</h2>
      ${
        image
          ? `<img src="${image}" alt="${escapeHtml(title)}" style="width: 100%; border-radius: 10px; margin-bottom: 16px;" />`
          : ''
      }
      ${excerpt ? `<p style="line-height: 1.6;">${escapeHtml(excerpt)}</p>` : ''}
      <a href="${blogUrl}" style="display: inline-block; margin-top: 16px; padding: 12px 18px; background: #6ea6b9; color: #fff; text-decoration: none; border-radius: 6px;">
        Read the article
      </a>
    </div>
  `;

  const text = `${title}\n${excerpt ? `${excerpt}\n` : ''}${blogUrl}`;

  return { subject, html, text };
};

class NewsletterService {
  static async subscribe({ payload = {}, meta = {} }) {
    const email = normalizeEmail(payload.email || payload.newsletterEmail || payload.newsletter_email);
    if (!email) throw new BadRequestError('Email is required');
    if (!isValidEmail(email)) throw new BadRequestError('Email is invalid');

    const existing = await newsletterModel.findOne({ email }).lean();

    if (existing && existing.status === 'subscribed') {
      return { email, status: 'subscribed', already: true };
    }

    if (existing) {
      await newsletterModel.updateOne(
        { _id: existing._id },
        {
          $set: {
            status: 'subscribed',
            subscribedAt: new Date(),
            unsubscribedAt: null,
            sourcePage: normalizeOptional(payload.sourcePage),
            meta: {
              userAgent: normalizeOptional(meta.userAgent),
              ip: normalizeOptional(meta.ip),
              locale: normalizeOptional(meta.locale)
            }
          }
        }
      );
      return { email, status: 'subscribed', reactivated: true };
    }

    const created = await newsletterModel.create({
      email,
      status: 'subscribed',
      subscribedAt: new Date(),
      sourcePage: normalizeOptional(payload.sourcePage),
      meta: {
        userAgent: normalizeOptional(meta.userAgent),
        ip: normalizeOptional(meta.ip),
        locale: normalizeOptional(meta.locale)
      }
    });

    return { email: created.email, status: created.status, created: true };
  }

  static async listActiveSubscribers() {
    return newsletterModel
      .find({ status: 'subscribed' })
      .select('email')
      .lean();
  }

  static async sendBlogAnnouncement({ blog }) {
    if (!blog) return { sent: 0, skipped: true };

    const subscribers = await NewsletterService.listActiveSubscribers();
    const emails = Array.isArray(subscribers) ? subscribers.map((item) => item.email).filter(Boolean) : [];
    if (!emails.length) return { sent: 0, skipped: true };

    const baseUrl = resolveSiteBaseUrl();
    const { subject, html, text } = buildBlogEmail({ blog, baseUrl });

    const batches = chunkArray(emails);
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map((email) => sendMail({ to: email, subject, html, text }))
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          if (result.value?.skipped) {
            skipped += 1;
          } else {
            sent += 1;
          }
        } else {
          failed += 1;
        }
      });
    }

    return { sent, failed, skipped, total: emails.length };
  }
}

module.exports = NewsletterService;
