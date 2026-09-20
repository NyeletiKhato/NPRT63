const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const app = express();
const port = Number(process.env.PORT || 3000);
const db = new Database(process.env.LIBRARY_DB_PATH || path.join(__dirname, 'library.db'));
const FINE_PER_DAY = 20;

db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')) DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    isbn TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity >= 0),
    available_copies INTEGER NOT NULL DEFAULT 1 CHECK(available_copies >= 0)
  );
  CREATE TABLE IF NOT EXISTS borrow_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    borrow_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    return_date TEXT,
    fine_amount REAL NOT NULL DEFAULT 0,
    fine_paid INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('borrowed', 'returned', 'overdue')) DEFAULT 'borrowed'
  );
  CREATE TABLE IF NOT EXISTS login_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_in_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('waiting', 'ready', 'fulfilled', 'cancelled')) DEFAULT 'waiting',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ready_at TEXT,
    fulfilled_at TEXT
  );
  CREATE INDEX IF NOT EXISTS reservations_book_status_created
    ON reservations(book_id, status, created_at, id);
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('due_soon', 'overdue', 'reservation_ready')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    borrow_record_id INTEGER REFERENCES borrow_records(id) ON DELETE CASCADE,
    reservation_id INTEGER REFERENCES reservations(id) ON DELETE CASCADE,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, type, borrow_record_id, reservation_id)
  );
  CREATE INDEX IF NOT EXISTS notifications_user_read_created
    ON notifications(user_id, is_read, created_at DESC);
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS password_reset_tokens_lookup
    ON password_reset_tokens(user_id, expires_at);
