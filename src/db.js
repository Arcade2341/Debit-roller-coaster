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
    is_admin INTEGER NOT NULL DEFAULT 0,
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
`);

const findAdmin = db
  .prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1")
  .get("Admin");

if (!findAdmin) {
  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync("admin", 12);

  db.prepare(
    `
      INSERT INTO users (username, password_hash, is_admin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run("Admin", passwordHash, 1, now, now);
}

module.exports = db;
