const path = require('path');
const crypto = require('crypto');
const os = require('os');
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = Number(process.env.PORT || 3000);
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sessionSecret = process.env.SESSION_SECRET || '';
const mfaEncryptionSecret = process.env.MFA_ENCRYPTION_KEY || '';
const mfaEncryptionKey = crypto.createHash('sha256').update(mfaEncryptionSecret).digest();
if (sessionSecret.length < 32) { console.error('Set SESSION_SECRET to a stable random value of at least 32 characters.'); process.exit(1); }
if (mfaEncryptionSecret.length < 32) { console.error('Set MFA_ENCRYPTION_KEY to a stable random secret of at least 32 characters.'); process.exit(1); }
if (!supabaseUrl || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before starting the API.');
  process.exit(1);
}
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const storageBucket = process.env.SUPABASE_BOOKS_BUCKET || 'private-books';
const publicAppUrl = process.env.PUBLIC_APP_URL || 'http://127.0.0.1:5173/static/react/';
if (process.env.NODE_ENV === 'production' && (!publicAppUrl.startsWith('https://') || !String(supabaseUrl).startsWith('https://'))) { console.error('Production requires HTTPS for PUBLIC_APP_URL and SUPABASE_URL.'); process.exit(1); }
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const mailFrom = process.env.MAIL_FROM || process.env.SMTP_USER;
const mailer = smtpHost ? nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: process.env.SMTP_SECURE === 'true' || smtpPort === 465,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
}) : null;
const fail = (error) => { if (error) throw error; };
const one = async (table, query) => { const { data, error } = await query; fail(error); return data; };
const many = async (table, query) => { const { data, error } = await query; fail(error); return data || []; };
const getUser = async (id) => one('users', db.from('users').select('*').eq('id', id).maybeSingle());
const getBook = async (id) => one('books', db.from('books').select('*').eq('id', id).maybeSingle());
const safeUser = (u) => u && ({ id: u.id, username: u.username, email: u.email, role: u.role, is_active: u.is_active, email_verified: u.email_verified, profile_photo: u.profile_photo || '', is_authenticated: true });
const safeBook = (b) => { if (!b) return b; const { virtual_file_path, ...v } = b; return { ...v, has_virtual_version: Boolean(virtual_file_path) }; };

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
function encodeBase32(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, value = 0, output = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) output += alphabet[(value << (5 - bits)) & 31]; return output;
}
function decodeBase32(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, value = 0; const output = [];
  for (const char of text.toUpperCase().replace(/=+$/,'')) { const digit = alphabet.indexOf(char); if (digit < 0) throw new Error('Invalid MFA secret.'); value = (value << 5) | digit; bits += 5; if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(output);
}
function encryptMfaSecret(secret) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', mfaEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}
function decryptMfaSecret(value) {
  const [iv, tag, encrypted] = String(value || '').split('.'); const decipher = crypto.createDecipheriv('aes-256-gcm', mfaEncryptionKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}
function verifyTotp(secret, supplied) {
  if (!/^\d{6}$/.test(String(supplied || ''))) return false;
  const key = decodeBase32(secret), counter = Math.floor(Date.now() / 30000);
  for (let offset = -1; offset <= 1; offset += 1) {
    const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter + offset));
    const digest = crypto.createHmac('sha1', key).update(message).digest(); const index = digest[digest.length - 1] & 15;
    const value = (digest.readUInt32BE(index) & 0x7fffffff) % 1000000;
    const expected = Buffer.from(String(value).padStart(6, '0')); const actual = Buffer.from(String(supplied));
    if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) return true;
  }
  return false;
}
async function writeAudit(req, event, targetType = '', targetId = null, details = {}) {
  const { error } = await db.from('security_audit_logs').insert({ actor_user_id: req.user?.id || null, event, target_type: targetType, target_id: targetId == null ? null : String(targetId), ip_address: req.ip || null, details });
  if (error) console.error('Security audit write failed:', error.message);
}
function rateLimit(keyParts, max, windowSeconds, message = 'Too many attempts. Please wait and try again.') {
  return async (req, res, next) => {
    try {
      for (const part of keyParts(req)) {
        const bucket = crypto.createHmac('sha256', sessionSecret).update(part).digest('hex');
        const { data, error } = await db.rpc('consume_security_rate_limit', { p_bucket: bucket, p_limit: max, p_window_seconds: windowSeconds });
        if (error) { console.error('Security rate limiter unavailable:', error.message); return res.status(503).json({ error: 'This service is temporarily unavailable. Please try again shortly.' }); }
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
const newsletterLimiter = rateLimit((req) => ['newsletter-ip:' + ipKey(req)], 10, 3600, 'Too many newsletter requests. Try again later.');
const resetLimiter = rateLimit((req) => ['reset-ip:' + ipKey(req), 'reset-user:' + String(req.body.username || '').trim().toLowerCase()], 5, 900, 'Too many password reset attempts. Wait 15 minutes and try again.');
const mfaLimiter = rateLimit((req) => ['mfa-ip:' + ipKey(req), 'mfa-user:' + String(req.session?.pendingMfaUserId || req.session?.adminMfaSetupUserId || '')], 5, 900, 'Too many verification attempts. Wait 15 minutes and try again.');
async function clearRateLimits(parts) { for (const part of parts) { const bucket = crypto.createHmac('sha256', sessionSecret).update(part).digest('hex'); const { error } = await db.rpc('clear_security_rate_limit', { p_bucket: bucket }); if (error) throw error; } }

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
async function sendVerificationEmail(user, token) {
  if (!mailer || !mailFrom) throw new Error('Email confirmation is not configured. Set SMTP_HOST and MAIL_FROM in .env.');
  const link = new URL('/api/email/verify/', publicAppUrl);
  link.searchParams.set('token', token);
  const safeName = String(user.username).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  await mailer.sendMail({
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
    if (!req.session.userId) return res.status(401).json({ error: 'Authentication required.' });
    req.user = await getUser(req.session.userId);
    if (!req.user?.is_active) { req.session.destroy(() => {}); return res.status(401).json({ error: 'This account is no longer active.' }); }
    if (req.user.role === 'admin' && !req.session.adminMfaVerified) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Admin verification is required. Sign in again.' }); }
    next();
  } catch (e) { next(e); }
}
const requireRole = (role) => (req, res, next) => req.user?.role === role ? next() : res.status(req.user ? 403 : 401).json({ error: `${role === 'user' ? 'Member' : 'Admin'} access required.` });
const endpoint = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'public, max-age=0, must-revalidate'); res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://images.unsplash.com; font-src 'self' data:; connect-src 'self'; frame-src 'self'" + (process.env.NODE_ENV === 'production' ? '; upgrade-insecure-requests' : ''));
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
const secureCookie = process.env.NODE_ENV === 'production';
app.use(session({ name: secureCookie ? '__Host-library.sid' : 'library.sid', secret: sessionSecret, store: new SupabaseSessionStore(), resave: false, saveUninitialized: false, rolling: true, cookie: { httpOnly: true, sameSite: 'lax', secure: secureCookie, path: '/', maxAge: 8 * 60 * 60 * 1000 } }));
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || !['POST','PUT','PATCH','DELETE'].includes(req.method) || req.path === '/api/newsletter/subscribe/') return next();
  const supplied = String(req.get('X-CSRFToken') || req.get('X-CSRF-Token') || ''); const expected = String(req.session?.csrfToken || '');
  if (!expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(403).json({ error: 'Your security token expired. Refresh the page and try again.' });
  next();
});
app.get('/api/session/', endpoint(async (req, res) => { req.session.csrfToken ||= newCsrfToken(); const user = req.session.userId ? await getUser(req.session.userId) : null; if (user && (!user.is_active || (user.role === 'admin' && !req.session.adminMfaVerified))) req.session.destroy(() => {}); res.json({ csrfToken: req.session.csrfToken, user: user?.is_active && (user.role !== 'admin' || req.session.adminMfaVerified) ? safeUser(user) : null }); }));
if (process.env.NODE_ENV !== 'production') app.get('/api/network-address/', (_req, res) => { const ips = Object.values(os.networkInterfaces()).flatMap((x) => x || []).filter((x) => x.family === 'IPv4' && !x.internal).map((x) => x.address); res.json({ address: ips[0] || null }); });
app.post('/api/newsletter/subscribe/', newsletterLimiter, endpoint(async (req, res) => { const email = String(req.body.email || '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' }); const { error } = await db.from('newsletter_subscriptions').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true }); fail(error); res.status(201).json({ message: 'You are subscribed to library updates.' }); }));
async function completeAdminLogin(req, res, user) {
  await regenerateSession(req); req.session.userId = user.id; req.session.adminMfaVerified = true; req.session.csrfToken = newCsrfToken();
  // Persist the rotated, fully verified session before telling the browser login succeeded.
  await saveSession(req);
  fail((await db.from('login_activities').insert({ user_id: user.id })).error); req.user = user; await writeAudit(req, 'login_success_mfa', 'user', user.id);
  res.json({ csrfToken: req.session.csrfToken, user: safeUser(user) });
}
app.post('/api/admin/mfa/setup/', mfaLimiter, endpoint(async (req, res) => {
  const user = req.session.pendingMfaUserId && await getUser(req.session.pendingMfaUserId);
  if (!user || user.role !== 'admin' || user.admin_mfa_enabled) return res.status(403).json({ error: 'Admin verification setup is not available for this session.' });
  let secret = user.admin_mfa_secret ? decryptMfaSecret(user.admin_mfa_secret) : encodeBase32(crypto.randomBytes(20));
  if (!user.admin_mfa_secret) fail((await db.from('users').update({ admin_mfa_secret: encryptMfaSecret(secret) }).eq('id', user.id)).error);
  const label = encodeURIComponent('Rustenburg Library:' + user.username); const issuer = encodeURIComponent('Rustenburg Library');
  res.json({ otpauthUrl: 'otpauth://totp/' + label + '?secret=' + secret + '&issuer=' + issuer + '&algorithm=SHA1&digits=6&period=30' });
}));
app.post('/api/admin/mfa/verify/', mfaLimiter, endpoint(async (req, res) => {
  const user = req.session.pendingMfaUserId && await getUser(req.session.pendingMfaUserId);
  if (!user || user.role !== 'admin' || !user.admin_mfa_enabled || !user.admin_mfa_secret) return res.status(403).json({ error: 'Admin verification is not available for this session.' });
  if (!verifyTotp(decryptMfaSecret(user.admin_mfa_secret), req.body.code)) { req.user = user; await writeAudit(req, 'admin_mfa_failed', 'user', user.id); return res.status(400).json({ error: 'That verification code is incorrect or expired.' }); }
  await completeAdminLogin(req, res, user);
}));
app.post('/api/admin/mfa/confirm-setup/', mfaLimiter, endpoint(async (req, res) => {
  const user = req.session.pendingMfaUserId && await getUser(req.session.pendingMfaUserId);
  if (!user || user.role !== 'admin' || user.admin_mfa_enabled || !user.admin_mfa_secret) return res.status(403).json({ error: 'Admin verification setup is not available for this session.' });
  if (!verifyTotp(decryptMfaSecret(user.admin_mfa_secret), req.body.code)) { req.user = user; await writeAudit(req, 'admin_mfa_setup_failed', 'user', user.id); return res.status(400).json({ error: 'That verification code is incorrect or expired.' }); }
  fail((await db.from('users').update({ admin_mfa_enabled: true }).eq('id', user.id)).error);
  user.admin_mfa_enabled = true; req.user = user; await writeAudit(req, 'admin_mfa_enabled', 'user', user.id);
  await completeAdminLogin(req, res, user);
}));
app.post('/api/login/', loginIpLimiter, loginCredentialLimiter, endpoint(async (req, res) => {
  const username = String(req.body.username || '').trim().slice(0, 100);
  const user = await one('users', db.from('users').select('*').eq('username', username).maybeSingle());
  const password = String(req.body.password || '');
  if (!user || Buffer.byteLength(password, 'utf8') > 72 || !passwordMatches(password, user.password_hash)) { await writeAudit(req, 'login_failed', 'user', username, { requested_role: req.body.role || 'user' }); return res.status(400).json({ error: 'Invalid username or password.' }); }
  if (!user.is_active) return res.status(403).json({ error: 'This member account has been deactivated. Contact a library administrator for help.' });
  if (user.role === 'user' && !user.email_verified) return res.status(403).json({ error: 'Confirm your email using the link we sent before signing in.' });
  if (user.role !== (req.body.role || 'user')) return res.status(403).json({ error: user.role === 'admin' ? 'You are not a library member.' : 'You are not an admin.' });
  if (user.password_hash.startsWith('pbkdf2_sha256$')) fail((await db.from('users').update({ password_hash: bcrypt.hashSync(password, 12) }).eq('id', user.id)).error);
  await clearRateLimits(['login-ip:' + ipKey(req), 'login-user:' + username.toLowerCase()]);
  if (user.role === 'admin') {
    await regenerateSession(req); req.session.pendingMfaUserId = user.id; req.session.csrfToken = newCsrfToken();
    await saveSession(req);
    req.user = user; await writeAudit(req, user.admin_mfa_enabled ? 'admin_password_verified_mfa_pending' : 'admin_mfa_enrollment_started', 'user', user.id);
    return res.json(user.admin_mfa_enabled ? { mfa_required: true, csrfToken: req.session.csrfToken } : { mfa_setup_required: true, csrfToken: req.session.csrfToken });
  }
  await regenerateSession(req); req.session.userId = user.id; req.session.csrfToken = newCsrfToken();
  await saveSession(req);
  fail((await db.from('login_activities').insert({ user_id: user.id })).error); req.user = user; await writeAudit(req, 'login_success', 'user', user.id);
  res.json({ csrfToken: req.session.csrfToken, user: safeUser(user) });
}));
app.post('/api/register/', registrationLimiter, endpoint(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!username || username.length > 64 || !email || email.length > 254 || !password) return res.status(400).json({ error: 'Enter a username up to 64 characters, a valid email address, and a password.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ error: 'Use a password between 8 and 72 UTF-8 bytes.' });
  if (!mailer || !mailFrom) return res.status(503).json({ error: 'Email confirmation is not configured. Please contact library staff.' });
  const { data: user, error } = await db.from('users').insert({ username, email, password_hash: bcrypt.hashSync(password, 12), role: 'user', email_verified: false }).select().single();
  if (error) return res.status(400).json({ error: error.code === '23505' ? 'That username is already in use.' : 'We could not create the account. Please try again.' });
  const token = crypto.randomBytes(32).toString('hex');
  const { error: tokenError } = await db.from('email_verification_tokens').insert({ user_id: user.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
  if (tokenError) { await db.from('users').delete().eq('id', user.id); throw tokenError; }
  try {
    await sendVerificationEmail(user, token);
  } catch (error) {
    await db.from('users').delete().eq('id', user.id);
    throw error;
  }
  await writeAudit({ ...req, user }, 'member_registration_pending_verification', 'user', user.id); res.status(201).json({ message: 'Account created. Check your email for a confirmation link before signing in.', verification_required: true });
}));
app.get('/api/email/verify/', endpoint(async (req, res) => {
  const token = String(req.query.token || '');
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).send('This confirmation link is invalid.');
  const row = await one('email_verification_tokens', db.from('email_verification_tokens').select('id,user_id').eq('token_hash', hashToken(token)).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle());
  if (!row) return res.status(400).send('This confirmation link is invalid or expired. Please register again or contact the library.');
  fail((await db.from('users').update({ email_verified: true }).eq('id', row.user_id)).error);
  fail((await db.from('email_verification_tokens').update({ used_at: new Date().toISOString() }).eq('id', row.id)).error); await writeAudit({ ...req, user: await getUser(row.user_id) }, 'email_verified', 'user', row.user_id);
  res.type('html').send('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email confirmed</title><body style="font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#24352e"><h1>Email confirmed</h1><p>Your library account is ready. Return to the library portal and sign in.</p><p><a href="' + publicAppUrl.replace(/[&<>"']/g, '') + '">Open the library portal</a></p></body></html>');
}));
app.post('/api/logout/', requireAuth, endpoint(async (req, res) => { await writeAudit(req, 'logout', 'user', req.user.id); req.session.destroy(() => res.json({ ok: true })); }));
app.post('/api/account/deactivate/', requireAuth, requireRole('user'), endpoint(async (req, res) => { await writeAudit(req, 'member_deactivated', 'user', req.user.id); fail((await db.from('users').update({ is_active: false }).eq('id', req.user.id)).error); req.session.destroy(() => res.json({ ok: true, message: 'Your account has been deactivated.' })); }));
app.put('/api/account/profile-photo/', requireAuth, endpoint(async (req, res) => { const photo = String(req.body.photo || ''); if (!/^data:image\/(png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(photo) || photo.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'Choose a PNG, JPEG, WEBP, or GIF image smaller than 1.5 MB.' }); fail((await db.from('users').update({ profile_photo: photo }).eq('id', req.user.id)).error); res.json({ user: safeUser(await getUser(req.user.id)) }); }));
app.delete('/api/account/profile-photo/', requireAuth, endpoint(async (req, res) => { fail((await db.from('users').update({ profile_photo: '' }).eq('id', req.user.id)).error); res.json({ user: safeUser(await getUser(req.user.id)) }); }));

app.post('/api/password-reset/request/', resetLimiter, endpoint(async (req, res) => { const username = String(req.body.username || '').trim(), email = String(req.body.email || '').trim().toLowerCase(); const u = await one('users', db.from('users').select('*').eq('username', username).maybeSingle()); const generic = { message: 'If the account details match, a reset code has been created.' }; if (!u?.email || u.email.toLowerCase() !== email) return res.json(generic); const code = crypto.randomBytes(4).toString('hex').toUpperCase(); await db.from('password_reset_tokens').update({ used_at: new Date().toISOString() }).eq('user_id', u.id).is('used_at', null); fail((await db.from('password_reset_tokens').insert({ user_id: u.id, token_hash: crypto.createHash('sha256').update(code).digest('hex'), expires_at: new Date(Date.now() + 900000).toISOString() })).error); const localOnly = ['127.0.0.1','::1'].includes(req.ip) || String(req.ip || '').startsWith('::ffff:127.'); if (mailer && mailFrom && u.email) await mailer.sendMail({ from: mailFrom, to: u.email, subject: 'Library password reset', text: `Your password reset code is ${code}. It expires in 15 minutes.` }); else if (process.env.NODE_ENV !== 'production' && localOnly) generic.reset_code = code; res.json(generic); }));
app.post('/api/password-reset/confirm/', resetLimiter, endpoint(async (req, res) => { const u = await one('users', db.from('users').select('*').eq('username', String(req.body.username || '').trim()).maybeSingle()); const hash = crypto.createHash('sha256').update(String(req.body.code || '').trim().toUpperCase()).digest('hex'); const token = u && await one('password_reset_tokens', db.from('password_reset_tokens').select('*').eq('user_id', u.id).eq('token_hash', hash).is('used_at', null).gt('expires_at', new Date().toISOString()).order('id', { ascending: false }).limit(1).maybeSingle()); if (!u || !token) return res.status(400).json({ error: 'Invalid or expired reset code.' }); if (String(req.body.password || '').length < 8 || Buffer.byteLength(String(req.body.password || ''), 'utf8') > 72) return res.status(400).json({ error: 'Use a password between 8 and 72 UTF-8 bytes.' }); fail((await db.from('users').update({ password_hash: bcrypt.hashSync(req.body.password, 12) }).eq('id', u.id)).error); await writeAudit({ ...req, user: u }, 'password_reset_completed', 'user', u.id); fail((await db.from('password_reset_tokens').update({ used_at: new Date().toISOString() }).eq('id', token.id)).error); res.json({ message: 'Password reset successfully. You can now sign in.' }); }));

app.get('/api/books/', requireAuth, endpoint(async (req, res) => { let q = db.from('books').select('*').order('title'); if (!(req.user.role === 'admin' && req.query.include_unreadable === '1')) q = q.not('virtual_file_path', 'is', null).neq('virtual_file_path', ''); if (req.query.q) q = q.or(['title','author','category','isbn'].map((k) => `${k}.ilike.%${String(req.query.q).replace(/[(),]/g, '')}%`).join(',')); res.json({ books: (await many('books', q)).map(safeBook) }); }));
app.post('/api/books/', requireAuth, requireRole('admin'), endpoint(async (req, res) => { const d = req.body; const { data, error } = await db.from('books').insert({ title: String(d.title || '').trim(), author: String(d.author || '').trim(), isbn: String(d.isbn || '').trim(), category: String(d.category || '').trim() }).select().single(); if (error) return res.status(400).json({ error: error.code === '23505' ? 'A book with that ISBN already exists.' : 'Unable to save the book.' }); await writeAudit(req, 'book_created', 'book', data.id); res.status(201).json({ book: safeBook(data) }); }));
app.put('/api/books/:id/', requireAuth, requireRole('admin'), endpoint(async (req, res) => { const current = await getBook(req.params.id); if (!current) return res.status(404).json({ error: 'Book not found.' }); const changes = { title: String(req.body.title || '').trim(), author: String(req.body.author || '').trim(), isbn: String(req.body.isbn || '').trim(), category: String(req.body.category || '').trim() }; const { error } = await db.from('books').update(changes).eq('id', req.params.id); if (error) return res.status(400).json({ error: error.code === '23505' ? 'A book with that ISBN already exists.' : 'Unable to save the book.' }); await writeAudit(req, 'book_updated', 'book', req.params.id); res.json({ book: safeBook(await getBook(req.params.id)) }); }));
app.delete('/api/books/:id/', requireAuth, requireRole('admin'), endpoint(async (req, res) => { await writeAudit(req, 'book_deleted', 'book', req.params.id); fail((await db.from('books').delete().eq('id', req.params.id)).error); res.json({ ok: true }); }));

app.put('/api/admin/books/:id/virtual-file/', requireAuth, requireRole('admin'), express.raw({ type: ['application/pdf','text/plain'], limit: '50mb' }), endpoint(async (req, res) => {
  const book = await getBook(req.params.id); if (!book) return res.status(404).json({ error: 'Book not found.' });
  const mime = String(req.headers['content-type'] || '').split(';')[0].toLowerCase(), name = path.basename(String(req.query.filename || 'virtual-book').replace(/[\\/]/g, '_')).slice(0,180), ext = path.extname(name).toLowerCase();
  if (!Buffer.isBuffer(req.body) || !req.body.length || !((mime === 'application/pdf' && ext === '.pdf') || (mime === 'text/plain' && ext === '.txt'))) return res.status(400).json({ error: 'Only PDF and plain text (.txt) virtual books are supported.' });
  if (mime === 'application/pdf' && req.body.subarray(0,5).toString('ascii') !== '%PDF-') return res.status(400).json({ error: 'The uploaded file is not a valid PDF.' });
  if (mime === 'text/plain' && req.body.includes(0)) return res.status(400).json({ error: 'The text book contains invalid binary data.' });
  const key = `${crypto.randomUUID()}${ext}`; const { error } = await db.storage.from(storageBucket).upload(key, req.body, { contentType: mime, upsert: false }); fail(error); await writeAudit(req, 'virtual_book_uploaded', 'book', book.id, { content_type: mime, file_size: req.body.length });
  fail((await db.from('books').update({ virtual_file_path: key, virtual_file_name: name, virtual_file_type: mime }).eq('id', book.id)).error);
  if (book.virtual_file_path) await db.storage.from(storageBucket).remove([book.virtual_file_path]);
  res.json({ book: safeBook(await getBook(book.id)) });
}));
app.delete('/api/admin/books/:id/virtual-file/', requireAuth, requireRole('admin'), endpoint(async (req, res) => { const book = await getBook(req.params.id); if (!book) return res.status(404).json({ error: 'Book not found.' }); if (book.virtual_file_path) await db.storage.from(storageBucket).remove([book.virtual_file_path]); await writeAudit(req, 'digital_book_removed', 'book', book.id); fail((await db.from('books').update({ virtual_file_path: '', virtual_file_name: '', virtual_file_type: '' }).eq('id', book.id)).error); res.json({ book: safeBook(await getBook(book.id)) }); }));
app.get('/api/books/:id/read/', requireAuth, requireRole('user'), endpoint(async (req, res) => { const book = await getBook(req.params.id); if (!book?.virtual_file_path) return res.status(404).json({ error: 'This book is not currently available to read online.' }); if (book.virtual_file_type !== 'text/plain') return res.status(415).json({ error: 'This book is not a plain text document.' }); const { data, error } = await db.storage.from(storageBucket).download(book.virtual_file_path); fail(error); res.json({ title: book.title, text: await data.text() }); }));
app.get('/api/books/:id/content/', requireAuth, requireRole('user'), endpoint(async (req, res) => { const book = await getBook(req.params.id); if (!book?.virtual_file_path) return res.status(404).json({ error: 'This book is not currently available to read online.' }); const { data, error } = await db.storage.from(storageBucket).download(book.virtual_file_path); fail(error); res.setHeader('Content-Type', book.virtual_file_type); res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(book.virtual_file_name.replace(/[\r\n"]/g,'_'))}`); res.setHeader('X-Content-Type-Options', 'nosniff'); res.send(Buffer.from(await data.arrayBuffer())); }));

app.get('/api/admin/summary/', requireAuth, requireRole('admin'), endpoint(async (_req, res) => {
  const [books, users, activities] = await Promise.all([
    many('books', db.from('books').select('*')),
    many('users', db.from('users').select('id,username,email,role,is_active,email_verified,profile_photo').order('username')),
    many('login_activities', db.from('login_activities').select('*').order('logged_in_at', { ascending: false })),
  ]);
  const login_activities = await Promise.all(activities.map(async (a) => ({ id: a.id, user: safeUser(await getUser(a.user_id)), logged_in_at: a.logged_in_at })));
  res.json({ stats: { total_books: books.length, readable_books: books.filter((b) => Boolean(b.virtual_file_path)).length, total_users: users.filter((x) => x.role === 'user').length }, books: books.map(safeBook), users: users.map(safeUser), login_activities });
}));
app.delete('/api/admin/users/:id/', requireAuth, requireRole('admin'), endpoint(async (req, res) => { const u = await getUser(req.params.id); if (!u) return res.status(404).json({ error: 'User not found.' }); if (u.role !== 'user') return res.status(403).json({ error: 'Admin accounts cannot be removed here.' }); await writeAudit(req, 'member_deleted', 'user', u.id); fail((await db.from('users').delete().eq('id', u.id)).error); res.json({ ok: true, username: u.username }); }));
app.get('/api/admin/reports/download/', requireAuth, requireRole('admin'), endpoint(async (_req, res) => { const users = await many('users', db.from('users').select('username,email,role,is_active,email_verified').order('username')); const esc = (v) => `"${String(v ?? '').replaceAll('"','""')}"`; const csv = [['Username','Email','Role','Active','Email verified'], ...users.map((u) => [u.username,u.email,u.role,u.is_active,u.email_verified])].map((r) => r.map(esc).join(',')).join('\n'); await writeAudit(_req, 'member_report_exported', 'users', null, { record_count: users.length }); res.type('text/csv').attachment('library-members-report.csv').send(csv); }));

const buildDir = path.join(__dirname, '..', 'static', 'react');
app.use('/static/react', express.static(buildDir));
app.use(express.static(buildDir));
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((req, res) => res.sendFile(path.join(buildDir, 'index.html')));
app.use((error, _req, res, _next) => {
  console.error('Unhandled API error:', error);
  const message = process.env.NODE_ENV === 'production' ? 'An unexpected server error occurred.' : (error.message || 'An unexpected server error occurred.');
  res.status(500).json({ error: message });
});
async function start() {
  const { error: bucketError } = await db.storage.createBucket(storageBucket, { public: false, fileSizeLimit: 52428800, allowedMimeTypes: ['application/pdf', 'text/plain'] });
  if (bucketError && !String(bucketError.message).toLowerCase().includes('already')) throw bucketError;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const existing = await one('users', db.from('users').select('id').eq('role','admin').limit(1).maybeSingle());
  if (!existing) {
    const initialPassword = String(process.env.ADMIN_PASSWORD || '');
    if (initialPassword.length < 12 || Buffer.byteLength(initialPassword, 'utf8') > 72) throw new Error('Set ADMIN_PASSWORD to a unique password between 12 and 72 UTF-8 bytes before first startup.');
    const { error } = await db.from('users').insert({ username, email: '', password_hash: bcrypt.hashSync(initialPassword, 12), role: 'admin', email_verified: true });
    fail(error); console.warn(`Created initial admin account "${username}". Protect the configured ADMIN_PASSWORD.`);
  }
  fail((await db.from('app_sessions').delete().lte('expires_at', new Date().toISOString())).error);
  const sessionCleanup = setInterval(() => db.from('app_sessions').delete().lte('expires_at', new Date().toISOString()).then(({ error }) => { if (error) console.error('Expired session cleanup failed:', error.message); }), 60 * 60 * 1000); sessionCleanup.unref();
  app.listen(port, () => {
    console.log(`Library API listening on http://127.0.0.1:${port} (Supabase)`);
  });
}
start().catch((error) => { console.error('Supabase startup failed:', error.message); process.exit(1); });
