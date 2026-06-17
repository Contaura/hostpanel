import { Router, Response } from 'express';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import multer from 'multer';
import { existsSync, unlinkSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { AuthRequest } from '../middleware/auth';
import { runFile } from '../utils/process-runner';
import { enforceResellerPrivilege } from './feature-lists';

const router = Router();
const sqlUpload = multer({ dest: '/tmp/', limits: { fileSize: 512 * 1024 * 1024 } });

// Export streams a full mysqldump; import pipes a 512 MB SQL file through
// the mysql CLI. Both are expensive enough that the global 300/min budget
// isn't enough — pin them to a tighter bucket so a single token can't fill
// the disk or starve the DB server.
const heavyLimit = rateLimit({
  windowMs: 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit hit on heavy database operation; wait a minute.' },
});

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);
const DB_ROOT_USER = process.env.DB_ROOT_USER || 'root';
const DB_ROOT_PASS = process.env.DB_ROOT_PASS || '';
const PMA_ALIAS = process.env.PHPMYADMIN_ALIAS || '/phpMyAdmin';
const PMA_CONF_FILE = process.env.PHPMYADMIN_CONF_FILE || '/etc/httpd/conf.d/hostpanel-phpmyadmin.conf';
const PMA_DISTRO_CONF_FILE = process.env.PHPMYADMIN_DISTRO_CONF_FILE || '/etc/httpd/conf.d/phpMyAdmin.conf';
const PMA_CONFIG_FILE = process.env.PHPMYADMIN_CONFIG_FILE || '/etc/phpMyAdmin/config.inc.php';
const PMA_CANDIDATES = (process.env.PHPMYADMIN_PATHS || '/usr/share/phpMyAdmin:/usr/share/phpmyadmin:/var/www/html/phpMyAdmin:/var/www/html/phpmyadmin').split(':').filter(Boolean);
const PMA_SSO_TOKEN_DIR = process.env.PHPMYADMIN_SSO_TOKEN_DIR || '/var/lib/hostpanel/phpmyadmin-sso';
const PMA_SSO_SERVER_ID = parseInt(process.env.PHPMYADMIN_SSO_SERVER_ID || '2', 10);
const PMA_SSO_TTL_MS = 2 * 60 * 1000;

async function getConn() {
  return mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_ROOT_USER,
    password: DB_ROOT_PASS,
  });
}

router.get('/databases', async (_req: AuthRequest, res: Response) => {
  let conn;
  try {
    conn = await getConn();
    // The previous form used `LEFT JOIN ... USING (table_schema)` but
    // information_schema.SCHEMATA's column is named SCHEMA_NAME, not
    // TABLE_SCHEMA, so MariaDB rejects with "Unknown column 'table_schema'".
    // Use an explicit ON clause instead.
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT s.schema_name AS name,
              COALESCE(ROUND(SUM(t.data_length + t.index_length) / 1024 / 1024, 2), 0) AS size_mb
       FROM information_schema.SCHEMATA s
       LEFT JOIN information_schema.TABLES t ON t.table_schema = s.schema_name
       WHERE s.schema_name NOT IN ('information_schema','performance_schema','mysql','sys')
       GROUP BY s.schema_name
       ORDER BY s.schema_name`
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn?.end();
  }
});

router.post('/databases', async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  if (!name || !/^[a-zA-Z0-9_]+$/.test(name)) {
    res.status(400).json({ error: 'Invalid database name (alphanumeric and underscores only)' });
    return;
  }

  let conn;
  try {
    conn = await getConn();
    await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    res.json({ message: `Database ${name} created` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn?.end();
  }
});

router.delete('/databases/:name', async (req: AuthRequest, res: Response) => {
  const { name } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    res.status(400).json({ error: 'Invalid database name' });
    return;
  }

  let conn;
  try {
    conn = await getConn();
    await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
    res.json({ message: `Database ${name} dropped` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn?.end();
  }
});

router.get('/users', async (_req: AuthRequest, res: Response) => {
  let conn;
  try {
    conn = await getConn();
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT user, host FROM mysql.user WHERE user NOT IN ('root','mysql','mariadb.sys') ORDER BY user`
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn?.end();
  }
});

