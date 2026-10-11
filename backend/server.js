const path = require('path');
const crypto = require('crypto');
const os = require('os');
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const { validateBookFile, validateCoverFile } = require('./file-validation');
const { isValidDatabaseId, isValidUnsignedInteger } = require('./request-validation');
const { normalizeEmail, isValidEmail } = require('./email-validation');
const { canAccessAdminApi } = require('./admin-auth-policy');

const app = express();
const port = Number(process.env.PORT || 3000);
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const browserSupabaseUrl = process.env.VITE_SUPABASE_URL || '';
const browserSupabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const sessionSecret = process.env.SESSION_SECRET || '';
if (sessionSecret.length < 32) { console.error('Set SESSION_SECRET to a stable random value of at least 32 characters.'); process.exit(1); }
if (!supabaseUrl || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before starting the API.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  let sameSupabaseProject = false;
  try { sameSupabaseProject = new URL(browserSupabaseUrl).origin === new URL(supabaseUrl).origin; } catch {}
  if (!browserSupabaseUrl || !browserSupabaseKey || !sameSupabaseProject || browserSupabaseKey === serviceKey) {
    console.error('Production admin Auth requires matching VITE_SUPABASE_URL and SUPABASE_URL plus the public VITE_SUPABASE_ANON_KEY. Never use the service-role key in Vite.');
    process.exit(1);
  }
}
const supabaseTimeoutMs = Number(process.env.SUPABASE_TIMEOUT_MS || 20000);
if (!Number.isInteger(supabaseTimeoutMs) || supabaseTimeoutMs < 1000 || supabaseTimeoutMs > 60000) { console.error('SUPABASE_TIMEOUT_MS must be an integer from 1000 through 60000.'); process.exit(1); }
const timeoutFetch = (input, init = {}) => {
  const timeout = AbortSignal.timeout(supabaseTimeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timeoutFetch } });
const storageBucket = process.env.SUPABASE_BOOKS_BUCKET || 'private-books';
const coverBucket = 'private-book-covers';
const hostedServiceUrl = process.env.RENDER_EXTERNAL_URL || '';
const isProduction = process.env.NODE_ENV === 'production';
const renderAppUrl = hostedServiceUrl ? new URL('/static/react/', hostedServiceUrl).toString() : '';
const publicAppUrl = (isProduction && renderAppUrl) || process.env.PUBLIC_APP_URL || renderAppUrl || 'http://127.0.0.1:5173/static/react/';
const publicApiUrl = (isProduction && hostedServiceUrl) || process.env.PUBLIC_API_URL || hostedServiceUrl || publicAppUrl;
if (process.env.NODE_ENV === 'production' && (!publicAppUrl.startsWith('https://') || !publicApiUrl.startsWith('https://') || !String(supabaseUrl).startsWith('https://'))) { console.error('Production requires HTTPS for PUBLIC_APP_URL, PUBLIC_API_URL, and SUPABASE_URL.'); process.exit(1); }
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const resendApiKey = process.env.RESEND_API_KEY || '';
const mailFrom = process.env.MAIL_FROM || process.env.SMTP_USER;
const mailer = smtpHost ? nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: process.env.SMTP_SECURE === 'true' || smtpPort === 465,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
}) : null;
const emailConfigured = Boolean(mailFrom && (resendApiKey || mailer));
async function sendEmail(message) {
  if (!emailConfigured) throw new Error('Email delivery is not configured. Set RESEND_API_KEY and MAIL_FROM, or configure SMTP.');
  if (resendApiKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: message.from || mailFrom, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = new Error(`Email provider rejected the message (HTTP ${response.status}).`);
      error.code = `RESEND_HTTP_${response.status}`;
      throw error;
    }
    return response.json();
  }
  return mailer.sendMail({ ...message, from: message.from || mailFrom });
}
const logEvent = (level, event, fields = {}) => console[level](JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...fields }));
const fail = (error) => { if (error) throw error; };
const one = async (table, query) => { const { data, error } = await query; fail(error); return data; };
const many = async (table, query) => { const { data, error } = await query; fail(error); return data || []; };
const getUser = async (id) => one('users', db.from('users').select('*').eq('id', id).maybeSingle());
const getBook = async (id) => one('books', db.from('books').select('*').eq('id', id).maybeSingle());
const safeUser = (u) => u && ({ id: u.id, username: u.username, email: u.email, role: u.role, is_active: u.is_active, email_verified: u.role === 'admin' ? Boolean(u.auth_email_confirmed) : u.email_verified, created_at:u.created_at, profile_photo: u.profile_photo || '', is_authenticated: true });
const MAX_SESSION_AGE_MS = 8 * 60 * 60 * 1000;
const safeBook = (b) => { if (!b) return b; const { virtual_file_path, cover_path, ...v } = b; return { ...v, has_virtual_version: Boolean(virtual_file_path), has_cover: Boolean(cover_path), cover_url: cover_path ? `/api/books/${b.id}/cover/` : '' }; };

