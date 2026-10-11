require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { createClient } = require('@supabase/supabase-js');
const { normalizeEmail, isValidEmail } = require('../backend/email-validation');

function required(name) { if (!process.env[name]) throw new Error(`Set ${name} in the server environment first.`); return process.env[name]; }
const escapeLike = (value) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
async function main() {
  const rl = readline.createInterface({ input, output });
  try {
    const email = normalizeEmail(await rl.question('Administrator email to re-invite: '));
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await client.from('users').select('id,username,email,role,is_active,auth_user_id').ilike('email', escapeLike(email)).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.role !== 'admin' || !profile.is_active || !profile.auth_user_id) throw new Error('No active, Supabase-linked administrator profile matches that email. Provision it through the authorized server process first.');
    const { data: authRecord, error: authError } = await client.auth.admin.getUserById(profile.auth_user_id);
    if (authError || !authRecord?.user) throw new Error('The linked Supabase Auth identity could not be verified.');
    if (authRecord.user.email_confirmed_at || authRecord.user.confirmed_at) throw new Error('This administrator email is already confirmed. They can sign in and use password recovery if needed.');
    const confirmation = await rl.question(`Type RESEND ${email} to generate and email a fresh invitation: `);
    if (confirmation !== `RESEND ${email}`) throw new Error('Resend cancelled.');
    const redirect = new URL(required('PUBLIC_APP_URL')); redirect.searchParams.set('admin_setup', '1');
    const { error: inviteError } = await client.auth.admin.inviteUserByEmail(email, { redirectTo: redirect.toString(), data: {} });
    if (inviteError) {
      const auditFailure = await client.from('security_audit_logs').insert({ actor_user_id: null, event: 'admin_invitation_resend_failed', target_type: 'user', target_id: String(profile.id), details: { email, auth_user_id: profile.auth_user_id, error_code: inviteError.code || inviteError.name || 'unknown', provisioned_by: 'server_operator' } });
      if (auditFailure.error) console.error(`Audit write failed (database code ${auditFailure.error.code || 'unknown'}).`);
      throw new Error(`Supabase could not resend the invitation (${inviteError.code || inviteError.name || 'unknown error'}). No link or token was logged. If the Auth dashboard identifies this identity as an existing invite, use Authentication > Users > the pending user > Resend invitation.`);
    }
    const audit = await client.from('security_audit_logs').insert({ actor_user_id: null, event: 'admin_invitation_resent', target_type: 'user', target_id: String(profile.id), details: { email, username: profile.username, auth_user_id: profile.auth_user_id, provisioned_by: 'server_operator' } });
    if (audit.error) console.error(`Invitation delivered, but audit recording failed (database code ${audit.error.code || 'unknown'}).`);
    console.log(`A fresh Supabase invitation was emailed to ${email}. Supabase token expiry follows the project's Auth email OTP settings.`);
  } finally { rl.close(); }
}
main().catch((error) => { console.error(error.message || 'Invitation resend failed.'); process.exitCode = 1; });
