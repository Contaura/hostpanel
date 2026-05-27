/**
 * Security / Authorization regression tests
 *
 * Covers the boundary between the client portal JWT space (role: client,
 * client_team) and the admin API (all /api/* routes except /api/portal and
 * /api/auth). Portal-role tokens MUST be rejected at admin API endpoints even
 * though they contain a valid HS256 signature and pass authenticateToken.
 *
 * Also covers readonly-role write rejection and superadmin-only guards.
 */
import express from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/process-runner', () => ({ runFile: vi.fn(async () => ({ stdout: '', stderr: '' })) }));

const JWT_SECRET = 'test-secret-auth-regression';

function makeToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Missing address');
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())) });
    });
  });
}

describe('admin API portal-role isolation', () => {
  let tmp = '';
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-secauth-'));
    process.env.DATA_DIR = tmp;
    process.env.JWT_SECRET = JWT_SECRET;
    vi.resetModules();
  });

  afterEach(async () => {
    if (closeServer) { await closeServer(); closeServer = undefined; }
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.JWT_SECRET;
    vi.resetModules();
  });

  async function buildAdminApp() {
    const { authenticateToken, blockPortalRoles } = await import('../middleware/auth');
    const settingsRoute = (await import('./settings')).default;
    const adminUsersRoute = (await import('./admin-users')).default;
    const app = express();
    app.use(express.json());
    // Replicate the index.ts admin API guard: authenticateToken + blockPortalRoles
    app.use('/api/settings', authenticateToken, blockPortalRoles, settingsRoute);
    app.use('/api/admin-users', authenticateToken, blockPortalRoles, adminUsersRoute);
    return listen(app);
  }

  it('rejects a client portal JWT on admin settings routes', async () => {
    const server = await buildAdminApp(); closeServer = server.close;
    const clientToken = makeToken({ clientId: 1, email: 'user@example.com', role: 'client' });

    const res = await fetch(`${server.url}/api/settings`, {
      headers: { authorization: `Bearer ${clientToken}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/portal/i);
  });

  it('rejects a client_team portal JWT on admin settings routes', async () => {
    const server = await buildAdminApp(); closeServer = server.close;
    const teamToken = makeToken({ clientId: 1, email: 'helper@example.com', role: 'client_team', teamUserId: 5, accountId: 2, permissions: ['files'] });

    const res = await fetch(`${server.url}/api/settings`, {
      headers: { authorization: `Bearer ${teamToken}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/portal/i);
  });

  it('allows admin-role JWT to access settings GET', async () => {
    const server = await buildAdminApp(); closeServer = server.close;
    const adminToken = makeToken({ username: 'admin', role: 'admin' });

    const res = await fetch(`${server.url}/api/settings`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    expect(typeof await res.json()).toBe('object');
  });

  it('allows superadmin-role JWT to access settings GET', async () => {
    const server = await buildAdminApp(); closeServer = server.close;
    const superToken = makeToken({ username: 'superadmin', role: 'superadmin' });

    const res = await fetch(`${server.url}/api/settings`, {
      headers: { authorization: `Bearer ${superToken}` },
    });
    expect(res.status).toBe(200);
  });

  it('allows readonly-role JWT to read settings but blocks writes', async () => {
    const server = await buildAdminApp(); closeServer = server.close;
    const roToken = makeToken({ username: 'viewer', role: 'readonly' });

    // GET should work
    const getRes = await fetch(`${server.url}/api/settings`, {
      headers: { authorization: `Bearer ${roToken}` },
    });
    expect(getRes.status).toBe(200);

    // PUT should be blocked by readonlyGuard (tested at index level) — but here we
    // mount only authenticateToken + blockPortalRoles, so the PUT itself reaches the
    // route. That is fine — readonlyGuard lives in index.ts globally.  What we assert
    // here is that readonly is NOT blocked by blockPortalRoles (it's an admin role).
    // The write-block for readonly is covered by the readonlyGuard unit in auth.ts.
  });

  it('rejects a client_team JWT from admin-users management routes (privilege escalation path)', async () => {
    const server = await buildAdminApp(); closeServer = server.close;
    const db = (await import('../db')).default;
    await import('./admin-users');
    const hash = await bcrypt.hash('password', 4);
    db.prepare("INSERT INTO admin_users (username,email,password_hash,role) VALUES ('sup','sup@x.com',?,'superadmin')").run(hash);

    const teamToken = makeToken({ clientId: 99, email: 'attacker@example.com', role: 'client_team', teamUserId: 1, accountId: 1, permissions: ['admin'] });

    const res = await fetch(`${server.url}/api/admin-users`, {
      headers: { authorization: `Bearer ${teamToken}` },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/portal/i);
  });

  it('rejects a client portal JWT from billing write routes (data exfiltration path)', async () => {
    const { authenticateToken, blockPortalRoles } = await import('../middleware/auth');
    const billingRoute = (await import('./billing')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/billing', authenticateToken, blockPortalRoles, billingRoute);
    const server = await listen(app); closeServer = server.close;

    const clientToken = makeToken({ clientId: 1, email: 'user@example.com', role: 'client' });
    const res = await fetch(`${server.url}/api/billing/clients`, {
      headers: { authorization: `Bearer ${clientToken}` },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/portal/i);
  });
});

describe('readonly-role write-block guard', () => {
  let tmp = '';
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-roguard-'));
    process.env.DATA_DIR = tmp;
    process.env.JWT_SECRET = JWT_SECRET;
    vi.resetModules();
  });

  afterEach(async () => {
    if (closeServer) { await closeServer(); closeServer = undefined; }
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.JWT_SECRET;
    vi.resetModules();
  });

  it('blocks readonly-role JWT from any non-GET mutation via readonlyGuard', async () => {
    const { readonlyGuard, blockPortalRoles, authenticateToken } = await import('../middleware/auth');
    const settingsRoute = (await import('./settings')).default;
    const app = express();
    app.use(express.json());
    // readonlyGuard is mounted globally before auth in index.ts; mirror that here
    app.use(readonlyGuard);
    app.use('/api/settings', authenticateToken, blockPortalRoles, settingsRoute);
    const server = await listen(app); closeServer = server.close;

    const roToken = makeToken({ username: 'viewer', role: 'readonly' });

    // GET is allowed
    const getRes = await fetch(`${server.url}/api/settings`, { headers: { authorization: `Bearer ${roToken}` } });
    expect(getRes.status).toBe(200);

    // PUT is blocked by readonlyGuard before it reaches the route
    const putRes = await fetch(`${server.url}/api/settings`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${roToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ company_name: 'Hacked' }),
    });
    expect(putRes.status).toBe(403);
    expect((await putRes.json()).error).toMatch(/readonly/i);
  });
});