`);

const adminExists = db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get();
if (!adminExists) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, bcrypt.hashSync(password, 12), 'admin');
  console.warn(`Created initial admin account: ${username}. Change its password before production use.`);
}

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
}));

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date, days) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const userJson = (user) => user && ({ id: user.id, username: user.username, email: user.email, role: user.role, is_authenticated: true });
const bookJson = (book) => ({ ...book, quantity: Math.max(book.quantity, book.available_copies), available_copies: Math.min(book.available_copies, Math.max(book.quantity, book.available_copies)) });
const getUser = (id) => db.prepare('SELECT id, username, email, role FROM users WHERE id = ?').get(id);
const getBook = (id) => db.prepare('SELECT * FROM books WHERE id = ?').get(id);
const getRecord = (id) => db.prepare('SELECT * FROM borrow_records WHERE id = ?').get(id);
const passwordMatches = (password, passwordHash) => {
  if (passwordHash.startsWith('pbkdf2_sha256$')) {
    const [, iterations, salt, expected] = passwordHash.split('$');
    const derived = crypto.pbkdf2Sync(password, salt, Number(iterations), 32, 'sha256').toString('base64');
    return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(expected));
  }
  return bcrypt.compareSync(password, passwordHash);
};

function refreshFine(record) {
  if (!record || !record.due_date) return record;
  const endDate = record.return_date || today();
  let fine = record.fine_amount;
  let status = record.status;
  if (endDate > record.due_date && ['borrowed', 'overdue', 'returned'].includes(status)) {
    fine = Math.round(((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${record.due_date}T00:00:00Z`)) / 86400000) * FINE_PER_DAY * 100) / 100;
    if (status === 'borrowed') status = 'overdue';
  } else if (status !== 'returned') fine = 0;
  if (fine !== record.fine_amount || status !== record.status) db.prepare('UPDATE borrow_records SET fine_amount = ?, status = ? WHERE id = ?').run(fine, status, record.id);
  return { ...record, fine_amount: fine, status };
}
function recordJson(record) {
  const current = refreshFine(record);
  return { id: current.id, user: userJson(getUser(current.user_id)), book: bookJson(getBook(current.book_id)), borrow_date: current.borrow_date, due_date: current.due_date, return_date: current.return_date, fine_amount: String(current.fine_amount.toFixed(2)), fine_paid: Boolean(current.fine_paid), status: current.status };
}
function reservationJson(reservation) {
  return {
    id: reservation.id,
    user: userJson(getUser(reservation.user_id)),
    book: bookJson(getBook(reservation.book_id)),
    status: reservation.status,
    created_at: reservation.created_at,
    ready_at: reservation.ready_at,
    fulfilled_at: reservation.fulfilled_at,
  };
}
function reservationPosition(reservation) {
  if (!['waiting', 'ready'].includes(reservation.status)) return null;
  return db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE book_id = ? AND status IN ('waiting', 'ready') AND (created_at < ? OR (created_at = ? AND id <= ?))")
    .get(reservation.book_id, reservation.created_at, reservation.created_at, reservation.id).count;
}
function promoteNextReservation(bookId) {
  const ready = db.prepare("SELECT 1 FROM reservations WHERE book_id = ? AND status = 'ready'").get(bookId);
  if (ready) return null;
  const next = db.prepare("SELECT * FROM reservations WHERE book_id = ? AND status = 'waiting' ORDER BY created_at, id LIMIT 1").get(bookId);
  if (!next) return null;
  const readyAt = new Date().toISOString();
  db.prepare("UPDATE reservations SET status = 'ready', ready_at = ? WHERE id = ?").run(readyAt, next.id);
  createNotification(next.user_id, 'reservation_ready', 'Reserved book is ready', `Your reserved copy of \"${getBook(bookId).title}\" is ready to borrow.`, { reservationId: next.id });
  return getReservation(next.id);
}
const getReservation = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
function createNotification(userId, type, title, message, { borrowRecordId = null, reservationId = null } = {}) {
  const existing = db.prepare('SELECT id FROM notifications WHERE user_id = ? AND type = ? AND borrow_record_id IS ? AND reservation_id IS ?')
    .get(userId, type, borrowRecordId, reservationId);
  if (!existing) {
    db.prepare('INSERT INTO notifications (user_id, type, title, message, borrow_record_id, reservation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, type, title, message, borrowRecordId, reservationId, new Date().toISOString());
  }
}
function syncBorrowNotifications(userId) {
  const records = db.prepare("SELECT * FROM borrow_records WHERE user_id = ? AND status IN ('borrowed', 'overdue')").all(userId);
  for (const record of records) {
    const daysUntilDue = Math.round((Date.parse(`${record.due_date}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400000);
    const book = getBook(record.book_id);
    if (daysUntilDue >= 0 && daysUntilDue <= 2) {
      createNotification(userId, 'due_soon', 'Book due soon', `\"${book.title}\" is due ${daysUntilDue === 0 ? 'today' : `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`}.`, { borrowRecordId: record.id });
    }
    if (daysUntilDue < 0) {
      const fine = refreshFine(record).fine_amount;
      createNotification(userId, 'overdue', 'Book overdue', `\"${book.title}\" is ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? '' : 's'} overdue. Current fine: R${fine.toFixed(2)}.`, { borrowRecordId: record.id });
    }
  }
}
function notificationJson(notification) { return { ...notification, is_read: Boolean(notification.is_read) }; }
function requireAuth(req, res, next) { if (!req.session.userId) return res.status(401).json({ error: 'Authentication required.' }); req.user = getUser(req.session.userId); if (!req.user) return res.status(401).json({ error: 'Authentication required.' }); next(); }
function requireRole(role) { return (req, res, next) => { if (!req.user) return res.status(401).json({ error: 'Authentication required.' }); if (req.user.role !== role) return res.status(403).json({ error: `${role[0].toUpperCase() + role.slice(1)} access required.` }); next(); }; }
function uniqueError(res, error) { if (String(error.message).includes('UNIQUE constraint failed')) return res.status(400).json({ error: 'A book with that ISBN already exists.' }); return res.status(400).json({ error: 'Unable to save the book.' }); }

app.get('/api/session/', (req, res) => res.json({ csrfToken: '', user: req.session.userId ? userJson(getUser(req.session.userId)) : null }));
app.post('/api/login/', (req, res) => {
  const { username = '', password = '', role = 'user' } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !passwordMatches(password, user.password_hash)) return res.status(400).json({ error: 'Invalid username or password.' });
  if (user.password_hash.startsWith('pbkdf2_sha256$')) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 12), user.id);
  if (user.role !== role) return res.status(403).json({ error: role === 'admin' ? 'You are not an admin.' : 'You are not a normal user.' });
  req.session.userId = user.id;
  db.prepare('INSERT INTO login_activities (user_id, logged_in_at) VALUES (?, ?)').run(user.id, new Date().toISOString());
  res.json({ csrfToken: '', user: userJson(user) });
});
app.post('/api/register/', (req, res) => {
  const { username = '', email = '', password = '' } = req.body;
  if (!username.trim() || !email.trim() || !password) return res.status(400).json({ error: 'Username, email, and password are required.' });
  try { const result = db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(username.trim(), email.trim(), bcrypt.hashSync(password, 12), 'user'); req.session.userId = result.lastInsertRowid; return res.status(201).json({ csrfToken: '', user: userJson(getUser(result.lastInsertRowid)) }); } catch { return res.status(400).json({ error: 'That username is already taken.' }); }
});
app.post('/api/logout/', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.post('/api/password-reset/request/', (req, res) => {
  const { username = '', email = '' } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  // Do not reveal whether an account exists. An email is required when the account has one.
  if (!user || !user.email || user.email.toLowerCase() !== String(email).trim().toLowerCase()) {
    return res.json({ message: 'If the account details match, a reset code has been created.' });
  }
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(new Date().toISOString(), user.id);
  db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(user.id, crypto.createHash('sha256').update(code).digest('hex'), expiresAt);
  console.info(`Password-reset code for ${user.username}: ${code} (expires in 15 minutes)`);
  const response = { message: 'If the account details match, a reset code has been created.' };
  if (process.env.NODE_ENV !== 'production') response.reset_code = code;
  return res.json(response);
});

app.post('/api/password-reset/confirm/', (req, res) => {
  const { username = '', code = '', password = '' } = req.body;
  if (String(password).length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!user) return res.status(400).json({ error: 'Invalid or expired reset code.' });
  const token = db.prepare('SELECT * FROM password_reset_tokens WHERE user_id = ? AND token_hash = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1')
    .get(user.id, crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex'), new Date().toISOString());
  if (!token) return res.status(400).json({ error: 'Invalid or expired reset code.' });
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 12), user.id);
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(new Date().toISOString(), token.id);
  })();
  return res.json({ message: 'Password reset successfully. You can now sign in.' });
});

