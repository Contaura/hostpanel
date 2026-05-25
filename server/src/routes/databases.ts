import { Router, Response } from 'express';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import mysql from 'mysql2/promise';
import multer from 'multer';
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from 'fs';
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
const PMA_CANDIDATES = (process.env.PHPMYADMIN_PATHS || '/usr/share/phpMyAdmin:/usr/share/phpmyadmin:/var/www/html/phpMyAdmin:/var/www/html/phpmyadmin').split(':').filter(Boolean);

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
function pmaUrl(database?: string, user?: string) {
  const q = new URLSearchParams();
  if (database) q.set('db', database);
  if (user) q.set('pma_username', user);
  const suffix = q.toString();
  return `${PMA_ALIAS.replace(/\/$/, '')}/${suffix ? `?${suffix}` : ''}`;
}
function writePmaApacheConfig(foundPath: string) {
  mkdirSync(path.dirname(PMA_CONF_FILE), { recursive: true });
  writeFileSync(PMA_CONF_FILE, `# Managed by HostPanel. Exposes phpMyAdmin through Apache.\nAlias ${PMA_ALIAS} ${foundPath}\nAlias ${PMA_ALIAS}/ ${foundPath}/\n<Directory ${foundPath}>\n  Options FollowSymLinks\n  DirectoryIndex index.php\n  AllowOverride None\n  Require all granted\n</Directory>\n`, { mode: 0o644 });
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
    writePmaApacheConfig(found);
    await runFile('apachectl', ['graceful'], { timeout: 120000 }).catch(async () => { await runFile('systemctl', ['reload', 'httpd'], { timeout: 120000 }); });
    res.json({ installed: true, path: found, url: pmaUrl(), config: PMA_CONF_FILE });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
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
