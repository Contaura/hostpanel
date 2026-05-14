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

  let conn;
  try {
    conn = await getConn();
    await conn.query(`CREATE USER '${username}'@'${host}' IDENTIFIED BY ?`, [password]);
    if (database) {
      await conn.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${username}'@'${host}'`);
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

  let conn;
  try {
    conn = await getConn();
    await conn.query(`DROP USER IF EXISTS '${username}'@'${host}'`);
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

export default router;
