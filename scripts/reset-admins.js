require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: admins, error } = await client.from('users').select('id,username,email,is_active,email_verified,admin_mfa_enabled,admin_mfa_secret,auth_user_id').eq('role', 'admin').order('id');
  if (error) throw error;
  if (!admins.length) { console.log('No application administrator accounts are assigned the admin role.'); return; }

  const userIds = admins.map((user) => user.id);
  const adminIdSet = new Set(userIds.map(String));
  let authUsers = null;
  async function matchingAuthUser(email) {
    if (!email) return null;
    if (!authUsers) {
      authUsers = [];
      for (let page = 1; page <= 100; page += 1) {
        const { data, error: authListError } = await client.auth.admin.listUsers({ page, perPage: 1000 });
        if (authListError) throw new Error(`Could not inspect Supabase Auth users before reset: ${authListError.message}`);
        authUsers.push(...(data?.users || []));
        if ((data?.users || []).length < 1000) break;
      }
    }
    return authUsers.filter((user) => String(user.email || '').trim().toLowerCase() === String(email).trim().toLowerCase());
  }
  let sessionsToRevoke = 0;
  for (let offset = 0; ; offset += 1000) {
    const { data: sessions, error: sessionError } = await client.from('app_sessions').select('session_data').range(offset, offset + 999);
    if (sessionError) throw sessionError;
    sessionsToRevoke += (sessions || []).filter(({ session_data: session = {} }) => adminIdSet.has(String(session.userId)) || adminIdSet.has(String(session.pendingMfaUserId))).length;
    if (!sessions || sessions.length < 1000) break;
  }
  const tables = [
    ['login_activities', 'user_id'], ['password_reset_tokens', 'user_id'], ['email_verification_tokens', 'user_id'],
    ['admin_setup_tokens', 'user_id'], ['reader_favourites', 'user_id'], ['reader_progress', 'user_id'],
    ['reader_bookmarks', 'user_id'], ['reader_history', 'user_id'], ['book_open_events', 'user_id'],
    ['library_settings', 'updated_by'],
  ];
  const counts = {};
  for (const [table, column] of tables) {
    const result = await client.from(table).select('*', { count: 'exact', head: true }).in(column, userIds);
    if (result.error) throw result.error;
    counts[table] = result.count || 0;
  }
  const { count: auditCount, error: auditError } = await client.from('security_audit_logs').select('id', { count: 'exact', head: true }).in('actor_user_id', userIds);
  if (auditError) throw auditError;

  console.log('PRODUCTION RESET PREVIEW (no changes made)');
  console.log('Application accounts identified from public.users.role = admin:');
  for (const user of admins) {
    let authMatches;
    if (user.auth_user_id) {
      const { data: authData, error: authError } = await client.auth.admin.getUserById(user.auth_user_id);
      if (authError) throw new Error(`Could not inspect the Supabase Auth account linked to admin profile ${user.id}: ${authError.message}`);
      authMatches = authData?.user ? [authData.user] : [];
    } else authMatches = await matchingAuthUser(user.email);
    const authSummary = authMatches.length ? authMatches.map((authUser) => `Supabase Auth id=${authUser.id}; email=${authUser.email || 'none'}; email confirmed=${Boolean(authUser.email_confirmed_at)}`).join(' | ') : user.auth_user_id ? `linked Supabase Auth id=${user.auth_user_id}; record not found` : 'no matching Supabase Auth email found';
    console.log(`- id ${user.id}: ${user.username} <${user.email || 'no email'}>; active=${user.is_active}; legacy email flag=${user.email_verified}; custom MFA data=${Boolean(user.admin_mfa_secret)}; ${authSummary}`);
  }
  console.log(`Stored sessions that will be revoked: ${sessionsToRevoke}`);
  console.log('Records by admin account that the reset will retain:');
  for (const [table, count] of Object.entries(counts)) console.log(`- ${table}: ${count}`);
  console.log(`Audit rows attributed to these admins (retained): ${auditCount || 0}`);
  console.log('Changes if approved: app admin roles are demoted to inactive members; usernames/emails are cleared; unusable password hashes are set; Auth user links and legacy MFA secrets are cleared; custom sessions and unused setup/reset/verification tokens are revoked; one system audit record is added. Supabase Auth users are inspected but retained (never deleted). User rows/IDs, login history, used token history, reader records, books, categories, authors, files, and existing audit history are retained.');

  if (!process.argv.includes('--apply')) {
    console.log('Preview only. Re-run with --apply to request the separately confirmed reset.');
    return;
  }
  const rl = readline.createInterface({ input, output });
  try {
    const phrase = await rl.question(`To revoke these ${admins.length} admin accounts, type RESET ${admins.map((user) => user.id).join(',')}: `);
    if (phrase !== `RESET ${admins.map((user) => user.id).join(',')}`) { console.log('Reset cancelled; no changes made.'); return; }
  } finally { rl.close(); }
  const { data: reset, error: resetError } = await client.rpc('reset_library_admins', { p_expected_user_ids: userIds, p_confirmation: 'RESET_LIBRARY_ADMINS' });
  if (resetError) throw resetError;
  console.log(`Reset completed for ${reset.length} administrator account(s). The admin role can now be re-provisioned by an authorized server operator.`);
}

main().catch((error) => {
  console.error('Reset preview or operation failed:', error.message || 'unknown error');
  process.exitCode = 1;
});
