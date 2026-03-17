const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const dataPath = path.join(__dirname, "..", "data");
const databasePath = path.join(dataPath, "app.db");

fs.mkdirSync(dataPath, { recursive: true });

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    locked_ip TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_helper INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calculations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attraction_name TEXT NOT NULL,
    people_per_train INTEGER NOT NULL,
    trains_in_two_minutes INTEGER NOT NULL,
    throughput_per_hour INTEGER NOT NULL,
    recorded_date TEXT NOT NULL,
    recorded_time TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    user_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS ip_bans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by_user_id INTEGER,
    lifted_at TEXT,
    lifted_by_user_id INTEGER,
    FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY (lifted_by_user_id) REFERENCES users (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS attraction_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attraction_name TEXT NOT NULL,
    park_name TEXT NOT NULL,
    country_name TEXT NOT NULL,
    people_per_train INTEGER NOT NULL,
    requested_by_user_id INTEGER,
    requested_by_username TEXT,
    requester_ip TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    processed_at TEXT,
    processed_by_user_id INTEGER,
    FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY (processed_by_user_id) REFERENCES users (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    target_role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by_user_id INTEGER,
    FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS notification_reads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    read_at TEXT NOT NULL,
    UNIQUE(notification_id, user_id),
    FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all();
const hasLockedIpColumn = userColumns.some((column) => column.name === "locked_ip");
const hasHelperColumn = userColumns.some((column) => column.name === "is_helper");

if (!hasLockedIpColumn) {
  db.exec("ALTER TABLE users ADD COLUMN locked_ip TEXT");
}

if (!hasHelperColumn) {
  db.exec("ALTER TABLE users ADD COLUMN is_helper INTEGER NOT NULL DEFAULT 0");
}

const existingAdmin = db
  .prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1")
  .get("admin");

if (!existingAdmin) {
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO users (username, password_hash, locked_ip, is_admin, created_at, updated_at)
      VALUES (?, ?, NULL, 1, ?, ?)
    `
  ).run("admin", bcrypt.hashSync("admin", 12), now, now);
}

module.exports = db;
