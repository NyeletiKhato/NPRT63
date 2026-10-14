'use strict';

const nodemailer = require('nodemailer');
const net = require('node:net');
const { normalizeEmail, isValidEmail } = require('./email-validation');

function configError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPrivateOrLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const octets = host.split('.').map(Number);
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
  }
  if (ipVersion === 6) return host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
  return false;
}

function resolvePublicUrls(env = process.env) {
  const renderUrl = String(env.RENDER_EXTERNAL_URL || '').trim();
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production' || Boolean(renderUrl);
  let renderOrigin = '';
  if (renderUrl) {
    try { renderOrigin = new URL(renderUrl).origin; }
    catch { throw configError('PUBLIC_URL_INVALID', 'RENDER_EXTERNAL_URL must be a valid public URL.'); }
  }
  const defaultAppUrl = renderOrigin ? new URL('/static/react/', renderOrigin).toString() : 'http://127.0.0.1:5173/static/react/';
  const defaultApiUrl = renderOrigin || 'http://127.0.0.1:3000';
  let publicAppUrl = String(env.PUBLIC_APP_URL || defaultAppUrl).trim();
  let publicApiUrl = String(env.PUBLIC_API_URL || defaultApiUrl || publicAppUrl).trim();
  const warnings = [];

  for (const [name, value] of [['PUBLIC_APP_URL', publicAppUrl], ['PUBLIC_API_URL', publicApiUrl]]) {
    let parsed;
    try { parsed = new URL(value); }
    catch { throw configError('PUBLIC_URL_INVALID', `${name} must be a valid absolute URL.`); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw configError('PUBLIC_URL_INVALID', `${name} must be an HTTP or HTTPS URL without embedded credentials.`);
    }
    if (isProduction && (parsed.protocol !== 'https:' || isPrivateOrLoopbackHost(parsed.hostname))) {
      if (!renderOrigin || !isProduction) {
        throw configError('PUBLIC_URL_NOT_PUBLIC', `In production, ${name} must use a public HTTPS address. Do not use localhost, 127.0.0.1, or a private network address.`);
      }
      warnings.push(name);
      if (name === 'PUBLIC_APP_URL') publicAppUrl = defaultAppUrl;
      else publicApiUrl = defaultApiUrl;
    }
  }
  return { isProduction, publicAppUrl, publicApiUrl, warnings };
}

function mailboxAddress(value) {
  const input = String(value || '').trim();
  const bracketed = input.match(/<([^<>]+)>/);
  const address = bracketed ? bracketed[1].trim() : input;
  if (!address || address.includes(',') || !isValidEmail(address)) return '';
  return normalizeEmail(address);
}

function readGmailSmtpConfig(env = process.env) {
  const host = String(env.SMTP_HOST || '').trim().toLowerCase();
  const user = normalizeEmail(env.SMTP_USER || '');
  const password = String(env.SMTP_PASSWORD || '').replace(/\s/g, '');
  const portValue = String(env.SMTP_PORT || '465').trim();
  const secureValue = String(env.SMTP_SECURE ?? '').trim().toLowerCase();
  const anySmtpSetting = Boolean(host || user || password || env.SMTP_PORT || env.SMTP_SECURE);

  if (!anySmtpSetting) return null;
  if (!host || !user || !password) {
    throw configError('SMTP_CONFIG_INCOMPLETE', 'Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD to configure Gmail SMTP.');
  }
  if (host !== 'smtp.gmail.com') {
    throw configError('SMTP_HOST_UNSUPPORTED', 'Gmail SMTP requires SMTP_HOST=smtp.gmail.com.');
  }
  if (!isValidEmail(user)) throw configError('SMTP_USER_INVALID', 'SMTP_USER must be the Gmail account email address.');
  if (!/^\d+$/.test(portValue) || ![465, 587].includes(Number(portValue))) {
    throw configError('SMTP_PORT_INVALID', 'Gmail SMTP_PORT must be 465 or 587.');
  }
  const port = Number(portValue);
  let secure;
  if (secureValue) {
    if (!['true', 'false'].includes(secureValue)) throw configError('SMTP_SECURE_INVALID', 'SMTP_SECURE must be true or false.');
    secure = secureValue === 'true';
  } else {
    secure = port === 465;
  }
  if ((port === 465) !== secure) {
    throw configError('SMTP_TLS_MISMATCH', 'Use SMTP_PORT=465 with SMTP_SECURE=true, or SMTP_PORT=587 with SMTP_SECURE=false.');
  }

  const mailFrom = String(env.MAIL_FROM || user).trim();
  if (mailboxAddress(mailFrom) !== user) {
    throw configError('SMTP_SENDER_MISMATCH', 'MAIL_FROM must use the same email address as SMTP_USER.');
  }
  return { host, port, secure, user, password, mailFrom };
}

function createGmailTransport(env = process.env, nodemailerApi = nodemailer) {
  const config = readGmailSmtpConfig(env);
  if (!config) return { config: null, transporter: null };
  const transporter = nodemailerApi.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    requireTLS: config.port === 587,
    tls: { minVersion: 'TLSv1.2' },
  });
  return { config, transporter };
}

function createEmailSender(transporter, mailFrom) {
  return (message) => {
    if (!transporter) throw configError('SMTP_NOT_CONFIGURED', 'Gmail SMTP is not configured.');
    return transporter.sendMail({ ...message, from: mailFrom });
  };
}

function safeMailErrorCode(error) {
  const value = String(error?.code || error?.name || 'unknown').toUpperCase();
  return /^[A-Z0-9_-]{1,32}$/.test(value) ? value : 'UNKNOWN';
}

function buildPasswordResetLink(appUrl, username, token) {
  if (!/^[a-f0-9]{64}$/i.test(String(token || ''))) throw configError('RESET_TOKEN_INVALID', 'A valid password-reset token is required.');
  const link = new URL(appUrl);
  link.hash = new URLSearchParams({ password_reset: '1', username: String(username), token: String(token) }).toString();
  return link.toString();
}

module.exports = { buildPasswordResetLink, createEmailSender, createGmailTransport, mailboxAddress, readGmailSmtpConfig, resolvePublicUrls, safeMailErrorCode };
