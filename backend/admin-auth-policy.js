function canAccessAdminApi({ profile, emailConfirmedAt, assuranceLevel } = {}) {
  return profile?.role === 'admin' && profile.is_active === true && Boolean(emailConfirmedAt) && assuranceLevel === 'aal2';
}
module.exports = { canAccessAdminApi };
