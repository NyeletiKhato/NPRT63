function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function isValidEmail(value) {
  const email = normalizeEmail(value);
  if (email.length > 254 || email.startsWith('.') || email.endsWith('.') || email.includes('..')) return false;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at !== email.indexOf('@') || at > 64) return false;
  const local = email.slice(0, at), domain = email.slice(at + 1);
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..') || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  return domain.split('.').every((label) => label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) && domain.includes('.');
}
module.exports = { normalizeEmail, isValidEmail };
