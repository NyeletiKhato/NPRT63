const path = require('path');
const crypto = require('crypto');
const os = require('os');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const app = express();
const port = Number(process.env.PORT || 3000);
const db = new Database(process.env.LIBRARY_DB_PATH || path.join(__dirname, 'library.db'));

// Required for secure session cookies when the app runs behind a hosting proxy.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')) DEFAULT 'user',
    is_active INTEGER NOT NULL DEFAULT 1,
    email_verified INTEGER NOT NULL DEFAULT 1,
    profile_photo TEXT NOT NULL DEFAULT '',
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
  CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

// Existing installations predate account deactivation. SQLite does not support
// adding this inside CREATE TABLE IF NOT EXISTS, so apply the small migration here.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
if (!userColumns.includes('is_active')) {
  db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
}
if (!userColumns.includes('profile_photo')) {
  db.exec("ALTER TABLE users ADD COLUMN profile_photo TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.includes('email_verified')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1');
}
db.exec('UPDATE users SET email_verified = 1 WHERE email_verified = 0');
const adminExists = db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get();
if (!adminExists) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, bcrypt.hashSync(password, 12), 'admin');
  console.warn(`Created initial admin account: ${username}. Change its password before production use.`);
}

app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
}));

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date, days) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const userJson = (user) => user && ({ id: user.id, username: user.username, email: user.email, role: user.role, is_active: Boolean(user.is_active), email_verified: Boolean(user.email_verified), profile_photo: user.profile_photo || '', is_authenticated: true });
const bookJson = (book) => ({ ...book, quantity: Math.max(book.quantity, book.available_copies), available_copies: Math.min(book.available_copies, Math.max(book.quantity, book.available_copies)) });
const getUser = (id) => db.prepare('SELECT id, username, email, role, is_active, email_verified, profile_photo FROM users WHERE id = ?').get(id);
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
const emailLooksValid = (email) => email.length <= 254
  && /^[^\s@<>]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email);
function recordJson(record) {
  const current = record;
  return { id: current.id, user: userJson(getUser(current.user_id)), book: bookJson(getBook(current.book_id)), borrow_date: current.borrow_date, due_date: current.due_date, return_date: current.return_date, status: current.status };
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
      createNotification(userId, 'due_soon', 'Book due soon', `"${book.title}" is due ${daysUntilDue === 0 ? 'today' : `in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`}.`, { borrowRecordId: record.id });
    }
    if (daysUntilDue < 0) {
      createNotification(userId, 'overdue', 'Book overdue', `"${book.title}" is ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? '' : 's'} overdue. Please return it as soon as possible.`, { borrowRecordId: record.id });
    }
  }
}
function processAutoReturns() {
  const cutoffDate = addDays(today(), -14);
  return db.transaction(() => {
    const records = db.prepare("SELECT * FROM borrow_records WHERE status IN ('borrowed', 'overdue') AND borrow_date <= ? ORDER BY user_id, borrow_date, id").all(cutoffDate);
    const affectedUsers = new Set();
    for (const record of records) {
      const autoReturnDate = addDays(record.borrow_date, 14);
      db.prepare("UPDATE borrow_records SET return_date = ?, status = 'returned' WHERE id = ?").run(autoReturnDate, record.id);
      db.prepare('UPDATE books SET available_copies = MIN(available_copies + 1, quantity) WHERE id = ?').run(record.book_id);
      promoteNextReservation(record.book_id);
      affectedUsers.add(record.user_id);
    }
    for (const userId of affectedUsers) {
      db.prepare("UPDATE users SET is_active = 0 WHERE id = ? AND role = 'user'").run(userId);
    }
    return { returnedCount: records.length, blockedUserCount: affectedUsers.size };
  }).immediate();
}
function notificationJson(notification) { return { ...notification, is_read: Boolean(notification.is_read) }; }
function requireAuth(req, res, next) { processAutoReturns(); if (!req.session.userId) return res.status(401).json({ error: 'Authentication required.' }); req.user = getUser(req.session.userId); if (!req.user || !req.user.is_active) { req.session.destroy(() => {}); return res.status(401).json({ error: 'This account is no longer active.' }); } next(); }
function requireRole(role) { return (req, res, next) => { if (!req.user) return res.status(401).json({ error: 'Authentication required.' }); if (req.user.role !== role) return res.status(403).json({ error: `${role === 'user' ? 'Member' : role[0].toUpperCase() + role.slice(1)} access required.` }); next(); }; }
function uniqueError(res, error) { if (String(error.message).includes('UNIQUE constraint failed')) return res.status(400).json({ error: 'A book with that ISBN already exists.' }); return res.status(400).json({ error: 'Unable to save the book.' }); }