class SupabaseSessionStore extends session.Store {
  get(sid, callback) {
    db.from('app_sessions').select('session_data,expires_at').eq('sid', sid).gt('expires_at', new Date().toISOString()).maybeSingle()
      .then(({ data, error }) => callback(error || null, data?.session_data || null)).catch(callback);
  }
  set(sid, value, callback = () => {}) {
    const expiresAt = value.cookie?.expires ? new Date(value.cookie.expires).toISOString() : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    db.from('app_sessions').upsert({ sid, session_data: value, expires_at: expiresAt }).then(({ error }) => callback(error || null)).catch(callback);
  }
  destroy(sid, callback = () => {}) { db.from('app_sessions').delete().eq('sid', sid).then(({ error }) => callback(error || null)).catch(callback); }
  touch(sid, value, callback = () => {}) {
    const expiresAt = value.cookie?.expires ? new Date(value.cookie.expires).toISOString() : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    db.from('app_sessions').update({ expires_at: expiresAt }).eq('sid', sid).then(({ error }) => callback(error || null)).catch(callback);
  }
}
const newCsrfToken = () => crypto.randomBytes(32).toString('hex');
function regenerateSession(req) { return new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve())); }
function saveSession(req) { return new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve())); }
async function writeAudit(req, event, targetType = '', targetId = null, details = {}) {
  const { error } = await db.from('security_audit_logs').insert({ actor_user_id: req.user?.id || null, event, target_type: targetType, target_id: targetId == null ? null : String(targetId), ip_address: req.ip || null, details: { ...details, request_id: req.requestId || null } });
  if (error) logEvent('error', 'audit_write_failed', { request_id: req.requestId || null, error_code: error.code || 'unknown' });
}
function rateLimit(keyParts, max, windowSeconds, message = 'Too many attempts. Please wait and try again.') {
  return async (req, res, next) => {
    try {
      for (const part of keyParts(req)) {
        const bucket = crypto.createHmac('sha256', sessionSecret).update(part).digest('hex');
        const { data, error } = await db.rpc('consume_security_rate_limit', { p_bucket: bucket, p_limit: max, p_window_seconds: windowSeconds });
        if (error) { logEvent('error', 'rate_limit_unavailable', { request_id: req.requestId || null, error_code: error.code || 'unknown' }); return res.status(503).json({ error: 'This service is temporarily unavailable. Please try again shortly.' }); }
        if (data === false) { res.set('Retry-After', String(windowSeconds)); return res.status(429).json({ error: message }); }
      }
      next();
    } catch (error) { next(error); }
  };
}
const ipKey = (req) => req.ip || req.socket.remoteAddress || 'unknown';
const loginIpLimiter = rateLimit((req) => ['login-ip:' + ipKey(req)], 40, 900, 'Too many sign-in attempts from this connection. Wait 15 minutes before trying again.');
const loginCredentialLimiter = rateLimit((req) => ['login-user:' + String(req.body.username || '').trim().toLowerCase()], 8, 900, 'Too many sign-in attempts for this account. Wait 15 minutes before trying again.');
const registrationLimiter = rateLimit((req) => ['register-ip:' + ipKey(req)], 20, 3600, 'Too many accounts were created from this connection. Try again later.');
const verificationResendLimiter = rateLimit((req) => ['verify-resend-ip:' + ipKey(req), 'verify-resend-user:' + String(req.body.identifier || req.body.username || req.body.email || '').trim().toLowerCase()], 3, 900, 'Too many confirmation requests. Wait 15 minutes and try again.');
const newsletterLimiter = rateLimit((req) => ['newsletter-ip:' + ipKey(req)], 10, 3600, 'Too many newsletter requests. Try again later.');
const resetLimiter = rateLimit((req) => ['reset-ip:' + ipKey(req), 'reset-user:' + String(req.body.username || '').trim().toLowerCase()], 5, 900, 'Too many password reset attempts. Wait 15 minutes and try again.');
const searchLimiter = rateLimit((req) => ['search-user:' + String(req.session?.userId || ipKey(req))], 120, 60, 'Too many catalogue searches. Please wait a moment and try again.');
const uploadLimiter = rateLimit((req) => ['upload-user:' + String(req.session?.userId || ipKey(req))], 20, 900, 'Too many file uploads. Please wait and try again.');
async function clearRateLimits(parts) { for (const part of parts) { const bucket = crypto.createHmac('sha256', sessionSecret).update(part).digest('hex'); const { error } = await db.rpc('clear_security_rate_limit', { p_bucket: bucket }); if (error) throw error; } }

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
async function sendVerificationEmail(user, token) {
  if (!emailConfigured) throw new Error('Email confirmation is not configured. Set RESEND_API_KEY and MAIL_FROM, or configure SMTP.');
  const link = new URL('/api/email/verify/', publicApiUrl);
  link.searchParams.set('token', token);
  const safeName = String(user.username).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  await sendEmail({
    from: mailFrom,
    to: user.email,
    subject: 'Confirm your library account',
    text: `Hello ${user.username},\n\nConfirm your library account using this link (valid for 24 hours):\n${link.href}\n\nIf you did not create this account, you can ignore this email.`,
    html: `<p>Hello ${safeName},</p><p>Confirm your library account using the button below. This link expires in 24 hours.</p><p><a href="${link.href}">Confirm my email</a></p><p>If you did not create this account, you can ignore this email.</p>`,
  });
}
const passwordMatches = (password, encoded) => {
  if (typeof encoded !== 'string') return false;
  if (encoded.startsWith('pbkdf2_sha256$')) { const [, rounds, salt, expected] = encoded.split('$'); const iterations = Number(rounds); if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10000000 || !salt || !expected) return false; const actual = Buffer.from(crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64')); const candidate = Buffer.from(expected); return actual.length === candidate.length && crypto.timingSafeEqual(actual, candidate); }
  return bcrypt.compareSync(password, encoded);
};
async function requireAuth(req, res, next) {
  try {
    const authorization = String(req.get('Authorization') || '');
    if (/^Bearer\s+/i.test(authorization)) {
      const accessToken = authorization.replace(/^Bearer\s+/i, '').trim();
      if (!accessToken || accessToken.length > 8192) return res.status(401).json({ error: 'Authentication required.' });
      const { data: identity, error: identityError } = await db.auth.getUser(accessToken);
      if (identityError || !identity?.user || !identity.user.email_confirmed_at) return res.status(401).json({ error: 'A confirmed Supabase email address is required.' });
      const { data: profile, error: profileError } = await db.from('users').select('*').eq('auth_user_id', identity.user.id).maybeSingle();
      fail(profileError);
      if (!profile?.is_active || profile.role !== 'admin') return res.status(403).json({ error: 'This account is not authorized for administrator access.' });
      req.user = profile;
      req.authIdentity = identity.user;
      req.authAccessToken = accessToken;
      const { data: assurance, error: assuranceError } = await db.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);
      if (assuranceError) return res.status(401).json({ error: 'Could not verify administrator MFA status.' });
      req.authAal = assurance?.currentLevel || 'aal1';
      if (!canAccessAdminApi({ profile, emailConfirmedAt: identity.user.email_confirmed_at, assuranceLevel: req.authAal })) {
        await writeAudit(req, 'admin_mfa_required_access_denied', 'user', profile.id, { assurance_level: req.authAal });
        return res.status(403).json({ error: 'Complete administrator MFA before accessing library management.' });
      }
      return next();
    }
    if (!req.session.userId) return res.status(401).json({ error: 'Authentication required.' });
    const authenticatedAt = Number(req.session.authenticatedAt);
    if (!Number.isFinite(authenticatedAt) || Date.now() - authenticatedAt > MAX_SESSION_AGE_MS) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Your session expired. Sign in again.' }); }
    req.user = await getUser(req.session.userId);
    if (!req.user?.is_active) { req.session.destroy(() => {}); return res.status(401).json({ error: 'This account is no longer active.' }); }
    if (req.user.role === 'admin') { req.session.destroy(() => {}); return res.status(401).json({ error: 'Administrator access requires a Supabase Auth session.' }); }
    next();
  } catch (e) { next(e); }
}
const requireRole = (role) => {
  const deniedLimiter = rateLimit((req) => [`role-denied:${role}:${req.user?.id || ipKey(req)}`], 10, 60, 'Access denied.');
  return (req, res, next) => {
    if (req.user?.role === role) {
      if (role === 'admin' && !canAccessAdminApi({ profile: req.user, emailConfirmedAt: req.authIdentity?.email_confirmed_at, assuranceLevel: req.authAal })) return res.status(403).json({ error: 'Confirmed email and administrator MFA verification are required.' });
      return next();
    }
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    return deniedLimiter(req, res, () => {
      writeAudit(req, 'access_denied', 'endpoint', req.path, { required_role: role, actual_role: req.user.role }).catch(() => {});
      res.status(403).json({ error: 'Access denied.' });
    });
  };
};
const endpoint = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use((req, res, next) => { req.requestId = crypto.randomUUID(); res.setHeader('X-Request-ID', req.requestId); next(); });
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'public, max-age=0, must-revalidate'); res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  const supabaseOrigin = (() => { try { return new URL(supabaseUrl).origin; } catch { return ''; } })();
  res.setHeader('Content-Security-Policy', `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://images.unsplash.com; font-src 'self' data:; connect-src 'self' ${supabaseOrigin}; frame-src 'self'` + (process.env.NODE_ENV === 'production' ? '; upgrade-insecure-requests' : ''));
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.get('/api/health/live/', (_req, res) => res.json({ status: 'alive' }));
app.get('/api/health/ready/', endpoint(async (req, res) => {
  const [database, storage] = await Promise.all([
    db.from('users').select('id').limit(1),
    db.storage.getBucket(storageBucket),
  ]);
  if (database.error || storage.error) {
    logEvent('error', 'readiness_check_failed', { request_id: req.requestId, database_error: database.error?.code || null, storage_error: storage.error?.name || storage.error?.statusCode || null });
    return res.status(503).json({ status: 'not_ready', request_id: req.requestId });
  }
  res.json({ status: 'ready' });
}));
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use('/api', (req, res, next) => {
  if (req.is('application/json') && (!req.body || Array.isArray(req.body) || typeof req.body !== 'object')) return res.status(400).json({ error: 'Send a JSON object in the request body.' });
  next();
});
const secureCookie = process.env.NODE_ENV === 'production';
app.use(session({ name: secureCookie ? '__Host-library.sid' : 'library.sid', secret: sessionSecret, store: new SupabaseSessionStore(), resave: false, saveUninitialized: false, rolling: true, cookie: { httpOnly: true, sameSite: 'lax', secure: secureCookie, path: '/', maxAge: 8 * 60 * 60 * 1000 } }));
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || !['POST','PUT','PATCH','DELETE'].includes(req.method) || req.path === '/api/newsletter/subscribe/' || /^Bearer\s+/i.test(String(req.get('Authorization') || ''))) return next();
  const supplied = String(req.get('X-CSRFToken') || req.get('X-CSRF-Token') || ''); const expected = String(req.session?.csrfToken || '');
  if (!expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(403).json({ error: 'Your security token expired. Refresh the page and try again.' });
  next();
});
app.use('/api', (req, res, next) => {
  const match = req.originalUrl.split('?')[0].match(/^\/api\/(?:books|reader\/books|reader\/bookmarks|admin\/books|admin\/users|admin\/categories|admin\/authors)\/([^/]+)(?:\/|$)/);
  if (match && !isValidDatabaseId(match[1])) return res.status(400).json({ error: 'Enter a valid record ID.' });
  next();
});
app.get('/api/session/', endpoint(async (req, res) => {
  const authorization = String(req.get('Authorization') || '');
  if (/^Bearer\s+/i.test(authorization)) {
    const accessToken = authorization.replace(/^Bearer\s+/i, '').trim();
    const { data: identity, error } = await db.auth.getUser(accessToken);
    if (error || !identity?.user || !identity.user.email_confirmed_at) return res.json({ user: null, adminSetupRequired: false });
    const { data: profile, error: profileError } = await db.from('users').select('*').eq('auth_user_id', identity.user.id).maybeSingle(); fail(profileError);
    if (!profile || profile.role !== 'admin' || !profile.is_active) return res.json({ user: null, adminSetupRequired: false });
    const { data: assurance, error: assuranceError } = await db.auth.mfa.getAuthenticatorAssuranceLevel(accessToken); if (assuranceError) return res.status(503).json({ error: 'Could not verify administrator MFA status.' });
    req.user = profile;
    await writeAudit(req, 'admin_auth_identity_verified', 'user', profile.id, { email_confirmed: true, assurance_level: assurance?.currentLevel || 'aal1' });
    return res.json({ user: assurance?.currentLevel === 'aal2' ? safeUser({ ...profile, email: identity.user.email, auth_email_confirmed: true }) : null, adminSetupRequired: true, adminEmail: identity.user.email, adminUsername: profile.username, mfaRequired: true, mfaEnrolled: Boolean(identity.user.factors?.some((factor) => factor.status === 'verified')) });
  }
  req.session.csrfToken ||= newCsrfToken(); const user = req.session.userId ? await getUser(req.session.userId) : null; const authenticatedAt = Number(req.session.authenticatedAt); const sessionValid = Number.isFinite(authenticatedAt) && Date.now() - authenticatedAt <= MAX_SESSION_AGE_MS; if (user && (!sessionValid || !user.is_active || user.role === 'admin')) req.session.destroy(() => {}); res.json({ csrfToken: req.session.csrfToken, user: user?.is_active && sessionValid && user.role !== 'admin' ? safeUser(user) : null });
}));
if (process.env.NODE_ENV !== 'production') app.get('/api/network-address/', (_req, res) => { const ips = Object.values(os.networkInterfaces()).flatMap((x) => x || []).filter((x) => x.family === 'IPv4' && !x.internal).map((x) => x.address); res.json({ address: ips[0] || null }); });
app.post('/api/newsletter/subscribe/', newsletterLimiter, endpoint(async (req, res) => { const email = String(req.body.email || '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' }); const { error } = await db.from('newsletter_subscriptions').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true }); fail(error); res.status(201).json({ message: 'You are subscribed to library updates.' }); }));
app.post('/api/login/', loginIpLimiter, loginCredentialLimiter, endpoint(async (req, res) => {
  const username = String(req.body.username || '').trim().slice(0, 100);
  const requestedRole = req.body.role === 'admin' ? 'admin' : 'user';
  if (requestedRole === 'admin') return res.status(403).json({ error: 'Administrator sign-in uses the assigned Supabase Auth email and password.' });
  let user = await one('users', db.from('users').select('*').eq('username', username).eq('role', requestedRole).maybeSingle());
  // Registration preserves username casing. Let members sign in with different
  // casing too, while refusing ambiguous matches if legacy data has duplicates.
  if (!user && username) {
    const pattern = username.replace(/[\\%_]/g, '\\$&');
    const matches = await many('users', db.from('users').select('*').ilike('username', pattern).eq('role', requestedRole).limit(2));
    if (matches.length === 1) user = matches[0];
  }
  // Members may also sign in with their email address, provided it identifies
  // exactly one active member account. Admins continue to use their username.
  if (!user && username.includes('@')) {
    const emailPattern = username.replace(/[\\%_]/g, '\\$&');
    const matches = await many('users', db.from('users').select('*').ilike('email', emailPattern).eq('role', requestedRole).limit(2));
    if (matches.length === 1) user = matches[0];
  }
  const password = String(req.body.password || '');
  if (!user || Buffer.byteLength(password, 'utf8') > 72 || !passwordMatches(password, user.password_hash)) { await writeAudit(req, 'login_failed', 'user', username, { requested_role: req.body.role || 'user' }); return res.status(400).json({ error: 'Invalid username or password.' }); }
  if (!user.is_active || user.role !== requestedRole) {
    await writeAudit(req, 'login_denied', 'user', user.id);
    return res.status(400).json({ error: 'Invalid username or password.' });
  }
  if (user.password_hash.startsWith('pbkdf2_sha256$')) fail((await db.from('users').update({ password_hash: bcrypt.hashSync(password, 12) }).eq('id', user.id)).error);
  await clearRateLimits(['login-ip:' + ipKey(req), 'login-user:' + username.toLowerCase()]);
  await regenerateSession(req); req.session.userId = user.id; req.session.authenticatedAt = Date.now(); req.session.csrfToken = newCsrfToken();
  await saveSession(req);
  fail((await db.from('login_activities').insert({ user_id: user.id })).error); req.user = user; await writeAudit(req, 'login_success', 'user', user.id);
  res.json({ csrfToken: req.session.csrfToken, user: safeUser(user) });
}));
app.post('/api/register/', registrationLimiter, endpoint(async (req, res) => {
  if (Object.hasOwn(req.body, 'role') && req.body.role !== 'user') return res.status(400).json({ error: 'Public registration is for member accounts only.' });
  const registrationSetting = await one('library_settings', db.from('library_settings').select('setting_value').eq('setting_key','catalogue').maybeSingle());
  if (registrationSetting?.setting_value?.registration_enabled === false) return res.status(403).json({ error: 'New account registration is currently closed.' });
  const username = String(req.body.username || '').trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!username || username.length > 64 || !email || email.length > 254 || !password) return res.status(400).json({ error: 'Enter a username up to 64 characters, a valid email address, and a password.' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ error: 'Use a password between 8 and 72 UTF-8 bytes.' });
  const { data: user, error } = await db.from('users').insert({ username, email, password_hash: bcrypt.hashSync(password, 12), role: 'user', email_verified: false }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That username or email is already in use. Sign in or reset the password for the existing account.' });
    return res.status(400).json({ error: 'We could not create the account. Please check the details or try again.' });
  }
  await writeAudit({ ...req, user }, 'member_registered', 'user', user.id); res.status(201).json({ account_created: true, message: 'Account created. You can sign in now.' });
}));
app.get('/api/email/verify/', endpoint(async (req, res) => {
  const token = String(req.query.token || '');
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).send('This confirmation link is invalid.');
  const row = await one('email_verification_tokens', db.from('email_verification_tokens').select('id,user_id').eq('token_hash', hashToken(token)).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle());
  if (!row) return res.status(400).send('This confirmation link is invalid or expired. Please register again or contact the library.');
  fail((await db.from('users').update({ email_verified: true }).eq('id', row.user_id)).error);
  fail((await db.from('email_verification_tokens').update({ used_at: new Date().toISOString() }).eq('id', row.id)).error); await writeAudit({ ...req, user: await getUser(row.user_id) }, 'email_verified', 'user', row.user_id);
  // Stay on the same public origin that received the confirmation link. This
  // avoids redirecting members to a stale or local development portal URL.
  res.redirect(303, '/static/react/?email_confirmed=1');
}));
app.post('/api/email/resend-confirmation/', verificationResendLimiter, endpoint(async (req, res) => {
  const identifier = String(req.body.identifier || req.body.username || req.body.email || '').trim().slice(0, 254);
  const generic = { message: 'If an unconfirmed account matches that username or email, a confirmation email will be sent.' };
  if (!identifier) return res.status(400).json({ error: 'Enter your username or registered email address.' });
  if (!emailConfigured) {
    logEvent('error', 'email_confirmation_resend_unavailable', { request_id: req.requestId, reason: 'email_delivery_not_configured' });
    return res.status(503).json({ error: 'Confirmation email is not configured on the library server. Please contact library staff.' });
  }
  const column = identifier.includes('@') ? 'email' : 'username';
  const pattern = identifier.replace(/[\\%_]/g, '\\$&');
  const matches = await many('users', db.from('users').select('id,username,email,is_active,email_verified').ilike(column, pattern).eq('role', 'user').limit(2));
  const user = matches.length === 1 ? matches[0] : null;
  if (!user || !user.is_active || user.email_verified || !user.email) return res.json(generic);
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  fail((await db.from('email_verification_tokens').insert({ user_id: user.id, token_hash: tokenHash, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })).error);
  try {
    await sendVerificationEmail(user, token);
  } catch (error) {
    await db.from('email_verification_tokens').update({ used_at: new Date().toISOString() }).eq('token_hash', tokenHash);
    logEvent('error', 'email_confirmation_resend_failed', { request_id: req.requestId, error_code: error.code || 'unknown' });
    return res.status(503).json({ error: 'The confirmation email could not be delivered. Please try again later or contact library staff.' });
  }
  fail((await db.from('email_verification_tokens').update({ used_at: new Date().toISOString() }).eq('user_id', user.id).is('used_at', null).neq('token_hash', tokenHash)).error);
  await writeAudit({ ...req, user }, 'email_confirmation_resent', 'user', user.id);
  res.json(generic);
}));
app.post('/api/logout/', requireAuth, endpoint(async (req, res) => { await writeAudit(req, 'logout', 'user', req.user.id); req.session.destroy(() => res.json({ ok: true })); }));
app.post('/api/account/deactivate/', requireAuth, requireRole('user'), endpoint(async (req, res) => { await writeAudit(req, 'member_deactivated', 'user', req.user.id); fail((await db.from('users').update({ is_active: false }).eq('id', req.user.id)).error); req.session.destroy(() => res.json({ ok: true, message: 'Your account has been deactivated.' })); }));
app.put('/api/account/profile-photo/', requireAuth, endpoint(async (req, res) => { const photo = String(req.body.photo || ''); if (!/^data:image\/(png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(photo) || photo.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'Choose a PNG, JPEG, WEBP, or GIF image smaller than 1.5 MB.' }); fail((await db.from('users').update({ profile_photo: photo }).eq('id', req.user.id)).error); res.json({ user: safeUser(await getUser(req.user.id)) }); }));
app.delete('/api/account/profile-photo/', requireAuth, endpoint(async (req, res) => { fail((await db.from('users').update({ profile_photo: '' }).eq('id', req.user.id)).error); res.json({ user: safeUser(await getUser(req.user.id)) }); }));