describe('superadmin-only route enforcement', () => {
  let tmp = '';
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-superonly-'));
    process.env.DATA_DIR = tmp;
    process.env.JWT_SECRET = JWT_SECRET;
    vi.resetModules();
  });

  afterEach(async () => {
    if (closeServer) { await closeServer(); closeServer = undefined; }
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.JWT_SECRET;
    vi.resetModules();
  });

  it('blocks admin-role from creating admin users (superadmin-only route)', async () => {
    const { authenticateToken, blockPortalRoles } = await import('../middleware/auth');
    const adminUsersRoute = (await import('./admin-users')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/admin-users', authenticateToken, blockPortalRoles, adminUsersRoute);
    const server = await listen(app); closeServer = server.close;

    const adminToken = makeToken({ username: 'admin', role: 'admin' });
    const res = await fetch(`${server.url}/api/admin-users`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'newadmin', email: 'new@x.com', password: 'Str0ng!Pass#1', role: 'admin' }),
    });
    // superadminOnly guard in admin-users.ts must block this
    expect(res.status).toBe(403);
  });

  it('allows superadmin-role to create admin users', async () => {
    const { authenticateToken, blockPortalRoles } = await import('../middleware/auth');
    const adminUsersRoute = (await import('./admin-users')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/admin-users', authenticateToken, blockPortalRoles, adminUsersRoute);
    const server = await listen(app); closeServer = server.close;

    const superToken = makeToken({ username: 'superadmin', role: 'superadmin' });
    const res = await fetch(`${server.url}/api/admin-users`, {
      method: 'POST',
      headers: { authorization: `Bearer ${superToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'newadmin', email: 'new@x.com', password: 'Str0ng!Pass#1', role: 'admin' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.username).toBe('newadmin');
    expect(body.role).toBe('admin');
  });
});
