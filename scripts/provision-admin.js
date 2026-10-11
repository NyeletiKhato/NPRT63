require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { normalizeEmail, isValidEmail } = require('../backend/email-validation');

function required(name) { if (!process.env[name]) throw new Error(`Set ${name} in the server environment first.`); return process.env[name]; }
const escapeLike = (value) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
async function audit(client, event, email, details = {}) {
  const { error } = await client.from('security_audit_logs').insert({ actor_user_id: null, event, target_type: 'email', target_id: email, details: { ...details, provisioned_by: 'server_operator' } });
  if (error) console.error(`Audit write failed for ${event} (database code ${error.code || 'unknown'}).`);
}

async function main() {
  const rl = readline.createInterface({ input, output });
  try {
    const email = normalizeEmail(await rl.question('New administrator email: '));
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    const suggestion = email.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 64) || 'administrator';
    const username = (await rl.question(`Administrator username [${suggestion}]: `)).trim() || suggestion;
    if (!/^[\p{L}\p{N}_.-]{1,64}$/u.test(username)) throw new Error('Use a 1–64 character username with letters, numbers, dots, underscores, or hyphens.');
    const confirmation = await rl.question(`Type PROVISION ${email} to invite this administrator: `);
    if (confirmation !== `PROVISION ${email}`) throw new Error('Provisioning cancelled.');

    const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: conflicts, error: conflictError } = await client.from('users').select('id,username,role,auth_user_id').ilike('email', escapeLike(email)).limit(2);
    if (conflictError) throw conflictError;
    if (conflicts?.length) throw new Error('An application account already uses this email. Resolve the account conflict before provisioning.');
    const { data: usernameConflicts, error: usernameError } = await client.from('users').select('id').ilike('username', escapeLike(username)).limit(2);
    if (usernameError) throw usernameError;
    if (usernameConflicts?.length) throw new Error('That username is already in use. Choose a different one.');

    const appUrl = required('PUBLIC_APP_URL');
    const redirect = new URL(appUrl);
    redirect.searchParams.set('admin_setup', '1');
    let matchingAuthUser = null;
    for (let page = 1; page <= 100; page += 1) {
      const { data: pageData, error: listError } = await client.auth.admin.listUsers({ page, perPage: 1000 });
      if (listError) throw new Error(`Could not check existing Supabase Auth identities (${listError.code || listError.name || 'unknown error'}).`);
      matchingAuthUser = (pageData?.users || []).find((user) => normalizeEmail(user.email) === email) || null;
      if (matchingAuthUser || (pageData?.users || []).length < 1000) break;
    }
    let authUserId, action;
    if (matchingAuthUser?.email_confirmed_at) {
      const { error: recoveryError } = await client.auth.resetPasswordForEmail(email, { redirectTo: redirect.toString() });
      if (recoveryError) { await audit(client, 'admin_identity_recovery_failed', email, { error_code: recoveryError.code || recoveryError.name || 'unknown' }); throw new Error(`Supabase could not send the account setup email (${recoveryError.code || recoveryError.name || 'unknown error'}). No administrator profile was created.`); }
      authUserId = matchingAuthUser.id;
      action = 'admin_identity_recovery_sent';
    } else {
      const { data: invited, error: inviteError } = await client.auth.admin.inviteUserByEmail(email, { redirectTo: redirect.toString(), data: {} });
      if (inviteError) { await audit(client, 'admin_invitation_failed', email, { error_code: inviteError.code || inviteError.name || 'unknown' }); throw new Error(`Supabase could not send the invitation (${inviteError.code || inviteError.name || 'unknown error'}). Check Auth email/SMTP settings and whether this address already has an unconfirmed invitation.`); }
      if (!invited?.user?.id) throw new Error('Supabase did not return an Auth identity; no administrator profile was created.');
      authUserId = invited.user.id;
      action = 'admin_invitation_sent';
    }

    const randomPasswordHash = crypto.createHash('sha256').update(crypto.randomBytes(48)).digest('hex');
    const { data: profile, error: profileError } = await client.from('users').insert({
      username, email, password_hash: `disabled$${randomPasswordHash}`, role: 'admin', is_active: true,
      email_verified: false, auth_user_id: authUserId, admin_mfa_secret: null, admin_mfa_enabled: false,
    }).select('id').single();
    if (profileError) {
      await audit(client, 'admin_profile_link_failed', email, { auth_user_id: authUserId, database_error_code: profileError.code || 'unknown' });
      console.error(`Supabase sent the invitation, but the profile link failed (database code ${profileError.code || 'unknown'}). The Auth identity was retained without admin access; resolve the profile conflict and re-invite/reconcile it. No Auth user was deleted.`);
      throw new Error('Administrator profile creation failed after invitation.');
    }
    const audit = await client.from('security_audit_logs').insert({ actor_user_id: null, event: action, target_type: 'user', target_id: String(profile.id), details: { email, username, auth_user_id: authUserId, provisioned_by: 'server_operator' } });
    if (audit.error) console.error(`Audit recording failed (database code ${audit.error.code || 'unknown'}); account was provisioned and the audit issue needs operator follow-up.`);
    console.log(`Invitation sent to ${email}. The role is linked to the invited Supabase Auth identity. The administrator must confirm the address, set a password, and enroll in MFA before protected access is allowed.`);
    console.log(`Application profile id: ${profile.id}. Auth identity retained; no credentials or tokens were generated for the administrator.`);
  } finally { rl.close(); }
}

main().catch((error) => { console.error(error.message || 'Administrator provisioning failed.'); process.exitCode = 1; });
