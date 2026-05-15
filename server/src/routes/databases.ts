import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import mysql from 'mysql2/promise';
import multer from 'multer';
import { existsSync, unlinkSync } from 'fs';
import path from 'path';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);
const sqlUpload = multer({ dest: '/tmp/', limits: { fileSize: 512 * 1024 * 1024 } });

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);
const DB_ROOT_USER = process.env.DB_ROOT_USER || 'root';
const DB_ROOT_PASS = process.env.DB_ROOT_PASS || '';

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
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT schema_name AS name,
              ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
       FROM information_schema.SCHEMATA
       LEFT JOIN information_schema.TABLES USING (table_schema)
       WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys')
       GROUP BY schema_name`
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

router.get('/databases/:name/export', async (req: AuthRequest, res: Response) => {
  const { name } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return res.status(400).json({ error: 'Invalid database name' });
  const user = DB_ROOT_USER;
  const passArg = DB_ROOT_PASS ? `-p${DB_ROOT_PASS}` : '';
  res.setHeader('Content-Type', 'application/sql');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${Date.now()}.sql"`);
  const child = require('child_process').spawn('mysqldump', [
    `-u${user}`, ...(DB_ROOT_PASS ? [`-p${DB_ROOT_PASS}`] : []), name,
  ]);
  child.stdout.pipe(res);
  child.stderr.on('data', (d: Buffer) => console.error('mysqldump stderr:', d.toString()));
  child.on('error', (err: Error) => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
});

/* ── Import (SQL file upload → mysql CLI) ────────────────────── */

router.post('/databases/:name/import', sqlUpload.single('file'), async (req: AuthRequest, res: Response) => {
  const { name } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return res.status(400).json({ error: 'Invalid database name' });
  if (!req.file) return res.status(400).json({ error: 'No SQL file uploaded' });
  const tmpPath = req.file.path;
  const user = DB_ROOT_USER;
  const passArg = DB_ROOT_PASS ? `-p${DB_ROOT_PASS}` : '';
  try {
    await execAsync(`mysql -u${user} ${passArg} ${name} < "${tmpPath}"`, { timeout: 300000 });
    res.json({ success: true, message: `Imported into ${name}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  }
});

/* ── phpMyAdmin detection ───────────────────────────────────── */

router.get('/phpmyadmin', async (_req: AuthRequest, res: Response) => {
  const candidates = ['/usr/share/phpMyAdmin', '/var/www/html/phpMyAdmin', '/var/www/html/phpmyadmin', '/usr/share/phpmyadmin'];
  const { existsSync } = await import('fs');
  const found = candidates.find(p => existsSync(p));
  if (found) return res.json({ installed: true, path: found, url: '/phpMyAdmin' });
  // Check if accessible via URL
  try {
    const { stdout } = await execAsync('curl -s -o /dev/null -w "%{http_code}" http://localhost/phpMyAdmin/ 2>/dev/null');
    if (stdout.trim() === '200') return res.json({ installed: true, url: '/phpMyAdmin' });
  } catch {}
  res.json({ installed: false });
});

/* ── User privilege management ─────────────────────────────── */

router.get('/users/:user/grants', async (req: AuthRequest, res: Response) => {
  const { user } = req.params;
  const host = (req.query.host as string) || 'localhost';
  let conn;
  try {
    conn = await getConn();
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT PRIVILEGE_TYPE, TABLE_SCHEMA as db_name, IS_GRANTABLE
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
        const { stdout } = await execAsync(`tail -200 "${logPath}" 2>/dev/null`);
        lines = stdout.split('\n').filter(Boolean);
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
    await conn.query(`DROP USER IF EXISTS ?@?`, [user, decodeURIComponent(host)]);
    await conn.query('FLUSH PRIVILEGES');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
  finally { await conn?.end(); }
});

export default router;