async function findMemberForPasswordReset(identifier) {
  const value = String(identifier || '').trim().slice(0, 254);
  if (!value) return null;
  const pattern = value.replace(/[\\%_]/g, '\\$&');
  const column = value.includes('@') ? 'email' : 'username';
  const matches = await many('users', db.from('users').select('id,username,email').ilike(column, pattern).eq('role', 'user').limit(2));
  return matches.length === 1 ? matches[0] : null;
}

app.post('/api/password-reset/request/', resetLimiter, endpoint(async (req, res) => {
  const identifier = String(req.body.username || '').trim().slice(0, 254);
  const generic = { message: 'If the account details match, a reset code has been emailed. Check your inbox and spam folder.' };
  const localOnly = ['127.0.0.1','::1'].includes(req.ip) || String(req.ip || '').startsWith('::ffff:127.');
  if (!emailConfigured && (process.env.NODE_ENV === 'production' || !localOnly)) {
    return res.status(503).json({ error: 'Password reset email is not configured on the server. Please contact library staff.' });
  }
  const u = await findMemberForPasswordReset(identifier);
  if (!u?.email) return res.json(generic);
  const code = crypto.randomBytes(16).toString('hex').toUpperCase();
  await db.from('password_reset_tokens').update({ used_at: new Date().toISOString() }).eq('user_id', u.id).is('used_at', null);
  fail((await db.from('password_reset_tokens').insert({ user_id: u.id, token_hash: hashToken(code), expires_at: new Date(Date.now() + 900000).toISOString() })).error);
  if (emailConfigured) {
    try {
      await sendEmail({ from: mailFrom, to: u.email, subject: 'Library password reset', text: `Your library password reset code is ${code}. It expires in 15 minutes.` });
    } catch (error) {
      await db.from('password_reset_tokens').update({ used_at: new Date().toISOString() }).eq('user_id', u.id).is('used_at', null);
      logEvent('error', 'password_reset_email_failed', { request_id: req.requestId, error_code: error.code || 'unknown' });
      return res.status(503).json({ error: 'The reset email could not be sent. Please try again later or contact library staff.' });
    }
  } else if (process.env.NODE_ENV !== 'production' && localOnly) generic.reset_code = code;
  res.json(generic);
}));
app.post('/api/password-reset/confirm/', resetLimiter, endpoint(async (req, res) => {
  const identifier = String(req.body.username || '').trim().slice(0, 254);
  const code = String(req.body.code || '').trim().toUpperCase();
  const password = String(req.body.password || '');
  if (!/^[A-F0-9]{32}$/.test(code)) return res.status(400).json({ error: 'Invalid or expired reset code.' });
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ error: 'Use a password between 8 and 72 UTF-8 bytes.' });
  const user = await findMemberForPasswordReset(identifier);
  if (!user) return res.status(400).json({ error: 'Invalid or expired reset code.' });
  const passwordHash = bcrypt.hashSync(password, 12);
  const { data: userId, error } = await db.rpc('consume_password_reset', { p_username: user.username, p_token_hash: hashToken(code), p_password_hash: passwordHash });
  fail(error);
  if (!userId) return res.status(400).json({ error: 'Invalid or expired reset code.' });
  const updatedUser = await getUser(userId);
  await writeAudit({ ...req, user: updatedUser }, 'password_reset_completed', 'user', updatedUser.id);
  res.json({ message: 'Password reset successfully. You can now sign in.' });
}));

