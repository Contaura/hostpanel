import Database from 'better-sqlite3';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'hostpanel.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS plans (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    description  TEXT    DEFAULT '',
    price        REAL    NOT NULL DEFAULT 0,
    billing_cycle TEXT   NOT NULL DEFAULT 'monthly',
    disk_quota   INTEGER NOT NULL DEFAULT 10240,
    bandwidth    INTEGER NOT NULL DEFAULT 102400,
    email_accts  INTEGER NOT NULL DEFAULT 10,
    databases    INTEGER NOT NULL DEFAULT 5,
    subdomains   INTEGER NOT NULL DEFAULT 10,
    ftp_accts    INTEGER NOT NULL DEFAULT 5,
    ssl          INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    email          TEXT NOT NULL UNIQUE,
    phone          TEXT DEFAULT '',
    company        TEXT DEFAULT '',
    address        TEXT DEFAULT '',
    city           TEXT DEFAULT '',
    country        TEXT DEFAULT '',
    notes          TEXT DEFAULT '',
    password_hash  TEXT DEFAULT NULL,
    portal_enabled INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT NOT NULL UNIQUE,
    domain         TEXT NOT NULL UNIQUE,
    client_id      INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    plan_id        INTEGER REFERENCES plans(id)   ON DELETE SET NULL,
    status         TEXT NOT NULL DEFAULT 'active',
    disk_used      INTEGER NOT NULL DEFAULT 0,
    bandwidth_used INTEGER NOT NULL DEFAULT 0,
    notes          TEXT DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,
    client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    account_id     INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    subtotal       REAL    NOT NULL DEFAULT 0,
    tax_rate       REAL    NOT NULL DEFAULT 0,
    tax_amount     REAL    NOT NULL DEFAULT 0,
    discount       REAL    NOT NULL DEFAULT 0,
    amount         REAL    NOT NULL,
    currency       TEXT    NOT NULL DEFAULT 'USD',
    status         TEXT    NOT NULL DEFAULT 'unpaid',
    due_date       TEXT    NOT NULL,
    paid_date      TEXT,
    notes          TEXT    DEFAULT '',
    items          TEXT    NOT NULL DEFAULT '[]',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount      REAL    NOT NULL,
    method      TEXT    NOT NULL DEFAULT 'manual',
    reference   TEXT    DEFAULT '',
    notes       TEXT    DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin',
    totp_secret   TEXT DEFAULT NULL,
    totp_enabled  INTEGER NOT NULL DEFAULT 0,
    last_login    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,
    permissions  TEXT NOT NULL DEFAULT 'read',
    last_used    TEXT,
    expires_at   TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ip_whitelist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ip         TEXT NOT NULL UNIQUE,
    label      TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alert_rules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    metric        TEXT NOT NULL,
    threshold     INTEGER NOT NULL DEFAULT 80,
    notify_email  TEXT DEFAULT '',
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS managed_apps (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL UNIQUE,
    type         TEXT NOT NULL DEFAULT 'nodejs',
    domain       TEXT NOT NULL,
    port         INTEGER NOT NULL,
    start_script TEXT NOT NULL,
    working_dir  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'stopped',
    pm2_id       TEXT DEFAULT NULL,
    env_vars     TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS autoresponders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL,
    subject     TEXT NOT NULL DEFAULT 'Auto Reply',
    body        TEXT NOT NULL DEFAULT '',
    start_date  TEXT,
    end_date    TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migrate existing tables — add columns if missing
const tryAlter = (sql: string) => { try { db.exec(sql); } catch (_) {} };
tryAlter("ALTER TABLE clients ADD COLUMN password_hash TEXT DEFAULT NULL");
tryAlter("ALTER TABLE clients ADD COLUMN portal_enabled INTEGER NOT NULL DEFAULT 0");
tryAlter("ALTER TABLE invoices ADD COLUMN subtotal REAL NOT NULL DEFAULT 0");
tryAlter("ALTER TABLE invoices ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0");
tryAlter("ALTER TABLE invoices ADD COLUMN tax_amount REAL NOT NULL DEFAULT 0");
tryAlter("ALTER TABLE invoices ADD COLUMN discount REAL NOT NULL DEFAULT 0");
tryAlter("ALTER TABLE invoices ADD COLUMN items TEXT NOT NULL DEFAULT '[]'");

// Seed default plans if empty
const planCount = (db.prepare('SELECT COUNT(*) as n FROM plans').get() as { n: number }).n;
if (planCount === 0) {
  const insert = db.prepare(`
    INSERT INTO plans (name, description, price, billing_cycle, disk_quota, bandwidth, email_accts, databases, subdomains, ftp_accts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run('Starter',    'Perfect for small sites',             4.99,  'monthly', 5120,   51200,  5,  2,  5,  2);
  insert.run('Business',   'For growing businesses',              9.99,  'monthly', 20480,  204800, 25, 10, 25, 10);
  insert.run('Pro',        'High-performance hosting',            19.99, 'monthly', 51200,  512000, 100,25, 100,25);
  insert.run('Enterprise', 'Unlimited resources for power users', 49.99, 'monthly', 204800, 2048000, -1, -1, -1, -1);
}

// Seed default settings
const seedSetting = (key: string, value: string) => {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
};
seedSetting('company_name', 'HostPanel');
seedSetting('company_email', '');
seedSetting('company_address', '');
seedSetting('company_logo', '');
seedSetting('currency', 'USD');
seedSetting('tax_rate', '0');
seedSetting('tax_name', 'Tax');
seedSetting('invoice_prefix', 'INV');
seedSetting('smtp_host', '');
seedSetting('smtp_port', '587');
seedSetting('smtp_user', '');
seedSetting('smtp_pass', '');
seedSetting('smtp_from', '');
seedSetting('smtp_secure', '0');
seedSetting('paypal_client_id', '');
seedSetting('paypal_secret', '');
seedSetting('paypal_mode', 'sandbox');
seedSetting('panel_2fa_required', '0');

export default db;
