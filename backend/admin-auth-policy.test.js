const test = require('node:test');
const assert = require('node:assert/strict');
const { canAccessAdminApi } = require('./admin-auth-policy');
const { normalizeEmail, isValidEmail } = require('./email-validation');

test('normalizes email consistently and accepts valid addresses', () => {
  assert.equal(normalizeEmail('  Admin.Example+ops@Library.org  '), 'admin.example+ops@library.org');
  assert.equal(isValidEmail(' Admin.Example+ops@Library.org '), true);
});

test('rejects missing, malformed, and invalid email formats', () => {
  for (const email of ['', null, 'missing-at.example.org', 'a@@example.org', 'a@localhost', 'a..b@example.org', '.a@example.org', 'a.@example.org', 'a@-example.org', 'a@example-.org', `${'x'.repeat(245)}@example.org`]) {
    assert.equal(isValidEmail(email), false, `expected invalid email: ${email}`);
  }
});

test('administrator API requires an active admin, a confirmed email, and AAL2', () => {
  const profile = { role: 'admin', is_active: true };
  assert.equal(canAccessAdminApi({ profile, emailConfirmedAt: '2026-10-11T00:00:00Z', assuranceLevel: 'aal2' }), true);
  assert.equal(canAccessAdminApi({ profile, emailConfirmedAt: null, assuranceLevel: 'aal2' }), false);
  assert.equal(canAccessAdminApi({ profile, emailConfirmedAt: 'confirmed', assuranceLevel: 'aal1' }), false);
  assert.equal(canAccessAdminApi({ profile: { role: 'admin', is_active: false }, emailConfirmedAt: 'confirmed', assuranceLevel: 'aal2' }), false);
  assert.equal(canAccessAdminApi({ profile: { role: 'user', is_active: true }, emailConfirmedAt: 'confirmed', assuranceLevel: 'aal2' }), false);
  assert.equal(canAccessAdminApi({ profile: null, emailConfirmedAt: 'confirmed', assuranceLevel: 'aal2' }), false);
});
