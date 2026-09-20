/* Imports the existing Django SQLite data into backend/library.db.
   Run before starting the Node server for the first time. */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const root = path.join(__dirname, '..');
const sourcePath = path.join(root, 'db.sqlite3');
const targetPath = path.join(__dirname, 'library.db');
if (!fs.existsSync(sourcePath)) throw new Error('Django database db.sqlite3 was not found.');
if (fs.existsSync(targetPath)) throw new Error('backend/library.db already exists. Remove it only if you want to repeat the import.');

const source = new Database(sourcePath, { readonly: true });
const target = new Database(targetPath);
target.pragma('foreign_keys = ON');
target.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin', 'user')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, isbn TEXT NOT NULL UNIQUE, category TEXT NOT NULL, quantity INTEGER NOT NULL, available_copies INTEGER NOT NULL);
  CREATE TABLE borrow_records (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE, borrow_date TEXT NOT NULL, due_date TEXT NOT NULL, return_date TEXT, fine_amount REAL NOT NULL DEFAULT 0, fine_paid INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('borrowed', 'returned', 'overdue')) DEFAULT 'borrowed');
  CREATE TABLE login_activities (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, logged_in_at TEXT NOT NULL);
`);
const rows = (table) => source.prepare(`SELECT * FROM ${table}`).all();
const insertUser = target.prepare('INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const insertBook = target.prepare('INSERT INTO books (id, title, author, isbn, category, quantity, available_copies) VALUES (?, ?, ?, ?, ?, ?, ?)');
const insertRecord = target.prepare('INSERT INTO borrow_records (id, user_id, book_id, borrow_date, due_date, return_date, fine_amount, fine_paid, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const insertActivity = target.prepare('INSERT INTO login_activities (id, user_id, logged_in_at) VALUES (?, ?, ?)');
target.transaction(() => {
  for (const user of rows('core_customuser')) insertUser.run(user.id, user.username, user.email || '', user.password, user.role, user.date_joined || new Date().toISOString());
  for (const book of rows('core_book')) insertBook.run(book.id, book.title, book.author, book.isbn, book.category, Math.max(book.quantity, book.available_copies), Math.max(0, book.available_copies));
  for (const record of rows('core_borrowrecord')) insertRecord.run(record.id, record.user_id, record.book_id, String(record.borrow_date).slice(0, 10), String(record.due_date).slice(0, 10), record.return_date ? String(record.return_date).slice(0, 10) : null, record.fine_amount || 0, record.fine_paid ? 1 : 0, record.status);
  for (const activity of rows('core_loginactivity')) insertActivity.run(activity.id, activity.user_id, activity.logged_in_at);
})();
source.close(); target.close();
console.log('Django data imported into backend/library.db. Django password hashes are retained and are upgraded after each successful Node login.');
