'use strict';

const nodemailer = require('nodemailer');

const getEnv = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const hasEnv = (key) => Object.prototype.hasOwnProperty.call(process.env, key);

const isTrue = (value) => String(value || '').trim().toLowerCase() === 'true';

const buildTransporter = () => {
  const host = getEnv('SMTP_HOST');
  const service = getEnv('SMTP_SERVICE');
  const user = getEnv('SMTP_USER', 'SMTP_USERNAME');
  const pass = getEnv('SMTP_PASS', 'SMTP_PASSWORD', 'MAILTRAP_API_TOKEN');
  const portValue = Number(getEnv('SMTP_PORT') || 587);
  const port = Number.isFinite(portValue) ? portValue : 587;
  const secure = hasEnv('SMTP_SECURE') ? isTrue(process.env.SMTP_SECURE) : port === 465;

  // We need auth credentials plus either a named service (e.g. gmail) or an explicit SMTP host (e.g. Mailtrap).
  if ((!host && !service) || !user || !pass) {
    return null;
  }

  const transportConfig = {
    auth: {
      user,
      pass
    }
  };

  if (host) {
    transportConfig.host = host;
    transportConfig.port = port;
    transportConfig.secure = secure;

    // Mailtrap recommends STARTTLS on 587/2525/25 and forced TLS on 465.
    if (/mailtrap\.io$/i.test(host) && !secure) {
      transportConfig.requireTLS = true;
    }
  } else {
    transportConfig.service = service;
    transportConfig.secure = secure;
  }

  return nodemailer.createTransport(transportConfig);
};

const sendMail = async ({ to, subject, html, text }) => {
  const transporter = buildTransporter();
  if (!transporter) {
    return { skipped: true };
  }

  const fromAddress = getEnv('SMTP_FROM') || 'no-reply@inoxpran.com';
  const fromName = getEnv('SMTP_FROM_NAME');
  const from = fromName ? { name: fromName, address: fromAddress } : fromAddress;
  return transporter.sendMail({
    from,
    to,
    subject,
    html,
    text
  });
};

module.exports = {
  sendMail
};