function localNetworkAddress() {
  const addresses = Object.values(os.networkInterfaces()).flatMap((entries) => (entries || []))
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  return addresses.find((address) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) || addresses[0] || null;
}

app.get('/api/session/', (req, res) => {
  processAutoReturns();
  const user = req.session.userId ? getUser(req.session.userId) : null;
  if (user && !user.is_active) req.session.destroy(() => {});
  res.json({ csrfToken: '', user: user?.is_active ? userJson(user) : null });
});
app.get('/api/network-address/', (req, res) => res.json({ address: localNetworkAddress() }));
app.post('/api/newsletter/subscribe/', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!emailLooksValid(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  try {
    db.prepare('INSERT INTO newsletter_subscriptions (email) VALUES (?)').run(email);
    return res.status(201).json({ message: 'You are subscribed to library updates.' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.json({ message: 'This email is already subscribed to library updates.' });
    console.error('Newsletter subscription failed:', error);
    return res.status(500).json({ error: 'We could not save your subscription. Please try again.' });
  }
});
app.post('/api/login/', (req, res) => {
  processAutoReturns();
  const { username = '', password = '', role = 'user' } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !passwordMatches(password, user.password_hash)) return res.status(400).json({ error: 'Invalid username or password.' });
  if (!user.is_active) return res.status(403).json({ error: 'This member account has been deactivated. Contact a library administrator for help.' });
  if (user.password_hash.startsWith('pbkdf2_sha256$')) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 12), user.id);
  if (user.role !== role) return res.status(403).json({ error: role === 'admin' ? 'You are not an admin.' : 'You are not a library member.' });
  req.session.userId = user.id;
  db.prepare('INSERT INTO login_activities (user_id, logged_in_at) VALUES (?, ?)').run(user.id, new Date().toISOString());
  res.json({ csrfToken: '', user: userJson(user) });
});
app.post('/api/register/', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !email || !password) return res.status(400).json({ error: 'Username, email, and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return res.status(400).json({ error: 'That username is already taken.' });

  try {
    const result = db.prepare('INSERT INTO users (username, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, 1)')
      .run(username, email, bcrypt.hashSync(password, 12), 'user');
    const user = getUser(Number(result.lastInsertRowid));
    req.session.userId = user.id;
    db.prepare('INSERT INTO login_activities (user_id, logged_in_at) VALUES (?, ?)').run(user.id, new Date().toISOString());
    return res.status(201).json({ message: 'Account created.', csrfToken: '', user: userJson(user) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) return res.status(400).json({ error: 'That username or email address is already in use.' });
    console.error('Member registration failed:', error.message);
    return res.status(500).json({ error: 'We could not create the account. Please try again.' });
  }
});
app.post('/api/logout/', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.post('/api/account/deactivate/', requireAuth, requireRole('user'), (req, res) => {
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(req.user.id);
  req.session.destroy(() => res.json({ ok: true, message: 'Your account has been deactivated.' }));
});
app.put('/api/account/profile-photo/', requireAuth, (req, res) => {
  const photo = String(req.body?.photo || '');
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(photo)) {
    return res.status(400).json({ error: 'Choose a PNG, JPEG, WEBP, or GIF image.' });
  }
  if (photo.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'Choose an image smaller than 1.5 MB.' });
  db.prepare('UPDATE users SET profile_photo = ? WHERE id = ?').run(photo, req.user.id);
  return res.json({ user: userJson(getUser(req.user.id)) });
});
app.delete('/api/account/profile-photo/', requireAuth, (req, res) => {
  db.prepare("UPDATE users SET profile_photo = '' WHERE id = ?").run(req.user.id);
  return res.json({ user: userJson(getUser(req.user.id)) });
});

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