app.get('/api/books/', requireAuth, (req, res, next) => {
  if (['q','category','author','language','year_min','year_max'].some((key) => req.query[key])) return searchLimiter(req, res, next);
  next();
}, endpoint(async (req, res) => {
  const adminAll = req.user.role === 'admin' && req.query.include_unreadable === '1';
  const all = adminAll && req.query.all === '1';
  const pageValue = req.query.page ?? '0', limitValue = req.query.limit ?? '24';
  if (typeof pageValue !== 'string' || !isValidUnsignedInteger(pageValue, 100000)) return res.status(400).json({ error: 'Choose a valid catalogue page.' });
  if (typeof limitValue !== 'string' || !isValidUnsignedInteger(limitValue, 60) || Number(limitValue) < 1) return res.status(400).json({ error: 'Choose a page size from 1 to 60.' });
  for (const key of ['category','author']) if (req.query[key] != null && (typeof req.query[key] !== 'string' || !isValidDatabaseId(req.query[key]))) return res.status(400).json({ error: `Choose a valid ${key}.` });
  for (const key of ['q','language']) if (req.query[key] != null && (typeof req.query[key] !== 'string' || req.query[key].length > (key === 'q' ? 80 : 40))) return res.status(400).json({ error: `Enter a shorter ${key === 'q' ? 'search' : 'language'} filter.` });
  for (const key of ['year_min','year_max']) if (req.query[key] != null && (typeof req.query[key] !== 'string' || !isValidUnsignedInteger(req.query[key], 3000) || Number(req.query[key]) < 1000)) return res.status(400).json({ error: 'Choose a publication year between 1000 and 3000.' });
  if (req.query.year_min && req.query.year_max && Number(req.query.year_min) > Number(req.query.year_max)) return res.status(400).json({ error: 'The minimum year must not exceed the maximum year.' });
  if (req.query.sort != null && (typeof req.query.sort !== 'string' || !['title','author','newest','popular'].includes(req.query.sort))) return res.status(400).json({ error: 'Choose a valid catalogue sort order.' });
  const page = Number(pageValue);
  const limit = all ? 1000 : Number(limitValue);
  let q = db.from('books').select('*', { count: 'exact' });
  if (!adminAll) q = q.eq('status', 'published').not('virtual_file_path', 'is', null).neq('virtual_file_path', '');
  if (req.query.q) { const term = String(req.query.q).replace(/[(),%_]/g, ' ').trim().slice(0, 80); if (term) q = q.or(['title','author','category','isbn','description','publisher','language'].map((k) => `${k}.ilike.%${term}%`).join(',')); }
  if (req.query.category) q = q.eq('category_id', req.query.category);
  if (req.query.author) { const links=await many('book_authors',db.from('book_authors').select('book_id').eq('author_id',req.query.author));const ids=[...new Set(links.map(link=>link.book_id))];if(!ids.length)return res.json({books:[],total:0,page,limit,pages:0});q=q.in('id',ids); }
  if (req.query.language) q = q.ilike('language', String(req.query.language).slice(0, 40));
  const yearMin = Number.parseInt(req.query.year_min || '', 10), yearMax = Number.parseInt(req.query.year_max || '', 10);
  if (Number.isInteger(yearMin)) q = q.gte('publication_year', yearMin);
  if (Number.isInteger(yearMax)) q = q.lte('publication_year', yearMax);
  const popularSort = req.query.sort === 'popular' && !adminAll;
  const sort = ['title','author','newest'].includes(req.query.sort) ? req.query.sort : 'title';
  if (sort === 'newest') q = q.order('created_at', { ascending: false }); else q = q.order(sort, { ascending: true });
  if (!all) q = q.range(popularSort ? 0 : page * limit, popularSort ? 4999 : page * limit + limit - 1);
  const result = await q; fail(result.error); let books = result.data || [];
  if (popularSort && books.length) {
    const events = await many('book_open_events', db.from('book_open_events').select('book_id').in('book_id', books.map((book) => book.id)).order('opened_at', { ascending: false }).limit(5000));
    const counts = new Map(); for (const event of events) counts.set(event.book_id, (counts.get(event.book_id) || 0) + 1);
    books.sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || a.title.localeCompare(b.title)); books = books.slice(page * limit, page * limit + limit);
  }
  if(adminAll&&books.length){const links=await many('book_authors',db.from('book_authors').select('book_id,author_id,position').in('book_id',books.map(book=>book.id)).order('position'));const grouped=new Map();for(const link of links)grouped.set(link.book_id,[...(grouped.get(link.book_id)||[]),link.author_id]);books=books.map(book=>({...safeBook(book),author_ids:grouped.get(book.id)||[book.author_id].filter(Boolean)}));}
  res.json({ books: books.map(safeBook), total: result.count || 0, page, limit, pages: Math.ceil((result.count || 0) / limit) });
}));
app.get('/api/admin/books/', requireAuth, requireRole('admin'), endpoint(async(req,res)=>{
  const page=Math.max(0,Number.parseInt(req.query.page||'0',10)||0),limit=req.query.all==='1'?1000:30;let query=db.from('books').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(page*limit,page*limit+limit-1);
  if(req.query.q){const term=String(req.query.q).replace(/[(),]/g,'');query=query.or(`title.ilike.%${term}%,author.ilike.%${term}%,isbn.ilike.%${term}%,category.ilike.%${term}%`);}if(['draft','published','archived'].includes(req.query.status))query=query.eq('status',req.query.status);
  const {data,error,count}=await query;fail(error);let items=data||[];if(items.length){const links=await many('book_authors',db.from('book_authors').select('book_id,author_id,position').in('book_id',items.map(book=>book.id)).order('position'));const grouped=new Map();for(const link of links)grouped.set(link.book_id,[...(grouped.get(link.book_id)||[]),link.author_id]);items=items.map(book=>({...safeBook(book),author_ids:grouped.get(book.id)||[book.author_id].filter(Boolean)}));}
  res.json({books:items,total:count||0,page,limit});
}));
function bookPayload(d, current = {}) {
  const title = String(d.title ?? current.title ?? '').trim(), author = String(d.author ?? current.author ?? '').trim();
  if (!title || !author) throw Object.assign(new Error('Title and author are required.'), { status: 400 });
  const publicationYear = d.publication_year === '' || d.publication_year == null ? current.publication_year ?? null : Number(d.publication_year);
  if (publicationYear != null && (!Number.isInteger(publicationYear) || publicationYear < 1000 || publicationYear > new Date().getFullYear() + 1)) throw Object.assign(new Error('Enter a valid publication year.'), { status: 400 });
  const status = d.status ?? current.status ?? 'published';
  if (!['draft','published','archived'].includes(status)) throw Object.assign(new Error('Choose a valid publication status.'), { status: 400 });
  return {
    title, author, isbn: String(d.isbn ?? current.isbn ?? '').trim(), category: String(d.category ?? current.category ?? '').trim(),
    description: String(d.description ?? current.description ?? '').trim(), publisher: String(d.publisher ?? current.publisher ?? '').trim(),
    language: String(d.language ?? current.language ?? '').trim(), publication_year: publicationYear,
    tags: Array.isArray(d.tags) ? d.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0,30) : current.tags || [],
    is_featured: d.is_featured == null ? Boolean(current.is_featured) : Boolean(d.is_featured), status,
    category_id: Object.hasOwn(d,'category_id') ? (d.category_id || null) : (current.category_id || null), author_id: Object.hasOwn(d,'author_id') ? (d.author_id || null) : (current.author_id || null),
    author_ids: Array.isArray(d.author_ids) ? [...new Set(d.author_ids.map(Number).filter(Number.isInteger))].slice(0,20) : (current.author_id?[current.author_id]:[]),
  };
}
async function resolveBookNames(changes) {
  if (changes.category_id) { const category=await one('categories',db.from('categories').select('id,name,is_active').eq('id',changes.category_id).maybeSingle()); if(!category?.is_active)throw Object.assign(new Error('Choose an active category.'),{status:400}); changes.category=category.name; }
  if (changes.author_ids.length) { const authors=await many('authors',db.from('authors').select('id,name').in('id',changes.author_ids));if(authors.length!==changes.author_ids.length)throw Object.assign(new Error('Choose existing authors.'),{status:400});authors.sort((a,b)=>changes.author_ids.indexOf(a.id)-changes.author_ids.indexOf(b.id));changes.author=authors.map(author=>author.name).join(', ');changes.author_id=authors[0].id; }
  else if (changes.author_id) { const author=await one('authors',db.from('authors').select('id,name').eq('id',changes.author_id).maybeSingle()); if(!author)throw Object.assign(new Error('Choose an existing author.'),{status:400}); changes.author=author.name; }
  return changes;
}
app.post('/api/books/', requireAuth, requireRole('admin'), endpoint(async (req, res) => {
  if(String(req.body.status||'draft')==='published')return res.status(400).json({error:'Save as a draft, upload the book file, then publish it after validation.'});
  const resolved=await resolveBookNames(bookPayload(req.body));const authorIds=resolved.author_ids;delete resolved.author_ids;
  const titlePattern=resolved.title.replace(/[\\%_]/g,'\\$&'),authorPattern=resolved.author.replace(/[\\%_]/g,'\\$&');
  const duplicate=await one('books',db.from('books').select('id').ilike('title',titlePattern).ilike('author',authorPattern).eq('isbn',resolved.isbn).limit(1).maybeSingle());
  if(duplicate)return res.status(409).json({error:'This book is already in the catalogue. Open the existing record to edit it.'});
  const { data, error } = await db.from('books').insert(resolved).select().single();
  if (error) return res.status(400).json({ error: error.code === '23505' ? 'A book with that ISBN already exists.' : 'Unable to save the book.' });
  if(authorIds.length)fail((await db.from('book_authors').insert(authorIds.map((author_id,position)=>({book_id:data.id,author_id,position})))).error);
  await writeAudit(req, 'book_created', 'book', data.id, { status: data.status }); res.status(201).json({ book: safeBook(data) });
}));
app.put('/api/books/:id/', requireAuth, requireRole('admin'), endpoint(async (req, res) => {
  const current = await getBook(req.params.id); if (!current) return res.status(404).json({ error: 'Book not found.' });
  const changes = await resolveBookNames(bookPayload(req.body, current));
  const authorIds=changes.author_ids;delete changes.author_ids;
  const titlePattern=changes.title.replace(/[\\%_]/g,'\\$&'),authorPattern=changes.author.replace(/[\\%_]/g,'\\$&');
  const duplicate=await one('books',db.from('books').select('id').ilike('title',titlePattern).ilike('author',authorPattern).eq('isbn',changes.isbn).neq('id',current.id).limit(1).maybeSingle());
  if(duplicate)return res.status(409).json({error:'Another catalogue record already has this title, author, and ISBN.'});
  if (changes.status === 'published') {
    if (!changes.title?.trim() || !changes.author?.trim() || !changes.category?.trim()) return res.status(400).json({ error: 'Add a title, author, and category before publishing.' });
    if (!current.virtual_file_path) return res.status(400).json({ error: 'Upload a digital book before publishing it.' });
    const validation = await db.storage.from(storageBucket).download(current.virtual_file_path);
    if (validation.error || !validation.data?.size) return res.status(400).json({ error: 'The digital file could not be opened. Validate or upload the file before publishing.' });
    changes.validated_at = new Date().toISOString(); changes.file_size = validation.data.size;
  }
  const { data, error } = await db.from('books').update(changes).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.code === '23505' ? 'A book with that ISBN already exists.' : 'Unable to save the book.' });
  fail((await db.from('book_authors').delete().eq('book_id',data.id)).error);
  if(authorIds.length)fail((await db.from('book_authors').insert(authorIds.map((author_id,position)=>({book_id:data.id,author_id,position})))).error);
  await writeAudit(req, changes.status !== current.status ? `book_${changes.status}` : 'book_updated', 'book', req.params.id, { changed_fields: Object.keys(changes).filter((key) => changes[key] !== current[key]) }); res.json({ book: safeBook(data) });
}));
app.delete('/api/books/:id/', requireAuth, requireRole('admin'), endpoint(async (req, res) => {
  const book = await getBook(req.params.id); if (!book) return res.status(404).json({ error: 'Book not found.' });
  fail((await db.from('books').update({ status: 'archived', is_featured: false }).eq('id', book.id)).error);
  await writeAudit(req, 'book_archived', 'book', book.id); res.json({ ok: true });
}));