app.get('/api/notifications/', requireAuth, requireRole('user'), (req, res) => {
  syncBorrowNotifications(req.user.id);
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY is_read, created_at DESC, id DESC').all(req.user.id);
  res.json({ notifications: notifications.map(notificationJson), unread_count: notifications.filter((notification) => !notification.is_read).length });
});
app.post('/api/notifications/:id/read/', requireAuth, requireRole('user'), (req, res) => {
  const notification = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!notification) return res.status(404).json({ error: 'Notification not found.' });
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(notification.id);
  res.json({ notification: notificationJson({ ...notification, is_read: 1 }) });
});
app.post('/api/notifications/read-all/', requireAuth, requireRole('user'), (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.user.id);
  res.json({ ok: true });
});

app.get('/api/books/', requireAuth, (req, res) => { const q = String(req.query.q || '').trim(); const books = q ? db.prepare('SELECT * FROM books WHERE title LIKE ? OR author LIKE ? OR category LIKE ? OR isbn LIKE ? ORDER BY title').all(...Array(4).fill(`%${q}%`)) : db.prepare('SELECT * FROM books ORDER BY title').all(); res.json({ books: books.map(bookJson) }); });
app.post('/api/books/', requireAuth, requireRole('admin'), (req, res) => { const data = req.body; const quantity = Math.max(Number(data.quantity || 1), Number(data.available_copies || data.quantity || 1)); const available = Math.max(0, Number(data.available_copies ?? quantity)); try { const result = db.prepare('INSERT INTO books (title, author, isbn, category, quantity, available_copies) VALUES (?, ?, ?, ?, ?, ?)').run(String(data.title || '').trim(), String(data.author || '').trim(), String(data.isbn || '').trim(), String(data.category || '').trim(), quantity, available); res.status(201).json({ book: bookJson(getBook(result.lastInsertRowid)) }); } catch (error) { uniqueError(res, error); } });
app.put('/api/books/:id/', requireAuth, requireRole('admin'), (req, res) => { const book = getBook(req.params.id); if (!book) return res.status(404).json({ error: 'Book not found.' }); const data = req.body; const updated = { ...book, ...Object.fromEntries(['title', 'author', 'isbn', 'category'].filter((key) => key in data).map((key) => [key, String(data[key] || '').trim()])), ...Object.fromEntries(['quantity', 'available_copies'].filter((key) => key in data).map((key) => [key, Math.max(0, Number(data[key] || 0))])) }; updated.quantity = Math.max(updated.quantity, updated.available_copies); try { db.prepare('UPDATE books SET title=?, author=?, isbn=?, category=?, quantity=?, available_copies=? WHERE id=?').run(updated.title, updated.author, updated.isbn, updated.category, updated.quantity, updated.available_copies, book.id); res.json({ book: bookJson(getBook(book.id)) }); } catch (error) { uniqueError(res, error); } });
app.delete('/api/books/:id/', requireAuth, requireRole('admin'), (req, res) => { if (!getBook(req.params.id)) return res.status(404).json({ error: 'Book not found.' }); db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

app.post('/api/books/:id/borrow/', requireAuth, requireRole('user'), (req, res) => { const book = getBook(req.params.id); if (!book) return res.status(404).json({ error: 'Book not found.' }); if (db.prepare("SELECT 1 FROM borrow_records WHERE user_id = ? AND book_id = ? AND status IN ('borrowed', 'overdue')").get(req.user.id, book.id)) return res.status(400).json({ error: 'You already borrowed this book.' }); if (book.available_copies <= 0) return res.status(400).json({ error: 'This book is not available right now.' }); const priority = db.prepare("SELECT * FROM reservations WHERE book_id = ? AND status = 'ready' ORDER BY ready_at, id LIMIT 1").get(book.id); if (priority && priority.user_id !== req.user.id) return res.status(400).json({ error: 'This copy is reserved for the next person in the queue.' }); const borrowDate = today(); const result = db.transaction(() => { const created = db.prepare("INSERT INTO borrow_records (user_id, book_id, borrow_date, due_date, status) VALUES (?, ?, ?, ?, 'borrowed')").run(req.user.id, book.id, borrowDate, addDays(borrowDate, 7)); db.prepare('UPDATE books SET available_copies = available_copies - 1 WHERE id = ?').run(book.id); if (priority) db.prepare("UPDATE reservations SET status = 'fulfilled', fulfilled_at = ? WHERE id = ?").run(new Date().toISOString(), priority.id); return created; })(); res.json({ record: recordJson(getRecord(result.lastInsertRowid)) }); });
app.post('/api/books/:id/reserve/', requireAuth, requireRole('user'), (req, res) => {
  const book = getBook(req.params.id);
  if (!book) return res.status(404).json({ error: 'Book not found.' });
  if (book.available_copies > 0) return res.status(400).json({ error: 'This book is available now. Borrow it instead of reserving it.' });
  if (db.prepare("SELECT 1 FROM borrow_records WHERE user_id = ? AND book_id = ? AND status IN ('borrowed', 'overdue')").get(req.user.id, book.id)) return res.status(400).json({ error: 'You already borrowed this book.' });
  if (db.prepare("SELECT 1 FROM reservations WHERE user_id = ? AND book_id = ? AND status IN ('waiting', 'ready')").get(req.user.id, book.id)) return res.status(400).json({ error: 'You already have an active reservation for this book.' });
  const result = db.prepare("INSERT INTO reservations (user_id, book_id, status, created_at) VALUES (?, ?, 'waiting', ?)").run(req.user.id, book.id, new Date().toISOString());
  const reservation = getReservation(result.lastInsertRowid);
  res.status(201).json({ reservation: { ...reservationJson(reservation), queue_position: reservationPosition(reservation) } });
});
app.get('/api/my-reservations/', requireAuth, requireRole('user'), (req, res) => {
  const reservations = db.prepare("SELECT * FROM reservations WHERE user_id = ? AND status IN ('waiting', 'ready') ORDER BY created_at DESC, id DESC").all(req.user.id);
  res.json({ reservations: reservations.map((reservation) => ({ ...reservationJson(reservation), queue_position: reservationPosition(reservation) })) });
});
app.post('/api/my-reservations/:id/cancel/', requireAuth, requireRole('user'), (req, res) => {
  const reservation = getReservation(req.params.id);
  if (!reservation || reservation.user_id !== req.user.id || !['waiting', 'ready'].includes(reservation.status)) return res.status(404).json({ error: 'Active reservation not found.' });
  db.transaction(() => { db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(reservation.id); if (reservation.status === 'ready') promoteNextReservation(reservation.book_id); })();
  res.json({ ok: true });
});
app.get('/api/my-books/', requireAuth, requireRole('user'), (req, res) => { syncBorrowNotifications(req.user.id); const records = db.prepare('SELECT * FROM borrow_records WHERE user_id = ? ORDER BY borrow_date DESC, id DESC').all(req.user.id); res.json({ records: records.map(recordJson) }); });
app.post('/api/my-books/:id/return/', requireAuth, requireRole('user'), (req, res) => { const record = getRecord(req.params.id); if (!record || record.user_id !== req.user.id) return res.status(404).json({ error: 'Borrow record not found.' }); if (record.status === 'returned') return res.status(400).json({ error: 'This book has already been returned.' }); const result = db.transaction(() => { const returned = refreshFine({ ...record, return_date: today(), status: 'returned' }); db.prepare('UPDATE borrow_records SET return_date = ?, status = ?, fine_amount = ? WHERE id = ?').run(today(), 'returned', returned.fine_amount, record.id); db.prepare('UPDATE books SET available_copies = MIN(available_copies + 1, quantity) WHERE id = ?').run(record.book_id); const reservation = promoteNextReservation(record.book_id); return { record: getRecord(record.id), reservation }; })(); res.json({ record: recordJson(result.record), reservation: result.reservation ? reservationJson(result.reservation) : null }); });
app.post('/api/my-books/:id/pay-fine/', requireAuth, requireRole('user'), (req, res) => { const record = refreshFine(getRecord(req.params.id)); if (!record || record.user_id !== req.user.id) return res.status(404).json({ error: 'Borrow record not found.' }); if (record.fine_amount <= 0) return res.status(400).json({ error: 'There is no fine to pay for this book.' }); if (record.status !== 'returned') return res.status(400).json({ error: 'Return this book before paying the final fine.' }); if (record.fine_paid) return res.status(400).json({ error: 'This fine has already been paid.' }); db.prepare('UPDATE borrow_records SET fine_paid = 1 WHERE id = ?').run(record.id); res.json({ record: recordJson(getRecord(record.id)) }); });

app.get('/api/admin/summary/', requireAuth, requireRole('admin'), (req, res) => { const records = db.prepare('SELECT * FROM borrow_records ORDER BY borrow_date DESC, id DESC').all(); const reservations = db.prepare("SELECT * FROM reservations WHERE status IN ('waiting', 'ready') ORDER BY created_at, id").all(); const jsonRecords = records.map(recordJson); const unpaid = jsonRecords.filter((record) => Number(record.fine_amount) > 0 && !record.fine_paid); res.json({ stats: { total_books: db.prepare('SELECT COUNT(*) AS count FROM books').get().count, total_borrowed: db.prepare("SELECT COUNT(*) AS count FROM borrow_records WHERE status = 'borrowed'").get().count, total_returned: db.prepare("SELECT COUNT(*) AS count FROM borrow_records WHERE status = 'returned'").get().count, total_users: db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'user'").get().count, active_reservations: reservations.length }, report_stats: { total_borrowed: records.length, books_owed: jsonRecords.filter((record) => ['borrowed', 'overdue'].includes(record.status)).length, amount_owed: String(unpaid.reduce((sum, record) => sum + Number(record.fine_amount), 0).toFixed(2)) }, users: db.prepare('SELECT id, username, email, role FROM users ORDER BY username').all().map(userJson), records: jsonRecords, reservations: reservations.map((reservation) => ({ ...reservationJson(reservation), queue_position: reservationPosition(reservation) })), login_activities: db.prepare('SELECT * FROM login_activities ORDER BY logged_in_at DESC').all().map((activity) => ({ id: activity.id, user: userJson(getUser(activity.user_id)), logged_in_at: activity.logged_in_at })) }); });
app.get('/api/admin/reports/download/', requireAuth, requireRole('admin'), (req, res) => {
  const records = db.prepare('SELECT * FROM borrow_records ORDER BY borrow_date DESC, id DESC').all().map(recordJson);
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['Borrower', 'Book', 'Borrowed date', 'Due date', 'Return date', 'Status', 'Fine', 'Fine paid']];
  records.forEach((record) => rows.push([record.user.username, record.book.title, record.borrow_date, record.due_date, record.return_date, record.status, record.fine_amount, record.fine_paid ? 'Yes' : 'No']));
  res.type('text/csv').attachment('library-report.csv').send(rows.map((row) => row.map(escape).join(',')).join('\n'));
});

const buildDir = path.join(__dirname, '..', 'static', 'react');
app.use(express.static(buildDir));
app.use((req, res) => res.sendFile(path.join(buildDir, 'index.html')));
app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: 'An unexpected server error occurred.' }); });
app.listen(port, () => console.log(`Library backend listening on http://127.0.0.1:${port}`));
