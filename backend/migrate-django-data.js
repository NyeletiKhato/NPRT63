// Imports the legacy Django SQLite records into the Supabase tables.
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const initSqlJs = require('sql.js');
const { createClient } = require('@supabase/supabase-js');

const sourcePath = path.join(__dirname, '..', 'db.sqlite3');
if (!fs.existsSync(sourcePath)) throw new Error(`Django database not found: ${sourcePath}`);
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const chunks = (items, size = 250) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
let source;
function read(table) {
  const statement = source.prepare(`SELECT * FROM ${table}`);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
}
async function upsert(table, rows, onConflict) {
  for (const group of chunks(rows)) {
    const { error } = await supabase.from(table).upsert(group, { onConflict, ignoreDuplicates: false });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}
async function run() {
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  source = new SQL.Database(new Uint8Array(fs.readFileSync(sourcePath)));
  const oldUsers = read('core_customuser');
  const oldActivities = read('core_loginactivity');

  // This is a one-time data import. Refuse a repeat run so it cannot restore
  // members that were deliberately removed or duplicate loans and audit rows.
  const importedUsers = await supabase.from('users').select('username').in('username', oldUsers.map((u) => u.username).slice(0, 200));
  if (importedUsers.error) throw importedUsers.error;
  if (importedUsers.data?.length) throw new Error('Legacy users are already present in Supabase. Refusing to rerun the import and duplicate or restore records.');

  await upsert('users', oldUsers.map((u) => ({ username: u.username, email: (u.email || '').toLowerCase(), password_hash: u.password, role: u.role, is_active: u.is_active ?? true, email_verified: true, created_at: u.date_joined || new Date().toISOString() })), 'username');
  const users = await supabase.from('users').select('id,username');
  if (users.error) throw users.error;
  const userIds = new Map(users.data.map((u) => [u.username, u.id]));
  const oldUserNames = new Map(oldUsers.map((u) => [u.id, u.username]));
  const loginRows = oldActivities.map((a) => ({ user_id: userIds.get(oldUserNames.get(a.user_id)), logged_in_at: a.logged_in_at })).filter((a) => a.user_id);
  for (const group of chunks(loginRows)) { const { error } = await supabase.from('login_activities').insert(group); if (error) throw error; }
  console.log(`Imported ${oldUsers.length} member accounts and ${loginRows.length} login events. Add digital books and upload their files from the admin catalogue.`);
}
run().catch((error) => { console.error('Supabase data import failed:', error.message); process.exitCode = 1; }).finally(() => source?.close());