app.put('/api/admin/books/:id/virtual-file/', requireAuth, requireRole('admin'), uploadLimiter, express.raw({ type: ['application/pdf','text/plain'], limit: '50mb' }), endpoint(async (req, res) => {
  const book = await getBook(req.params.id); if (!book) return res.status(404).json({ error: 'Book not found.' });
  const mime = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
  const validation = validateBookFile({ mime, filename: req.query.filename, bytes: req.body });
  if (validation.error) return res.status(400).json({ error: validation.error });
  const key = `${crypto.randomUUID()}${path.extname(validation.name).toLowerCase()}`;
  const { error: uploadError } = await db.storage.from(storageBucket).upload(key, req.body, { contentType: mime, upsert: false }); fail(uploadError);
  const { data: updated, error: updateError } = await db.from('books').update({ virtual_file_path: key, virtual_file_name: validation.name, virtual_file_type: mime, file_size: req.body.length, validated_at: new Date().toISOString() }).eq('id', book.id).select('id').maybeSingle();
  if (updateError || !updated) {
    const { error: cleanupError } = await db.storage.from(storageBucket).remove([key]);
    if (cleanupError) logEvent('error', 'orphan_upload_cleanup_failed', { request_id: req.requestId, object_kind: 'book' });
    if (updateError) throw updateError;
    return res.status(404).json({ error: 'Book not found.' });
  }
  if (book.virtual_file_path) {
    const { error: cleanupError } = await db.storage.from(storageBucket).remove([book.virtual_file_path]);
    if (cleanupError) logEvent('error', 'replaced_book_cleanup_failed', { request_id: req.requestId, book_id: book.id });
  }
  await writeAudit(req, 'virtual_book_uploaded', 'book', book.id, { content_type: mime, file_size: req.body.length, replaced_existing: Boolean(book.virtual_file_path) });
  res.json({ book: safeBook(await getBook(book.id)) });
}));
app.delete('/api/admin/books/:id/virtual-file/', requireAuth, requireRole('admin'), endpoint(async (req, res) => { const book = await getBook(req.params.id); if (!book) return res.status(404).json({ error: 'Book not found.' }); fail((await db.from('books').update({ virtual_file_path: '', virtual_file_name: '', virtual_file_type: '', file_size: 0, validated_at: null }).eq('id', book.id)).error); if (book.virtual_file_path) { const { error } = await db.storage.from(storageBucket).remove([book.virtual_file_path]); if (error) logEvent('error', 'book_file_cleanup_failed', { request_id: req.requestId, book_id: book.id }); } await writeAudit(req, 'digital_book_removed', 'book', book.id); res.json({ book: safeBook(await getBook(book.id)) }); }));
app.get('/api/books/:id/read/', requireAuth, endpoint(async (req, res) => { const book = await getBook(req.params.id); if (!book?.virtual_file_path || (req.user.role !== 'admin' && book.status !== 'published')) return res.status(404).json({ error: 'This book is not currently available to read online.' }); if (book.virtual_file_type !== 'text/plain') return res.status(415).json({ error: 'This book is not a plain text document.' }); const { data, error } = await db.storage.from(storageBucket).download(book.virtual_file_path); fail(error); res.json({ title: book.title, text: await data.text() }); }));
app.get('/api/books/:id/content/', requireAuth, endpoint(async (req, res) => { const book = await getBook(req.params.id); if (!book?.virtual_file_path || (req.user.role !== 'admin' && book.status !== 'published')) return res.status(404).json({ error: 'This book is not currently available to read online.' }); const { data, error } = await db.storage.from(storageBucket).download(book.virtual_file_path); fail(error); res.setHeader('Content-Type', book.virtual_file_type); res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(book.virtual_file_name.replace(/[\r\n"]/g,'_'))}`); res.setHeader('X-Content-Type-Options', 'nosniff'); res.send(Buffer.from(await data.arrayBuffer())); }));
app.get('/api/books/:id/cover/', requireAuth, endpoint(async (req, res) => { const book = await getBook(req.params.id); if (!book?.cover_path || (req.user.role !== 'admin' && book.status !== 'published')) return res.sendStatus(404); const { data, error } = await db.storage.from(coverBucket).download(book.cover_path); if (error) return res.sendStatus(404); res.setHeader('Content-Type', book.cover_type || 'image/webp'); res.setHeader('Cache-Control', 'private, no-store'); res.send(Buffer.from(await data.arrayBuffer())); }));
app.post('/api/books/:id/open/', requireAuth, endpoint(async (req, res) => { const book = await getBook(req.params.id); if (!book?.virtual_file_path || (req.user.role !== 'admin' && book.status !== 'published')) return res.status(404).json({ error: 'This book is not currently available to read online.' }); if(req.user.role==='user') { fail((await db.from('book_open_events').insert({ book_id: book.id, user_id: req.user.id })).error); const previous=await one('reader_history',db.from('reader_history').select('open_count').eq('user_id',req.user.id).eq('book_id',book.id).maybeSingle()); fail((await db.from('reader_history').upsert({book_id:book.id,user_id:req.user.id,last_opened_at:new Date().toISOString(),open_count:Number(previous?.open_count||0)+1},{onConflict:'user_id,book_id'})).error); } res.status(201).json({ ok: true }); }));

function readerLocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const page = Number(value.page);
  if (!Number.isInteger(page) || page < 1 || page > 100000) return null;
  return { page };
}
async function readerBook(id) {
  const book = await getBook(id);
  if (!book || book.status !== 'published' || !book.virtual_file_path) return null;
  return book;
}
app.get('/api/reader/categories/', requireAuth, requireRole('user'), endpoint(async (_req,res)=>{
  const [categories,books]=await Promise.all([many('categories',db.from('categories').select('id,name,description').eq('is_active',true).order('name')),many('books',db.from('books').select('category_id').eq('status','published').not('virtual_file_path','is',null).neq('virtual_file_path',''))]);
  res.json({categories:categories.map(category=>({...category,book_count:books.filter(book=>book.category_id===category.id).length}))});
}));
app.get('/api/reader/authors/', requireAuth, requireRole('user'), endpoint(async(_req,res)=>{
  const [authors,links,books]=await Promise.all([many('authors',db.from('authors').select('id,name,biography').order('name')),many('book_authors',db.from('book_authors').select('author_id,book_id')),many('books',db.from('books').select('id').eq('status','published').not('virtual_file_path','is',null).neq('virtual_file_path',''))]);
  const available=new Set(books.map(book=>book.id));res.json({authors:authors.map(author=>({...author,book_count:new Set(links.filter(link=>link.author_id===author.id&&available.has(link.book_id)).map(link=>link.book_id)).size})).filter(author=>author.book_count>0)});
}));
app.get('/api/reader/home/', requireAuth, requireRole('user'), endpoint(async(req,res)=>{
  const since=new Date(Date.now()-30*86400000).toISOString();
  const [progress,history,events]=await Promise.all([
    many('reader_progress',db.from('reader_progress').select('book_id,location,updated_at').eq('user_id',req.user.id).order('updated_at',{ascending:false}).limit(12)),
    many('reader_history',db.from('reader_history').select('book_id,last_opened_at,open_count').eq('user_id',req.user.id).order('last_opened_at',{ascending:false}).limit(12)),
    many('book_open_events',db.from('book_open_events').select('book_id').gte('opened_at',since).order('opened_at',{ascending:false}).limit(5000)),
  ]);
  const ids=[...new Set([...progress.map(x=>x.book_id),...history.map(x=>x.book_id),...events.map(x=>x.book_id)])];
  const books=ids.length?await many('books',db.from('books').select('*').in('id',ids).eq('status','published').not('virtual_file_path','is',null).neq('virtual_file_path','')):[];
  const byId=new Map(books.map(book=>[book.id,book]));const opens=new Map();for(const event of events)if(byId.has(event.book_id))opens.set(event.book_id,(opens.get(event.book_id)||0)+1);
  res.json({continue_reading:progress.map(row=>({book:byId.has(row.book_id)?safeBook(byId.get(row.book_id)):null,location:row.location,updated_at:row.updated_at})).filter(row=>row.book),recently_read:history.map(row=>({book:byId.has(row.book_id)?safeBook(byId.get(row.book_id)):null,last_opened_at:row.last_opened_at,open_count:row.open_count})).filter(row=>row.book),popular:[...books].sort((a,b)=>(opens.get(b.id)||0)-(opens.get(a.id)||0)||a.title.localeCompare(b.title)).slice(0,8).map(book=>({...safeBook(book),opens:opens.get(book.id)||0}))});
}));
app.get('/api/reader/books/:id/state/', requireAuth, requireRole('user'), endpoint(async(req,res)=>{
  const book=await readerBook(req.params.id);if(!book)return res.status(404).json({error:'This book is no longer available.'});
  const [favourite,progress,bookmarks]=await Promise.all([one('reader_favourites',db.from('reader_favourites').select('created_at').eq('user_id',req.user.id).eq('book_id',book.id).maybeSingle()),one('reader_progress',db.from('reader_progress').select('location,updated_at').eq('user_id',req.user.id).eq('book_id',book.id).maybeSingle()),many('reader_bookmarks',db.from('reader_bookmarks').select('id,name,location,created_at').eq('user_id',req.user.id).eq('book_id',book.id).order('created_at',{ascending:false}))]);
  res.json({favourite:Boolean(favourite),progress:progress?.location||null,bookmarks});
}));
app.get('/api/reader/favourites/', requireAuth, requireRole('user'), endpoint(async(req,res)=>{
  const rows=await many('reader_favourites',db.from('reader_favourites').select('book_id,created_at').eq('user_id',req.user.id).order('created_at',{ascending:false}).limit(500));
  const ids=rows.map(row=>row.book_id);const books=ids.length?await many('books',db.from('books').select('*').in('id',ids).eq('status','published').not('virtual_file_path','is',null).neq('virtual_file_path','')):[];const byId=new Map(books.map(book=>[book.id,book]));
  res.json({favourites:rows.map(row=>({book_id:row.book_id,book:byId.has(row.book_id)?safeBook(byId.get(row.book_id)):null,unavailable:!byId.has(row.book_id),created_at:row.created_at}))});
}));
app.post('/api/reader/books/:id/favourite/', requireAuth, requireRole('user'), endpoint(async(req,res)=>{const book=await readerBook(req.params.id);if(!book)return res.status(404).json({error:'This book is no longer available.'});const {error}=await db.from('reader_favourites').upsert({user_id:req.user.id,book_id:book.id},{onConflict:'user_id,book_id',ignoreDuplicates:true});fail(error);res.status(201).json({ok:true});}));
app.delete('/api/reader/books/:id/favourite/', requireAuth, requireRole('user'), endpoint(async(req,res)=>{const {error}=await db.from('reader_favourites').delete().eq('user_id',req.user.id).eq('book_id',req.params.id);fail(error);res.json({ok:true});}));
app.put('/api/reader/books/:id/progress/', requireAuth, requireRole('user'), endpoint(async(req,res)=>{const book=await readerBook(req.params.id);if(!book)return res.status(404).json({error:'This book is no longer available.'});const location=readerLocation(req.body.location);if(!location)return res.status(400).json({error:'Enter a valid reading page.'});const {error}=await db.from('reader_progress').upsert({user_id:req.user.id,book_id:book.id,location,updated_at:new Date().toISOString()},{onConflict:'user_id,book_id'});fail(error);fail((await db.from('reader_history').update({last_page:location.page}).eq('user_id',req.user.id).eq('book_id',book.id)).error);res.json({location});}));
app.post('/api/reader/books/:id/bookmarks/', requireAuth, requireRole('user'), endpoint(async(req,res)=>{const book=await readerBook(req.params.id);if(!book)return res.status(404).json({error:'This book is no longer available.'});const location=readerLocation(req.body.location);if(!location)return res.status(400).json({error:'Enter a valid bookmark page.'});const name=String(req.body.name||'').trim().slice(0,80);const {data,error}=await db.from('reader_bookmarks').insert({user_id:req.user.id,book_id:book.id,name,location}).select('id,name,location,created_at').single();fail(error);res.status(201).json({bookmark:data});}));
app.put('/api/reader/bookmarks/:id/', requireAuth, requireRole('user'), endpoint(async(req,res)=>{const name=String(req.body.name||'').trim().slice(0,80);const {data,error}=await db.from('reader_bookmarks').update({name}).eq('id',req.params.id).eq('user_id',req.user.id).select('id,name,location,created_at').maybeSingle();fail(error);if(!data)return res.status(404).json({error:'Bookmark not found.'});res.json({bookmark:data});}));
app.delete('/api/reader/bookmarks/:id/', requireAuth, requireRole('user'), endpoint(async(req,res)=>{const {error}=await db.from('reader_bookmarks').delete().eq('id',req.params.id).eq('user_id',req.user.id);fail(error);res.json({ok:true});}));
app.get('/api/reader/history/', requireAuth, requireRole('user'), endpoint(async(req,res)=>{const rows=await many('reader_history',db.from('reader_history').select('book_id,last_opened_at,open_count,last_page').eq('user_id',req.user.id).order('last_opened_at',{ascending:false}).range(0,99));const ids=rows.map(row=>row.book_id);const books=ids.length?await many('books',db.from('books').select('*').in('id',ids).eq('status','published').not('virtual_file_path','is',null).neq('virtual_file_path','')):[];const byId=new Map(books.map(book=>[book.id,book]));res.json({history:rows.map(row=>({book_id:row.book_id,book:byId.has(row.book_id)?safeBook(byId.get(row.book_id)):null,unavailable:!byId.has(row.book_id),last_opened_at:row.last_opened_at,open_count:row.open_count,last_page:row.last_page||null}))});}));
app.delete('/api/reader/history/', requireAuth, requireRole('user'), endpoint(async(req,res)=>{const [history,events]=await Promise.all([db.from('reader_history').delete().eq('user_id',req.user.id),db.from('book_open_events').delete().eq('user_id',req.user.id)]);fail(history.error);fail(events.error);res.json({ok:true});}));
app.get('/api/catalogue/homepage/', requireAuth, requireRole('user'), endpoint(async(_req,res)=>{
  const [settings,featuredBooks,recentBooks]=await Promise.all([
    one('library_settings',db.from('library_settings').select('setting_value').eq('setting_key','catalogue').maybeSingle()),
    many('books',db.from('books').select('*').eq('status','published').eq('is_featured',true).not('virtual_file_path','is',null).neq('virtual_file_path','').order('title').limit(20)),
    many('books',db.from('books').select('*').eq('status','published').not('virtual_file_path','is',null).neq('virtual_file_path','').order('created_at',{ascending:false}).limit(8)),
  ]);
  const ids=settings?.setting_value?.featured_book_ids||[];const byId=new Map(featuredBooks.map(book=>[book.id,book]));const ordered=ids.map(id=>byId.get(id)).filter(Boolean);for(const book of featuredBooks)if(!ordered.some(item=>item.id===book.id))ordered.push(book);
  res.json({featured:ordered.slice(0,12).map(safeBook),recent:recentBooks.map(safeBook)});
}));

app.put('/api/admin/books/:id/cover/', requireAuth, requireRole('admin'), uploadLimiter, express.raw({ type: ['image/jpeg','image/png','image/webp'], limit: '5mb' }), endpoint(async (req,res) => {
  const book = await getBook(req.params.id); if (!book) return res.status(404).json({ error: 'Book not found.' });
  const mime = String(req.headers['content-type'] || '').split(';')[0].toLowerCase(), bytes = req.body;
  const validation = validateCoverFile({ mime, bytes });
  if (validation.error) return res.status(400).json({ error: validation.error });
  const key = `${crypto.randomUUID()}.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`;
  fail((await db.storage.from(coverBucket).upload(key, bytes, { contentType: mime, upsert: false })).error);
  const { data: updated, error } = await db.from('books').update({ cover_path: key, cover_type: mime, cover_size: bytes.length }).eq('id', book.id).select('id').maybeSingle();
  if (error || !updated) {
    const { error: cleanupError } = await db.storage.from(coverBucket).remove([key]);
    if (cleanupError) logEvent('error', 'orphan_upload_cleanup_failed', { request_id: req.requestId, object_kind: 'cover' });
    if (error) throw error;
    return res.status(404).json({ error: 'Book not found.' });
  }
  if (book.cover_path) {
    const { error: cleanupError } = await db.storage.from(coverBucket).remove([book.cover_path]);
    if (cleanupError) logEvent('error', 'replaced_cover_cleanup_failed', { request_id: req.requestId, book_id: book.id });
  }
  await writeAudit(req,'book_cover_replaced','book',book.id,{ content_type:mime,file_size:bytes.length });
  res.json({ book:safeBook(await getBook(book.id)) });
}));
app.get('/api/admin/books/:id/validate/', requireAuth, requireRole('admin'), endpoint(async (req,res) => {
  const book = await getBook(req.params.id); if (!book) return res.status(404).json({ error:'Book not found.' });
  const checks = { metadata: Boolean(book.title?.trim() && book.author?.trim() && book.category?.trim()), file: false, cover: !book.cover_path };
  if (book.virtual_file_path) { const { data,error } = await db.storage.from(storageBucket).download(book.virtual_file_path); checks.file = !error && Boolean(data?.size); }
  if (book.cover_path) { const { data,error } = await db.storage.from(coverBucket).download(book.cover_path); checks.cover = !error && Boolean(data?.size); }
  const valid = checks.metadata && checks.file;
  if (valid) fail((await db.from('books').update({ validated_at:new Date().toISOString(),file_size:(await db.storage.from(storageBucket).download(book.virtual_file_path)).data.size }).eq('id',book.id)).error);
  await writeAudit(req,'book_file_validated','book',book.id,{ valid,checks });
  res.json({ valid,checks,book:safeBook(await getBook(book.id)) });
}));

app.get('/api/admin/summary/', requireAuth, requireRole('admin'), endpoint(async (req, res) => {
  const [books, users, activityResult, events, audit] = await Promise.all([
    many('books', db.from('books').select('*').neq('status','archived').order('created_at', { ascending: false })),
    many('users', db.from('users').select('id,username,email,role,is_active,email_verified,profile_photo,created_at').order('created_at',{ascending:false})),
    db.from('login_activities').select('*').order('logged_in_at', { ascending: false }).limit(30),
    db.rpc('admin_library_analytics',{ p_since:new Date(Date.now()-30*86400000).toISOString() }),
    many('security_audit_logs',db.from('security_audit_logs').select('id,actor_user_id,event,target_type,target_id,details,created_at').order('created_at',{ascending:false}).limit(12)),
  ]);
  fail(activityResult.error); fail(events.error);
  const activities = activityResult.data || [];
  const login_activities = await Promise.all(activities.map(async (a) => ({ id: a.id, user: safeUser(await getUser(a.user_id)), logged_in_at: a.logged_in_at })));
  const recent_actions = await Promise.all(audit.map(async (item) => ({ ...item, actor: item.actor_user_id ? safeUser(await getUser(item.actor_user_id)) : null })));
  const metrics = events.data;
  const readable = books.filter((b) => b.status === 'published' && b.virtual_file_path);
  res.json({ stats: { total_books:metrics.books.total,published_books:metrics.books.published,draft_books:metrics.books.drafts,archived_books:metrics.books.archived,readable_books:readable.length,total_users:metrics.readers.readers,active_users:metrics.readers.active_readers,deactivated_users:metrics.readers.deactivated_readers,total_opens:metrics.activity.opens,unique_readers:metrics.activity.unique_readers,registrations_30d:metrics.readers.registrations,storage_bytes:metrics.books.file_bytes }, books:books.map(safeBook), users:users.map(safeUser), login_activities, recent_actions, most_read:metrics.most_read, activity_daily:metrics.daily, popular_categories:metrics.popular_categories });
}));
app.get('/api/admin/analytics/', requireAuth, requireRole('admin'), endpoint(async (req,res) => {
  const period = ['7','30','90'].includes(String(req.query.days)) ? Number(req.query.days) : 30;
  const result = await db.rpc('admin_library_analytics',{ p_since:new Date(Date.now()-period*86400000).toISOString() }); fail(result.error); res.json({ days:period, ...result.data });
}));
app.get('/api/admin/categories/', requireAuth, requireRole('admin'), endpoint(async (_req,res) => {
  const [categories,books] = await Promise.all([many('categories',db.from('categories').select('*').order('name')),many('books',db.from('books').select('category_id'))]);
  res.json({ categories:categories.map((item)=>({...item,book_count:books.filter((book)=>book.category_id===item.id).length})) });
}));
app.post('/api/admin/categories/', requireAuth, requireRole('admin'), endpoint(async (req,res) => {
  const name=String(req.body.name||'').trim(); if(!name) return res.status(400).json({error:'Category name is required.'});
  const {data,error}=await db.from('categories').insert({name,description:String(req.body.description||'').trim()}).select().single(); if(error)return res.status(400).json({error:error.code==='23505'?'That category already exists.':'Unable to create category.'});
  await writeAudit(req,'category_created','category',data.id);res.status(201).json({category:data});
}));
app.put('/api/admin/categories/:id/', requireAuth, requireRole('admin'), endpoint(async (req,res)=>{
  const name=String(req.body.name||'').trim();if(!name)return res.status(400).json({error:'Category name is required.'});
  const {data,error}=await db.from('categories').update({name,description:String(req.body.description||'').trim(),is_active:req.body.is_active!==false}).eq('id',req.params.id).select().maybeSingle();if(error)return res.status(400).json({error:'Unable to update category.'});if(!data)return res.status(404).json({error:'Category not found.'});
  fail((await db.from('books').update({category:data.name}).eq('category_id',data.id)).error);await writeAudit(req,'category_updated','category',data.id);res.json({category:data});
}));
app.get('/api/admin/authors/', requireAuth, requireRole('admin'), endpoint(async (_req,res)=>{
  const [authors,links]=await Promise.all([many('authors',db.from('authors').select('*').order('name')),many('book_authors',db.from('book_authors').select('author_id,book_id'))]);res.json({authors:authors.map((item)=>({...item,book_count:new Set(links.filter((link)=>link.author_id===item.id).map(link=>link.book_id)).size}))});
}));
app.post('/api/admin/authors/', requireAuth, requireRole('admin'), endpoint(async (req,res)=>{
  const name=String(req.body.name||'').trim();if(!name)return res.status(400).json({error:'Author name is required.'});const {data,error}=await db.from('authors').insert({name,biography:String(req.body.biography||'').trim()}).select().single();if(error)return res.status(400).json({error:error.code==='23505'?'That author already exists.':'Unable to create author.'});await writeAudit(req,'author_created','author',data.id);res.status(201).json({author:data});
}));
app.put('/api/admin/authors/:id/', requireAuth, requireRole('admin'), endpoint(async (req,res)=>{
  const name=String(req.body.name||'').trim();if(!name)return res.status(400).json({error:'Author name is required.'});const {data,error}=await db.from('authors').update({name,biography:String(req.body.biography||'').trim()}).eq('id',req.params.id).select().maybeSingle();if(error)return res.status(400).json({error:'Unable to update author.'});if(!data)return res.status(404).json({error:'Author not found.'});const links=await many('book_authors',db.from('book_authors').select('book_id,author_id').eq('author_id',data.id));for(const link of links){const authors=await many('authors',db.from('authors').select('name').in('id',(await many('book_authors',db.from('book_authors').select('author_id').eq('book_id',link.book_id))).map(item=>item.author_id)));fail((await db.from('books').update({author:authors.map(item=>item.name).join(', ')}).eq('id',link.book_id)).error);}await writeAudit(req,'author_updated','author',data.id);res.json({author:data});
}));
app.get('/api/admin/audit/', requireAuth, requireRole('admin'), endpoint(async (req,res)=>{
  const page=Math.max(0,Number.parseInt(req.query.page||'0',10)||0),limit=50;let query=db.from('security_audit_logs').select('id,actor_user_id,event,target_type,target_id,details,created_at',{count:'exact'}).order('created_at',{ascending:false}).range(page*limit,page*limit+limit-1);
  if(req.query.q)query=query.ilike('event',`%${String(req.query.q).replace(/[%_,]/g,'')}%`);if(req.query.event)query=query.eq('event',req.query.event);
  const {data,error,count}=await query;fail(error);const records=await Promise.all((data||[]).map(async item=>({...item,actor:item.actor_user_id?safeUser(await getUser(item.actor_user_id)):null})));res.json({records,total:count||0,page,limit});
}));
app.get('/api/admin/settings/', requireAuth, requireRole('admin'), endpoint(async (_req,res)=>{const rows=await many('library_settings',db.from('library_settings').select('setting_key,setting_value,updated_at'));res.json({settings:Object.fromEntries(rows.map(row=>[row.setting_key,row.setting_value]))});}));
app.get('/api/admin/security/', requireAuth, requireRole('admin'), endpoint(async(req,res)=>{const admins=await many('users',db.from('users').select('id').eq('role','admin').eq('is_active',true));res.json({mfa_enabled:req.authAal==='aal2',mfa_required:true,active_admins:admins.length,smtp_configured:emailConfigured,email_provider:resendApiKey?'Resend API':mailer?'SMTP':'Not configured'});}));
app.put('/api/admin/settings/:key/', requireAuth, requireRole('admin'), endpoint(async (req,res)=>{
  const key=String(req.params.key);if(!['branding','catalogue'].includes(key))return res.status(400).json({error:'That setting cannot be changed here.'});const value=req.body.value;if(!value||typeof value!=='object'||Array.isArray(value))return res.status(400).json({error:'Provide valid settings.'});
  let safe;if(key==='branding')safe={name:String(value.name||'').trim().slice(0,100),contact_email:String(value.contact_email||'').trim().slice(0,254),contact_phone:String(value.contact_phone||'').trim().slice(0,40),logo_url:String(value.logo_url||'').trim().slice(0,500)};
  else safe={registration_enabled:Boolean(value.registration_enabled),featured_book_ids:Array.isArray(value.featured_book_ids)?value.featured_book_ids.slice(0,12).map(Number).filter(Number.isInteger):[]};
  if(key==='branding'&&!safe.name)return res.status(400).json({error:'Library name is required.'});
  if(key==='catalogue'){
    if(safe.featured_book_ids.length){const eligible=await many('books',db.from('books').select('id').in('id',safe.featured_book_ids).eq('status','published').not('virtual_file_path','is',null).neq('virtual_file_path',''));if(eligible.length!==safe.featured_book_ids.length)return res.status(400).json({error:'Only published books with an online file can be featured.'});}
    fail((await db.from('books').update({is_featured:false}).eq('is_featured',true)).error);
    if(safe.featured_book_ids.length)fail((await db.from('books').update({is_featured:true}).in('id',safe.featured_book_ids)).error);
  }
  const {error}=await db.from('library_settings').upsert({setting_key:key,setting_value:safe,updated_by:req.user.id,updated_at:new Date().toISOString()});fail(error);await writeAudit(req,'system_setting_updated','setting',key,{fields:Object.keys(safe)});res.json({key,value:safe});
}));
async function listStorageObjects(bucket) {
  const objects = [], limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const { data, error } = await db.storage.from(bucket).list('', { limit, offset });
    fail(error);
    objects.push(...(data || []));
    if (!data || data.length < limit) return objects;
  }
}
app.get('/api/admin/storage-health/', requireAuth, requireRole('admin'), endpoint(async (_req,res)=>{
  const [books,bookObjects,coverObjects]=await Promise.all([
    many('books',db.from('books').select('id,title,virtual_file_path,cover_path,file_size,status')),
    listStorageObjects(storageBucket),listStorageObjects(coverBucket),
  ]);
  const bookKeys=new Set(books.map(b=>b.virtual_file_path).filter(Boolean)),coverKeys=new Set(books.map(b=>b.cover_path).filter(Boolean));
  const storedBookKeys=new Set(bookObjects.map(item=>item.name)),storedCoverKeys=new Set(coverObjects.map(item=>item.name));
  res.json({book_bucket:{objects:bookObjects.length,bytes:bookObjects.reduce((sum,item)=>sum+Number(item.metadata?.size||0),0),orphaned:bookObjects.filter(item=>!bookKeys.has(item.name)).map(item=>item.name)},cover_bucket:{objects:coverObjects.length,bytes:coverObjects.reduce((sum,item)=>sum+Number(item.metadata?.size||0),0),orphaned:coverObjects.filter(item=>!coverKeys.has(item.name)).map(item=>item.name)},missing_books:books.filter(b=>b.status!=='archived'&&!b.virtual_file_path).map(b=>({id:b.id,title:b.title})),unavailable_books:books.filter(b=>b.status!=='archived'&&b.virtual_file_path&&!storedBookKeys.has(b.virtual_file_path)).map(b=>({id:b.id,title:b.title,status:b.status})),missing_covers:books.filter(b=>b.status!=='archived'&&!b.cover_path).map(b=>({id:b.id,title:b.title})),unavailable_covers:books.filter(b=>b.status!=='archived'&&b.cover_path&&!storedCoverKeys.has(b.cover_path)).map(b=>({id:b.id,title:b.title}))});
}));
app.get('/api/admin/users/', requireAuth, requireRole('admin'), endpoint(async(req,res)=>{
  const page=Math.max(0,Number.parseInt(req.query.page||'0',10)||0),limit=50;let query=db.from('users').select('id,username,email,role,is_active,email_verified,profile_photo,created_at',{count:'exact'}).order('created_at',{ascending:false}).range(page*limit,page*limit+limit-1);
  if(req.query.q){const term=String(req.query.q).replace(/[(),]/g,'');query=query.or(`username.ilike.%${term}%,email.ilike.%${term}%`);}if(req.query.status==='active')query=query.eq('is_active',true);if(req.query.status==='deactivated')query=query.eq('is_active',false);if(['admin','user'].includes(req.query.role))query=query.eq('role',req.query.role);
  const {data,error,count}=await query;fail(error);res.json({users:(data||[]).map(safeUser),total:count||0,page,limit});
}));
app.patch('/api/admin/users/:id/', requireAuth, requireRole('admin'), endpoint(async(req,res)=>{
  const target=await getUser(req.params.id);if(!target)return res.status(404).json({error:'Account not found.'});
  const role=req.body.role===undefined?target.role:req.body.role,active=req.body.is_active===undefined?target.is_active:Boolean(req.body.is_active);
  if(!['admin','user'].includes(role))return res.status(400).json({error:'Choose a valid role.'});if(target.role!=='admin'&&role==='admin')return res.status(403).json({error:'Use the authorized server-side Supabase Auth provisioning process to grant administrator access.'});if(target.id===req.user.id&&(role!=='admin'||!active))return res.status(400).json({error:'You cannot remove your own admin access.'});
  if(target.role==='admin'&&(role!=='admin'||!active)){const admins=await many('users',db.from('users').select('id').eq('role','admin').eq('is_active',true));if(admins.length<=1)return res.status(400).json({error:'The last active administrator cannot be deactivated or demoted.'});}
  fail((await db.from('users').update({role,is_active:active}).eq('id',target.id)).error);await writeAudit(req,role!==target.role?'reader_role_changed':active!==target.is_active?(active?'reader_activated':'reader_deactivated'):'reader_updated','user',target.id,{role,is_active:active});res.json({user:safeUser(await getUser(target.id))});
}));
app.post('/api/admin/users/:id/recovery/', requireAuth, requireRole('admin'), endpoint(async(req,res)=>{const user=await getUser(req.params.id);if(!user||user.role!=='user')return res.status(404).json({error:'Reader account not found.'});if(!user.email)return res.status(400).json({error:'This reader has no email address on the account.'});if(!emailConfigured)return res.status(503).json({error:'Account recovery email is not configured on the server.'});const code=crypto.randomBytes(16).toString('hex').toUpperCase();await db.from('password_reset_tokens').update({used_at:new Date().toISOString()}).eq('user_id',user.id).is('used_at',null);fail((await db.from('password_reset_tokens').insert({user_id:user.id,token_hash:hashToken(code),expires_at:new Date(Date.now()+900000).toISOString()})).error);await sendEmail({from:mailFrom,to:user.email,subject:'Library account recovery',text:`A library administrator initiated account recovery for you. Your one-time reset code is ${code}. It expires in 15 minutes. If you did not expect this, contact the library.`});await writeAudit(req,'reader_recovery_initiated','user',user.id);res.json({ok:true,message:'A secure one-time recovery code was emailed to the reader.'});}));
app.delete('/api/admin/users/:id/', requireAuth, requireRole('admin'), endpoint(async (req, res) => { const u = await getUser(req.params.id); if (!u) return res.status(404).json({ error: 'User not found.' }); if (u.role !== 'user') return res.status(403).json({ error: 'Admin accounts cannot be removed here.' }); await writeAudit(req, 'member_deleted', 'user', u.id); fail((await db.from('users').delete().eq('id', u.id)).error); res.json({ ok: true, username: u.username }); }));
function csvCell(value) { const raw = String(value ?? ''); const safe = /^[\s]*[=+@\-]/.test(raw) ? `'${raw}` : raw; return `"${safe.replaceAll('"','""')}"`; }
app.get('/api/admin/reports/download/', requireAuth, requireRole('admin'), endpoint(async (_req, res) => { const users = await many('users', db.from('users').select('username,email,role,is_active,email_verified').order('username')); const csv = [['Username','Email','Role','Active','Email verified'], ...users.map((u) => [u.username,u.email,u.role,u.is_active,u.email_verified])].map((r) => r.map(csvCell).join(',')).join('\n'); await writeAudit(_req, 'member_report_exported', 'users', null, { record_count: users.length }); res.type('text/csv').attachment('library-members-report.csv').send(csv); }));
app.get('/api/admin/reports/analytics.csv', requireAuth, requireRole('admin'), endpoint(async(req,res)=>{const days=['7','30','90'].includes(String(req.query.days))?Number(req.query.days):30;const {data,error}=await db.rpc('admin_library_analytics',{p_since:new Date(Date.now()-days*86400000).toISOString()});fail(error);const rows=[['Report','Metric','Value'],['Readers',`Registrations (${days} days)`,data.readers.registrations],['Readers','Active readers',data.readers.active_readers],['Activity',`Book opens (${days} days)`,data.activity.opens],['Activity','Unique readers',data.activity.unique_readers],...data.most_read.map(book=>['Most opened books',book.title,book.opens]),...data.popular_categories.map(item=>['Popular categories',item.category,item.opens]),...data.daily.map(item=>['Daily activity',item.day,item.opens])];const csv=rows.map(row=>row.map(csvCell).join(',')).join('\n');await writeAudit(req,'analytics_report_exported','analytics',null,{days});res.type('text/csv').attachment(`library-analytics-${days}-days.csv`).send(csv);}));

const buildDir = path.join(__dirname, '..', 'static', 'react');
app.use('/static/react', express.static(buildDir));
app.use(express.static(buildDir));
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((req, res) => res.sendFile(path.join(buildDir, 'index.html')));
app.use((error, req, res, _next) => {
  const errorStatus = Number(error.status || error.statusCode) || 500;
  const status = [400, 413, 415].includes(errorStatus) ? errorStatus : (error.name === 'AbortError' || error.name === 'TimeoutError' ? 503 : 500);
  const errorCode = /^[A-Za-z0-9_.-]{1,40}$/.test(String(error.code || '')) ? error.code : null;
  logEvent(status >= 500 ? 'error' : 'warn', 'request_failed', { request_id: req.requestId || null, method: req.method, path: req.path, status, error_name: String(error.name || 'Error').slice(0, 40), error_code: errorCode });
  if (res.headersSent) return res.end();
  const message = status === 413 ? 'The request is too large.' : status === 400 ? 'The request could not be read. Check the supplied data.' : status === 415 ? 'This content type is not supported.' : status === 503 ? 'A required service did not respond in time. Please retry.' : 'An unexpected server error occurred.';
  res.status(status).json({ error: message, request_id: req.requestId || null });
});
async function start() {
  await ensurePrivateBucket(storageBucket, { fileSizeLimit: 52428800, allowedMimeTypes: ['application/pdf', 'text/plain'] });
  await ensurePrivateBucket(coverBucket, { fileSizeLimit: 5242880, allowedMimeTypes: ['image/jpeg','image/png','image/webp'] });
  fail((await db.from('app_sessions').delete().lte('expires_at', new Date().toISOString())).error);
  const sessionCleanup = setInterval(() => db.from('app_sessions').delete().lte('expires_at', new Date().toISOString()).then(({ error }) => { if (error) logEvent('error', 'expired_session_cleanup_failed', { error_code: error.code || 'unknown' }); }), 60 * 60 * 1000); sessionCleanup.unref();
  const server = app.listen(port, '0.0.0.0', () => logEvent('info', 'server_started', { port, host: '0.0.0.0', node_env: process.env.NODE_ENV || 'development' }));
  server.headersTimeout = 15000;
  server.requestTimeout = 120000;
  server.keepAliveTimeout = 5000;
}
async function ensurePrivateBucket(name, options) {
  const existing = await db.storage.getBucket(name);
  if (!existing.error && existing.data) {
    const { error } = await db.storage.updateBucket(name, { ...options, public: false });
    fail(error);
    return;
  }
  if (String(existing.error?.statusCode || existing.error?.status) !== '404') fail(existing.error);
  const { error } = await db.storage.createBucket(name, { ...options, public: false });
  fail(error);
}
start().catch((error) => { logEvent('error', 'startup_failed', { error_name: String(error.name || 'Error'), error_code: error.code || 'unknown' }); process.exit(1); });
