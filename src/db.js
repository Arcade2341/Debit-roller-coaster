const fs = require("fs");
const path = require("path");
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
    is_publication INTEGER NOT NULL DEFAULT 0,
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calculations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attraction_name TEXT NOT NULL,
    people_per_train INTEGER NOT NULL,
    trains_in_two_minutes INTEGER NOT NULL,
    train_window_minutes INTEGER NOT NULL DEFAULT 2,
    average_dispatch_seconds REAL,
    time_samples_count INTEGER,
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
    category TEXT NOT NULL DEFAULT 'site_updates',
    target_role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    published_at TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS news_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT NOT NULL,
    created_by_user_id INTEGER,
    FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    question TEXT NOT NULL,
    allow_multiple INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT NOT NULL,
    created_by_user_id INTEGER,
    FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS poll_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    position INTEGER NOT NULL,
    FOREIGN KEY (poll_id) REFERENCES polls (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS poll_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL,
    poll_option_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (poll_id) REFERENCES polls (id) ON DELETE CASCADE,
    FOREIGN KEY (poll_option_id) REFERENCES poll_options (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all();
const hasLockedIpColumn = userColumns.some((column) => column.name === "locked_ip");
const hasHelperColumn = userColumns.some((column) => column.name === "is_helper");
const hasPublicationColumn = userColumns.some((column) => column.name === "is_publication");
const hasSuperAdminColumn = userColumns.some((column) => column.name === "is_super_admin");
const calculationColumns = db.prepare("PRAGMA table_info(calculations)").all();
const hasTrainWindowColumn = calculationColumns.some((column) => column.name === "train_window_minutes");
const hasAverageDispatchColumn = calculationColumns.some((column) => column.name === "average_dispatch_seconds");
const hasTimeSamplesCountColumn = calculationColumns.some((column) => column.name === "time_samples_count");
const notificationColumns = db.prepare("PRAGMA table_info(notifications)").all();
const hasNotificationCategoryColumn = notificationColumns.some((column) => column.name === "category");
const hasNotificationUpdatedColumn = notificationColumns.some((column) => column.name === "updated_at");
const hasNotificationPublishedColumn = notificationColumns.some((column) => column.name === "published_at");
const newsColumns = db.prepare("PRAGMA table_info(news_posts)").all();
const hasNewsPublishedColumn = newsColumns.some((column) => column.name === "published_at");

if (!hasLockedIpColumn) {
  db.exec("ALTER TABLE users ADD COLUMN locked_ip TEXT");
}

if (!hasHelperColumn) {
  db.exec("ALTER TABLE users ADD COLUMN is_helper INTEGER NOT NULL DEFAULT 0");
}

if (!hasPublicationColumn) {
  db.exec("ALTER TABLE users ADD COLUMN is_publication INTEGER NOT NULL DEFAULT 0");
}

if (!hasSuperAdminColumn) {
  db.exec("ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0");
}

if (!hasTrainWindowColumn) {
  db.exec("ALTER TABLE calculations ADD COLUMN train_window_minutes INTEGER NOT NULL DEFAULT 2");
}

if (!hasAverageDispatchColumn) {
  db.exec("ALTER TABLE calculations ADD COLUMN average_dispatch_seconds REAL");
}

if (!hasTimeSamplesCountColumn) {
  db.exec("ALTER TABLE calculations ADD COLUMN time_samples_count INTEGER");
}

if (!hasNotificationCategoryColumn) {
  db.exec("ALTER TABLE notifications ADD COLUMN category TEXT NOT NULL DEFAULT 'site_updates'");
}

if (!hasNotificationUpdatedColumn) {
  db.exec("ALTER TABLE notifications ADD COLUMN updated_at TEXT");
}

if (!hasNotificationPublishedColumn) {
  db.exec("ALTER TABLE notifications ADD COLUMN published_at TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE notifications SET published_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE published_at = ''");
}

if (!hasNewsPublishedColumn) {
  db.exec("ALTER TABLE news_posts ADD COLUMN published_at TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE news_posts SET published_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE published_at = ''");
}

module.exports = db;
