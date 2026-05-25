import express from 'express';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { authenticateToken, readonlyGuard, requireRole } from './auth';

const JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;

function token(role: string) {
  return jwt.sign({ username: `${role}-user`, role }, JWT_SECRET, { algorithm: 'HS256' });
}

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Missing listen address');
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())),
      });
    });
  });
}

describe('role and permission middleware integration', () => {
  it('allows superadmin/admin protected routes and blocks readonly/reseller/client roles', async () => {
    const app = express();
    app.use(express.json());
    app.post('/admin-config', authenticateToken, requireRole('superadmin', 'admin'), (_req, res) => res.json({ ok: true }));
    const server = await listen(app);
    try {
      for (const role of ['superadmin', 'admin']) {
        const res = await fetch(`${server.url}/admin-config`, { method: 'POST', headers: { Authorization: `Bearer ${token(role)}` } });
        expect(res.status).toBe(200);
      }
      for (const role of ['readonly', 'reseller', 'client']) {
        const res = await fetch(`${server.url}/admin-config`, { method: 'POST', headers: { Authorization: `Bearer ${token(role)}` } });
        expect(res.status).toBe(403);
      }
    } finally {
      await server.close();
    }
  });

  it('blocks readonly role write operations before route handlers run', async () => {
    const app = express();
    app.use(express.json());
    app.use(readonlyGuard);
    app.post('/files/write', authenticateToken, (_req, res) => res.json({ ok: true }));
    app.get('/files/list', authenticateToken, (_req, res) => res.json({ ok: true }));
    const server = await listen(app);
    try {
      const write = await fetch(`${server.url}/files/write`, { method: 'POST', headers: { Authorization: `Bearer ${token('readonly')}` } });
      expect(write.status).toBe(403);

      const read = await fetch(`${server.url}/files/list`, { headers: { Authorization: `Bearer ${token('readonly')}` } });
      expect(read.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