router.post('/users', async (req: AuthRequest, res: Response) => {
  const { username, password, database, host = 'localhost' } = req.body;
  if (!username || !password || !/^[a-zA-Z0-9_]+$/.test(username)) {
    res.status(400).json({ error: 'Invalid username or missing password' });
    return;
  }
  if (!/^[a-zA-Z0-9._%-]+$/.test(host)) return res.status(400).json({ error: 'Invalid host' });
  if (database && !/^[a-zA-Z0-9_]+$/.test(database)) return res.status(400).json({ error: 'Invalid database name' });

  let conn;
  try {
    conn = await getConn();
    await conn.query(`CREATE USER ?@? IDENTIFIED BY ?`, [username, host, password]);
    if (database) {
      await conn.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO ?@?`, [username, host]);
    }
    await conn.query('FLUSH PRIVILEGES');
    res.json({ message: `User ${username} created` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn?.end();
  }
});

router.delete('/users/:username', async (req: AuthRequest, res: Response) => {
  const { username } = req.params;
  const host = (req.query.host as string) || 'localhost';
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
  if (!/^[a-zA-Z0-9._%-]+$/.test(host)) return res.status(400).json({ error: 'Invalid host' });

  let conn;
  try {
    conn = await getConn();
    await conn.query(`DROP USER IF EXISTS ?@?`, [username, host]);
    await conn.query('FLUSH PRIVILEGES');
    res.json({ message: `User ${username} deleted` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn?.end();
  }
});

/* ── Export (mysqldump → download) ──────────────────────────── */

router.get('/databases/:name/export', heavyLimit, async (req: AuthRequest, res: Response) => {
  const { name } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return res.status(400).json({ error: 'Invalid database name' });
  const user = DB_ROOT_USER;
  res.setHeader('Content-Type', 'application/sql');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${Date.now()}.sql"`);
  const child = require('child_process').spawn('mysqldump', [`-u${user}`, name], {
    env: { ...process.env, ...(DB_ROOT_PASS ? { MYSQL_PWD: DB_ROOT_PASS } : {}) },
  });
  child.stdout.pipe(res);
  child.stderr.on('data', (d: Buffer) => console.error('mysqldump stderr:', d.toString()));
  child.on('error', (err: Error) => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
});

/* ── Import (SQL file upload → mysql CLI) ────────────────────── */

router.post('/databases/:name/import', heavyLimit, sqlUpload.single('file'), async (req: AuthRequest, res: Response) => {
  const { name } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return res.status(400).json({ error: 'Invalid database name' });
  if (!req.file) return res.status(400).json({ error: 'No SQL file uploaded' });
  const tmpPath = req.file.path;
  const user = DB_ROOT_USER;
  const dbEnv = { ...process.env, ...(DB_ROOT_PASS ? { MYSQL_PWD: DB_ROOT_PASS } : {}) };
  try {
    // -h127.0.0.1 forces TCP so the dedicated hostpanel@127.0.0.1 user the
    // installer creates matches the host in MariaDB's ACL. Without it,
    // mysql picks the unix socket and presents @localhost → access denied.
    await new Promise<void>((resolve, reject) => {
      const child = spawn('mysql', [`-u${user}`, `-h${DB_HOST}`, name], { env: dbEnv, shell: false });
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('mysql import timed out')); }, 300000);
      createReadStream(tmpPath).pipe(child.stdin);
      child.on('error', err => { clearTimeout(timer); reject(err); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`mysql exited with code ${code}`)); });
    });
    res.json({ success: true, message: `Imported into ${name}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  }
});

/* ── phpMyAdmin detection / installation ────────────────────── */

function pmaPath() { return PMA_CANDIDATES.find(p => existsSync(p)); }
function pmaBaseUrl() { return PMA_ALIAS.replace(/\/$/, ''); }
function phpStringLiteral(value: string) { return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`; }
function pmaConfigBlock() {
  return `// BEGIN HostPanel phpMyAdmin Signon bridge\n$i = ${PMA_SSO_SERVER_ID - 1};\n$i++;\n$cfg['Servers'][$i]['verbose'] = 'HostPanel Signon';\n$cfg['Servers'][$i]['auth_type'] = 'signon';\n$cfg['Servers'][$i]['SignonSession'] = 'HOSTPANEL_PMA';\n$cfg['Servers'][$i]['SignonURL'] = ${phpStringLiteral(`${pmaBaseUrl()}/hostpanel-signon.php`)};\n$cfg['Servers'][$i]['host'] = ${phpStringLiteral(DB_HOST)};\n$cfg['Servers'][$i]['port'] = ${phpStringLiteral(String(DB_PORT))};\n$cfg['Servers'][$i]['compress'] = false;\n$cfg['Servers'][$i]['AllowNoPassword'] = false;\n// END HostPanel phpMyAdmin Signon bridge`;
}
async function writePmaConfig() {
  await fs.mkdir(path.dirname(PMA_CONFIG_FILE), { recursive: true });
  let existing = '';
  try { existing = await fs.readFile(PMA_CONFIG_FILE, 'utf8'); } catch {}
  const block = pmaConfigBlock();
  const re = /\n?\/\/ BEGIN HostPanel phpMyAdmin Signon bridge[\s\S]*?\/\/ END HostPanel phpMyAdmin Signon bridge\n?/m;
  const next = re.test(existing)
    ? existing.replace(re, `\n${block}\n`)
    : `${existing.replace(/\s*\?>\s*$/, '').trimEnd()}\n\n${block}\n`;
  await fs.writeFile(PMA_CONFIG_FILE, next, { mode: 0o640 });
}
function pmaUrl(database?: string, user?: string) {
  const q = new URLSearchParams();
  if (database) q.set('db', database);
  if (user) q.set('pma_username', user);
  const suffix = q.toString();
  return `${pmaBaseUrl()}/${suffix ? `?${suffix}` : ''}`;
}
function pmaBridgePhp() {
  return `<?php
// Managed by HostPanel. One-time phpMyAdmin Signon bridge.
$tokenDir = getenv('HOSTPANEL_PMA_SSO_TOKEN_DIR') ?: '${PMA_SSO_TOKEN_DIR.replace(/'/g, "'\\''")}';
$token = preg_replace('/[^a-f0-9]/', '', $_GET['token'] ?? $_POST['token'] ?? '');
if (!$token) { http_response_code(400); exit('Missing token'); }
$file = rtrim($tokenDir, '/').'/'.$token.'.json';
if (!is_readable($file)) { http_response_code(403); exit('Invalid or expired token'); }
$data = json_decode(file_get_contents($file), true);
@unlink($file);
if (!$data || empty($data['expires']) || $data['expires'] < time()) { http_response_code(403); exit('Expired token'); }
session_name('HOSTPANEL_PMA');
session_start();
$_SESSION['PMA_single_signon_user'] = $data['username'];
$_SESSION['PMA_single_signon_password'] = $data['password'];
$_SESSION['PMA_single_signon_host'] = $data['host'] ?? '127.0.0.1';
$_SESSION['PMA_single_signon_port'] = strval($data['port'] ?? 3306);
$target = 'index.php?server=${PMA_SSO_SERVER_ID}';
if (!empty($data['database'])) $target .= '&db='.rawurlencode($data['database']);
header('Location: '.$target);
exit;
?>`;
}
async function securePmaSsoPath(target: string, mode: number) {
  await fs.chmod(target, mode);
  await runFile('chgrp', ['apache', target], { timeout: 60000 }).catch(() => undefined);
}

async function writePmaApacheConfig(foundPath: string) {
  mkdirSync(path.dirname(PMA_CONF_FILE), { recursive: true });
  mkdirSync(PMA_SSO_TOKEN_DIR, { recursive: true, mode: 0o750 });
  await securePmaSsoPath(PMA_SSO_TOKEN_DIR, 0o750);
  writeFileSync(path.join(foundPath, 'hostpanel-signon.php'), pmaBridgePhp(), { mode: 0o640 });
  disableDistroPmaAliases();
  writeFileSync(PMA_CONF_FILE, `# Managed by HostPanel. Exposes phpMyAdmin through Apache.\nSetEnv HOSTPANEL_PMA_SSO_TOKEN_DIR ${PMA_SSO_TOKEN_DIR}\nAlias ${PMA_ALIAS} ${foundPath}\n<Directory ${foundPath}>\n  Options FollowSymLinks\n  DirectoryIndex index.php\n  AllowOverride None\n  Require all granted\n</Directory>\n`, { mode: 0o644 });
}

function disableDistroPmaAliases() {
  if (PMA_DISTRO_CONF_FILE === PMA_CONF_FILE || !existsSync(PMA_DISTRO_CONF_FILE)) return;
  const src = readFileSync(PMA_DISTRO_CONF_FILE, 'utf8');
  const next = src.replace(/^(Alias\s+\/phpMyAdmin\s+.+)$/gmi, '# Disabled by HostPanel to avoid duplicate Apache Alias warnings: $1');
  if (next !== src) writeFileSync(PMA_DISTRO_CONF_FILE, next, { mode: 0o644 });
}
async function createPmaSsoToken(username: string, password: string, database?: string) {
  await fs.mkdir(PMA_SSO_TOKEN_DIR, { recursive: true, mode: 0o750 });
  await securePmaSsoPath(PMA_SSO_TOKEN_DIR, 0o750);
  const token = crypto.randomBytes(24).toString('hex');
  const payload = { username, password, database: database || '', host: DB_HOST, port: DB_PORT, expires: Math.floor((Date.now() + PMA_SSO_TTL_MS) / 1000) };
  const tokenFile = path.join(PMA_SSO_TOKEN_DIR, `${token}.json`);
  await fs.writeFile(tokenFile, JSON.stringify(payload), { mode: 0o640 });
  await securePmaSsoPath(tokenFile, 0o640);
  return token;
}

async function readIfPresent(file: string) {
  try { return await fs.readFile(file, 'utf8'); } catch { return ''; }
}

async function commandOk(command: string, args: string[]) {
  try {
    const result = await runFile(command, args, { timeout: 60000 }) as any;
    const output = typeof result === 'string'
      ? result
      : `${result?.stdout || ''}${result?.stderr || ''}`;
    return { ok: true, output: output.trim() };
  } catch (err: any) {
    return { ok: false, output: String(err?.message || err) };
  }
}

router.get('/phpmyadmin', enforceResellerPrivilege('phpmyadmin'), async (_req: AuthRequest, res: Response) => {
  const found = pmaPath();
  if (found) return res.json({ installed: true, path: found, url: pmaUrl(), config: existsSync(PMA_CONF_FILE) ? PMA_CONF_FILE : null });
  // Check if accessible via URL
  try {
    const response = await fetch(`http://localhost${PMA_ALIAS}/`);
    if (response.status === 200) return res.json({ installed: true, url: pmaUrl() });
  } catch {}
  res.json({ installed: false, url: pmaUrl() });
});

router.post('/phpmyadmin/install', enforceResellerPrivilege('phpmyadmin'), async (_req: AuthRequest, res: Response) => {
  try {
    let found = pmaPath();
    if (!found) {
      try {
        await runFile('dnf', ['install', '-y', 'phpMyAdmin'], { timeout: 300000 });
      } catch (firstErr: any) {
        await runFile('dnf', ['install', '-y', 'epel-release'], { timeout: 300000 });
        await runFile('dnf', ['install', '-y', 'phpMyAdmin'], { timeout: 300000 });
      }
      found = pmaPath();
    }
    if (!found) return res.status(500).json({ error: 'phpMyAdmin package installed but no known install directory was found' });
    await writePmaApacheConfig(found);
    await writePmaConfig();
    await runFile('apachectl', ['graceful'], { timeout: 120000 }).catch(async () => { await runFile('systemctl', ['reload', 'httpd'], { timeout: 120000 }); });
    res.json({ installed: true, path: found, url: pmaUrl(), config: PMA_CONF_FILE, phpMyAdminConfig: PMA_CONFIG_FILE });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/phpmyadmin/validation', enforceResellerPrivilege('phpmyadmin'), async (_req: AuthRequest, res: Response) => {
  const found = pmaPath();
  const bridgeFile = found ? path.join(found, 'hostpanel-signon.php') : '';
  const [apacheConfig, pmaConfig, bridge] = await Promise.all([
    readIfPresent(PMA_CONF_FILE),
    readIfPresent(PMA_CONFIG_FILE),
    bridgeFile ? readIfPresent(bridgeFile) : Promise.resolve(''),
  ]);
  const phpSyntax = bridgeFile ? await commandOk('php', ['-l', bridgeFile]) : { ok: false, output: 'phpMyAdmin Signon bridge missing' };
  const apacheSyntax = await commandOk('apachectl', ['configtest']);
  const httpd = await commandOk('systemctl', ['is-active', 'httpd']);
  let tokenDirectory = false;
  try {
    const st = await fs.stat(PMA_SSO_TOKEN_DIR);
    tokenDirectory = st.isDirectory();
  } catch {}
  const checks = {
    installed: !!found,
    apacheAlias: !!found && apacheConfig.includes(`Alias ${PMA_ALIAS} ${found}`) && apacheConfig.includes(`SetEnv HOSTPANEL_PMA_SSO_TOKEN_DIR ${PMA_SSO_TOKEN_DIR}`),
    signonBridge: bridge.includes('PMA_single_signon_user') && bridge.includes('PMA_single_signon_password') && bridge.includes(`index.php?server=${PMA_SSO_SERVER_ID}`),
    signonConfig: pmaConfig.includes("$cfg['Servers'][$i]['auth_type'] = 'signon'") && pmaConfig.includes("$cfg['Servers'][$i]['SignonSession'] = 'HOSTPANEL_PMA'") && pmaConfig.includes(`$cfg['Servers'][$i]['SignonURL'] = ${phpStringLiteral(`${pmaBaseUrl()}/hostpanel-signon.php`)}`),
    phpSyntax: phpSyntax.ok,
    apacheConfig: apacheSyntax.ok && !/syntax error|AH00671|overlaps an earlier Alias|will probably never match/i.test(apacheSyntax.output),
    httpdActive: httpd.ok && httpd.output.includes('active'),
    tokenDirectory,
  };
  res.json({
    ready: Object.values(checks).every(Boolean),
    checks,
    paths: { phpMyAdmin: found || null, apacheConfig: PMA_CONF_FILE, phpMyAdminConfig: PMA_CONFIG_FILE, signonBridge: bridgeFile || null, tokenDirectory: PMA_SSO_TOKEN_DIR },
  });
});

router.get('/phpmyadmin/account-scope', enforceResellerPrivilege('phpmyadmin'), async (req: AuthRequest, res: Response) => {
  const account = String(req.query.account || '').trim();
  const database = String(req.query.database || '').trim();
  if (!account || !/^[a-zA-Z0-9_]+$/.test(account)) return res.status(400).json({ error: 'Valid account is required' });
  if (database && !/^[a-zA-Z0-9_]+$/.test(database)) return res.status(400).json({ error: 'Invalid database name' });
  let conn;
  try {
    conn = await getConn();
    const [dbRows] = await conn.query<mysql.RowDataPacket[]>('SELECT schema_name AS name FROM information_schema.SCHEMATA');
    const databases = (dbRows as any[]).map(r => r.name).filter((n: string) => n === account || n.startsWith(`${account}_`));
    const selected = database && databases.includes(database) ? database : databases[0] || undefined;
    const [userRows] = await conn.query<mysql.RowDataPacket[]>("SELECT user, host FROM mysql.user WHERE user NOT IN ('root','mysql','mariadb.sys') ORDER BY user");
    const users = (userRows as any[]).map(r => ({ user: r.User ?? r.user, host: r.Host ?? r.host })).filter(r => r.user && (r.user === account || r.user.startsWith(`${account}_`)));
    res.json({ installed: !!pmaPath(), url: pmaUrl(selected, users[0]?.user), account, selectedDatabase: selected || null, databases, users });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
  finally { await conn?.end(); }
});

router.post('/phpmyadmin/sso', enforceResellerPrivilege('phpmyadmin'), async (req: AuthRequest, res: Response) => {
  const { username, password, database = '' } = req.body || {};
  if (!username || !/^[a-zA-Z0-9_]+$/.test(String(username))) return res.status(400).json({ error: 'Valid database username is required' });
  if (!password || typeof password !== 'string') return res.status(400).json({ error: 'Database password is required for SSO handoff' });
  if (database && !/^[a-zA-Z0-9_]+$/.test(String(database))) return res.status(400).json({ error: 'Invalid database name' });
  const found = pmaPath();
  if (!found) return res.status(404).json({ error: 'phpMyAdmin is not installed' });
  try {
    await writePmaApacheConfig(found);
    await writePmaConfig();
    const userConn = await mysql.createConnection({ host: DB_HOST, port: DB_PORT, user: username, password, database: database || undefined });
    await userConn.ping();
    await userConn.end();
    const token = await createPmaSsoToken(username, password, database || undefined);
    res.json({ url: `${pmaBaseUrl()}/hostpanel-signon.php?token=${token}`, expiresInSeconds: PMA_SSO_TTL_MS / 1000, authType: 'signon', note: 'One-time token consumed by HostPanel phpMyAdmin signon bridge' });
  } catch (err: any) { res.status(401).json({ error: `phpMyAdmin SSO credential verification failed: ${err.message}` }); }
});

/* ── User privilege management ─────────────────────────────── */

router.get('/users/:user/grants', async (req: AuthRequest, res: Response) => {
  const { user } = req.params;
  const host = (req.query.host as string) || 'localhost';
  let conn;
  try {
    conn = await getConn();
    // USER_PRIVILEGES is the global (server-wide) privilege table — its rows
    // have no TABLE_SCHEMA column, so the previous SELECT 500'd with
    // "Unknown column 'TABLE_SCHEMA' in 'field list'". Emit NULL for the
    // db_name so the response shape stays uniform between global and
    // per-database rows.
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT PRIVILEGE_TYPE, NULL AS db_name, IS_GRANTABLE
       FROM information_schema.USER_PRIVILEGES
       WHERE GRANTEE = ?`,
      [`'${user}'@'${host}'`]
    );
    const [dbRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT PRIVILEGE_TYPE, TABLE_SCHEMA as db_name, IS_GRANTABLE
       FROM information_schema.SCHEMA_PRIVILEGES
       WHERE GRANTEE = ?`,
      [`'${user}'@'${host}'`]
    );
    res.json({ global: rows, database: dbRows });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
  finally { await conn?.end(); }
});

const VALID_PRIVILEGES = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'RELOAD',
  'SHUTDOWN', 'PROCESS', 'FILE', 'REFERENCES', 'INDEX', 'ALTER',
  'SHOW DATABASES', 'SUPER', 'CREATE TEMPORARY TABLES', 'LOCK TABLES',
  'EXECUTE', 'REPLICATION SLAVE', 'REPLICATION CLIENT', 'CREATE VIEW',
  'SHOW VIEW', 'CREATE ROUTINE', 'ALTER ROUTINE', 'CREATE USER', 'EVENT',
  'TRIGGER', 'CREATE TABLESPACE', 'ALL PRIVILEGES', 'ALL', 'USAGE',
]);

function validatePrivileges(privileges: unknown): string | null {
  if (!Array.isArray(privileges) || !privileges.length) return 'privileges must be a non-empty array';
  for (const p of privileges) {
    if (typeof p !== 'string' || !VALID_PRIVILEGES.has(p.trim().toUpperCase())) {
      return `Invalid privilege: ${p}`;
    }
  }
  return null;
}

function safePrivList(privileges: string[]): string {
  return privileges.map(p => p.trim().toUpperCase()).join(', ');
}

router.post('/users/:user/grants', async (req: AuthRequest, res: Response) => {
  const { user } = req.params;
  const { host = 'localhost', database, privileges } = req.body;
  const privErr = validatePrivileges(privileges);
  if (privErr) return res.status(400).json({ error: privErr });
  if (database && !/^[a-zA-Z0-9_]+$/.test(database)) return res.status(400).json({ error: 'Invalid database name' });
  const privList = safePrivList(privileges as string[]);
  const on = database ? `\`${database}\`.*` : '*.*';
  let conn;
  try {
    conn = await getConn();
    await conn.query(`GRANT ${privList} ON ${on} TO ?@?`, [user, host]);
    await conn.query('FLUSH PRIVILEGES');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
  finally { await conn?.end(); }
});

router.delete('/users/:user/grants', async (req: AuthRequest, res: Response) => {
  const { user } = req.params;
  const { host = 'localhost', database, privileges } = req.body;
  if (database && !/^[a-zA-Z0-9_]+$/.test(database)) return res.status(400).json({ error: 'Invalid database name' });
  let privList: string;
  if (privileges?.length) {
    const privErr = validatePrivileges(privileges);
    if (privErr) return res.status(400).json({ error: privErr });
    privList = safePrivList(privileges as string[]);
  } else {
    privList = 'ALL PRIVILEGES';
  }
  const on = database ? `\`${database}\`.*` : '*.*';
  let conn;
  try {
    conn = await getConn();
    await conn.query(`REVOKE ${privList} ON ${on} FROM ?@?`, [user, host]);
    await conn.query('FLUSH PRIVILEGES');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
  finally { await conn?.end(); }
});

/* ── Slow query log viewer ───────────────────────────────── */

const SLOW_LOG_PATHS = ['/var/log/mysql/mysql-slow.log', '/var/log/mysql-slow.log', '/var/lib/mysql/slow.log'];

router.get('/slow-query-log', async (_req: AuthRequest, res: Response) => {
  let conn;
  try {
    conn = await getConn();
    const [vars] = await conn.query<mysql.RowDataPacket[]>(
      "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('slow_query_log','slow_query_log_file','long_query_time')"
    );
    const varsMap: Record<string, string> = {};
    for (const v of vars) varsMap[v.Variable_name] = v.Value;

    let logPath = varsMap['slow_query_log_file'] || '';
    if (!logPath) {
      for (const p of SLOW_LOG_PATHS) {
        try { await import('fs').then(f => f.promises.access(p)); logPath = p; break; } catch {}
      }
    }

    let lines: string[] = [];
    if (logPath) {
      try {
        const raw = (await import('fs')).readFileSync(logPath, 'utf8');
        lines = raw.split('\n').filter(Boolean).slice(-200);
      } catch {}
    }

    res.json({ enabled: varsMap['slow_query_log'] === 'ON', long_query_time: varsMap['long_query_time'], log_file: logPath, lines });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
  finally { await conn?.end(); }
});

router.put('/slow-query-log', async (req: AuthRequest, res: Response) => {
  const { enabled, long_query_time } = req.body;
  let conn;
  try {
    conn = await getConn();
    await conn.query(`SET GLOBAL slow_query_log = ?`, [enabled ? 'ON' : 'OFF']);
    if (long_query_time !== undefined) {
      await conn.query(`SET GLOBAL long_query_time = ?`, [parseFloat(long_query_time) || 1]);
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
  finally { await conn?.end(); }
});

/* ── Remote access (per-user host grants) ───────────────── */

router.get('/remote-access', async (_req: AuthRequest, res: Response) => {
  let conn;
  try {
    conn = await getConn();
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT user, host FROM mysql.user WHERE user NOT IN ('root','mysql','mariadb.sys') AND host != 'localhost' ORDER BY user, host`
    );
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
  finally { await conn?.end(); }
});

router.post('/remote-access', async (req: AuthRequest, res: Response) => {
  const { user, host, database = '*', privileges = ['ALL PRIVILEGES'] } = req.body;
  if (!user || !host) return res.status(400).json({ error: 'user and host required' });
  if (!/^[a-zA-Z0-9_]+$/.test(user)) return res.status(400).json({ error: 'Invalid username' });
  if (!/^[a-zA-Z0-9._%*-]+$/.test(host)) return res.status(400).json({ error: 'Invalid host (use % for wildcard)' });
  if (database && database !== '*' && !/^[a-zA-Z0-9_]+$/.test(database)) return res.status(400).json({ error: 'Invalid database name' });
  const privArr = Array.isArray(privileges) ? privileges : ['ALL PRIVILEGES'];
  const privErr = validatePrivileges(privArr);
  if (privErr) return res.status(400).json({ error: privErr });
  const privList = safePrivList(privArr);
  const on = database && database !== '*' ? `\`${database}\`.*` : '*.*';
  let conn;
  try {
    conn = await getConn();
    // Create user@host if not exists
    await conn.query(`CREATE USER IF NOT EXISTS ?@? IDENTIFIED WITH mysql_native_password`, [user, host]);
    await conn.query(`GRANT ${privList} ON ${on} TO ?@?`, [user, host]);
    await conn.query('FLUSH PRIVILEGES');
    res.json({ success: true, user, host });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
  finally { await conn?.end(); }
});

router.delete('/remote-access/:user/:host', async (req: AuthRequest, res: Response) => {
  const { user, host } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(user)) return res.status(400).json({ error: 'Invalid username' });
  let conn;
  try {
    conn = await getConn();
    // Express has already URL-decoded req.params.host once. The previous
    // decodeURIComponent here was a *second* decode, which threw "URI
    // malformed" on any host with a literal `%` (e.g. the SQL wildcard
    // "10.0.0.%" — the standard MySQL host pattern). Use the param as-is.
    await conn.query(`DROP USER IF EXISTS ?@?`, [user, host]);
    await conn.query('FLUSH PRIVILEGES');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
  finally { await conn?.end(); }
});

export default router;
