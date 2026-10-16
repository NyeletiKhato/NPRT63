'use strict';

// Opt-in only: this suite intentionally mutates disposable Supabase staging fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

const baseUrl = String(process.env.SECURITY_STAGING_URL || '').replace(/\/$/, '');
const enabled = Boolean(baseUrl);
const setting = (name) => {
  const value = process.env[name];
  assert.ok(value, `Set ${name} for the opt-in staging security suite.`);
  return value;
};

function createClient() {
  let cookie = '';
  let csrfToken = '';
  return {
    async request(path, { method = 'GET', body, token, headers = {} } = {}) {
      const requestHeaders = { ...headers };
      if (cookie) requestHeaders.Cookie = cookie;
      if (token) requestHeaders.Authorization = `Bearer ${token}`;
      if (body !== undefined && !requestHeaders['Content-Type']) requestHeaders['Content-Type'] = 'application/json';
      if (!token && csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) requestHeaders['X-CSRFToken'] = csrfToken;
      const response = await fetch(`${baseUrl}${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
      const setCookies = response.headers.getSetCookie?.() || (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
      if (setCookies.length) cookie = setCookies.map((value) => value.split(';', 1)[0]).join('; ');
      const raw = await response.text();
      let data;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
      return { status: response.status, data, headers: response.headers };
    },
    async initializeSession() {
      const session = await this.request('/api/session/');
      assert.equal(session.status, 200);
      csrfToken = session.data.csrfToken;
    },
    async login(username, password) {
      if (!csrfToken) await this.initializeSession();
      const result = await this.request('/api/login/', { method: 'POST', body: { username, password } });
      assert.equal(result.status, 200, `Staging member sign-in failed with HTTP ${result.status}.`);
      csrfToken = result.data.csrfToken;
      return result.data.user;
    },
  };
}

async function jsonRequest(url, { method = 'GET', body, token, apiKey, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(apiKey ? { apikey: apiKey } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined || Buffer.isBuffer(body) ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { status: response.status, data };
}

test('staging security acceptance: access, ownership, admin MFA/audit, files, recovery, and rate limits', { skip: !enabled }, async () => {
  assert.equal(process.env.SECURITY_STAGING_ALLOW_MUTATIONS, 'yes', 'Set SECURITY_STAGING_ALLOW_MUTATIONS=yes only after confirming this is a disposable staging project.');
  const memberA = createClient();
  const memberB = createClient();
  const publicClient = createClient();
  const adminToken = setting('SECURITY_STAGING_ADMIN_AAL2_TOKEN');
  const readBookId = setting('SECURITY_STAGING_READABLE_BOOK_ID');
  const uploadBookId = setting('SECURITY_STAGING_DISPOSABLE_UPLOAD_BOOK_ID');
  const memberAUsername = setting('SECURITY_STAGING_MEMBER_A_USERNAME');
  const memberAPassword = setting('SECURITY_STAGING_MEMBER_A_PASSWORD');
  const memberBUsername = setting('SECURITY_STAGING_MEMBER_B_USERNAME');
  const memberBPassword = setting('SECURITY_STAGING_MEMBER_B_PASSWORD');
  const apiAnonKey = setting('SECURITY_STAGING_SUPABASE_ANON_KEY');
  const supabaseUrl = setting('SECURITY_STAGING_SUPABASE_URL').replace(/\/$/, '');
  await publicClient.initializeSession();

  // Protected member and admin routes must reject requests without a session.
  const anonymous = createClient();
  assert.equal((await anonymous.request('/api/reader/history/')).status, 401);
  assert.equal((await anonymous.request('/api/admin/users/')).status, 401);

  // Member-owned data stays private even when another member guesses its IDs.
  const accountA = await memberA.login(memberAUsername, memberAPassword);
  const accountB = await memberB.login(memberBUsername, memberBPassword);
  const progressA = await memberA.request(`/api/reader/books/${readBookId}/progress/`, { method: 'PUT', body: { location: { page: 17 } } });
  assert.equal(progressA.status, 200);
  const bookmarkA = await memberA.request(`/api/reader/books/${readBookId}/bookmarks/`, { method: 'POST', body: { name: 'staging ownership check', location: { page: 17 } } });
  assert.equal(bookmarkA.status, 201);
  const highlightA = await memberA.request(`/api/reader/books/${readBookId}/highlights/`, { method: 'POST', body: { page: 17, start_offset: 0, end_offset: 8, quote: 'test text', color: 'yellow' } });
  assert.equal(highlightA.status, 201);
  assert.equal((await memberA.request(`/api/books/${readBookId}/open/`, { method: 'POST', body: {} })).status, 201);
  assert.equal((await memberB.request(`/api/reader/bookmarks/${bookmarkA.data.bookmark.id}/`, { method: 'PUT', body: { name: 'forged edit' } })).status, 404);
  assert.equal((await memberB.request(`/api/reader/bookmarks/${bookmarkA.data.bookmark.id}/`, { method: 'DELETE' })).status, 404);
  assert.equal((await memberB.request(`/api/reader/highlights/${highlightA.data.highlight.id}/`, { method: 'DELETE' })).status, 404);
  const forgedProgress = await memberB.request(`/api/reader/books/${readBookId}/progress/`, { method: 'PUT', body: { user_id: accountA.id, location: { page: 99 } } });
  assert.equal(forgedProgress.status, 200);
  const stateB = await memberB.request(`/api/reader/books/${readBookId}/state/`);
  assert.notEqual(stateB.data.progress?.location?.page, 17);
  assert.equal(stateB.data.bookmarks.some((row) => row.id === bookmarkA.data.bookmark.id), false);
  assert.equal((await memberB.request(`/api/reader/books/${readBookId}/highlights/`)).data.highlights.some((row) => row.id === highlightA.data.highlight.id), false);
  await memberB.request('/api/reader/history/', { method: 'DELETE' });
  assert.equal((await memberB.request('/api/reader/history/')).data.history.some((row) => String(row.book_id) === String(readBookId)), false);
  assert.equal((await memberA.request('/api/reader/history/')).data.history.some((row) => String(row.book_id) === String(readBookId)), true);
  assert.equal((await memberA.request(`/api/reader/books/${readBookId}/state/`)).data.progress.location.page, 17);
  const content = await memberA.request(`/api/books/${readBookId}/content/`);
  assert.equal(content.status, 200);

  // Supabase Auth confirms admin email, active role, and AAL2 for every admin API call.
  assert.equal((await jsonRequest(`${baseUrl}/api/admin/users/`, { token: adminToken })).status, 200);
  const deniedTokens = [
    ['SECURITY_STAGING_UNCONFIRMED_ADMIN_TOKEN', 401],
    ['SECURITY_STAGING_INACTIVE_ADMIN_TOKEN', 403],
    ['SECURITY_STAGING_NON_ADMIN_TOKEN', 403],
    ['SECURITY_STAGING_ADMIN_AAL1_TOKEN', 403],
  ];
  for (const [name, status] of deniedTokens) assert.equal((await jsonRequest(`${baseUrl}/api/admin/users/`, { token: setting(name) })).status, status, `${name} must be denied.`);

  // Admin member changes are audited. Restore the disposable member in a finally block.
  try {
    assert.equal((await jsonRequest(`${baseUrl}/api/admin/users/${accountB.id}/`, { method: 'PATCH', token: adminToken, body: { is_active: false } })).status, 200);
  } finally {
    assert.equal((await jsonRequest(`${baseUrl}/api/admin/users/${accountB.id}/`, { method: 'PATCH', token: adminToken, body: { is_active: true } })).status, 200);
  }
  const audit = await jsonRequest(`${baseUrl}/api/admin/audit/?q=reader_deactivated`, { token: adminToken });
  assert.equal(audit.status, 200);
  assert.ok(audit.data.records.some((row) => row.event === 'reader_deactivated' && String(row.target_id) === String(accountB.id)));

  // Valid and invalid file cases run against a dedicated disposable book.
  let uploadedDigitalFile = false;
  try {
    const upload = (body, type, filename) => jsonRequest(`${baseUrl}/api/admin/books/${uploadBookId}/virtual-file/?filename=${encodeURIComponent(filename)}`, { method: 'PUT', token: adminToken, body, headers: { 'Content-Type': type } });
    const txt = await upload(Buffer.from('Staging upload validation test text.\n'), 'text/plain', 'staging.txt');
    assert.equal(txt.status, 200);
    uploadedDigitalFile = true;
    const pdf = Buffer.from('%PDF-1.7\nStaging fixture\n%%EOF\n');
    assert.equal((await upload(pdf, 'application/pdf', 'staging.pdf')).status, 200);
    assert.equal((await upload(Buffer.from('not a pdf'), 'application/pdf', 'bad.pdf')).status, 400);
    assert.equal((await upload(Buffer.from('unsupported'), 'application/epub+zip', 'bad.epub')).status, 400);
    assert.equal((await upload(Buffer.alloc(50 * 1024 * 1024 + 1), 'application/pdf', 'large.pdf')).status, 413);
    const cover = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    assert.equal((await jsonRequest(`${baseUrl}/api/admin/books/${uploadBookId}/cover/`, { method: 'PUT', token: adminToken, body: cover, headers: { 'Content-Type': 'image/png' } })).status, 200);
  } finally {
    if (uploadedDigitalFile) await jsonRequest(`${baseUrl}/api/admin/books/${uploadBookId}/virtual-file/`, { method: 'DELETE', token: adminToken });
  }

  // The anonymous Supabase key must not bypass private Storage policies.
  const privateObject = setting('SECURITY_STAGING_PRIVATE_STORAGE_OBJECT');
  const bucket = process.env.SECURITY_STAGING_BOOKS_BUCKET || 'private-books';
  const directStorage = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${privateObject.split('/').map(encodeURIComponent).join('/')}`, { headers: { apikey: apiAnonKey } });
  assert.ok(directStorage.status >= 400, `Anonymous Storage access unexpectedly returned HTTP ${directStorage.status}.`);

  // Token lifecycle uses disposable recovery fixtures. Provide the fresh token from the controlled inbox.
  const recoveryUsername = setting('SECURITY_STAGING_RECOVERY_USERNAME');
  const newPassword = setting('SECURITY_STAGING_RECOVERY_NEW_PASSWORD');
  const freshToken = setting('SECURITY_STAGING_FRESH_RESET_TOKEN');
  const expiredToken = setting('SECURITY_STAGING_EXPIRED_RESET_TOKEN');
  const confirm = (token, password) => publicClient.request('/api/password-reset/confirm/', { method: 'POST', body: { username: recoveryUsername, token, password, password_confirm: password } });
  assert.equal((await confirm(expiredToken, newPassword)).status, 400);
  assert.equal((await confirm(freshToken, newPassword)).status, 200);
  assert.equal((await confirm(freshToken, newPassword)).status, 400);

  // Recovery responses do not reveal account existence.
  const existingReset = await publicClient.request('/api/password-reset/request/', { method: 'POST', body: { username: recoveryUsername } });
  const absentReset = await publicClient.request('/api/password-reset/request/', { method: 'POST', body: { username: `missing-${crypto.randomUUID()}` } });
  assert.equal(existingReset.status, 200);
  assert.equal(absentReset.status, 200);
  assert.deepEqual(existingReset.data, absentReset.data);
  const knownAdminRecovery = await publicClient.request('/api/admin/password-recovery/', { method: 'POST', body: { email: setting('SECURITY_STAGING_ADMIN_EMAIL') } });
  const absentAdminRecovery = await publicClient.request('/api/admin/password-recovery/', { method: 'POST', body: { email: `missing-${crypto.randomUUID()}@example.test` } });
  assert.equal(knownAdminRecovery.status, 200);
  assert.equal(absentAdminRecovery.status, 200);
  assert.deepEqual(knownAdminRecovery.data, absentAdminRecovery.data);
  // A distinct disposable admin account isolates link lifecycle from the generic-response check above.
  const adminRecoveryAuth = createSupabaseClient(supabaseUrl, apiAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const expiredAdminOtp = await adminRecoveryAuth.auth.verifyOtp({ token_hash: setting('SECURITY_STAGING_ADMIN_EXPIRED_RECOVERY_TOKEN_HASH'), type: 'recovery' });
  assert.ok(expiredAdminOtp.error, 'An expired administrator recovery link must not exchange for a session.');
  const freshAdminTokenHash = setting('SECURITY_STAGING_ADMIN_FRESH_RECOVERY_TOKEN_HASH');
  const freshAdminOtp = await adminRecoveryAuth.auth.verifyOtp({ token_hash: freshAdminTokenHash, type: 'recovery' });
  assert.ok(!freshAdminOtp.error && freshAdminOtp.data.session, 'The current administrator recovery link should exchange once.');
  assert.equal((await adminRecoveryAuth.auth.updateUser({ password: setting('SECURITY_STAGING_ADMIN_RECOVERY_NEW_PASSWORD') })).error, null);
  assert.ok((await adminRecoveryAuth.auth.verifyOtp({ token_hash: freshAdminTokenHash, type: 'recovery' })).error, 'A used administrator recovery link must not exchange a second time.');
  // Exhaust each limiter in this dedicated staging environment. Keep this last because buckets persist for 15 minutes.
  for (let i = 0; i < 9; i++) {
    var loginRate = await publicClient.request('/api/login/', { method: 'POST', body: { username: 'staging-rate-limit-nonexistent', password: 'wrong-password' } });
  }
  assert.equal(loginRate.status, 429);
  let resetRate;
  for (let i = 0; i < 6; i++) resetRate = await publicClient.request('/api/password-reset/request/', { method: 'POST', body: { username: `missing-${crypto.randomUUID()}` } });
  assert.equal(resetRate.status, 429);
  let adminRecoveryRate;
  for (let i = 0; i < 6; i++) adminRecoveryRate = await publicClient.request('/api/admin/password-recovery/', { method: 'POST', body: { email: `rate-${crypto.randomUUID()}@example.test` } });
  assert.equal(adminRecoveryRate.status, 429);
  let searchRate;
  for (let i = 0; i < 121; i++) searchRate = await memberA.request('/api/books/?q=staging-security-rate-limit');
  assert.equal(searchRate.status, 429);
  let uploadRate;
  for (let i = 0; i < 21; i++) uploadRate = await jsonRequest(`${baseUrl}/api/admin/books/${uploadBookId}/virtual-file/?filename=invalid.epub`, { method: 'PUT', token: adminToken, body: Buffer.from('x'), headers: { 'Content-Type': 'application/epub+zip' } });
  assert.equal(uploadRate.status, 429);
});