app.post('/api/books/:id/borrow/', requireAuth, requireRole('user'), (req, res) => {
  const book = getBook(req.params.id);
  if (!book) return res.status(404).json({ error: 'Book not found.' });
  if (db.prepare("SELECT 1 FROM borrow_records WHERE user_id = ? AND book_id = ? AND status IN ('borrowed', 'overdue')").get(req.user.id, book.id)) {
    return res.status(400).json({ error: 'You already borrowed this book.' });
  }
  if (book.available_copies <= 0) return res.status(400).json({ error: 'This book is not available right now.' });
  const priority = db.prepare("SELECT * FROM reservations WHERE book_id = ? AND status = 'ready' ORDER BY ready_at, id LIMIT 1").get(book.id);
  if (priority && priority.user_id !== req.user.id) return res.status(400).json({ error: 'This copy is reserved for the next person in the queue.' });
  const borrowDate = today();
  const result = db.transaction(() => {
    const activeBorrowCount = db.prepare("SELECT COUNT(*) AS count FROM borrow_records WHERE user_id = ? AND status IN ('borrowed', 'overdue')").get(req.user.id).count;
    if (activeBorrowCount >= 3) return { limitReached: true };
    const created = db.prepare("INSERT INTO borrow_records (user_id, book_id, borrow_date, due_date, status) VALUES (?, ?, ?, ?, 'borrowed')").run(req.user.id, book.id, borrowDate, addDays(borrowDate, 7));
    db.prepare('UPDATE books SET available_copies = available_copies - 1 WHERE id = ?').run(book.id);
    if (priority) db.prepare("UPDATE reservations SET status = 'fulfilled', fulfilled_at = ? WHERE id = ?").run(new Date().toISOString(), priority.id);
    return created;
  }).immediate();
  if (result.limitReached) return res.status(400).json({ error: 'You can borrow up to 3 books at a time. Return a book before borrowing another.' });
  res.json({ record: recordJson(getRecord(result.lastInsertRowid)) });
});
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
app.post('/api/my-books/:id/return/', requireAuth, requireRole('user'), (req, res) => { const record = getRecord(req.params.id); if (!record || record.user_id !== req.user.id) return res.status(404).json({ error: 'Borrow record not found.' }); if (record.status === 'returned') return res.status(400).json({ error: 'This book has already been returned.' }); const result = db.transaction(() => { db.prepare("UPDATE borrow_records SET return_date = ?, status = 'returned' WHERE id = ?").run(today(), record.id); db.prepare('UPDATE books SET available_copies = MIN(available_copies + 1, quantity) WHERE id = ?').run(record.book_id); const reservation = promoteNextReservation(record.book_id); return { record: getRecord(record.id), reservation }; })(); res.json({ record: recordJson(result.record), reservation: result.reservation ? reservationJson(result.reservation) : null }); });
app.get('/api/admin/summary/', requireAuth, requireRole('admin'), (req, res) => {
  const records = db.prepare('SELECT * FROM borrow_records ORDER BY borrow_date DESC, id DESC').all();
  const reservations = db.prepare("SELECT * FROM reservations WHERE status IN ('waiting', 'ready') ORDER BY created_at, id").all();
  const jsonRecords = records.map(recordJson);
  res.json({
    stats: {
      total_books: db.prepare('SELECT COUNT(*) AS count FROM books').get().count,
      total_copies: db.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM books').get().total,
      total_borrowed: db.prepare("SELECT COUNT(*) AS count FROM borrow_records WHERE status = 'borrowed'").get().count,
      total_returned: db.prepare("SELECT COUNT(*) AS count FROM borrow_records WHERE status = 'returned'").get().count,
      total_users: db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'user'").get().count,
      active_reservations: reservations.length,
    },
    report_stats: { total_borrowed: records.length },
    users: db.prepare('SELECT id, username, email, role, is_active, email_verified, profile_photo FROM users ORDER BY username').all().map(userJson),
    records: jsonRecords,
    reservations: reservations.map((reservation) => ({ ...reservationJson(reservation), queue_position: reservationPosition(reservation) })),
    login_activities: db.prepare('SELECT * FROM login_activities ORDER BY logged_in_at DESC').all().map((activity) => ({ id: activity.id, user: userJson(getUser(activity.user_id)), logged_in_at: activity.logged_in_at })),
  });
});
app.delete('/api/admin/users/:id/', requireAuth, requireRole('admin'), (req, res) => {
  const target = getUser(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role !== 'user') return res.status(403).json({ error: 'Admin accounts cannot be removed here.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.json({ ok: true, username: target.username });
});
app.get('/api/admin/reports/download/', requireAuth, requireRole('admin'), (req, res) => {
  const records = db.prepare('SELECT * FROM borrow_records ORDER BY borrow_date DESC, id DESC').all().map(recordJson);
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['Borrower', 'Book', 'Borrowed date', 'Due date', 'Return date', 'Status']];
  records.forEach((record) => rows.push([record.user.username, record.book.title, record.borrow_date, record.due_date, record.return_date, record.status]));
  res.type('text/csv').attachment('library-report.csv').send(rows.map((row) => row.map(escape).join(',')).join('\n'));
});

const buildDir = path.join(__dirname, '..', 'static', 'react');
app.use(express.static(buildDir));
app.use((req, res) => res.sendFile(path.join(buildDir, 'index.html')));
app.use((error, req, res, next) => { console.error(error); res.status(500).json({ error: 'An unexpected server error occurred.' }); });
processAutoReturns();
const autoReturnTimer = setInterval(() => {
  try {
    processAutoReturns();
  } catch (error) {
    console.error('Automatic book return processing failed:', error.message);
  }
}, 5 * 60 * 1000);
autoReturnTimer.unref();
app.listen(port, () => console.log(`Library backend listening on http://127.0.0.1:${port}`));
