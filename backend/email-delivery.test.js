'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPasswordResetLink, createEmailSender, createGmailTransport, readGmailSmtpConfig, resolvePublicUrls, safeMailErrorCode } = require('./email-delivery');

const gmailEnv = (overrides = {}) => ({
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'library@gmail.com',
  SMTP_PASSWORD: 'abcdefghijklmnop',
  MAIL_FROM: 'Library <library@gmail.com>',
  RESEND_API_KEY: 'ignored-provider-key',
  ...overrides,
});

test('Gmail SMTP config requires complete credentials and matches the sender mailbox', () => {
  const config = readGmailSmtpConfig(gmailEnv({ SMTP_PASSWORD: 'abcd efgh ijkl mnop' }));
  assert.equal(config.host, 'smtp.gmail.com');
  assert.equal(config.user, 'library@gmail.com');
  assert.equal(config.password, 'abcdefghijklmnop');
  assert.equal(config.mailFrom, 'Library <library@gmail.com>');
  assert.throws(() => readGmailSmtpConfig(gmailEnv({ SMTP_USER: '' })), { code: 'SMTP_CONFIG_INCOMPLETE' });
  assert.throws(() => readGmailSmtpConfig(gmailEnv({ MAIL_FROM: 'other@example.com' })), { code: 'SMTP_SENDER_MISMATCH' });
});

test('Gmail SMTP uses explicit TLS settings for supported ports', () => {
  assert.equal(readGmailSmtpConfig(gmailEnv()).secure, true);
  assert.equal(readGmailSmtpConfig(gmailEnv({ SMTP_PORT: '587', SMTP_SECURE: 'false' })).secure, false);
  assert.throws(() => readGmailSmtpConfig(gmailEnv({ SMTP_PORT: '587', SMTP_SECURE: 'true' })), { code: 'SMTP_TLS_MISMATCH' });
  assert.throws(() => readGmailSmtpConfig(gmailEnv({ SMTP_HOST: 'mail.example.net' })), { code: 'SMTP_HOST_UNSUPPORTED' });
});

test('mailer is configured with authenticated Gmail identity and never selects a Resend key', async () => {
  let transportOptions;
  const fakeNodemailer = { createTransport: (options) => { transportOptions = options; return { sendMail: async (message) => message }; } };
  const { config, transporter } = createGmailTransport(gmailEnv(), fakeNodemailer);
  const sendEmail = createEmailSender(transporter, config.mailFrom);
  const sent = await sendEmail({ to: 'reader@example.org', from: 'spoof@example.org', subject: 'Test' });
  assert.equal(config.user, 'library@gmail.com');
  assert.equal(transportOptions.auth.user, 'library@gmail.com');
  assert.equal(transportOptions.auth.pass, 'abcdefghijklmnop');
  assert.equal(transportOptions.host, 'smtp.gmail.com');
  assert.equal(sent.from, 'Library <library@gmail.com>');
  assert.equal(transportOptions.requireTLS, false);
  assert.equal(sent.to, 'reader@example.org');
  createGmailTransport(gmailEnv({ SMTP_PORT: '587', SMTP_SECURE: 'false' }), fakeNodemailer);
  assert.equal(transportOptions.requireTLS, true);
  assert.throws(() => createEmailSender(null, '')({ to: 'reader@example.org' }), { code: 'SMTP_NOT_CONFIGURED' });
});

test('password-reset link keeps its token in the fragment and validates its shape', () => {
  const token = 'a'.repeat(64);
  const link = new URL(buildPasswordResetLink('https://library.example/static/react/', 'Reader One', token));
  assert.equal(link.pathname, '/static/react/');
  assert.equal(link.search, '');
  const fragment = new URLSearchParams(link.hash.slice(1));
  assert.equal(fragment.get('password_reset'), '1');
  assert.equal(fragment.get('username'), 'Reader One');
  assert.equal(fragment.get('token'), token);
  assert.throws(() => buildPasswordResetLink('https://library.example/', 'Reader', 'short'), { code: 'RESET_TOKEN_INVALID' });
});

test('production email URLs use public Render URLs and reject localhost destinations', () => {
  const urls = resolvePublicUrls({
    NODE_ENV: 'production',
    RENDER_EXTERNAL_URL: 'https://library.onrender.com',
    PUBLIC_APP_URL: 'http://127.0.0.1:5173/static/react/',
    PUBLIC_API_URL: 'http://127.0.0.1:3000',
  });
  assert.equal(urls.isProduction, true);
  assert.equal(urls.publicAppUrl, 'https://library.onrender.com/static/react/');
  assert.equal(urls.publicApiUrl, 'https://library.onrender.com');
  assert.deepEqual(urls.warnings, ['PUBLIC_APP_URL', 'PUBLIC_API_URL']);
  assert.throws(() => resolvePublicUrls({ NODE_ENV: 'production', PUBLIC_API_URL: 'http://127.0.0.1:3000' }), { code: 'PUBLIC_URL_NOT_PUBLIC' });
});

test('mail error logging exposes only a short error code', () => {
  assert.equal(safeMailErrorCode({ code: 'EAUTH', message: 'secret App Password was rejected' }), 'EAUTH');
  assert.equal(safeMailErrorCode({ code: 'long code with secrets' }), 'UNKNOWN');
});
